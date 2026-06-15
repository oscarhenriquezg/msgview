import { rmSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, protocol, session, shell } from 'electron';
import type {
  AttachmentSaveRequest,
  AttachmentSaveResult,
  ExportFormat,
  ExportRequest,
  ExportResult,
  LoadResult,
  MsgDocument,
  RemoteImageResult
} from '@shared/types';
import { MAX_PNG_HEIGHT } from '@shared/types';
import {
  exportEml,
  exportPdf,
  exportPng,
  exportPngToClipboard,
  getPrintableHtml,
  measurePngHeight,
  printDocument
} from './export/exporter';
import { buildPrintableHtml } from './export/printable';
import { documentToText } from './export/textout';
import { documentToMarkdown } from './export/markdown';
import { documentToJson, exportMht, exportZip } from './export/bundle';
import { APP_ICON_PATH, REPO_URL, installContextMenu, installMenu, setExportEnabled } from './menu';
import { registerFileTypes } from './associate';
import { MAX_EMBEDDED_DEPTH } from './parser/limits';
import { getAnyAttachment, isCfbf } from './parser/AnyMessage';
import { MsgAdapter } from './parser/MsgAdapter';
import { addRecent, clearRecents, existingRecents } from './recents';
import { parseAuthResults, parseReceivedChain } from './headers-analysis';
import { sanitizeWithReport } from './parser/sanitize';
import { buildSourceViewHtml } from './sourceview';
import { parseBytes, parseFile, shutdownParser } from './parsing';

/**
 * Proceso main (§7.3): única zona con acceso a disco y diálogos nativos.
 * Cada ventana tiene su propio documento (los .msg anidados se abren en
 * ventana nueva, OBJ-S2); la ventana principal mantiene FR-03: un archivo
 * abierto desde el SO reemplaza su contenido.
 */

interface WindowDocument {
  document: MsgDocument;
  /** Buffer original para extraer adjuntos / EML bajo demanda. */
  buffer: Buffer;
  /** Profundidad de anidado de este documento (OBJ-S2). */
  embeddedDepth: number;
}

/** Documento activo por webContents.id. */
const docs = new Map<number, WindowDocument>();
/** Directorios temporales creados por "Abrir adjunto"; se purgan al salir. */
const tempDirs = new Set<string>();
let mainWindow: BrowserWindow | null = null;
/** Ruta recibida (argv / open-file) antes de que la ventana esté lista. */
let pendingPath: string | null = null;
/** Contenido de la vista de código fuente (servido por msgprint://source). */
let sourceViewHtml = '';
/** Datos de cada ventana de código fuente, por webContents.id. */
const sourceDocs = new Map<
  number,
  { headers: string; body: string; pageHtml: string; baseName: string }
>();

// Formatos de exportación: una sola fuente para "Exportar" y "Guardar como"
// (congruencia). El orden coincide con el del menú y el desplegable.
const EXPORT_FILTERS: Electron.FileFilter[] = [
  { name: 'PDF', extensions: ['pdf'] },
  { name: 'EML', extensions: ['eml'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'HTML', extensions: ['html', 'htm'] },
  { name: 'TXT', extensions: ['txt'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'MHT', extensions: ['mht', 'mhtml'] },
  { name: 'JSON', extensions: ['json'] },
  { name: 'ZIP', extensions: ['zip'] }
];

/** Extensión de archivo → formato de exportación (null si no es un formato). */
function formatFromExtension(ext: string): ExportFormat | null {
  switch (ext.replace('.', '').toLowerCase()) {
    case 'pdf': return 'pdf';
    case 'eml': return 'eml';
    case 'png': return 'png';
    case 'html': case 'htm': return 'html';
    case 'txt': return 'txt';
    case 'md': case 'markdown': return 'md';
    case 'mht': case 'mhtml': return 'mht';
    case 'json': return 'json';
    case 'zip': return 'zip';
    default: return null;
  }
}

/** Genera el archivo de exportación en filePath. Compartida por export/save-as. */
async function exportToPath(
  state: WindowDocument,
  format: ExportFormat,
  filePath: string,
  pngAcceptTruncation: boolean
): Promise<ExportResult> {
  const doc = state.document;
  const locale = app.getLocale();
  switch (format) {
    case 'pdf':
      return exportPdf(doc, filePath);
    case 'eml':
      if (!isCfbf(state.buffer)) {
        // El origen ya es RFC 5322: copia byte a byte.
        await writeFile(filePath, state.buffer);
        return { ok: true, filePath };
      }
      return exportEml(state.buffer, filePath);
    case 'png':
      return exportPng(doc, filePath, pngAcceptTruncation);
    case 'html':
      await writeFile(filePath, buildPrintableHtml(doc, locale), 'utf-8');
      return { ok: true, filePath };
    case 'txt':
      await writeFile(filePath, documentToText(doc), 'utf-8');
      return { ok: true, filePath };
    case 'md':
      await writeFile(filePath, documentToMarkdown(doc), 'utf-8');
      return { ok: true, filePath };
    case 'mht':
      return exportMht(doc, state.buffer, filePath, buildPrintableHtml(doc, locale));
    case 'json':
      await writeFile(filePath, documentToJson(doc), 'utf-8');
      return { ok: true, filePath };
    case 'zip':
      return exportZip(doc, state.buffer, filePath, isCfbf(state.buffer), buildPrintableHtml(doc, locale));
  }
}

// Tests E2E: userData propio para no colisionar con una instancia en uso
// (el lock de instancia única vive en userData).
const customUserData = process.env['MSG_VIEWER_USER_DATA'];
if (customUserData) app.setPath('userData', customUserData);

// Evita el diálogo "Choose password for new keyring" en Linux (GNOME Keyring/
// libsecret). La app es 100% offline y no almacena cookies ni credenciales, así
// que el llavero del sistema no aporta nada; Chromium usa el almacén "basic".
// Debe fijarse antes de que la app esté lista.
app.commandLine.appendSwitch('password-store', 'basic');

// FR-03: instancia única; la segunda invocación entrega su argv a la primera.
const locked = app.requestSingleInstanceLock();
if (!locked) {
  app.quit();
} else {
  bootstrap();
}

function bootstrap(): void {
  // Render por software: evita el crash del proceso GPU en sesiones
  // Wayland/Vulkan problemáticas y reduce huella de memoria (NFR-02).
  app.disableHardwareAcceleration();

  // macOS entrega rutas por evento open-file, incluso antes de ready (FR-01).
  app.on('open-file', (event, path) => {
    event.preventDefault();
    openInMainWindow(path);
  });

  app.on('second-instance', (_event, argv, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const path = msgPathFromArgv(argv, workingDirectory);
    if (path) openInMainWindow(path);
  });

  // El menú habilita exportaciones según el documento de la ventana enfocada.
  app.on('browser-window-focus', (_event, win) => {
    setExportEnabled(docs.has(win.webContents.id));
  });

  protocol.registerSchemesAsPrivileged([
    { scheme: 'msgprint', privileges: { standard: true, secure: true } }
  ]);

  void app.whenReady().then(() => {
    setupNetworkBlocking();
    // Sirve desde memoria el documento imprimible y la vista de código
    // fuente (sin temporales, NFR-04).
    protocol.handle('msgprint', (request) => {
      const host = new URL(request.url).host;
      return new Response(host === 'source' ? sourceViewHtml : getPrintableHtml(), {
        headers: { 'content-type': 'text/html; charset=utf-8' }
      });
    });
    refreshMenu();
    registerIpc();
    mainWindow = createAppWindow(true);

    const path = msgPathFromArgv(process.argv, process.cwd());
    if (path) pendingPath = path;
  });

  app.on('window-all-closed', () => {
    shutdownParser();
    app.quit(); // Sin procesos residentes (NFR-02), también en macOS.
  });

  // Limpieza de los temporales de "Abrir adjunto" (NFR-03: nada persistente).
  app.on('will-quit', () => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // mejor esfuerzo: el SO purga su tmp igualmente
      }
    }
  });
}

/**
 * NFR-03: prohibición de tráfico saliente en capa de sesión. Solo se admite
 * el servidor de desarrollo de Vite cuando existe (modo dev).
 */
function setupNetworkBlocking(): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    const allowed =
      url.startsWith('file://') ||
      url.startsWith('data:') ||
      url.startsWith('msgprint://') ||
      url.startsWith('devtools://') ||
      (devUrl !== undefined && (url.startsWith(devUrl) || url.startsWith('ws://localhost')));
    callback({ cancel: !allowed });
  });
}

function createAppWindow(isMain: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    show: false,
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // el preload necesita webUtils; el renderer sigue aislado
    }
  });

  win.once('ready-to-show', () => win.show());
  // En algunos compositores Wayland ready-to-show no llega a dispararse;
  // sin este fallback la ventana existiría pero nunca se mostraría.
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      console.warn('[msg-viewer] ready-to-show no llegó; mostrando ventana por fallback');
      win.show();
    }
  }, 1200);

  installContextMenu(win);

  const wcId = win.webContents.id;
  win.on('closed', () => {
    docs.delete(wcId);
    if (isMain) mainWindow = null;
  });

  // Tras recarga o en ventanas nuevas, el renderer recupera su documento
  // por pull (get-current-document); nada se empuja antes de ese pull,
  // que es la señal inequívoca de que sus listeners ya existen.

  // Diagnóstico + reintento: una carga inicial fallida (p. ej. el dev server
  // de Vite aún calentando, o un fallo transitorio de red local) dejaría una
  // ventana en blanco permanente.
  let failures = 0;
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return;
    failures++;
    console.warn(`[msg-viewer] did-fail-load code=${code} ${desc} url=${url}`);
    if (win.isDestroyed()) return;
    if (failures === 1) {
      setTimeout(() => {
        if (!win.isDestroyed()) void loadRenderer(win);
      }, 400);
    } else if (failures === 2 && process.env['ELECTRON_RENDERER_URL']) {
      // Dev server caído (p. ej. proceso huérfano): mejor la build local
      // que una ventana en blanco.
      console.warn('[msg-viewer] dev server inaccesible; usando build local');
      void win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
    }
  });

  void loadRenderer(win);
  return win;
}

function loadRenderer(win: BrowserWindow): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  return devUrl
    ? win.loadURL(devUrl)
    : win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

function msgPathFromArgv(argv: string[], cwd: string): string | null {
  const candidate = argv
    .slice(1)
    .find((a) => !a.startsWith('-') && /\.(msg|eml|emlx)$/i.test(a));
  if (!candidate) return null;
  return candidate.startsWith('/') ? candidate : join(cwd, candidate);
}

function openInMainWindow(path: string): void {
  if (mainWindow) {
    void openDocument(path, mainWindow);
  } else {
    pendingPath = path;
  }
}

/** Carga + parseo en worker y entrega a la ventana indicada. */
async function openDocument(filePath: string, win: BrowserWindow): Promise<LoadResult> {
  const result = await parseFile(filePath);
  if (result.ok) {
    try {
      docs.set(win.webContents.id, {
        document: result.document,
        buffer: await readFile(filePath),
        embeddedDepth: 0
      });
    } catch (e) {
      const failed: LoadResult = {
        ok: false,
        error: { code: 'not-found', detail: e instanceof Error ? e.message : String(e) }
      };
      win.webContents.send('document-loaded', failed);
      return failed;
    }
    win.setTitle(`${basename(filePath)} — MSG Viewer`);
    addRecent(filePath);
    refreshMenu();
  }
  setExportEnabled(docs.has(win.webContents.id));
  win.webContents.send('document-loaded', result);
  return result;
}

function refreshMenu(): void {
  installMenu({
    recents: existingRecents(),
    onOpenRecent: (path) => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (win) void openDocument(path, win);
    },
    onClearRecents: () => {
      clearRecents();
      refreshMenu();
    }
  });
  const focused = BrowserWindow.getFocusedWindow();
  setExportEnabled(focused ? docs.has(focused.webContents.id) : false);
}

function registerIpc(): void {
  ipcMain.handle('dialog:open', async (e): Promise<LoadResult | null> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      filters: [{ name: 'Mensajes de correo', extensions: ['msg', 'eml', 'emlx'] }],
      properties: ['openFile']
    });
    const first = filePaths[0];
    if (canceled || !first) return null;
    return openDocument(first, win);
  });

  ipcMain.handle('open-path', (e, path: string): Promise<LoadResult> => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || typeof path !== 'string' || !path) {
      return Promise.resolve({ ok: false, error: { code: 'not-found' } });
    }
    return openDocument(path, win);
  });

  // OBJ-S2: abre un .msg incrustado en una ventana nueva (comparación lado a lado).
  ipcMain.handle('open-embedded', (e, attachmentId: number) =>
    openEmbedded(e.sender.id, attachmentId)
  );

  // Clic en un chip de adjunto: menú nativo Abrir / Guardar (es/en).
  ipcMain.on('attachment-menu', (e, attachmentId: number) => {
    const state = docs.get(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    const meta = state?.document.attachments.find((a) => a.id === attachmentId);
    if (!state || !win || !meta) return;
    const es = app.getLocale().startsWith('es');

    const items: Electron.MenuItemConstructorOptions[] = [];
    if (meta.isEmbeddedMsg) {
      items.push({
        label: es ? 'Abrir mensaje' : 'Open message',
        click: () => void openEmbedded(e.sender.id, attachmentId)
      });
    } else {
      items.push({
        label: es ? 'Abrir' : 'Open',
        click: () => void openAttachmentInTemp(win, state, attachmentId)
      });
    }
    items.push({
      label: es ? 'Guardar como…' : 'Save as…',
      click: () => void saveSingleAttachment(win, state, attachmentId)
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Arrastrar un adjunto fuera de la app: se extrae a un temporal y se inicia
  // el drag nativo, que el SO suelta como archivo en el destino (Dolphin,
  // Finder, un correo nuevo…). La extracción sigue siendo explícita (NFR-03).
  ipcMain.on('attachment-drag', async (e, attachmentId: number) => {
    const state = docs.get(e.sender.id);
    if (!state) return;
    const data = await getAnyAttachment(state.buffer, attachmentId);
    if (!data) return;
    try {
      const dir = await mkdtemp(join(app.getPath('temp'), 'msg-viewer-drag-'));
      tempDirs.add(dir);
      const filePath = join(dir, basename(data.fileName) || 'adjunto');
      await writeFile(filePath, data.content);
      let icon = nativeImage.createFromPath(APP_ICON_PATH);
      if (icon.isEmpty()) icon = nativeImage.createEmpty();
      else icon = icon.resize({ width: 64, height: 64 });
      e.sender.startDrag({ file: filePath, icon });
    } catch {
      // Un fallo de drag no debe romper la ventana; se ignora en silencio.
    }
  });

  // FR-10: extracción de adjuntos solo por acción explícita (NFR-03).
  ipcMain.handle(
    'attachments:save',
    async (e, req: AttachmentSaveRequest): Promise<AttachmentSaveResult> => {
      const state = docs.get(e.sender.id);
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!state || !win) return { ok: false, reason: 'error', detail: 'Sin documento' };
      const targets =
        req.ids && req.ids.length > 0
          ? state.document.attachments.filter((a) => req.ids!.includes(a.id))
          : state.document.attachments.filter((a) => !a.isInline);
      if (targets.length === 0) return { ok: false, reason: 'error', detail: 'Sin adjuntos' };

      try {
        if (targets.length === 1) {
          const target = targets[0]!;
          const { canceled, filePath } = await dialog.showSaveDialog(win, {
            defaultPath: target.fileName
          });
          if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
          const data = await getAnyAttachment(state.buffer, target.id);
          if (!data) return { ok: false, reason: 'error', detail: 'Adjunto ilegible' };
          await writeFile(filePath, data.content);
          return { ok: true, savedPaths: [filePath] };
        }

        // "Guardar todos": carpeta elegida por el usuario (FR-10).
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
          properties: ['openDirectory', 'createDirectory']
        });
        const dir = filePaths[0];
        if (canceled || !dir) return { ok: false, reason: 'cancelled' };
        await mkdir(dir, { recursive: true });
        const saved: string[] = [];
        for (const target of targets) {
          const data = await getAnyAttachment(state.buffer, target.id);
          if (!data) continue;
          const path = join(dir, uniqueName(target.fileName, saved));
          await writeFile(path, data.content);
          saved.push(path);
        }
        return { ok: true, savedPaths: saved };
      } catch (e2) {
        return { ok: false, reason: 'error', detail: e2 instanceof Error ? e2.message : String(e2) };
      }
    }
  );

  // FR-11/12/13: botón → "Guardar como" → generación directa.
  ipcMain.handle('export', async (e, req: ExportRequest): Promise<ExportResult> => {
    const state = docs.get(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!state || !win) return { ok: false, reason: 'error', detail: 'Sin documento' };
    const doc = state.document;
    const base = (doc.metadata.subject || basename(doc.sourcePath, '.msg') || 'mensaje')
      .replace(/[\\/:*?"<>|]/g, '_')
      .slice(0, 120);

    // PNG: comprobar el límite de altura antes de pedir destino (FR-13).
    if (req.format === 'png' && !req.acceptTruncation) {
      const height = await measurePngHeight(doc);
      if (height !== null && height > MAX_PNG_HEIGHT) {
        return { ok: false, reason: 'png-too-tall', contentHeight: height };
      }
    }

    // PNG al portapapeles: sin diálogo de guardado.
    if (req.format === 'png' && req.target === 'clipboard') {
      return exportPngToClipboard(doc, req.acceptTruncation ?? false);
    }

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${base}.${req.format}`,
      filters: [{ name: req.format.toUpperCase(), extensions: [req.format] }]
    });
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' };

    return exportToPath(state, req.format, filePath, req.acceptTruncation ?? false);
  });

  // FR adicional: impresión con diálogo del sistema (menú Archivo).
  ipcMain.handle('print', (e): Promise<ExportResult> => {
    const state = docs.get(e.sender.id);
    if (!state) return Promise.resolve({ ok: false, reason: 'error', detail: 'Sin documento' });
    return printDocument(state.document);
  });

  // "Guardar como": mismos formatos que Exportar (congruencia) + el original.
  ipcMain.handle('save-as', async (e): Promise<ExportResult> => {
    const state = docs.get(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!state || !win) return { ok: false, reason: 'error', detail: 'Sin documento' };
    const sourceName = basename(state.document.sourcePath) || 'mensaje.msg';
    const sourceExt = extname(sourceName).replace('.', '').toLowerCase() || 'msg';
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: sourceName,
      filters: [
        { name: `Original (.${sourceExt})`, extensions: [sourceExt] },
        ...EXPORT_FILTERS
      ]
    });
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
    try {
      const format = formatFromExtension(extname(filePath));
      // PNG en "Guardar como" no pregunta por truncado: se acepta sin más.
      if (format) return await exportToPath(state, format, filePath, true);
      // Extensión del original o desconocida: copia byte a byte del buffer.
      await writeFile(filePath, state.buffer);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  });

  // "Nuevo": descarta el documento de la ventana y vuelve al estado inicial.
  ipcMain.handle('clear-document', (e) => {
    docs.delete(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setTitle('MSG Viewer');
    setExportEnabled(false);
  });

  // Vista de código fuente: cabeceras completas + cuerpo (análisis técnico).
  ipcMain.on('view-source', (e) => {
    const state = docs.get(e.sender.id);
    const parent = BrowserWindow.fromWebContents(e.sender);
    if (!state || !parent) return;
    const es = app.getLocale().startsWith('es');
    const MAX_SHOWN = 2 * 1024 * 1024;

    let headers: string;
    let body: string;
    if (isCfbf(state.buffer)) {
      const parts = MsgAdapter.getEmlParts(state.buffer);
      headers = parts?.transportHeaders ?? '';
      body = parts?.bodyHtml ?? parts?.bodyText ?? '';
    } else {
      const text = state.buffer.toString('utf-8');
      const sep = text.search(/\r?\n\r?\n/);
      headers = sep >= 0 ? text.slice(0, sep) : text;
      body = sep >= 0 ? text.slice(sep).trimStart() : '';
    }
    const truncated = body.length > MAX_SHOWN;
    if (truncated) body = body.slice(0, MAX_SHOWN);

    // Análisis técnico: ruta, autenticación, MAPI crudo y diff de sanitización.
    const hops = parseReceivedChain(headers);
    const auth = parseAuthResults(headers);
    const mapiProps = isCfbf(state.buffer) ? MsgAdapter.getRawProperties(state.buffer) : null;
    let sanitizeRemoved: string[] | null = null;
    const originalHtml = isCfbf(state.buffer)
      ? MsgAdapter.getEmlParts(state.buffer)?.bodyHtml
      : body.trimStart().startsWith('<')
        ? body
        : undefined;
    if (originalHtml) sanitizeRemoved = sanitizeWithReport(originalHtml).removed;

    sourceViewHtml = buildSourceViewHtml({ headers, body, truncated, hops, auth, mapiProps, sanitizeRemoved });

    const win = new BrowserWindow({
      width: 980,
      height: 720,
      autoHideMenuBar: true,
      icon: APP_ICON_PATH,
      title: `${es ? 'Código fuente' : 'Source'} — ${state.document.metadata.subject}`,
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/source.mjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
    sourceDocs.set(win.webContents.id, {
      headers,
      body,
      pageHtml: sourceViewHtml,
      baseName: (state.document.metadata.subject || 'mensaje').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
    });
    const wcId = win.webContents.id;
    win.on('closed', () => sourceDocs.delete(wcId));
    installContextMenu(win);
    win.once('ready-to-show', () => win.show());
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 800);
    void win.loadURL('msgprint://source/index.html');
  });

  // Acciones de la ventana de código fuente.
  ipcMain.on('source-copy', (e, which: 'headers' | 'body' | 'all') => {
    const data = sourceDocs.get(e.sender.id);
    if (!data) return;
    const text =
      which === 'headers' ? data.headers : which === 'body' ? data.body : `${data.headers}\n\n${data.body}`;
    clipboard.writeText(text);
  });

  ipcMain.on('source-copy-text', (_e, text: string) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });

  ipcMain.on('source-print', (e) => {
    e.sender.print({ printBackground: true }, () => {});
  });

  ipcMain.handle('source-export', async (e, format: 'pdf' | 'html' | 'txt'): Promise<ExportResult> => {
    const data = sourceDocs.get(e.sender.id);
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!data || !win) return { ok: false, reason: 'error', detail: 'Sin datos' };
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: `${data.baseName}-source.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (canceled || !filePath) return { ok: false, reason: 'cancelled' };
    try {
      if (format === 'pdf') {
        const pdf = await e.sender.printToPDF({ printBackground: true });
        await writeFile(filePath, pdf);
      } else if (format === 'html') {
        await writeFile(filePath, data.pageHtml, 'utf-8');
      } else {
        await writeFile(filePath, `${data.headers}\n\n${data.body}`, 'utf-8');
      }
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) };
    }
  });

  // Info para el diálogo "Acerca de" in-app (renderer).
  ipcMain.handle('get-app-info', () => ({
    version: app.getVersion(),
    repoUrl: REPO_URL,
    platform: process.platform
  }));

  // Asociación de tipos elegida en el diálogo in-app (FR-01).
  ipcMain.on('associate-types', (e, exts: string[]) => {
    if (!Array.isArray(exts) || exts.length === 0) return;
    void registerFileTypes(exts, BrowserWindow.fromWebContents(e.sender));
  });

  // Abre el enlace externo en el navegador. La confirmación anti-phishing la
  // muestra el renderer (diálogo propio con la URL en una caja, sin deformarse);
  // aquí solo se revalida el protocolo antes de salir del visor.
  ipcMain.on('open-external', (_e, url: string) => {
    if (typeof url !== 'string') return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    void shell.openExternal(url);
  });

  ipcMain.on('show-in-folder', (_e, path: string) => {
    if (typeof path === 'string' && path) shell.showItemInFolder(path);
  });

  // Imágenes remotas bajo demanda: ÚNICA excepción al bloqueo de red (NFR-03),
  // y solo tras consentimiento explícito en el renderer. Se usa el fetch de
  // Node (no la pila de Chromium): no pasa por el filtro de sesión, por eso
  // aquí se revalida protocolo, tipo y tamaño antes de devolver la imagen.
  ipcMain.handle('load-remote-image', async (_e, url: string): Promise<RemoteImageResult> => {
    if (typeof url !== 'string') return { ok: false, reason: 'error' };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: 'error' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, reason: 'error' };
    }
    const MAX_BYTES = 25 * 1024 * 1024;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const resp = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!resp.ok) return { ok: false, reason: 'error' };
      const type = (resp.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!type.startsWith('image/')) return { ok: false, reason: 'not-image' };
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length === 0 || buf.length > MAX_BYTES) return { ok: false, reason: 'too-large' };
      return { ok: true, dataUri: `data:${type};base64,${buf.toString('base64')}` };
    } catch {
      return { ok: false, reason: 'error' };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('get-locale', () => app.getLocale());

  ipcMain.handle('get-current-document', (e): MsgDocument | null => {
    // El pull marca el renderer como listo: es el momento seguro de
    // procesar la ruta recibida por argv/open-file antes de la ventana.
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && win === mainWindow && pendingPath) {
      const path = pendingPath;
      pendingPath = null;
      void openDocument(path, win); // el resultado llegará por push
      return null;
    }
    return docs.get(e.sender.id)?.document ?? null;
  });
}

/** OBJ-S2: parsea el .msg incrustado y lo muestra en una ventana nueva. */
async function openEmbedded(senderWcId: number, attachmentId: number): Promise<LoadResult> {
  const parent = docs.get(senderWcId);
  if (!parent) return { ok: false, error: { code: 'not-found' } };
  if (parent.embeddedDepth >= MAX_EMBEDDED_DEPTH) {
    return { ok: false, error: { code: 'parse-error', detail: 'Profundidad máxima de anidado' } };
  }
  const meta = parent.document.attachments.find((a) => a.id === attachmentId);
  if (!meta?.isEmbeddedMsg) return { ok: false, error: { code: 'not-found' } };
  const inner = await getAnyAttachment(parent.buffer, attachmentId);
  if (!inner) return { ok: false, error: { code: 'parse-error', detail: 'Adjunto ilegible' } };

  const virtualPath = `${parent.document.sourcePath} › ${meta.fileName}`;
  const result = await parseBytes(inner.content, virtualPath);
  if (!result.ok) return result;

  const win = createAppWindow(false);
  docs.set(win.webContents.id, {
    document: result.document,
    buffer: Buffer.from(inner.content),
    embeddedDepth: parent.embeddedDepth + 1
  });
  win.setTitle(`${meta.fileName} — MSG Viewer`);
  // La ventana nueva recoge su documento vía get-current-document al iniciar.
  return result;
}

/**
 * "Abrir" un adjunto: extracción a un temporal propio (acción explícita del
 * usuario, FR-10/NFR-03) + apertura con la app predeterminada del SO.
 * Los temporales se purgan al salir (will-quit).
 */
async function openAttachmentInTemp(
  win: BrowserWindow,
  state: WindowDocument,
  attachmentId: number
): Promise<void> {
  const es = app.getLocale().startsWith('es');
  const data = await getAnyAttachment(state.buffer, attachmentId);
  if (!data) {
    notify(win, es ? 'Adjunto ilegible' : 'Unreadable attachment', undefined, true);
    return;
  }
  try {
    const dir = await mkdtemp(join(app.getPath('temp'), 'msg-viewer-'));
    tempDirs.add(dir);
    const safeName = basename(data.fileName) || 'adjunto';
    const filePath = join(dir, safeName);
    await writeFile(filePath, data.content);
    const errorMsg = await shell.openPath(filePath);
    if (errorMsg) notify(win, errorMsg, undefined, true);
  } catch (err) {
    notify(win, err instanceof Error ? err.message : String(err), undefined, true);
  }
}

/** "Guardar como…" de un único adjunto, con toast de confirmación (UI-06). */
async function saveSingleAttachment(
  win: BrowserWindow,
  state: WindowDocument,
  attachmentId: number
): Promise<void> {
  const es = app.getLocale().startsWith('es');
  const meta = state.document.attachments.find((a) => a.id === attachmentId);
  if (!meta) return;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: meta.fileName
  });
  if (canceled || !filePath) return;
  const data = await getAnyAttachment(state.buffer, attachmentId);
  if (!data) {
    notify(win, es ? 'Adjunto ilegible' : 'Unreadable attachment', undefined, true);
    return;
  }
  try {
    await writeFile(filePath, data.content);
    notify(win, es ? 'Guardado' : 'Saved', filePath);
  } catch (err) {
    notify(win, err instanceof Error ? err.message : String(err), undefined, true);
  }
}

/** Toast en el renderer de la ventana indicada (UI-06). */
function notify(win: BrowserWindow, message: string, path?: string, isError = false): void {
  win.webContents.send('toast', { message, path, isError });
}

function uniqueName(fileName: string, saved: string[]): string {
  const taken = new Set(saved.map((p) => basename(p)));
  if (!taken.has(fileName)) return fileName;
  const ext = extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

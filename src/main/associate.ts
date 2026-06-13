import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { APP_ICON_PATH } from './menu';

const run = promisify(execFile);

/** Tipos de archivo asociables y su MIME. */
const FILE_TYPES = [
  { ext: 'msg', mime: 'application/vnd.ms-outlook', label: 'Outlook (.msg)' },
  { ext: 'eml', mime: 'message/rfc822', label: 'Email estándar (.eml)' },
  { ext: 'emlx', mime: 'application/x-emlx', label: 'Apple Mail (.emlx)' }
] as const;

/**
 * FR-01 bajo demanda: registra esta aplicación como manejador de los tipos
 * de correo elegidos por el usuario.
 *
 * Linux: escribe el .desktop y el MIME a nivel de usuario y fija el
 * predeterminado con xdg-mime (funciona para AppImage, paquete o dev).
 * macOS: la asociación la gestiona LaunchServices; no hay API programática,
 * así que se muestran las instrucciones de Finder.
 */
export function associateMsgFiles(parent: BrowserWindow | null): void {
  const es = app.getLocale().startsWith('es');

  if (process.platform === 'darwin') {
    const opts = {
      type: 'info' as const,
      title: es ? 'Asociar archivos' : 'Associate files',
      message: es ? 'Hazlo desde Finder (una sola vez)' : 'Do it from Finder (one time)',
      detail: es
        ? 'Clic derecho sobre un archivo → Obtener información → "Abrir con" → selecciona MSG Viewer → pulsa "Cambiar todo…".'
        : 'Right-click a file → Get Info → "Open with" → choose MSG Viewer → press "Change All…".'
    };
    if (parent) void dialog.showMessageBox(parent, opts);
    else void dialog.showMessageBox(opts);
    return;
  }

  showSelectionDialog(parent, es);
}

function showSelectionDialog(parent: BrowserWindow | null, es: boolean): void {
  const s = es
    ? {
        title: 'Asociar tipos de archivo',
        intro: 'Elige qué tipos de archivo se abrirán con MSG Viewer al hacer doble clic:',
        confirm: 'Asociar',
        cancel: 'Cancelar'
      }
    : {
        title: 'Associate file types',
        intro: 'Choose which file types open with MSG Viewer on double-click:',
        confirm: 'Associate',
        cancel: 'Cancel'
      };

  const rows = FILE_TYPES.map(
    (t) =>
      `<label><input type="checkbox" value="${t.ext}" checked> ${t.label}</label>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: Canvas; color: CanvasText;
         padding: 22px 26px; font-size: 13px; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  p { margin: 0 0 14px; color: GrayText; }
  label { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  button { font: inherit; padding: 6px 16px; border-radius: 6px; border: 1px solid GrayText;
           background: transparent; color: inherit; cursor: pointer; }
  button.primary { background: Highlight; color: HighlightText; border-color: Highlight; }
</style></head><body>
  <h1>${s.title}</h1>
  <p>${s.intro}</p>
  ${rows}
  <div class="actions">
    <button id="cancel">${s.cancel}</button>
    <button id="ok" class="primary">${s.confirm}</button>
  </div>
  <script>
    document.getElementById('ok').addEventListener('click', function () {
      var exts = Array.prototype.slice
        .call(document.querySelectorAll('input:checked'))
        .map(function (c) { return c.value; });
      window.associateApi.confirm(exts);
    });
    document.getElementById('cancel').addEventListener('click', function () {
      window.associateApi.cancel();
    });
    addEventListener('keydown', function (e) { if (e.key === 'Escape') window.associateApi.cancel(); });
  </script>
</body></html>`;

  const win = new BrowserWindow({
    width: 380,
    height: 290,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: s.title,
    modal: parent !== null,
    parent: parent ?? undefined,
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/associate.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  const cleanup = () => {
    ipcMain.removeListener('associate-confirm', onConfirm);
    ipcMain.removeListener('associate-cancel', onCancel);
  };
  const onConfirm = (e: Electron.IpcMainEvent, exts: string[]) => {
    if (e.sender !== win.webContents) return;
    cleanup();
    if (!win.isDestroyed()) win.close();
    if (Array.isArray(exts) && exts.length > 0) void registerTypes(exts, parent);
  };
  const onCancel = (e: Electron.IpcMainEvent) => {
    if (e.sender !== win.webContents) return;
    cleanup();
    if (!win.isDestroyed()) win.close();
  };
  ipcMain.on('associate-confirm', onConfirm);
  ipcMain.on('associate-cancel', onCancel);
  win.on('closed', cleanup);

  win.once('ready-to-show', () => win.show());
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 800);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

async function registerTypes(exts: string[], win: BrowserWindow | null): Promise<void> {
  const es = app.getLocale().startsWith('es');
  const types = FILE_TYPES.filter((t) => exts.includes(t.ext));
  const home = homedir();
  const appsDir = join(home, '.local', 'share', 'applications');
  const mimeDir = join(home, '.local', 'share', 'mime', 'packages');
  const iconDir = join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');

  const appImage = process.env['APPIMAGE'];
  const execLine = appImage
    ? `"${appImage}" %U`
    : app.isPackaged
      ? `"${process.execPath}" %U`
      : `"${process.execPath}" "${app.getAppPath()}" %U`;

  // En desarrollo, identidad separada: no pisar al .desktop del paquete.
  const isDev = !app.isPackaged && !appImage;
  const desktopId = isDev ? 'msg-viewer-dev.desktop' : 'msg-viewer.desktop';
  const mimeList = types.map((t) => t.mime).join(';');
  const desktop = `[Desktop Entry]
Name=MSG Viewer${isDev ? ' (dev)' : ''}
Comment=Visor de archivos de correo (.msg/.eml/.emlx)
Exec=${execLine}
Terminal=false
Type=Application
Icon=msg-viewer
StartupWMClass=msg-viewer
MimeType=${mimeList};
Categories=Office;
`;

  // Solo se declara el glob de los MIME propios (no de message/rfc822, estándar).
  const customMimes = types.filter((t) => t.mime.startsWith('application/'));
  const mimeXml = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
${customMimes
  .map(
    (t) =>
      `  <mime-type type="${t.mime}">\n    <comment>${t.label}</comment>\n    <glob pattern="*.${t.ext}"/>\n  </mime-type>`
  )
  .join('\n')}
</mime-info>
`;

  const notify = (message: string, isError = false) =>
    win?.webContents.send('toast', { message, isError });

  try {
    await mkdir(appsDir, { recursive: true });
    await mkdir(mimeDir, { recursive: true });
    await mkdir(iconDir, { recursive: true });
    await writeFile(join(appsDir, desktopId), desktop, 'utf-8');
    if (customMimes.length > 0) {
      await writeFile(join(mimeDir, 'msg-viewer.xml'), mimeXml, 'utf-8');
    }
    await copyFile(APP_ICON_PATH, join(iconDir, 'msg-viewer.png')).catch(() => {});

    await run('update-mime-database', [join(home, '.local', 'share', 'mime')]).catch(() => {});
    await run('update-desktop-database', [appsDir]).catch(() => {});
    for (const t of types) {
      await run('xdg-mime', ['default', desktopId, t.mime]).catch(() => {});
    }

    const list = types.map((t) => `.${t.ext}`).join(', ');
    notify(
      es ? `Listo: ${list} se abrirán con MSG Viewer` : `Done: ${list} will now open with MSG Viewer`
    );
  } catch (e) {
    notify(
      `${es ? 'No se pudo asociar' : 'Could not associate'}: ${e instanceof Error ? e.message : String(e)}`,
      true
    );
  }
}

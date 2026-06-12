import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { associateMsgFiles } from './associate';
import type { ExportFormat } from '@shared/types';

/**
 * Menú de aplicación: Abrir, exportaciones e impresión con aceleradores
 * (NFR-10). Las acciones se delegan al renderer (canal 'menu-action'), que
 * posee el flujo completo (diálogo PNG demasiado alto, toasts, estados).
 */

export type MenuAction =
  | { type: 'open' }
  | { type: 'export'; format: ExportFormat }
  | { type: 'print' };

/** Repositorio del proyecto (menú Ayuda). */
const REPO_URL = 'https://github.com/oscarhenriquezg/msgview';

/** Raíz del proyecto en dev y resources/app empaquetado (asar deshabilitado). */
export const APP_ICON_PATH = join(app.getAppPath(), 'build', 'icon.png');

const STRINGS = {
  es: {
    file: 'Archivo',
    open: 'Abrir…',
    exportPdf: 'Exportar a PDF…',
    exportEml: 'Exportar a EML…',
    exportPng: 'Exportar a PNG…',
    print: 'Imprimir…',
    associate: 'Asociar archivos .msg a esta aplicación…',
    quit: 'Salir',
    edit: 'Edición',
    copy: 'Copiar',
    selectAll: 'Seleccionar todo',
    view: 'Ver',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    resetZoom: 'Tamaño real',
    window: 'Ventana',
    minimize: 'Minimizar',
    maximize: 'Maximizar / Restaurar',
    close: 'Cerrar',
    help: 'Ayuda',
    github: 'Proyecto en GitHub',
    about: 'Acerca de MSG Viewer',
    aboutDetail:
      'Visor ligero y 100% offline de archivos .msg de Outlook para Linux y macOS.\n' +
      'Tu correo nunca sale de tu equipo: sin red, sin telemetría, sin nubes.\n\n' +
      '© 2026 Oscar Henríquez · Licencia MIT',
    eggTitle: '🐣 ¡Lo encontraste!',
    eggMessage: 'Dato friki',
    eggDetail:
      'Cada archivo .msg es en realidad un mini sistema de archivos de 1991 ' +
      '(CFBF): con sectores, directorios y hasta su propia FAT… dentro de un correo.\n\n' +
      'Técnicamente, llevas años recibiendo disquetes disfrazados de emails. 💾',
    eggOk: 'Jaja, vale',
    closeBtn: 'Cerrar'
  },
  en: {
    file: 'File',
    open: 'Open…',
    exportPdf: 'Export to PDF…',
    exportEml: 'Export to EML…',
    exportPng: 'Export to PNG…',
    print: 'Print…',
    associate: 'Associate .msg files with this app…',
    quit: 'Quit',
    edit: 'Edit',
    copy: 'Copy',
    selectAll: 'Select all',
    view: 'View',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Actual size',
    window: 'Window',
    minimize: 'Minimize',
    maximize: 'Maximize / Restore',
    close: 'Close',
    help: 'Help',
    github: 'Project on GitHub',
    about: 'About MSG Viewer',
    aboutDetail:
      'Lightweight, 100% offline viewer for Outlook .msg files on Linux and macOS.\n' +
      'Your mail never leaves your machine: no network, no telemetry, no clouds.\n\n' +
      '© 2026 Oscar Henríquez · MIT License',
    eggTitle: '🐣 You found it!',
    eggMessage: 'Nerd fact',
    eggDetail:
      'Every .msg file is actually a tiny 1991 filesystem (CFBF): sectors, ' +
      'directories and even its own FAT… inside an email.\n\n' +
      "Technically, you've been receiving floppy disks disguised as emails for years. 💾",
    eggOk: 'Haha, OK',
    closeBtn: 'Close'
  }
};

function L(): (typeof STRINGS)['es'] {
  return app.getLocale().startsWith('es') ? STRINGS.es : STRINGS.en;
}

function sendToFocused(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send('menu-action', action);
}

/**
 * Acerca de: ventana propia (los diálogos nativos no permiten capturar
 * clics en el icono). El easter egg vive tras un clic en el icono.
 */
function showAbout(parent: BrowserWindow | null): void {
  const s = L();
  const esc = (x: string) =>
    x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
  let iconSrc = '';
  try {
    iconSrc = `data:image/png;base64,${readFileSync(APP_ICON_PATH).toString('base64')}`;
  } catch {
    // sin icono: el emoji de respaldo del HTML hace de sustituto
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font-family: system-ui, sans-serif; text-align:center;
         padding: 26px 30px; background: Canvas; color: CanvasText; }
  .icon { width:96px; height:96px; cursor:pointer; transition: transform .15s; user-select:none; }
  .icon:hover { transform: scale(1.06) rotate(-3deg); }
  h1 { font-size:17px; margin: 10px 0 2px; }
  .ver { color: GrayText; font-size: 12px; margin-bottom: 12px; }
  p { font-size: 12.5px; line-height: 1.5; margin: 0 0 14px; }
  #egg { display:none; background: rgba(127,127,127,.12); border-radius: 10px;
         padding: 12px 14px; font-size: 12.5px; line-height:1.5; text-align:left; }
  #egg.show { display:block; animation: pop .25s ease-out; }
  #egg b { display:block; margin-bottom: 4px; }
  @keyframes pop { from { transform: scale(.85); opacity:0; } to { transform:none; opacity:1; } }
  button { font:inherit; font-size:12.5px; margin-top:14px; padding:5px 18px;
           border-radius:6px; border:1px solid GrayText; background:transparent;
           color:inherit; cursor:pointer; }
</style></head><body>
  ${iconSrc ? `<img id="i" class="icon" src="${iconSrc}" alt="">` : `<div id="i" class="icon" style="font-size:72px">✉️</div>`}
  <h1>MSG Viewer</h1>
  <div class="ver">v${app.getVersion()}</div>
  <p>${esc(s.aboutDetail)}</p>
  <div id="egg"><b>${esc(s.eggTitle)} — ${esc(s.eggMessage)}</b>${esc(s.eggDetail)}</div>
  <button onclick="window.close()">${esc(s.closeBtn)}</button>
  <script>
    document.getElementById('i').addEventListener('click', () =>
      document.getElementById('egg').classList.add('show'));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });
  </script>
</body></html>`;

  const win = new BrowserWindow({
    width: 430,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    title: s.about,
    modal: parent !== null,
    parent: parent ?? undefined,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.once('ready-to-show', () => win.show());
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 800);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function installMenu(): void {
  const s = L();
  const isMac = process.platform === 'darwin';
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL']);

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: s.file,
      submenu: [
        {
          label: s.open,
          accelerator: 'CmdOrCtrl+O',
          click: () => sendToFocused({ type: 'open' })
        },
        { type: 'separator' },
        {
          id: 'export-pdf',
          label: s.exportPdf,
          accelerator: 'CmdOrCtrl+Shift+P',
          enabled: false,
          click: () => sendToFocused({ type: 'export', format: 'pdf' })
        },
        {
          id: 'export-eml',
          label: s.exportEml,
          accelerator: 'CmdOrCtrl+Shift+E',
          enabled: false,
          click: () => sendToFocused({ type: 'export', format: 'eml' })
        },
        {
          id: 'export-png',
          label: s.exportPng,
          accelerator: 'CmdOrCtrl+Shift+G',
          enabled: false,
          click: () => sendToFocused({ type: 'export', format: 'png' })
        },
        { type: 'separator' },
        {
          id: 'print',
          label: s.print,
          accelerator: 'CmdOrCtrl+P',
          enabled: false,
          click: () => sendToFocused({ type: 'print' })
        },
        { type: 'separator' },
        {
          label: s.associate,
          click: (_item, win) =>
            void associateMsgFiles(win instanceof BrowserWindow ? win : null)
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const, label: s.quit }
      ]
    },
    {
      // Visor de solo lectura: solo tienen sentido Copiar y Seleccionar todo.
      label: s.edit,
      submenu: [
        { role: 'copy', label: s.copy },
        { role: 'selectAll', label: s.selectAll }
      ]
    },
    {
      label: s.view,
      submenu: [
        { role: 'zoomIn', label: s.zoomIn },
        { role: 'zoomOut', label: s.zoomOut },
        { role: 'resetZoom', label: s.resetZoom },
        // Solo en desarrollo y sin presencia visible (confunden al usuario):
        // accesibles por atajo para depurar.
        ...(isDev
          ? ([
              { role: 'reload', visible: false },
              { role: 'toggleDevTools', visible: false, accelerator: 'F12' }
            ] as const)
          : [])
      ]
    },
    {
      label: s.window,
      submenu: [
        { role: 'minimize', label: s.minimize },
        {
          label: s.maximize,
          click: (_item, win) => {
            if (!win || !(win instanceof BrowserWindow)) return;
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
          }
        },
        { role: 'close', label: s.close }
      ]
    },
    {
      label: s.help,
      submenu: [
        {
          label: s.github,
          click: () => void shell.openExternal(REPO_URL)
        },
        { type: 'separator' },
        {
          label: s.about,
          click: (_item, win) =>
            void showAbout(win instanceof BrowserWindow ? win : null)
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Menú contextual del cuerpo del mensaje: copiar texto seleccionado o imagen.
 * Se registra a nivel de webContents, por lo que cubre también el iframe.
 */
export function installContextMenu(win: BrowserWindow): void {
  const es = app.getLocale().startsWith('es');
  win.webContents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];
    if (params.selectionText.trim()) {
      items.push({
        label: es ? 'Copiar' : 'Copy',
        accelerator: 'CmdOrCtrl+C',
        click: () => win.webContents.copy()
      });
    }
    if (params.mediaType === 'image') {
      items.push({
        label: es ? 'Copiar imagen' : 'Copy image',
        click: () => win.webContents.copyImageAt(params.x, params.y)
      });
    }
    if (items.length > 0) items.push({ type: 'separator' });
    items.push({
      label: es ? 'Seleccionar todo' : 'Select all',
      accelerator: 'CmdOrCtrl+A',
      click: () => win.webContents.selectAll()
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

/** Habilita exportaciones e impresión solo con un documento cargado. */
export function setExportEnabled(enabled: boolean): void {
  const menu = Menu.getApplicationMenu();
  for (const id of ['export-pdf', 'export-eml', 'export-png', 'print']) {
    const item = menu?.getMenuItemById(id);
    if (item) item.enabled = enabled;
  }
}

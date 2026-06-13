import { basename, join } from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import type { ExportFormat } from '@shared/types';

/**
 * Menú de aplicación: Abrir, exportaciones e impresión con aceleradores
 * (NFR-10). Las acciones se delegan al renderer (canal 'menu-action'), que
 * posee el flujo completo (diálogo PNG demasiado alto, toasts, estados).
 */

export type MenuAction =
  | { type: 'open' }
  | { type: 'export'; format: ExportFormat }
  | { type: 'print' }
  | { type: 'find' }
  | { type: 'save-as' }
  | { type: 'zoom'; delta: number }
  | { type: 'source' }
  | { type: 'about' }
  | { type: 'associate' }
  | { type: 'copy-meta'; as: 'text' | 'json' };

export interface MenuOptions {
  recents: string[];
  onOpenRecent: (path: string) => void;
  onClearRecents: () => void;
}

/** Repositorio del proyecto (menú Ayuda y diálogo "Acerca de"). */
export const REPO_URL = 'https://github.com/oscarhenriquezg/msgview';

/** Raíz del proyecto en dev y resources/app empaquetado (asar deshabilitado). */
export const APP_ICON_PATH = join(app.getAppPath(), 'build', 'icon.png');

const STRINGS = {
  es: {
    file: 'Archivo',
    open: 'Abrir…',
    export: 'Exportar',
    exportPdf: 'Exportar a PDF…',
    exportEml: 'Exportar a EML…',
    exportPng: 'Exportar a PNG…',
    exportHtml: 'Exportar a HTML…',
    exportTxt: 'Exportar a TXT…',
    exportMd: 'Exportar a Markdown…',
    exportMht: 'Exportar a MHT (web)…',
    exportJson: 'Exportar a JSON…',
    exportZip: 'Exportar a ZIP (con adjuntos)…',
    print: 'Imprimir…',
    saveAs: 'Guardar como…',
    associate: 'Asociar tipos de archivo…',
    recents: 'Recientes',
    noRecents: '(vacío)',
    clearRecents: 'Limpiar recientes',
    quit: 'Salir',
    edit: 'Edición',
    copy: 'Copiar',
    selectAll: 'Seleccionar todo',
    find: 'Buscar en el mensaje…',
    copyMeta: 'Copiar metadatos del mensaje',
    copyMetaJson: 'Copiar metadatos como JSON',
    view: 'Ver',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    resetZoom: 'Tamaño real',
    source: 'Ver código fuente del mensaje',
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
      '© 2026 Oscar Henríquez · Licencia GPL-3.0',
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
    export: 'Export',
    exportPdf: 'Export to PDF…',
    exportEml: 'Export to EML…',
    exportPng: 'Export to PNG…',
    exportHtml: 'Export to HTML…',
    exportTxt: 'Export to TXT…',
    exportMd: 'Export to Markdown…',
    exportMht: 'Export to MHT (web)…',
    exportJson: 'Export to JSON…',
    exportZip: 'Export to ZIP (with attachments)…',
    print: 'Print…',
    saveAs: 'Save as…',
    associate: 'Associate file types…',
    recents: 'Recent files',
    noRecents: '(empty)',
    clearRecents: 'Clear recents',
    quit: 'Quit',
    edit: 'Edit',
    copy: 'Copy',
    selectAll: 'Select all',
    find: 'Find in message…',
    copyMeta: 'Copy message metadata',
    copyMetaJson: 'Copy metadata as JSON',
    view: 'View',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Actual size',
    source: 'View message source',
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
      '© 2026 Oscar Henríquez · GPL-3.0 License',
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


export function installMenu(opts: MenuOptions): void {
  const s = L();
  const recentsSubmenu: Electron.MenuItemConstructorOptions[] =
    opts.recents.length === 0
      ? [{ label: s.noRecents, enabled: false }]
      : [
          ...opts.recents.map((p) => ({
            label: basename(p),
            sublabel: p,
            click: () => opts.onOpenRecent(p)
          })),
          { type: 'separator' as const },
          { label: s.clearRecents, click: () => opts.onClearRecents() }
        ];
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
        { label: s.recents, submenu: recentsSubmenu },
        {
          id: 'save-as',
          label: s.saveAs,
          accelerator: 'CmdOrCtrl+S',
          enabled: false,
          click: () => sendToFocused({ type: 'save-as' })
        },
        {
          id: 'export',
          label: s.export,
          submenu: [
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
            {
              id: 'export-html',
              label: s.exportHtml,
              accelerator: 'CmdOrCtrl+Shift+H',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'html' })
            },
            {
              id: 'export-txt',
              label: s.exportTxt,
              accelerator: 'CmdOrCtrl+Shift+T',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'txt' })
            },
            {
              id: 'export-md',
              label: s.exportMd,
              accelerator: 'CmdOrCtrl+Shift+D',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'md' })
            },
            {
              id: 'export-mht',
              label: s.exportMht,
              accelerator: 'CmdOrCtrl+Shift+M',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'mht' })
            },
            {
              id: 'export-json',
              label: s.exportJson,
              accelerator: 'CmdOrCtrl+Shift+J',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'json' })
            },
            {
              id: 'export-zip',
              label: s.exportZip,
              accelerator: 'CmdOrCtrl+Shift+Z',
              enabled: false,
              click: () => sendToFocused({ type: 'export', format: 'zip' })
            }
          ]
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
          click: () => sendToFocused({ type: 'associate' })
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
        { role: 'selectAll', label: s.selectAll },
        { type: 'separator' },
        {
          label: s.find,
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToFocused({ type: 'find' })
        },
        { type: 'separator' },
        {
          id: 'copy-meta',
          label: s.copyMeta,
          accelerator: 'CmdOrCtrl+Shift+C',
          enabled: false,
          click: () => sendToFocused({ type: 'copy-meta', as: 'text' })
        },
        {
          id: 'copy-meta-json',
          label: s.copyMetaJson,
          enabled: false,
          click: () => sendToFocused({ type: 'copy-meta', as: 'json' })
        }
      ]
    },
    {
      label: s.view,
      submenu: [
        // El zoom afecta solo al cuerpo del mensaje (no a toda la ventana).
        {
          label: s.zoomIn,
          accelerator: 'CmdOrCtrl+Plus',
          click: () => sendToFocused({ type: 'zoom', delta: 1 })
        },
        {
          label: s.zoomOut,
          accelerator: 'CmdOrCtrl+-',
          click: () => sendToFocused({ type: 'zoom', delta: -1 })
        },
        {
          label: s.resetZoom,
          accelerator: 'CmdOrCtrl+0',
          click: () => sendToFocused({ type: 'zoom', delta: 0 })
        },
        { type: 'separator' },
        {
          id: 'view-source',
          label: s.source,
          enabled: false,
          click: () => sendToFocused({ type: 'source' })
        },
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
          click: () => sendToFocused({ type: 'about' })
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
  for (const id of [
    'export-pdf',
    'export-eml',
    'export-png',
    'export-html',
    'export-txt',
    'export-md',
    'export-mht',
    'export-json',
    'export-zip',
    'print',
    'copy-meta',
    'copy-meta-json',
    'save-as',
    'view-source'
  ]) {
    const item = menu?.getMenuItemById(id);
    if (item) item.enabled = enabled;
  }
}

import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog } from 'electron';
import { APP_ICON_PATH } from './menu';

const run = promisify(execFile);

/**
 * FR-01 bajo demanda: registra esta aplicación como manejador de .msg.
 *
 * Linux: escribe el .desktop y el MIME a nivel de usuario y fija el
 * predeterminado con xdg-mime (funciona para AppImage, paquete o dev).
 * macOS: la asociación la gestiona LaunchServices vía Info.plist; no hay
 * API programática, así que se muestran las instrucciones de Finder.
 */
export async function associateMsgFiles(win: BrowserWindow | null): Promise<void> {
  const es = app.getLocale().startsWith('es');

  if (process.platform === 'darwin') {
    const opts = {
      type: 'info' as const,
      title: es ? 'Asociar archivos .msg' : 'Associate .msg files',
      message: es ? 'Hazlo desde Finder (una sola vez)' : 'Do it from Finder (one time)',
      detail: es
        ? 'Clic derecho sobre un archivo .msg → Obtener información → "Abrir con" → selecciona MSG Viewer → pulsa "Cambiar todo…".'
        : 'Right-click a .msg file → Get Info → "Open with" → choose MSG Viewer → press "Change All…".'
    };
    if (win) await dialog.showMessageBox(win, opts);
    else await dialog.showMessageBox(opts);
    return;
  }

  const home = homedir();
  const appsDir = join(home, '.local', 'share', 'applications');
  const mimeDir = join(home, '.local', 'share', 'mime', 'packages');
  const iconDir = join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps');

  // Línea Exec según cómo corre la app: AppImage, instalada o desarrollo.
  const appImage = process.env['APPIMAGE'];
  const execLine = appImage
    ? `"${appImage}" %U`
    : app.isPackaged
      ? `"${process.execPath}" %U`
      : `"${process.execPath}" "${app.getAppPath()}" %U`;

  // En desarrollo, identidad separada: jamás debe pisar al .desktop del
  // paquete instalado (mismo nombre = el de usuario gana y rompe el doble clic).
  const isDev = !app.isPackaged && !appImage;
  const desktopId = isDev ? 'msg-viewer-dev.desktop' : 'msg-viewer.desktop';
  const desktop = `[Desktop Entry]
Name=MSG Viewer${isDev ? ' (dev)' : ''}
Comment=Visor de archivos .msg de Outlook
Exec=${execLine}
Terminal=false
Type=Application
Icon=msg-viewer
StartupWMClass=msg-viewer
MimeType=application/vnd.ms-outlook;
Categories=Office;
`;

  const mimeXml = `<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/vnd.ms-outlook">
    <comment>Outlook message</comment>
    <glob pattern="*.msg"/>
  </mime-type>
</mime-info>
`;

  const notify = (message: string, isError = false) =>
    win?.webContents.send('toast', { message, isError });

  try {
    await mkdir(appsDir, { recursive: true });
    await mkdir(mimeDir, { recursive: true });
    await mkdir(iconDir, { recursive: true });
    await writeFile(join(appsDir, desktopId), desktop, 'utf-8');
    await writeFile(join(mimeDir, 'msg-viewer.xml'), mimeXml, 'utf-8');
    await copyFile(APP_ICON_PATH, join(iconDir, 'msg-viewer.png')).catch(() => {});

    // Best-effort: refrescar bases de datos (pueden no existir en sistemas mínimos).
    await run('update-mime-database', [join(home, '.local', 'share', 'mime')]).catch(() => {});
    await run('update-desktop-database', [appsDir]).catch(() => {});
    // Este es el paso decisivo:
    await run('xdg-mime', ['default', desktopId, 'application/vnd.ms-outlook']);

    notify(
      es
        ? 'Listo: los archivos .msg se abrirán con MSG Viewer'
        : 'Done: .msg files will now open with MSG Viewer'
    );
  } catch (e) {
    notify(
      `${es ? 'No se pudo asociar' : 'Could not associate'}: ${e instanceof Error ? e.message : String(e)}`,
      true
    );
  }
}

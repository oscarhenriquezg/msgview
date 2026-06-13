import { execFile } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow } from 'electron';
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
 * de correo elegidos por el usuario (Linux). La selección la hace el usuario
 * en el diálogo in-app del renderer; aquí solo se realiza el registro.
 *
 * Linux: escribe el .desktop y el MIME a nivel de usuario y fija el
 * predeterminado con xdg-mime (funciona para AppImage, paquete o dev).
 */
export async function registerFileTypes(exts: string[], win: BrowserWindow | null): Promise<void> {
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

/**
 * Extensiones de adjuntos que pueden ejecutar código (ejecutables y scripts).
 * Se usa tanto en el renderer (icono de aviso en el chip) como en main
 * (advertencia explícita antes de abrir o guardar). Lista deliberadamente
 * amplia y multiplataforma; ante la duda, avisar.
 */
export const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows: binarios y contenedores ejecutables
  '.exe', '.msi', '.msix', '.msp', '.com', '.scr', '.pif', '.bat', '.cmd',
  '.hta', '.cpl', '.msc', '.scf', '.lnk', '.inf', '.reg', '.gadget',
  '.application', '.jar',
  // Windows Script Host / PowerShell y otros scripts
  '.vb', '.vbs', '.vbe', '.js', '.jse', '.ws', '.wsf', '.wsc', '.wsh',
  '.ps1', '.psm1', '.psd1', '.ps1xml', '.ps2', '.psc1', '.msh', '.msh1',
  '.msh2', '.mshxml', '.sct', '.jnlp',
  // macOS
  '.app', '.dmg', '.pkg', '.mpkg', '.command', '.action', '.workflow',
  '.osx', '.scpt', '.scptd',
  // Linux / Unix
  '.sh', '.bash', '.zsh', '.ksh', '.csh', '.run', '.bin', '.out', '.elf',
  '.deb', '.rpm', '.appimage', '.ko', '.so',
  // Intérpretes multiplataforma / paquetes de app
  '.py', '.pyc', '.pyo', '.pyw', '.pl', '.rb', '.php', '.class', '.war',
  '.apk', '.ipa'
]);

/** ¿La extensión (con o sin punto, cualquier caja) es de un ejecutable/script? */
export function isExecutableAttachment(extension: string): boolean {
  if (!extension) return false;
  const ext = extension.toLowerCase();
  return EXECUTABLE_EXTENSIONS.has(ext.startsWith('.') ? ext : `.${ext}`);
}

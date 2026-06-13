/**
 * Una dirección utilizable es SMTP: contiene '@' y no es un DN X.500 de
 * Exchange (`/o=ExchangeLabs/.../cn=...`). El DN nunca debe mostrarse ni
 * exportarse; si no hay SMTP disponible, se devuelve cadena vacía y queda
 * solo el nombre para mostrar.
 */
export function isUsableSmtp(value: string | undefined | null): boolean {
  return Boolean(value && value.includes('@') && !value.startsWith('/'));
}

/** Primera candidata con forma SMTP; '' si solo hay DN o nada. */
export function bestSmtpAddress(...candidates: (string | undefined | null)[]): string {
  for (const c of candidates) {
    if (isUsableSmtp(c)) return c!.trim();
  }
  return '';
}

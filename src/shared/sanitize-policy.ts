import { homographRisk } from './homograph';

/**
 * Política de sanitización del HTML del correo (FR-08, §7.3), COMPARTIDA por:
 *  - el renderer, que sanitiza con el DOM nativo antes de pintar el cuerpo
 *    (DOMPurify funciona de forma robusta sobre un DOM real); y
 *  - el main, que la reutiliza para la vista de código fuente (qué se eliminó).
 * Mantener una sola fuente de verdad evita que ambas rutas diverjan.
 *
 * Tipos estructurales (no DOM): este módulo vive en src/shared y se compila
 * tanto bajo el proyecto node (sin lib DOM) como bajo el web, así que no puede
 * depender de los tipos globales de DOM.
 */

export interface SanitizeNode {
  tagName?: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
}

export interface Purifier {
  addHook(entryPoint: string, hook: (node: SanitizeNode) => void): void;
  sanitize(dirty: string, cfg: Record<string, unknown>): string;
}

/** Placeholder SVG inline para imágenes remotas bloqueadas (L-03). */
const REMOTE_IMG_PLACEHOLDER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110" viewBox="0 0 160 110">` +
      `<rect width="160" height="110" fill="#e8e8e8" stroke="#bbb" stroke-dasharray="4"/>` +
      `<text x="80" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#888">Imagen remota</text>` +
      `<text x="80" y="58" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#888">bloqueada</text>` +
      `<text x="80" y="82" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#3b82f6">Clic para cargar</text>` +
      `</svg>`
  );

/** Instala los hooks de política sobre una instancia de DOMPurify. */
export function installSanitizeHooks(purifier: Purifier): void {
  purifier.addHook('afterSanitizeAttributes', (node) => {
    // L-03: las imágenes remotas no se cargan; placeholder visible.
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') ?? '';
      if (/^(https?|ftp):/i.test(src)) {
        node.setAttribute('data-blocked-src', src);
        node.setAttribute('src', REMOTE_IMG_PLACEHOLDER);
        node.setAttribute('title', src);
      }
    }
    // Atributos background= heredados de HTML antiguo de Outlook.
    if (node.hasAttribute('background')) {
      const bg = node.getAttribute('background') ?? '';
      if (!/^data:/i.test(bg)) node.removeAttribute('background');
    }
    // Los enlaces no deben navegar dentro del iframe sandbox.
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noreferrer noopener');
      node.setAttribute('target', '_blank');
      // Homografía IDN: si el host real imita letras latinas con otra escritura,
      // se anota el host decodificado para que el visor avise (data-homograph).
      try {
        const { hostname } = new URL(node.getAttribute('href') ?? '');
        const { risk, decoded } = homographRisk(hostname);
        if (risk) node.setAttribute('data-homograph', decoded);
      } catch {
        // href relativo o inválido: nada que analizar.
      }
    }
  });
}

/** Opciones de DOMPurify para el cuerpo de un correo. */
export const SANITIZE_OPTIONS: Record<string, unknown> = {
  WHOLE_DOCUMENT: true,
  // El correo puede traer <style>; el iframe aísla su alcance (FR-08).
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'base', 'link', 'meta'],
  FORBID_ATTR: ['srcset', 'formaction', 'ping'],
  ALLOW_DATA_ATTR: false,
  // data: solo tiene sentido para imágenes; DOMPurify ya lo restringe así.
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z+.-]|[a-z+.-]*(?:[^a-z+.:-]|$))/i
};

/** Sanitiza el HTML de un correo con la política compartida. */
export function sanitizeEmailHtml(purifier: Purifier, html: string): string {
  return purifier.sanitize(html, SANITIZE_OPTIONS);
}

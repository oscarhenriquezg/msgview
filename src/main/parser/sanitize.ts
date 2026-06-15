import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * Sanitización del HTML del correo en el proceso main (FR-08, §7.3).
 * El renderer recibe HTML ya sanitizado; el iframe sandbox + CSP son las
 * capas adicionales (defensa en profundidad).
 */

const window = new JSDOM('').window;
const purifier = createDOMPurify(window);

/** Placeholder SVG inline para imágenes remotas bloqueadas (L-03). */
const REMOTE_IMG_PLACEHOLDER =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="110" viewBox="0 0 160 110">` +
      `<rect width="160" height="110" fill="#e8e8e8" stroke="#bbb" stroke-dasharray="4"/>` +
      `<text x="80" y="42" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#888">Imagen remota</text>` +
      `<text x="80" y="58" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#888">bloqueada</text>` +
      `<text x="80" y="82" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#3b82f6">Clic para cargar</text>` +
      `</svg>`
  ).toString('base64');

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
  }
});

/**
 * Sanitiza e informa qué se eliminó (vista de código fuente: evidencia de
 * lo que el correo intentaba ejecutar). DOMPurify expone `removed`.
 */
export function sanitizeWithReport(html: string): { clean: string; removed: string[] } {
  const clean = sanitizeEmailHtml(html);
  const removed = purifier.removed.map((entry) => {
    const e = entry as { element?: Element; attribute?: Attr | null; from?: Element };
    if (e.element) {
      const snippet = (e.element.outerHTML ?? String(e.element)).slice(0, 160);
      return `<${e.element.tagName?.toLowerCase() ?? '?'}> — ${snippet}`;
    }
    if (e.attribute) {
      const from = e.from?.tagName?.toLowerCase() ?? '?';
      const value = String(e.attribute.value ?? '').slice(0, 120);
      return `${e.attribute.name} en <${from}>${value ? ` — "${value}"` : ''}`;
    }
    return JSON.stringify(entry).slice(0, 160);
  });
  return { clean, removed };
}

export function sanitizeEmailHtml(html: string): string {
  return purifier.sanitize(html, {
    WHOLE_DOCUMENT: true,
    // El correo puede traer <style>; el iframe aísla su alcance (FR-08).
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'base', 'link', 'meta'],
    FORBID_ATTR: ['srcset', 'formaction', 'ping'],
    ALLOW_DATA_ATTR: false,
    // data: solo tiene sentido para imágenes; DOMPurify ya lo restringe así.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z+.-]|[a-z+.-]*(?:[^a-z+.:-]|$))/i
  });
}

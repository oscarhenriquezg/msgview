import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { installSanitizeHooks, sanitizeEmailHtml as runSanitize, type Purifier } from '@shared/sanitize-policy';

/**
 * Sanitización en el proceso main, SOLO para la vista de código fuente
 * (qué intentó ejecutar el correo: DOMPurify expone `removed`). El cuerpo que
 * se muestra lo sanitiza el renderer con DOM nativo; esto se importa de forma
 * diferida (perf) y por eso jsdom no entra en el arranque. La política vive en
 * [@shared/sanitize-policy] y es la misma que usa el renderer.
 */

const window = new JSDOM('').window;
const purifier = createDOMPurify(window);
installSanitizeHooks(purifier as unknown as Purifier);

export function sanitizeEmailHtml(html: string): string {
  return runSanitize(purifier as unknown as Purifier, html);
}

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

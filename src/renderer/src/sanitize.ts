import DOMPurify from 'dompurify';
import { installSanitizeHooks, sanitizeEmailHtml as runSanitize, type Purifier } from '@shared/sanitize-policy';

/**
 * Sanitización del cuerpo del correo en el RENDERER (FR-08). DOMPurify corre
 * aquí sobre el DOM nativo del navegador —su entorno mejor soportado— en lugar
 * de en un jsdom dentro del worker; así el worker no carga jsdom y el primer
 * mensaje abre mucho más rápido. El iframe sandbox (sin scripts) + CSP siguen
 * como defensa en profundidad. La política es la misma compartida que el main
 * usa para la vista de código fuente ([@shared/sanitize-policy]).
 */

installSanitizeHooks(DOMPurify as unknown as Purifier);

export function sanitizeEmailHtml(html: string): string {
  return runSanitize(DOMPurify as unknown as Purifier, html);
}

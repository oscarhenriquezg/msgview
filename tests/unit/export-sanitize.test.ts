import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MsgAdapter } from '../../src/main/parser/MsgAdapter';
import { buildPrintableHtml } from '../../src/main/export/printable';
import { documentToText } from '../../src/main/export/textout';
import { documentToMarkdown } from '../../src/main/export/markdown';
import { documentToJson } from '../../src/main/export/bundle';

/**
 * Regresión: el worker emite el cuerpo CRUDO (la sanitización vive en el
 * renderer). Toda salida del main —HTML imprimible (PDF/PNG/HTML/MHT/ZIP), TXT,
 * Markdown y JSON— debe sanitizar el cuerpo antes de emitirlo. Si no, el render
 * offscreen del export se cuelga con imágenes remotas y el archivo sale con
 * scripts/píxeles de rastreo.
 */
const FIXTURES = join(__dirname, '..', 'fixtures');

describe('Exportaciones sanitizan el cuerpo crudo del worker (FR-08)', () => {
  const result = MsgAdapter.parse(
    readFileSync(join(FIXTURES, 'hostile-script.msg')),
    join(FIXTURES, 'hostile-script.msg')
  );
  if (!result.ok) throw new Error('fixture hostile-script.msg no parseó');
  const doc = result.document;

  it('precondición: el cuerpo del worker viene crudo (con <script>)', () => {
    expect(doc.bodyHtml).toContain('<script');
  });

  it('HTML imprimible (PDF/PNG/HTML/MHT/ZIP): sin script ni imágenes remotas', () => {
    const html = buildPrintableHtml(doc, 'es');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/[^-]src="https?:\/\//);
    expect(html).toContain('data:image/svg+xml'); // placeholder de imagen remota
  });

  it('JSON: bodyHtml sanitizado', () => {
    const json = JSON.parse(documentToJson(doc)) as { bodyHtml: string };
    expect(json.bodyHtml).not.toContain('<script');
  });

  it('TXT y Markdown: sin marcado de script', () => {
    expect(documentToText(doc)).not.toContain('<script');
    expect(documentToMarkdown(doc)).not.toContain('<script');
  });
});

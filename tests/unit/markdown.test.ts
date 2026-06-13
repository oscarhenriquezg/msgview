import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentToMarkdown } from '../../src/main/export/markdown';
import { parseAny } from '../../src/main/parser/AnyMessage';

const FIXTURES = join(__dirname, '..', 'fixtures');
const load = (name: string) => readFileSync(join(FIXTURES, name));

async function docOf(name: string) {
  const r = await parseAny(load(name), name);
  if (!r.ok) throw new Error(`parse falló: ${name}`);
  return r.document;
}

describe('documentToMarkdown', () => {
  it('incluye cabecera de metadatos y convierte el cuerpo HTML a Markdown', async () => {
    const md = documentToMarkdown(await docOf('html-basic.msg'));
    // Cabecera: asunto como H1 y campos en negrita.
    expect(md).toContain('# Informe trimestral Q2');
    expect(md).toContain('**From:** Ana Pérez <ana.perez@example.com>');
    expect(md).toContain('**Attachments:** informe.pdf; datos.csv');
    // Cuerpo: encabezado, negrita y enlace en sintaxis Markdown.
    expect(md).toContain('# Informe');
    expect(md).toContain('**Q2**');
    expect(md).toContain('[Ver detalle](https://intranet.example.com/q2)');
  });

  it('no incrusta data:/cid: en las imágenes, solo su texto alternativo', async () => {
    const md = documentToMarkdown(await docOf('inline-image.msg'));
    expect(md).toContain('*(imagen: logo)*');
    expect(md).not.toContain('data:');
  });
});

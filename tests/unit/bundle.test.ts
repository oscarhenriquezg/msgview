import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentToJson, exportMht, exportZip } from '../../src/main/export/bundle';
import { parseAny } from '../../src/main/parser/AnyMessage';

const FIXTURES = join(__dirname, '..', 'fixtures');
const load = (name: string) => readFileSync(join(FIXTURES, name));

async function docOf(name: string) {
  const r = await parseAny(load(name), name);
  if (!r.ok) throw new Error(`parse falló: ${name}`);
  return r.document;
}

describe('exportaciones de archivo (JSON / MHT / ZIP)', () => {
  it('documentToJson incluye metadatos y descripción de adjuntos', async () => {
    const json = JSON.parse(documentToJson(await docOf('html-basic.msg')));
    expect(json.subject).toBe('Informe trimestral Q2');
    expect(json.from.email).toBe('ana.perez@example.com');
    expect(json.attachments).toHaveLength(2);
    expect(json.attachments[0].fileName).toBe('informe.pdf');
  });

  it('exportMht produce multipart/related con la imagen inline embebida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mht-'));
    const out = join(dir, 'm.mht');
    const r = await exportMht(
      await docOf('inline-image.msg'),
      load('inline-image.msg'),
      out,
      '<html><body><img src="cid:logo123"></body></html>'
    );
    expect(r.ok).toBe(true);
    const mht = readFileSync(out, 'utf-8');
    expect(mht).toContain('multipart/related');
    expect(mht).toContain('Content-ID: <logo123>');
    expect(mht).toContain('Content-Type: image/png');
  });

  it('exportZip empaqueta original, metadata, cuerpos y adjuntos extraídos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const out = join(dir, 'm.zip');
    const r = await exportZip(await docOf('html-basic.msg'), load('html-basic.msg'), out, true, '<html></html>');
    expect(r.ok).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(0);
    // Cabecera local de ZIP ("PK\x03\x04") y nombres de entrada presentes.
    const raw = readFileSync(out);
    expect(raw.subarray(0, 2).toString()).toBe('PK');
    const asText = raw.toString('latin1');
    expect(asText).toContain('metadata.json');
    expect(asText).toContain('attachments/informe.pdf');
  });
});

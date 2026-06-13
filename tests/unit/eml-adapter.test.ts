import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAnyAttachment, parseAny } from '../../src/main/parser/AnyMessage';

const FIXTURES = join(__dirname, '..', 'fixtures');
const load = (name: string) => readFileSync(join(FIXTURES, name));

describe('parseAny — archivos .eml (RFC 5322)', () => {
  it('parsea metadatos, cuerpo HTML y adjuntos', async () => {
    const result = await parseAny(load('sample.eml'), 'sample.eml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = result.document;
    expect(d.metadata.subject).toBe('Correo EML de prueba');
    expect(d.metadata.from.email).toBe('ana.perez@example.com');
    expect(d.metadata.recipients.find((r) => r.type === 'cc')?.email).toBe('dept@example.com');
    expect(d.bodySource).toBe('html');
    expect(d.bodyHtml).toContain('<h1>EML</h1>');
    const real = d.attachments.filter((a) => !a.isInline);
    expect(real).toHaveLength(1);
    expect(real[0]?.fileName).toBe('datos.csv');
  });

  it('sanitiza el HTML y resuelve cid: como data: (FR-08/09)', async () => {
    const result = await parseAny(load('sample.eml'), 'sample.eml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.bodyHtml).not.toContain('<script');
    expect(result.document.bodyHtml).toContain('data:image/png;base64');
    expect(result.document.bodyHtml).not.toContain('cid:foto1');
  });

  it('extrae adjuntos con integridad binaria (FR-10)', async () => {
    const att = await getAnyAttachment(load('sample.eml'), 1);
    expect(att?.fileName).toBe('datos.csv');
    expect(Buffer.from(att!.content).toString()).toBe('x;y\n1;2\n');
  });

  it('abre archivos .emlx de Apple Mail (prefijo de longitud + plist)', async () => {
    const result = await parseAny(load('sample.emlx'), 'sample.emlx');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.metadata.subject).toBe('Correo EML de prueba');
    expect(result.document.metadata.from.email).toBe('ana.perez@example.com');
    // El plist final de metadatos no debe colarse en el cuerpo.
    expect(result.document.bodyHtml).not.toContain('plist');
  });

  it('un .msg renombrado a .eml se detecta por contenido (FR-05)', async () => {
    const result = await parseAny(load('renamed-msg.eml'), 'renamed-msg.eml');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.metadata.subject).toBe('Informe trimestral Q2');
  });

  it('basura con pinta de ninguno de los dos → error descriptivo', async () => {
    const result = await parseAny(Buffer.from('\x00\x01\x02nada'), 'x.eml');
    expect(result.ok).toBe(false);
  });
});

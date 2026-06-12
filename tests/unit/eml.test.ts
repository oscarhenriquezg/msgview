import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { buildEml } from '../../src/main/export/eml';
import { MsgAdapter } from '../../src/main/parser/MsgAdapter';

const FIXTURES = join(__dirname, '..', 'fixtures');
const partsOf = (name: string) => {
  const parts = MsgAdapter.getEmlParts(readFileSync(join(FIXTURES, name)));
  expect(parts).not.toBeNull();
  return parts!;
};

describe('buildEml — reconstrucción MIME (FR-12)', () => {
  it('produce un EML parseable con cabeceras, alternative y adjuntos', async () => {
    const eml = buildEml(partsOf('html-basic.msg'));
    const mail = await simpleParser(eml);

    expect(mail.subject).toBe('Informe trimestral Q2');
    expect(mail.from?.value[0]?.address).toBe('ana.perez@example.com');
    expect(mail.from?.value[0]?.name).toBe('Ana Pérez');
    const to = Array.isArray(mail.to) ? mail.to[0] : mail.to;
    expect(to?.value[0]?.address).toBe('oscar@example.com');
    expect(mail.html).toContain('<h1>Informe</h1>');
    expect(mail.text).toContain('Resultados del Q2');
    expect(mail.attachments).toHaveLength(2);
    expect(mail.attachments[0]?.filename).toBe('informe.pdf');
    // Integridad binaria del adjunto (criterio de aceptación 3).
    expect(mail.attachments[1]?.content.toString()).toBe('a;b;c\n1;2;3\n');
  });

  it('conserva Content-ID de imágenes inline', async () => {
    const eml = buildEml(partsOf('inline-image.msg'));
    const mail = await simpleParser(eml);
    const inline = mail.attachments.find((a) => a.contentId);
    expect(inline?.contentId).toBe('<logo123>');
    expect(inline?.contentDisposition).toBe('inline');
  });

  it('correo solo-texto produce text/plain sin multipart', async () => {
    const eml = buildEml(partsOf('plaintext-only.msg'));
    const mail = await simpleParser(eml);
    expect(mail.text).toContain('Línea 1');
    expect(mail.html).toBe(false);
    expect(mail.attachments).toHaveLength(0);
  });

  it('cabeceras no-ASCII van codificadas RFC 2047', () => {
    const eml = buildEml(partsOf('html-basic.msg'));
    const headerBlock = eml.slice(0, eml.indexOf('\r\n\r\n'));
    expect(headerBlock).toContain('=?utf-8?B?');
    // El bloque de cabeceras debe ser ASCII puro.
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(headerBlock)).toBe(true);
  });
});

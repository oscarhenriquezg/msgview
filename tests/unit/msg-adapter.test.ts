import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAny } from '../../src/main/parser/AnyMessage';
import { MsgAdapter } from '../../src/main/parser/MsgAdapter';
// El worker emite HTML crudo; la sanitización es un paso aparte (renderer en
// producción, política compartida). Aquí se aplica para probar el pipeline.
import { sanitizeEmailHtml } from '../../src/main/parser/sanitize';

const FIXTURES = join(__dirname, '..', 'fixtures');
const load = (name: string) => readFileSync(join(FIXTURES, name));
const parse = (name: string) => MsgAdapter.parse(load(name), join(FIXTURES, name));

describe('MsgAdapter — archivos válidos', () => {
  it('parsea un correo HTML con metadatos y adjuntos (FR-06, FR-07)', () => {
    const result = parse('html-basic.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = result.document;
    expect(doc.metadata.subject).toBe('Informe trimestral Q2');
    expect(doc.metadata.from.name).toBe('Ana Pérez');
    expect(doc.metadata.from.email).toBe('ana.perez@example.com');
    expect(doc.metadata.recipients).toHaveLength(2);
    expect(doc.bodySource).toBe('html');
    expect(doc.bodyHtml).toContain('<h1>Informe</h1>');
    expect(doc.attachments).toHaveLength(2);
    expect(doc.attachments[0]?.fileName).toBe('informe.pdf');
    expect(doc.attachments[0]?.isInline).toBe(false);
  });

  it('decodifica cadenas ANSI (001E) según PR_MESSAGE_CODEPAGE, sin mojibake', () => {
    const result = parse('ansi-cyrillic.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { metadata, bodyHtml } = result.document;
    // Sin aplicar el codepage 1251 estos textos cirílicos saldrían como mojibake.
    expect(metadata.subject).toBe('Привет, отчёт');
    expect(bodyHtml).toContain('кодировке Windows-1251');
    // Nombres ANSI de remitente y destinatario también decodificados (no vacíos).
    expect(metadata.from.name).toBe('Иван Петров');
    expect(metadata.from.email).toBe('ivan.petrov@example.ru');
    expect(metadata.recipients[0]?.name).toBe('Мария Сидорова');
    expect(metadata.recipients[0]?.email).toBe('maria@example.ru');
  });

  it('destinatarios de Exchange: prefiere SMTP y omite el DN X.500', () => {
    const result = parse('exchange-dn.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [withSmtp, dnOnly] = result.document.metadata.recipients;
    expect(withSmtp?.email).toBe('usuario.interno@example.cl');
    // Sin SMTP disponible: nunca mostrar el DN como si fuera un email.
    expect(dnOnly?.email).toBe('');
    expect(dnOnly?.name).toBe('Solo DN Sin SMTP');
  });

  it('resuelve imágenes cid: como data: URIs (FR-09)', () => {
    const result = parse('inline-image.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.bodyHtml).toContain('data:image/png;base64');
    expect(result.document.bodyHtml).not.toContain('cid:logo123');
    expect(result.document.attachments[0]?.isInline).toBe(true);
  });

  it('des-encapsula HTML desde RTF comprimido (FR-07 vía 2, alta fidelidad)', () => {
    const result = parse('rtf-encapsulated.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.bodySource).toBe('rtf-deencapsulated');
    expect(result.document.bodyHtml).toContain('Texto desde RTF encapsulado');
  });

  it('convierte RTF puro de forma aproximada (FR-07 vía 2, L-01)', () => {
    const result = parse('rtf-plain.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.bodySource).toBe('rtf-converted');
    expect(result.document.bodyHtml).toContain('Correo antiguo en RTF puro.');
    expect(result.document.bodyHtml).toContain('Segunda línea.');
  });

  it('cae a texto plano envuelto en <pre> sin HTML ni RTF (FR-07 vía 3)', () => {
    const result = parse('plaintext-only.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.bodySource).toBe('plaintext');
    expect(result.document.bodyHtml).toContain('<pre');
    expect(result.document.bodyHtml).toContain('&lt;caracteres&gt;');
  });
});

describe('Sanitización del cuerpo (FR-08) — política compartida sobre la salida del worker', () => {
  it('elimina scripts, manejadores on* y javascript: URIs', () => {
    const result = parse('hostile-script.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const html = sanitizeEmailHtml(result.document.bodyHtml);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onload');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Hola');
  });

  it('sustituye imágenes remotas por placeholder (L-03)', () => {
    const result = parse('hostile-script.msg');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const html = sanitizeEmailHtml(result.document.bodyHtml);
    expect(html).not.toMatch(/[^-]src="https?:\/\//);
    expect(html).toContain('data:image/svg+xml');
  });
});

describe('MsgAdapter — errores descriptivos sin crash (FR-05, NFR-07)', () => {
  const expectError = (file: string, code: string) => {
    const result = parse(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
  };

  it('bytes aleatorios → not-cfbf', () => expectError('random-bytes.msg', 'not-cfbf'));
  it('zip renombrado → not-cfbf', () => expectError('renamed-zip.msg', 'not-cfbf'));
  it('archivo vacío → not-cfbf', () => expectError('empty.msg', 'not-cfbf'));
  it('solo cabecera CFBF → truncated', () => expectError('header-only.msg', 'truncated'));
  it('cifrado S/MIME → encrypted', () => expectError('smime-encrypted.msg', 'encrypted'));

  it('clase no soportada → unsupported-class con la clase en detail (§1.2)', () => {
    const result = parse('calendar-unsupported.msg');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unsupported-class');
    expect(result.error.detail).toBe('IPM.Appointment');
  });

  it('archivo truncado no crashea', () => {
    const result = parse('truncated.msg');
    expect(result.ok).toBe(false);
  });

  it('fuzzing ligero: mutaciones de un .msg válido nunca lanzan', () => {
    const base = load('html-basic.msg');
    for (let seed = 0; seed < 50; seed++) {
      const mutated = Buffer.from(base);
      // Corrompe 20 bytes pseudoaleatorios deterministas.
      for (let j = 0; j < 20; j++) {
        const pos = (seed * 7919 + j * 104729) % mutated.length;
        mutated[pos] = (mutated[pos]! + seed + 1) % 256;
      }
      expect(() => MsgAdapter.parse(mutated, 'fuzz.msg')).not.toThrow();
    }
  });
});

describe('MsgAdapter — extracción de adjuntos (FR-10)', () => {
  it('devuelve los bytes íntegros de un adjunto', () => {
    const buffer = load('html-basic.msg');
    const att = MsgAdapter.getAttachmentContent(buffer, 1);
    expect(att).not.toBeNull();
    expect(att?.fileName).toBe('datos.csv');
    expect(Buffer.from(att!.content).toString()).toBe('a;b;c\n1;2;3\n');
  });

  it('id inexistente devuelve null', () => {
    expect(MsgAdapter.getAttachmentContent(load('html-basic.msg'), 99)).toBeNull();
  });
});

describe('Corpus de mensajes reales (tests/fixtures/real/)', () => {
  const realDir = join(FIXTURES, 'real');
  const files = existsSync(realDir)
    ? readdirSync(realDir).filter((f) => /\.(msg|eml)$/i.test(f))
    : [];
  it.each(files.length > 0 ? files : [])('parsea %s sin crash', async (file) => {
    const result = await parseAny(readFileSync(join(realDir, file)), file);
    if (result.ok) {
      expect(sanitizeEmailHtml(result.document.bodyHtml)).not.toContain('<script');
    } else {
      expect(result.error.code).toBeTruthy();
    }
  });
  if (files.length === 0) {
    it.skip('no hay mensajes reales en el corpus (copia .msg/.eml a tests/fixtures/real/)', () => {});
  }
});

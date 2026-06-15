import { describe, expect, it } from 'vitest';
import { homographRisk } from '../../src/main/parser/homograph';
import { sanitizeEmailHtml } from '../../src/main/parser/sanitize';

describe('homographRisk — homografía IDN (complemento a enlaces engañosos)', () => {
  it('marca whole-script confusable: todo cirílico imitando latino (аррӏе → apple)', () => {
    const r = homographRisk('xn--80ak6aa92e.com');
    expect(r.risk).toBe(true);
    expect(r.decoded).toBe('аррӏе.com');
  });

  it('marca mezcla de escrituras en una etiqueta (p latino + а cirílica)', () => {
    expect(homographRisk('xn--pypal-4ve.com').risk).toBe(true);
  });

  it('NO marca un IDN cirílico legítimo (пример.рф)', () => {
    expect(homographRisk('xn--e1afmkfd.xn--p1ai').risk).toBe(false);
  });

  it('NO marca un IDN griego legítimo (ελληνικά.gr)', () => {
    expect(homographRisk('xn--hxargifdar.gr').risk).toBe(false);
  });

  it('NO marca latino con diacríticos (münchen.de)', () => {
    expect(homographRisk('xn--mnchen-3ya.de').risk).toBe(false);
  });

  it('NO marca dominios ASCII normales', () => {
    expect(homographRisk('apple.com').risk).toBe(false);
    expect(homographRisk('paypal.com').risk).toBe(false);
    expect(homographRisk('mail.google.com').risk).toBe(false);
  });
});

describe('sanitización: etiqueta data-homograph en los enlaces', () => {
  it('anota el host decodificado en un enlace homográfico', () => {
    const html = sanitizeEmailHtml('<a href="http://xn--80ak6aa92e.com/login">Inicia sesión</a>');
    expect(html).toContain('data-homograph="аррӏе.com"');
  });

  it('no anota un enlace normal', () => {
    const html = sanitizeEmailHtml('<a href="https://apple.com">Apple</a>');
    expect(html).not.toContain('data-homograph');
  });
});

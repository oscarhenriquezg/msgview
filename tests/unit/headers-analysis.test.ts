import { describe, expect, it } from 'vitest';
import { parseAuthResults, parseReceivedChain } from '../../src/main/headers-analysis';

const HEADERS = [
  'Received: from mx2.example.net (mx2.example.net [203.0.113.9])',
  '\tby destino.example.com with ESMTPS;',
  '\tFri, 24 Apr 2026 13:40:30 +0000',
  'Received: from origen.example.org (origen.example.org [198.51.100.7])',
  '\tby mx2.example.net with ESMTP;',
  '\tFri, 24 Apr 2026 13:40:10 +0000',
  'Authentication-Results: mx2.example.net; spf=pass smtp.mailfrom=example.org;',
  '\tdkim=pass header.d=example.org; dmarc=fail action=quarantine',
  'Received-SPF: Pass (sender SPF authorized)',
  'Subject: prueba'
].join('\r\n');

describe('parseReceivedChain', () => {
  it('ordena cronológicamente y calcula la demora entre saltos', () => {
    const hops = parseReceivedChain(HEADERS);
    expect(hops).toHaveLength(2);
    // El origen primero (el Received más antiguo está al final de la cabecera).
    expect(hops[0]?.from).toContain('origen.example.org');
    expect(hops[0]?.by).toBe('mx2.example.net');
    expect(hops[1]?.by).toBe('destino.example.com');
    expect(hops[1]?.deltaSeconds).toBe(20);
  });

  it('sin cabeceras Received devuelve vacío', () => {
    expect(parseReceivedChain('Subject: x\r\nFrom: a@b.c')).toHaveLength(0);
  });
});

describe('parseAuthResults', () => {
  it('extrae spf/dkim/dmarc con su resultado, sin duplicados', () => {
    const auth = parseAuthResults(HEADERS);
    const byMech = Object.fromEntries(auth.map((a) => [a.mechanism, a.result]));
    expect(byMech['spf']).toBe('pass');
    expect(byMech['dkim']).toBe('pass');
    expect(byMech['dmarc']).toBe('fail');
    expect(auth.filter((a) => a.mechanism === 'spf')).toHaveLength(1);
  });
});

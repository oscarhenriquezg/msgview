/**
 * Análisis técnico de cabeceras de transporte: cadena Received (el "viaje"
 * del correo, con demoras entre saltos) y resultados de autenticación
 * (SPF / DKIM / DMARC / ARC).
 */

export interface Hop {
  from: string;
  by: string;
  /** Fecha del salto en ISO, si se pudo interpretar. */
  date?: string;
  /** Segundos transcurridos desde el salto anterior (puede ser negativo si los relojes difieren). */
  deltaSeconds?: number;
}

export interface AuthResult {
  mechanism: 'spf' | 'dkim' | 'dmarc' | 'arc';
  result: string;
}

/** Despliega las líneas continuadas (RFC 5322 folding). */
function unfold(headers: string): string {
  return headers.replace(/\r?\n[ \t]+/g, ' ');
}

/**
 * Cadena de saltos en orden cronológico (el primero es el origen).
 * En la cabecera, el Received más reciente va primero; aquí se invierte.
 */
export function parseReceivedChain(headers: string): Hop[] {
  const lines = unfold(headers).split(/\r?\n/);
  const received = lines
    .filter((l) => /^received:/i.test(l))
    .map((l) => l.replace(/^received:\s*/i, ''));

  const hops: Hop[] = received
    .map((value) => {
      const semicolon = value.lastIndexOf(';');
      const dateRaw = semicolon >= 0 ? value.slice(semicolon + 1).trim() : '';
      const parsed = dateRaw ? new Date(dateRaw) : null;
      const fromMatch = value.match(/\bfrom\s+(\S+)(?:\s+\(([^)]*)\))?/i);
      const byMatch = value.match(/\bby\s+(\S+)/i);
      return {
        from: fromMatch ? fromMatch[1] + (fromMatch[2] ? ` (${fromMatch[2]})` : '') : '—',
        by: byMatch?.[1] ?? '—',
        date: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined
      };
    })
    .reverse(); // cronológico: origen primero

  for (let i = 1; i < hops.length; i++) {
    const prev = hops[i - 1]?.date;
    const curr = hops[i]?.date;
    if (prev && curr) {
      hops[i]!.deltaSeconds = Math.round((new Date(curr).getTime() - new Date(prev).getTime()) / 1000);
    }
  }
  return hops;
}

/** Resultados SPF/DKIM/DMARC/ARC de Authentication-Results y Received-SPF. */
export function parseAuthResults(headers: string): AuthResult[] {
  const lines = unfold(headers).split(/\r?\n/);
  const results: AuthResult[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (/^(authentication-results|arc-authentication-results):/i.test(line)) {
      for (const m of line.matchAll(/\b(spf|dkim|dmarc|arc)=([a-zA-Z0-9_-]+)/gi)) {
        const mechanism = m[1]!.toLowerCase() as AuthResult['mechanism'];
        const key = `${mechanism}:${m[2]!.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ mechanism, result: m[2]!.toLowerCase() });
        }
      }
    } else if (/^received-spf:/i.test(line)) {
      const m = line.match(/^received-spf:\s*(\w+)/i);
      if (m && !seen.has(`spf:${m[1]!.toLowerCase()}`)) {
        seen.add(`spf:${m[1]!.toLowerCase()}`);
        results.push({ mechanism: 'spf', result: m[1]!.toLowerCase() });
      }
    }
  }
  return results;
}

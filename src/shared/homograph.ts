/**
 * Detección de homografía IDN: dominios internacionalizados (punycode `xn--`)
 * cuyo nombre real usa caracteres de otra escritura (cirílico/griego) para
 * imitar a uno latino de confianza (p. ej. `xn--80ak6aa92e.com` → `аррӏе.com`,
 * "apple" suplantado con cirílico). Complementa la detección de enlaces
 * engañosos (texto visible vs host real), que no ve estos casos porque el host
 * "coincide" visualmente.
 *
 * Se marcan dos señales (subconjunto pragmático de Unicode TR39):
 *  1. Una etiqueta que mezcla latín con cirílico/griego (p. ej. "аpple").
 *  2. Una etiqueta no latina cuyas letras son TODAS confundibles con latinas
 *     (whole-script confusable, p. ej. "аррӏе" — todo cirílico).
 * Un dominio legítimamente cirílico/griego (p. ej. "пример") no se marca,
 * porque incluye letras sin equivalente latino.
 */

// --- Decodificador punycode (RFC 3492), solo decode, sin dependencias ---
// Inlineado a propósito: el paquete userland 'punycode' es CommonJS y el
// bundler de Electron lo externaliza, rompiendo el import ESM en runtime.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function digitValue(cp: number): number {
  if (cp - 48 < 10) return cp - 22; // '0'-'9' → 26..35
  if (cp - 65 < 26) return cp - 65; // 'A'-'Z' → 0..25
  if (cp - 97 < 26) return cp - 97; // 'a'-'z' → 0..25
  return BASE; // inválido
}

/** Decodifica una etiqueta punycode (sin el prefijo `xn--`) a Unicode. */
function decodeLabel(input: string): string {
  const output: number[] = [];
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('basic code point no ASCII');
    output.push(c);
  }
  let index = basic < 0 ? 0 : basic + 1;
  while (index < input.length) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new Error('entrada punycode incompleta');
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE) throw new Error('dígito punycode inválido');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const outLen = output.length + 1;
    bias = adapt(i - oldi, outLen, oldi === 0);
    n += Math.floor(i / outLen);
    i %= outLen;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Decodifica un host IDN: cada etiqueta `xn--` pasa a Unicode; el resto igual. */
function toUnicodeHost(host: string): string {
  return host
    .split('.')
    .map((label) => (label.startsWith('xn--') ? decodeLabel(label.slice(4)) : label))
    .join('.');
}

// --- Detección de homografía ---

/** Letras no latinas con sosias latino evidente (las más usadas en ataques). */
const CONFUSABLES = new Set<string>([
  // Cirílico → latino
  'а', 'е', 'о', 'р', 'с', 'у', 'х', 'і', 'ј', 'ѕ', 'ԁ', 'ԛ', 'ԝ', 'ӏ',
  // Griego → latino
  'ο', 'α', 'ρ', 'χ', 'υ'
]);

const LATIN = /[A-Za-z]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const GREEK = /[Ͱ-Ͽ]/;

function labelIsRisky(label: string): boolean {
  let hasLatin = false;
  let nonLatinLetters = 0;
  let confusableNonLatin = 0;
  for (const ch of label) {
    if (LATIN.test(ch)) {
      hasLatin = true;
    } else if (CYRILLIC.test(ch) || GREEK.test(ch)) {
      nonLatinLetters++;
      if (CONFUSABLES.has(ch)) confusableNonLatin++;
    }
  }
  // 1) Mezcla de escrituras en una misma etiqueta.
  if (hasLatin && nonLatinLetters > 0) return true;
  // 2) Etiqueta no latina con TODAS sus letras confundibles con latinas.
  if (nonLatinLetters > 0 && confusableNonLatin === nonLatinLetters) return true;
  return false;
}

/**
 * @param hostname Host tal cual aparece en la URL (normalmente en punycode).
 * @returns `risk` si alguna etiqueta es sospechosa; `decoded`, el host en
 *          Unicode para mostrárselo al usuario.
 */
export function homographRisk(hostname: string): { risk: boolean; decoded: string } {
  const host = hostname.toLowerCase();
  if (!host.includes('xn--')) return { risk: false, decoded: hostname };
  let decoded: string;
  try {
    decoded = toUnicodeHost(host);
  } catch {
    return { risk: false, decoded: hostname };
  }
  for (const label of decoded.split('.')) {
    if (labelIsRisky(label)) return { risk: true, decoded };
  }
  return { risk: false, decoded };
}

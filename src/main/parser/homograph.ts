import { toUnicode } from 'punycode/punycode.js';

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
    decoded = toUnicode(host);
  } catch {
    return { risk: false, decoded: hostname };
  }
  for (const label of decoded.split('.')) {
    if (labelIsRisky(label)) return { risk: true, decoded };
  }
  return { risk: false, decoded };
}

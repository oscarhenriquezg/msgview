import { decompressRTF } from '@kenjiuno/decompressrtf';
import iconv from 'iconv-lite';
import { deEncapsulateSync } from 'rtf-stream-parser';

export interface RtfBodyResult {
  html: string;
  /** true si el RTF encapsulaba el HTML original de Outlook (alta fidelidad). */
  deEncapsulated: boolean;
}

/**
 * Resuelve el cuerpo a partir de PidTagRtfCompressed (FR-07 vía 2, L-01).
 *
 * El RTF de Outlook habitualmente *encapsula* el HTML original (\fromhtml1);
 * en ese caso la des-encapsulación recupera el HTML con fidelidad alta.
 * Solo si el RTF es "puro" se recurre a una conversión aproximada.
 */
export function rtfCompressedToHtml(compressed: Uint8Array): RtfBodyResult | null {
  let rtfBytes: Buffer;
  try {
    rtfBytes = Buffer.from(decompressRTF(Array.from(compressed)));
  } catch {
    return null;
  }

  try {
    const result = deEncapsulateSync(rtfBytes, {
      decode: (buf, enc) => iconv.decode(buf as Buffer, enc),
      mode: 'either'
    });
    const text = typeof result.text === 'string' ? result.text : result.text.toString('utf-8');
    if (result.mode === 'html') {
      return { html: text, deEncapsulated: true };
    }
    // Encapsulaba texto plano (\fromtext): envolver como FR-07 vía 3.
    return { html: plainTextToHtml(text), deEncapsulated: true };
  } catch {
    // RTF no encapsulado: conversión aproximada (L-01).
    const approx = convertPlainRtf(rtfBytes.toString('latin1'));
    return approx ? { html: approx, deEncapsulated: false } : null;
  }
}

/**
 * Conversión mínima de RTF puro a HTML: extrae el texto visible respetando
 * \par como salto de línea. Aproximación documentada como lossy (L-01);
 * el conversor vive tras este módulo para poder sustituirse (NFR-09).
 */
function convertPlainRtf(rtf: string): string | null {
  if (!rtf.startsWith('{\\rtf')) return null;
  let out = '';
  let i = 0;
  let skipGroupDepth = 0;
  let depth = 0;
  const destinations = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|footer|themedata|colorschememapping|filetbl|listtable|listoverridetable|generator)/;
  while (i < rtf.length) {
    const ch = rtf[i];
    if (ch === '{') {
      depth++;
      // ¿Grupo de destino a ignorar? {\*\... o {\fonttbl...
      const rest = rtf.slice(i + 1, i + 40);
      const m = rest.match(/^\\\*?\\?([a-z]+)/);
      if (skipGroupDepth === 0 && m && (destinations.test(m[1] ?? '') || rest.startsWith('\\*'))) {
        skipGroupDepth = depth;
      }
      i++;
    } else if (ch === '}') {
      if (skipGroupDepth === depth) skipGroupDepth = 0;
      depth--;
      i++;
    } else if (ch === '\\') {
      const ctrl = rtf.slice(i).match(/^\\([a-z]+)(-?\d+)? ?/i);
      if (ctrl) {
        const word = ctrl[1];
        if (skipGroupDepth === 0) {
          if (word === 'par' || word === 'line') out += '\n';
          else if (word === 'tab') out += '\t';
          else if (word === 'u' && ctrl[2]) {
            const code = parseInt(ctrl[2], 10);
            out += String.fromCharCode(code < 0 ? code + 65536 : code);
            // El carácter de reemplazo que sigue a \uN se omite.
            i += ctrl[0].length;
            if (rtf[i] === '?') i++;
            continue;
          }
        }
        i += ctrl[0].length;
      } else if (rtf[i + 1] === "'") {
        if (skipGroupDepth === 0) {
          const hex = rtf.slice(i + 2, i + 4);
          out += iconv.decode(Buffer.from(hex, 'hex'), 'win1252');
        }
        i += 4;
      } else {
        // Carácter escapado: \{ \} \\
        if (skipGroupDepth === 0 && rtf[i + 1]) out += rtf[i + 1];
        i += 2;
      }
    } else {
      if (skipGroupDepth === 0 && ch !== '\r' && ch !== '\n') out += ch;
      i++;
    }
  }
  const text = out.trim();
  return text ? plainTextToHtml(text) : null;
}

/** FR-07 vía 3: texto plano envuelto en HTML mínimo monoespaciado. */
export function plainTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<pre style="font-family: ui-monospace, 'Cascadia Code', Menlo, monospace; white-space: pre-wrap; word-wrap: break-word; margin: 0;">${escaped}</pre>`;
}

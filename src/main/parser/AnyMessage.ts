import type { LoadResult } from '@shared/types';
import { getEmlAttachment, parseEml } from './EmlAdapter';
import { MsgAdapter } from './MsgAdapter';

/**
 * Punto de entrada único para cualquier mensaje soportado.
 * La detección es por contenido, no por extensión (FR-05: extensiones
 * renombradas no deben confundir al visor).
 */

const CFBF_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export function isCfbf(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(CFBF_MAGIC);
}

/** Heurística RFC 5322: el archivo empieza con cabeceras "Nombre: valor". */
function looksLikeEml(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 2048).toString('latin1');
  return /^[\x21-\x39\x3b-\x7e]+:[ \t]/m.test(head.split(/\r?\n\r?\n/)[0] ?? '');
}

/**
 * EMLX (Apple Mail): primera línea con el nº de bytes del mensaje, luego el
 * RFC 5322 y finalmente un plist de metadatos. Se devuelve el mensaje RFC 5322
 * (las N bytes indicadas) listo para el parser EML, o null si no es EMLX.
 */
function emlxToEml(buffer: Buffer): Buffer | null {
  const nl = buffer.indexOf(0x0a);
  if (nl <= 0 || nl > 16) return null;
  const firstLine = buffer.subarray(0, nl).toString('latin1').trim();
  if (!/^\d+$/.test(firstLine)) return null;
  const length = parseInt(firstLine, 10);
  const start = nl + 1;
  const message = buffer.subarray(start, Math.min(start + length, buffer.length));
  return looksLikeEml(message) ? message : null;
}

export async function parseAny(buffer: Buffer, sourcePath: string): Promise<LoadResult> {
  if (isCfbf(buffer)) return MsgAdapter.parse(buffer, sourcePath);
  if (looksLikeEml(buffer)) return parseEml(buffer, sourcePath);
  const emlx = emlxToEml(buffer);
  if (emlx) return parseEml(emlx, sourcePath);
  return { ok: false, error: { code: 'not-cfbf' } };
}

export async function getAnyAttachment(
  buffer: Buffer,
  attachmentId: number
): Promise<{ fileName: string; content: Uint8Array } | null> {
  if (isCfbf(buffer)) return MsgAdapter.getAttachmentContent(buffer, attachmentId);
  const eml = looksLikeEml(buffer) ? buffer : emlxToEml(buffer);
  return eml ? getEmlAttachment(eml, attachmentId) : null;
}

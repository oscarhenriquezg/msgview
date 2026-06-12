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

export async function parseAny(buffer: Buffer, sourcePath: string): Promise<LoadResult> {
  if (isCfbf(buffer)) return MsgAdapter.parse(buffer, sourcePath);
  if (looksLikeEml(buffer)) return parseEml(buffer, sourcePath);
  return { ok: false, error: { code: 'not-cfbf' } };
}

export async function getAnyAttachment(
  buffer: Buffer,
  attachmentId: number
): Promise<{ fileName: string; content: Uint8Array } | null> {
  if (isCfbf(buffer)) return MsgAdapter.getAttachmentContent(buffer, attachmentId);
  return getEmlAttachment(buffer, attachmentId);
}

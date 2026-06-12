import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { LoadResult, MsgDocument, MsgRecipient } from '@shared/types';
import { MAX_ATTACHMENTS, MAX_BODY_BYTES, MAX_INLINE_IMAGE_BYTES, MAX_TOTAL_INLINE_BYTES } from './limits';
import { plainTextToHtml } from './rtf';
import { sanitizeEmailHtml } from './sanitize';

/**
 * Adapter para mensajes RFC 5322 (.eml), simétrico a MsgAdapter: produce el
 * mismo MsgDocument sanitizado. mailparser queda encapsulado aquí (NFR-09).
 */

function flattenAddresses(
  value: AddressObject | AddressObject[] | undefined,
  type: MsgRecipient['type']
): MsgRecipient[] {
  const objects = Array.isArray(value) ? value : value ? [value] : [];
  return objects.flatMap((o) =>
    o.value.map((a) => ({
      name: a.name ?? '',
      email: a.address ?? '',
      type
    }))
  );
}

function resolveBody(mail: ParsedMail): { html: string; source: MsgDocument['bodySource'] } {
  if (typeof mail.html === 'string' && mail.html.length > 0) {
    return { html: mail.html, source: 'html' };
  }
  if (mail.text) return { html: plainTextToHtml(mail.text), source: 'plaintext' };
  return { html: '', source: 'plaintext' };
}

export async function parseEml(buffer: Buffer, sourcePath: string): Promise<LoadResult> {
  if (buffer.length > MAX_BODY_BYTES * 2) {
    return { ok: false, error: { code: 'too-large' } };
  }
  let mail: ParsedMail;
  try {
    mail = await simpleParser(buffer);
  } catch (e) {
    return {
      ok: false,
      error: { code: 'parse-error', detail: e instanceof Error ? e.message : String(e) }
    };
  }

  const attachmentsRaw = (mail.attachments ?? []).slice(0, MAX_ATTACHMENTS);
  const { html: rawHtml, source } = resolveBody(mail);
  let html = rawHtml;

  // FR-09 también para EML: imágenes cid: como data: URIs.
  let budget = MAX_TOTAL_INLINE_BYTES;
  for (const a of attachmentsRaw) {
    const cid = a.cid;
    if (!cid || !html.includes(`cid:${cid}`)) continue;
    if (a.content.length > MAX_INLINE_IMAGE_BYTES || a.content.length > budget) continue;
    budget -= a.content.length;
    const mime = a.contentType || 'application/octet-stream';
    html = html.split(`cid:${cid}`).join(`data:${mime};base64,${a.content.toString('base64')}`);
  }

  const attachments = attachmentsRaw.map((a, index) => {
    const fileName = a.filename ?? `adjunto-${index + 1}`;
    const dot = fileName.lastIndexOf('.');
    const extension = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
    return {
      id: index,
      fileName,
      extension,
      size: a.content.length,
      isInline: Boolean(a.cid && html.includes('data:')) || a.contentDisposition === 'inline',
      contentId: a.cid,
      isEmbeddedMsg:
        extension === '.msg' ||
        extension === '.eml' ||
        a.contentType === 'message/rfc822' ||
        a.contentType === 'application/vnd.ms-outlook'
    };
  });

  const document: MsgDocument = {
    metadata: {
      subject: mail.subject ?? '',
      from: {
        name: mail.from?.value[0]?.name ?? '',
        email: mail.from?.value[0]?.address ?? ''
      },
      recipients: [
        ...flattenAddresses(mail.to, 'to'),
        ...flattenAddresses(mail.cc, 'cc'),
        ...flattenAddresses(mail.bcc, 'bcc')
      ],
      sentDate: mail.date?.toISOString(),
      receivedDate: undefined,
      messageClass: 'RFC822',
      hasSignature: attachmentsRaw.some((a) => /pkcs7-signature/i.test(a.contentType ?? '')),
      importance: undefined
    },
    bodyHtml: sanitizeEmailHtml(html),
    bodySource: source,
    attachments,
    sourcePath
  };
  return { ok: true, document };
}

/** Bytes de un adjunto de un .eml, bajo demanda (FR-10). */
export async function getEmlAttachment(
  buffer: Buffer,
  attachmentId: number
): Promise<{ fileName: string; content: Uint8Array } | null> {
  try {
    const mail = await simpleParser(buffer);
    const a = (mail.attachments ?? [])[attachmentId];
    if (!a) return null;
    return { fileName: a.filename ?? `adjunto-${attachmentId + 1}`, content: a.content };
  } catch {
    return null;
  }
}

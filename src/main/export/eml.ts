import type { EmlParts } from '../parser/MsgAdapter';

/**
 * Reconstrucción MIME RFC 5322/2045 desde las propiedades MAPI (FR-12).
 * L-02: no es byte-equivalente al mensaje SMTP original; las cabeceras de
 * transporte solo se conservan si el .msg incluía PidTagTransportMessageHeaders.
 */

const CRLF = '\r\n';

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.msg': 'application/vnd.ms-outlook',
  '.eml': 'message/rfc822'
};

/** RFC 2047: codifica una cabecera si contiene no-ASCII. */
function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?utf-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function formatAddress(name: string, email: string): string {
  if (!name || name === email) return email;
  const encoded = encodeHeaderWord(name);
  const quoted = encoded.startsWith('=?') ? encoded : `"${name.replace(/"/g, '\\"')}"`;
  return email ? `${quoted} <${email}>` : quoted;
}

/** RFC 5322 date: "Thu, 12 Jun 2026 10:30:00 +0000". */
function formatDate(iso: string): string {
  return new Date(iso).toUTCString().replace(/GMT$/, '+0000');
}

function base64Lines(content: Uint8Array): string {
  const b64 = Buffer.from(content).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join(CRLF);
}

function boundary(tag: string): string {
  return `----=_msgviewer_${tag}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Extrae Message-ID de las cabeceras de transporte originales, si existen. */
function extractMessageId(transportHeaders?: string): string | undefined {
  const m = transportHeaders?.match(/^Message-ID:\s*(<[^>]+>)/im);
  return m?.[1];
}

export function buildEml(parts: EmlParts): string {
  const { metadata } = parts;
  const headers: string[] = [];

  headers.push(`From: ${formatAddress(metadata.from.name, metadata.from.email)}`);
  for (const type of ['to', 'cc', 'bcc'] as const) {
    // Sin dirección no hay addr-spec válido (DN-only de Exchange): se omite.
    const list = metadata.recipients.filter((r) => r.type === type && r.email);
    if (list.length > 0) {
      const headerName = type === 'to' ? 'To' : type === 'cc' ? 'Cc' : 'Bcc';
      headers.push(`${headerName}: ${list.map((r) => formatAddress(r.name, r.email)).join(', ')}`);
    }
  }
  headers.push(`Subject: ${encodeHeaderWord(metadata.subject)}`);
  if (metadata.sentDate) headers.push(`Date: ${formatDate(metadata.sentDate)}`);
  const messageId = extractMessageId(parts.transportHeaders);
  if (messageId) headers.push(`Message-ID: ${messageId}`);
  headers.push('MIME-Version: 1.0');
  headers.push('X-Unsent: 0');

  // Cuerpo: multipart/alternative cuando hay texto y HTML (FR-12).
  const textPart = parts.bodyText
    ? `Content-Type: text/plain; charset=utf-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(Buffer.from(parts.bodyText, 'utf-8'))}`
    : undefined;
  const htmlPart = parts.bodyHtml
    ? `Content-Type: text/html; charset=utf-8${CRLF}Content-Transfer-Encoding: base64${CRLF}${CRLF}${base64Lines(Buffer.from(parts.bodyHtml, 'utf-8'))}`
    : undefined;

  let bodySection: { headers: string[]; content: string };
  if (textPart && htmlPart) {
    const alt = boundary('alt');
    bodySection = {
      headers: [`Content-Type: multipart/alternative; boundary="${alt}"`],
      content: `--${alt}${CRLF}${textPart}${CRLF}--${alt}${CRLF}${htmlPart}${CRLF}--${alt}--`
    };
  } else {
    const only = htmlPart ?? textPart ?? `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}`;
    const idx = only.indexOf(CRLF + CRLF);
    bodySection = {
      headers: only.slice(0, idx).split(CRLF),
      content: only.slice(idx + 4)
    };
  }

  const attachments = parts.attachments.filter((a) => a.content.length > 0);
  if (attachments.length === 0) {
    return [...headers, ...bodySection.headers, '', bodySection.content, ''].join(CRLF);
  }

  const mixed = boundary('mixed');
  const out: string[] = [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, ''];
  out.push(`--${mixed}`);
  out.push(...bodySection.headers, '', bodySection.content);
  for (const a of attachments) {
    const mime = MIME_BY_EXT[a.extension] ?? 'application/octet-stream';
    const name = encodeHeaderWord(a.fileName);
    out.push(`--${mixed}`);
    out.push(`Content-Type: ${mime}; name="${name}"`);
    out.push('Content-Transfer-Encoding: base64');
    const disposition = a.contentId ? 'inline' : 'attachment';
    out.push(`Content-Disposition: ${disposition}; filename="${name}"`);
    if (a.contentId) out.push(`Content-ID: <${a.contentId}>`);
    out.push('', base64Lines(a.content));
  }
  out.push(`--${mixed}--`, '');
  return out.join(CRLF);
}

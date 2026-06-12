import { JSDOM } from 'jsdom';
import type { MsgDocument } from '@shared/types';

/** "Guardar como TXT": cabecera de metadatos + cuerpo en texto plano. */
export function documentToText(doc: MsgDocument): string {
  const m = doc.metadata;
  const fmt = (p: { name: string; email: string }) =>
    p.name && p.name !== p.email ? (p.email ? `${p.name} <${p.email}>` : p.name) : p.email;
  const byType = (type: 'to' | 'cc' | 'bcc') =>
    m.recipients
      .filter((r) => r.type === type)
      .map(fmt)
      .join('; ');

  const lines: string[] = [];
  lines.push(`Subject: ${m.subject}`);
  lines.push(`From: ${fmt(m.from)}`);
  const to = byType('to');
  const cc = byType('cc');
  const bcc = byType('bcc');
  if (to) lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  if (m.sentDate) lines.push(`Date: ${m.sentDate}`);
  const files = doc.attachments.filter((a) => !a.isInline).map((a) => a.fileName);
  if (files.length > 0) lines.push(`Attachments: ${files.join('; ')}`);
  lines.push('', '-'.repeat(60), '');

  // El cuerpo ya está sanitizado; textContent elimina todo el marcado.
  const dom = new JSDOM(`<body>${doc.bodyHtml}</body>`);
  const text = dom.window.document.body.textContent ?? '';
  lines.push(text.replace(/\n{3,}/g, '\n\n').trim());
  return lines.join('\n');
}

import type { MsgDocument } from '@shared/types';

/**
 * Documento HTML autónomo (cabecera de metadatos + cuerpo renderizado)
 * usado por las exportaciones PDF y PNG (FR-11, FR-13, §7.4).
 * El cuerpo ya viene sanitizado por el parser.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function addressLine(label: string, value: string): string {
  if (!value) return '';
  return `<tr><td class="label">${label}</td><td>${esc(value)}</td></tr>`;
}

function fmtDate(iso: string | undefined, locale: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' });
}

function fmtRecipients(doc: MsgDocument, type: 'to' | 'cc' | 'bcc'): string {
  return doc.metadata.recipients
    .filter((r) => r.type === type)
    .map((r) => (r.name && r.name !== r.email ? `${r.name} <${r.email}>` : r.email || r.name))
    .join('; ');
}

export function buildPrintableHtml(doc: MsgDocument, locale: string): string {
  const m = doc.metadata;
  const from = m.from.name && m.from.name !== m.from.email
    ? `${m.from.name} <${m.from.email}>`
    : m.from.email || m.from.name;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
  body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; background: #fff; }
  .meta { padding: 24px 32px 16px; border-bottom: 2px solid #d0d0d0; }
  .meta h1 { font-size: 18px; margin: 0 0 12px; }
  .meta table { border-collapse: collapse; font-size: 12px; }
  .meta td { padding: 2px 0; vertical-align: top; }
  .meta td.label { color: #666; padding-right: 12px; white-space: nowrap; font-weight: 600; }
  .body { padding: 16px 32px 32px; }
</style>
</head>
<body>
  <div class="meta">
    <h1>${esc(m.subject)}</h1>
    <table>
      ${addressLine(locale.startsWith('es') ? 'De' : 'From', from)}
      ${addressLine(locale.startsWith('es') ? 'Para' : 'To', fmtRecipients(doc, 'to'))}
      ${addressLine('CC', fmtRecipients(doc, 'cc'))}
      ${addressLine('BCC', fmtRecipients(doc, 'bcc'))}
      ${addressLine(locale.startsWith('es') ? 'Enviado' : 'Sent', fmtDate(m.sentDate, locale))}
      ${addressLine(locale.startsWith('es') ? 'Recibido' : 'Received', fmtDate(m.receivedDate, locale))}
    </table>
  </div>
  <div class="body">${doc.bodyHtml}</div>
</body>
</html>`;
}

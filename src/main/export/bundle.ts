import { createWriteStream } from 'node:fs';
import { ZipArchive } from 'archiver';
import type { ExportResult, MsgDocument } from '@shared/types';
import { getAnyAttachment } from '../parser/AnyMessage';
import { documentToText } from './textout';

/** MIME por extensión para las partes MHTML y los nombres del ZIP. */
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.zip': 'application/zip'
};

/**
 * Metadatos + cuerpo + adjuntos como JSON estructurado (para pipelines).
 * No incluye los bytes de adjuntos, solo su descripción (usar ZIP para eso).
 */
export function documentToJson(doc: MsgDocument): string {
  const m = doc.metadata;
  return JSON.stringify(
    {
      subject: m.subject,
      from: m.from,
      recipients: m.recipients,
      sentDate: m.sentDate ?? null,
      receivedDate: m.receivedDate ?? null,
      messageClass: m.messageClass,
      signaturePresent: m.hasSignature,
      bodySource: doc.bodySource,
      bodyHtml: doc.bodyHtml,
      attachments: doc.attachments.map((a) => ({
        fileName: a.fileName,
        extension: a.extension,
        size: a.size,
        inline: a.isInline,
        contentId: a.contentId ?? null,
        embeddedMessage: a.isEmbeddedMsg
      })),
      sourcePath: doc.sourcePath
    },
    null,
    2
  );
}

/**
 * MHTML (.mht): un solo archivo con la cabecera, el cuerpo HTML y cada
 * imagen inline como parte MIME, referenciada por su Content-ID. Lo abren
 * navegadores y Word; archiva el correo con sus imágenes embebidas.
 */
export async function exportMht(
  doc: MsgDocument,
  sourceBuffer: Buffer,
  filePath: string,
  printableHtml: string
): Promise<ExportResult> {
  const { writeFile } = await import('node:fs/promises');
  const boundary = `----=_mht_${Math.random().toString(36).slice(2, 10)}`;
  const CRLF = '\r\n';
  const parts: string[] = [];

  parts.push(
    `From: <Saved by MSG Viewer>`,
    `Subject: ${doc.metadata.subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    toQuotedPrintable(printableHtml),
    ''
  );

  // Cada imagen inline se incrusta como parte, localizada por su cid.
  for (const att of doc.attachments) {
    if (!att.contentId) continue;
    const data = await getAnyAttachment(sourceBuffer, att.id);
    if (!data) continue;
    const mime = MIME_BY_EXT[att.extension] ?? 'application/octet-stream';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${mime}`,
      'Content-Transfer-Encoding: base64',
      `Content-Location: cid:${att.contentId}`,
      `Content-ID: <${att.contentId}>`,
      '',
      base64Lines(Buffer.from(data.content)),
      ''
    );
  }
  parts.push(`--${boundary}--`, '');

  try {
    await writeFile(filePath, parts.join(CRLF), 'utf-8');
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * ZIP del caso completo: message.eml/.msg original, metadata.json, body.html,
 * body.txt y una carpeta attachments/ con cada adjunto real extraído.
 */
export async function exportZip(
  doc: MsgDocument,
  sourceBuffer: Buffer,
  filePath: string,
  isCfbf: boolean,
  printableHtml: string
): Promise<ExportResult> {
  return new Promise((resolve) => {
    const output = createWriteStream(filePath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    let settled = false;
    const finish = (r: ExportResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };

    output.on('close', () => finish({ ok: true, filePath }));
    archive.on('error', (err: Error) =>
      finish({ ok: false, reason: 'error', detail: err.message })
    );
    archive.pipe(output);

    archive.append(sourceBuffer, { name: isCfbf ? 'message.msg' : 'message.eml' });
    archive.append(documentToJson(doc), { name: 'metadata.json' });
    archive.append(printableHtml, { name: 'body.html' });
    archive.append(documentToText(doc), { name: 'body.txt' });

    void (async () => {
      const used = new Set<string>();
      for (const att of doc.attachments) {
        if (att.isInline) continue;
        const data = await getAnyAttachment(sourceBuffer, att.id);
        if (!data) continue;
        let name = data.fileName || `adjunto-${att.id}`;
        while (used.has(name.toLowerCase())) name = `_${name}`;
        used.add(name.toLowerCase());
        archive.append(Buffer.from(data.content), { name: `attachments/${name}` });
      }
      void archive.finalize();
    })();
  });
}

function base64Lines(content: Buffer): string {
  const b64 = content.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  return lines.join('\r\n');
}

/** Quoted-printable mínimo para el HTML del MHTML (ASCII-safe, líneas ≤76). */
function toQuotedPrintable(text: string): string {
  const bytes = Buffer.from(text, 'utf-8');
  let out = '';
  let lineLen = 0;
  const push = (token: string) => {
    if (lineLen + token.length > 75) {
      out += '=\r\n';
      lineLen = 0;
    }
    out += token;
    lineLen += token.length;
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x0d) continue;
    if (b === 0x0a) {
      out += '\r\n';
      lineLen = 0;
    } else if (b === 0x3d || b < 0x20 || b > 0x7e) {
      push(`=${b.toString(16).toUpperCase().padStart(2, '0')}`);
    } else {
      push(String.fromCharCode(b));
    }
  }
  return out;
}

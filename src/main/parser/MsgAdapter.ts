import MsgReaderModule, { type FieldsData } from '@kenjiuno/msgreader';

// Interop CJS↔ESM: en Node ESM el default import de un paquete CJS es
// module.exports; la clase vive en .default.
const MsgReader =
  (MsgReaderModule as unknown as { default?: typeof MsgReaderModule }).default ?? MsgReaderModule;
type MsgReader = InstanceType<typeof MsgReaderModule>;
import iconv from 'iconv-lite';
import type {
  BodySource,
  LoadError,
  LoadResult,
  MsgAttachmentMeta,
  MsgDocument,
  MsgRecipient
} from '@shared/types';
import {
  MAX_ATTACHMENTS,
  MAX_BODY_BYTES,
  MAX_FILE_SIZE,
  MAX_INLINE_IMAGE_BYTES,
  MAX_TOTAL_INLINE_BYTES
} from './limits';
import { plainTextToHtml, rtfCompressedToHtml } from './rtf';
import { sanitizeEmailHtml } from './sanitize';

export interface EmlParts {
  metadata: MsgDocument['metadata'];
  bodyText?: string;
  /** HTML original sin sanitizar (el EML debe preservar el contenido). */
  bodyHtml?: string;
  /** PidTagTransportMessageHeaders si el .msg los conserva (Message-ID, etc.). */
  transportHeaders?: string;
  attachments: {
    fileName: string;
    extension: string;
    contentId?: string;
    content: Uint8Array;
  }[];
}

const CFBF_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** Vista sin copia sobre el buffer, en el tipo que MsgReader acepta. */
function asDataView(buffer: Buffer): DataView {
  return new DataView(
    buffer.buffer as ArrayBuffer,
    buffer.byteOffset,
    buffer.byteLength
  );
}

/** Tamaño mínimo de un CFBF válido: cabecera de 512 bytes + un sector. */
const CFBF_MIN_SIZE = 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

/**
 * Adapter sobre @kenjiuno/msgreader (NFR-09): toda la superficie de la
 * librería queda encapsulada aquí; el resto de la aplicación solo conoce
 * los tipos de @shared/types.
 */
export class MsgAdapter {
  private reader: MsgReader;
  private fields: FieldsData;

  private constructor(reader: MsgReader, fields: FieldsData) {
    this.reader = reader;
    this.fields = fields;
  }

  /** Valida y parsea un buffer .msg. Nunca lanza: todo error es un LoadError. */
  static parse(buffer: Buffer, sourcePath: string): LoadResult {
    const error = (code: LoadError['code'], detail?: string): LoadResult => ({
      ok: false,
      error: { code, detail }
    });

    if (buffer.length > MAX_FILE_SIZE) {
      return error('too-large', `${buffer.length} bytes (límite ${MAX_FILE_SIZE})`);
    }
    if (buffer.length < CFBF_SIGNATURE.length || !buffer.subarray(0, 8).equals(CFBF_SIGNATURE)) {
      return error('not-cfbf');
    }
    if (buffer.length < CFBF_MIN_SIZE) {
      return error('truncated', `${buffer.length} bytes`);
    }

    let reader: MsgReader;
    let fields: FieldsData;
    try {
      reader = new MsgReader(asDataView(buffer));
      fields = reader.getFileData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sector|offset|bounds|length|size/i.test(msg)) return error('truncated', msg);
      return error('parse-error', msg);
    }
    if (fields.error) {
      return error('parse-error', fields.error);
    }

    const messageClass = fields.messageClass ?? 'IPM.Note';
    if (/^IPM\.Note\.SMIME$/i.test(messageClass)) {
      return error('encrypted', messageClass);
    }
    if (!/^IPM\.Note(\.|$)/i.test(messageClass)) {
      return error('unsupported-class', messageClass);
    }

    try {
      const adapter = new MsgAdapter(reader, fields);
      return { ok: true, document: adapter.toDocument(sourcePath) };
    } catch (e) {
      return error('parse-error', e instanceof Error ? e.message : String(e));
    }
  }

  /** Bytes de un adjunto, para escritura a disco bajo demanda (FR-10). */
  static getAttachmentContent(
    buffer: Buffer,
    attachmentId: number
  ): { fileName: string; content: Uint8Array } | null {
    try {
      const reader = new MsgReader(asDataView(buffer));
      const fields = reader.getFileData();
      const attachment = fields.attachments?.[attachmentId];
      if (!attachment) return null;
      const data = reader.getAttachment(attachment);
      return { fileName: data.fileName, content: data.content };
    } catch {
      return null;
    }
  }

  /**
   * Partes crudas para la reconstrucción EML (FR-12, L-02): cuerpo sin
   * sanitizar (el EML conserva el HTML original) y bytes de adjuntos.
   */
  static getEmlParts(buffer: Buffer): EmlParts | null {
    const result = MsgAdapter.parse(buffer, '');
    if (!result.ok) return null;
    try {
      const reader = new MsgReader(asDataView(buffer));
      const fields = reader.getFileData();
      const adapter = new MsgAdapter(reader, fields);
      const { html, source } = adapter.resolveBody();
      // El <pre> sintético de la vía texto plano no es HTML real del mensaje.
      const realHtml = source === 'plaintext' ? undefined : (html ?? undefined);
      const attachments = (fields.attachments ?? []).slice(0, MAX_ATTACHMENTS).map((a, i) => {
        let content: Uint8Array = new Uint8Array(0);
        try {
          content = reader.getAttachment(a).content;
        } catch {
          // Adjunto ilegible: se omite del EML pero no aborta la exportación.
        }
        const fileName = a.fileName ?? a.fileNameShort ?? a.name ?? `adjunto-${i + 1}`;
        return {
          fileName,
          extension: (a.extension ?? extOf(fileName)).toLowerCase(),
          contentId: a.pidContentId?.replace(/^<|>$/g, ''),
          content
        };
      });
      return {
        metadata: result.document.metadata,
        bodyText: fields.body,
        bodyHtml: realHtml,
        transportHeaders: fields.headers,
        attachments
      };
    } catch {
      return null;
    }
  }

  /** Propiedades MAPI crudas para la vista de código fuente (OBJ-S3). */
  static getRawProperties(buffer: Buffer): { tag: string; name?: string; value: string }[] | null {
    try {
      const reader = new MsgReader(asDataView(buffer));
      reader.parserConfig = { includeRawProps: true };
      const fields = reader.getFileData();
      return (fields.rawProps ?? []).map((p) => {
        let value: string;
        if (p.value instanceof Uint8Array) {
          value = `(binario, ${p.value.length} bytes) ${Buffer.from(p.value.subarray(0, 24)).toString('hex')}…`;
        } else {
          value = String(p.value ?? '');
        }
        return {
          tag: p.propertyTag ?? p.propertyLid ?? '????????',
          name: p.propertyName,
          value: value.length > 400 ? `${value.slice(0, 400)}…` : value
        };
      });
    } catch {
      return null;
    }
  }

  private toDocument(sourcePath: string): MsgDocument {
    const { html, source } = this.resolveBody();
    const attachments = this.listAttachments(html ?? '');
    const withInline = html ? this.embedInlineImages(html, attachments) : '';
    return {
      metadata: this.extractMetadata(),
      bodyHtml: sanitizeEmailHtml(withInline),
      bodySource: source,
      attachments,
      sourcePath
    };
  }

  private extractMetadata(): MsgDocument['metadata'] {
    const f = this.fields;
    const recipients: MsgRecipient[] = (f.recipients ?? []).map((r) => ({
      name: r.name ?? '',
      email: bestSmtpAddress(r.smtpAddress, r.email),
      type: (r.recipType as MsgRecipient['type']) ?? 'to'
    }));
    return {
      subject: f.subject ?? '',
      from: {
        name: f.senderName ?? '',
        email: bestSmtpAddress(f.senderSmtpAddress, f.creatorSMTPAddress, f.senderEmail)
      },
      recipients,
      sentDate: toIso(f.clientSubmitTime),
      receivedDate: toIso(f.messageDeliveryTime),
      messageClass: f.messageClass ?? 'IPM.Note',
      hasSignature: /smime/i.test(f.messageClass ?? ''),
      importance: undefined
    };
  }

  /** FR-07: HTML nativo → RTF → texto plano. */
  private resolveBody(): { html: string | null; source: BodySource } {
    const f = this.fields;

    if (f.html && f.html.length > 0) {
      if (f.html.length > MAX_BODY_BYTES) throw new Error('Cuerpo HTML excede el límite');
      return { html: decodeHtmlBytes(f.html, f.internetCodepage), source: 'html' };
    }
    if (typeof f.bodyHtml === 'string' && f.bodyHtml.length > 0) {
      return { html: f.bodyHtml, source: 'html' };
    }

    if (f.compressedRtf && f.compressedRtf.length > 0) {
      if (f.compressedRtf.length > MAX_BODY_BYTES) throw new Error('Cuerpo RTF excede el límite');
      const result = rtfCompressedToHtml(f.compressedRtf);
      if (result) {
        return {
          html: result.html,
          source: result.deEncapsulated ? 'rtf-deencapsulated' : 'rtf-converted'
        };
      }
    }

    if (typeof f.body === 'string' && f.body.length > 0) {
      return { html: plainTextToHtml(f.body), source: 'plaintext' };
    }
    return { html: null, source: 'plaintext' };
  }

  private listAttachments(bodyHtml: string): MsgAttachmentMeta[] {
    const list = (this.fields.attachments ?? []).slice(0, MAX_ATTACHMENTS);
    return list.map((a, index) => {
      const fileName = a.fileName ?? a.fileNameShort ?? a.name ?? `adjunto-${index + 1}`;
      const extension = (a.extension ?? extOf(fileName)).toLowerCase();
      const contentId = a.pidContentId?.replace(/^<|>$/g, '');
      const referenced =
        contentId !== undefined && contentId !== '' && bodyHtml.includes(`cid:${contentId}`);
      return {
        id: index,
        fileName,
        extension,
        size: a.contentLength ?? 0,
        isInline: Boolean(a.attachmentHidden) || referenced,
        contentId,
        isEmbeddedMsg: Boolean(a.innerMsgContent)
      };
    });
  }

  /** FR-09: resuelve referencias cid: a data: URIs antes de sanitizar. */
  private embedInlineImages(html: string, attachments: MsgAttachmentMeta[]): string {
    let budget = MAX_TOTAL_INLINE_BYTES;
    let out = html;
    for (const meta of attachments) {
      if (!meta.contentId || !html.includes(`cid:${meta.contentId}`)) continue;
      const raw = this.fields.attachments?.[meta.id];
      if (!raw) continue;
      let content: Uint8Array;
      try {
        content = this.reader.getAttachment(raw).content;
      } catch {
        continue;
      }
      if (content.length > MAX_INLINE_IMAGE_BYTES || content.length > budget) continue;
      budget -= content.length;
      const mime = MIME_BY_EXT[meta.extension] ?? 'application/octet-stream';
      const dataUri = `data:${mime};base64,${Buffer.from(content).toString('base64')}`;
      out = out.split(`cid:${meta.contentId}`).join(dataUri);
    }
    return out;
  }
}

/**
 * En mensajes internos de Exchange, PidTagEmailAddress contiene el DN X.500
 * (/o=ExchangeLabs/...), no una dirección utilizable. Se elige la primera
 * candidata con forma SMTP; si solo existe el DN, se omite el email.
 */
function bestSmtpAddress(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    if (c && c.includes('@') && !c.startsWith('/')) return c;
  }
  return '';
}

function toIso(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 ? fileName.slice(i) : '';
}

/** Decodifica PidTagHtml según el codepage declarado, con UTF-8 por defecto. */
function decodeHtmlBytes(bytes: Uint8Array, codepage?: number): string {
  const buf = Buffer.from(bytes);
  if (codepage && codepage !== 65001 && iconv.encodingExists(`cp${codepage}`)) {
    return iconv.decode(buf, `cp${codepage}`);
  }
  return buf.toString('utf-8');
}

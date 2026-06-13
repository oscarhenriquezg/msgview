/**
 * Contrato IPC compartido entre main y renderer (SRS §7.3).
 * Los bytes de los adjuntos nunca cruzan este contrato: el renderer solo ve
 * metadatos; la escritura a disco ocurre en main bajo demanda.
 */

export type BodySource = 'html' | 'rtf-deencapsulated' | 'rtf-converted' | 'plaintext';

export interface MsgRecipient {
  name: string;
  email: string;
  type: 'to' | 'cc' | 'bcc';
}

export interface MsgAttachmentMeta {
  /** Índice estable dentro del .msg, usado para pedir el guardado. */
  id: number;
  fileName: string;
  extension: string;
  size: number;
  /** Adjunto inline usado solo para renderizado (imagen cid:). */
  isInline: boolean;
  /** Content-ID si existe (sin <>). */
  contentId?: string;
  /** Adjunto que es a su vez un mensaje .msg incrustado (OBJ-S2). */
  isEmbeddedMsg: boolean;
}

export interface MsgMetadata {
  subject: string;
  from: { name: string; email: string };
  recipients: MsgRecipient[];
  sentDate?: string; // ISO 8601
  receivedDate?: string; // ISO 8601
  messageClass: string;
  /** OBJ-S1: indicadores extendidos si la librería los expone. */
  importance?: 'low' | 'normal' | 'high';
  hasSignature: boolean; // S/MIME firmado (no verificado), §1.2
}

export interface MsgDocument {
  metadata: MsgMetadata;
  /** HTML ya sanitizado en main (DOMPurify); listo para srcdoc del iframe. */
  bodyHtml: string;
  bodySource: BodySource;
  attachments: MsgAttachmentMeta[];
  /** Ruta del archivo origen (para título de ventana y exportaciones). */
  sourcePath: string;
}

export type LoadErrorCode =
  | 'not-found'
  | 'not-cfbf'
  | 'truncated'
  | 'encrypted'
  | 'unsupported-class'
  | 'too-large'
  | 'parse-error';

export interface LoadError {
  code: LoadErrorCode;
  /** Detalle técnico opcional (clase del mensaje, byte offset, etc.). */
  detail?: string;
}

export type LoadResult =
  | { ok: true; document: MsgDocument }
  | { ok: false; error: LoadError };

export type ExportFormat = 'pdf' | 'eml' | 'png' | 'html' | 'txt' | 'mht' | 'json' | 'zip';

export interface ExportRequest {
  format: ExportFormat;
  /** PNG: aceptar truncado a MAX_PNG_HEIGHT si el contenido lo excede. */
  acceptTruncation?: boolean;
  /** PNG: archivo en disco (defecto) o portapapeles. */
  target?: 'file' | 'clipboard';
}

export type ExportResult =
  | { ok: true; filePath?: string }
  | { ok: false; reason: 'cancelled' | 'error' | 'png-too-tall'; detail?: string; contentHeight?: number };

export interface AttachmentSaveRequest {
  /** ids a guardar; vacío o ausente = todos los no-inline ("Guardar todos"). */
  ids?: number[];
}

export type AttachmentSaveResult =
  | { ok: true; savedPaths: string[] }
  | { ok: false; reason: 'cancelled' | 'error'; detail?: string };

/** Límite FR-13. */
export const MAX_PNG_HEIGHT = 20_000;

/** API expuesta al renderer vía contextBridge (preload). */
export interface MsgViewerApi {
  /** Abre el diálogo nativo de "Abrir archivo" y carga el .msg elegido. */
  openFileDialog(): Promise<LoadResult | null>;
  /** Carga un archivo arrastrado (el renderer solo conoce la ruta). */
  openPath(path: string): Promise<LoadResult>;
  /** Abre un .msg incrustado como documento activo (OBJ-S2). */
  openEmbedded(attachmentId: number): Promise<LoadResult>;
  saveAttachments(req: AttachmentSaveRequest): Promise<AttachmentSaveResult>;
  exportDocument(req: ExportRequest): Promise<ExportResult>;
  showInFolder(path: string): void;
  /** main → renderer: un documento nuevo reemplaza al actual (FR-03). */
  onDocumentLoaded(cb: (result: LoadResult) => void): void;
  /** main → renderer: acciones del menú de aplicación. */
  onMenuAction(
    cb: (
      action:
        | { type: 'open' }
        | { type: 'export'; format: ExportFormat }
        | { type: 'print' }
        | { type: 'find' }
        | { type: 'save-as' }
        | { type: 'copy-meta'; as: 'text' | 'json' }
    ) => void
  ): void;
  /**
   * "Guardar como": copia original, PDF, EML, PNG, HTML o TXT según la
   * extensión elegida en el diálogo.
   */
  saveAs(): Promise<ExportResult>;
  /** "Nuevo": descarta el documento de esta ventana en main. */
  clearDocument(): Promise<void>;
  /** Vista de código fuente: cabeceras completas y cuerpo (ventana nueva). */
  viewSource(): void;
  /** Zoom de la interfaz: delta en niveles de Chromium (±0.5 por paso). */
  zoom(delta: number): void;
  /** Abre la ventana "Acerca de". */
  showAbout(): void;
  /**
   * Solicita abrir una URL externa en el navegador del sistema; main
   * muestra la advertencia de confianza antes de salir del visor.
   */
  openExternal(url: string): void;
  /** Menú nativo del botón PNG: guardar a archivo o copiar al portapapeles. */
  askPngAction(): Promise<'save' | 'copy' | null>;
  /** Imprime el documento con el diálogo de impresión del sistema. */
  printDocument(): Promise<ExportResult>;
  /** Copia texto al portapapeles del sistema. */
  copyText(text: string): void;
  /** Menú nativo Abrir/Guardar para un adjunto (clic en el chip). */
  showAttachmentMenu(attachmentId: number): void;
  /** main → renderer: notificaciones para mostrar como toast (UI-06). */
  onToast(cb: (t: { message: string; path?: string; isError?: boolean }) => void): void;
  /** Locale del sistema para i18n (UI-05). */
  getLocale(): Promise<string>;
  /**
   * Documento de esta ventana, si main ya tiene uno (recarga del renderer,
   * ventana de .msg anidado). Pull en init: inmune a carreras de arranque.
   */
  getCurrentDocument(): Promise<MsgDocument | null>;
}

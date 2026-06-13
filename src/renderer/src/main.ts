import type { LoadResult, MsgAttachmentMeta, MsgDocument } from '@shared/types';
import { MAX_PNG_HEIGHT } from '@shared/types';
import { ICONS } from './icons';
import { initI18n, locale, t } from './i18n';

const api = window.msgViewer;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  toolbar: $('toolbar'),
  header: $('header'),
  subject: $('subject'),
  signatureBadge: $('signature-badge'),
  metaTable: $<HTMLTableElement>('meta-table'),
  attachments: $('attachments'),
  attachmentRow: $('attachment-row'),
  emptyState: $('empty-state'),
  errorState: $('error-state'),
  errorTitle: $('error-title'),
  errorMessage: $('error-message'),
  errorDetail: $('error-detail'),
  viewer: $('viewer'),
  bodyFrame: $<HTMLIFrameElement>('body-frame'),
  pngDialog: $<HTMLDialogElement>('png-dialog'),
  toasts: $('toasts'),
  findbar: $('findbar'),
  findInput: $<HTMLInputElement>('find-input'),
  findCount: $('find-count'),
  linkbar: $('linkbar')
};

/** Documento mostrado (para copiar metadatos). */
let currentDoc: MsgDocument | null = null;
/** Unlink: con true, los enlaces del cuerpo quedan inertes. */
let linksDisabled = false;

function applyLinkState(): void {
  el.bodyFrame.contentDocument?.body?.classList.toggle('__nolinks', linksDisabled);
  $('btn-unlink').setAttribute('aria-pressed', String(linksDisabled));
}

// ---------------------------------------------------------------------------
// Estados de la ventana: vacío | error | documento (FR-03/04/05)
// ---------------------------------------------------------------------------

function setDocButtonsEnabled(enabled: boolean): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-needs-doc]')) {
    b.disabled = !enabled;
  }
}

function showEmpty(): void {
  currentDoc = null;
  setDocButtonsEnabled(false);
  closeFindBar();
  el.header.hidden = true;
  el.viewer.hidden = true;
  el.errorState.hidden = true;
  el.emptyState.hidden = false;
}

function showError(result: Extract<LoadResult, { ok: false }>): void {
  currentDoc = null;
  setDocButtonsEnabled(false);
  closeFindBar();
  el.header.hidden = true;
  el.viewer.hidden = true;
  el.emptyState.hidden = true;
  el.errorState.hidden = false;
  el.errorTitle.textContent = t('error.title');
  el.errorMessage.textContent = t(`error.${result.error.code}`, {
    detail: result.error.detail ?? ''
  });
  el.errorDetail.textContent =
    result.error.detail && result.error.code !== 'unsupported-class'
      ? `${t('error.detail')}: ${result.error.detail}`
      : '';
}

function showDocument(doc: MsgDocument): void {
  currentDoc = doc;
  el.emptyState.hidden = true;
  el.errorState.hidden = true;
  setDocButtonsEnabled(true);
  el.header.hidden = false;
  el.viewer.hidden = false;

  el.subject.textContent = doc.metadata.subject || t('header.noSubject');
  el.signatureBadge.hidden = !doc.metadata.hasSignature;
  el.signatureBadge.textContent = t('header.signature');
  renderMetaTable(doc);
  renderAttachments(doc.attachments);
  renderBody(doc.bodyHtml);
}

function metaRow(label: string, value: HTMLElement | string): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.className = 'label';
  tdLabel.textContent = label;
  const tdValue = document.createElement('td');
  tdValue.className = 'value';
  if (typeof value === 'string') tdValue.textContent = value;
  else tdValue.append(value);
  tr.append(tdLabel, tdValue);
  return tr;
}

/** Direcciones copiables con un clic + "copiar todos" por campo. */
function addressCell(people: { name: string; email: string }[]): HTMLElement {
  const cell = document.createElement('span');
  people.forEach((p, i) => {
    if (i > 0) cell.append('; ');
    const display =
      p.name && p.name !== p.email ? (p.email ? `${p.name} <${p.email}>` : p.name) : p.email || p.name;
    if (p.email) {
      const span = document.createElement('span');
      span.className = 'email-copy';
      span.textContent = display;
      span.title = `${t('meta.clickToCopy')}: ${p.email}`;
      span.tabIndex = 0;
      span.setAttribute('role', 'button');
      const copy = () => {
        api.copyText(p.email);
        toast(t('toast.copied', { what: p.email }));
      };
      span.addEventListener('click', copy);
      span.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') copy();
      });
      cell.append(span);
    } else {
      cell.append(display);
    }
  });

  const emails = people.map((p) => p.email).filter(Boolean);
  if (emails.length > 1) {
    const all = document.createElement('button');
    all.className = 'copy-all';
    all.textContent = '⧉';
    all.title = t('meta.copyAll', { n: emails.length });
    all.addEventListener('click', () => {
      api.copyText(emails.join('; '));
      toast(t('toast.copied', { what: t('meta.copyAll', { n: emails.length }) }));
    });
    cell.append(' ', all);
  }
  return cell;
}

function renderMetaTable(doc: MsgDocument): void {
  const m = doc.metadata;
  const rows: HTMLTableRowElement[] = [];
  rows.push(metaRow(t('header.from'), addressCell([m.from])));
  for (const type of ['to', 'cc', 'bcc'] as const) {
    const people = m.recipients.filter((r) => r.type === type);
    if (people.length > 0) {
      rows.push(metaRow(t(`header.${type}`), addressCell(people)));
    }
  }
  const dateFmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' }) : '';
  if (m.sentDate) rows.push(metaRow(t('header.sent'), dateFmt(m.sentDate)));
  if (m.receivedDate) rows.push(metaRow(t('header.received'), dateFmt(m.receivedDate)));

  el.metaTable.replaceChildren(...rows);
}

// ---------------------------------------------------------------------------
// Adjuntos (FR-10, UI-02): chips, inline agrupados aparte
// ---------------------------------------------------------------------------

const FILE_ICONS: Record<string, string> = {
  '.pdf': '📄', '.doc': '📝', '.docx': '📝', '.xls': '📊', '.xlsx': '📊',
  '.ppt': '📽️', '.pptx': '📽️', '.zip': '🗜️', '.rar': '🗜️', '.7z': '🗜️',
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.csv': '📊',
  '.txt': '📃', '.msg': '✉️', '.eml': '✉️'
};

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeChip(a: MsgAttachmentMeta): HTMLElement {
  const chip = document.createElement('div');
  chip.className = a.isInline ? 'chip inline' : 'chip';
  chip.setAttribute('role', 'listitem');
  // Clic en cualquier parte del chip: menú nativo Abrir / Guardar.
  chip.tabIndex = 0;
  chip.title = a.fileName;
  chip.addEventListener('click', () => api.showAttachmentMenu(a.id));
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') api.showAttachmentMenu(a.id);
  });

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = FILE_ICONS[a.extension] ?? '📎';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = a.fileName;
  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = fmtSize(a.size);
  chip.append(icon, name, size);

  if (a.isEmbeddedMsg) {
    const openBtn = document.createElement('button');
    openBtn.textContent = '↗';
    openBtn.title = t('attachments.openMsg');
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void openEmbedded(a.id);
    });
    chip.append(openBtn);
  }
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '⬇';
  saveBtn.title = `${t('attachments.save')}: ${a.fileName}`;
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void saveAttachments([a.id]);
  });
  chip.append(saveBtn);
  return chip;
}

function renderAttachments(attachments: MsgAttachmentMeta[]): void {
  const real = attachments.filter((a) => !a.isInline);
  const inline = attachments.filter((a) => a.isInline);
  el.attachments.hidden = attachments.length === 0;
  const children: HTMLElement[] = [];

  if (real.length > 0) {
    const label = document.createElement('div');
    label.className = 'attachment-group-label';
    label.textContent = t('attachments.real');
    children.push(label);
  }
  for (const a of real) children.push(makeChip(a));
  if (real.length > 1) {
    const saveAll = document.createElement('button');
    saveAll.className = 'btn';
    saveAll.textContent = t('attachments.saveAll');
    saveAll.addEventListener('click', () => void saveAttachments());
    children.push(saveAll);
  }
  if (inline.length > 0) {
    const label = document.createElement('div');
    label.className = 'attachment-group-label';
    label.textContent = t('attachments.inline');
    children.push(label);
    for (const a of inline) children.push(makeChip(a));
  }
  el.attachmentRow.replaceChildren(...children);
}

// ---------------------------------------------------------------------------
// Cuerpo (FR-08): iframe sandbox + CSP; el HTML ya viene sanitizado de main
// ---------------------------------------------------------------------------

function renderBody(sanitizedHtml: string): void {
  // FR-02b: los eventos de arrastre no cruzan al padre; se enganchan dentro.
  // El iframe es allow-same-origin sin allow-scripts: accesible e inerte.
  el.bodyFrame.onload = () => {
    const doc = el.bodyFrame.contentDocument;
    if (!doc) return;
    doc.addEventListener('dragover', (e) => e.preventDefault());
    doc.addEventListener('drop', (e) => {
      e.preventDefault();
      handleDrop(e.dataTransfer?.files);
    });
    // Barra de estado anti-phishing: la URL real del enlace bajo el cursor.
    doc.addEventListener('mouseover', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      const href = a?.getAttribute('href');
      if (href && !href.startsWith('data:')) {
        el.linkbar.textContent = href;
        el.linkbar.hidden = false;
      }
    });
    doc.addEventListener('mouseout', (e) => {
      if ((e.target as Element | null)?.closest?.('a[href]')) {
        el.linkbar.hidden = true;
        el.linkbar.textContent = '';
      }
    });
    // Esc y Ctrl+F también con el foco dentro del iframe.
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.findbar.hidden) closeFindBar();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openFindBar();
      }
    });
    // Advertencia anti-phishing: salir del visor requiere confirmación.
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      if (linksDisabled) return;
      const href = a.getAttribute('href') ?? '';
      if (/^(https?:|mailto:)/i.test(href)) api.openExternal(href);
    });
    applyLinkState();
  };
  el.bodyFrame.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
  body { margin: 16px; background: #fff; color: #1a1a1a;
         font-family: system-ui, sans-serif; font-size: 14px; }
  mark.__find { background: #ffe066; color: inherit; padding: 0; }
  mark.__find.__find-active { background: #ff9632; outline: 2px solid #ff9632; }
  body.__nolinks a { pointer-events: none; opacity: 0.55; text-decoration: line-through; }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

function applyResult(result: LoadResult | null): void {
  if (!result) return; // diálogo cancelado
  if (result.ok) showDocument(result.document);
  else showError(result);
}

async function openDialog(): Promise<void> {
  applyResult(await api.openFileDialog());
}

/** OBJ-S2: el .msg anidado se abre en ventana nueva; aquí solo errores. */
async function openEmbedded(id: number): Promise<void> {
  const result = await api.openEmbedded(id);
  if (!result.ok) {
    toast(t(`error.${result.error.code}`, { detail: result.error.detail ?? '' }), undefined, true);
  }
}

/**
 * Solo se aceptan archivos .msg reales. Los arrastres internos (una imagen
 * del propio correo) llegan sin ruta y no deben tocar la vista actual.
 */
function handleDrop(files?: FileList): void {
  const file = files?.[0];
  if (!file || !/\.(msg|eml|emlx)$/i.test(file.name)) return;
  void api.openDroppedFile(file).then(applyResult);
}

async function saveAttachments(ids?: number[]): Promise<void> {
  const result = await api.saveAttachments({ ids });
  if (result.ok) {
    const first = result.savedPaths[0];
    toast(
      result.savedPaths.length === 1
        ? t('toast.saved')
        : t('toast.savedCount', { n: result.savedPaths.length }),
      first
    );
  } else if (result.reason === 'error') {
    toast(`${t('toast.saveError')}: ${result.detail ?? ''}`, undefined, true);
  }
}

/** Recordado para reintentar tras el diálogo de truncado PNG (FR-13). */
let pngTarget: 'file' | 'clipboard' = 'file';

async function exportDocument(
  format: 'pdf' | 'eml' | 'png' | 'html' | 'txt' | 'mht' | 'json' | 'zip',
  acceptTruncation = false,
  target: 'file' | 'clipboard' = 'file'
): Promise<void> {
  if (format === 'png') pngTarget = target;
  const result = await api.exportDocument({ format, acceptTruncation, target });
  if (result.ok) {
    if (format === 'png' && target === 'clipboard') toast(t('toast.pngCopied'));
    else toast(`${t('toast.exported')}: ${format.toUpperCase()}`, result.filePath);
  } else if (result.reason === 'png-too-tall') {
    askPngTruncation(result.contentHeight ?? 0);
  } else if (result.reason === 'error') {
    toast(`${t('toast.exportError')}: ${result.detail ?? ''}`, undefined, true);
  }
}

async function doSaveAs(): Promise<void> {
  const r = await api.saveAs();
  if (r.ok) toast(t('toast.saved'), r.filePath);
  else if (r.reason === 'error') toast(`${t('toast.saveError')}: ${r.detail ?? ''}`, undefined, true);
}

/** Botón PNG: menú nativo Guardar / Copiar al portapapeles. */
async function pngButtonClicked(): Promise<void> {
  const action = await api.askPngAction();
  if (action) void exportDocument('png', false, action === 'copy' ? 'clipboard' : 'file');
}

/** FR-13: el contenido excede el límite → truncar o cancelar. */
function askPngTruncation(contentHeight: number): void {
  $('png-dialog-title').textContent = t('png.tooTall.title');
  $('png-dialog-body').textContent = t('png.tooTall.body', {
    h: contentHeight,
    max: MAX_PNG_HEIGHT
  });
  el.pngDialog.showModal();
}

// ---------------------------------------------------------------------------
// Búsqueda en el mensaje (Ctrl+F): findInPage nativo vía main
// ---------------------------------------------------------------------------

let findDebounce: ReturnType<typeof setTimeout> | undefined;
let findMarks: HTMLElement[] = [];
let findActive = -1;

function openFindBar(): void {
  if (el.viewer.hidden) return;
  el.findbar.hidden = false;
  el.findInput.focus();
  el.findInput.select();
}

function closeFindBar(): void {
  el.findbar.hidden = true;
  el.findCount.textContent = '';
  clearSearch();
}

/** Deshace los <mark> dejando el DOM del cuerpo como estaba. */
function clearSearch(): void {
  const doc = el.bodyFrame.contentDocument;
  findMarks = [];
  findActive = -1;
  if (!doc) return;
  for (const mark of Array.from(doc.querySelectorAll('mark.__find'))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(doc.createTextNode(mark.textContent ?? ''), mark);
    parent.normalize();
  }
}

/**
 * Búsqueda propia en el cuerpo: envuelve coincidencias en <mark> y desplaza
 * la activa a la vista (el findInPage nativo no garantiza el scroll dentro
 * del iframe). Coincidencias por nodo de texto, sin cruzar etiquetas.
 */
function searchInBody(query: string): void {
  clearSearch();
  const doc = el.bodyFrame.contentDocument;
  if (!doc || !query) {
    el.findCount.textContent = '';
    return;
  }
  const needle = query.toLowerCase();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) textNodes.push(n as Text);

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    let from = 0;
    let idx = lower.indexOf(needle, from);
    if (idx === -1) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    while (idx !== -1 && findMarks.length < 5000) {
      frag.append(doc.createTextNode(text.slice(last, idx)));
      const mark = doc.createElement('mark');
      mark.className = '__find';
      mark.textContent = text.slice(idx, idx + query.length);
      frag.append(mark);
      findMarks.push(mark);
      last = idx + query.length;
      from = last;
      idx = lower.indexOf(needle, from);
    }
    frag.append(doc.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
  if (findMarks.length > 0) setActiveMatch(0);
  else el.findCount.textContent = t('find.count', { a: 0, n: 0 });
}

/** Activa la coincidencia i, la resalta y la centra en el visor. */
function setActiveMatch(i: number): void {
  if (findMarks.length === 0) return;
  if (findActive >= 0) findMarks[findActive]?.classList.remove('__find-active');
  findActive = ((i % findMarks.length) + findMarks.length) % findMarks.length;
  const mark = findMarks[findActive]!;
  mark.classList.add('__find-active');
  mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.findCount.textContent = t('find.count', { a: findActive + 1, n: findMarks.length });
}

function setupFindBar(): void {
  // Además del acelerador del menú: garantiza Ctrl/Cmd+F aunque el foco
  // esté en cualquier parte del documento.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      openFindBar();
    } else if (e.key === 'Escape' && !el.findbar.hidden) {
      closeFindBar();
    }
  });
  el.findInput.addEventListener('input', () => {
    clearTimeout(findDebounce);
    const text = el.findInput.value;
    findDebounce = setTimeout(() => searchInBody(text), 150);
  });
  el.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setActiveMatch(findActive + (e.shiftKey ? -1 : 1));
    else if (e.key === 'Escape') closeFindBar();
  });
  $('find-next').addEventListener('click', () => setActiveMatch(findActive + 1));
  $('find-prev').addEventListener('click', () => setActiveMatch(findActive - 1));
  $('find-close').addEventListener('click', closeFindBar);
}

// ---------------------------------------------------------------------------
// Copiar metadatos completos (texto / JSON)
// ---------------------------------------------------------------------------

function copyMetadata(as: 'text' | 'json'): void {
  if (!currentDoc) return;
  const m = currentDoc.metadata;
  const fmt = (p: { name: string; email: string }) =>
    p.name && p.name !== p.email ? (p.email ? `${p.name} <${p.email}>` : p.name) : p.email;
  const byType = (type: 'to' | 'cc' | 'bcc') =>
    m.recipients.filter((r) => r.type === type).map(fmt);
  const files = currentDoc.attachments.filter((a) => !a.isInline).map((a) => a.fileName);

  let out: string;
  if (as === 'json') {
    out = JSON.stringify(
      {
        subject: m.subject,
        from: fmt(m.from),
        to: byType('to'),
        cc: byType('cc'),
        bcc: byType('bcc'),
        sentDate: m.sentDate ?? null,
        receivedDate: m.receivedDate ?? null,
        messageClass: m.messageClass,
        signaturePresent: m.hasSignature,
        attachments: files,
        sourcePath: currentDoc.sourcePath
      },
      null,
      2
    );
  } else {
    const lines = [
      `${t('header.subject')}: ${m.subject}`,
      `${t('header.from')}: ${fmt(m.from)}`
    ];
    const to = byType('to');
    const cc = byType('cc');
    const bcc = byType('bcc');
    if (to.length) lines.push(`${t('header.to')}: ${to.join('; ')}`);
    if (cc.length) lines.push(`${t('header.cc')}: ${cc.join('; ')}`);
    if (bcc.length) lines.push(`${t('header.bcc')}: ${bcc.join('; ')}`);
    if (m.sentDate) lines.push(`${t('header.sent')}: ${m.sentDate}`);
    if (m.receivedDate) lines.push(`${t('header.received')}: ${m.receivedDate}`);
    if (files.length) lines.push(`${t('attachments.title')}: ${files.join('; ')}`);
    out = lines.join('\n');
  }
  api.copyText(out);
  toast(t('toast.metaCopied'));
}

// ---------------------------------------------------------------------------
// Toasts (UI-06)
// ---------------------------------------------------------------------------

function toast(message: string, pathForFolder?: string, isError = false): void {
  const node = document.createElement('div');
  node.className = isError ? 'toast error' : 'toast';
  const text = document.createElement('span');
  text.textContent = message;
  node.append(text);
  if (pathForFolder) {
    const btn = document.createElement('button');
    btn.textContent = t('toast.showInFolder');
    btn.addEventListener('click', () => api.showInFolder(pathForFolder));
    node.append(btn);
  }
  el.toasts.append(node);
  // El CSS desvanece el toast a los 5 s (4,5 s visible + 0,5 s de fundido).
  setTimeout(() => node.remove(), 5000);
}

// ---------------------------------------------------------------------------
// Drag & drop (FR-02b): en estado vacío y con documento cargado
// ---------------------------------------------------------------------------

function setupDragAndDrop(): void {
  const dropZone = $('drop-zone');
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  document.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dropZone.classList.remove('drag-over');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    handleDrop(e.dataTransfer?.files);
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initI18n(await api.getLocale());
  document.title = t('app.title');

  $('welcome-title').textContent = t('welcome.title');
  $('welcome-hint').textContent = t('welcome.hint');
  $('welcome-or').textContent = t('welcome.or');
  $('btn-welcome-open').textContent = t('welcome.open');
  const iconBtn = (id: string, icon: string, title: string) => {
    const b = $(id);
    b.innerHTML = icon; // SVG estático de Lucide, contenido propio de la app
    b.title = title;
  };
  iconBtn('btn-new', ICONS.new, t('actions.new'));
  iconBtn('btn-open', ICONS.open, t('actions.open'));
  iconBtn('btn-save-as', ICONS.save, t('actions.saveAs'));
  iconBtn('btn-print', ICONS.print, t('actions.print'));
  iconBtn('btn-find', ICONS.search, t('actions.find'));
  iconBtn('btn-zoom-in', ICONS.zoomIn, t('actions.zoomIn'));
  iconBtn('btn-zoom-reset', ICONS.zoomReset, t('actions.zoomReset'));
  iconBtn('btn-zoom-out', ICONS.zoomOut, t('actions.zoomOut'));
  iconBtn('btn-unlink', ICONS.unlink, t('actions.unlink'));
  iconBtn('btn-meta-json', ICONS.metaJson, t('actions.metaJson'));
  iconBtn('btn-meta-txt', ICONS.metaTxt, t('actions.metaTxt'));
  iconBtn('btn-source', ICONS.source, t('actions.source'));
  iconBtn('btn-about', ICONS.about, t('actions.about'));
  $('unlink-icon').innerHTML = ICONS.shield;
  $('unlink-title').textContent = t('unlink.title');
  $('unlink-body').textContent = t('unlink.body');
  $('btn-unlink-confirm').textContent = t('unlink.confirm');
  $('btn-unlink-cancel').textContent = t('unlink.cancel');
  for (const fmt of ['pdf', 'eml', 'png'] as const) {
    const b = $(`btn-export-${fmt}`);
    b.innerHTML = `${fmt.toUpperCase()} ${ICONS.export}`;
    b.title = t(`actions.export${fmt.charAt(0).toUpperCase()}${fmt.slice(1)}`);
  }
  setDocButtonsEnabled(false);
  $('btn-png-truncate').textContent = t('png.tooTall.truncate');
  $('btn-png-cancel').textContent = t('png.tooTall.cancel');
  $('btn-error-open').textContent = t('actions.open');

  $('btn-welcome-open').addEventListener('click', () => void openDialog());
  $('btn-new').addEventListener('click', () => {
    void api.clearDocument().then(() => showEmpty());
  });
  $('btn-open').addEventListener('click', () => void openDialog());
  $('btn-save-as').addEventListener('click', () => void doSaveAs());
  $('btn-print').addEventListener('click', () => {
    void api.printDocument().then((r) => {
      if (!r.ok && r.reason === 'error') {
        toast(`${t('toast.printError')}: ${r.detail ?? ''}`, undefined, true);
      }
    });
  });
  $('btn-find').addEventListener('click', () => {
    if (el.findbar.hidden) openFindBar();
    else closeFindBar();
  });
  $('btn-zoom-in').addEventListener('click', () => api.zoom(1));
  $('btn-zoom-reset').addEventListener('click', () => api.zoom(0));
  $('btn-zoom-out').addEventListener('click', () => api.zoom(-1));
  $('btn-unlink').addEventListener('click', () => {
    if (linksDisabled) {
      linksDisabled = false;
      applyLinkState();
      toast(t('toast.linksOn'));
    } else {
      ($('unlink-dialog') as HTMLDialogElement).showModal();
    }
  });
  $('btn-unlink-confirm').addEventListener('click', () => {
    ($('unlink-dialog') as HTMLDialogElement).close();
    linksDisabled = true;
    applyLinkState();
    toast(t('toast.linksOff'));
  });
  $('btn-unlink-cancel').addEventListener('click', () =>
    ($('unlink-dialog') as HTMLDialogElement).close()
  );
  $('btn-meta-json').addEventListener('click', () => copyMetadata('json'));
  $('btn-meta-txt').addEventListener('click', () => copyMetadata('text'));
  $('btn-source').addEventListener('click', () => api.viewSource());
  $('btn-about').addEventListener('click', () => api.showAbout());
  $('btn-error-open').addEventListener('click', () => void openDialog());
  $('btn-export-pdf').addEventListener('click', () => void exportDocument('pdf'));
  $('btn-export-eml').addEventListener('click', () => void exportDocument('eml'));
  $('btn-export-png').addEventListener('click', () => void pngButtonClicked());
  $('btn-png-truncate').addEventListener('click', () => {
    el.pngDialog.close();
    void exportDocument('png', true, pngTarget);
  });
  $('btn-png-cancel').addEventListener('click', () => el.pngDialog.close());

  setupDragAndDrop();
  setupFindBar();

  // FR-03: documentos abiertos por argv / open-file / segunda instancia.
  api.onDocumentLoaded(applyResult);

  // Menú de aplicación (los atajos de teclado viven en sus aceleradores).
  api.onMenuAction((action) => {
    if (action.type === 'open') void openDialog();
    else if (action.type === 'print') {
      void api.printDocument().then((r) => {
        if (!r.ok && r.reason === 'error') {
          toast(`${t('toast.printError')}: ${r.detail ?? ''}`, undefined, true);
        }
      });
    } else if (action.type === 'find') openFindBar();
    else if (action.type === 'save-as') void doSaveAs();
    else if (action.type === 'copy-meta') copyMetadata(action.as);
    else if (action.format === 'png') void pngButtonClicked();
    else void exportDocument(action.format);
  });

  // Toasts originados en main (guardados desde el menú del chip, errores).
  api.onToast((n) => toast(n.message, n.path, n.isError));

  // Pull del documento existente: tras Ver→Recargar o en una ventana de
  // .msg anidado, main ya tiene el documento de esta ventana.
  const existing = await api.getCurrentDocument();
  if (existing) showDocument(existing);
  else showEmpty();
}

void init();

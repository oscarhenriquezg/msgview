import type { ExportFormat, LoadResult, MsgAttachmentMeta, MsgDocument } from '@shared/types';
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
  exportMenu: $('export-menu'),
  pngDialog: $<HTMLDialogElement>('png-dialog'),
  leaveDialog: $<HTMLDialogElement>('leave-dialog'),
  leaveUrl: $<HTMLTextAreaElement>('leave-url'),
  leaveMismatch: $('leave-mismatch'),
  remoteImgDialog: $<HTMLDialogElement>('remote-img-dialog'),
  remoteImgUrl: $<HTMLTextAreaElement>('remote-img-url'),
  aboutDialog: $<HTMLDialogElement>('about-dialog'),
  associateDialog: $<HTMLDialogElement>('associate-dialog'),
  assocOfferDialog: $<HTMLDialogElement>('assoc-offer-dialog'),
  pngTargetDialog: $<HTMLDialogElement>('png-target-dialog'),
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
/** Zoom del cuerpo del mensaje (solo el iframe, no la ventana). */
let bodyZoom = 1;
/** Modo oscuro del cuerpo (accesibilidad): fondo oscuro, letra clara. */
let bodyDark = false;

const BODY_ZOOM_STEP = 0.1;
const BODY_ZOOM_MIN = 0.5;
const BODY_ZOOM_MAX = 3;

function applyLinkState(): void {
  el.bodyFrame.contentDocument?.body?.classList.toggle('__nolinks', linksDisabled);
  $('btn-unlink').setAttribute('aria-pressed', String(linksDisabled));
}

/** Aplica el zoom y el tema actuales al cuerpo; se reinvoca tras cada render. */
function applyBodyView(): void {
  const body = el.bodyFrame.contentDocument?.body;
  if (body) {
    body.style.zoom = String(bodyZoom);
    body.classList.toggle('__dark', bodyDark);
  }
  $('btn-dark-body').setAttribute('aria-pressed', String(bodyDark));
}

/** delta > 0 acerca, < 0 aleja, 0 restablece al 100 %. */
function changeBodyZoom(delta: number): void {
  if (delta === 0) bodyZoom = 1;
  else {
    const next = bodyZoom + Math.sign(delta) * BODY_ZOOM_STEP;
    bodyZoom = Math.max(BODY_ZOOM_MIN, Math.min(BODY_ZOOM_MAX, Math.round(next * 100) / 100));
  }
  applyBodyView();
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

  // El asunto es "Clic para copiar" (mismo patrón que las direcciones); solo
  // cuando hay asunto real (no en "(sin asunto)").
  const subject = doc.metadata.subject || '';
  el.subject.textContent = subject || t('header.noSubject');
  el.subject.classList.toggle('copyable', Boolean(subject));
  el.subject.dataset.tip = t('meta.clickToCopy');
  if (subject) {
    el.subject.tabIndex = 0;
    el.subject.setAttribute('role', 'button');
  } else {
    el.subject.removeAttribute('tabindex');
    el.subject.removeAttribute('role');
  }
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

/**
 * Span copiable con un clic. El tooltip "Clic para copiar" aparece al instante
 * (CSS :hover, sin la demora del title nativo).
 */
function copyable(display: string, copyValue: string, extraClass = ''): HTMLElement {
  const span = document.createElement('span');
  span.className = extraClass ? `copyable ${extraClass}` : 'copyable';
  span.textContent = display;
  span.dataset.tip = t('meta.clickToCopy');
  span.tabIndex = 0;
  span.setAttribute('role', 'button');
  span.setAttribute('aria-label', `${t('meta.clickToCopy')}: ${copyValue}`);
  const copy = () => {
    api.copyText(copyValue);
    toast(t('toast.copied', { what: copyValue }));
  };
  span.addEventListener('click', copy);
  span.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') copy();
  });
  return span;
}

/** Direcciones copiables con un clic + "copiar todos" por campo. */
function addressCell(people: { name: string; email: string }[]): HTMLElement {
  const cell = document.createElement('span');
  people.forEach((p, i) => {
    if (i > 0) cell.append('; ');
    const display =
      p.name && p.name !== p.email ? (p.email ? `${p.name} <${p.email}>` : p.name) : p.email || p.name;
    if (p.email) {
      cell.append(copyable(display, p.email, 'email-copy'));
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
  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleString(locale(), { dateStyle: 'full', timeStyle: 'short' });
  if (m.sentDate) {
    const s = dateFmt(m.sentDate);
    rows.push(metaRow(t('header.sent'), copyable(s, s)));
  }
  if (m.receivedDate) {
    const r = dateFmt(m.receivedDate);
    rows.push(metaRow(t('header.received'), copyable(r, r)));
  }

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
  chip.title = `${a.fileName} — ${t('attachments.dragHint')}`;
  chip.addEventListener('click', () => api.showAttachmentMenu(a.id));
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') api.showAttachmentMenu(a.id);
  });
  // Arrastrar el chip fuera de la app: el drag nativo lo inicia el proceso main
  // (se cancela el DnD HTML para no soltar el adjunto sobre la propia ventana).
  chip.draggable = true;
  chip.addEventListener('dragstart', (e) => {
    e.preventDefault();
    api.startAttachmentDrag(a.id);
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
    // Los clics dentro del iframe no llegan al documento padre: hay que cerrar
    // aquí los menús desplegables abiertos (p. ej. Exportar).
    doc.addEventListener('mousedown', () => closeExportMenu());
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
    doc.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      // Imagen remota bloqueada: ofrecer cargarla con aviso de rastreo.
      const img = target?.closest?.('img[data-blocked-src]') as HTMLImageElement | null;
      if (img) {
        e.preventDefault();
        confirmRemoteImage(img);
        return;
      }
      // Advertencia anti-phishing: salir del visor requiere confirmación.
      const a = target?.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      if (linksDisabled) return;
      const href = a.getAttribute('href') ?? '';
      if (!/^(https?:|mailto:)/i.test(href)) return;
      // ¿El texto visible aparenta un dominio distinto al destino real?
      const real = hostOf(href);
      const shown = a.querySelector('img') ? '' : displayedHost(a.textContent ?? '');
      const deceptive = hostsDiffer(shown, real) ? { shown, real } : null;
      // Homografía IDN: anotada por main en data-homograph (host decodificado).
      const homograph = a.getAttribute('data-homograph');
      confirmLeave(href, { deceptive, homograph });
    });
    applyMismatchState();
    applyLinkState();
    applyBodyView();
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
  /* Anti-phishing: el texto del enlace muestra un dominio distinto al real. */
  a.__link-mismatch {
    outline: 2px solid #d93025; outline-offset: 1px; border-radius: 2px;
    background: #fde7e6; text-decoration: underline wavy #d93025;
  }
  a.__link-mismatch::after { content: " \\26A0"; color: #d93025; font-size: 0.9em; }
  /* Imagen remota bloqueada: clic para cargarla (con aviso de rastreo). */
  img[data-blocked-src] { cursor: pointer; }
  /* Accesibilidad (WCAG 1.4.3): modo oscuro forzado. Se imponen fondo oscuro y
     texto claro con !important, que gana a los colores inline del correo
     (pensados para fondo claro y que de otro modo quedarían ilegibles). Así se
     garantiza contraste suficiente sea cual sea el color original del texto. */
  body.__dark { background-color: #1c1c1e !important; color: #e6e6e6 !important; }
  body.__dark * {
    background-color: transparent !important;
    color: #e6e6e6 !important;
    border-color: #4a4a4a !important;
  }
  body.__dark a, body.__dark a * { color: #6db3f2 !important; }
  body.__dark mark.__find { background-color: #ffe066 !important; color: #1a1a1a !important; }
  body.__dark mark.__find.__find-active { background-color: #ff9632 !important; }
</style>
</head>
<body>${sanitizedHtml}</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Anti-phishing: discrepancia entre el texto visible del enlace y su URL real
// ---------------------------------------------------------------------------

/** Host normalizado (minúsculas, sin "www.") de una URL http/https. */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Host que el texto visible aparenta mostrar, si parece un dominio/URL. */
function displayedHost(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  // Si el texto es una URL completa, usar su host.
  const asUrl = hostOf(trimmed);
  if (asUrl) return asUrl;
  // Si no, buscar un dominio suelto (etiqueta.tld) dentro del texto.
  const m = trimmed.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
  return m ? m[1]!.toLowerCase().replace(/^www\./, '') : '';
}

/** ¿Son hosts distintos sin relación de subdominio (p. ej. paypal.com vs evil.com)? */
function hostsDiffer(shown: string, real: string): boolean {
  if (!shown || !real || shown === real) return false;
  return !real.endsWith('.' + shown) && !shown.endsWith('.' + real);
}

/** Resaltado de enlaces engañosos: desactivado por defecto, activable como Unlink. */
let mismatchHighlight = false;

/** Aplica el estado actual del aviso de enlaces engañosos al cuerpo y al botón. */
function applyMismatchState(): void {
  const doc = el.bodyFrame.contentDocument;
  if (doc) {
    if (mismatchHighlight) markLinkDiscrepancies(doc);
    else clearLinkDiscrepancies(doc);
  }
  $('btn-link-warn').setAttribute('aria-pressed', String(mismatchHighlight));
}

/** Quita las marcas de enlace engañoso del cuerpo. */
function clearLinkDiscrepancies(doc: Document): void {
  for (const a of Array.from(doc.querySelectorAll('a.__link-mismatch'))) {
    a.classList.remove('__link-mismatch');
    a.removeAttribute('title');
  }
}

/**
 * Marca los enlaces cuyo texto visible aparenta un dominio distinto al host
 * real del href (técnica de phishing). El texto que no aparenta un dominio
 * (p. ej. "ver detalle") no se marca, para evitar falsos positivos.
 */
function markLinkDiscrepancies(doc: Document): void {
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const real = hostOf(a.getAttribute('href') ?? '');
    if (!real) continue; // solo http/https
    // Homografía IDN (anotada por main): se marca aunque el texto coincida,
    // porque el host "parece" latino pero usa otra escritura.
    const homograph = a.getAttribute('data-homograph');
    if (homograph) {
      a.classList.add('__link-mismatch');
      a.setAttribute('title', `${t('link.homograph')}: ${t('link.looksLike')} ${homograph}`);
      continue;
    }
    // Si el enlace contiene una imagen, el "texto" no es fiable: omitir.
    if (a.querySelector('img')) continue;
    const shown = displayedHost(a.textContent ?? '');
    if (hostsDiffer(shown, real)) {
      a.classList.add('__link-mismatch');
      a.setAttribute(
        'title',
        `${t('link.mismatch')}: ${t('link.shows')} "${shown}" · ${t('link.goesTo')} ${real}`
      );
    }
  }
}

/** Info de la app (versión, repo, plataforma) para el diálogo "Acerca de". */
let appInfo = { version: '', repoUrl: '', platform: '' };
let eggClicks = 0;

/** Diálogo "Acerca de" in-app (mismo estilo que los demás). */
function openAboutDialog(): void {
  $('about-version').textContent = appInfo.version ? `v${appInfo.version}` : '';
  $('about-detail').textContent = t('about.detail');
  const repo = $<HTMLAnchorElement>('about-repo');
  repo.textContent = appInfo.repoUrl.replace(/^https?:\/\//, '');
  $('about-egg').hidden = true;
  eggClicks = 0;
  el.aboutDialog.showModal();
}

/** Diálogo "Asociar tipos de archivo" in-app. En macOS muestra instrucciones. */
function openAssociateDialog(): void {
  const mac = appInfo.platform === 'darwin';
  $('associate-intro').textContent = mac ? t('associate.macIntro') : t('associate.intro');
  $('associate-types').hidden = mac;
  $('btn-associate-cancel').hidden = mac;
  $('btn-associate-confirm').textContent = mac ? t('associate.macClose') : t('associate.confirm');
  el.associateDialog.showModal();
}

/**
 * Al inicio: si los tipos de correo no están asociados, ofrece asociarlos.
 * main decide cuándo procede (solo ventana principal, Linux, no descartado).
 */
async function maybeOfferAssociation(): Promise<void> {
  const { offer } = await api.checkAssociation();
  if (!offer) return;
  ($('assoc-offer-dontask') as HTMLInputElement).checked = false;
  el.assocOfferDialog.showModal();
}

/** Abre el diálogo (estilo Unlink) para activar/desactivar el aviso de enlaces. */
function openLinkwarnDialog(): void {
  const off = mismatchHighlight; // si está activo, la acción será desactivar
  $('linkwarn-title').textContent = t(off ? 'linkwarn.titleOff' : 'linkwarn.titleOn');
  $('linkwarn-body').textContent = t(off ? 'linkwarn.bodyOff' : 'linkwarn.bodyOn');
  $('btn-linkwarn-confirm').textContent = t(off ? 'linkwarn.confirmOff' : 'linkwarn.confirmOn');
  ($('linkwarn-dialog') as HTMLDialogElement).showModal();
}

/** URL pendiente de confirmar en el diálogo "Salir del visor". */
let pendingLeaveUrl = '';

/**
 * Confirmación anti-phishing antes de abrir un enlace externo (FR-08). Si el
 * enlace es engañoso (texto que aparenta un dominio distinto al real) o
 * homográfico (host IDN que imita letras latinas con otra escritura), el mismo
 * diálogo lo explica.
 */
function confirmLeave(
  url: string,
  warn: { deceptive: { shown: string; real: string } | null; homograph: string | null }
): void {
  pendingLeaveUrl = url;
  el.leaveUrl.value = url;
  el.leaveUrl.scrollTop = 0;
  const lines: string[] = [];
  if (warn.homograph) {
    lines.push(
      `⚠ ${t('link.homograph')}: ${t('link.looksLike')} «${warn.homograph}». ` +
        `${t('leave.homographExplain')}`
    );
  }
  if (warn.deceptive) {
    lines.push(
      `⚠ ${t('link.mismatch')}: ${t('link.shows')} «${warn.deceptive.shown}» · ` +
        `${t('link.goesTo')} ${warn.deceptive.real}. ${t('leave.mismatchExplain')}`
    );
  }
  el.leaveMismatch.hidden = lines.length === 0;
  el.leaveMismatch.textContent = lines.join('\n\n');
  el.leaveDialog.showModal();
  // El foco arranca en Cancelar (acción segura por defecto).
  $('btn-leave-cancel').focus();
}

/** Imagen remota bloqueada pendiente de cargar (diálogo de aviso de rastreo). */
let pendingRemoteImg: HTMLImageElement | null = null;

/**
 * Aviso antes de descargar una imagen remota: explica que el servidor externo
 * puede rastrear al usuario (píxel de seguimiento). La descarga solo ocurre
 * tras la confirmación explícita (única excepción al bloqueo de red).
 */
function confirmRemoteImage(img: HTMLImageElement): void {
  const url = img.getAttribute('data-blocked-src') ?? '';
  if (!url) return;
  pendingRemoteImg = img;
  el.remoteImgUrl.value = url;
  el.remoteImgUrl.scrollTop = 0;
  el.remoteImgDialog.showModal();
  $('btn-remote-img-cancel').focus();
}

/** Descarga la imagen remota confirmada y la inserta en su sitio. */
function loadPendingRemoteImage(): void {
  const img = pendingRemoteImg;
  pendingRemoteImg = null;
  const url = img?.getAttribute('data-blocked-src');
  if (!img || !url) return;
  void api.loadRemoteImage(url).then((res) => {
    if (res.ok) {
      img.setAttribute('src', res.dataUri);
      img.removeAttribute('data-blocked-src');
      img.removeAttribute('title');
    } else {
      const reason =
        res.reason === 'too-large'
          ? t('remoteImg.tooLarge')
          : res.reason === 'not-image'
            ? t('remoteImg.notImage')
            : t('remoteImg.error');
      toast(reason, undefined, true);
    }
  });
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
  format: ExportFormat,
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

/** Formatos del menú Exportar, en el mismo orden que el menú de aplicación. */
const EXPORT_FORMATS = [
  'pdf', 'eml', 'png', 'html', 'txt', 'md', 'mht', 'json', 'zip'
] as const;

/** Botón PNG: diálogo para elegir entre guardar a archivo o copiar imagen. */
function openPngTargetDialog(): void {
  el.pngTargetDialog.showModal();
}

// --- Menú desplegable de Exportar -----------------------------------------

function closeExportMenu(): void {
  el.exportMenu.hidden = true;
  $('btn-export').setAttribute('aria-expanded', 'false');
}

function toggleExportMenu(): void {
  if (el.exportMenu.hidden) {
    el.exportMenu.hidden = false;
    $('btn-export').setAttribute('aria-expanded', 'true');
    el.exportMenu.querySelector<HTMLButtonElement>('button')?.focus();
  } else {
    closeExportMenu();
  }
}

function buildExportMenu(): void {
  const items = EXPORT_FORMATS.map((fmt) => {
    const item = document.createElement('button');
    item.id = `export-opt-${fmt}`;
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    const tag = document.createElement('span');
    tag.className = 'fmt';
    tag.textContent = fmt.toUpperCase();
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = t(`export.${fmt}`);
    item.append(tag, hint);
    item.addEventListener('click', () => {
      closeExportMenu();
      if (fmt === 'png') openPngTargetDialog();
      else void exportDocument(fmt);
    });
    return item;
  });
  el.exportMenu.replaceChildren(...items);
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

/**
 * Copia al portapapeles conservando el formato (texto enriquecido e imágenes).
 * Si hay una selección en el cuerpo, copia solo lo seleccionado; si no, copia
 * todo el cuerpo. Usa la copia nativa del documento (execCommand) para producir
 * el mismo portapapeles que Ctrl+C, con sus formatos HTML e imagen.
 */
function copyBody(): void {
  const win = el.bodyFrame.contentWindow;
  const doc = el.bodyFrame.contentDocument;
  const sel = win?.getSelection();
  if (!win || !doc?.body || !sel) return;

  const hasSelection = sel.rangeCount > 0 && !sel.isCollapsed;
  if (!hasSelection && !doc.body.innerHTML.trim()) {
    toast(t('toast.bodyEmpty'), undefined, true);
    return;
  }

  // Sin selección: seleccionar todo el cuerpo solo para copiar, y restaurar.
  let autoSelected = false;
  if (!hasSelection) {
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    sel.removeAllRanges();
    sel.addRange(range);
    autoSelected = true;
  }

  let ok: boolean;
  try {
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  if (autoSelected) sel.removeAllRanges();

  if (ok) toast(t(hasSelection ? 'toast.selectionCopied' : 'toast.bodyCopied'));
  else toast(t('toast.copyError'), undefined, true);
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
  appInfo = await api.getAppInfo();
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
  iconBtn('btn-copy', ICONS.copy, t('actions.copy'));
  iconBtn('btn-find', ICONS.search, t('actions.find'));
  iconBtn('btn-zoom-in', ICONS.zoomIn, t('actions.zoomIn'));
  iconBtn('btn-zoom-out', ICONS.zoomOut, t('actions.zoomOut'));
  iconBtn('btn-dark-body', ICONS.darkBody, t('actions.darkBody'));
  iconBtn('btn-unlink', ICONS.unlink, t('actions.unlink'));
  iconBtn('btn-link-warn', ICONS.linkWarn, t('actions.linkWarn'));
  iconBtn('btn-source', ICONS.source, t('actions.source'));
  iconBtn('btn-about', ICONS.about, t('actions.about'));
  $('unlink-icon').innerHTML = ICONS.shield;
  $('unlink-title').textContent = t('unlink.title');
  $('unlink-body').textContent = t('unlink.body');
  $('btn-unlink-confirm').textContent = t('unlink.confirm');
  $('btn-unlink-cancel').textContent = t('unlink.cancel');
  $('linkwarn-icon').innerHTML = ICONS.shieldAlert;
  $('btn-linkwarn-cancel').textContent = t('unlink.cancel');
  $('about-icon').innerHTML = ICONS.about;
  $('btn-about-close').textContent = t('about.close');
  $('associate-icon').innerHTML = ICONS.open;
  $('associate-title').textContent = t('associate.title');
  $('btn-associate-cancel').textContent = t('associate.cancel');
  $('assoc-offer-icon').innerHTML = ICONS.open;
  $('assoc-offer-title').textContent = t('assocOffer.title');
  $('assoc-offer-body').textContent = t('assocOffer.body');
  $('assoc-offer-dontask-label').textContent = t('assocOffer.dontAsk');
  $('btn-assoc-offer-no').textContent = t('assocOffer.no');
  $('btn-assoc-offer-yes').textContent = t('assocOffer.yes');
  $('leave-icon').innerHTML = ICONS.shieldAlert;
  $('leave-title').textContent = t('leave.title');
  $('leave-body').textContent = t('leave.body');
  $('leave-warn').textContent = t('leave.warn');
  $('btn-leave-open').textContent = t('leave.open');
  $('btn-leave-cancel').textContent = t('leave.cancel');
  $('remote-img-icon').innerHTML = ICONS.shieldAlert;
  $('remote-img-title').textContent = t('remoteImg.title');
  $('remote-img-body').textContent = t('remoteImg.body');
  $('remote-img-warn').textContent = t('remoteImg.warn');
  $('btn-remote-img-load').textContent = t('remoteImg.load');
  $('btn-remote-img-cancel').textContent = t('remoteImg.cancel');
  const btnExport = $('btn-export');
  btnExport.innerHTML = `${t('actions.export')} ${ICONS.export}`;
  btnExport.title = t('actions.export');
  buildExportMenu();
  setDocButtonsEnabled(false);
  $('btn-png-truncate').textContent = t('png.tooTall.truncate');
  $('btn-png-cancel').textContent = t('png.tooTall.cancel');
  $('png-target-title').textContent = t('png.target.title');
  $('png-target-body').textContent = t('png.target.body');
  $('btn-png-target-file').textContent = t('png.target.file');
  $('btn-png-target-clipboard').textContent = t('png.target.clipboard');
  $('btn-png-target-cancel').textContent = t('png.target.cancel');
  $('btn-error-open').textContent = t('actions.open');

  $('btn-welcome-open').addEventListener('click', () => void openDialog());
  $('btn-new').addEventListener('click', () => {
    void api.clearDocument().then(() => showEmpty());
  });
  $('btn-open').addEventListener('click', () => void openDialog());
  $('btn-save-as').addEventListener('click', () => void doSaveAs());
  $('btn-find').addEventListener('click', () => {
    if (el.findbar.hidden) openFindBar();
    else closeFindBar();
  });
  $('btn-copy').addEventListener('click', () => copyBody());
  $('btn-zoom-in').addEventListener('click', () => changeBodyZoom(1));
  $('btn-zoom-out').addEventListener('click', () => changeBodyZoom(-1));
  $('btn-dark-body').addEventListener('click', () => {
    bodyDark = !bodyDark;
    applyBodyView();
  });
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
  $('btn-link-warn').addEventListener('click', () => openLinkwarnDialog());
  $('btn-linkwarn-confirm').addEventListener('click', () => {
    ($('linkwarn-dialog') as HTMLDialogElement).close();
    mismatchHighlight = !mismatchHighlight;
    applyMismatchState();
    toast(t(mismatchHighlight ? 'toast.linkWarnOn' : 'toast.linkWarnOff'));
  });
  $('btn-linkwarn-cancel').addEventListener('click', () =>
    ($('linkwarn-dialog') as HTMLDialogElement).close()
  );
  $('btn-leave-open').addEventListener('click', () => {
    el.leaveDialog.close();
    if (pendingLeaveUrl) api.openExternal(pendingLeaveUrl);
    pendingLeaveUrl = '';
  });
  $('btn-leave-cancel').addEventListener('click', () => {
    el.leaveDialog.close();
    pendingLeaveUrl = '';
  });
  $('btn-remote-img-load').addEventListener('click', () => {
    el.remoteImgDialog.close();
    loadPendingRemoteImage();
  });
  $('btn-remote-img-cancel').addEventListener('click', () => {
    el.remoteImgDialog.close();
    pendingRemoteImg = null;
  });
  const copySubject = (): void => {
    const subject = currentDoc?.metadata.subject;
    if (!subject) return;
    api.copyText(subject);
    toast(t('toast.copied', { what: t('header.subject') }));
  };
  el.subject.addEventListener('click', copySubject);
  el.subject.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') copySubject();
  });
  $('btn-source').addEventListener('click', () => api.viewSource());
  $('btn-about').addEventListener('click', () => openAboutDialog());
  $('btn-about-close').addEventListener('click', () => el.aboutDialog.close());
  $('about-repo').addEventListener('click', (e) => {
    e.preventDefault();
    if (appInfo.repoUrl) api.openExternal(appInfo.repoUrl);
  });
  $('about-icon').addEventListener('click', () => {
    if (++eggClicks < 3) return;
    const egg = $('about-egg');
    const b = document.createElement('b');
    b.textContent = `${t('about.eggTitle')} — ${t('about.eggMessage')}`;
    egg.replaceChildren(b, document.createTextNode(t('about.eggDetail')));
    egg.hidden = false;
  });
  $('btn-associate-cancel').addEventListener('click', () => el.associateDialog.close());
  $('btn-associate-confirm').addEventListener('click', () => {
    el.associateDialog.close();
    if (appInfo.platform === 'darwin') return; // macOS: solo instrucciones
    const exts = Array.from(
      el.associateDialog.querySelectorAll<HTMLInputElement>('input:checked')
    ).map((c) => c.value);
    if (exts.length > 0) api.associateTypes(exts);
  });
  $('btn-assoc-offer-yes').addEventListener('click', () => {
    el.assocOfferDialog.close();
    // Asociar los tres tipos de correo de una vez.
    api.associateTypes(['msg', 'eml', 'emlx']);
  });
  $('btn-assoc-offer-no').addEventListener('click', () => {
    el.assocOfferDialog.close();
    if (($('assoc-offer-dontask') as HTMLInputElement).checked) {
      api.dismissAssociationOffer();
    }
  });
  $('btn-error-open').addEventListener('click', () => void openDialog());
  $('btn-export').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExportMenu();
  });
  // Cerrar el menú al hacer clic fuera o con Escape.
  document.addEventListener('click', () => closeExportMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.exportMenu.hidden) closeExportMenu();
  });
  $('btn-png-target-file').addEventListener('click', () => {
    el.pngTargetDialog.close();
    void exportDocument('png', false, 'file');
  });
  $('btn-png-target-clipboard').addEventListener('click', () => {
    el.pngTargetDialog.close();
    void exportDocument('png', false, 'clipboard');
  });
  $('btn-png-target-cancel').addEventListener('click', () => el.pngTargetDialog.close());
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
    else if (action.type === 'zoom') changeBodyZoom(action.delta);
    else if (action.type === 'source') api.viewSource();
    else if (action.type === 'about') openAboutDialog();
    else if (action.type === 'associate') openAssociateDialog();
    else if (action.type === 'copy-meta') copyMetadata(action.as);
    else if (action.format === 'png') openPngTargetDialog();
    else void exportDocument(action.format);
  });

  // Toasts originados en main (guardados desde el menú del chip, errores).
  api.onToast((n) => toast(n.message, n.path, n.isError));

  // Pull del documento existente: tras Ver→Recargar o en una ventana de
  // .msg anidado, main ya tiene el documento de esta ventana.
  const existing = await api.getCurrentDocument();
  if (existing) showDocument(existing);
  else showEmpty();

  // Tras la carga inicial: ofrecer asociar los tipos de correo si procede.
  void maybeOfferAssociation();
}

void init();

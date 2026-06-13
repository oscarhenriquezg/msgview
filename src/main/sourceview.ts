import { app } from 'electron';

/**
 * Página de la vista de código fuente (servida por msgprint://source).
 * Autocontenida: resaltado de sintaxis propio, búsqueda con marcas,
 * ajuste de línea y botonera técnica. El contenido del correo va escapado;
 * el único script es el nuestro (CSP sin remotos, ventana sandbox).
 */

export interface SourceViewData {
  headers: string;
  body: string;
  truncated: boolean;
  hops: import('./headers-analysis').Hop[];
  auth: import('./headers-analysis').AuthResult[];
  mapiProps: { tag: string; name?: string; value: string }[] | null;
  sanitizeRemoved: string[] | null;
}

const STR = {
  es: {
    title: 'Código fuente',
    headers: 'Cabeceras de transporte',
    body: 'Cuerpo (código fuente)',
    none: '(no disponibles en este .msg)',
    truncated: '… (truncado a 2 MB)',
    search: 'Buscar…',
    wrap: 'Ajuste de línea',
    copyHeaders: 'Copiar cabeceras',
    copyBody: 'Copiar cuerpo',
    copyAll: 'Copiar todo',
    print: 'Imprimir',
    saved: 'Guardado ✓',
    copied: 'Copiado ✓',
    error: 'Error',
    route: 'Ruta del mensaje (Received)',
    hopFrom: 'Desde', hopBy: 'Por', hopDate: 'Fecha', hopDelta: 'Δ',
    auth: 'Autenticación',
    mapi: 'Propiedades MAPI crudas',
    mapiTag: 'PidTag', mapiName: 'Nombre', mapiValue: 'Valor',
    sanit: 'Eliminado por el sanitizador',
    sanitNone: 'Nada eliminado: el cuerpo no contenía contenido activo ✓',
    decode: 'Decodificar selección',
    decodeTitle: 'Selección decodificada',
    decodeNone: 'La selección no parece base64 ni quoted-printable',
    close: 'Cerrar'
  },
  en: {
    title: 'Source',
    headers: 'Transport headers',
    body: 'Body (source)',
    none: '(not available in this .msg)',
    truncated: '… (truncated to 2 MB)',
    search: 'Find…',
    wrap: 'Word wrap',
    copyHeaders: 'Copy headers',
    copyBody: 'Copy body',
    copyAll: 'Copy all',
    print: 'Print',
    saved: 'Saved ✓',
    copied: 'Copied ✓',
    error: 'Error',
    route: 'Message route (Received)',
    hopFrom: 'From', hopBy: 'By', hopDate: 'Date', hopDelta: 'Δ',
    auth: 'Authentication',
    mapi: 'Raw MAPI properties',
    mapiTag: 'PidTag', mapiName: 'Name', mapiValue: 'Value',
    sanit: 'Removed by sanitizer',
    sanitNone: 'Nothing removed: the body had no active content ✓',
    decode: 'Decode selection',
    decodeTitle: 'Decoded selection',
    decodeNone: 'Selection does not look like base64 or quoted-printable',
    close: 'Close'
  }
};

export function sourceStrings(): (typeof STR)['es'] {
  return app.getLocale().startsWith('es') ? STR.es : STR.en;
}

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function buildSourceViewHtml(data: SourceViewData): string {
  const s = sourceStrings();

  const fmtDelta = (d?: number) =>
    d === undefined ? '—' : d >= 0 ? (d < 120 ? `+${d} s` : `+${Math.round(d / 60)} min`) : `${d} s`;
  const routeSection =
    data.hops.length === 0
      ? ''
      : `<details open><summary>${s.route} · ${data.hops.length}</summary>
<table><thead><tr><th>#</th><th>${s.hopFrom}</th><th>${s.hopBy}</th><th>${s.hopDate}</th><th>${s.hopDelta}</th></tr></thead><tbody>
${data.hops
  .map(
    (h, i) =>
      `<tr><td>${i + 1}</td><td>${esc(h.from)}</td><td>${esc(h.by)}</td><td>${
        h.date ? esc(h.date.replace('T', ' ').replace(/\.\d+Z/, 'Z')) : '—'
      }</td><td class="${(h.deltaSeconds ?? 0) > 60 ? 'slow' : ''}">${fmtDelta(h.deltaSeconds)}</td></tr>`
  )
  .join('')}
</tbody></table>${
          data.auth.length > 0
            ? `<div class="authrow">${s.auth}: ${data.auth
                .map((a) => {
                  const cls = a.result === 'pass' ? 'ok' : /fail|reject/.test(a.result) ? 'bad' : 'mid';
                  return `<span class="chip ${cls}">${a.mechanism.toUpperCase()}=${esc(a.result)}</span>`;
                })
                .join(' ')}</div>`
            : ''
        }</details>`;

  const mapiSection = !data.mapiProps
    ? ''
    : `<details><summary>${s.mapi} · ${data.mapiProps.length}</summary>
<table><thead><tr><th>${s.mapiTag}</th><th>${s.mapiName}</th><th>${s.mapiValue}</th></tr></thead><tbody>
${data.mapiProps
  .map((p) => `<tr><td class="hk">${esc(p.tag)}</td><td>${esc(p.name ?? '')}</td><td>${esc(p.value)}</td></tr>`)
  .join('')}
</tbody></table></details>`;

  const sanitSection =
    data.sanitizeRemoved === null
      ? ''
      : `<details${data.sanitizeRemoved.length > 0 ? ' open' : ''}><summary>${s.sanit} · ${data.sanitizeRemoved.length}</summary>
${
  data.sanitizeRemoved.length === 0
    ? `<pre class="okline">${s.sanitNone}</pre>`
    : `<pre class="badlines">${data.sanitizeRemoved.map((r) => `⚠ ${esc(r)}`).join('\n')}</pre>`
}</details>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  :root {
    color-scheme: light dark;
    --tag: #0550ae; --attr: #953800; --str: #0a3069; --cm: #6e7781;
    --hk: #8250df; --b64: #9a9a9a; --mark: #ffe066; --mark-active: #ff9632;
  }
  @media (prefers-color-scheme: dark) {
    :root { --tag: #79c0ff; --attr: #ffa657; --str: #a5d6ff; --cm: #8b949e;
            --hk: #d2a8ff; --b64: #6e7681; --mark: #6b5900; --mark-active: #a14f00; }
  }
  body { margin: 0; background: Canvas; color: CanvasText;
         font-family: ui-monospace, 'Cascadia Code', Menlo, monospace; font-size: 12px; }
  .bar { position: sticky; top: 0; z-index: 5; display: flex; gap: 6px; align-items: center;
         flex-wrap: wrap; font-family: system-ui, sans-serif; font-size: 12px;
         background: Canvas; border-bottom: 1px solid GrayText; padding: 8px 12px; }
  .bar input[type=text] { font: inherit; padding: 3px 8px; width: 170px;
         border: 1px solid GrayText; border-radius: 5px; background: transparent; color: inherit; }
  .bar button { font: inherit; padding: 3px 10px; border: 1px solid GrayText;
         border-radius: 5px; background: transparent; color: inherit; cursor: pointer; }
  .bar button:hover { border-color: Highlight; }
  .bar .sep { width: 1px; align-self: stretch; background: GrayText; opacity: .5; }
  .bar label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  #count { min-width: 52px; text-align: center; color: GrayText; }
  #status { color: GrayText; margin-left: auto; }
  h2 { font-family: system-ui, sans-serif; font-size: 12.5px; margin: 0;
       padding: 9px 14px; border-bottom: 1px solid GrayText; opacity: .85; }
  pre { margin: 0; padding: 12px 14px 22px; white-space: pre-wrap; word-break: break-all; }
  body.nowrap pre { white-space: pre; word-break: normal; overflow-x: auto; }
  .tag { color: var(--tag); } .attr { color: var(--attr); } .str { color: var(--str); }
  .cm { color: var(--cm); font-style: italic; } .hk { color: var(--hk); font-weight: 600; }
  .b64 { color: var(--b64); }
  mark { background: var(--mark); color: inherit; padding: 0; }
  mark.act { background: var(--mark-active); }
  details { border-bottom: 1px solid GrayText; }
  summary { font-family: system-ui, sans-serif; font-size: 12.5px; padding: 9px 14px;
            cursor: pointer; opacity: .9; user-select: none; }
  table { border-collapse: collapse; width: 100%; font-size: 11.5px; margin: 0 0 10px; }
  th, td { text-align: left; padding: 4px 14px; border-top: 1px solid color-mix(in srgb, GrayText 35%, transparent); vertical-align: top; word-break: break-all; }
  th { font-family: system-ui, sans-serif; opacity: .7; }
  td.slow { color: #d4a72c; font-weight: 700; }
  .authrow { font-family: system-ui, sans-serif; padding: 4px 14px 12px; }
  .chip { display: inline-block; border-radius: 9px; padding: 1px 9px; font-size: 11px; margin-right: 4px; }
  .chip.ok { background: #2da44e33; color: #2da44e; }
  .chip.bad { background: #cf222e33; color: #cf222e; }
  .chip.mid { background: #d4a72c33; color: #b08800; }
  .okline { color: #2da44e; }
  .badlines { color: #cf222e; }
  #dec { position: fixed; bottom: 0; left: 0; right: 0; max-height: 45%; overflow: auto;
         background: Canvas; border-top: 2px solid Highlight; z-index: 6; }
  #dec .dbar { display: flex; gap: 8px; align-items: center; font-family: system-ui, sans-serif;
         padding: 6px 14px; border-bottom: 1px solid GrayText; }
  #dec pre { padding: 10px 14px; }
</style></head><body>
<div class="bar">
  <input id="q" type="text" placeholder="${s.search}" spellcheck="false">
  <span id="count"></span>
  <button id="prev" title="Shift+Enter">‹</button>
  <button id="next" title="Enter">›</button>
  <span class="sep"></span>
  <label><input id="wrap" type="checkbox" checked> ${s.wrap}</label>
  <span class="sep"></span>
  <button id="cph">${s.copyHeaders}</button>
  <button id="cpb">${s.copyBody}</button>
  <button id="cpa">${s.copyAll}</button>
  <span class="sep"></span>
  <button id="dcd">${s.decode}</button>
  <span class="sep"></span>
  <button id="prn">${s.print}</button>
  <button id="xpdf">PDF</button>
  <button id="xhtml">HTML</button>
  <button id="xtxt">TXT</button>
  <span id="status"></span>
</div>
${routeSection}
<details open><summary>${s.headers}</summary><pre id="hdr">${data.headers ? esc(data.headers) : s.none}</pre></details>
${mapiSection}
${sanitSection}
<details open><summary>${s.body}</summary><pre id="src-body">${esc(data.body)}${data.truncated ? esc(s.truncated) : ''}</pre></details>
<div id="dec" hidden>
  <div class="dbar"><b>${s.decodeTitle}</b>
    <button id="dec-copy">${s.copyAll}</button>
    <button id="dec-close">${s.close}</button>
  </div>
  <pre id="dec-out"></pre>
</div>
<script>
(function () {
  'use strict';
  var hdr = document.getElementById('hdr');
  var body = document.getElementById('src-body');

  // ---- Resaltado de sintaxis (sobre el HTML ya escapado) ----
  function highlightHeaders(el) {
    el.innerHTML = el.innerHTML.replace(/^([\\w-]+)(:)/gm,
      '<span class="hk">$1</span>$2');
  }
  function highlightHtml(el) {
    var h = el.innerHTML;
    h = h.replace(/&lt;!--[\\s\\S]*?--&gt;/g, function (m) {
      return '<span class="cm">' + m + '</span>';
    });
    h = h.replace(/&lt;(\\/?)([a-zA-Z][\\w-]*)([^>]*?)(\\/?)&gt;/g, function (m, sl, name, rest, sl2) {
      var attrs = rest
        .replace(/"[^"]*"/g, function (q) { return '\\u0001s' + q + '\\u0001e'; })
        .replace(/([\\w-]+)(=)/g, '<span class="attr">$1</span>$2')
        .replace(/\\u0001s([^\\u0001]*)\\u0001e/g, '<span class="str">$1</span>');
      return '<span class="tag">&lt;' + sl + name + '</span>' + attrs +
             '<span class="tag">' + sl2 + '&gt;</span>';
    });
    el.innerHTML = h;
  }
  function highlightOpaque(el) {
    el.innerHTML = el.innerHTML.replace(/^[A-Za-z0-9+\\/=]{60,}$/gm, function (m) {
      return '<span class="b64">' + m + '</span>';
    });
  }
  highlightHeaders(hdr);
  if (/^\\s*&lt;|^\\s*</.test(body.innerHTML)) highlightHtml(body);
  else highlightOpaque(body);

  var hdrBase = hdr.innerHTML;
  var bodyBase = body.innerHTML;

  // ---- Búsqueda con marcas y navegación ----
  var marks = [];
  var active = -1;
  var q = document.getElementById('q');
  var count = document.getElementById('count');

  function clearMarks() {
    hdr.innerHTML = hdrBase;
    body.innerHTML = bodyBase;
    marks = []; active = -1; count.textContent = '';
  }
  function search(text) {
    clearMarks();
    if (!text) return;
    var needle = text.toLowerCase();
    var roots = Array.prototype.slice.call(document.querySelectorAll('pre, tbody'));
    roots.forEach(function (root) {
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      var nodes = [];
      for (var n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      nodes.forEach(function (node) {
        var t = node.textContent, lower = t.toLowerCase();
        var i = lower.indexOf(needle);
        if (i === -1) return;
        var frag = document.createDocumentFragment(), last = 0;
        while (i !== -1 && marks.length < 5000) {
          frag.appendChild(document.createTextNode(t.slice(last, i)));
          var mk = document.createElement('mark');
          mk.textContent = t.slice(i, i + text.length);
          frag.appendChild(mk);
          marks.push(mk);
          last = i + text.length;
          i = lower.indexOf(needle, last);
        }
        frag.appendChild(document.createTextNode(t.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    });
    if (marks.length) go(0);
    else count.textContent = '0';
  }
  function go(i) {
    if (!marks.length) return;
    if (active >= 0) marks[active].classList.remove('act');
    active = ((i % marks.length) + marks.length) % marks.length;
    marks[active].classList.add('act');
    var det = marks[active].closest('details');
    if (det) det.open = true;
    marks[active].scrollIntoView({ block: 'center' });
    count.textContent = (active + 1) + '/' + marks.length;
  }
  var deb;
  q.addEventListener('input', function () {
    clearTimeout(deb);
    deb = setTimeout(function () { search(q.value); }, 150);
  });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') go(active + (e.shiftKey ? -1 : 1));
    if (e.key === 'Escape') { q.value = ''; clearMarks(); }
  });
  document.getElementById('next').addEventListener('click', function () { go(active + 1); });
  document.getElementById('prev').addEventListener('click', function () { go(active - 1); });
  addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault(); q.focus(); q.select();
    }
  });

  // ---- Ajuste de línea ----
  document.getElementById('wrap').addEventListener('change', function (e) {
    document.body.classList.toggle('nowrap', !e.target.checked);
  });

  // ---- Acciones vía preload (copiar / imprimir / exportar) ----
  var status = document.getElementById('status');
  function flash(text) {
    status.textContent = text;
    setTimeout(function () { status.textContent = ''; }, 2500);
  }
  function wire(id, fn) { document.getElementById(id).addEventListener('click', fn); }
  // ---- Decodificador de selección (base64 / quoted-printable) ----
  function bytesToUtf8(bytes) {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch (e) { return null; }
  }
  function tryB64(t) {
    var compact = t.replace(/\\s+/g, '');
    if (!/^[A-Za-z0-9+\\/]+=*$/.test(compact) || compact.length < 8 || compact.length % 4 !== 0) return null;
    try {
      var bin = atob(compact);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytesToUtf8(bytes);
    } catch (e) { return null; }
  }
  function tryQP(t) {
    if (!/=([0-9A-F]{2}|\\r?\\n)/i.test(t)) return null;
    var src = t.replace(/=\\r?\\n/g, '');
    var bytes = [];
    for (var i = 0; i < src.length; i++) {
      if (src[i] === '=' && /^[0-9A-F]{2}$/i.test(src.slice(i + 1, i + 3))) {
        bytes.push(parseInt(src.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(src.charCodeAt(i));
      }
    }
    return bytesToUtf8(new Uint8Array(bytes));
  }
  var dec = document.getElementById('dec');
  var decOut = document.getElementById('dec-out');
  document.getElementById('dcd').addEventListener('click', function () {
    var sel = String(window.getSelection());
    var out = tryB64(sel) || tryQP(sel);
    decOut.textContent = out !== null && out.length > 0 ? out : '${s.decodeNone}';
    dec.hidden = false;
  });
  document.getElementById('dec-close').addEventListener('click', function () { dec.hidden = true; });
  document.getElementById('dec-copy').addEventListener('click', function () {
    if (window.sourceApi) { window.sourceApi.copyText(decOut.textContent); flash('${s.copied}'); }
  });

  if (window.sourceApi) {
    wire('cph', function () { window.sourceApi.copy('headers'); flash('${s.copied}'); });
    wire('cpb', function () { window.sourceApi.copy('body'); flash('${s.copied}'); });
    wire('cpa', function () { window.sourceApi.copy('all'); flash('${s.copied}'); });
    wire('prn', function () { window.sourceApi.print(); });
    ['pdf', 'html', 'txt'].forEach(function (fmt) {
      wire('x' + fmt, function () {
        window.sourceApi.exportAs(fmt).then(function (r) {
          if (r && r.ok) flash('${s.saved}');
          else if (r && r.reason === 'error') flash('${s.error}');
        });
      });
    });
  }
})();
</script>
</body></html>`;
}

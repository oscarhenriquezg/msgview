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
    error: 'Error'
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
    error: 'Error'
  }
};

export function sourceStrings(): (typeof STR)['es'] {
  return app.getLocale().startsWith('es') ? STR.es : STR.en;
}

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function buildSourceViewHtml(data: SourceViewData): string {
  const s = sourceStrings();
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
  <button id="prn">${s.print}</button>
  <button id="xpdf">PDF</button>
  <button id="xhtml">HTML</button>
  <button id="xtxt">TXT</button>
  <span id="status"></span>
</div>
<h2>${s.headers}</h2><pre id="hdr">${data.headers ? esc(data.headers) : s.none}</pre>
<h2>${s.body}</h2><pre id="src-body">${esc(data.body)}${data.truncated ? esc(s.truncated) : ''}</pre>
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
    [hdr, body].forEach(function (root) {
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

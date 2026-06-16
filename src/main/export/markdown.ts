import { JSDOM } from 'jsdom';
import type { MsgDocument } from '@shared/types';
import { sanitizeEmailHtml } from '../parser/sanitize';

/**
 * "Exportar/Guardar como Markdown": cabecera de metadatos + cuerpo convertido
 * de HTML a Markdown. El cuerpo ya viene sanitizado de main, así que solo se
 * recorren los elementos comunes de un correo; lo desconocido degrada a su
 * texto. No depende de librerías externas (NFR offline).
 */
export function documentToMarkdown(doc: MsgDocument): string {
  const m = doc.metadata;
  const fmt = (p: { name: string; email: string }) =>
    p.name && p.name !== p.email ? (p.email ? `${p.name} <${p.email}>` : p.name) : p.email;
  const byType = (type: 'to' | 'cc' | 'bcc') =>
    m.recipients
      .filter((r) => r.type === type)
      .map(fmt)
      .join('; ');

  const lines: string[] = [];
  lines.push(`# ${m.subject || '(sin asunto)'}`, '');
  lines.push(`**From:** ${fmt(m.from)}  `);
  const to = byType('to');
  const cc = byType('cc');
  const bcc = byType('bcc');
  if (to) lines.push(`**To:** ${to}  `);
  if (cc) lines.push(`**Cc:** ${cc}  `);
  if (bcc) lines.push(`**Bcc:** ${bcc}  `);
  if (m.sentDate) lines.push(`**Date:** ${m.sentDate}  `);
  const files = doc.attachments.filter((a) => !a.isInline).map((a) => a.fileName);
  if (files.length > 0) lines.push(`**Attachments:** ${files.join('; ')}  `);
  lines.push('', '---', '');

  const dom = new JSDOM(`<body>${sanitizeEmailHtml(doc.bodyHtml)}</body>`);
  const body = dom.window.document.body;
  const md = nodesToMarkdown(body.childNodes, dom.window);
  lines.push(md.replace(/\n{3,}/g, '\n\n').trim(), '');
  return lines.join('\n');
}

type Win = JSDOM['window'];

function nodesToMarkdown(nodes: NodeListOf<ChildNode> | ChildNode[], win: Win): string {
  let out = '';
  for (const node of Array.from(nodes)) out += nodeToMarkdown(node, win);
  return out;
}

function inline(node: ChildNode, win: Win): string {
  return nodesToMarkdown(node.childNodes, win).replace(/\s+/g, ' ').trim();
}

function nodeToMarkdown(node: ChildNode, win: Win): string {
  if (node.nodeType === win.Node.TEXT_NODE) {
    // El texto suelto se normaliza; el formato de bloque lo añaden los padres.
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== win.Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'h1': case 'h2': case 'h3':
    case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1]);
      return `\n\n${'#'.repeat(level)} ${inline(el, win)}\n\n`;
    }
    case 'p':
    case 'div':
      return `\n\n${nodesToMarkdown(el.childNodes, win).trim()}\n\n`;
    case 'br':
      return '  \n';
    case 'hr':
      return '\n\n---\n\n';
    case 'strong':
    case 'b': {
      const t = inline(el, win);
      return t ? `**${t}**` : '';
    }
    case 'em':
    case 'i': {
      const t = inline(el, win);
      return t ? `*${t}*` : '';
    }
    case 'code':
      return `\`${inline(el, win)}\``;
    case 'pre':
      return `\n\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`;
    case 'a': {
      const href = el.getAttribute('href') ?? '';
      const text = inline(el, win) || href;
      return href ? `[${text}](${href})` : text;
    }
    case 'img': {
      const alt = el.getAttribute('alt') || 'imagen';
      const src = el.getAttribute('src') ?? '';
      // Las imágenes incrustadas (data:/cid:) harían el .md ilegible: solo alt.
      return /^(data:|cid:)/i.test(src) || !src ? `*(imagen: ${alt})*` : `![${alt}](${src})`;
    }
    case 'ul':
    case 'ol': {
      const ordered = tag === 'ol';
      const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === 'li');
      const rendered = items.map((li, i) => {
        const marker = ordered ? `${i + 1}.` : '-';
        const content = nodesToMarkdown(li.childNodes, win).replace(/\s+/g, ' ').trim();
        return `${marker} ${content}`;
      });
      return `\n\n${rendered.join('\n')}\n\n`;
    }
    case 'blockquote': {
      const content = nodesToMarkdown(el.childNodes, win).trim();
      const quoted = content
        .split('\n')
        .map((l) => `> ${l}`.trimEnd())
        .join('\n');
      return `\n\n${quoted}\n\n`;
    }
    case 'table':
      return `\n\n${tableToMarkdown(el, win)}\n\n`;
    case 'script':
    case 'style':
      return '';
    default:
      return nodesToMarkdown(el.childNodes, win);
  }
}

/** Tabla GFM simple: la primera fila se trata como cabecera. */
function tableToMarkdown(table: Element, win: Win): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return '';
  const cells = (tr: Element) =>
    Array.from(tr.querySelectorAll('th,td')).map((c) =>
      inline(c, win).replace(/\|/g, '\\|') || ' '
    );
  const header = cells(rows[0]!);
  const sep = header.map(() => '---');
  const lines = [`| ${header.join(' | ')} |`, `| ${sep.join(' | ')} |`];
  for (const tr of rows.slice(1)) lines.push(`| ${cells(tr).join(' | ')} |`);
  return lines.join('\n');
}

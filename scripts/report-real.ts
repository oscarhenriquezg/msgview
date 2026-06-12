/** Informe del corpus real: qué extrae el parser de cada .msg. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MsgAdapter } from '../src/main/parser/MsgAdapter';

const dir = join(import.meta.dirname, '..', 'tests', 'fixtures', 'real');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.msg'))) {
  const result = MsgAdapter.parse(readFileSync(join(dir, file)), file);
  console.log(`\n=== ${file}`);
  if (!result.ok) {
    console.log(`  ERROR ${result.error.code}: ${result.error.detail ?? ''}`);
    continue;
  }
  const d = result.document;
  const m = d.metadata;
  console.log(`  Asunto : ${m.subject}`);
  console.log(`  De     : ${m.from.name} <${m.from.email}>`);
  for (const r of m.recipients.slice(0, 3)) {
    console.log(`  ${r.type.padEnd(3)}    : ${r.name} <${r.email}>`);
  }
  if (m.recipients.length > 3) console.log(`  ... y ${m.recipients.length - 3} destinatarios más`);
  console.log(`  Fecha  : ${m.sentDate ?? '(sin fecha envío)'}`);
  console.log(`  Cuerpo : ${d.bodySource}, ${d.bodyHtml.length} chars sanitizados`);
  console.log(`  Firma  : ${m.hasSignature ? 'S/MIME presente' : 'no'}`);
  for (const a of d.attachments) {
    const tags = [a.isInline ? 'inline' : '', a.isEmbeddedMsg ? 'msg-anidado' : '']
      .filter(Boolean)
      .join(',');
    console.log(`  Adj    : ${a.fileName} (${a.size} B)${tags ? ` [${tags}]` : ''}`);
  }
  const hostile = /<script|onerror=|javascript:/i.test(d.bodyHtml);
  console.log(`  Sanidad: ${hostile ? '⚠ RESTOS PELIGROSOS' : 'ok'}`);
}

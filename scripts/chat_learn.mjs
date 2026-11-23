// Ask SEA-HAF: add the questions viewers labelled to the training rows (chat/learned.json).
// The page sends {question, topic, kind} to a Google Form (chat/config.json feedback.formUrl) when a viewer picks the topic they
// meant ("which do you mean?" / "not what I asked?"). The form's response sheet, published as CSV (feedback.csvUrl), is read here:
// rows are cleaned (no phone numbers, e-mails or links; 2–200 characters; known topics only), the same question is merged and its
// topic set by majority (at least 2/3 of its labels), and at most MAX_NEW new questions are added per run. scripts/chat_train.mjs
// then retrains, and keeps the old model if the accuracy on the fixed test questions would drop. No key: the sheet is public CSV.
import fs from 'node:fs';
import path from 'node:path';
import { INTENTS } from './chatml.mjs';

export const MAX_NEW = 200;
/** CSV text -> rows of fields (quotes, doubled quotes and line breaks inside quotes) */
export function parseCSV(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c; }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
export const cleanQ = q => String(q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const ok = q => q.length >= 2 && q.length <= 200 && !/\d{7,}|@|https?:|www\./i.test(q);
/** merge sheet rows ([question, topic, kind] after the timestamp) into the learned list; returns {learned, added, skipped} */
export function merge(learned, sheetRows) {
  const by = new Map(learned.map(r => [r.q.toLowerCase(), { ...r, votes: { ...(r.votes || { [r.y]: r.n || 1 }) } }]));
  const before = new Set(by.keys()); let skipped = 0;
  const tally = new Map();
  for (const r of sheetRows) { const q = cleanQ(r[1]), y = String(r[2] || '').trim(); if (!ok(q) || !INTENTS.includes(y)) { skipped++; continue; }
    const k = q.toLowerCase(); const v = tally.get(k) || { q, votes: {} }; v.votes[y] = (v.votes[y] || 0) + 1; tally.set(k, v); }
  let added = 0;
  for (const [k, v] of tally) {
    if (!before.has(k) && added >= MAX_NEW) continue;
    const e = by.get(k) || { q: v.q, votes: {} };
    // the sheet holds every answer since the form was made: its counts replace (not add to) what an earlier run stored
    e.votes = { ...v.votes };
    const tot = Object.values(e.votes).reduce((a, b) => a + b, 0), [y, n] = Object.entries(e.votes).sort((a, b) => b[1] - a[1])[0];
    if (n / tot < 2 / 3) { by.delete(k); continue; }   // viewers disagree: leave it out
    e.y = y; e.n = n; by.set(k, e); if (!before.has(k)) added++;
  }
  return { learned: [...by.values()].map(({ q, y, n, votes }) => ({ q, y, n, votes })), added, skipped };
}
async function main() {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), CHAT = path.join(ROOT, 'chat');
  const cfg = JSON.parse(fs.readFileSync(path.join(CHAT, 'config.json'), 'utf8'));
  const url = cfg.feedback?.csvUrl; if (!url) { console.log('chat learn: no feedback sheet set (chat/config.json feedback.csvUrl); nothing to add'); return; }
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3) }); if (!r.ok) { console.log(`chat learn: sheet HTTP ${r.status}; nothing added`); return; }
  const rows = parseCSV(await r.text()).slice(1);   // header row first
  const f = path.join(CHAT, 'learned.json'), old = JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = merge(old, rows);
  fs.writeFileSync(f, JSON.stringify(m.learned, null, 0).replace(/},{/g, '},\n{') + '\n');
  console.log(`chat learn: ${rows.length} sheet rows, ${m.added} new questions, ${m.skipped} skipped (empty, unknown topic, contact details or links), ${m.learned.length} learned in all`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.log(`chat learn failed: ${e.message}`); process.exitCode = 0; });

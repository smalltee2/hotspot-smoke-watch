// Ask SEA-HAF: add the labelled questions to the training rows (chat/learned.json) and the real test questions (chat/test_real.json).
// The page sends {question, topic, kind} to the Cloudflare Pages site (cloudflare/pages/functions/api/feedback.js → D1; chat/config.json feedback.endpoint)
// or a Google Form when a viewer picks the topic they meant ("which do you mean?" / "not what I asked?"). Its CSV (the site's
// /api/export with the CHAT_EXPORT_TOKEN secret, feedback.exportUrl; or the form's published sheet, feedback.csvUrl) is read here:
// rows are cleaned (no phone numbers, e-mails or links; 2–200 characters; known topics only), the same question is merged and its
// topic set by majority (at least 2/3 of its labels), and at most MAX_NEW new questions are added per run. scripts/chat_train.mjs
// then retrains, and keeps the old model if the accuracy on the fixed test questions would drop.
// The admin's labels (kind "admin": questions the classifier was unsure of, and questions asked in the collecting mode, labelled
// on the dev page) are trusted as they are: a fixed third of them (by a hash of the question) becomes test questions
// (chat/test_real.json, never trained on, also not through viewers' labels), the rest training rows with full weight (n = 3).
import fs from 'node:fs';
import path from 'node:path';
import { INTENTS } from './chatml.mjs';
import { share, norm } from './chat_train.mjs';

export const TEST_SHARE = 1 / 3;

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
  for (const r of sheetRows) { const q = cleanQ(r[1]), y = String(r[2] || '').trim(); if (['admin', 'llmgen'].includes(String(r[3] || '').trim())) continue;   // the admin's labels: mergeAdmin; the LLM's questions: mergeGen
    if (!ok(q) || !INTENTS.includes(y)) { skipped++; continue; }
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
/** the admin's labels (CSV rows of kind admin) -> {learned, testReal, toTest, toTrain}: a fixed third to the test questions,
 *  the rest into the training rows (replacing what viewers voted); viewers' labels of a test question are removed */
export function mergeAdmin(learned, testReal, sheetRows) {
  const test = new Map(testReal.map(r => [norm(r.q), r])), train = new Map(learned.map(r => [norm(r.q), r]));
  let toTest = 0, toTrain = 0;
  for (const r of sheetRows) { if (String(r[3] || '').trim() !== 'admin') continue;
    const q = cleanQ(r[1]), y = String(r[2] || '').trim(), k = norm(q); if (!ok(q) || !INTENTS.includes(y)) continue;
    if (share(q) < TEST_SHARE) { if (!test.has(k)) toTest++; test.set(k, { q, y }); train.delete(k); }
    else { if (!train.has(k) || train.get(k).admin !== y) toTrain++; train.set(k, { q, y, n: 3, admin: y }); } }
  for (const k of test.keys()) train.delete(k);   // a test question is never trained on, whoever labelled it
  return { learned: [...train.values()], testReal: [...test.values()], toTest, toTrain };
}
export const MAX_GEN = 4000;
/** questions written by the admin's local LLM (CSV rows of kind llmgen) -> training rows only (gen: 1), the newest MAX_GEN;
 *  never a test question, and a question people labelled keeps their label */
export function mergeGen(learned, testReal, sheetRows) {
  const test = new Set(testReal.map(r => norm(r.q))), have = new Set(learned.map(r => norm(r.q))), out = [...learned.filter(r => !r.gen)], seen = new Set();
  const gen = sheetRows.filter(r => String(r[3] || '').trim() === 'llmgen').reverse();
  let added = 0;
  for (const r of gen) { const q = cleanQ(r[1]), y = String(r[2] || '').trim(), k = norm(q);
    if (added >= MAX_GEN || !ok(q) || !INTENTS.includes(y) || test.has(k) || have.has(k) || seen.has(k)) continue;
    seen.add(k); out.push({ q, y, n: 1, gen: 1 }); added++; }
  return { learned: out, added };
}
async function main() {
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), CHAT = path.join(ROOT, 'chat');
  const cfg = JSON.parse(fs.readFileSync(path.join(CHAT, 'config.json'), 'utf8'));
  // the Pages site's /api/export (token from the CHAT_EXPORT_TOKEN secret, never logged) or a Google Form's published CSV
  const ex = cfg.feedback?.exportUrl, url = ex || cfg.feedback?.csvUrl;
  if (!url) { console.log('chat learn: no feedback source set (chat/config.json feedback.exportUrl or csvUrl); nothing to add'); return; }
  if (ex && !process.env.CHAT_EXPORT_TOKEN) { console.log('chat learn: CHAT_EXPORT_TOKEN secret not set; nothing added'); return; }
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3), headers: ex ? { Authorization: `Bearer ${process.env.CHAT_EXPORT_TOKEN}` } : {} });
  if (!r.ok) { console.log(`chat learn: feedback source HTTP ${r.status}; nothing added`); return; }
  const rows = parseCSV(await r.text()).slice(1);   // header row first
  const f = path.join(CHAT, 'learned.json'), old = JSON.parse(fs.readFileSync(f, 'utf8'));
  const m = merge(old.filter(r => !r.admin && !r.gen), rows);   // the admin's and the LLM's rows are rebuilt from the export every run
  const tf = path.join(CHAT, 'test_real.json'), tr = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, 'utf8')) : [];
  const a = mergeAdmin(m.learned, tr, rows), g = mergeGen(a.learned, a.testReal, rows); a.learned = g.learned;
  const dump = x => JSON.stringify(x, null, 0).replace(/},{/g, '},\n{') + '\n';
  fs.writeFileSync(f, dump(a.learned)); fs.writeFileSync(tf, dump(a.testReal));
  console.log(`chat learn: ${rows.length} rows; viewers: ${m.added} new questions, ${m.skipped} skipped (empty, unknown topic, contact details or links); admin: ${a.toTrain} to training, ${a.toTest} to the test questions; local LLM: ${g.added} written questions; ${a.learned.length} learned, ${a.testReal.length} real test questions in all`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.log(`chat learn failed: ${e.message}`); process.exitCode = 0; });

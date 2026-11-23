// Ask SEA-HAF: train the topic classifier and write chat/model.json.
//   node scripts/chat_train.mjs            train, report, write the model
//   node scripts/chat_train.mjs --gate     also keep the current model when the new one is worse on the test questions (> 1 point)
//   node scripts/chat_train.mjs --report   train and report only (writes nothing)
// Training rows (chat/data/README.md):
//   - the template questions (scripts/chat_data.mjs);
//   - the paraphrases (chat/data/para-*.json), less a fixed 15 % kept as the development set;
//   - Amazon MASSIVE rows (chat/data/massive.json, CC BY 4.0);
//   - the questions people labelled (chat/learned.json: viewers' picks, and the admin's labels from the dev page);
//   each varied by scripts/chat_augment.mjs, topics balanced.
// Test rows: chat/test.json (written apart) and chat/test_real.json (real questions labelled by the admin, a fixed third of them,
// chosen by scripts/chat_learn.mjs). They are never trained on: training rows equal to a test question are dropped.
// Two kinds of model are trained, the linear one and a small neural network (one hidden layer); the development set picks
// between them, and the test questions decide whether the pick replaces the current model (the current model is scored on the
// same test questions, so the comparison stays fair as test_real.json grows).
import fs from 'node:fs';
import path from 'node:path';
import { train, trainMLP, quantize, evaluate, INTENTS } from './chatml.mjs';
import { templateRows } from './chat_data.mjs';
import { augment, rng } from './chat_augment.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), CHAT = path.join(ROOT, 'chat');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(CHAT, f), 'utf8')); } catch (e) { return d; } };
export const norm = q => String(q).toLowerCase().replace(/[!?.,;:"“”'‘’()\[\]{}<>…~]/g, ' ').replace(/\s+/g, '').trim();
const valid = r => r && typeof r.q === 'string' && r.q.trim().length >= 2 && INTENTS.includes(r.y);
/** a stable share of a question (0..1) from its text: the same question always falls on the same side of a split */
export function share(q) { let h = 2166136261; for (const c of norm(q)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
export const DEV_SHARE = 0.15;

/** all the data sets: {train, dev, test, counts} */
export function buildData({ seed = 3 } = {}) {
  const test = [...read('test.json', []), ...read('test_real.json', [])].filter(valid), testSet = new Set(test.map(r => norm(r.q)));
  const notTest = r => !testSet.has(norm(r.q));
  const para = fs.readdirSync(path.join(CHAT, 'data')).filter(f => /^para-.*\.json$/.test(f)).sort().flatMap(f => read(path.join('data', f), [])).filter(valid).filter(notTest);
  const paraTrain = para.filter(r => share(r.q) >= DEV_SHARE), paraDev = para.filter(r => share(r.q) < DEV_SHARE);
  const massive = read('data/massive.json', []).filter(valid).filter(notTest);
  const learned = read('learned.json', []).filter(valid).filter(notTest);
  const tpl = templateRows().filter(notTest);
  // viewers' and the admin's labels count more than a generated row (they are real questions): up to 3 copies
  const learnedRows = learned.flatMap(r => Array(Math.min(3, 1 + (r.n || 1))).fill({ q: r.q, y: r.y }));
  let rows = [...tpl, ...augment(paraTrain, { copies: 3, seed }), ...augment(massive, { copies: 1, seed: seed + 1 }), ...augment(learnedRows, { copies: 2, seed: seed + 2 })].filter(notTest);   // a variant may happen to equal a test question
  // balance: no topic more than twice the median topic (MASSIVE alone would make "other" and "wx" several times larger)
  const by = new Map(INTENTS.map(k => [k, []])); for (const r of rows) by.get(r.y).push(r);
  const sizes = [...by.values()].map(a => a.length).sort((a, b) => a - b), cap = 2 * sizes[Math.floor(sizes.length / 2)], r = rng(seed + 9);
  rows = [...by.values()].flatMap(a => { if (a.length <= cap) return a; const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b.slice(0, cap); });
  const dev = augment(paraDev, { copies: 1, seed: seed + 7 });
  return { train: rows, dev, test, counts: { templates: tpl.length, para: para.length, paraDev: paraDev.length, massive: massive.length, learned: learned.length, train: rows.length, dev: dev.length, test: test.length, cap } };
}
const pct = v => (v * 100).toFixed(1) + ' %';

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = buildData(), c = d.counts;
  console.log(`chat data: ${c.train} training rows (templates ${c.templates}, paraphrases ${c.para - c.paraDev}, MASSIVE ${c.massive}, labelled ${c.learned}; varied, at most ${c.cap} a topic); development ${c.dev}; test ${c.test}`);
  const cands = [
    ['linear', () => train(d.train)],
    ['mlp-32', () => trainMLP(d.train, { hidden: 32 })],
    ['mlp-48', () => trainMLP(d.train, { hidden: 48 })],
  ];
  const res = [];
  for (const [name, fit] of cands) {
    const t0 = Date.now(), m = fit(), q = quantize(m), ev = evaluate(q, d.dev), et = evaluate(q, d.test), size = JSON.stringify(q).length;
    res.push({ name, q, dev: ev.acc, test: et.acc, per: et.per, size });
    console.log(`  ${name.padEnd(7)} development ${pct(ev.acc)}, test ${pct(et.acc)} (${et.n}), ${(size / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
  }
  // the development set picks; a larger model must win by more than 0.5 point to be chosen over a smaller one
  let best = res[0]; for (const x of res.slice(1)) if (x.dev > best.dev + 0.005) best = x;
  console.log(`  picked ${best.name}; test recall by topic: ` + Object.entries(best.per).map(([k, v]) => `${k} ${v}`).join(', '));
  if (process.argv.includes('--report')) process.exit(0);
  const prev = read('model.json', null), prevAcc = prev?.q ? evaluate(prev, d.test).acc : null;
  if (prevAcc != null) console.log(`  current model (${prev.kind || 'linear'}) on the same test questions: ${pct(prevAcc)}`);
  if (process.argv.includes('--gate') && prevAcc != null && best.test < prevAcc - 0.01) {
    console.log(`  kept the current model: test accuracy would drop from ${pct(prevAcc)} to ${pct(best.test)}`);
    process.exit(0);
  }
  const stored = { ...best.q, trained: new Date().toISOString(), nTrain: c.train, nLearned: c.learned, devAcc: +best.dev.toFixed(3), testAcc: +best.test.toFixed(3), nTest: c.test };
  fs.writeFileSync(path.join(CHAT, 'model.json'), JSON.stringify(stored));
  console.log(`  wrote chat/model.json (${best.name}, ${(fs.statSync(path.join(CHAT, 'model.json')).size / 1024).toFixed(0)} KB)`);
}

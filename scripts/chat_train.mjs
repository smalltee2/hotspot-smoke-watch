// Ask SEA-HAF: train the topic classifier and write chat/model.json.
//   node scripts/chat_train.mjs            train, report, write the model
//   node scripts/chat_train.mjs --gate     also refuse to replace the model when the test accuracy would drop (> 1 point)
// Training rows: the template questions (scripts/chat_data.mjs) + the questions viewers labelled (chat/learned.json, merged by
// scripts/chat_learn.mjs). Test rows: chat/test.json, written apart and never trained on. The stored model carries its test
// accuracy, so the next run can compare.
import fs from 'node:fs';
import path from 'node:path';
import { train, quantize, evaluate, INTENTS } from './chatml.mjs';
import { templateRows } from './chat_data.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), CHAT = path.join(ROOT, 'chat');
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(CHAT, f), 'utf8')); } catch (e) { return d; } };
const learned = read('learned.json', []).filter(r => r && typeof r.q === 'string' && INTENTS.includes(r.y));
// a viewer's label counts a little more than one template row (it is a real question), at most 3 copies
const rows = [...templateRows(), ...learned.flatMap(r => Array(Math.min(3, 1 + (r.n || 1))).fill({ q: r.q, y: r.y }))];
const test = read('test.json', []);
const t0 = Date.now(), m = train(rows), ev = evaluate(m, test), tr = evaluate(m, rows);
const stored = quantize(m, { trained: new Date().toISOString(), nTrain: rows.length, nLearned: learned.length, testAcc: +ev.acc.toFixed(3) });
const evq = evaluate(stored, test);
console.log(`chat model: ${rows.length} training rows (${learned.length} labelled by viewers), ${INTENTS.length} topics, ${((Date.now() - t0) / 1e3).toFixed(1)} s`);
console.log(`  training accuracy ${(tr.acc * 100).toFixed(1)} %; test accuracy ${(ev.acc * 100).toFixed(1)} % (stored int8 model ${(evq.acc * 100).toFixed(1)} %) on ${ev.n} questions`);
console.log('  test recall by topic: ' + Object.entries(evq.per).map(([k, v]) => `${k} ${v}`).join(', '));
const prev = read('model.json', null);
if (process.argv.includes('--gate') && prev?.testAcc != null && evq.acc < prev.testAcc - 0.01) {
  console.log(`  kept the current model: test accuracy would drop from ${(prev.testAcc * 100).toFixed(1)} % to ${(evq.acc * 100).toFixed(1)} %`);
  process.exit(0);
}
stored.testAcc = +evq.acc.toFixed(3);
fs.writeFileSync(path.join(CHAT, 'model.json'), JSON.stringify(stored));
console.log(`  wrote chat/model.json (${(fs.statSync(path.join(CHAT, 'model.json')).size / 1024).toFixed(0)} KB)`);

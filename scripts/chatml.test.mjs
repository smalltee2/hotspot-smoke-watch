// Unit tests of the Ask SEA-HAF topic classifier and its learning: node --test scripts/chatml.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { featurize, predict, train, trainMLP, quantize, evaluate, INTENTS, DIM } from './chatml.mjs';
import { templateRows } from './chat_data.mjs';
import { parseCSV, merge, MAX_NEW } from './chat_learn.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
test('features: case and punctuation do not matter; Thai without spaces gives n-grams', () => {
  assert.deepEqual(featurize('Hello, World!'), featurize('hello world'));
  assert.ok(featurize('ฝุ่นเชียงใหม่').length > 10); assert.ok(featurize('x').every(j => j >= 0 && j < DIM));
});
test('the page copy (index.html chatMLfeat / chatMLpredict) equals scripts/chatml.mjs', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = name => { const i = html.indexOf(`function ${name}(`); assert.ok(i > 0, name); let d = 0, j = html.indexOf('{', i);
    for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'chat', 'model.json'), 'utf8'));
  const bin = Buffer.from(model.q, 'base64'), w = new Int8Array(bin.buffer, bin.byteOffset, bin.length);
  const ctx = { CHATML: { model, w } }; vm.createContext(ctx); vm.runInContext(grab('chatMLfeat') + grab('chatMLpredict'), ctx);
  for (const q of ['พรุ่งนี้เช้าจะมีหมอกไหม', 'How accurate is it?', 'ฝุ่นที่ เชียงใหม่ ตอนนี้!!', 'x']) {
    assert.deepEqual(Array.from(ctx.chatMLfeat(q, DIM)), featurize(q));   // arrays made in the vm context: compare as plain arrays
    const a = ctx.chatMLpredict(q), b = predict(model, q); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));
  }
});
test('the page copy also reads the small neural network (kind "mlp") as scripts/chatml.mjs does', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = name => { const i = html.indexOf(`function ${name}(`); let d = 0, j = html.indexOf('{', i);
    for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; } return html.slice(i, j + 1); };
  const model = quantize(trainMLP(templateRows(15), { hidden: 8, epochs: 2, dim: 1024 }));
  const bin = Buffer.from(model.q, 'base64'), w = new Int8Array(bin.buffer, bin.byteOffset, bin.length);
  const ctx = { CHATML: { model, w } }; vm.createContext(ctx); vm.runInContext(grab('chatMLfeat') + grab('chatMLpredict'), ctx);
  for (const q of ['พรุ่งนี้เช้าจะมีหมอกไหม', 'how accurate', 'ฝุ่น ลำปาง']) { const a = ctx.chatMLpredict(q), b = predict(model, q); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9)); }
});
test('augmentation: deterministic, keeps the topic, never returns the test rows', async () => {
  const { augment } = await import('./chat_augment.mjs'), rows = [{ q: 'พรุ่งนี้ฝุ่นที่เชียงใหม่จะเยอะไหมครับ', y: 'pm' }, { q: 'how is the air in Chiang Mai today', y: 'pm' }];
  const a = augment(rows, { copies: 4 }), b = augment(rows, { copies: 4 });
  assert.deepEqual(a, b); assert.ok(a.length > 4 && a.every(r => r.y === 'pm'));
  assert.ok(a.filter(r => !/[฀-๿]/.test(r.q)).every(r => /\s/.test(r.q)));   // English keeps its spaces
  const { buildData, norm } = await import('./chat_train.mjs'), d = buildData();
  const t = new Set(d.test.map(r => norm(r.q))); assert.ok(!d.train.some(r => t.has(norm(r.q))) && !d.dev.some(r => t.has(norm(r.q))));
});
test('training: separates the topics; the stored int8 model gives the same answers', () => {
  const rows = templateRows(60), m = train(rows, { epochs: 10 }), q = quantize(m);
  const tr = evaluate(m, rows); assert.ok(tr.acc > 0.95, `training accuracy ${tr.acc}`);
  for (const r of rows.slice(0, 50)) { const a = predict(m, r.q), b = predict(q, r.q); assert.equal(a.indexOf(Math.max(...a)), b.indexOf(Math.max(...b))); }
  assert.ok(!('_w' in q) && JSON.stringify(q).length < 200e3);
});
test('the published model: the fixed test questions >= 85 % right', () => {
  const model = JSON.parse(fs.readFileSync(path.join(ROOT, 'chat', 'model.json'), 'utf8')), t = JSON.parse(fs.readFileSync(path.join(ROOT, 'chat', 'test.json'), 'utf8'));
  assert.deepEqual(model.intents, INTENTS); assert.ok(evaluate(model, t).acc >= 0.85);
});
test('learning: CSV parsing, cleaning, majority labels, contact details refused', () => {
  const csv = 'Timestamp,question,topic,kind\n1,"พรุ่งนี้เช้า, หมอกไหม",fog,pick\n2,พรุ่งนี้เช้า  หมอกไหม,fog,fix\n3,"he said ""hi""",hi,pick\n4,call 0812345678,pm,fix\n5,a@b.c,pm,fix\n6,ราคาทอง,nonsense,fix\n7,งง,pm,fix\n8,งง,adv,fix\n';
  const rows = parseCSV(csv); assert.equal(rows.length, 9); assert.equal(rows[1][1], 'พรุ่งนี้เช้า, หมอกไหม'); assert.equal(rows[3][1], 'he said "hi"');
  const m = merge([], rows.slice(1));
  assert.equal(m.skipped, 3);                                            // phone number, e-mail, unknown topic
  const f = m.learned.find(r => r.q === 'พรุ่งนี้เช้า, หมอกไหม'); assert.equal(f.y, 'fog');
  assert.ok(!m.learned.some(r => r.q === 'งง'));                           // 1 vs 1: no majority, left out
  const again = merge(m.learned, rows.slice(1)); assert.equal(again.added, 0); assert.equal(again.learned.find(r => r.q === f.q).n, f.n);   // rereading the sheet does not double-count
  assert.ok(MAX_NEW > 0);
});

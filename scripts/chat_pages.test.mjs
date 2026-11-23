// Unit tests of the SEA-HAF Pages Functions (cloudflare/pages/functions/api) with an in-memory D1 and KV: node --test scripts/chat_pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../cloudflare/pages/functions/api/feedback.js';
import { onRequestGet } from '../cloudflare/pages/functions/api/export.js';
import * as label from '../cloudflare/pages/functions/api/label.js';
import * as suggest from '../cloudflare/pages/functions/api/suggest.js';
import { parseCSV, merge, mergeAdmin } from './chat_learn.mjs';

// a tiny stand-in for D1: only the statements the Functions use
function env() {
  const fb = [], lab = new Map(), sug = new Map(), kv = new Map();
  const stmt = (sql, a = []) => ({
    bind: (...b) => stmt(sql, b),
    run: async () => {
      if (/^INSERT INTO chat_feedback/.test(sql)) fb.push({ id: fb.length + 1, t: a[0], q: a[1], y: a[2], kind: a[3] });
      else if (/^INSERT INTO chat_label/.test(sql)) lab.set(a[0], { qk: a[0], q: a[1], y: a[2], t: a[3] });
      else if (/^INSERT INTO chat_suggest/.test(sql)) sug.set(a[0], { qk: a[0], y: a[1], conf: a[2], model: a[3], t: a[4] });
      else assert.fail('unexpected statement ' + sql);
    },
    all: async () => {
      if (/FROM chat_feedback WHERE kind IN \('pick', 'fix'\)/.test(sql)) return { results: fb.filter(r => r.kind === 'pick' || r.kind === 'fix') };
      if (/FROM chat_feedback ORDER BY id DESC/.test(sql)) return { results: [...fb].reverse() };
      if (/SELECT qk FROM chat_label/.test(sql)) return { results: [...lab.values()] };
      if (/FROM chat_suggest/.test(sql)) return { results: [...sug.values()] };
      if (/FROM chat_label WHERE y <> 'skip'/.test(sql)) return { results: [...lab.values()].filter(r => r.y !== 'skip') };
      assert.fail('unexpected query ' + sql);
    },
  });
  const DB = { prepare: sql => { assert.ok(!/DROP|DELETE/i.test(sql)); return stmt(sql); }, batch: async list => list.map(() => ({})) };
  return { fb, lab, sug, kv, DB, KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, EXPORT_TOKEN: 'tok', ALLOWED_ORIGINS: 'https://smalltee2.github.io' };
}
const SITE = 'https://sea-haf.pages.dev', GH = 'https://smalltee2.github.io';
const post = (e, body, origin = GH, ip = '1.2.3.4') => onRequestPost({ env: e, request: new Request(SITE + '/api/feedback', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }) });
const admin = (e, method, body, tok = 'tok') => label[method === 'GET' ? 'onRequestGet' : 'onRequestPost']({ env: e, request: new Request(SITE + '/api/label?n=10', { method, headers: { Origin: GH, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }) });

test('feedback: from the GitHub copy and the Pages site itself; refused from other sites, bad topics, contact details', async () => {
  const e = env();
  assert.equal((await post(e, { q: 'พรุ่งนี้เช้า หมอกไหม', y: 'fog', kind: 'fix' })).status, 200);
  assert.equal((await post(e, { q: 'ฝุ่นตอนนี้', y: 'pm' }, SITE)).status, 200);                    // same origin
  assert.equal((await post(e, { q: 'x y', y: 'pm' }, 'https://evil.example')).status, 403);
  assert.equal((await post(e, { q: 'ฝุ่น', y: 'nonsense' })).status, 400);
  assert.equal((await post(e, { q: 'โทร 0812345678', y: 'pm' })).status, 400);
  assert.equal((await post(e, { q: 'a@b.co', y: 'pm' })).status, 400);
  assert.equal(e.fb.length, 2); assert.deepEqual(Object.keys(e.fb[0]).sort(), ['id', 'kind', 'q', 't', 'y']);
  assert.ok(![...e.kv.keys(), ...e.kv.values()].some(x => String(x).includes('1.2.3.4')));   // the IP is never kept
});
test('export: needs the token; viewers\' labels and the admin\'s, not the unlabelled questions; feeds the learning merge', async () => {
  const e = env(); await post(e, { q: 'he said "hi", then left', y: 'hi' }); await post(e, { q: 'หมอกพรุ่งนี้', y: 'fog' }); await post(e, { q: 'ฝุ่นแม่สาย', y: 'wx', kind: 'unsure' });
  assert.equal((await onRequestGet({ env: e, request: new Request(SITE + '/api/export') })).status, 401);
  await admin(e, 'POST', { q: 'ฝุ่นแม่สาย', y: 'pm' });
  const r = await onRequestGet({ env: e, request: new Request(SITE + '/api/export', { headers: { Authorization: 'Bearer tok' } }) });
  const rows = parseCSV(await r.text()); assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map(x => x[3]), ['pick', 'pick', 'admin']);
  assert.deepEqual(merge([], rows.slice(1)).learned.map(x => x.y).sort(), ['fog', 'hi']);   // the admin's row goes through mergeAdmin
});
test('40 a sender a day (600 in collecting mode); CORS answers the site only and allows the admin key header', async () => {
  const e = env(); let last; for (let i = 0; i < 41; i++) last = await post(e, { q: 'คำถาม ' + i, y: 'pm' });
  assert.equal(last.status, 429);
  assert.equal((await post(e, { q: 'คำถามจากห้องเรียน', y: 'pm', kind: 'collect' })).status, 200);   // its own count
  const o = await onRequestOptions({ env: e, request: new Request(SITE + '/api/feedback', { method: 'OPTIONS', headers: { Origin: GH } }) });
  assert.equal(o.headers.get('Access-Control-Allow-Origin'), GH); assert.match(o.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const x = await onRequestOptions({ env: e, request: new Request(SITE + '/api/feedback', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }) });
  assert.equal(x.headers.get('Access-Control-Allow-Origin'), null);
});
test('labelling queue: admin only; groups the same question; labelled ones leave the queue; skip is kept out of the export', async () => {
  const e = env();
  for (const [q, y, kind] of [['ฝุ่นแม่สาย', 'wx', 'unsure'], ['ฝุ่น  แม่สาย', 'pm', 'collect'], ['ฝุ่นแม่สาย', 'pm', 'pick'], ['asdf qwer', 'other', 'unsure']]) await post(e, { q, y, kind });
  assert.equal((await admin(e, 'GET', null, 'wrong')).status, 401);
  let j = await (await admin(e, 'GET')).json();
  assert.equal(j.waiting, 2); const m = j.queue.find(x => x.q.startsWith('ฝุ่น'));
  assert.equal(m.n, 3); assert.deepEqual(m.votes, { pm: 1 }); assert.deepEqual(m.guess, { wx: 1, pm: 1 });
  assert.equal((await admin(e, 'POST', { q: 'ฝุ่นแม่สาย', y: 'nonsense' })).status, 400);
  assert.equal((await admin(e, 'POST', { q: 'ฝุ่นแม่สาย', y: 'pm' })).status, 200);
  assert.equal((await admin(e, 'POST', { q: 'asdf qwer', y: 'skip' })).status, 200);
  j = await (await admin(e, 'GET')).json(); assert.equal(j.waiting, 0); assert.equal(j.labelled, 2);
  const csv = await (await onRequestGet({ env: e, request: new Request(SITE + '/api/export', { headers: { Authorization: 'Bearer tok' } }) })).text();
  assert.ok(!csv.includes('asdf'));
});
test('admin labels: a fixed third to the test questions, never also trained on; the rest train with full weight', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push(['t', `ฝุ่นที่อำเภอ ${i} เป็นไง`, 'pm', 'admin']);
  const viewer = [{ q: rows[0][1], y: 'pm', n: 1 }, { q: rows[1][1], y: 'pm', n: 1 }];
  const a = mergeAdmin(viewer, [], rows), b = mergeAdmin(a.learned, a.testReal, rows);
  assert.ok(a.testReal.length > 8 && a.testReal.length < 35, `test share ${a.testReal.length}/60`);
  assert.equal(a.testReal.length + a.learned.length, 60);
  const t = new Set(a.testReal.map(r => r.q)); assert.ok(!a.learned.some(r => t.has(r.q)));
  assert.ok(a.learned.every(r => r.n === 3));
  assert.deepEqual(b.testReal, a.testReal); assert.equal(b.toTest, 0);   // rereading: the same split, nothing new
});
test('local-AI suggestions: admin only, checked, shown in the queue, never a label by themselves', async () => {
  const e = env(); await post(e, { q: 'ฝุ่นแม่สาย', y: 'wx', kind: 'unsure' });
  const sg = (b, tok = 'tok') => suggest.onRequestPost({ env: e, request: new Request(SITE + '/api/suggest', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }) });
  assert.equal((await sg({ q: 'ฝุ่นแม่สาย', y: 'pm', conf: 0.9, model: 'qwen2.5:7b' }, 'wrong')).status, 401);
  assert.equal((await sg({ q: 'ฝุ่นแม่สาย', y: 'skip' })).status, 400);
  assert.equal((await sg({ q: 'ฝุ่น แม่สาย', y: 'pm', conf: 7, model: 'qwen2.5:7b<script>' })).status, 200);
  const j = await (await admin(e, 'GET')).json();
  assert.deepEqual(j.queue[0].llm, { y: 'pm', conf: 1, model: 'qwen2.5:7bscript' });
  assert.equal(e.lab.size, 0);
  const csv = await (await onRequestGet({ env: e, request: new Request(SITE + '/api/export', { headers: { Authorization: 'Bearer tok' } }) })).text();
  assert.equal(parseCSV(csv).length, 1);   // header only: a suggestion is not exported as a label
});

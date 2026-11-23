// Unit tests of the SEA-HAF Pages Functions (cloudflare/pages/functions/api) with an in-memory D1 and KV: node --test scripts/chat_pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost, onRequestOptions } from '../cloudflare/pages/functions/api/feedback.js';
import { onRequestGet } from '../cloudflare/pages/functions/api/export.js';
import { parseCSV, merge } from './chat_learn.mjs';

function env() {
  const rows = [], kv = new Map();
  const DB = { prepare: sql => ({ bind: (...a) => ({ run: async () => { assert.match(sql, /^INSERT INTO chat_feedback/); rows.push({ t: a[0], q: a[1], y: a[2], kind: a[3] }); } }),
    all: async () => { assert.match(sql, /^SELECT t, q, y, kind FROM chat_feedback/); return { results: rows.slice() }; } }) };
  return { rows, kv, DB, KV: { get: async k => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, EXPORT_TOKEN: 'tok', ALLOWED_ORIGINS: 'https://smalltee2.github.io' };
}
const SITE = 'https://sea-haf.pages.dev';
const post = (e, body, origin = 'https://smalltee2.github.io', ip = '1.2.3.4') => onRequestPost({ env: e, request: new Request(SITE + '/api/feedback', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }) });
test('feedback: from the GitHub copy and the Pages site itself; refused from other sites, bad topics, contact details', async () => {
  const e = env();
  assert.equal((await post(e, { q: 'พรุ่งนี้เช้า หมอกไหม', y: 'fog', kind: 'fix' })).status, 200);
  assert.equal((await post(e, { q: 'ฝุ่นตอนนี้', y: 'pm' }, SITE)).status, 200);                    // same origin
  assert.equal((await post(e, { q: 'x y', y: 'pm' }, 'https://evil.example')).status, 403);
  assert.equal((await post(e, { q: 'ฝุ่น', y: 'nonsense' })).status, 400);
  assert.equal((await post(e, { q: 'โทร 0812345678', y: 'pm' })).status, 400);
  assert.equal((await post(e, { q: 'a@b.co', y: 'pm' })).status, 400);
  assert.equal(e.rows.length, 2); assert.deepEqual(Object.keys(e.rows[0]).sort(), ['kind', 'q', 't', 'y']);
  assert.ok(![...e.kv.keys(), ...e.kv.values()].some(x => String(x).includes('1.2.3.4')));   // the IP is never kept
});
test('export: needs the token; its CSV feeds the learning merge', async () => {
  const e = env(); await post(e, { q: 'he said "hi", then left', y: 'hi' }); await post(e, { q: 'หมอกพรุ่งนี้', y: 'fog' });
  assert.equal((await onRequestGet({ env: e, request: new Request(SITE + '/api/export') })).status, 401);
  const r = await onRequestGet({ env: e, request: new Request(SITE + '/api/export', { headers: { Authorization: 'Bearer tok' } }) });
  const rows = parseCSV(await r.text()); assert.equal(rows.length, 3);
  assert.deepEqual(merge([], rows.slice(1)).learned.map(x => x.y).sort(), ['fog', 'hi']);
});
test('40 a sender a day; CORS answers the site only', async () => {
  const e = env(); let last; for (let i = 0; i < 41; i++) last = await post(e, { q: 'คำถาม ' + i, y: 'pm' });
  assert.equal(last.status, 429);
  const o = await onRequestOptions({ env: e, request: new Request(SITE + '/api/feedback', { method: 'OPTIONS', headers: { Origin: 'https://smalltee2.github.io' } }) });
  assert.equal(o.headers.get('Access-Control-Allow-Origin'), 'https://smalltee2.github.io');
  const x = await onRequestOptions({ env: e, request: new Request(SITE + '/api/feedback', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }) });
  assert.equal(x.headers.get('Access-Control-Allow-Origin'), null);
});

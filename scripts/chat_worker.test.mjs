// Unit tests of the Ask SEA-HAF feedback Worker (cloudflare/chat-feedback/worker.js) with an in-memory KV: node --test scripts/chat_worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/chat-feedback/worker.js';
import { parseCSV, merge } from './chat_learn.mjs';

function kv() { const m = new Map(); return { m,
  get: async k => m.has(k) ? m.get(k) : null, put: async (k, v) => { m.set(k, v); },
  list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) }; }
const env = () => ({ FEEDBACK: kv(), EXPORT_TOKEN: 'tok', ALLOWED_ORIGINS: 'https://smalltee2.github.io' });
const post = (e, body, origin = 'https://smalltee2.github.io', ip = '1.2.3.4') => worker.fetch(new Request('https://w.example/feedback', { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': ip, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) }), e);
test('feedback: stored from the site; refused from other sites, bad topics, contact details', async () => {
  const e = env();
  assert.equal((await post(e, { q: 'พรุ่งนี้เช้า หมอกไหม', y: 'fog', kind: 'fix' })).status, 200);
  assert.equal((await post(e, { q: 'x y', y: 'pm' }, 'https://evil.example')).status, 403);
  assert.equal((await post(e, { q: 'ฝุ่น', y: 'nonsense' })).status, 400);
  assert.equal((await post(e, { q: 'โทร 0812345678', y: 'pm' })).status, 400);
  assert.equal((await post(e, { q: 'a@b.co', y: 'pm' })).status, 400);
  const stored = [...e.FEEDBACK.m.entries()].filter(([k]) => k.startsWith('fb:'));
  assert.equal(stored.length, 1); assert.deepEqual(Object.keys(JSON.parse(stored[0][1])).sort(), ['kind', 'q', 't', 'y']);   // nothing about the viewer
  assert.ok(![...e.FEEDBACK.m.keys(), ...e.FEEDBACK.m.values()].some(x => String(x).includes('1.2.3.4')));                  // the IP is never kept
});
test('export: needs the token; its CSV feeds the learning merge', async () => {
  const e = env(); await post(e, { q: 'he said "hi", then left', y: 'hi', kind: 'pick' }); await post(e, { q: 'หมอกพรุ่งนี้', y: 'fog' });
  assert.equal((await worker.fetch(new Request('https://w.example/export'), e)).status, 401);
  const r = await worker.fetch(new Request('https://w.example/export', { headers: { Authorization: 'Bearer tok' } }), e);
  assert.equal(r.status, 200); const rows = parseCSV(await r.text()); assert.equal(rows.length, 3);
  const m = merge([], rows.slice(1)); assert.deepEqual(m.learned.map(x => x.y).sort(), ['fog', 'hi']); assert.ok(m.learned.some(x => x.q === 'he said "hi", then left'));
});
test('a sender gets at most 40 a day; CORS answers the site only', async () => {
  const e = env(); let last;
  for (let i = 0; i < 41; i++) last = await post(e, { q: 'คำถาม ' + i, y: 'pm' });
  assert.equal(last.status, 429);
  const o = await worker.fetch(new Request('https://w.example/feedback', { method: 'OPTIONS', headers: { Origin: 'https://smalltee2.github.io' } }), e);
  assert.equal(o.headers.get('Access-Control-Allow-Origin'), 'https://smalltee2.github.io');
});

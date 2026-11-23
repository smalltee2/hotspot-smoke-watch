// The admin's labelling queue (dev page, "Chat questions to label"), only with "Authorization: Bearer <EXPORT_TOKEN>".
//   GET  /api/label?n=40   questions not labelled yet (newest first), each with how often it was sent, the viewers' picks and the
//                          classifier's guesses, and the local LLM's suggestion if any (api/suggest.js):
//                          [{q, n, votes: {topic: count}, guess: {topic: count}, kinds: [...], llm: {y, conf, model} | null}]
//   POST /api/label {"q": question, "y": topic | "skip"}   the admin's label (replaces an earlier one); "skip" = not a usable question
// Labelled questions go to the weekly training (/api/export, kind admin): a fixed third of them becomes test questions
// (chat/test_real.json, scripts/chat_learn.mjs), the rest training rows.
import { TOPICS, cors, isAdmin, qkey, ensure } from '../_common.js';
export async function onRequestOptions({ request, env }) { return new Response(null, { status: 204, headers: cors(request, env).headers }); }
export async function onRequestGet({ request, env }) {
  const c = cors(request, env); if (!c.ok) return new Response('origin not allowed', { status: 403 });
  if (!isAdmin(request, env)) return new Response('unauthorized', { status: 401, headers: c.headers });
  await ensure(env);
  const n = Math.max(1, Math.min(200, +new URL(request.url).searchParams.get('n') || 40));
  const done = new Set(((await env.DB.prepare('SELECT qk FROM chat_label').all()).results || []).map(r => r.qk));
  const rows = (await env.DB.prepare('SELECT id, q, y, kind FROM chat_feedback ORDER BY id DESC LIMIT 5000').all()).results || [];
  const by = new Map();
  for (const r of rows) { const k = qkey(r.q); if (done.has(k)) continue;
    const e = by.get(k) || by.set(k, { q: r.q, n: 0, votes: {}, guess: {}, kinds: new Set() }).get(k);
    e.n++; e.kinds.add(r.kind); const t = r.kind === 'pick' || r.kind === 'fix' ? e.votes : e.guess; t[r.y] = (t[r.y] || 0) + 1; }
  const sug = new Map(((await env.DB.prepare('SELECT qk, y, conf, model FROM chat_suggest').all()).results || []).map(r => [r.qk, { y: r.y, conf: r.conf, model: r.model }]));
  const out = [...by.entries()].slice(0, n).map(([k, e]) => ({ ...e, kinds: [...e.kinds], llm: sug.get(k) || null }));
  return new Response(JSON.stringify({ queue: out, waiting: by.size, labelled: done.size }), { headers: { ...c.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
export async function onRequestPost({ request, env }) {
  const c = cors(request, env); if (!c.ok) return new Response('origin not allowed', { status: 403 });
  if (!isAdmin(request, env)) return new Response('unauthorized', { status: 401, headers: c.headers });
  let b; try { b = await request.json(); } catch (e) { return new Response('bad json', { status: 400, headers: c.headers }); }
  const q = String(b.q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(), y = String(b.y || '');
  if (q.length < 2 || q.length > 200 || !(TOPICS.includes(y) || y === 'skip')) return new Response('refused', { status: 400, headers: c.headers });
  await ensure(env);
  await env.DB.prepare('INSERT INTO chat_label (qk, q, y, t) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(qk) DO UPDATE SET y = excluded.y, t = excluded.t').bind(qkey(q), q, y, new Date().toISOString()).run();
  return new Response('ok', { headers: c.headers });
}

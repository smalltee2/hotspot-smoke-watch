// POST /api/suggest {"q": question, "y": topic, "conf": 0..1, "model": "qwen2.5:7b"} — a topic suggested by the admin's local LLM
// (scripts/chat_llm_label.mjs, run on the admin's own computer with Ollama or LM Studio), only with "Authorization: Bearer
// <EXPORT_TOKEN>". Stored in table chat_suggest and shown on the dev page's labelling queue as a one-click choice. A suggestion is
// never a label by itself: only the admin's click (api/label.js) makes it one, so the real test questions stay checked by a person.
import { TOPICS, isAdmin, qkey, ensure } from '../_common.js';
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return new Response('unauthorized', { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  const q = String(b.q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(), y = String(b.y || ''), conf = Math.max(0, Math.min(1, +b.conf || 0));
  const model = String(b.model || '').replace(/[^\w.:\/-]/g, '').slice(0, 60);
  if (q.length < 2 || q.length > 200 || !TOPICS.includes(y)) return new Response('refused', { status: 400 });
  await ensure(env);
  await env.DB.prepare('INSERT INTO chat_suggest (qk, y, conf, model, t) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(qk) DO UPDATE SET y = excluded.y, conf = excluded.conf, model = excluded.model, t = excluded.t')
    .bind(qkey(q), y, conf, model, new Date().toISOString()).run();
  return new Response('ok');
}

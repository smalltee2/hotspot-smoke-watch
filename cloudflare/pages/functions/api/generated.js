// POST /api/generated {"model": "...", "items": [{"q": question, "y": topic}, ...]} — questions written by the admin's local LLM
// (scripts/chat_llm_label.mjs --generate; each kept only when the model classifies it back to its topic), only with
// "Authorization: Bearer <EXPORT_TOKEN>". Stored in table chat_gen and exported as kind llmgen: the weekly training uses them as
// training rows only, never as test questions. At most 200 a request; a question already stored is kept as it was.
import { TOPICS, isAdmin, qkey, ensure } from '../_common.js';
export async function onRequestPost({ request, env }) {
  if (!isAdmin(request, env)) return new Response('unauthorized', { status: 401 });
  let b; try { b = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  const items = Array.isArray(b.items) ? b.items.slice(0, 200) : [], model = String(b.model || '').replace(/[^\w.:\/-]/g, '').slice(0, 60), t = new Date().toISOString();
  const ok = items.map(x => ({ q: String(x?.q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(), y: String(x?.y || '') }))
    .filter(x => x.q.length >= 2 && x.q.length <= 200 && TOPICS.includes(x.y) && !/\d{7,}|@|https?:|www\./i.test(x.q));
  if (!ok.length) return new Response('nothing usable', { status: 400 });
  await ensure(env);
  await env.DB.batch(ok.map(x => env.DB.prepare('INSERT INTO chat_gen (qk, q, y, model, t) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(qk) DO NOTHING').bind(qkey(x.q), x.q, x.y, model, t)));
  return new Response(JSON.stringify({ stored: ok.length, refused: items.length - ok.length }), { headers: { 'Content-Type': 'application/json' } });
}

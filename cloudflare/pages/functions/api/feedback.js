// POST /api/feedback  {"q": question, "y": topic, "kind": ...}  — the chat's questions, into D1 (table chat_feedback).
//   kind "pick" / "fix": the viewer chose the topic ("which do you mean?" / "not what I asked?"): a label;
//   kind "unsure": the classifier was not sure (y = its guess), to be labelled by the admin on the dev page;
//   kind "collect": a question asked in the chat's collecting mode (?chatlab=1, e.g. a class trying the bot), also for the admin.
// Refused: other sites, unknown topics, phone numbers, e-mails, links; more than 40 a sender a day (600 in collecting mode).
// The daily count is kept in KV under a SHA-256 of IP + date for one day; the IP itself is never stored.
// Stored: question, topic, kind, time.
import { TOPICS, cors, ensure } from '../_common.js';
const KINDS = ['pick', 'fix', 'unsure', 'collect'], PER_DAY = { collect: 600 }, PER_DAY_OTHER = 40;
export async function onRequestOptions({ request, env }) { return new Response(null, { status: 204, headers: cors(request, env).headers }); }
export async function onRequestPost({ request, env }) {
  const c = cors(request, env); if (!c.ok || !request.headers.get('Origin')) return new Response('origin not allowed', { status: 403 });
  let b; try { b = JSON.parse(await request.text()); } catch (e) { return new Response('bad json', { status: 400, headers: c.headers }); }
  const q = String(b.q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(), y = String(b.y || ''), kind = KINDS.includes(b.kind) ? b.kind : 'pick';
  if (q.length < 2 || q.length > 200 || !TOPICS.includes(y) || /\d{7,}|@|https?:|www\./i.test(q)) return new Response('refused', { status: 400, headers: c.headers });
  const day = new Date().toISOString().slice(0, 10), ip = request.headers.get('CF-Connecting-IP') || '', lane = kind === 'collect' ? 'c' : 'v';
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day + '|' + lane)))].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
  const n = +((await env.KV.get('rl:' + h)) || 0); if (n >= (PER_DAY[kind] || PER_DAY_OTHER)) return new Response('limit', { status: 429, headers: c.headers });
  await env.KV.put('rl:' + h, String(n + 1), { expirationTtl: 86400 });
  await ensure(env);
  await env.DB.prepare('INSERT INTO chat_feedback (t, q, y, kind) VALUES (?1, ?2, ?3, ?4)').bind(new Date().toISOString(), q, y, kind).run();
  return new Response('ok', { status: 200, headers: c.headers });
}

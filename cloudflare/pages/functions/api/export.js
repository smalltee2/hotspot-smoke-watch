// GET /api/export — the labelled questions as CSV "timestamp,question,topic,kind", only with "Authorization: Bearer <EXPORT_TOKEN>"
// (the Pages secret; the training job sends the same value from the CHAT_EXPORT_TOKEN GitHub secret). Rows: the viewers'
// labels (kind pick / fix) and the admin's labels from the dev page (kind admin; "skip" labels left out). The questions the
// admin has not labelled yet (unsure / collect) are not labels and are not exported. Questions written by the admin's local LLM
// (api/generated.js) come last as kind llmgen: training rows only, never test questions (scripts/chat_learn.mjs).
import { isAdmin, ensure } from '../_common.js';
export async function onRequestGet({ request, env }) {
  if (!isAdmin(request, env)) return new Response('unauthorized', { status: 401 });
  await ensure(env);
  const fb = (await env.DB.prepare("SELECT t, q, y, kind FROM chat_feedback WHERE kind IN ('pick', 'fix') ORDER BY id").all()).results || [];
  const ad = (await env.DB.prepare("SELECT t, q, y FROM chat_label WHERE y <> 'skip' ORDER BY t").all()).results || [];
  const gen = (await env.DB.prepare('SELECT t, q, y FROM chat_gen ORDER BY t').all()).results || [];
  const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
  const body = ['timestamp,question,topic,kind', ...fb.map(r => [r.t, esc(r.q), r.y, r.kind].join(',')), ...ad.map(r => [r.t, esc(r.q), r.y, 'admin'].join(',')), ...gen.map(r => [r.t, esc(r.q), r.y, 'llmgen'].join(','))].join('\n') + '\n';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
}

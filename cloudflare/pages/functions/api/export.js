// GET /api/export — all labelled questions as CSV "timestamp,question,topic,kind", only with "Authorization: Bearer <EXPORT_TOKEN>"
// (the Pages secret; the training job sends the same value from the CHAT_EXPORT_TOKEN GitHub secret).
export async function onRequestGet({ request, env }) {
  if (!env.EXPORT_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.EXPORT_TOKEN}`) return new Response('unauthorized', { status: 401 });
  const { results } = await env.DB.prepare('SELECT t, q, y, kind FROM chat_feedback ORDER BY id').all();
  const esc = s => '"' + String(s).replace(/"/g, '""') + '"';
  const body = ['timestamp,question,topic,kind', ...(results || []).map(r => [r.t, esc(r.q), r.y, r.kind].join(','))].join('\n') + '\n';
  return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
}

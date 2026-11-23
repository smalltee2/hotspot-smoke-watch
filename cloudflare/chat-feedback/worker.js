// Ask SEA-HAF feedback collector (Cloudflare Worker + KV). The chat on the SEA-HAF page posts the questions viewers labelled
// (the topic they picked under "which do you mean?" / "not what I asked?"); the weekly training job reads them back.
//   POST /feedback   {"q": question, "y": topic, "kind": "pick" | "fix"}   from the page (allowed origins only), no login
//   GET  /export     CSV "timestamp,question,topic,kind"                   Authorization: Bearer <EXPORT_TOKEN>
// Stored: the question text, the topic, the kind and the time; nothing about the viewer (no IP, no cookies). The per-day limit
// per sender uses a SHA-256 of IP + date, kept 1 day, never the IP itself. Questions with phone numbers, e-mails or links are refused.
// Bindings (Settings → Variables / Bindings): KV namespace FEEDBACK; secret EXPORT_TOKEN; text ALLOWED_ORIGINS (comma-separated,
// e.g. "https://smalltee2.github.io").
const TOPICS = ['pm', 'adv', 'rank', 'hot', 'wx', 'fog', 'acc', 'src', 'how', 'whatpm', 'aqi', 'hi', 'other'];
const PER_DAY = 40;   // labelled questions accepted per sender per day

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://smalltee2.github.io').split(',').map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname === '/feedback' && req.method === 'POST') {
      if (!allowed.includes(origin)) return new Response('origin not allowed', { status: 403 });
      let b; try { b = JSON.parse(await req.text()); } catch (e) { return new Response('bad json', { status: 400, headers: cors }); }
      const q = String(b.q || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim(), y = String(b.y || ''), kind = b.kind === 'fix' ? 'fix' : 'pick';
      if (q.length < 2 || q.length > 200 || !TOPICS.includes(y) || /\d{7,}|@|https?:|www\./i.test(q)) return new Response('refused', { status: 400, headers: cors });
      const day = new Date().toISOString().slice(0, 10), ip = req.headers.get('CF-Connecting-IP') || '';
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + '|' + day)))].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
      const n = +(await env.FEEDBACK.get('rl:' + h) || 0); if (n >= PER_DAY) return new Response('limit', { status: 429, headers: cors });
      await env.FEEDBACK.put('rl:' + h, String(n + 1), { expirationTtl: 86400 });
      const t = new Date().toISOString();
      await env.FEEDBACK.put(`fb:${t}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ t, q, y, kind }));
      return new Response('ok', { status: 200, headers: cors });
    }

    if (url.pathname === '/export' && req.method === 'GET') {
      const auth = req.headers.get('Authorization') || '';
      if (!env.EXPORT_TOKEN || auth !== `Bearer ${env.EXPORT_TOKEN}`) return new Response('unauthorized', { status: 401 });
      const esc = s => '"' + String(s).replace(/"/g, '""') + '"', lines = ['timestamp,question,topic,kind'];
      let cursor;
      do { const page = await env.FEEDBACK.list({ prefix: 'fb:', cursor });
        for (const k of page.keys) { const v = await env.FEEDBACK.get(k.name); if (!v) continue; try { const r = JSON.parse(v); lines.push([r.t, esc(r.q), r.y, r.kind].join(',')); } catch (e) {} }
        cursor = page.list_complete ? null : page.cursor; } while (cursor);
      return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return new Response('SEA-HAF chat feedback', { status: 404 });
  },
};

// Shared by the SEA-HAF Pages Functions (functions/api/*). Bindings of the Pages project (cloudflare/pages/wrangler.toml):
// DB = D1 database "sea-haf-db", KV = KV namespace "sea-haf-kv"; secret EXPORT_TOKEN (Pages secret); text ALLOWED_ORIGINS.
export const TOPICS = ['pm', 'adv', 'rank', 'hot', 'wx', 'fog', 'acc', 'src', 'how', 'whatpm', 'aqi', 'hi', 'other'];
const DEFAULT_ORIGINS = 'https://smalltee2.github.io';
/** CORS headers for the site's own origins (the Cloudflare Pages site itself, the GitHub Pages copy); none for other sites */
export function cors(request, env) {
  const origin = request.headers.get('Origin') || '', self = new URL(request.url).origin;
  const allowed = new Set([self, ...(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)]);
  return { ok: !origin || allowed.has(origin), headers: allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', Vary: 'Origin' } : {} };
}
/** the admin's requests (the export for the training job, the labelling queue of the dev page): Bearer EXPORT_TOKEN */
export const isAdmin = (request, env) => !!env.EXPORT_TOKEN && request.headers.get('Authorization') === `Bearer ${env.EXPORT_TOKEN}`;
/** the same question in any spacing or letter case */
export const qkey = q => String(q || '').toLowerCase().replace(/\s+/g, '');
// tables (schema.sql), made on first use so a new table needs no extra setup run
let ready = null;
export function ensure(env) {
  return ready || (ready = env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS chat_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, t TEXT NOT NULL, q TEXT NOT NULL, y TEXT NOT NULL, kind TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS chat_label (qk TEXT PRIMARY KEY, q TEXT NOT NULL, y TEXT NOT NULL, t TEXT NOT NULL)'),
  ]).catch(e => { ready = null; throw e; }));
}

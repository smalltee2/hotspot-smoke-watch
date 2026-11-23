// Shared by the SEA-HAF Pages Functions (functions/api/*). Bindings of the Pages project (cloudflare/pages/wrangler.toml):
// DB = D1 database "sea-haf-db", KV = KV namespace "sea-haf-kv"; secret EXPORT_TOKEN (Pages secret); text ALLOWED_ORIGINS.
export const TOPICS = ['pm', 'adv', 'rank', 'hot', 'wx', 'fog', 'acc', 'src', 'how', 'whatpm', 'aqi', 'hi', 'other'];
const DEFAULT_ORIGINS = 'https://smalltee2.github.io';
/** CORS headers for the site's own origins (the Cloudflare Pages site itself, the GitHub Pages copy); none for other sites */
export function cors(request, env) {
  const origin = request.headers.get('Origin') || '', self = new URL(request.url).origin;
  const allowed = new Set([self, ...(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS).split(',').map(s => s.trim()).filter(Boolean)]);
  return { ok: !origin || allowed.has(origin), headers: allowed.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' } : {} };
}

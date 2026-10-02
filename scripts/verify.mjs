// Verification: match logged forecasts to later observations and score them by lead time.
// Output: data/verify.json  { updated, window_days, leads: [{lead_h, n, raw:{mb,rmse,r}, corrected:{mb,rmse,r}}] }
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HIST = path.join(ROOT, 'data', 'history');
const WINDOW_DAYS = 30;

async function readCSV(p) {
  const txt = await fs.readFile(p, 'utf8').catch(() => '');
  const [head, ...lines] = txt.trim().split('\n'); if (!head) return [];
  const h = head.split(',');
  return lines.map(l => { const v = l.split(','); const o = {}; h.forEach((k, i) => o[k] = v[i]); return o; });
}
function score(pairs) {
  const n = pairs.length; if (n < 5) return null;
  let sf = 0, so = 0, se = 0, sff = 0, soo = 0, sfo = 0;
  for (const [f, o] of pairs) { sf += f; so += o; se += (f - o) ** 2; sff += f * f; soo += o * o; sfo += f * o; }
  const mf = sf / n, mo = so / n;
  const cov = sfo / n - mf * mo, vf = sff / n - mf * mf, vo = soo / n - mo * mo;
  const rnd = x => Math.round(x * 100) / 100;
  return { mb: rnd(mf - mo), rmse: rnd(Math.sqrt(se / n)), r: vf > 0 && vo > 0 ? rnd(cov / Math.sqrt(vf * vo)) : null, mean_obs: rnd(mo) };
}

// history files: legacy monthly files at the top level, and one file per run in YYYY-MM/ folders
const files = [];
for (const e of await fs.readdir(HIST, { withFileTypes: true }).catch(() => [])) {
  if (e.isFile()) files.push(e.name);
  else if (e.isDirectory()) for (const f of await fs.readdir(path.join(HIST, e.name)).catch(() => [])) files.push(path.join(e.name, f));
}
const cutoff = Date.now() - WINDOW_DAYS * 864e5;
const obs = new Map();
for (const f of files.filter(f => path.basename(f).startsWith('obs-'))) for (const r of await readCSV(path.join(HIST, f))) {
  const t = Date.parse(r.time_utc); if (t < cutoff) continue;
  obs.set(`${r.station_id}|${new Date(Math.round(t / 3600e3) * 3600e3).toISOString().slice(0, 13)}`, +r.obs_pm25);
}
const byLead = new Map();
for (const f of files.filter(f => path.basename(f).startsWith('fcst-'))) { const seen = new Set(); for (const r of await readCSV(path.join(HIST, f))) {
  // several runs in one hour (manual or overlapping triggers) appended to the same file before 2 Oct 2026: keep the first forecast per station and lead
  const key = `${r.station_id}|${r.lead_h}|${r.valid_utc}`; if (seen.has(key)) continue; seen.add(key);
  if (Date.parse(r.valid_utc) < cutoff) continue;
  const o = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`); if (o == null) continue;
  const L = +r.lead_h; if (!byLead.has(L)) byLead.set(L, { raw: [], cor: [] });
  byLead.get(L).raw.push([+r.cams_raw, o]); byLead.get(L).cor.push([+r.corrected, o]);
} }
const leads = [...byLead.entries()].sort((a, b) => a[0] - b[0])
  .map(([L, v]) => ({ lead_h: L, n: v.raw.length, raw: score(v.raw), corrected: score(v.cor) }));
await fs.writeFile(path.join(ROOT, 'data', 'verify.json'), JSON.stringify({ updated: Date.now(), window_days: WINDOW_DAYS, leads }));
console.log('verify:', leads.map(l => `${l.lead_h}h n=${l.n}`).join(' '));

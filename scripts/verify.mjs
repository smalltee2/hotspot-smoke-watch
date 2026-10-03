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
const obs = new Map(), hk = t => new Date(Math.round(t / 3600e3) * 3600e3).toISOString().slice(0, 13);
for (const f of files.filter(f => path.basename(f).startsWith('obs-'))) for (const r of await readCSV(path.join(HIST, f))) {
  const t = Date.parse(r.time_utc); if (t < cutoff - 864e5) continue;
  obs.set(`${r.station_id}|${hk(t)}`, +r.obs_pm25);
}
// Air4Thai direct (from 3 Oct 2026): daily archive of hourly values (hour-ending time stamps) fills hours the runs missed
for (const f of files.filter(f => path.basename(f).startsWith('a4t-'))) for (const r of await readCSV(path.join(HIST, f))) {
  const t = Date.parse(r.hour_end_utc); if (t < cutoff - 864e5 || !isFinite(+r.pm25)) continue;
  const k = `${r.station_id}|${hk(t)}`; if (!obs.has(k)) obs.set(k, +r.pm25);
}
// observed 24-h mean ending at an hour, from hourly values (≥ 18 of 24, the usual 75 % rule)
function obs24From(id, hour) { const t1 = Date.parse(hour + ':00:00Z'); let s = 0, n = 0;
  for (let h = 0; h < 24; h++) { const v = obs.get(`${id}|${hk(t1 - h * 3600e3)}`); if (v != null) { s += v; n++; } } return n >= 18 ? s / n : null; }
// From 2 Oct 2026 the log also holds 24-h-mean forecasts (cams24, corr24, blend24) for Air4Thai stations, whose observations are
// 24-h running means; those rows are scored like for like. Older rows compared hourly CAMS with 24-h observations and are kept apart.
const byLead = new Map(), legacy = new Map(), hourly = new Map();
for (const f of files.filter(f => path.basename(f).startsWith('fcst-'))) { const seen = new Set(); for (const r of await readCSV(path.join(HIST, f))) {
  // several runs in one hour (manual or overlapping triggers) appended to the same file before 2 Oct 2026: keep the first forecast per station and lead
  const key = `${r.station_id}|${r.lead_h}|${r.valid_utc}`; if (seen.has(key)) continue; seen.add(key);
  if (r.monitor === '0') continue;   // the page's verification table: reference monitors only
  if (Date.parse(r.valid_utc) < cutoff) continue;
  const L = +r.lead_h, hourlyObs = r.obs_basis === 'h';
  const oH = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`);
  const hasA = r.correctedA !== undefined && r.correctedA !== '';
  if (hourlyObs && oH != null) { if (!hourly.has(L)) hourly.set(L, { raw: [], cor: [], corA: [] }); const Hh = hourly.get(L);
    Hh.raw.push([+r.cams_raw, oH]); Hh.cor.push([+r.corrected, oH]); if (hasA) Hh.corA.push([+r.correctedA, oH, +r.corrected]);
    if (hasA && r.correctedML !== undefined && r.correctedML !== '') (Hh.corML ||= []).push([+r.correctedML, oH, +r.correctedA]); }
  // 24-h comparisons: stations reporting 24-h means use their value as is; hourly stations use the mean of their hourly values
  const o = hourlyObs ? obs24From(r.station_id, r.valid_utc.slice(0, 13)) : oH; if (o == null) continue;
  if (r.cams24 !== undefined && r.cams24 !== '' && r.blend24 !== '') {
    if (!byLead.has(L)) byLead.set(L, { raw: [], cor: [], blend: [], blendA: [] });
    const B = byLead.get(L); B.raw.push([+r.cams24, o]); B.cor.push([+r.corr24, o]); B.blend.push([+r.blend24, o]);
    if (r.blend24A !== undefined && r.blend24A !== '') B.blendA.push([+r.blend24A, o, +r.blend24]);
    if (r.blend24ML !== undefined && r.blend24ML !== '' && r.blend24A !== '') (B.blendML ||= []).push([+r.blend24ML, o, +r.blend24A]);
  } else if (!hourlyObs) { if (!legacy.has(L)) legacy.set(L, { raw: [], cor: [] }); legacy.get(L).raw.push([+r.cams_raw, o]); legacy.get(L).cor.push([+r.corrected, o]); }
} }
const useNew = byLead.size > 0, src = useNew ? byLead : legacy;
const leads = [...src.entries()].sort((a, b) => a[0] - b[0])
  .map(([L, v]) => ({ lead_h: L, n: v.raw.length, raw: score(v.raw), corrected: score(v.cor), blend: v.blend ? score(v.blend) : null,
    // with the fire assimilation, scored on the rows that have it, next to the same rows without it (paired comparison)
    ...(v.blendA && v.blendA.length >= 5 ? { nA: v.blendA.length, blendA: score(v.blendA), blendNoA: score(v.blendA.map(([, o, b]) => [b, o])) } : {}),
    ...(v.blendML && v.blendML.length >= 5 ? { nML: v.blendML.length, blendML: score(v.blendML), blendNoML: score(v.blendML.map(([, o, b]) => [b, o])) } : {}) }));
const hourlyLeads = [...hourly.entries()].sort((a, b) => a[0] - b[0]).map(([L, v]) => ({ lead_h: L, n: v.raw.length, raw: score(v.raw), corrected: score(v.cor),
  ...(v.corA.length >= 5 ? { nA: v.corA.length, correctedA: score(v.corA), correctedNoA: score(v.corA.map(([, o, c]) => [c, o])) } : {}),
  ...(v.corML && v.corML.length >= 5 ? { nML: v.corML.length, correctedML: score(v.corML), correctedNoML: score(v.corML.map(([, o, c]) => [c, o])) } : {}) }));
await fs.writeFile(path.join(ROOT, 'data', 'verify.json'), JSON.stringify({ updated: Date.now(), window_days: WINDOW_DAYS, basis: useNew ? '24h' : 'legacy-hourly', leads, hourly: hourlyLeads }));
console.log('verify:', leads.map(l => `${l.lead_h}h n=${l.n}`).join(' '));

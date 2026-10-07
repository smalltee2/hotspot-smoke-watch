// Live forecast only: self-learning correction of the weather layers, the same five experts as PM2.5 (scripts/mlcore.mjs):
//   2-m temperature  target y = T_obs − T_page (°C; T_page = the 0.025° value the page shows, t2_down), correction limited to ±5 °C
//   rain             target y = ln(R_obs + 0.2) − ln(R_page + 0.2), R_obs = GSMaP gauge-calibrated at 0.025° (rainobs gsmap_fine),
//                    R_page = ECMWF × CHELSA factor (pr_fine); correction limited to a factor of 4 either way
// Training rows: the weather forecast logs (wxf-*.csv, Air4Thai stations, leads 1–48 h) joined with the measured temperature
// (a4tw-*.csv) and the observed rain (rainobs-*.csv) of the valid hour. Features are values known at issue time only.
// Season expert: rows kept 2 years in data/mltrain/wx/<var>/<season>/ (saved to the "mltrain" branch with the PM2.5 store).
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeEngine } from './mlcore.mjs';
import { seasonOf } from './ml.mjs';

const HOUR = 3600e3;
export const WXML = { leads: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48], fieldStep: 0.1, rainEps: 0.2, keepDays: 730, maxPerDay: 6000 };
export const T2_NAMES = ['lead', 'hsin', 'hcos', 'dsin', 'dcos', 'lat', 'lon', 'elev', 't2', 'dDown', 'lnPr', 'lastErr', 'oT2'];
export const PR_NAMES = ['lead', 'hsin', 'hcos', 'dsin', 'dcos', 'lat', 'lon', 'elev', 'lnPr', 't2', 'lnObsLast', 'lnObs6'];
export const T2ENG = makeEngine(T2_NAMES, 5);
export const PRENG = makeEngine(PR_NAMES, Math.log(4));

const n = v => (v == null || v === '' || !isFinite(+v) ? NaN : +v);
const lnr = v => Math.log(Math.max(0, v) + WXML.rainEps);
const hloc = t => new Date(t + 7 * HOUR).getUTCHours();
const doy = t => { const d = new Date(t + 7 * HOUR); return (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1; };
const cyc = t => { const h = hloc(t), d = doy(t); return [Math.sin(2 * Math.PI * h / 24), Math.cos(2 * Math.PI * h / 24), Math.sin(2 * Math.PI * d / 365.25), Math.cos(2 * Math.PI * d / 365.25)]; };

// feature vectors; o = { lead, tValid, lat, lon, elev, t2, t2e, pr, lastErr, oT2, obsLast, obs6 }
export function t2Features(o) { return [o.lead, ...cyc(o.tValid), o.lat, o.lon, o.elev, o.t2, o.t2 - o.t2e, lnr(n(o.pr) || 0), n(o.lastErr), n(o.oT2)]; }
export function prFeatures(o) { return [o.lead, ...cyc(o.tValid), o.lat, o.lon, o.elev, lnr(n(o.pr) || 0), o.t2, isFinite(n(o.obsLast)) ? lnr(n(o.obsLast)) : NaN, isFinite(n(o.obs6)) ? lnr(n(o.obs6)) : NaN]; }

const parseCSV = txt => { const [head, ...lines] = txt.trim().split('\n'); if (!head) return []; const h = head.split(',');
  return lines.map(l => { const v = l.split(','); const o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
async function listFiles(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f));
  return out; }

// observations by "id|hour_end_ms": temperature (°C) and rain (mm, 0.025° GSMaP) from the history files
export async function loadWxObs(histDir) {
  const files = await listFiles(histDir), T = new Map(), R = new Map();
  for (const f of files.filter(f => /a4tw-\d{8}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) { const t = Date.parse(r.hour_end_utc), v = n(r.temp_c); if (isFinite(t) && isFinite(v)) T.set(`${r.station_id}|${t}`, v); }
  for (const f of files.filter(f => /rainobs-\d{8}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) { if (r.kind !== 'a4t') continue; const t = Date.parse(r.hour_end_utc), v = n(r.gsmap_fine); if (isFinite(t) && isFinite(v)) R.set(`${r.station_id}|${t}`, v); }
  return { T, R, files };
}
const rain6 = (R, id, tEnd) => { let s = 0, k = 0; for (let t = tEnd - 5 * HOUR; t <= tEnd; t += HOUR) { const v = R.get(`${id}|${t}`); if (v != null) { s += v; k++; } } return k >= 4 ? s * 6 / k : NaN; };

// training rows for both variables from the forecast logs; meta: Map(id → {lat, lon})
export async function loadWxDataset(histDir, meta, { from = 0, to = Infinity } = {}) {
  const { T, R, files } = await loadWxObs(histDir), wxf = files.filter(f => /wxf-\d{8}T\d{2}\.csv$/.test(f)).sort(), fc1 = new Map(), all = [];
  for (const f of wxf) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) { r._tI = Date.parse(r.issued_utc); r._tV = Date.parse(r.valid_utc); all.push(r); if (r.lead_h === '1') fc1.set(`${r.station_id}|${r._tV}`, n(r.t2_down)); }
  const t2 = [], pr = [];
  for (const r of all) {
    const tV = r._tV, tI = r._tI; if (!(tV >= from && tV < to)) continue;
    const m = meta.get(r.station_id); if (!m) continue;
    const o = { lead: +r.lead_h, tValid: tV, lat: m.lat, lon: m.lon, elev: n(r.elev_m), t2: n(r.t2_down), t2e: n(r.t2_ecmwf), pr: n(r.pr_fine ?? r.pr_ecmwf) };
    const oT = T.get(`${r.station_id}|${tI - HOUR}`), fT = fc1.get(`${r.station_id}|${tI - HOUR}`);
    o.oT2 = oT; o.lastErr = oT != null && fT != null ? oT - fT : NaN;
    o.obsLast = R.get(`${r.station_id}|${tI - 2 * HOUR}`); o.obs6 = rain6(R, r.station_id, tI - 2 * HOUR);
    const base = { tValid: tV, tIssue: tI, id: r.station_id, lead: o.lead, hloc: hloc(tV) };
    const yt = T.get(`${r.station_id}|${tV}`);
    if (yt != null && isFinite(o.t2)) t2.push({ ...base, x: t2Features(o), y: yt - o.t2 });
    const yr = R.get(`${r.station_id}|${tV}`), pf = n(r.pr_fine);
    if (yr != null && isFinite(pf)) pr.push({ ...base, x: prFeatures({ ...o, pr: pf }), y: lnr(yr) - lnr(pf) });
  }
  return { t2: t2.filter(r => isFinite(r.y)), pr: pr.filter(r => isFinite(r.y)) };
}

// 2-year store per variable and Thai season (same layout idea as the PM2.5 store)
export async function storeWxDay(dir, varName, names, rows, dayStart, gzip) {
  const day = rows.filter(r => r.tValid >= dayStart && r.tValid < dayStart + 864e5); if (!day.length) return 0;
  let s = 777; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const keep = day.length > WXML.maxPerDay ? day.filter(() => rr() < WXML.maxPerDay / day.length) : day;
  const sea = seasonOf(dayStart + 12 * HOUR), dname = new Date(dayStart + 7 * HOUR).toISOString().slice(0, 10).replace(/-/g, '');
  const d = path.join(dir, 'wx', varName, sea.id); await fs.mkdir(d, { recursive: true });
  const head = ['tValid', 'id', 'lead', 'hloc', 'y', ...names].join(',');
  await fs.writeFile(path.join(d, `train-${dname}.csv.gz`), gzip(head + '\n' + keep.map(r => [r.tValid, r.id, r.lead, r.hloc, +r.y.toFixed(4), ...r.x.map(v => isFinite(v) ? +v.toFixed(4) : '')].join(',')).join('\n') + '\n'));
  // drop files older than the keep period
  const cut = new Date(dayStart - WXML.keepDays * 864e5 + 7 * HOUR).toISOString().slice(0, 10).replace(/-/g, '');
  for (const e of await fs.readdir(path.join(dir, 'wx', varName), { withFileTypes: true }).catch(() => [])) if (e.isDirectory())
    for (const f of await fs.readdir(path.join(dir, 'wx', varName, e.name))) { const m = /train-(\d{8})/.exec(f); if (m && m[1] < cut) await fs.unlink(path.join(dir, 'wx', varName, e.name, f)); }
  return keep.length;
}
export async function loadWxSeason(dir, varName, names, t, gunzip, before = Infinity) {
  const cur = seasonOf(t), rows = [], days = new Set(), base = path.join(dir, 'wx', varName);
  for (const e of await fs.readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !e.name.startsWith(cur.name + '-')) continue;
    for (const f of await fs.readdir(path.join(base, e.name))) {
      if (!/^train-\d{8}\.csv\.gz$/.test(f)) continue;
      const [head, ...lines] = gunzip(await fs.readFile(path.join(base, e.name, f))).toString('utf8').trim().split('\n'), h = head.split(','), col = names.map(k => h.indexOf(k));
      for (const l of lines) { const v = l.split(','), tV = +v[0]; if (!(tV < before)) continue;
        rows.push({ tValid: tV, id: v[1], lead: +v[2], hloc: +v[3], y: +v[4], x: col.map(c => (c < 0 || v[c] === '' ? NaN : +v[c])) }); days.add(f); }
    }
  }
  return { season: cur.id, days: days.size, rows };
}

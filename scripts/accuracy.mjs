// How right the published PM2.5 forecast has been lately, for the public page (data/accuracy.json, rebuilt every run from the
// logs in data/history). Scored at the hourly reference monitors (true 1-h values; low-cost sensors and the 24-h-mean feeds are
// left out), hourly values (as the map shows them), over the measured hours of the last 7 days, in two horizons: the next hours
// (forecasts issued 1, 3 and 6 h before) and the next day (12 and 24 h before; the leads the log keeps). Pooling all leads would
// flatter the score: the 1-h forecast is close to the latest measurement.
// Per station the sums only; the page adds them up for any area (here, a Thai region, Thailand, the whole map) and turns them into
//   colour band right   share of hours whose forecast falls in the same Thai PCD band as the measurement (15 / 25 / 37.5 / 75)
//   typical error       mean absolute error, µg/m³
//   tendency            mean forecast − measured (bias), µg/m³, with the mean measured value to judge its size
//   high hours          hours measured >= 37.5 µg/m³ that the forecast also put >= 37.5 (caught), and the forecasts >= 37.5 that
//                       were not (false alarms)
// Run: node scripts/accuracy.mjs   (after update.mjs; reads data/latest.json for the station names and places)
import fs from 'node:fs/promises';
import path from 'node:path';

export const ACC = { days: 7, horizons: { s: [1, 3, 6], l: [12, 24] }, bands: [15, 25, 37.5, 75], thr: 37.5 };
const HZ = Object.fromEntries(Object.entries(ACC.horizons).flatMap(([k, ls]) => ls.map(L => [L, k])));
const H = 3600e3;
const num = v => { if (v == null || v === '') return null; const x = +v; return Number.isFinite(x) ? x : null; };
const first = (...v) => { for (const x of v) { const n = num(x); if (n != null) return n; } return null; };
const k13 = t => new Date(t).toISOString().slice(0, 13);
const parse = txt => { const L = txt.trim().split('\n'); if (L.length < 2) return []; const h = L[0].split(',');
  return L.slice(1).map(l => { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
export const band = v => { let i = 0; while (i < ACC.bands.length && v > ACC.bands[i]) i++; return i; };

// sums kept per station and window: [n, sum |F − O|, sum (F − O), sum O, same band, O >= thr, F >= thr, both >= thr]
export const NEW = () => [0, 0, 0, 0, 0, 0, 0, 0];
export function addPair(a, f, o) {
  a[0]++; a[1] += Math.abs(f - o); a[2] += f - o; a[3] += o; a[4] += band(f) === band(o);
  const oh = o >= ACC.thr, fh = f >= ACC.thr; a[5] += oh; a[6] += fh; a[7] += oh && fh;
}

/** The scores from summed station sums (the page does the same in the browser). null below `minN` pairs. */
export function scores(a, minN = 1) {
  if (!a || a[0] < minN) return null; const n = a[0];
  return { n, bandRight: a[4] / n, mae: a[1] / n, bias: a[2] / n, obsMean: a[3] / n, high: a[5], caught: a[7], warned: a[6], falseAlarms: a[6] - a[7] };
}

/** Scores the forecast log rows against the measurements. rows: fcst CSV rows; obs: Map "id|YYYY-MM-DDTHH" -> µg/m³;
 *  isMonitor(id): fallback for rows logged before the monitor column; tEnd: newest valid hour counted (ms).
 *  Returns Map id -> { s: sums for the next hours, l: sums for the next day } over the last ACC.days days. */
export function scoreRows(rows, obs, tEnd, isMonitor = () => true, out = new Map()) {
  const t0 = tEnd - ACC.days * 24 * H, seen = new Set();
  for (const r of rows) {
    const L = +r.lead_h, hz = HZ[L]; if (!hz || r.obs_basis !== 'h') continue;
    const mon = r.monitor === '0' ? false : r.monitor === '1' ? true : isMonitor(r.station_id); if (!mon) continue;
    const tv = Date.parse(r.valid_utc); if (!(tv > t0 && tv <= tEnd)) continue;
    const key = `${r.station_id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(key)) continue; seen.add(key);
    const o = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`), f = first(r.correctedML, r.correctedA, r.corrected);
    if (o == null || f == null) continue;
    let s = out.get(r.station_id); if (!s) out.set(r.station_id, s = { s: NEW(), l: NEW() });
    addPair(s[hz], f, o);
  }
  return out;
}

async function list(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory())
    for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f));
  return out.sort(); }
const fileT = f => { const m = /-(\d{4})(\d{2})(\d{2})(?:T(\d{2}))?\.csv$/.exec(f); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0)) : NaN; };

async function main() {
  const t00 = Date.now(), ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), DATA = path.join(ROOT, 'data'), HIST = path.join(DATA, 'history');
  const latest = JSON.parse(await fs.readFile(path.join(DATA, 'latest.json'), 'utf8').catch(() => '{}'));
  const meta = new Map((latest.stations || []).map(s => [String(s.id), s]));
  const now = process.env.ACC_NOW ? Date.parse(process.env.ACC_NOW) : Date.now();   // ACC_NOW: local tests only
  const from = now - (ACC.days * 24 + 26) * H, files = (await list(HIST)).filter(f => !(fileT(f) < from - 24 * H));
  const obs = new Map(); let tEnd = 0;
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.pm25), t = Date.parse(r.hour_end_utc); if (v == null || !Number.isFinite(t) || t > now) continue; obs.set(`${r.station_id}|${k13(t)}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.obs_pm25), t = Date.parse(r.time_utc); if (v == null || !Number.isFinite(t) || t > now) continue;
    const k = `${r.station_id}|${k13(Math.round(t / H) * H)}`; if (!obs.has(k)) obs.set(k, v); }
  for (const k of obs.keys()) { const t = Date.parse(k.split('|')[1] + ':00Z'); if (t > tEnd) tEnd = t; }
  if (!tEnd) { console.log('accuracy: no measurements in the logs'); return; }
  const isMon = id => meta.get(id)?.monitor !== false, out = new Map();
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileT(f) >= tEnd - (ACC.days * 24 + 25) * H))
    scoreRows(parse(await fs.readFile(f, 'utf8')), obs, tEnd, isMon, out);
  const r1 = a => a.map((v, i) => (i === 1 || i === 2 || i === 3 ? +v.toFixed(1) : v)), stations = [];
  for (const [id, s] of out) { const m = meta.get(id); if (!m || m.lat == null) continue;
    stations.push({ id, name: m.name || id, ...(m.nameTH ? { nameTH: m.nameTH } : {}), lat: m.lat, lon: m.lon, cc: m.cc || '', s: r1(s.s), l: r1(s.l) }); }
  const doc = { version: 1, generated: Date.now(), tEnd, days: ACC.days, horizons: ACC.horizons, bands: ACC.bands, thr: ACC.thr,
    cols: ['n', 'sumAbsErr', 'sumErr', 'sumObs', 'sameBand', 'obsHigh', 'fcHigh', 'caught'], stations };
  await fs.writeFile(path.join(DATA, 'accuracy.json'), JSON.stringify(doc));
  const part = k => { const a = NEW(); for (const s of stations) s[k].forEach((v, i) => a[i] += v); const S = scores(a);
    return S ? `${k === 's' ? 'next hours' : 'next day'} ${S.n} pairs, colour band right ${(S.bandRight * 100).toFixed(0)} %, typical error ${S.mae.toFixed(1)} µg/m³, bias ${S.bias.toFixed(1)}, hours >= ${ACC.thr} caught ${S.caught} of ${S.high}, false alarms ${S.falseAlarms} of ${S.warned}` : `${k}: none`; };
  const msg = `${stations.length} monitors, ${ACC.days} days to ${k13(tEnd)}Z; ${part('s')}; ${part('l')} (${((Date.now() - t00) / 1e3).toFixed(1)} s)`;
  console.log('accuracy: ' + msg);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('accuracy failed:', e.stack || e.message); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=accuracy::accuracy.mjs failed: ${e.message}`); process.exitCode = 0; });

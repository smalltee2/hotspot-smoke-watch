// How right the published PM2.5 forecast has been lately, for the public page (data/accuracy.json, rebuilt every run from the
// logs in data/history). Scored at the hourly reference monitors (true 1-h values; low-cost sensors and the 24-h-mean feeds are
// left out), hourly values (as the map shows them), over the measured hours of the last 7 days, in two horizons: the next hours
// (forecasts issued 1, 3 and 6 h before), the next day (12 and 24 h before) and two days ahead (48 h before; the leads the log
// keeps). Pooling all leads would flatter the score: the 1-h forecast is close to the latest measurement.
// Daily means too (the basis of the Thai AQI and the health advice): the published 24-h mean (blend24) forecast 24 h and 48 h
// before, against the measured 24-h mean of the same 24 hours (>= 18 measured hours). Only these two leads: at shorter leads the
// 24 hours ending at the valid time are partly measured already, which would flatter the score.
// Per station the sums only; the page adds them up for any area (here, a Thai region, Thailand, the whole map) and turns them into
//   colour band right   share of hours whose forecast falls in the same Thai PCD band as the measurement (15 / 25 / 37.5 / 75)
//   typical error       mean absolute error, µg/m³
//   tendency            mean forecast − measured (bias), µg/m³, with the mean measured value to judge its size
//   high hours          hours measured >= 37.5 µg/m³ that the forecast also put >= 37.5 (caught), and the forecasts >= 37.5 that
//                       were not (false alarms)
// Run: node scripts/accuracy.mjs   (after update.mjs; reads data/latest.json for the station names and places)
import fs from 'node:fs/promises';
import path from 'node:path';

export const ACC = { days: 7, horizons: { s: [1, 3, 6], l: [12, 24], d2: [48] }, daily: { y1: 24, y2: 48 }, minHours24: 18, bands: [15, 25, 37.5, 75], thr: 37.5 };
const DAILY = Object.fromEntries(Object.entries(ACC.daily).map(([k, L]) => [L, k]));
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
 *  Returns Map id -> { s: next hours, l: next day, d2: two days ahead, y1 / y2: daily mean 24 h / 48 h ahead } (sums) over the last ACC.days days. */
export function scoreRows(rows, obs, tEnd, isMonitor = () => true, out = new Map()) {
  const t0 = tEnd - ACC.days * 24 * H, seen = new Set();
  for (const r of rows) {
    const L = +r.lead_h, hz = HZ[L], dz = DAILY[L]; if ((!hz && !dz) || r.obs_basis !== 'h') continue;
    const mon = r.monitor === '0' ? false : r.monitor === '1' ? true : isMonitor(r.station_id); if (!mon) continue;
    const tv = Date.parse(r.valid_utc); if (!(tv > t0 && tv <= tEnd)) continue;
    const key = `${r.station_id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(key)) continue; seen.add(key);
    const get = () => { let s = out.get(r.station_id); if (!s) out.set(r.station_id, s = { s: NEW(), l: NEW(), d2: NEW(), y1: NEW(), y2: NEW() }); return s; };
    const o = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`), f = first(r.correctedML, r.correctedA, r.corrected);
    if (hz && o != null && f != null) addPair(get()[hz], f, o);
    if (dz) { const f24 = first(r.blend24ML, r.blend24A, r.blend24); let su = 0, n = 0;
      for (let q = 0; q < 24; q++) { const v = obs.get(`${r.station_id}|${k13(tv - q * H)}`); if (v != null) { su += v; n++; } }
      if (f24 != null && n >= ACC.minHours24) addPair(get()[dz], f24, su / n); }
  }
  return out;
}

// IQAir comparison (page layer "AQI compared with IQAir, now"): IQAir's real-time city AQI (iqair-*.csv, from scripts/iqair.mjs) and our
// forecast for the same hour (issued 1 h before, correctedML) at the nearest hourly reference monitor within IQ_KM, both scored
// against that monitor's measurement with the same sums as above (Thai PCD bands, µg/m³; IQAir's US AQI turned back into µg/m³).
// Both are "now" values close to the measurements (IQAir also uses Air4Thai), so this says how close each is now, not forecast skill.
export const IQ_KM = 15;
const AQI_US = [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]];
/** US AQI (EPA 2024) -> PM2.5 µg/m³, the middle of the concentrations that give it */
export function usAqiToPm(a) { if (!(a >= 0)) return null; for (const [cl, ch, il, ih] of AQI_US) if (a <= ih) return +(cl + (ch - cl) * (a - il) / (ih - il)).toFixed(1); return 325.4; }
const kmBetween = (a, b, c, d) => { const p = Math.PI / 180, x = (d - b) * p * Math.cos((a + c) / 2 * p), y = (c - a) * p; return 6371 * Math.hypot(x, y); };
/** iq: iqair log rows; obs: Map id|hour -> µg; fc1: Map id|hour -> our 1-h forecast; monitors: [{id, lat, lon}]; t0..tEnd: window */
export function scoreIqair(iq, obs, fc1, monitors, t0, tEnd) {
  const out = new Map(), seen = new Set();
  for (const r of iq) {
    const t = Math.round(Date.parse(r.time_utc) / H) * H, a = num(r.aqius), lat = num(r.lat), lon = num(r.lon); if (!(t > t0 && t <= tEnd) || a == null || lat == null) continue;
    const key = `${r.city_id}|${t}`; if (seen.has(key)) continue; seen.add(key);
    let best = null, dB = IQ_KM; for (const m of monitors) { if (!obs.has(`${m.id}|${k13(t)}`)) continue; const d = kmBetween(lat, lon, m.lat, m.lon); if (d < dB) { dB = d; best = m; } }
    if (!best) continue;
    const o = obs.get(`${best.id}|${k13(t)}`), f = fc1.get(`${best.id}|${k13(t)}`);
    let c = out.get(r.city_id); if (!c) out.set(r.city_id, c = { id: r.city_id, name: r.name, lat, lon, station: best.id, km: +dB.toFixed(1), iq: NEW(), sea: NEW() });
    if (f == null) continue;   // scored only where both exist, so the two shares are over the same hours
    addPair(c.iq, usAqiToPm(a), o); addPair(c.sea, f, o);
  }
  return [...out.values()].filter(c => c.iq[0] > 0);
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
  const isMon = id => meta.get(id)?.monitor !== false, out = new Map(), fc1 = new Map();
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileT(f) >= tEnd - (ACC.days * 24 + 49) * H)) {
    const rows = parse(await fs.readFile(f, 'utf8')); scoreRows(rows, obs, tEnd, isMon, out);
    for (const r of rows) if (r.lead_h === '1' && r.obs_basis === 'h') { const v = first(r.correctedML, r.correctedA, r.corrected); if (v != null) fc1.set(`${r.station_id}|${r.valid_utc.slice(0, 13)}`, v); } }
  const iqRows = []; for (const f of files.filter(f => /iqair-\d{8}T\d{2}\.csv$/.test(f))) iqRows.push(...parse(await fs.readFile(f, 'utf8')));
  const monitors = (latest.stations || []).filter(s => s.monitor !== false && s.hourly !== false && !s.avg24 && s.lat != null).map(s => ({ id: String(s.id), lat: s.lat, lon: s.lon }));
  const iqCities = scoreIqair(iqRows, obs, fc1, monitors, tEnd - ACC.days * 24 * H, tEnd);
  const r1 = a => a.map((v, i) => (i === 1 || i === 2 || i === 3 ? +v.toFixed(1) : v)), stations = [];
  for (const [id, s] of out) { const m = meta.get(id); if (!m || m.lat == null) continue;
    stations.push({ id, name: m.name || id, ...(m.nameTH ? { nameTH: m.nameTH } : {}), lat: m.lat, lon: m.lon, cc: m.cc || '', s: r1(s.s), l: r1(s.l), d2: r1(s.d2), y1: r1(s.y1), y2: r1(s.y2) }); }
  const r1i = a => a.map((v, i) => (i === 1 || i === 2 || i === 3 ? +v.toFixed(1) : v));
  const doc = { version: 1, generated: Date.now(), tEnd, days: ACC.days, horizons: ACC.horizons, daily: ACC.daily, bands: ACC.bands, thr: ACC.thr,
    iqair: iqCities.map(c => ({ ...c, iq: r1i(c.iq), sea: r1i(c.sea) })),
    cols: ['n', 'sumAbsErr', 'sumErr', 'sumObs', 'sameBand', 'obsHigh', 'fcHigh', 'caught'], stations };
  await fs.writeFile(path.join(DATA, 'accuracy.json'), JSON.stringify(doc));
  const part = k => { const a = NEW(); for (const s of stations) s[k].forEach((v, i) => a[i] += v); const S = scores(a);
    return S ? `${{ s: 'next hours', l: 'next day', d2: 'two days ahead', y1: 'daily mean 24 h ahead', y2: 'daily mean 48 h ahead' }[k]} ${S.n} pairs, colour band right ${(S.bandRight * 100).toFixed(0)} %, typical error ${S.mae.toFixed(1)} µg/m³, bias ${S.bias.toFixed(1)}, hours >= ${ACC.thr} caught ${S.caught} of ${S.high}, false alarms ${S.falseAlarms} of ${S.warned}` : `${k}: none`; };
  const msg = `${stations.length} monitors, ${ACC.days} days to ${k13(tEnd)}Z; ${part('s')}; ${part('l')}; ${part('d2')}; ${part('y1')}; ${part('y2')} (${((Date.now() - t00) / 1e3).toFixed(1)} s)`;
  console.log('accuracy: ' + msg);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('accuracy failed:', e.stack || e.message); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=accuracy::accuracy.mjs failed: ${e.message}`); process.exitCode = 0; });

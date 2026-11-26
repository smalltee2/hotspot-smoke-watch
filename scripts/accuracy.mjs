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
//   R²                  square of Pearson's r between the paired hourly forecasts and measurements (agreement of the ups and downs)
//   MAPE                mean |F − O| / O, in %, over the hours measured >= ACC.mapeMin µg/m³ (below that a 1-µg/m³ miss is tens of %)
//   NRMSE               RMSE / mean measured value, in %; the map badges show 100 − NRMSE as "accuracy" (owner, 26 Nov 2026)
// Run: node scripts/accuracy.mjs   (after update.mjs; reads data/latest.json for the station names and places)
import { dropSpikesHourKeys } from './obsqc.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ACC = { days: 7, horizons: { s: [1, 3, 6], l: [12, 24], d2: [48] }, daily: { y1: 24, y2: 48 }, minHours24: 18, bands: [15, 25, 37.5, 75], thr: 37.5, mapeMin: 10,
  // the map badges (since 26 Nov 2026): calendar-day means (00–24 h Thai time) over the last 30 days, forecast 24 h (m1) and 48 h
  // (m2) before the day ended, so a monitor has ~30 independent days for its R² (7 days of running means gave ~7)
  month: { days: 30, leads: { m1: 24, m2: 48 } } };
const DAILY = Object.fromEntries(Object.entries(ACC.daily).map(([k, L]) => [L, k]));
const HZ = Object.fromEntries(Object.entries(ACC.horizons).flatMap(([k, ls]) => ls.map(L => [L, k])));
const H = 3600e3;
const num = v => { if (v == null || v === '') return null; const x = +v; return Number.isFinite(x) ? x : null; };
const first = (...v) => { for (const x of v) { const n = num(x); if (n != null) return n; } return null; };
const k13 = t => new Date(t).toISOString().slice(0, 13);
const parse = txt => { const L = txt.trim().split('\n'); if (L.length < 2) return []; const h = L[0].split(',');
  return L.slice(1).map(l => { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
export const band = v => { let i = 0; while (i < ACC.bands.length && v > ACC.bands[i]) i++; return i; };

// sums kept per station and window: [n, sum |F − O|, sum (F − O), sum O, same band, O >= thr, F >= thr, both >= thr,
//   sum F, sum F², sum O², sum F·O (for r and R²), n with O >= mapeMin, sum |F − O| / O over those (for MAPE)]
export const COLS = ['n', 'sumAbsErr', 'sumErr', 'sumObs', 'sameBand', 'obsHigh', 'fcHigh', 'caught', 'sumF', 'sumF2', 'sumO2', 'sumFO', 'nMape', 'sumApe'];
export const NEW = () => COLS.map(() => 0);
export function addPair(a, f, o) {
  a[0]++; a[1] += Math.abs(f - o); a[2] += f - o; a[3] += o; a[4] += band(f) === band(o);
  const oh = o >= ACC.thr, fh = f >= ACC.thr; a[5] += oh; a[6] += fh; a[7] += oh && fh;
  a[8] += f; a[9] += f * f; a[10] += o * o; a[11] += f * o;
  if (o >= ACC.mapeMin) { a[12]++; a[13] += Math.abs(f - o) / o; }
}
/** NRMSE in % (RMSE / mean measured) from the sums: sum (F − O)² = sum F² − 2 sum F·O + sum O² */
export function nrmseOf(a) { const n = a[0]; if (!(n > 0) || !(a[3] > 0)) return null; return 100 * Math.sqrt(Math.max(0, (a[9] - 2 * a[11] + a[10]) / n)) / (a[3] / n); }
/** R² (square of Pearson's r) from the sums; null when either series does not vary */
export function r2Of(a) { const n = a[0], sxx = n * a[9] - a[8] * a[8], syy = n * a[10] - a[3] * a[3], sxy = n * a[11] - a[8] * a[3];
  return n > 2 && sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : null; }

/** The scores from summed station sums (the page does the same in the browser). null below `minN` pairs. */
export function scores(a, minN = 1) {
  if (!a || a[0] < minN) return null; const n = a[0];
  return { n, bandRight: a[4] / n, mae: a[1] / n, bias: a[2] / n, obsMean: a[3] / n, high: a[5], caught: a[7], warned: a[6], falseAlarms: a[6] - a[7],
    r2: a.length > 11 ? r2Of(a) : null, mape: a[12] ? 100 * a[13] / a[12] : null, nrmse: a.length > 11 ? nrmseOf(a) : null };
}

/** Scores the forecast log rows against the measurements. rows: fcst CSV rows; obs: Map "id|YYYY-MM-DDTHH" -> µg/m³;
 *  isMonitor(id): fallback for rows logged before the monitor column; tEnd: newest valid hour counted (ms).
 *  want: true = reference monitors (the headline score), false = low-cost sensors (scored apart: see main).
 *  Returns Map id -> { s: next hours, l: next day, d2: two days ahead, y1 / y2: daily mean 24 h / 48 h ahead } (sums) over the last ACC.days days. */
const getSt = (out, id) => { let s = out.get(id); if (!s) out.set(id, s = { s: NEW(), l: NEW(), d2: NEW(), y1: NEW(), y2: NEW(), m1: NEW(), m2: NEW() }); return s; };
const MONTH = Object.fromEntries(Object.entries(ACC.month.leads).map(([k, L]) => [L, k]));
/** Calendar-day means over the last ACC.month.days days: rows valid at 17 UTC (24:00 Thai time) with lead 24 or 48 h (they are in
 *  the logs of the runs issued at 17 UTC), the published 24-h mean forecast against the mean of the 24 measured hours of that Thai
 *  day (>= 18 hours). Adds to out (Map id -> sums) under m1 (24 h ahead) and m2 (48 h ahead). */
export function scoreDays(rows, obs, tEnd, isMonitor = () => true, out = new Map(), want = true) {
  const t0 = tEnd - ACC.month.days * 24 * H, seen = new Set();
  for (const r of rows) {
    const L = +r.lead_h, k = MONTH[L]; if (!k || r.obs_basis !== 'h' || r.valid_utc?.slice(11, 13) !== '17') continue;
    const mon = r.monitor === '0' ? false : r.monitor === '1' ? true : isMonitor(r.station_id); if (mon !== want) continue;
    const tv = Date.parse(r.valid_utc); if (!(tv > t0 && tv <= tEnd)) continue;
    const key = `${r.station_id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(key)) continue; seen.add(key);
    const f24 = first(r.blend24ML, r.blend24A, r.blend24); if (f24 == null) continue;
    let su = 0, n = 0; for (let q = 0; q < 24; q++) { const v = obs.get(`${r.station_id}|${k13(tv - q * H)}`); if (v != null) { su += v; n++; } }
    if (n >= ACC.minHours24) addPair(getSt(out, r.station_id)[k], f24, su / n);
  }
  return out;
}
export function scoreRows(rows, obs, tEnd, isMonitor = () => true, out = new Map(), want = true) {
  const t0 = tEnd - ACC.days * 24 * H, seen = new Set();
  for (const r of rows) {
    const L = +r.lead_h, hz = HZ[L], dz = DAILY[L]; if ((!hz && !dz) || r.obs_basis !== 'h') continue;
    const mon = r.monitor === '0' ? false : r.monitor === '1' ? true : isMonitor(r.station_id); if (mon !== want) continue;
    const tv = Date.parse(r.valid_utc); if (!(tv > t0 && tv <= tEnd)) continue;
    const key = `${r.station_id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(key)) continue; seen.add(key);
    const get = () => getSt(out, r.station_id);
    const o = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`), f = first(r.correctedML, r.correctedA, r.corrected);
    if (hz && o != null && f != null) addPair(get()[hz], f, o);
    if (dz) { const f24 = first(r.blend24ML, r.blend24A, r.blend24); let su = 0, n = 0;
      for (let q = 0; q < 24; q++) { const v = obs.get(`${r.station_id}|${k13(tv - q * H)}`); if (v != null) { su += v; n++; } }
      if (f24 != null && n >= ACC.minHours24) addPair(get()[dz], f24, su / n); }
  }
  return out;
}

// IQAir comparison (page layer "AQI compared with IQAir"): our forecast for the hour of each IQAir reading (issued 1 h before,
// correctedML / correctedA) at the nearest of our forecast points within IQ_KM (any station: reference monitor or low-cost sensor),
// scored against IQAir's real-time city AQI turned back into µg/m³, with the same sums as above (Thai concentration bands): how often
// SEA-HAF falls in the same band as IQAir and how far apart they are. IQAir is the reference here, not the measurements.
export const IQ_KM = 15;
const AQI_US = [[0, 9, 0, 50], [9.1, 35.4, 51, 100], [35.5, 55.4, 101, 150], [55.5, 125.4, 151, 200], [125.5, 225.4, 201, 300], [225.5, 325.4, 301, 500]];
/** US AQI (EPA 2024) -> PM2.5 µg/m³, the middle of the concentrations that give it */
export function usAqiToPm(a) { if (!(a >= 0)) return null; for (const [cl, ch, il, ih] of AQI_US) if (a <= ih) return +(cl + (ch - cl) * (a - il) / (ih - il)).toFixed(1); return 325.4; }
const kmBetween = (a, b, c, d) => { const p = Math.PI / 180, x = (d - b) * p * Math.cos((a + c) / 2 * p), y = (c - a) * p; return 6371 * Math.hypot(x, y); };
/** iq: iqair log rows; fc1: Map id|hour -> our 1-h forecast; points: [{id, lat, lon}] (our stations); t0..tEnd: window
 *  -> [{id, name, lat, lon, station, km, sea: sums of SEA-HAF against IQAir}] */
export function scoreIqair(iq, fc1, points, t0, tEnd) {
  const out = new Map(), seen = new Set();
  for (const r of iq) {
    const t = Math.round(Date.parse(r.time_utc) / H) * H, a = num(r.aqius), lat = num(r.lat), lon = num(r.lon); if (!(t > t0 && t <= tEnd) || a == null || lat == null) continue;
    const key = `${r.city_id}|${t}`; if (seen.has(key)) continue; seen.add(key);
    let best = null, dB = IQ_KM; for (const m of points) { if (!fc1.has(`${m.id}|${k13(t)}`)) continue; const d = kmBetween(lat, lon, m.lat, m.lon); if (d < dB) { dB = d; best = m; } }
    if (!best) continue;
    let c = out.get(r.city_id); if (!c) out.set(r.city_id, c = { id: r.city_id, name: r.name, lat, lon, station: best.id, km: +dB.toFixed(1), sea: NEW() });
    addPair(c.sea, fc1.get(`${best.id}|${k13(t)}`), usAqiToPm(a));
  }
  return [...out.values()].filter(c => c.sea[0] > 0);
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
  const from = now - (Math.max(ACC.days, ACC.month.days) * 24 + 26) * H, files = (await list(HIST)).filter(f => !(fileT(f) < from - 24 * H));
  const obs = new Map(); let tEnd = 0;
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.pm25), t = Date.parse(r.hour_end_utc); if (v == null || !Number.isFinite(t) || t > now) continue; obs.set(`${r.station_id}|${k13(t)}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.obs_pm25), t = Date.parse(r.time_utc); if (v == null || !Number.isFinite(t) || t > now) continue;
    const k = `${r.station_id}|${k13(Math.round(t / H) * H)}`; if (!obs.has(k)) obs.set(k, v); }
  dropSpikesHourKeys(obs);   // instrument spikes kept in the logs (scripts/obsqc.mjs)
  for (const k of obs.keys()) { const t = Date.parse(k.split('|')[1] + ':00Z'); if (t > tEnd) tEnd = t; }
  if (!tEnd) { console.log('accuracy: no measurements in the logs'); return; }
  const isMon = id => meta.get(id)?.monitor !== false, out = new Map(), fc1 = new Map(), outLc = new Map();
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileT(f) >= tEnd - (ACC.month.days * 24 + 49) * H)) {
    const recent = fileT(f) >= tEnd - (ACC.days * 24 + 49) * H, t17 = /T17\.csv$/.test(f); if (!recent && !t17) continue;   // older: only the 17 UTC runs (day means)
    const rows = parse(await fs.readFile(f, 'utf8'));
    if (t17) { scoreDays(rows, obs, tEnd, isMon, out); scoreDays(rows, obs, tEnd, isMon, outLc, false); }
    if (!recent) continue;
    scoreRows(rows, obs, tEnd, isMon, out); scoreRows(rows, obs, tEnd, isMon, outLc, false);
    for (const r of rows) if (r.lead_h === '1') { const v = first(r.correctedML, r.correctedA, r.corrected); if (v != null) fc1.set(`${r.station_id}|${r.valid_utc.slice(0, 13)}`, v); } }
  const iqRows = []; for (const f of files.filter(f => /iqair-\d{8}T\d{2}\.csv$/.test(f))) iqRows.push(...parse(await fs.readFile(f, 'utf8')));
  const points = (latest.stations || []).filter(s => s.lat != null).map(s => ({ id: String(s.id), lat: s.lat, lon: s.lon }));
  const iqCities = scoreIqair(iqRows, fc1, points, tEnd - ACC.days * 24 * H, tEnd);
  const r1 = a => a.map((v, i) => (i === 13 ? +v.toFixed(3) : [1, 2, 3, 8, 9, 10, 11].includes(i) ? +v.toFixed(1) : v)), stations = [];
  for (const [id, s] of out) { const m = meta.get(id); if (!m || m.lat == null) continue;
    stations.push({ id, name: m.name || id, ...(m.nameTH ? { nameTH: m.nameTH } : {}), lat: m.lat, lon: m.lon, cc: m.cc || '', s: r1(s.s), l: r1(s.l), d2: r1(s.d2), y1: r1(s.y1), y2: r1(s.y2), m1: r1(s.m1), m2: r1(s.m2) }); }
  // low-cost sensors (OpenAQ: AirGradient, PurpleAir, …), scored apart and never mixed into the headline score: they read high in
  // humid air, and the station correction learns from each sensor's own readings, so this says how close the forecast is to the
  // sensors, not to the true value. Only sensors that pass the pipeline's 30-day check against their neighbours (latest.json qc
  // 'pass' / 'isolated'; files without qc: all). All countries: they are most useful where reference monitors are few.
  const lcOk = m => !m.qc || m.qc === 'pass' || m.qc === 'isolated', lowcost = [];
  for (const [id, s] of outLc) { const m = meta.get(id); if (!m || m.lat == null || m.monitor || !lcOk(m)) continue;
    lowcost.push({ id, name: m.name || id, lat: m.lat, lon: m.lon, cc: m.cc || '', s: r1(s.s), l: r1(s.l), d2: r1(s.d2), y1: r1(s.y1), y2: r1(s.y2), m1: r1(s.m1), m2: r1(s.m2) }); }
  const r1i = r1;
  const doc = { version: 1, generated: Date.now(), tEnd, days: ACC.days, horizons: ACC.horizons, daily: ACC.daily, month: ACC.month, bands: ACC.bands, thr: ACC.thr,
    iqair: iqCities.map(c => ({ ...c, sea: r1i(c.sea) })), lowcost,
    mapeMin: ACC.mapeMin, cols: COLS, stations };
  await fs.writeFile(path.join(DATA, 'accuracy.json'), JSON.stringify(doc));
  const part = (k, list = stations) => { const a = NEW(); for (const s of list) s[k].forEach((v, i) => a[i] += v); const S = scores(a);
    return S ? `${{ s: 'next hours', l: 'next day', d2: 'two days ahead', y1: 'daily mean 24 h ahead', y2: 'daily mean 48 h ahead', m1: `calendar days (${ACC.month.days} d) 24 h ahead`, m2: `calendar days (${ACC.month.days} d) 48 h ahead` }[k]} ${S.n} pairs, R² ${S.r2 == null ? '–' : S.r2.toFixed(2)}, NRMSE ${S.nrmse == null ? '–' : S.nrmse.toFixed(0) + ' %'}, MAPE ${S.mape == null ? '–' : S.mape.toFixed(0) + ' %'}, colour band right ${(S.bandRight * 100).toFixed(0)} %, typical error ${S.mae.toFixed(1)} µg/m³, bias ${S.bias.toFixed(1)}, hours >= ${ACC.thr} caught ${S.caught} of ${S.high}, false alarms ${S.falseAlarms} of ${S.warned}` : `${k}: none`; };
  const msg = `${stations.length} monitors, ${ACC.days} days to ${k13(tEnd)}Z; ${part('s')}; ${part('l')}; ${part('d2')}; ${part('y1')}; ${part('y2')}; ${part('m1')}; ${part('m2')} (${((Date.now() - t00) / 1e3).toFixed(1)} s)`;
  console.log('accuracy: ' + msg);
  console.log(`accuracy, low-cost sensors (apart): ${lowcost.length} sensors; ${part('s', lowcost)}; ${part('l', lowcost)}; ${part('y1', lowcost)}; ${part('m1', lowcost)}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('accuracy failed:', e.stack || e.message); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=accuracy::accuracy.mjs failed: ${e.message}`); process.exitCode = 0; });

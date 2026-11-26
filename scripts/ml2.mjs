// Candidate PM2.5 correction ("v2"), run beside the live self-learning correction (scripts/ml.mjs) and published only while it
// passes a daily check on the hours that matter for warnings.
//
// Why (analysis of the 1 Oct – 16 Nov 2026 logs, analysis/highpm_replay.py; 47 days, 362,381 test pairs at 106 hourly reference
// monitors, walk-forward): hours >= 37.5 µg/m³ were forecast far too low (measured 50, page 30 at 24 h). Two causes:
//   1. the live correction learns r = ln(obs+1) − ln(F+1); back on the concentration scale that gives the median, not the mean,
//      which pulls high values down;
//   2. its inputs hold only the latest value and the 24-h mean of a station, not the station's own habits (the peaks come back at
//      the same stations at the same hours: half the episodes last 2 h or less, mostly 19:00–01:00, 62 % at 10 stations).
// Replay of both changes together, 24 h ahead: RMSE 8.29 -> 6.98, bias −1.60 -> +0.09, hours >= 37.5 caught 432 -> 656 of 2,239
// with the false-alarm share 37 % -> 30 %; lower error than the page on 36 of 37 days. Each change alone gave about a third of that.
//
// v2 = the same experts and weighting (scripts/mlcore.mjs: base, day, week, month; fixed-share forecaster) with
//   target  y = obs − F  (µg/m³; F = the forecast before the learned correction, corrA), limited to ±CLIP
//   inputs  the live correction's inputs + station history known at issue time (histFeatures below)
// The replay used one boosted-tree model, not this ensemble, so the live log is the real test: pmHighCheck compares v2 with the
// live correction on the last 14 days and v2 reaches the page only while it is at least as good on all three counts.
import { dropSpikes } from './obsqc.mjs';
import fs from 'node:fs/promises'; import path from 'node:path';
import { makeEngine, CORECFG } from './mlcore.mjs';
import { NAMES, featureVector } from './ml.mjs';

const HOUR = 3600e3;
export const ML2 = { clip: 60, maxLeadH: 24, thr: 37.5, checkDays: 14, minRows: 20000, minHigh: 100, obsDays: 10 };
export const HIST_NAMES = ['lnOSame', 'lnOSame2', 'lnMax24', 'lnP90_72', 'lnClimH', 'lnClimMH', 'lnP90MH'];
// multi-year background of each monitor (data/static/pm-clim.json, scripts/climatology.mjs): the usual value and the 90th
// percentile in the month and hour of the valid time, from 3 years of measurements, so v2 knows the seasons its own short logs
// have not seen (above all the burning season). Set once per run with setClimatology(); without it the two inputs are missing.
let CLIMS = null;
export function setClimatology(doc) { CLIMS = doc && doc.stations ? doc.stations : null; return CLIMS ? Object.keys(CLIMS).length : 0; }
export function climFeatures(id, tValid) {
  const c = CLIMS && CLIMS[id]; if (!c) return [NaN, NaN];
  const d = new Date(tValid + 7 * HOUR), k = d.getUTCMonth() * 24 + d.getUTCHours(), m = c.mean[k], p = c.p90[k];
  return [m >= 0 ? ln1(m / 10) : NaN, p >= 0 ? ln1(p / 10) : NaN];
}
export const NAMES2 = [...NAMES, ...HIST_NAMES];
// The boosted trees carry v2 (the replay's model was one of them): they start after 10 verified days, not 30, and are deeper
// than the live correction's (depth 5: the history inputs act through interactions with the hour and the lead).
export const CFG2 = { ...CORECFG, minRowsDay: 300, minDays: { day: 1, week: 7, month: 10 }, gbm: { ...CORECFG.gbm, nTrees: 200, depth: 5, minLeaf: 60 } };
export const ENG2 = makeEngine(NAMES2, ML2.clip, CFG2);

const ln1 = v => Math.log(Math.max(0, v) + 1);
const parseCSV = txt => { const [head, ...lines] = txt.trim().split('\n'); if (!head) return []; const h = head.split(',');
  return lines.map(l => { const v = l.split(','); const o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
async function listFiles(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f));
  return out; }
const fileDay = f => { const m = /-(\d{4})(\d{2})(\d{2})/.exec(path.basename(f)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };

/** Hourly measurements from the logs: Map "id|hourEndMs" -> µg/m³ (the Air4Thai daily archive first, then the run logs),
 *  from files dated `from` − 1 day or later. `extra`: { id: [[t, v], …] } (the run's own newest hours, state.obsHist). */
export async function loadObsHourly(histDir, from = 0, extra = null) {
  const files = (await listFiles(histDir)).filter(f => !(fileDay(f) < from - 2 * 864e5)), obs = new Map();
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) {
    const t = Date.parse(r.hour_end_utc), v = +r.pm25; if (isFinite(t) && r.pm25 !== '' && r.pm25 != null && isFinite(v)) obs.set(`${r.station_id}|${t}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) {
    const t = Math.round(Date.parse(r.time_utc) / HOUR) * HOUR, v = +r.obs_pm25, k = `${r.station_id}|${t}`; if (isFinite(t) && r.obs_pm25 !== '' && r.obs_pm25 != null && isFinite(v) && !obs.has(k)) obs.set(k, v); }
  if (extra) for (const [id, H] of Object.entries(extra)) for (const [t, v] of H || []) { const k = `${id}|${Math.round(t / HOUR) * HOUR}`; if (v != null && isFinite(v) && !obs.has(k)) obs.set(k, v); }
  // the logs keep what was measured, instrument spikes included: the same spike check as at intake (scripts/obsqc.mjs)
  const ser = new Map(); for (const [k, v] of obs) { const i = k.lastIndexOf('|'), id = k.slice(0, i); if (!ser.has(id)) ser.set(id, []); ser.get(id).push([+k.slice(i + 1), v]); }
  for (const [id, rows] of ser) for (const [t] of dropSpikes(rows.sort((a, b) => a[0] - b[0])).dropped) obs.delete(`${id}|${t}`);
  return obs;
}

/** Station history known at issue time, for a forecast issued in the hour tIssue and valid at the hour ending tValid.
 *  Only hours ending at or before tIssue − 1 h are used (the newest hour is often not in yet when the run starts).
 *    lnOSame   the value at the same hour on the newest day known       lnOSame2  the day before that
 *    lnMax24   the maximum of the last 24 known hours (>= 12 values)     lnP90_72  the 90th percentile of the last 72 (>= 36)
 *    lnClimH   the mean at that hour over the 7 days before the lnOSame day (>= 3 values)
 *    lnClimMH, lnP90MH  the station's multi-year mean and 90th percentile for the month and hour of tValid (climFeatures)
 *  All as ln(v + 1); NaN where the station has no such values (the experts treat NaN as missing). */
export function histFeatures(obs, id, tIssue, tValid) {
  const cut = Math.floor(tIssue / HOUR) * HOUR - HOUR, g = t => obs.get(`${id}|${t}`);
  const k = Math.max(1, Math.ceil((tValid - cut) / (24 * HOUR))), tS = tValid - k * 24 * HOUR;
  const f = v => (v == null || !isFinite(v) ? NaN : ln1(v));
  const last = []; for (let t = cut - 71 * HOUR; t <= cut; t += HOUR) { const v = g(t); last.push(v == null || !isFinite(v) ? null : v); }
  const d24 = last.slice(-24).filter(v => v != null), d72 = last.filter(v => v != null).sort((a, b) => a - b);
  let s = 0, n = 0; for (let j = 1; j <= 7; j++) { const v = g(tS - j * 24 * HOUR); if (v != null && isFinite(v)) { s += v; n++; } }
  return [f(g(tS)), f(g(tS - 24 * HOUR)), d24.length >= 12 ? ln1(Math.max(...d24)) : NaN,
    d72.length >= 36 ? ln1(d72[Math.min(d72.length - 1, Math.floor(0.9 * (d72.length - 1) + 0.5))]) : NaN, n >= 3 ? ln1(s / n) : NaN, ...climFeatures(id, tValid)];
}

/** Training rows of v2 from the live correction's rows (ml.mjs loadDataset: tIssue, tValid, id, lead, hloc, F, obs, x). */
export function rows2From(rows, obs) {
  const out = [];
  for (const r of rows) { if (!(r.lead <= ML2.maxLeadH) || !isFinite(r.obs) || !isFinite(r.F)) continue;
    out.push({ tValid: r.tValid, id: r.id, lead: r.lead, hloc: +r.hloc, x: [...r.x, ...histFeatures(obs, r.id, r.tIssue, r.tValid)], y: Math.max(-ML2.clip, Math.min(ML2.clip, r.obs - r.F)) }); }
  return out;
}

/** v2 forecast for one station-hour: F + the weighted experts' correction, never below 0. `f` as featureVector takes it. */
export function predict2(st, f, obs, id, tIssue, tValid) {
  const q = ENG2.correction(st, { lead: f.lead, hloc: +f.hloc, x: [...featureVector(f), ...histFeatures(obs, id, tIssue, tValid)] });
  return Math.max(0, f.F + q);
}

/** Scores of two forecasts against the same measurements, for the check and its tests. */
export function highScore(pairs, thr = ML2.thr) {   // pairs: [[obs, live, v2], …]
  const c = { n: 0, high: 0, hit1: 0, fc1: 0, hit2: 0, fc2: 0, se1: 0, se2: 0 };
  for (const [o, a, b] of pairs) { const hi = o >= thr; c.n++; c.high += hi; if (a >= thr) { c.fc1++; c.hit1 += hi; } if (b >= thr) { c.fc2++; c.hit2 += hi; } c.se1 += (a - o) ** 2; c.se2 += (b - o) ** 2; }
  const fa = k => (c['fc' + k] - c['hit' + k]) / Math.max(1, c['fc' + k]), rm = k => Math.sqrt(c['se' + k] / Math.max(1, c.n));
  const decided = c.n >= ML2.minRows && c.high >= ML2.minHigh;
  return { n: c.n, high: c.high, hit1: c.hit1, hit2: c.hit2, fa1: +fa(1).toFixed(3), fa2: +fa(2).toFixed(3), rmse1: +rm(1).toFixed(3), rmse2: +rm(2).toFixed(3), decided,
    ok: decided && c.hit2 >= c.hit1 && fa(2) <= fa(1) && rm(2) <= rm(1) };
}

/** The daily check: over the last `days` verified days of the forecast log, at hourly reference monitors and leads <= 24 h,
 *  v2 (column correctedML2) against the live correction (correctedML1; correctedML or correctedA in rows without it) on the same
 *  rows. v2 is published only while it catches at least as many hours >= 37.5 µg/m³, with no larger share of false alarms and no
 *  larger RMSE; otherwise the live correction stays (or returns) by itself. */
export async function pmHighCheck(histDir, dayEnd, obs, days = ML2.checkDays, since = 0) {   // since: rows issued before it (older v2 inputs) are not counted
  const from = Math.max(dayEnd - days * 864e5, since), files = (await listFiles(histDir)).filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 3 * 864e5 && fileDay(f) < dayEnd).sort(), pairs = [];
  for (const f of files) { const txt = await fs.readFile(f, 'utf8'); if (!txt.slice(0, 600).includes('correctedML2')) continue;
    for (const r of parseCSV(txt)) {
      if (r.obs_basis !== 'h' || r.monitor === '0' || !(+r.lead_h <= ML2.maxLeadH) || r.correctedML2 === '' || r.correctedML2 === undefined) continue;
      const tV = Date.parse(r.valid_utc); if (!(tV >= from && tV < dayEnd)) continue; if (since && Date.parse(r.issued_utc) < since) continue;
      const o = obs.get(`${r.station_id}|${tV}`), a = [r.correctedML1, r.correctedML, r.correctedA].find(v => v !== undefined && v !== ''); if (o == null || a === undefined) continue;
      pairs.push([o, +a, +r.correctedML2]); } }
  return { days, ...highScore(pairs) };
}

// Short-range nowcast of hourly PM2.5 at the hourly stations (owner, 28 Nov 2026): the newest measured hour tells how far the
// published forecast is off right now; that error (log ratio of the measured value to the forecast an earlier run made for the
// same hour) is carried into the next hours and fades with lead, e^(−lead/τ), and is cut after maxLeadH. The forecast's own shape
// (diurnal cycle, fronts) is kept: only its level near "now" moves.
// Tested before use (scripts in the session notes of 28 Nov 2026; numbers in README):
//   - Air4Thai hourly, 16–27 Nov 2026 (tuned on 2–15 Nov): τ = 2 h. Hours >= 37.5 µg/m³ caught at 1 h 31 % → 52 %, false-alarm
//     share 42 % → 42 %, RMSE 6.93 → 6.58; at 3 h 20 → 23 %, 49 → 49 %, 7.71 → 7.55; at 6 h unchanged.
//   - Hindcast, smoke seasons 18 Dec–30 Apr, season 2026 (tuned on 2024–25), hourly sensors and monitors: at 3 h RMSE −17 to −20 %,
//     more high hours caught and fewer false alarms; at 6 h a little better; at 9–12 h slightly worse, hence the cut at 6 h.
//   - Both tests gave every station the hour ending one hour before the run, at its final value. In a real run half the Air4Thai
//     stations publish that hour too late, and some values are preliminary. Rebuilt on the hours each run really had (28 Nov 2026,
//     14 days to 27 Nov, leads 1–6 h): caught 1270 → 1638 of 5154, but false alarms 48.8 → 50.6 % and RMSE 7.99 → 8.11, so that
//     version failed the check below; version B (PMNOW) replaced it.
// Published only while its daily check over the last 14 days passes (pmNowCheck): it must catch at least as many hours
// >= 37.5 µg/m³ as the forecast without it, with no larger share of false alarms and no larger RMSE; else it is logged only.
import fs from 'node:fs/promises';
import { highScore, listFiles, parseCSV, fileDay, ML2 } from './ml2.mjs';

// Version B (owner, 28 Nov 2026), chosen from 47 variants tested on the run-time rebuild of 24 Oct – 27 Nov 2026 (Air4Thai hourly
// stations, the newest hour each run really had): only a measured hour that ends at most 1 h before the run's hour (older ones
// are stale: half the stations publish late), the error clamped to ±0.5 (a few large raises did most of the damage), a faster
// fade (τ 1.5 h), and none at the 20 stations whose hourly values Air4Thai often revises after first publication (their first
// value moved the forecast the wrong way). Test window 14–27 Nov against no nowcast, leads 1/3/6 pooled: hours >= 37.5 caught
// +124 (1055 of 4698 without), false-alarm share −1.5 points, RMSE −0.073; it also passes on 24 Oct – 13 Nov, at every lead,
// in all 22 trailing 14-day windows, and in 95 % of day resamples. The earlier version (τ 2, ±1.5, any hour up to 3 h old, all
// stations) caught more (+323) but with more false alarms (+2.1 points) and a larger RMSE (+0.095): it failed the rule.
export const PMNOW = { tauH: 1.5, maxLeadH: 6, maxErr: 0.5, maxAgeH: 1, checkDays: 14, keepH: 12,
  skip: ['a4t:02t', 'a4t:40t', 'a4t:50t', 'a4t:52t', 'a4t:53t', 'a4t:59t', 'a4t:61t', 'a4t:68t', 'a4t:69t', 'a4t:70t',
    'a4t:92t', 'a4t:93t', 'a4t:94t', 'a4t:97t', 'a4t:98t', 'a4t:118t', 'a4t:119t', 'a4t:120t', 'a4t:121t', 'a4t:o10'] };
const HOUR = 3600e3, ln1 = v => Math.log(Math.max(0, v) + 1);

/** The error now: newest measured hour [t, v] against the forecast stored for that hour by an earlier run (fc: {hourMs: value}).
 *  Returns the log ratio (clamped to ±maxErr) or null when there is nothing recent to compare. */
export function errNow(last, fc, now, par = PMNOW, id = null) {
  if (!last || !fc || (id != null && par.skip?.includes(String(id)))) return null; const [t, v] = last, f = fc[t];
  if (f == null || !isFinite(v) || !isFinite(f) || Math.floor(now / HOUR) * HOUR - t > par.maxAgeH * HOUR) return null;   // age on the run's hour (a run ends ~10 min past it)
  return Math.max(-par.maxErr, Math.min(par.maxErr, ln1(v) - ln1(f)));
}
/** base: the hourly series to adjust (index j over hours, jNow = the current hour), e: errNow; returns a new array */
export function nowcastSeries(base, hours, t0, jNow, e, par = PMNOW) {
  if (e == null) return base.slice();
  return base.map((v, j) => { if (v == null || j <= jNow) return v; const L = (hours[j] - t0) / HOUR; if (L > par.maxLeadH) return v;
    return Math.round(Math.max(0, (v + 1) * Math.exp(Math.exp(-L / par.tauH) * e) - 1) * 10) / 10; });
}
/** remember this run's forecast for the next hours (the value the next runs compare the measured hour with); older entries go */
export function storeForecast(store, id, base, hours, jNow, now, par = PMNOW) {
  const fc = store[id] || {};
  for (let j = jNow + 1; j < hours.length && (hours[j] - hours[jNow]) <= par.maxLeadH * HOUR; j++) if (base[j] != null) fc[hours[j]] = base[j];
  for (const k of Object.keys(fc)) if (+k < now - par.keepH * HOUR) delete fc[k];
  store[id] = fc; return fc;
}
/** the daily check over the forecast log: Air4Thai hourly stations (the stations the pipeline nowcasts), leads <= maxLeadH, the
 *  published series without the nowcast (correctedPre, or correctedML in logs written before 28 Nov 2026, when the nowcast was
 *  logged only) and the same series moved as the CURRENT definition (par) would have moved it at that run: the error of the
 *  newest measured hour the run really had (the obs-*.csv logs list the hours each run saw first, with the value as first
 *  published), at most maxAgeH old on the run's hour, against the 1-h forecast an earlier run made for that hour; none at the
 *  stations in par.skip. Every row is rebuilt this way, also those logged with correctedNC, so a change of the definition is
 *  judged on the whole window at once (owner, 28 Nov 2026: the rebuild must match what a real run can do). */
export async function pmNowCheck(histDir, dayEnd, obs, days = PMNOW.checkDays, since = 0, par = PMNOW) {
  const from = dayEnd - days * 864e5, pairs = [], rows = [], prev1 = new Map(), skip = new Set(par.skip || []); let tMin = Infinity;
  const all = await listFiles(histDir), seen = new Map();   // seen: station -> [[run hour, measured hour, value], …] in run order
  for (const f of all.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 3 * 864e5 && fileDay(f) < dayEnd).sort()) {
    const m = /obs-(\d{4})(\d{2})(\d{2})T(\d{2})/.exec(f), tR = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]);
    for (const r of parseCSV(await fs.readFile(f, 'utf8'))) { const t = Math.round(Date.parse(r.time_utc) / HOUR) * HOUR, v = +r.obs_pm25; if (!isFinite(t) || r.obs_pm25 === '' || !isFinite(v)) continue;
      if (!seen.has(r.station_id)) seen.set(r.station_id, []); seen.get(r.station_id).push([tR, t, v]); } }
  const newestAt = (id, tI) => { let best = null; for (const r of seen.get(id) || []) { if (r[0] > tI) break; if (!best || r[1] > best[1]) best = r; } return best; };
  const files = all.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 2 * 864e5 && fileDay(f) < dayEnd).sort();
  for (const f of files) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) {
    if (r.obs_basis !== 'h' || r.monitor === '0' || !String(r.station_id).startsWith('a4t:')) continue;
    const tI = Date.parse(r.issued_utc), tV = Date.parse(r.valid_utc), L = +r.lead_h, pre = r.correctedPre != null && r.correctedPre !== '' ? +r.correctedPre : r.correctedML !== '' && r.correctedML != null ? +r.correctedML : NaN;
    if (!isFinite(pre)) continue;
    if (L === 1) prev1.set(`${r.station_id}|${tV}`, pre);   // every run's 1-h forecast without the nowcast (what storeForecast keeps)
    if (!(L <= par.maxLeadH) || !(tV >= from && tV < dayEnd)) continue;
    const o = obs.get(`${r.station_id}|${tV}`); if (o == null) continue;
    rows.push({ id: r.station_id, tI, L, pre, o, tV }); }
  for (const x of rows) {
    const nw = skip.has(x.id) ? null : newestAt(x.id, x.tI), ok = nw && x.tI - nw[1] <= par.maxAgeH * HOUR, f = ok ? prev1.get(`${x.id}|${nw[1]}`) : null;
    const e = !ok || f == null ? null : Math.max(-par.maxErr, Math.min(par.maxErr, ln1(nw[2]) - ln1(f)));
    pairs.push([x.o, x.pre, e == null ? x.pre : Math.round(Math.max(0, (x.pre + 1) * Math.exp(Math.exp(-x.L / par.tauH) * e) - 1) * 10) / 10]); tMin = Math.min(tMin, x.tV); }
  const k = highScore(pairs, ML2.thr), spanD = isFinite(tMin) ? (dayEnd - tMin) / 864e5 : 0;
  // decided only with (nearly) the full 14 days of rows and enough of them (leads 1, 3 and 6 are logged: about 300 rows an hour)
  const decided = spanD >= days - 1 && k.n >= 20000 && k.high >= 50;
  return { days, spanD: +spanD.toFixed(1), rebuilt: rows.length, ...k, decided, ok: decided && k.hit2 >= k.hit1 && k.fa2 <= k.fa1 && k.rmse2 <= k.rmse1 };
}

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
//     14 days to 27 Nov, leads 1–6 h): caught 1270 → 1638 of 5154, but false alarms 48.8 → 50.6 % and RMSE 7.99 → 8.11, so the
//     check below does not pass and the nowcast stays logged only, until real rows show otherwise.
// Published only while its daily check over the last 14 days passes (pmNowCheck): it must catch at least as many hours
// >= 37.5 µg/m³ as the forecast without it, with no larger share of false alarms and no larger RMSE; else it is logged only.
import fs from 'node:fs/promises';
import { highScore, listFiles, parseCSV, fileDay, ML2 } from './ml2.mjs';

export const PMNOW = { tauH: 2, maxLeadH: 6, maxErr: 1.5, maxAgeH: 3, checkDays: 14, keepH: 12 };
const HOUR = 3600e3, ln1 = v => Math.log(Math.max(0, v) + 1);

/** The error now: newest measured hour [t, v] against the forecast stored for that hour by an earlier run (fc: {hourMs: value}).
 *  Returns the log ratio (clamped to ±maxErr) or null when there is nothing recent to compare. */
export function errNow(last, fc, now, par = PMNOW) {
  if (!last || !fc) return null; const [t, v] = last, f = fc[t];
  if (f == null || !isFinite(v) || !isFinite(f) || now - t > par.maxAgeH * HOUR) return null;
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
/** the daily check over the forecast log: hourly reference monitors, leads <= maxLeadH, the series without (correctedPre) and with
 *  (correctedNC) the nowcast. Logs written before 28 Nov 2026 have neither column: there the two are rebuilt from what was
 *  logged, exactly as the pipeline would have computed them (owner: start the check without waiting 14 days): without = the
 *  published correctedML, with = that value moved by the error of the newest measured hour against the 1-h forecast made for
 *  that hour. The newest measured hour is the one the run really had (owner, 28 Nov 2026): the obs-*.csv log of each run lists
 *  the hours it saw for the first time, with the value as first published, so the newest hour of a station at a run is the
 *  latest one logged up to that run. The first version took "the hour ending one hour before the issue time" at its archived
 *  value for every station; half the stations publish an hour later than that, and the rebuilt rows scored better than the
 *  nowcast can do in a real run. That idealised score is still returned (ideal) for comparison; it decides nothing. */
export async function pmNowCheck(histDir, dayEnd, obs, days = PMNOW.checkDays, since = 0, par = PMNOW) {
  const from = dayEnd - days * 864e5, pairs = [], pairsI = [], old = [], prev1 = new Map(); let tMin = Infinity;
  const all = await listFiles(histDir), seen = new Map();   // seen: station -> [[run hour, measured hour, value], …] in run order
  for (const f of all.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 3 * 864e5 && fileDay(f) < dayEnd).sort()) {
    const m = /obs-(\d{4})(\d{2})(\d{2})T(\d{2})/.exec(f), tR = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]);
    for (const r of parseCSV(await fs.readFile(f, 'utf8'))) { const t = Math.round(Date.parse(r.time_utc) / HOUR) * HOUR, v = +r.obs_pm25; if (!isFinite(t) || r.obs_pm25 === '' || !isFinite(v)) continue;
      if (!seen.has(r.station_id)) seen.set(r.station_id, []); seen.get(r.station_id).push([tR, t, v]); } }
  const newCache = new Map(), newestAt = (id, tI) => { const k = id + '|' + tI; if (newCache.has(k)) return newCache.get(k); let best = null;
    for (const r of seen.get(id) || []) { if (r[0] > tI) break; if (!best || r[1] > best[1]) best = r; } newCache.set(k, best); return best; };
  const files = all.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 2 * 864e5 && fileDay(f) < dayEnd).sort();
  for (const f of files) { const txt = await fs.readFile(f, 'utf8'), hasNC = txt.slice(0, 700).includes('correctedNC');
    for (const r of parseCSV(txt)) {
      if (r.obs_basis !== 'h' || r.monitor === '0') continue;
      const tI = Date.parse(r.issued_utc), tV = Date.parse(r.valid_utc), L = +r.lead_h, pub = r.correctedML !== '' && r.correctedML != null ? +r.correctedML : NaN;
      if (L === 1 && isFinite(pub)) prev1.set(`${r.station_id}|${tV}`, pub);   // every run's 1-h forecast, for the rebuilt rows
      if (!(L <= par.maxLeadH) || !(tV >= from && tV < dayEnd)) continue;
      const o = obs.get(`${r.station_id}|${tV}`); if (o == null) continue;
      if (hasNC && r.correctedNC && r.correctedPre) { pairs.push([o, +r.correctedPre, +r.correctedNC]); tMin = Math.min(tMin, tV); }
      else if (!hasNC && isFinite(pub)) old.push({ id: r.station_id, tI, L, pub, o, tV }); } }
  for (const x of old) {   // rebuilt rows: newest measured hour = the hour ending at issue − 1 h; its forecast = the run of issue − 2 h, lead 1
    const tL = x.tI - HOUR, oL = obs.get(`${x.id}|${tL}`), f = prev1.get(`${x.id}|${tL}`);
    const e = oL == null || f == null ? null : Math.max(-par.maxErr, Math.min(par.maxErr, ln1(oL) - ln1(f)));
    const nc = e == null ? x.pub : Math.round(Math.max(0, (x.pub + 1) * Math.exp(Math.exp(-x.L / par.tauH) * e) - 1) * 10) / 10;
    pairsI.push([x.o, x.pub, nc]);   // the idealised rebuild, for comparison only
    const nw = newestAt(x.id, x.tI), ok = nw && x.tI - nw[1] <= par.maxAgeH * HOUR, f2 = ok ? prev1.get(`${x.id}|${nw[1]}`) : null;
    const e2 = !ok || f2 == null ? null : Math.max(-par.maxErr, Math.min(par.maxErr, ln1(nw[2]) - ln1(f2)));
    pairs.push([x.o, x.pub, e2 == null ? x.pub : Math.round(Math.max(0, (x.pub + 1) * Math.exp(Math.exp(-x.L / par.tauH) * e2) - 1) * 10) / 10]); tMin = Math.min(tMin, x.tV); }
  const k = highScore(pairs, ML2.thr), kI = old.length ? highScore([...pairs.slice(0, pairs.length - old.length), ...pairsI], ML2.thr) : null, spanD = isFinite(tMin) ? (dayEnd - tMin) / 864e5 : 0;
  // decided only with (nearly) the full 14 days of rows and enough of them (leads 1, 3 and 6 are logged: about 300 rows an hour)
  const decided = spanD >= days - 1 && k.n >= 20000 && k.high >= 50;
  return { days, spanD: +spanD.toFixed(1), rebuilt: old.length, ...k, ...(kI ? { ideal: { hit2: kI.hit2, fa2: kI.fa2, rmse2: kI.rmse2 } } : {}), decided, ok: decided && k.hit2 >= k.hit1 && k.fa2 <= k.fa1 && k.rmse2 <= k.rmse1 };
}

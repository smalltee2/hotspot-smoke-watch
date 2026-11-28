// Short-range nowcast of hourly PM2.5 at the hourly stations (owner, 28 Nov 2026): the newest measured hour tells how far the
// published forecast is off right now; that error (log ratio of the measured value to the forecast an earlier run made for the
// same hour) is carried into the next hours and fades with lead, e^(−lead/τ), and is cut after maxLeadH. The forecast's own shape
// (diurnal cycle, fronts) is kept: only its level near "now" moves.
// Tested before use (scripts in the session notes of 28 Nov 2026; numbers in README):
//   - Air4Thai hourly, 16–27 Nov 2026 (tuned on 2–15 Nov): τ = 2 h. Hours >= 37.5 µg/m³ caught at 1 h 31 % → 52 %, false-alarm
//     share 42 % → 42 %, RMSE 6.93 → 6.58; at 3 h 20 → 23 %, 49 → 49 %, 7.71 → 7.55; at 6 h unchanged.
//   - Hindcast, smoke seasons 18 Dec–30 Apr, season 2026 (tuned on 2024–25), hourly sensors and monitors: at 3 h RMSE −17 to −20 %,
//     more high hours caught and fewer false alarms; at 6 h a little better; at 9–12 h slightly worse, hence the cut at 6 h.
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
/** the daily check over the forecast log: columns correctedPre (without the nowcast) and correctedNC (with it), hourly reference
 *  monitors, leads <= maxLeadH, rows issued since `since` */
export async function pmNowCheck(histDir, dayEnd, obs, days = PMNOW.checkDays, since = 0, par = PMNOW) {
  const from = Math.max(dayEnd - days * 864e5, since), pairs = [];
  const files = (await listFiles(histDir)).filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f) && fileDay(f) >= from - 864e5 && fileDay(f) < dayEnd).sort();
  for (const f of files) { const txt = await fs.readFile(f, 'utf8'); if (!txt.slice(0, 700).includes('correctedNC')) continue;
    for (const r of parseCSV(txt)) {
      if (r.obs_basis !== 'h' || r.monitor === '0' || !(+r.lead_h <= par.maxLeadH) || !r.correctedNC || !r.correctedPre) continue;
      const tV = Date.parse(r.valid_utc); if (!(tV >= from && tV < dayEnd)) continue; if (since && Date.parse(r.issued_utc) < since) continue;
      const o = obs.get(`${r.station_id}|${tV}`); if (o == null) continue; pairs.push([o, +r.correctedPre, +r.correctedNC]); } }
  const k = highScore(pairs, ML2.thr), spanD = since ? (dayEnd - since) / 864e5 : days;
  // decided only with the full 14 days of rows and enough of them (leads 1, 3 and 6 are logged: about 300 rows an hour)
  const decided = spanD >= days && k.n >= 20000 && k.high >= 50;
  return { days, ...k, decided, ok: decided && k.hit2 >= k.hit1 && k.fa2 <= k.fa1 && k.rmse2 <= k.rmse1 };
}

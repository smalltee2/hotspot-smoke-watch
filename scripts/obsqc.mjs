// Quality check of hourly PM2.5 measurements: isolated spikes from a faulty instrument.
// 25 Nov 2026, 03:00–04:00 Thai time: Air4Thai a4t:19t reported 904 and 998 µg/m³ between 54 and 37 (and then went silent).
// The values passed the range check (< 1500) and pushed the station's Kalman bias to 3.4 on the log scale (about ×30): its
// forecast stayed at 70–180 µg/m³ against CAMS 5–13 until the filter state expired, and the 14-day PM2.5 check (pmHighCheck)
// RMSE doubled (10 → 20 µg/m³) for both corrections. A value is dropped when it is above SPIKE.min and more than SPIKE.ratio
// times the largest value kept in the SPIKE.backH hours before it. On the Oct–Nov 2026 logs (126,563 Air4Thai hours) this drops
// only those two values; a real smoke rise such as 31 → 221 µg/m³ (a4t:50t, 20 Nov) is kept.
export const SPIKE = { min: 300, ratio: 5, backH: 3 };
const HOUR = 3600e3;

/** rows: [[t_ms, value, ...], ...] sorted by time. Returns { kept, dropped } (dropped: the rows removed). */
export function dropSpikes(rows, par = SPIKE) {
  const kept = [], dropped = [];
  for (const r of rows) {
    const [t, v] = r; let mx = -Infinity;
    for (let k = kept.length - 1; k >= 0 && kept[k][0] >= t - par.backH * HOUR; k--) if (kept[k][0] < t) mx = Math.max(mx, kept[k][1]);
    if (mx > -Infinity && v > par.min && v > par.ratio * mx) dropped.push(r); else kept.push(r);
  }
  return { kept, dropped };
}

/** The same check on a Map keyed "station_id|YYYY-MM-DDTHH" (UTC hour) -> µg/m³, as the scoring scripts (accuracy.mjs, perf.mjs,
 *  verify.mjs) build it from the logs; removes the spikes in place and returns how many. */
export function dropSpikesHourKeys(obs, par = SPIKE) {
  const ser = new Map(); for (const [k, v] of obs) { const i = k.lastIndexOf('|'), t = Date.parse(k.slice(i + 1) + ':00:00Z'); if (!Number.isFinite(t)) continue;
    const id = k.slice(0, i); if (!ser.has(id)) ser.set(id, []); ser.get(id).push([t, v, k]); }
  let n = 0; for (const rows of ser.values()) for (const r of dropSpikes(rows.sort((a, b) => a[0] - b[0]), par).dropped) { obs.delete(r[2]); n++; }
  return n;
}

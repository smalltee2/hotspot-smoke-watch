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

/** One new value against the hours already kept (stations that give only their latest value, e.g. OpenAQ: the same rule as
 *  dropSpikes, with the station's recent values [[t_ms, v], ...] as the "kept" rows). True = a spike, drop it. */
export function isSpike(recent, t, v, par = SPIKE) {
  let mx = -Infinity; for (const [tt, vv] of recent || []) if (tt < t && tt >= t - par.backH * HOUR) mx = Math.max(mx, vv);
  return mx > -Infinity && v > par.min && v > par.ratio * mx;
}

/** Spikes whose hour a bias filter already took in: the filter holds the wrong value until it expires (a4t:19t, 25–27 Nov 2026:
 *  about 46 h of forecasts at 30–87 µg/m³ against CAMS 5–13). dropped: [{id, t}], seen: state object (key -> time first seen,
 *  so each spike is handled once), filters: [{id: {t, ...}}, ...]. Deletes the station's entry in every filter when any of them
 *  was updated at or after the spike's hour the first time the spike is seen; returns the ids reset. Entries of `seen` older
 *  than keepH are pruned (the fetch window that keeps reporting the same spike is 48 h). */
export function resetAfterSpikes(dropped, seen, filters, now, keepH = 96) {
  const out = [];
  for (const { id, t } of dropped) { const k = id + '|' + t; if (seen[k]) continue; seen[k] = now;
    if (filters.some(F => F?.[id] && F[id].t >= t)) { for (const F of filters) if (F) delete F[id]; out.push(id); } }
  for (const k of Object.keys(seen)) if (now - seen[k] > keepH * HOUR) delete seen[k];
  return [...new Set(out)];
}

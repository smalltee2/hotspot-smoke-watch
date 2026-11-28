// Quality check of hourly PM2.5 measurements: isolated spikes from a faulty instrument.
// 25 Nov 2026, 03:00–04:00 Thai time: Air4Thai a4t:19t reported 904 and 998 µg/m³ between 54 and 37 (and then went silent).
// The values passed the range check (< 1500) and pushed the station's Kalman bias to 3.4 on the log scale (about ×30): its
// forecast stayed at 70–180 µg/m³ against CAMS 5–13 until the filter state expired, and the 14-day PM2.5 check (pmHighCheck)
// RMSE doubled (10 → 20 µg/m³) for both corrections. A value is dropped when it is above SPIKE.min and more than SPIKE.ratio
// times the largest value kept in the SPIKE.backH hours before it. On the Oct–Nov 2026 logs (126,563 Air4Thai hours) this drops
// only those two values; a rise that stays below 300 µg/m³ passes it whatever its cause: 31 → 153, 221 µg/m³ at a4t:50t (20 Nov,
// 02:00–03:00 Thai time) was an instrument spike too (Air4Thai later revised the two hours to 23 and 21), and is caught by the
// neighbour test below.
export const SPIKE = { min: 300, ratio: 5, backH: 3 };
const HOUR = 3600e3;
// Neighbour spike test (28 Nov 2026), Air4Thai hourly stations: a jump of at least NSPIKE.rise to NSPIKE.ratio times the median of
// the hours kept before it, which the stations within NSPIKE.R km do not share, is held; the station's own next hours decide.
// A fall back below base + C × rise: the held hours are dropped. Neighbours joining, or the level lasting L hours (Liso with fewer
// than K neighbours): they are kept. Designed on the logs of 1 Oct – 28 Nov 2026 as first seen by the pipeline: 17 events,
// 20 hours dropped, 9 of the events later revised or withdrawn by Air4Thai itself, with the a4t:19t fault and Loei's 104 (a4t:72t, 27 Nov).
export const NSPIKE = { backH: 3, minBack: 2, rise: 40, ratio: 3, floor: 10,
  R: 50, K: 2, nbRatio: 1.5, nbRise: 10, nbFrac: 0.25, nbShare: 0.2, nbLevel: 0.6,
  C: 0.4, L: 3, Liso: 2, gapH: 3 };
// Stuck-at-zero test (28 Nov 2026), every station with hourly values: the newest value and at least STUCK.share of the STUCK.M
// hours before it (>= minN values) are at or below Z µg/m³ while the stations within R km (>= K of them) have a median of T or
// more; without such neighbours, the same over isoM hours. A sensor found stuck stays so until it reports a value above Z again.
export const STUCK = { M: 12, minN: 8, Z: 0.5, share: 0.9, R: 100, K: 2, T: 10, isoM: 48 };
const kmApart = (a, b) => 111.32 * Math.hypot((a.lon - b.lon) * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180), a.lat - b.lat);
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

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

/** The neighbour spike test on a window of hourly values. series: Map id -> [[t_ms, value, ...], ...] sorted by time, on whole
 *  hours; coords: Map id -> {lat, lon}; only: Set of the ids to test (default all; the others serve as neighbours, with their
 *  values as given). Returns { dropped, pending }: the hours to leave out, each {id, t, v, base, nNb} (base: median of the hours
 *  kept before the jump, nNb: neighbours with values when it was held). pending = a hold not yet decided at the end of the
 *  window (unconfirmed); a station silent for more than gapH hours after a hold has its held hours dropped. */
export function neighbourSpikes(series, coords, par = NSPIKE, only = null) {
  const val = new Map(), dropped = [], pending = []; let end = -Infinity;
  for (const [id, rows] of series) { const m = new Map(); for (const [t, v] of rows) { m.set(t, v); if (t > end) end = t; } val.set(id, m); }
  for (const [id, rows] of series) {
    if (only && !only.has(id)) continue;
    const c = coords.get(id), nb = [];
    if (c) for (const [n, m] of val) if (n !== id && coords.has(n) && kmApart(c, coords.get(n)) <= par.R) nb.push(m);
    // neighbours with a value at t and in the backH hours before it: enough of them rising with the station, or one as high
    const support = (t, rise0, v) => {
      let n = 0, nUp = 0, nHigh = 0;
      for (const m of nb) { const x = m.get(t); if (x == null) continue; let lo = Infinity;
        for (let k = 1; k <= par.backH; k++) { const y = m.get(t - k * HOUR); if (y != null && y < lo) lo = y; }
        if (lo === Infinity) continue; n++;
        if (x / Math.max(lo, 5) >= par.nbRatio && x - lo >= Math.max(par.nbRise, par.nbFrac * rise0)) nUp++;
        if (x >= par.nbLevel * v) nHigh++; }
      return { n, ok: n >= par.K && (nUp >= Math.max(1, Math.ceil(par.nbShare * n)) || nHigh >= 1) };
    };
    const kept = []; let h = null;
    const close = list => { for (const [t, v] of h.hours) list.push({ id, t, v, base: h.base, nNb: h.nNb }); h = null; };
    for (const [t, v] of rows) {
      if (h) {
        if (t - h.hours[h.hours.length - 1][0] > par.gapH * HOUR) close(dropped);            // went silent: the held hours stay out
        else if (v < h.base + par.C * (h.v0 - h.base)) close(dropped);                       // fell back: a spike; v is judged as a new value
        else { h.hours.push([t, v]);
          if (support(t, h.v0 - h.base, v).ok || h.hours.length >= (h.nNb >= par.K ? par.L : par.Liso)) { kept.push(...h.hours); h = null; }
          continue; }
      }
      const back = kept.slice(-par.backH).filter(([tb]) => tb >= t - par.backH * HOUR && tb < t).map(r => r[1]);
      if (back.length >= par.minBack) { const base = median(back);
        if (v - base >= par.rise && v >= par.ratio * Math.max(base, par.floor)) { const s = support(t, v - base, v);
          if (!s.ok) { h = { base, v0: v, hours: [[t, v]], nNb: s.n }; continue; } } }
      kept.push([t, v]);
    }
    if (h) close(end - h.hours[h.hours.length - 1][0] <= par.gapH * HOUR ? pending : dropped);
  }
  return { dropped, pending };
}

/** The stuck-at-zero test at each station's newest value. hist: { id: [[t_ms, value], ...] } (or a Map), raw values on whole
 *  hours (state.obsHist); coords: Map id (string) -> {lat, lon}; values later than now + 30 min are not looked at; prevStuck:
 *  the ids returned by the previous run. Returns the Set of stuck ids (strings), with .info: Map id -> {t, v, kind, nNb, nbMed}
 *  (kind: 'zero' | 'isolated' | 'latch'). A stuck sensor that has gone silent stays in the set until it reports again. */
export function stuckNow(hist, coords, now, prevStuck = [], par = STUCK) {
  const H = hist instanceof Map ? hist : new Map(Object.entries(hist || {})), prev = new Set([...prevStuck].map(String)), lim = now + HOUR / 2;
  const out = new Set(); out.info = new Map();
  const win = (rows, t, M) => rows.filter(([tt]) => tt > t - M * HOUR && tt <= t);
  const seen = new Set();
  for (const [key, all] of H) {
    const id = String(key); let last = null; for (const r of all || []) if (r[0] <= lim && (!last || r[0] > last[0])) last = r;
    if (!last) continue; seen.add(id);
    const [t, v] = last; if (!(v <= par.Z)) continue;
    const c = coords.get(id), nbMean = [];
    if (c) for (const [k2, r2] of H) { const n = String(k2); if (n === id || !coords.has(n) || kmApart(c, coords.get(n)) > par.R) continue;
      const w = win(r2 || [], t, par.M); if (w.length >= par.minN / 2) nbMean.push(w.reduce((a, r) => a + r[1], 0) / w.length); }
    const zeros = M => { const w = win(all, t, M); return w.filter(r => r[1] <= par.Z).length >= par.share * w.length ? w.length : 0; };   // values in the window when at least `share` of them are at zero
    const nbMed = nbMean.length ? median(nbMean) : null;
    const kind = nbMean.length >= par.K ? (zeros(par.M) >= par.minN && nbMed >= par.T ? 'zero' : null) : zeros(par.isoM) >= 0.6 * par.isoM ? 'isolated' : null;
    if (kind || prev.has(id)) { out.add(id); out.info.set(id, { t, v, kind: kind || 'latch', nNb: nbMean.length, nbMed }); }
  }
  for (const id of prev) if (!seen.has(id) && coords.has(id)) out.add(id);
  return out;
}

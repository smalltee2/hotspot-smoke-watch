// Low-cost sensors as inputs of the regression-kriging map.
// - Reference scale: ref = a + b·sensor, the linear fit of AirGradient 24-h means to co-located Air4Thai monitors (≤ 2 km) in the
//   2024–26 hindcast (replay/colocation.py, airgradient_colocation.json: a = −3.286, b = 0.9245; 154,651 pairs at 90 sites).
// - Rolling quality check with past data only (the hindcast's replay/lowcost_qc.mjs): over the 30 days before today, a sensor needs
//   ≥ 10 daily values and must agree with its neighbours — other sites (any type) within 50 km with ≥ 7 common days (≥ 2 of them;
//   otherwise within 100 km, ≥ 1): r ≥ 0.6 with their daily median and a mean ratio within 0.5–2. No neighbour = 'isolated' (kept).
// Daily values live in state.daily[id][utcDay] (the last valid 24-h mean of each UTC day, on the reference scale), kept 35 days.
export const LOWCOST = { use: true, a: -3.286, b: 0.9245, windowD: 30, keepD: 35, minDays: 10, minCommon: 7, r1: 50, r2: 100, rMin: 0.6, ratio: [0.5, 2] };
export const scaleLowcost = (v, cfg = LOWCOST) => Math.max(0, cfg.a + cfg.b * v);
const km = (a, b, c, d) => 111.32 * Math.hypot((d - b) * Math.cos((a + c) / 2 * Math.PI / 180), c - a);
const median = a => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]); };
function corr(x, y) { const n = x.length, mx = x.reduce((a, v) => a + v, 0) / n, my = y.reduce((a, v) => a + v, 0) / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN; }

// store today's value of every station with a valid 24-h mean; drop days older than keepD
export function updateDaily(daily, stations, obs24, dayNow, cfg = LOWCOST) {
  for (const s of stations) { const o = obs24(s.id, s); if (!o || !o.valid) continue;
    (daily[s.id] ||= {})[dayNow] = Math.round((s.monitor ? o.v : scaleLowcost(o.v, cfg)) * 10) / 10; }
  for (const id of Object.keys(daily)) { const D = daily[id]; for (const d of Object.keys(D)) if (+d < dayNow - cfg.keepD) delete D[d]; if (!Object.keys(D).length) delete daily[id]; }
}
// Map(id -> 'pass' | 'isolated' | 'too few days' | 'fail: …') for the low-cost sensors in `stations`, from days before dayNow
export function lowcostQC(daily, stations, dayNow, cfg = LOWCOST) {
  const out = new Map(), days = []; for (let d = dayNow - cfg.windowD; d < dayNow; d++) days.push(d);
  const S = stations.filter(s => daily[s.id]);
  for (const s of S) {
    if (s.monitor) continue;
    const D = daily[s.id], own = days.filter(d => Number.isFinite(D[d]));
    if (own.length < cfg.minDays) { out.set(s.id, 'too few days'); continue; }
    const near = S.filter(t => t !== s).map(t => [t, km(s.lat, s.lon, t.lat, t.lon)]).filter(([, d]) => d <= cfg.r2);
    let res = null;
    for (const rad of [cfg.r1, cfg.r2]) {
      const nb = near.filter(([t, d]) => d <= rad && own.filter(dd => Number.isFinite(daily[t.id][dd])).length >= cfg.minCommon).map(([t]) => t);
      if (nb.length >= 2 || (rad === cfg.r2 && nb.length >= 1)) {
        const x = [], y = []; for (const d of own) { const v = nb.map(t => daily[t.id][d]).filter(Number.isFinite); if (v.length) { x.push(D[d]); y.push(median(v)); } }
        const r = corr(x, y), ratio = x.reduce((a, v) => a + v, 0) / Math.max(1e-9, y.reduce((a, v) => a + v, 0));
        res = !(r >= cfg.rMin) ? 'fail: low r with neighbours' : ratio < cfg.ratio[0] || ratio > cfg.ratio[1] ? 'fail: mean differs from neighbours' : 'pass'; break;
      }
    }
    out.set(s.id, res ?? 'isolated');
  }
  return out;
}

// Generic copy of the self-learning engine in ml.mjs (PM2.5), parameterised by the feature names and the correction limit, so the
// live weather layers (2-m temperature, rain; scripts/mlwx.mjs) learn the same way without touching the PM2.5 code:
//   experts  base (no correction) · day (mean residual by lead class × time of day, last 3 days, shrunk n/(n+20)) ·
//            week (ridge regression, last 7 days) · month (gradient-boosted trees, last 30 days) ·
//            season (gradient-boosted trees, current Thai season to date + the same season of earlier years, from a 2-year store)
//   weights  exponentially weighted average forecaster with fixed share (Littlestone & Warmuth 1994; Herbster & Warmuth 1998),
//            each expert scored every day on the newly verified day with the model it had before that day (out of sample)
// rows: { tValid, id, lead, hloc, x: [features], y: target }
import { solve } from './rk.mjs';

export const CORECFG = { windows: { day: 3, week: 7, month: 30 }, minDays: { day: 1, week: 7, month: 30 }, shrinkK: 20, ridgeLambda: 3,
  gbm: { nTrees: 150, depth: 3, lr: 0.08, minLeaf: 40, bins: 32, subsample: 0.8, lambda: 1, maxRows: 120000 },
  eta: 2, share: 0.05, minRowsDay: 200, minDaysSeason: 30 };
export const EXPERTS = ['base', 'day', 'week', 'month', 'season'];
const HOUR = 3600e3;
const leadClass = L => L <= 3 ? 0 : L <= 6 ? 1 : L <= 12 ? 2 : L <= 24 ? 3 : 4;
const hourBlock = h => Math.floor(((+h % 24) + 24) % 24 / 6);

export function makeEngine(names, clip, cfg = CORECFG) {
  const p = names.length;
  function trainDay(rows) {
    const s = {}, n = {}; for (const r of rows) { const k = `${leadClass(r.lead)}|${hourBlock(r.hloc)}`; s[k] = (s[k] || 0) + r.y; n[k] = (n[k] || 0) + 1; }
    const table = {}; for (const k in s) table[k] = (s[k] / n[k]) * n[k] / (n[k] + cfg.shrinkK);
    return { type: 'day', table, n: rows.length };
  }
  const predDay = (m, r) => m.table[`${leadClass(r.lead)}|${hourBlock(r.hloc)}`] || 0;
  const impute = (x, mu) => x.map((v, j) => isFinite(v) ? v : mu[j]);
  function trainRidge(rows) {
    const mu = new Array(p).fill(0), cnt = new Array(p).fill(0);
    for (const r of rows) r.x.forEach((v, j) => { if (isFinite(v)) { mu[j] += v; cnt[j]++; } });
    for (let j = 0; j < p; j++) mu[j] = cnt[j] ? mu[j] / cnt[j] : 0;
    const sd = new Array(p).fill(0); for (const r of rows) impute(r.x, mu).forEach((v, j) => sd[j] += (v - mu[j]) ** 2);
    for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
    const A = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0)), b = new Array(p + 1).fill(0);
    for (const r of rows) { const z = [1, ...impute(r.x, mu).map((v, j) => (v - mu[j]) / sd[j])];
      for (let i = 0; i <= p; i++) { b[i] += z[i] * r.y; for (let k = 0; k <= p; k++) A[i][k] += z[i] * z[k]; } }
    for (let i = 1; i <= p; i++) A[i][i] += cfg.ridgeLambda * rows.length / 100;
    const beta = solve(A, b); if (!beta) return null;
    return { type: 'week', mu, sd, beta, n: rows.length };
  }
  const predRidge = (m, r) => { const z = impute(r.x, m.mu).map((v, j) => (v - m.mu[j]) / m.sd[j]); return m.beta[0] + z.reduce((a, v, j) => a + m.beta[j + 1] * v, 0); };
  let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function trainGBM(rows, type = 'month', opt = cfg.gbm) {
    seed = 12345;
    if (rows.length > opt.maxRows) { const keep = opt.maxRows / rows.length; rows = rows.filter(() => rnd() < keep); }
    const n = rows.length;
    const edges = []; for (let j = 0; j < p; j++) { const v = rows.map(r => r.x[j]).filter(isFinite).sort((a, b) => a - b);
      const e = []; for (let q = 1; q < opt.bins; q++) { const x = v[Math.floor(q * v.length / opt.bins)]; if (x != null && (!e.length || x > e[e.length - 1])) e.push(x); } edges.push(e); }
    const bin = new Uint8Array(n * p); for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { const x = rows[i].x[j];
      if (!isFinite(x)) { bin[i * p + j] = 0; continue; } let lo = 0, hi = edges[j].length; while (lo < hi) { const mid = (lo + hi) >> 1; if (x <= edges[j][mid]) hi = mid; else lo = mid + 1; } bin[i * p + j] = lo + 1; }
    const y = Float64Array.from(rows, r => r.y), f0 = y.reduce((a, v) => a + v, 0) / n, pred = new Float64Array(n).fill(f0), trees = [], gain = new Array(p).fill(0), nb = opt.bins + 2;
    function build(idx, depth) {
      let G = 0; for (const i of idx) G += y[i] - pred[i];
      const leaf = { v: opt.lr * G / (idx.length + opt.lambda) };
      if (depth >= opt.depth || idx.length < 2 * opt.minLeaf) return leaf;
      let best = null;
      for (let j = 0; j < p; j++) {
        const gs = new Float64Array(nb), cs = new Uint32Array(nb); for (const i of idx) { const b = bin[i * p + j]; gs[b] += y[i] - pred[i]; cs[b]++; }
        let gl = 0, cl = 0; for (let b = 0; b < nb - 1; b++) { gl += gs[b]; cl += cs[b]; const cr = idx.length - cl; if (cl < opt.minLeaf || cr < opt.minLeaf) continue;
          const g = gl * gl / (cl + opt.lambda) + (G - gl) ** 2 / (cr + opt.lambda) - G * G / (idx.length + opt.lambda);
          if (!best || g > best.g) best = { g, j, b }; }
      }
      if (!best || best.g <= 1e-9) return leaf;
      gain[best.j] += best.g;
      const L = [], R = []; for (const i of idx) (bin[i * p + best.j] <= best.b ? L : R).push(i);
      return { j: best.j, b: best.b, l: build(L, depth + 1), r: build(R, depth + 1) };
    }
    const walk = (t, i) => { while (t.v === undefined) t = bin[i * p + t.j] <= t.b ? t.l : t.r; return t.v; };
    for (let k = 0; k < opt.nTrees; k++) {
      const idx = []; for (let i = 0; i < n; i++) if (rnd() < opt.subsample) idx.push(i);
      const t = build(idx, 0); trees.push(t); for (let i = 0; i < n; i++) pred[i] += walk(t, i);
    }
    const gsum = gain.reduce((a, v) => a + v, 0) || 1;
    return { type, f0, edges, trees, n, importance: Object.fromEntries(names.map((nm, j) => [nm, +(gain[j] / gsum).toFixed(3)]).sort((a, b) => b[1] - a[1]).slice(0, 6)) };
  }
  function predGBM(m, r) {
    let s = m.f0; const b = r.x.map((x, j) => { if (!isFinite(x)) return 0; const e = m.edges[j]; let lo = 0, hi = e.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (x <= e[mid]) hi = mid; else lo = mid + 1; } return lo + 1; });
    for (let t of m.trees) { while (t.v === undefined) t = b[t.j] <= t.b ? t.l : t.r; s += t.v; }
    return s;
  }
  const predictExpert = (m, r) => !m ? 0 : m.type === 'day' ? predDay(m, r) : m.type === 'week' ? predRidge(m, r) : predGBM(m, r);
  const clipv = v => Math.max(-clip, Math.min(clip, v));

  // once a day: score the experts on the newly verified day (out of sample), update the weights, retrain on data before dayEnd
  function dailyLearn(st, rows, { now, dayStart, dayEnd, seasonRows = null, label = 'wx', log = () => {} }) {
    st.weights ||= { base: 1 }; st.models ||= {};
    const test = rows.filter(r => r.tValid >= dayStart && r.tValid < dayEnd);
    const active = EXPERTS.filter(e => e === 'base' || st.models[e]), loss = {};
    if (test.length >= 50) {
      for (const e of active) { let s = 0; for (const r of test) { const q = e === 'base' ? 0 : clipv(predictExpert(st.models[e], r)); s += (r.y - q) ** 2; } loss[e] = s / test.length; }
      const scale = cfg.eta / Math.max(loss.base, 1e-3);
      const w = Object.fromEntries(active.map(e => [e, (st.weights[e] ?? 0) * Math.exp(-scale * loss[e])]));
      const sw = Object.values(w).reduce((a, v) => a + v, 0) || 1; for (const e in w) w[e] /= sw;
      for (const e in w) w[e] = (1 - cfg.share) * w[e] + cfg.share / active.length;
      st.weights = w;
    }
    const train = rows.filter(r => r.tValid < dayEnd), days = new Set(train.map(r => new Date(r.tValid + 7 * HOUR).toISOString().slice(0, 10))).size;
    const win = d => train.filter(r => r.tValid >= dayEnd - d * 864e5), nm = {}, info = {};
    if (days >= cfg.minDays.day && win(cfg.windows.day).length >= cfg.minRowsDay) nm.day = trainDay(win(cfg.windows.day));
    if (days >= cfg.minDays.week) { const m = trainRidge(win(cfg.windows.week)); if (m) nm.week = m; }
    if (days >= cfg.minDays.month) nm.month = trainGBM(win(cfg.windows.month), 'month');
    if (seasonRows && seasonRows.days >= cfg.minDaysSeason) { const m = trainGBM(seasonRows.rows.filter(r => r.tValid < dayEnd), 'season'); m.season = seasonRows.season; nm.season = m; }
    for (const e in nm) { info[e] = { n: nm[e].n, ...(nm[e].importance ? { importance: nm[e].importance } : {}) }; if (st.weights[e] == null) st.weights[e] = 0; }
    st.models = { ...st.models, ...nm }; st.lastDay = new Date(dayStart + 7 * HOUR).toISOString().slice(0, 10);
    const rec = { var: label, day: st.lastDay, at: now, verifiedDays: days, nTest: test.length, loss: Object.fromEntries(Object.entries(loss).map(([k, v]) => [k, +v.toFixed(5)])),
      weights: Object.fromEntries(Object.entries(st.weights).map(([k, v]) => [k, +v.toFixed(4)])), trained: info, seasonStore: seasonRows ? { season: seasonRows.season, days: seasonRows.days } : null };
    log(`ML ${label}: day ${rec.day}, ${days} verified days, scored ${test.length} rows; loss ${JSON.stringify(rec.loss)}; weights ${JSON.stringify(rec.weights)}; trained ${Object.keys(info).join(', ') || 'none yet'}`);
    return rec;
  }
  function correction(st, r) {
    if (!st?.weights) return 0; let s = 0;
    for (const [e, w] of Object.entries(st.weights)) if (w > 0 && e !== 'base' && st.models?.[e]) s += w * predictExpert(st.models[e], r);
    return clipv(s);
  }
  const active = st => !!st?.weights && Object.entries(st.weights).some(([e, w]) => e !== 'base' && w > 0 && !!st.models?.[e]);
  return { dailyLearn, correction, active, predictExpert, trainGBM, trainRidge, trainDay };
}

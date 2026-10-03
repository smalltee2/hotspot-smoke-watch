// Self-learning post-processing: an adaptive ensemble of statistical "experts" trained on different time windows, combined
// with weights that follow each expert's recent out-of-sample skill.
//
// Target: the error that remains after the full forecast chain (CAMS + fire assimilation + Kalman filter), in log space:
//     r = ln(obs + 1) − ln(F + 1),   F = corrected hourly forecast (corrA) at a station, for one lead time.
// Experts (each predicts r̂ from features known at issue time):
//     base   r̂ = 0 (the chain as it is)                                                       always
//     day    mean residual by lead class × time of day over the last 3 days, shrunk toward 0
//            with n/(n + 20) (empirical-Bayes shrinkage; a simple model for little data)        ≥ 1 day of verified data
//     week   ridge regression on standardized features, last 7 days                              ≥ 7 days
//     month  gradient-boosted regression trees, last 30 days                                     ≥ 30 days
//     season gradient-boosted trees on the current Thai season to date plus the same season of earlier years, from our
//            own forecasts and Air4Thai measurements (training store data/mltrain, kept for 2 years)  ≥ 30 days in the store
//            Seasons of the Thai Meteorological Department: summer 16 Feb–15 May, rainy 16 May–15 Oct, winter 16 Oct–15 Feb
// Combination: exponentially weighted average forecaster with fixed share (Littlestone & Warmuth 1994; Herbster & Warmuth
// 1998): every day each expert is scored on the latest verified day with the models it had *before* that day (out of
// sample), w_e ← w_e·exp(−η·L_e), then a fixed share α is spread over the active experts so weights can recover when
// conditions change. The base expert is always in the pool, so the ensemble drifts back to the plain chain whenever the
// learned experts stop helping. Combined correction is limited to ±ln 2 (a factor of two).
// Feature leakage is avoided: only values available at issue time are used, and scoring is on days after the training data.
import fs from 'node:fs/promises'; import path from 'node:path';
import { solve } from './rk.mjs';

export const MLCFG = { maxLeadH: 48,   // forecasts are logged (and the experts trained) for leads up to 48 h; no extrapolation beyond
  windows: { day: 3, week: 7, month: 30 }, minDays: { day: 1, week: 7, month: 30 }, shrinkK: 20, ridgeLambda: 3,
  gbm: { nTrees: 150, depth: 3, lr: 0.08, minLeaf: 40, bins: 32, subsample: 0.8, lambda: 1, maxRows: 120000 },
  eta: 2, share: 0.05, clip: Math.LN2, minRowsDay: 300 };
export const EXPERTS = ['base', 'day', 'week', 'month', 'season'];

// ---------------------------------------------------------------- Thai seasons and the long-term training store
export function seasonOf(t) {   // Thai Meteorological Department seasons, Thai calendar date
  const d = new Date(t + 7 * HOUR), y = d.getUTCFullYear(), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  if (md >= 216 && md <= 515) return { name: 'summer', year: y, id: `summer-${y}` };
  if (md >= 516 && md <= 1015) return { name: 'rainy', year: y, id: `rainy-${y}` };
  const sy = md >= 1016 ? y : y - 1; return { name: 'winter', year: sy, id: `winter-${sy}` };
}
// one gzip CSV per verified day: a random subsample (≤ maxPerDay rows) of the day's training rows, stored under data/mltrain/<season>/
export const STORE = { maxPerDay: 8000, keepDays: 730, minDaysSeason: 30 };
export async function storeDay(dir, rows, dayStart, gzip) {
  const day = rows.filter(r => r.tValid >= dayStart && r.tValid < dayStart + 864e5); if (!day.length) return 0;
  let s = 999; const rr = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const keep = day.length > STORE.maxPerDay ? day.filter(() => rr() < STORE.maxPerDay / day.length) : day;
  const sea = seasonOf(dayStart + 12 * HOUR), dname = new Date(dayStart + 7 * HOUR).toISOString().slice(0, 10).replace(/-/g, '');
  const head = ['tValid', 'id', 'lead', 'hloc', 'y', ...NAMES].join(',');
  const lines = keep.map(r => [r.tValid, r.id, r.lead, r.hloc, +r.y.toFixed(4), ...r.x.map(v => isFinite(v) ? +v.toFixed(4) : '')].join(','));
  await fs.mkdir(path.join(dir, sea.id), { recursive: true });
  await fs.writeFile(path.join(dir, sea.id, `train-${dname}.csv.gz`), gzip(head + '\n' + lines.join('\n') + '\n'));
  return keep.length;
}
// rows of the current season (to date) and of the same season in earlier years
export async function loadSeasonRows(dir, t, gunzip, before = Infinity) {
  const cur = seasonOf(t), rows = []; const days = new Set();
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !e.name.startsWith(cur.name + '-')) continue;
    for (const f of await fs.readdir(path.join(dir, e.name))) {
      if (!/^train-\d{8}\.csv\.gz$/.test(f)) continue;
      const txt = gunzip(await fs.readFile(path.join(dir, e.name, f))).toString('utf8'), [head, ...lines] = txt.trim().split('\n'), h = head.split(',');
      const col = NAMES.map(nm => h.indexOf(nm));   // by name: files written before a feature was added give NaN for it
      for (const l of lines) { const v = l.split(','), tV = +v[0]; if (!(tV < before)) continue;
        rows.push({ tValid: tV, id: v[1], lead: +v[2], hloc: +v[3], y: +v[4], x: col.map(c => c < 0 || v[c] === '' || v[c] === undefined ? NaN : +v[c]) }); days.add(f); }
    }
  }
  return { rows, days: days.size, season: cur.id };
}
const HOUR = 3600e3;

// ---------------------------------------------------------------- features
// raw columns written to the forecast log every hour (fcst-*.csv) and used here
export const FEAT_COLS = ['inc', 'fire', 'blh', 'ws', 'pr', 'obs_last', 'obs24_last', 'kfAb', 'hloc', 'doy', 't2', 'rh', 'ws10', 'wd', 'o_ws', 'o_wd', 'o_t2', 'o_rh'];   // wd = 100-m wind direction the wind blows from (deg); o_* = measured at the station at issue time
const NAMES = ['lead', 'lnF', 'lnCams', 'lnInc', 'lnFire', 'lnBlh', 'ws', 'pr', 'lnObsLast', 'lnObs24', 'kfAb', 'hsin', 'hcos', 'dsin', 'dcos', 'lat', 'lon', 't2', 'rh', 'ws10', 'wdsin', 'wdcos', 'oT2', 'oRh', 'oWs', 'oWdsin', 'oWdcos', 'dT2', 'dRh', 'dWs'];   // added 3 Oct 2026 (older rows: NaN); o* measured at issue time, d* = forecast − measured
const ln1 = v => Math.log(Math.max(0, v) + 1);
export function featureVector(r) {   // r: {lead, F, cams, inc, fire, blh, ws, pr, obs_last, obs24_last, kfAb, hloc, doy, lat, lon}
  const n = v => (v == null || v === '' || !isFinite(+v) ? NaN : +v);
  const h = n(r.hloc), d = n(r.doy);
  return [n(r.lead), ln1(n(r.F)), ln1(n(r.cams)), Math.sign(n(r.inc) || 0) * ln1(Math.abs(n(r.inc) || 0)), ln1(n(r.fire) || 0), Math.log(Math.max(50, n(r.blh) || 500) / 1000),
    n(r.ws), n(r.pr) || 0, isFinite(n(r.obs_last)) ? ln1(n(r.obs_last)) : NaN, isFinite(n(r.obs24_last)) ? ln1(n(r.obs24_last)) : NaN, n(r.kfAb) || 0,
    Math.sin(2 * Math.PI * h / 24), Math.cos(2 * Math.PI * h / 24), Math.sin(2 * Math.PI * d / 365.25), Math.cos(2 * Math.PI * d / 365.25), n(r.lat), n(r.lon),
    n(r.t2), n(r.rh), n(r.ws10), isFinite(n(r.wd)) ? Math.sin(n(r.wd) * Math.PI / 180) : NaN, isFinite(n(r.wd)) ? Math.cos(n(r.wd) * Math.PI / 180) : NaN,
    n(r.o_t2), n(r.o_rh), n(r.o_ws), isFinite(n(r.o_wd)) ? Math.sin(n(r.o_wd) * Math.PI / 180) : NaN, isFinite(n(r.o_wd)) ? Math.cos(n(r.o_wd) * Math.PI / 180) : NaN,
    n(r.t2) - n(r.o_t2), n(r.rh) - n(r.o_rh), n(r.ws10) - n(r.o_ws)];
}
const leadClass = L => L <= 3 ? 0 : L <= 6 ? 1 : L <= 12 ? 2 : L <= 24 ? 3 : 4;
const hourBlock = h => Math.floor(((+h % 24) + 24) % 24 / 6);

// ---------------------------------------------------------------- data: forecast logs joined with later observations
const parseCSV = txt => { const [head, ...lines] = txt.trim().split('\n'); if (!head) return []; const h = head.split(',');
  return lines.map(l => { const v = l.split(','); const o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
async function listFiles(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory()) for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f)); }
  return out; }
// rows: [{tIssue, tValid, id, lead, F, cams, ...features, obs}] for hourly stations with a verified hourly value
export async function loadDataset(histDir, meta, { from = 0, to = Infinity } = {}) {
  const files = await listFiles(histDir), obs = new Map();
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) {
    const t = Date.parse(r.hour_end_utc), v = +r.pm25; if (isFinite(t) && isFinite(v)) obs.set(`${r.station_id}|${t}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parseCSV(await fs.readFile(f, 'utf8'))) {
    const t = Math.round(Date.parse(r.time_utc) / HOUR) * HOUR, v = +r.obs_pm25, k = `${r.station_id}|${t}`; if (isFinite(t) && isFinite(v) && !obs.has(k)) obs.set(k, v); }
  const rows = [];
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f)).sort()) {
    const txt = await fs.readFile(f, 'utf8'); if (!txt.slice(0, 400).includes(',hloc')) continue;   // logs with ML features only
    for (const r of parseCSV(txt)) {
      if (r.obs_basis !== 'h' || r.correctedA === '' || r.correctedA === undefined) continue;
      const tV = Date.parse(r.valid_utc), tI = Date.parse(r.issued_utc); if (!(tV >= from && tV < to)) continue;
      const o = obs.get(`${r.station_id}|${tV}`); if (o == null) continue;
      const m = meta.get(r.station_id) || {};
      rows.push({ tIssue: tI, tValid: tV, id: r.station_id, lead: +r.lead_h, F: +r.correctedA, cams: +r.cams_raw, inc: r.inc, fire: r.fire, blh: r.blh, ws: r.ws, pr: r.pr,
        obs_last: r.obs_last, obs24_last: r.obs24_last, kfAb: r.kfAb, hloc: r.hloc, doy: r.doy, lat: m.lat, lon: m.lon, obs: o, t2: r.t2, rh: r.rh, ws10: r.ws10, wd: r.wd, o_ws: r.o_ws, o_wd: r.o_wd, o_t2: r.o_t2, o_rh: r.o_rh });
    }
  }
  for (const r of rows) { r.x = featureVector(r); r.y = ln1(r.obs) - ln1(r.F); }
  return rows.filter(r => isFinite(r.y));
}

// ---------------------------------------------------------------- experts
function trainDay(rows) {
  const s = {}, n = {}; for (const r of rows) { const k = `${leadClass(r.lead)}|${hourBlock(r.hloc)}`; s[k] = (s[k] || 0) + r.y; n[k] = (n[k] || 0) + 1; }
  const table = {}; for (const k in s) table[k] = (s[k] / n[k]) * n[k] / (n[k] + MLCFG.shrinkK);
  return { type: 'day', table, n: rows.length };
}
const predDay = (m, r) => m.table[`${leadClass(r.lead)}|${hourBlock(r.hloc)}`] || 0;

function impute(x, mu) { return x.map((v, j) => isFinite(v) ? v : mu[j]); }
function trainRidge(rows) {
  const p = NAMES.length, mu = new Array(p).fill(0), cnt = new Array(p).fill(0);
  for (const r of rows) r.x.forEach((v, j) => { if (isFinite(v)) { mu[j] += v; cnt[j]++; } });
  for (let j = 0; j < p; j++) mu[j] = cnt[j] ? mu[j] / cnt[j] : 0;
  const sd = new Array(p).fill(0); for (const r of rows) impute(r.x, mu).forEach((v, j) => sd[j] += (v - mu[j]) ** 2);
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j] / rows.length) || 1;
  const A = Array.from({ length: p + 1 }, () => new Array(p + 1).fill(0)), b = new Array(p + 1).fill(0);
  for (const r of rows) { const z = [1, ...impute(r.x, mu).map((v, j) => (v - mu[j]) / sd[j])];
    for (let i = 0; i <= p; i++) { b[i] += z[i] * r.y; for (let k = 0; k <= p; k++) A[i][k] += z[i] * z[k]; } }
  for (let i = 1; i <= p; i++) A[i][i] += MLCFG.ridgeLambda * rows.length / 100;
  const beta = solve(A, b); if (!beta) return null;
  return { type: 'week', mu, sd, beta, n: rows.length };
}
const predRidge = (m, r) => { const z = impute(r.x, m.mu).map((v, j) => (v - m.mu[j]) / m.sd[j]); return m.beta[0] + z.reduce((a, v, j) => a + m.beta[j + 1] * v, 0); };

// gradient-boosted regression trees (squared loss), histogram splits on quantile bins; NaN goes to the left branch
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export function trainGBM(rows, opt = MLCFG.gbm, type = 'month') {
  seed = 12345;
  if (rows.length > opt.maxRows) { const keep = opt.maxRows / rows.length; rows = rows.filter(() => rnd() < keep); }
  const n = rows.length, p = NAMES.length;
  const edges = []; for (let j = 0; j < p; j++) { const v = rows.map(r => r.x[j]).filter(isFinite).sort((a, b) => a - b);
    const e = []; for (let q = 1; q < opt.bins; q++) { const x = v[Math.floor(q * v.length / opt.bins)]; if (x != null && (!e.length || x > e[e.length - 1])) e.push(x); } edges.push(e); }
  const bin = new Uint8Array(n * p); for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) { const x = rows[i].x[j];
    if (!isFinite(x)) { bin[i * p + j] = 0; continue; } let lo = 0, hi = edges[j].length; while (lo < hi) { const mid = (lo + hi) >> 1; if (x <= edges[j][mid]) hi = mid; else lo = mid + 1; } bin[i * p + j] = lo + 1; }
  const y = Float64Array.from(rows, r => r.y), f0 = y.reduce((a, v) => a + v, 0) / n, pred = new Float64Array(n).fill(f0), trees = [], gain = new Array(p).fill(0);
  const nb = opt.bins + 2;
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
  const gs = gain.reduce((a, v) => a + v, 0) || 1;
  return { type, f0, edges, trees, n, importance: Object.fromEntries(NAMES.map((nm, j) => [nm, +(gain[j] / gs).toFixed(3)]).sort((a, b) => b[1] - a[1]).slice(0, 8)) };
}
export function predGBM(m, r) {
  let s = m.f0; const b = r.x.map((x, j) => { if (!isFinite(x)) return 0; const e = m.edges[j]; let lo = 0, hi = e.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (x <= e[mid]) hi = mid; else lo = mid + 1; } return lo + 1; });
  for (let t of m.trees) { while (t.v === undefined) t = b[t.j] <= t.b ? t.l : t.r; s += t.v; }
  return s;
}
export function predictExpert(m, r) {
  if (!m) return 0;
  return m.type === 'day' ? predDay(m, r) : m.type === 'week' ? predRidge(m, r) : predGBM(m, r);
}

// ---------------------------------------------------------------- daily learning step
// state.ml = { weights, models, lastDay, history }; dataset = loadDataset(...) over the history kept on GitHub (35 days)
export function dailyLearn(state, rows, { now, dayStart, dayEnd, season = null, seasonRows = null, log = () => {} }) {
  if (!rows.length) throw new Error('no verified rows (forecast history missing?)');
  const ml = state.ml ||= { weights: { base: 1 }, models: {}, lastDay: null };
  // 1. score yesterday's models on the newly verified day (out of sample) and update the weights
  const test = rows.filter(r => r.tValid >= dayStart && r.tValid < dayEnd);
  const models = { ...ml.models, ...(season ? { season } : {}) };
  const active = EXPERTS.filter(e => e === 'base' || models[e]);
  const loss = {};
  if (test.length >= 50) {
    for (const e of active) { let s = 0; for (const r of test) { const q = Math.max(-MLCFG.clip, Math.min(MLCFG.clip, e === 'base' ? 0 : predictExpert(models[e], r))); s += (r.y - q) ** 2; } loss[e] = s / test.length; }
    const scale = MLCFG.eta / Math.max(loss.base, 1e-3);
    let w = Object.fromEntries(active.map(e => [e, (ml.weights[e] ?? 0) * Math.exp(-scale * loss[e])]));
    const sw = Object.values(w).reduce((a, v) => a + v, 0) || 1; for (const e in w) w[e] /= sw;
    for (const e in w) w[e] = (1 - MLCFG.share) * w[e] + MLCFG.share / active.length;   // fixed share
    ml.weights = w;
  }
  // 2. retrain every expert whose window has enough verified data (data before dayEnd only)
  const train = rows.filter(r => r.tValid < dayEnd), days = new Set(train.map(r => new Date(r.tValid + 7 * HOUR).toISOString().slice(0, 10))).size;
  const win = d => train.filter(r => r.tValid >= dayEnd - d * 864e5);
  const newModels = {}, info = {};
  if (days >= MLCFG.minDays.day && win(MLCFG.windows.day).length >= MLCFG.minRowsDay) newModels.day = trainDay(win(MLCFG.windows.day));
  if (days >= MLCFG.minDays.week) { const m = trainRidge(win(MLCFG.windows.week)); if (m) newModels.week = m; }
  if (days >= MLCFG.minDays.month) newModels.month = trainGBM(win(MLCFG.windows.month));
  if (seasonRows && seasonRows.days >= STORE.minDaysSeason) { const m = trainGBM(seasonRows.rows.filter(r => r.tValid < dayEnd), MLCFG.gbm, 'season'); m.season = seasonRows.season; newModels.season = m; }
  for (const e in newModels) { info[e] = { n: newModels[e].n, ...(newModels[e].importance ? { importance: newModels[e].importance } : {}) };
    if (ml.weights[e] == null) ml.weights[e] = 0; }   // a new expert enters with weight 0; the fixed share gives it a start next day
  // an expert whose window could not be retrained today keeps its last model (e.g. after a data gap), rather than vanishing
  ml.models = { ...ml.models, ...newModels }; ml.lastDay = new Date(dayStart + 7 * HOUR).toISOString().slice(0, 10);
  const rec = { day: ml.lastDay, at: now, verifiedDays: days, nTest: test.length, loss: Object.fromEntries(Object.entries(loss).map(([k, v]) => [k, +v.toFixed(5)])),
    weights: Object.fromEntries(Object.entries(ml.weights).map(([k, v]) => [k, +v.toFixed(4)])), trained: info, seasonStore: seasonRows ? { season: seasonRows.season, days: seasonRows.days } : null };
  log(`ML: day ${rec.day}, ${days} verified days, scored ${test.length} rows; loss ${JSON.stringify(rec.loss)}; weights ${JSON.stringify(rec.weights)}; trained ${Object.keys(info).join(', ') || 'none yet'}`);
  return rec;
}
// combined correction for one forecast row (features as in the log); returns r̂ in log space
export function mlCorrection(state, r, season = null) {
  const ml = state.ml; if (!ml) return 0;
  if (!r.x) r = { ...r, x: featureVector(r) };
  const models = { ...ml.models, ...(season ? { season } : {}) }; let s = 0;
  for (const [e, w] of Object.entries(ml.weights)) if (w > 0 && e !== 'base' && models[e]) s += w * predictExpert(models[e], r);
  return Math.max(-MLCFG.clip, Math.min(MLCFG.clip, s));
}
export const mlActive = (state, season = null) => !!state.ml && Object.entries(state.ml.weights || {}).some(([e, w]) => e !== 'base' && w > 0 && (e === 'season' ? !!(season || state.ml.models?.season) : !!state.ml.models?.[e]));

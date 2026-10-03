// Regression kriging (regression on CAMS + elevation, ordinary kriging of the residuals), in log space.
// Same structure as the RIMM method used for the EEA European air quality maps (Horálek et al.)
// and as kriging with an external chemistry-transport-model drift (Real et al., 2022, ESSD 14, 2419).

const R_EARTH = 6371;
const kmFast = (la1, lo1, la2, lo2) => { const x = (lo2 - lo1) * Math.cos((la1 + la2) * Math.PI / 360), y = la2 - la1; return Math.sqrt(x * x + y * y) * Math.PI / 180 * R_EARTH; };

// (weighted) least squares with intercept; X rows without the 1; w = weights (default 1). Small ridge keeps it stable.
export function ols(X, y, w = null) {
  const p = X[0].length + 1, A = Array.from({ length: p }, () => new Float64Array(p)), b = new Float64Array(p);
  for (let i = 0; i < y.length; i++) { const r = [1, ...X[i]], wi = w ? w[i] : 1;
    for (let j = 0; j < p; j++) { b[j] += wi * r[j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += wi * r[j] * r[k]; } }
  for (let j = 1; j < p; j++) A[j][j] += 1e-6 * y.length;
  return solve(A.map(r => Array.from(r)), Array.from(b));
}
// Gaussian elimination with partial pivoting
export function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}

// exponential semivariogram γ(h) = c0 + c1 (1 - exp(-h/a)), fitted to binned empirical values by weighted least squares
export function fitVariogram(pts, res, { binKm = 15, maxKm = 400 } = {}) {
  const nb = Math.ceil(maxKm / binKm), sg = new Float64Array(nb), sn = new Float64Array(nb), sh = new Float64Array(nb);
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const h = kmFast(pts[i][0], pts[i][1], pts[j][0], pts[j][1]); if (h >= maxKm) continue;
    const k = Math.floor(h / binKm); sg[k] += 0.5 * (res[i] - res[j]) ** 2; sn[k]++; sh[k] += h;
  }
  const bins = []; for (let k = 0; k < nb; k++) if (sn[k] >= 5) bins.push({ h: sh[k] / sn[k], g: sg[k] / sn[k], n: sn[k] });
  const varRes = res.reduce((a, v) => a + v * v, 0) / res.length;
  if (bins.length < 3) return { c0: varRes * 0.5, c1: varRes * 0.5, a: 100, bins, fallback: true };
  let best = null;
  for (let a = 10; a <= 500; a += 5) {
    // linear in (c0, c1) for fixed a: weighted LS on g = c0 + c1 f
    let s1 = 0, sf = 0, sff = 0, sg_ = 0, sfg = 0;
    for (const b of bins) { const f = 1 - Math.exp(-b.h / a), w = b.n; s1 += w; sf += w * f; sff += w * f * f; sg_ += w * b.g; sfg += w * f * b.g; }
    const det = s1 * sff - sf * sf; if (Math.abs(det) < 1e-12) continue;
    let c1 = (s1 * sfg - sf * sg_) / det, c0 = (sg_ - c1 * sf) / s1;
    if (c0 < 0) { c0 = 0; c1 = sfg / sff; } if (c1 < 0) { c1 = 0; c0 = sg_ / s1; }
    let sse = 0; for (const b of bins) sse += b.n * (b.g - (c0 + c1 * (1 - Math.exp(-b.h / a)))) ** 2;
    if (!best || sse < best.sse) best = { c0, c1, a, sse };
  }
  return { c0: best.c0, c1: best.c1, a: best.a, bins };
}
const gam = (v, h) => h <= 0 ? 0 : v.c0 + v.c1 * (1 - Math.exp(-h / v.a));

// ordinary kriging of residuals at (lat,lon) from the K nearest points within maxKm; skip = index to leave out (cross-validation)
export function krige(pts, res, v, lat, lon, { K = 16, maxKm = 400, skip = -1 } = {}) {
  const near = [];
  for (let i = 0; i < pts.length; i++) { if (i === skip) continue; const d = kmFast(lat, lon, pts[i][0], pts[i][1]); if (d <= maxKm) near.push([d, i]); }
  if (near.length < 3) return { est: 0, dmin: Infinity, varOK: v.c0 + v.c1 };
  near.sort((a, b) => a[0] - b[0]); const nn = near.slice(0, K), n = nn.length;
  const A = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(1)), b = new Array(n + 1).fill(1);
  A[n][n] = 0;
  for (let i = 0; i < n; i++) {
    // two different monitors at the same spot: use the nugget, not 0, or the kriging matrix becomes singular
    for (let j = 0; j < n; j++) A[i][j] = i === j ? 0 : Math.max(gam(v, kmFast(pts[nn[i][1]][0], pts[nn[i][1]][1], pts[nn[j][1]][0], pts[nn[j][1]][1])), v.c0 > 0 ? 0 : 1e-6, v.c0);
    b[i] = gam(v, nn[i][0]);
  }
  const g0 = b.slice(), w = solve(A, b); if (!w) return { est: 0, dmin: nn[0][0], varOK: v.c0 + v.c1 };
  let est = 0, varOK = w[n]; for (let i = 0; i < n; i++) { est += w[i] * res[nn[i][1]]; varOK += w[i] * g0[i]; }
  // ordinary-kriging variance σ² = Σ λᵢ γ(xᵢ, x₀) + μ (μ = Lagrange multiplier), bounded by the sill
  return { est, dmin: nn[0][0], varOK: Math.min(Math.max(varOK, 0), v.c0 + v.c1) };
}

// Cell declustering (Deutsch 1989, DECLUS; Isaaks & Srivastava 1989): each monitor gets weight 1/(number of monitors in its
// cell), scaled so the weights sum to n. Dense networks (e.g. 65 Bangkok sites) then count roughly as much as the area they cover
// in the regression, instead of pulling the region-wide coefficients toward one city. cellDeg <= 0 → equal weights.
export function declusterWeights(pts, cellDeg) {
  if (!(cellDeg > 0)) return pts.map(() => 1);
  const key = ([la, lo]) => `${Math.floor(la / cellDeg)}:${Math.floor(lo / cellDeg)}`, cnt = new Map();
  for (const q of pts) cnt.set(key(q), (cnt.get(key(q)) || 0) + 1);
  const w = pts.map(q => 1 / cnt.get(key(q))), sw = w.reduce((a, v) => a + v, 0);
  return w.map(v => v * pts.length / sw);
}
// Full analysis. obs: [{lat, lon, y, x: [predictors]}]; grid: {lon0, lat0, step, nx, ny}; predictorsAt not needed (residual only).
export function regressionKriging(obs, gridSpec, opt = {}) {
  const X = obs.map(o => o.x), y = obs.map(o => o.y), pts = obs.map(o => [o.lat, o.lon]);
  const W = declusterWeights(pts, opt.declusterDeg || 0);
  const beta = ols(X, y, W); if (!beta) return null;
  const pred = o => beta[0] + o.x.reduce((s, v, j) => s + beta[j + 1] * v, 0);
  const res = obs.map(o => o.y - pred(o));
  // variance of the regression part at x₀, written in centred form for numerical stability (predictors can be
  // nearly collinear): Var(x₀ᵀβ̂) = s²/n + (x₀ − x̄)ᵀ s²(X_cᵀX_c)⁻¹ (x₀ − x̄), X_c = centred predictors
  // weighted least squares: weights sum to n, so with equal weights these reduce to the ordinary formulas
  const p = beta.length - 1, n = obs.length, xbar = new Array(p).fill(0);
  obs.forEach((o, i) => { for (let j = 0; j < p; j++) xbar[j] += W[i] * o.x[j] / n; });
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  obs.forEach((o, i) => { for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) XtX[j][k] += W[i] * (o.x[j] - xbar[j]) * (o.x[k] - xbar[k]); });
  for (let j = 0; j < p; j++) XtX[j][j] += 1e-6 * n;   // same small ridge as ols()
  const s2 = res.reduce((a, e, i) => a + W[i] * e * e, 0) / Math.max(1, n - p - 1);
  const inv = Array.from({ length: p }, (_, j) => solve(XtX.map(r => r.slice()), Array.from({ length: p }, (_, k) => +(k === j))));
  const covSlope = inv.every(Boolean) ? inv.map(col => col.map(x => s2 * x)) : null;   // symmetric, so columns = rows
  const regVar = x => { let q = s2 / n; if (covSlope) for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) q += (x[j] - xbar[j]) * covSlope[j][k] * (x[k] - xbar[k]); return Math.max(0, q); };
  const vario = fitVariogram(pts, res);
  const maxKm = Math.min(400, Math.max(150, 3 * vario.a)), K = opt.K || 16;
  // fade the kriged residual linearly from 1 at maxKm/2 to 0 at maxKm from the nearest monitor, so far areas revert to the regression
  const fade = d => d <= maxKm / 2 ? 1 : d >= maxKm ? 0 : 1 - (d - maxKm / 2) / (maxKm / 2);
  // leave-one-out cross-validation (log space → µg/m³)
  // residual error variance where the kriged residual is faded by f: Var(ε − fε̂) ≈ sill − (2f − f²)(sill − σ²_OK),
  // using Cov(ε, ε̂) ≈ Var(ε̂) ≈ sill − σ²_OK; equals σ²_OK at f = 1 and the sill at f = 0
  const sill = vario.c0 + vario.c1;
  const residVar = k => { const f = fade(k.dmin); return Math.max(0, sill - (2 * f - f * f) * (sill - k.varOK)); };
  // leave-one-out: refit the regression and the variogram without the left-out monitor, so the score is not optimistic
  const cvSd = [], cv = obs.map((o, i) => {
    const rest = obs.filter((_, j) => j !== i), wr = declusterWeights(rest.map(r => [r.lat, r.lon]), opt.declusterDeg || 0);
    const b = ols(rest.map(r => r.x), rest.map(r => r.y), wr) || beta;
    const pr = r => b[0] + r.x.reduce((s, v, j) => s + b[j + 1] * v, 0);
    const rp = rest.map(r => [r.lat, r.lon]), rr = rest.map(r => r.y - pr(r)), vi = fitVariogram(rp, rr);
    const mk = Math.min(400, Math.max(150, 3 * vi.a)), fd = d => d <= mk / 2 ? 1 : d >= mk ? 0 : 1 - (d - mk / 2) / (mk / 2);
    const k = krige(rp, rr, vi, o.lat, o.lon, { K, maxKm: mk }), f = fd(k.dmin), sl = vi.c0 + vi.c1;
    const yhat = pr(o) + k.est * f;
    cvSd.push(Math.sqrt(Math.max(0, sl - (2 * f - f * f) * (sl - k.varOK)) + regVar(o.x)));
    return { yhat, c: Math.exp(yhat) - 1 }; });
  // calibration check: share of monitors whose left-out value falls inside ±1σ (log space); ≈ 0.68 if σ is right
  const cover = cv.filter((c, i) => Math.abs(obs[i].y - c.yhat) <= cvSd[i]).length / obs.length;
  const { lon0, lat0, step, nx, ny } = gridSpec, values = new Array(nx * ny), sd = new Array(nx * ny);
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const k = krige(pts, res, vario, lat0 + iy * step, lon0 + ix * step, { K, maxKm });
    values[iy * nx + ix] = Math.round(k.est * fade(k.dmin) * 1000) / 1000;
    sd[iy * nx + ix] = Math.round(Math.sqrt(residVar(k)) * 100) / 100;   // residual part only; the page adds the regression part
  }
  return { beta, declusterDeg: opt.declusterDeg || 0, weightRange: [Math.min(...W), Math.max(...W)].map(v => +v.toFixed(3)), regCov: { s2n: s2 / n, xbar, covSlope }, vario: { c0: vario.c0, c1: vario.c1, a_km: vario.a, nbins: vario.bins.length, fallback: !!vario.fallback }, maxKm,
    cv: cv.map(c => c.c), cvCover1s: Math.round(cover * 100) / 100, cvSdMedian: Math.round([...cvSd].sort((a, b) => a - b)[cvSd.length >> 1] * 1000) / 1000,
    resid: { lon0, lat0, step, nx, ny, values, sd } };
}

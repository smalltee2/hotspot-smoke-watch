// Fire-emission data assimilation for the smoke model (Bayesian synthesis inversion; analytical solution of the linear problem,
// equivalent to 4D-Var for a model that is linear in emissions — a Gaussian-puff model is).
//
//   innovation   d_k = y_k − c_k        y = measured PM2.5 (station, hour), c = CAMS with the station's slow bias removed
//   model        d_k ≈ Σ_g x_g · F_gk   F_gk = smoke that fire group g delivers to observation k in our puff model (prior emissions),
//                                       x_g = s_g − 1, s_g = emission scaling factor of group g (0.5° cell × local day)
//   prior        x ~ N(0, σ_b²)         σ_b = 1 (factor-of-two uncertainty of fire emission estimates)
//   obs error    R_k = σ_k² · κ         σ_k = max(σ_min, rel·y_k): instrument + representation + non-fire CAMS error;
//                                       κ inflates for temporally correlated hourly errors
//   solution     x̂ = (Hᵀ R⁻¹ H + B⁻¹)⁻¹ Hᵀ R⁻¹ d,   A = (Hᵀ R⁻¹ H + B⁻¹)⁻¹,   DOFS = trace(I − A B⁻¹)   (Rodgers, 2000)
//
// Incremental form: CAMS already contains fire smoke (GFAS), so the assimilation only corrects the part it gets wrong; with no
// information x = 0 and the forecast is unchanged. Only station-hours with real fire influence (Σ_g F_gk ≥ minF) are used.
export const ASSIM = { groupDeg: 0.5, sigmaB: 1.0, sigmaMin: 3, rel: 0.3, kappa: 4, minF: 1.0, windowH: 48, spinupH: 6, sMin: 0.1, sMax: 5, maxSources: 800 };

function solveSym(A, b) {   // Cholesky for a symmetric positive-definite system; returns x and the inverse
  const n = b.length, L = A.map(r => r.slice());
  for (let j = 0; j < n; j++) { for (let k = 0; k < j; k++) L[j][j] -= L[j][k] ** 2; if (L[j][j] <= 0) return null; L[j][j] = Math.sqrt(L[j][j]);
    for (let i = j + 1; i < n; i++) { for (let k = 0; k < j; k++) L[i][j] -= L[i][k] * L[j][k]; L[i][j] /= L[j][j]; } }
  const fwd = v => { const y = new Array(n); for (let i = 0; i < n; i++) { let s = v[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; } return y; };
  const bwd = y => { const x = new Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; };
  const sol = v => bwd(fwd(v));
  return { x: sol(b), inv: Array.from({ length: n }, (_, j) => sol(Array.from({ length: n }, (_, i) => +(i === j)))) };
}

// obs: [{id, lat, lon, t (hour-ending, ms), y, c, hourMean}]  — hourMean: value is the mean of the hour ending at t
export function assimilateFires({ M, hots, W, obs, now, tEnd, cfg = ASSIM, log = () => {} }) {
  const t0 = Date.now();
  const sources = M.clusterSources(hots.filter(h => M.confOK(h, 'n')), 0.1, 7.17, true, true).slice(0, cfg.maxSources);
  if (!sources.length) return { status: 'no fires', groups: [] };
  const sim = M.simulate(sources, W, { ef: 7.17, durH: 6, profile: 'diurnal', plumeRise: true, tEnd });
  // groups: 0.5° cell × local day
  // local solar day of a source (d0 is local midnight in UTC ms, so it differs slightly with longitude inside one cell)
  const lday = s => Math.round((s.d0 + s.lon / 15 * 3600e3) / 864e5);
  const gKey = s => `${Math.floor(s.lat / cfg.groupDeg)}:${Math.floor(s.lon / cfg.groupDeg)}:${lday(s)}`, gIdx = new Map(), groups = [];
  const srcG = sources.map(s => { const k = gKey(s); if (!gIdx.has(k)) { gIdx.set(k, groups.length); groups.push({ key: k, lat0: Math.floor(s.lat / cfg.groupDeg) * cfg.groupDeg, lon0: Math.floor(s.lon / cfg.groupDeg) * cfg.groupDeg, day: new Date(lday(s) * 864e5).toISOString().slice(0, 10), nSrc: 0, frp: 0 }); }
    const g = groups[gIdx.get(k)]; g.nSrc++; g.frp += s.frp; return gIdx.get(k); });
  const nG = groups.length, H0 = sim.hours[0];
  // contribution of each group to a point from one hourly snapshot (same kernel as concAt)
  const MPD = 111320, DEG = Math.PI / 180;
  const contrib = (snap, lat, lon, out, w) => { const cl = Math.cos(lat * DEG) * MPD;
    for (let i = 0; i < snap.n; i++) { const dx = (lon - snap.lon[i]) * cl, dy = (lat - snap.lat[i]) * MPD, sy = snap.sy[i], r2 = dx * dx + dy * dy, s2 = 2 * sy * sy;
      if (r2 > 4.5 * s2) continue; out[srcG[snap.si[i]]] += w * snap.m[i] / (Math.PI * s2) * Math.exp(-r2 / s2) * snap.fz[i]; } };
  const tMin = Math.max(now - cfg.windowH * 3600e3, sim.tStart + cfg.spinupH * 3600e3);
  const rows = [];
  for (const o of obs) {
    if (o.t < tMin || o.t > now) continue;
    const k = Math.round((o.t - H0) / 3600e3); if (k < 0 || k >= sim.snaps.length) continue;
    const F = new Float64Array(nG);
    if (o.hourMean && k > 0) { contrib(sim.snaps[k - 1], o.lat, o.lon, F, 0.5); contrib(sim.snaps[k], o.lat, o.lon, F, 0.5); }
    else contrib(sim.snaps[k], o.lat, o.lon, F, 1);
    let Fs = 0; for (let g = 0; g < nG; g++) Fs += F[g];
    if (Fs < cfg.minF) continue;
    rows.push({ o, F, Fs, d: o.y - o.c });
  }
  if (rows.length < 5) return { status: `too few fire-influenced observations (${rows.length})`, nObs: rows.length, groups: groups.map(g => ({ ...g, s: 1, sd: cfg.sigmaB, seen: 0 })) };
  // normal equations in group space
  const B = cfg.sigmaB ** 2, A = Array.from({ length: nG }, (_, i) => { const r = new Array(nG).fill(0); r[i] = 1 / B; return r; }), b = new Array(nG).fill(0), seen = new Array(nG).fill(0);
  for (const r of rows) { const sk = Math.max(cfg.sigmaMin, cfg.rel * Math.max(r.o.y, 0)), wi = 1 / (sk * sk * cfg.kappa);
    const nz = []; for (let g = 0; g < nG; g++) if (r.F[g] > 1e-6) { nz.push(g); if (r.F[g] >= 0.5) seen[g]++; }
    for (const i of nz) { b[i] += wi * r.F[i] * r.d; for (const j of nz) A[i][j] += wi * r.F[i] * r.F[j]; } }
  const S = solveSym(A, b); if (!S) return { status: 'inversion failed (matrix not positive definite)', groups: [] };
  let dofs = 0; for (let g = 0; g < nG; g++) dofs += 1 - S.inv[g][g] / B;
  const x = S.x.map(v => Math.min(cfg.sMax - 1, Math.max(cfg.sMin - 1, v)));
  // fit at the assimilated observations (in-sample): innovation RMSE before and after
  let e0 = 0, e1 = 0, prior = 0, post = 0; for (const r of rows) { let hx = 0; for (let g = 0; g < nG; g++) hx += x[g] * r.F[g]; e0 += r.d ** 2; e1 += (r.d - hx) ** 2; prior += r.Fs; post += r.Fs + hx; }
  const out = { status: 'ok', nObs: rows.length, nStations: new Set(rows.map(r => r.o.id)).size, nGroups: nG, dofs: +dofs.toFixed(2),
    innovRmse: { before: +Math.sqrt(e0 / rows.length).toFixed(2), after: +Math.sqrt(e1 / rows.length).toFixed(2) },
    fireMean: { prior: +(prior / rows.length).toFixed(2), posterior: +(post / rows.length).toFixed(2) }, cfg, ms: Date.now() - t0,
    groups: groups.map((g, i) => ({ lat0: g.lat0, lon0: g.lon0, day: g.day, nSrc: g.nSrc, frp: Math.round(g.frp), s: +(1 + x[i]).toFixed(3), sd: +Math.sqrt(S.inv[i][i]).toFixed(3), seen: seen[i] })) };
  log(`fire assimilation: ${out.nObs} station-hours at ${out.nStations} stations, ${nG} fire groups, DOFS ${out.dofs}, innovation RMSE ${out.innovRmse.before} → ${out.innovRmse.after} µg/m³, fire smoke at stations ${out.fireMean.prior} → ${out.fireMean.posterior} µg/m³, ${out.ms} ms`);
  return out;
}

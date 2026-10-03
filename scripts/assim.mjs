// Fire-emission data assimilation for the smoke model: Bayesian inversion of the emissions of each fire group
// (0.5° cell × local solar day) from the last ~48 h of station measurements.
//
//   innovation   d_k = y_k − c_k        y = measured PM2.5, c = CAMS with the station's slow (weeks) bias removed
//   model        d_k ≈ Σ_g (e^{x_g} − 1)·F_gk
//                                       F_gk = fire smoke group g delivers to observation k in our puff model (prior emissions);
//                                       s_g = e^{x_g} = emission scaling factor (log-normal, so it can never turn negative)
//   prior        x ~ N(0, σ_b²)         σ_b = ln 2: fire emission estimates are uncertain by about a factor of two (1σ)
//   obs error    R_k = κ·[max(σ_min, rel·y_k)² + (ε_m·ΣF_k)²]
//                                       instrument + representation + non-fire CAMS error, plus transport-model error that grows
//                                       with the modelled fire signal; κ is tuned online by the χ² test (below)
//   solution     Gauss–Newton on J(x) = ½(d−h(x))ᵀR⁻¹(d−h(x)) + ½xᵀB⁻¹x (for the linear case this is the synthesis inversion,
//                i.e. 4D-Var for a model that is linear in emissions); posterior covariance A = (KᵀR⁻¹K + B⁻¹)⁻¹,
//                DOFS = n − tr(A B⁻¹) (Rodgers, 2000)
//   χ² test      at the minimum 2J/m ≈ 1 if R and B are right (m = number of observations); κ for the next run is nudged by that ratio
//
// Incremental form: CAMS already contains fire smoke (GFAS), so only the part it gets wrong is corrected: with no information
// every factor stays 1 and the forecast is unchanged. Only observations that our model says receive ≥ minF of fire smoke are used.
// The corrected forecast adds the increment Σ_g (s_g − 1)·F_g(t) from one more run with only the rescaled fires (the model is
// linear in emissions), carried forward by the forecast wind.
export const ASSIM = { groupDeg: 0.5, sigmaB: Math.LN2, sigmaMin: 3, rel: 0.3, epsModel: 0.5, kappa0: 4, kappaMin: 1, kappaMax: 20,
  minF: 1.0, windowH: 48, spinupH: 6, maxSources: 800, maxIter: 10, horizonH: 72 };

const MPD = 111320, DEG = Math.PI / 180;
function cholSolve(A, b, wantInv) {
  const n = b.length, L = A.map(r => Float64Array.from(r));
  for (let j = 0; j < n; j++) { let d = L[j][j]; for (let k = 0; k < j; k++) d -= L[j][k] ** 2; if (!(d > 0)) return null; L[j][j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) { let s = L[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; L[i][j] = s / L[j][j]; } }
  const sol = v => { const y = new Float64Array(n); for (let i = 0; i < n; i++) { let s = v[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; } return x; };
  return { x: sol(b), diagInv: wantInv ? Array.from({ length: n }, (_, j) => sol(Array.from({ length: n }, (_, i) => +(i === j)))[j]) : null };
}
// contribution of each group to a point from one hourly snapshot (same kernel as the page's concAt)
function addContrib(snap, lat, lon, out, w, srcG) { const cl = Math.cos(lat * DEG) * MPD;
  for (let i = 0; i < snap.n; i++) { const dx = (lon - snap.lon[i]) * cl, dy = (lat - snap.lat[i]) * MPD, sy = snap.sy[i], r2 = dx * dx + dy * dy, s2 = 2 * sy * sy;
    if (r2 > 4.5 * s2) continue; out[srcG[snap.si[i]]] += w * snap.m[i] / (Math.PI * s2) * Math.exp(-r2 / s2) * snap.fz[i]; } }
function concAt(snap, lat, lon) { let c = 0; const cl = Math.cos(lat * DEG) * MPD;
  for (let i = 0; i < snap.n; i++) { const dx = (lon - snap.lon[i]) * cl, dy = (lat - snap.lat[i]) * MPD, sy = snap.sy[i], r2 = dx * dx + dy * dy, s2 = 2 * sy * sy;
    if (r2 > 4.5 * s2) continue; c += snap.m[i] / (Math.PI * s2) * Math.exp(-r2 / s2) * snap.fz[i]; } return c; }
// splat one snapshot onto a regular grid (points at lon0 + ix·step, lat0 + iy·step)
function splat(snap, G, out, w) {
  for (let i = 0; i < snap.n; i++) { const sy = snap.sy[i], s2 = 2 * sy * sy, amp = w * snap.m[i] / (Math.PI * s2) * snap.fz[i], cl = Math.cos(snap.lat[i] * DEG) * MPD;
    const rLat = 3 * sy / MPD, rLon = 3 * sy / cl;
    const x0 = Math.max(0, Math.ceil((snap.lon[i] - rLon - G.lon0) / G.step)), x1 = Math.min(G.nx - 1, Math.floor((snap.lon[i] + rLon - G.lon0) / G.step));
    const y0 = Math.max(0, Math.ceil((snap.lat[i] - rLat - G.lat0) / G.step)), y1 = Math.min(G.ny - 1, Math.floor((snap.lat[i] + rLat - G.lat0) / G.step));
    for (let y = y0; y <= y1; y++) { const dy = (G.lat0 + y * G.step - snap.lat[i]) * MPD;
      for (let x = x0; x <= x1; x++) { const dx = (G.lon0 + x * G.step - snap.lon[i]) * cl, r2 = dx * dx + dy * dy; if (r2 < 9 * s2) out[y * G.nx + x] += amp * Math.exp(-r2 / s2); } } } }

// value of a simulation at a point and time for an observation of a given kind:
//   'hm' = mean of the hour ending at t, 'h' = at t, '24' = mean of the 24 hours ending at t (≥ 18 snapshots)
function simValue(sim, lat, lon, t, kind) {
  if (!sim) return 0; const k = Math.round((t - sim.hours[0]) / 3600e3);
  // 24-h mean: hours before the simulation start hold no smoke (zero), hours past its end are missing; ≥ 18 of 24 must exist
  if (kind === '24') { let s = 0, n = 0; for (let q = k - 23; q <= k; q++) { if (q >= sim.snaps.length) continue; n++; if (q >= 0) s += concAt(sim.snaps[q], lat, lon); } return n >= 18 ? s / 24 : 0; }
  if (k < 0 || k >= sim.snaps.length) return 0;
  return kind === 'hm' && k > 0 ? 0.5 * (concAt(sim.snaps[k - 1], lat, lon) + concAt(sim.snaps[k], lat, lon)) : concAt(sim.snaps[k], lat, lon);
}

// obs: [{id, lat, lon, t (ms, end of averaging period), y, c, kind}]
export function assimilateFires({ M, hots, W, obs, now, kappa = ASSIM.kappa0, cfg = ASSIM, log = () => {} }) {
  const t0 = Date.now(), tEnd = now + cfg.horizonH * 3600e3;
  const sources = M.clusterSources(hots.filter(h => M.confOK(h, 'n')), 0.1, 7.17, true, true).slice(0, cfg.maxSources);
  const empty = status => ({ status, groups: [], prior: null, inc: null, incAt: () => 0, fireAt: () => 0, incGrid24: () => null, cfg });
  if (!sources.length) return empty('no fires');
  const simOpts = { ef: 7.17, durH: 6, profile: 'diurnal', plumeRise: true, tEnd };
  const prior = M.simulate(sources, W, simOpts);
  const lday = s => Math.round((s.d0 + s.lon / 15 * 3600e3) / 864e5);   // local solar day of a source
  const gIdx = new Map(), groups = [];
  const srcG = sources.map(s => { const k = `${Math.floor(s.lat / cfg.groupDeg)}:${Math.floor(s.lon / cfg.groupDeg)}:${lday(s)}`;
    if (!gIdx.has(k)) { gIdx.set(k, groups.length); groups.push({ lat0: Math.floor(s.lat / cfg.groupDeg) * cfg.groupDeg, lon0: Math.floor(s.lon / cfg.groupDeg) * cfg.groupDeg, day: new Date(lday(s) * 864e5).toISOString().slice(0, 10), nSrc: 0, frp: 0 }); }
    const g = groups[gIdx.get(k)]; g.nSrc++; g.frp += s.frp; return gIdx.get(k); });
  const nG = groups.length, H0 = prior.hours[0], tMin = Math.max(now - cfg.windowH * 3600e3, prior.tStart + cfg.spinupH * 3600e3);
  const fireAt = (lat, lon, t, kind = 'h') => simValue(prior, lat, lon, t, kind);
  // sensitivities
  const rows = [];
  for (const o of obs) {
    if (o.t > now || o.t < tMin + (o.kind === '24' ? 23 * 3600e3 : 0)) continue;
    const k = Math.round((o.t - H0) / 3600e3); if (k < 0 || k >= prior.snaps.length) continue;
    const F = new Float64Array(nG);
    if (o.kind === '24') { for (let q = k - 23; q <= k; q++) if (q >= 0) addContrib(prior.snaps[q], o.lat, o.lon, F, 1 / 24, srcG); }   // hours before the run start: zero
    else if (o.kind === 'hm' && k > 0) { addContrib(prior.snaps[k - 1], o.lat, o.lon, F, 0.5, srcG); addContrib(prior.snaps[k], o.lat, o.lon, F, 0.5, srcG); }
    else addContrib(prior.snaps[k], o.lat, o.lon, F, 1, srcG);
    let Fs = 0; const nz = []; for (let g = 0; g < nG; g++) if (F[g] > 1e-6) { Fs += F[g]; nz.push(g); }
    if (Fs < cfg.minF) continue;
    const sk = Math.max(cfg.sigmaMin, cfg.rel * Math.max(o.y, 0));
    rows.push({ o, F, nz, Fs, d: o.y - o.c, r: kappa * (sk * sk + (cfg.epsModel * Fs) ** 2) });
  }
  const seen = new Array(nG).fill(0); for (const r of rows) for (const g of r.nz) if (r.F[g] >= 0.5) seen[g]++;
  const base = { nObs: rows.length, nStations: new Set(rows.map(r => r.o.id)).size, nGroups: nG, kappa: +kappa.toFixed(2), cfg, prior, fireAt };
  if (rows.length < 5) return { ...empty(`too few fire-influenced observations (${rows.length})`), ...base, groups: groups.map((g, i) => ({ ...g, frp: Math.round(g.frp), s: 1, lo: 0.5, hi: 2, seen: seen[i] })) };
  // Gauss–Newton with step halving
  const Binv = 1 / cfg.sigmaB ** 2, x = new Float64Array(nG);
  const hOf = (r, xv) => { let h = 0; for (const g of r.nz) h += (Math.exp(xv[g]) - 1) * r.F[g]; return h; };
  const cost = xv => { let j = 0; for (const r of rows) j += (r.d - hOf(r, xv)) ** 2 / r.r; for (let g = 0; g < nG; g++) j += xv[g] * xv[g] * Binv; return 0.5 * j; };
  const normal = xv => { const A = Array.from({ length: nG }, (_, i) => { const a = new Float64Array(nG); a[i] = Binv; return a; }), b = new Float64Array(nG);
    for (const r of rows) { const res = r.d - hOf(r, xv), wi = 1 / r.r;
      for (const i of r.nz) { const Ki = Math.exp(xv[i]) * r.F[i]; b[i] += wi * Ki * res; for (const j of r.nz) A[i][j] += wi * Ki * Math.exp(xv[j]) * r.F[j]; } }
    for (let g = 0; g < nG; g++) b[g] -= Binv * xv[g]; return { A, b }; };
  let J = cost(x), it = 0;
  for (; it < cfg.maxIter; it++) {
    const { A, b } = normal(x), S = cholSolve(A, b, false); if (!S) break;
    let lam = 1, xn = null, Jn = Infinity;
    for (let h = 0; h < 8; h++, lam /= 2) { xn = x.map((v, g) => Math.max(-4, Math.min(4, v + lam * S.x[g]))); Jn = cost(xn); if (Jn <= J) break; }
    if (!(Jn <= J)) break;
    const dJ = J - Jn; x.set(xn); J = Jn; if (dJ < 1e-6 * Math.max(1, J)) { it++; break; }
  }
  // posterior covariance at the solution, DOFS, χ²
  const { A } = normal(x), Pst = cholSolve(A, new Float64Array(nG), true);
  const sdx = Pst ? Pst.diagInv.map(v => Math.sqrt(Math.max(v, 0))) : new Array(nG).fill(cfg.sigmaB);
  let dofs = 0; if (Pst) for (let g = 0; g < nG; g++) dofs += 1 - Pst.diagInv[g] * Binv;
  const chi2 = 2 * J / rows.length;
  const kappaNext = Math.exp(0.7 * Math.log(kappa) + 0.3 * Math.log(Math.min(cfg.kappaMax, Math.max(cfg.kappaMin, kappa * chi2))));
  let e0 = 0, e1 = 0, fp = 0, fq = 0; for (const r of rows) { const h = hOf(r, x); e0 += r.d ** 2; e1 += (r.d - h) ** 2; fp += r.Fs; fq += r.Fs + h; }
  const s = Array.from(x, Math.exp);
  // increment run: only the rescaled fires, each emitting (s − 1) × its prior amount (negative where s < 1; the model is linear)
  const incSrc = sources.map((src, i) => ({ src, f: s[srcG[i]] - 1 })).filter(q => Math.abs(q.f) > 0.01).map(q => ({ ...q.src, ef: (q.src.ef ?? 7.17) * q.f }));
  const inc = incSrc.length ? M.simulate(incSrc, W, simOpts) : null;
  const out = { ...base, status: 'ok', iterations: it, dofs: +dofs.toFixed(2), chi2: +chi2.toFixed(2), kappaNext: +kappaNext.toFixed(3),
    innovRmse: { before: +Math.sqrt(e0 / rows.length).toFixed(2), after: +Math.sqrt(e1 / rows.length).toFixed(2) },
    fireMean: { prior: +(fp / rows.length).toFixed(2), posterior: +(fq / rows.length).toFixed(2) }, nRescaled: incSrc.length,
    groups: groups.map((g, i) => ({ ...g, frp: Math.round(g.frp), s: +s[i].toFixed(3), lo: +Math.exp(x[i] - sdx[i]).toFixed(3), hi: +Math.exp(x[i] + sdx[i]).toFixed(3), seen: seen[i] })),
    inc, incAt: (lat, lon, t, kind = 'h') => simValue(inc, lat, lon, t, kind),
    // 24-h mean increment ending at tEnd24 on a regular grid {lon0, lat0, step, nx, ny}
    incGrid24: (G, tEnd24) => { if (!inc) return null; const outG = new Float64Array(G.nx * G.ny), k = Math.round((tEnd24 - inc.hours[0]) / 3600e3); let n = 0;
      for (let q = k - 23; q <= k; q++) if (q < inc.snaps.length) n++;
      if (n < 18) return null; for (let q = k - 23; q <= k; q++) if (q >= 0 && q < inc.snaps.length) splat(inc.snaps[q], G, outG, 1 / 24); return outG; } };
  out.ms = Date.now() - t0;
  log(`fire assimilation: ${out.nObs} obs at ${out.nStations} stations, ${nG} fire groups (${incSrc.length} sources rescaled), DOFS ${out.dofs}, χ²/m ${out.chi2} (κ ${kappa.toFixed(2)} → ${out.kappaNext}), innovation RMSE ${out.innovRmse.before} → ${out.innovRmse.after} µg/m³, ${it} iterations, ${out.ms} ms`);
  return out;
}
// what goes into latest.json
export function assimSummary(a) {
  if (!a) return null; const { prior, inc, incAt, fireAt, incGrid24, cfg, ...rest } = a;
  return { ...rest, cfg: cfg ? { groupDeg: cfg.groupDeg, sigmaB: +cfg.sigmaB.toFixed(3), sigmaMin: cfg.sigmaMin, rel: cfg.rel, epsModel: cfg.epsModel, minF: cfg.minF, windowH: cfg.windowH } : null };
}

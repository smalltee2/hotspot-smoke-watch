// Live forecast only: 2-m temperature downscaled from the ECMWF IFS grid (met.json) to 0.025°.
//   1. terrain: T(x) = interp( T_node + Γ·z_node ) − Γ·z(x)     Γ = 6.5 °C/km (standard-atmosphere lapse rate),
//      z_node = the height Open-Meteo reports for each node (its t2 already refers to that height), z(x) = 0.025° DEM.
//   2. stations: residual r = T_obs − T_terrain at Air4Thai stations over the last 24 h, as two kriged fields:
//      mean residual (systematic: valley inversions, urban heat, model bias) kept at every lead, and the latest residual
//      minus that mean (today's weather) faded with lead, e-folding 6 h. Both fade to 0 far from stations (krigeField).
//   3. verification: each station left out in turn, latest hour, ECMWF bilinear vs terrain vs terrain + stations.
import { krigeField, declusterWeights } from './rk.mjs';

// Air4Thai TEMP is an hourly mean ending at t; ECMWF temperature_2m is instantaneous: the model is read at t − 30 min (obsOffsetMs).
// The mean residual is kept in two bins, day (07–18 Thai time) and night, because valley inversions make the night residual differ.
export const T2CFG = { lapse: 6.5e-3, efoldH: 6, step: 0.1, windowH: 48, minObs: 6, maxAbsResid: 12, demStep: 0.025, obsOffsetMs: 1800e3,
                       bins: { day: h => h >= 7 && h < 19, night: h => h < 7 || h >= 19 }, north: [96.5, 14.5, 102.5, 21.5] };
export const t2Bin = t => (T2CFG.bins.day(new Date(t + 7 * 3600e3).getUTCHours()) ? 'day' : 'night');

// sea-level-equivalent temperature T + Γ·z, bilinear in space on the finest grid that contains the point, linear in time
export function t2SeaLevel(M, lat, lon, t, lapse = T2CFG.lapse) {
  const T = M.times, nt = T.length;
  let ft = (t - T[0]) / 3600e3; ft = Math.min(Math.max(ft, 0), nt - 1.0001);
  const it = Math.floor(ft), at = ft - it;
  for (const g of M.grids) {
    let fx = (lon - g.lon0) / g.step, fy = (lat - g.lat0) / g.step;
    const inside = fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1;
    if (!inside && g !== M.grids[M.grids.length - 1]) continue;
    fx = Math.min(Math.max(fx, 0), g.nx - 1.0001); fy = Math.min(Math.max(fy, 0), g.ny - 1.0001);
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, nxy = g.nx * g.ny, a = g.data.t2, z = g.elev;
    const P = [[iy * g.nx + ix, (1 - ax) * (1 - ay)], [iy * g.nx + ix + 1, ax * (1 - ay)], [(iy + 1) * g.nx + ix, (1 - ax) * ay], [(iy + 1) * g.nx + ix + 1, ax * ay]];
    let s = 0;
    for (const [dt, wt] of [[0, 1 - at], [1, at]]) { const b = (it + dt) * nxy; for (const [p, w] of P) s += wt * w * (a[b + p] + lapse * (z ? z[p] : 0)); }
    return s;
  }
  return null;
}

// plain bilinear t2 (what the page showed before), for the verification
function t2Bilinear(M, lat, lon, t, sampleMet) { return sampleMet(M, lat, lon, t)?.t2 ?? null; }

// obsRows: [{ id, lat, lon, rows: [[t_ms, t2_degC], ...] }], dem: { lon0, lat0, step, nx, ny, values } (m), now: ms
export function downscaleT2(M, dem, obsRows, now, { sampleMet, sampleGrid, log = console.log, cfg = T2CFG } = {}) {
  if (!M?.grids?.[0]?.elev) { log('t2 downscaling: met nodes have no heights yet (next met refresh)'); return null; }
  const zAt = (lat, lon) => (dem ? sampleGrid(dem, lat, lon) : null) ?? 0;
  const st = [], K16 = { K: 16, declusterDeg: 0.25 }, BINS = ['day', 'night'];
  for (const s of obsRows) {
    const z = zAt(s.lat, s.lon), res = [];
    for (const [t, To] of s.rows) {
      if (t < now - cfg.windowH * 3600e3 || t > now || To == null || !isFinite(To)) continue;
      const Tm = t2SeaLevel(M, s.lat, s.lon, t - cfg.obsOffsetMs, cfg.lapse); if (Tm == null) continue;
      const r = To - (Tm - cfg.lapse * z); if (Math.abs(r) > cfg.maxAbsResid) continue;   // a broken sensor or a wrong station position
      res.push([t, r, To, t2Bin(t)]);
    }
    const mean = {}; for (const b of BINS) { const rb = res.filter(x => x[3] === b); if (rb.length >= cfg.minObs) mean[b] = rb.reduce((a, x) => a + x[1], 0) / rb.length; }
    const last = res[res.length - 1];
    if (!last || now - last[0] > 3 * 3600e3 || mean[last[3]] == null) continue;
    st.push({ id: s.id, lat: s.lat, lon: s.lon, z, mean, tLast: last[0], rLast: last[1], TLast: last[2], binLast: last[3], n: res.length, res });
  }
  if (st.length < 10) { log(`t2 downscaling: only ${st.length} stations with ≥ ${cfg.minObs} h of temperature per bin, station correction skipped`); return { stations: st.length, fields: null }; }
  const tA = Math.max(...st.map(s => s.tLast));
  const lats = st.map(s => s.lat), lons = st.map(s => s.lon), pad = 3.6;   // krigeField fades to 0 within ≤ 400 km
  const W = Math.floor((Math.min(...lons) - pad) / cfg.step) * cfg.step, S = Math.floor((Math.min(...lats) - pad) / cfg.step) * cfg.step;
  const E = Math.ceil((Math.max(...lons) + pad) / cfg.step) * cfg.step, N = Math.ceil((Math.max(...lats) + pad) / cfg.step) * cfg.step;
  const spec = { lon0: +W.toFixed(4), lat0: +S.toFixed(4), step: cfg.step, nx: Math.round((E - W) / cfg.step) + 1, ny: Math.round((N - S) / cfg.step) + 1 };
  const pts = b => st.filter(s => s.mean[b] != null).map(s => ({ lat: s.lat, lon: s.lon, y: s.mean[b] }));
  const fMean = {}; for (const b of BINS) fMean[b] = krigeField(pts(b), spec, K16);
  const fAnom = krigeField(st.map(s => ({ lat: s.lat, lon: s.lon, y: s.rLast - s.mean[s.binLast] })), spec, K16);
  if (!fMean.day || !fMean.night || !fAnom) return { stations: st.length, fields: null };

  // verification, each station left out in turn (fields refitted from the other stations):
  //   all station-hours of the window, per bin: ECMWF bilinear, terrain, terrain + kriged mean residual of the others
  //   latest hour: terrain + mean, and + latest anomaly of the others
  // errors are weighted by the stations' decluster weights (the Bangkok cluster otherwise dominates) and also reported for the north box;
  // each part of the station correction is published only if it lowers the weighted left-out error in this run
  const wD = declusterWeights(st.map(s => [s.lat, s.lon]), 0.25), inN = s => s.lat >= cfg.north[1] && s.lat <= cfg.north[3] && s.lon >= cfg.north[0] && s.lon <= cfg.north[2];
  const Er = {}, L = { terrain: [], mean: [], anom: [] }; for (const b of BINS) Er[b] = { ecmwf: [], terrain: [], mean: [] };
  for (let i = 0; i < st.length; i++) {
    const s = st[i], others = st.filter((_, j) => j !== i), one = { lon0: s.lon, lat0: s.lat, step: cfg.step, nx: 1, ny: 1 }, m = {};
    for (const b of BINS) m[b] = krigeField(others.filter(o => o.mean[b] != null).map(o => ({ lat: o.lat, lon: o.lon, y: o.mean[b] })), one, K16)?.values[0] ?? 0;
    const a = krigeField(others.map(o => ({ lat: o.lat, lon: o.lon, y: o.rLast - o.mean[o.binLast] })), one, K16)?.values[0] ?? 0;
    for (const [t, r, To, b] of s.res) { const Tb = t2Bilinear(M, s.lat, s.lon, t - cfg.obsOffsetMs, sampleMet); if (Tb != null) Er[b].ecmwf.push([Tb - To, wD[i], inN(s)]); Er[b].terrain.push([-r, wD[i], inN(s)]); Er[b].mean.push([m[b] - r, wD[i], inN(s)]); }
    const mb = m[s.binLast]; L.terrain.push([-s.rLast, wD[i], inN(s)]); L.mean.push([mb - s.rLast, wD[i], inN(s)]); L.anom.push([mb + a - s.rLast, wD[i], inN(s)]);
  }
  const stat = (e, northOnly = false) => { const E = northOnly ? e.filter(x => x[2]) : e; if (!E.length) return null; const W = E.reduce((a, x) => a + x[1], 0);
    return { rmse: +Math.sqrt(E.reduce((a, x) => a + x[1] * x[0] * x[0], 0) / W).toFixed(2), bias: +(E.reduce((a, x) => a + x[1] * x[0], 0) / W).toFixed(2), n: E.length }; };
  const cv = { n: st.length, nNorth: st.filter(inN).length, hour: new Date(tA).toISOString().slice(0, 13) + 'Z', bins: {}, north: {},
               latest: { terrain: stat(L.terrain), mean: stat(L.mean), anom: stat(L.anom) } };
  for (const b of BINS) { cv.bins[b] = { ecmwf: stat(Er[b].ecmwf), terrain: stat(Er[b].terrain), mean: stat(Er[b].mean) }; cv.north[b] = { ecmwf: stat(Er[b].ecmwf, true), terrain: stat(Er[b].terrain, true), mean: stat(Er[b].mean, true) }; }
  const use = { day: cv.bins.day.mean.rmse < cv.bins.day.terrain.rmse, night: cv.bins.night.mean.rmse < cv.bins.night.terrain.rmse };
  const binNow = t2Bin(tA), base = use[binNow] ? cv.latest.mean.rmse : cv.latest.terrain.rmse;
  use.anom = use[binNow] ? cv.latest.anom.rmse < base : false;
  cv.use = use; cv.useMean = use.day || use.night; cv.useAnom = use.anom;
  // compact all-hours numbers kept for the run log / page
  const all = k => stat([...Er.day[k], ...Er.night[k]]);
  cv.ecmwf = all('ecmwf'); cv.terrain = all('terrain'); cv.stations = stat([...(use.day ? Er.day.mean : Er.day.terrain), ...(use.night ? Er.night.mean : Er.night.terrain)]);
  const f2 = x => x ? `${x.rmse}/${x.bias}` : '–';
  log(`t2 downscaling: ${st.length} stations (${cv.nNorth} in the north box), mean residual day ${fMean.day.mean} / night ${fMean.night.mean} °C (range ${fMean.day.vario.a_km}/${fMean.night.vario.a_km} km); ` +
      `left-out RMSE/bias (declustered), all stations — day (${cv.bins.day.ecmwf.n} h): ECMWF ${f2(cv.bins.day.ecmwf)} → terrain ${f2(cv.bins.day.terrain)} → + station mean ${f2(cv.bins.day.mean)}; ` +
      `night (${cv.bins.night.ecmwf.n} h): ECMWF ${f2(cv.bins.night.ecmwf)} → terrain ${f2(cv.bins.night.terrain)} → + station mean ${f2(cv.bins.night.mean)} °C; ` +
      `north box — day ${f2(cv.north.day.ecmwf)} → ${f2(cv.north.day.terrain)} → ${f2(cv.north.day.mean)}, night ${f2(cv.north.night.ecmwf)} → ${f2(cv.north.night.terrain)} → ${f2(cv.north.night.mean)}; ` +
      `latest hour ${cv.hour} (${binNow}): terrain ${cv.latest.terrain.rmse}, + mean ${cv.latest.mean.rmse}, + anomaly ${cv.latest.anom.rmse} → station mean day ${use.day ? 'used' : 'not used'}, night ${use.night ? 'used' : 'not used'}, anomaly ${use.anom ? 'used' : 'not used'}`);
  if (!use.day && !use.night) return { stations: st.length, cv, file: null };

  // crop to cells that carry a correction, store ×100 as row differences (as rk-bias / ml-field)
  const { nx: fnx, ny: fny } = spec; let x0 = fnx, x1 = -1, y0 = fny, y1 = -1;
  for (const f of [fMean.day.values, fMean.night.values, fAnom.values]) for (let iy = 0; iy < fny; iy++) for (let ix = 0; ix < fnx; ix++) if (f[iy * fnx + ix] !== 0) { if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iy < y0) y0 = iy; if (iy > y1) y1 = iy; }
  if (x1 < 0) return { stations: st.length, cv, fields: null };
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, SC = 100;
  const enc = f => { const out = new Array(nx * ny); for (let iy = 0; iy < ny; iy++) { let prev = 0;
    for (let ix = 0; ix < nx; ix++) { const q = Math.round(Math.max(-cfg.maxAbsResid, Math.min(cfg.maxAbsResid, f[(iy + y0) * fnx + ix + x0])) * SC); out[iy * nx + ix] = q - prev; prev = q; } } return out; };
  const file = { tA, use, bins: 'day 07-18 Thai time, night otherwise', useMean: cv.useMean, useAnom: use.anom, lapse: cfg.lapse, efoldH: cfg.efoldH, lon0: +(spec.lon0 + x0 * cfg.step).toFixed(4), lat0: +(spec.lat0 + y0 * cfg.step).toFixed(4), step: cfg.step, nx, ny,
                 enc: 'int-dx', scale: SC, meanDay: enc(fMean.day.values), meanNight: enc(fMean.night.values), anom: enc(fAnom.values), cv,
                 stations: st.map(s => [s.id, +s.lat.toFixed(4), +s.lon.toFixed(4), +(s.mean.day ?? NaN).toFixed(2), +(s.mean.night ?? NaN).toFixed(2), +(s.rLast - s.mean[s.binLast]).toFixed(2)]) };
  return { stations: st.length, cv, file };
}

// elevation grid stored as integers (m) with row differences; the page undoes it
export function packDEM(d) {
  const out = new Array(d.nx * d.ny);
  for (let iy = 0; iy < d.ny; iy++) { let prev = 0; for (let ix = 0; ix < d.nx; ix++) { const q = Math.round(d.values[iy * d.nx + ix]); out[iy * d.nx + ix] = q - prev; prev = q; } }
  return { lon0: d.lon0, lat0: d.lat0, step: d.step, nx: d.nx, ny: d.ny, enc: 'int-dx', values: out, source: d.source, key: d.key };
}

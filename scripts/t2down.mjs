// Live forecast only: 2-m temperature downscaled from the ECMWF IFS grid (met.json) to 0.025°.
//   1. terrain: T(x) = interp( T_node + Γ·z_node ) − Γ·z(x)     Γ = 6.5 °C/km (standard-atmosphere lapse rate),
//      z_node = the height Open-Meteo reports for each node (its t2 already refers to that height), z(x) = 0.025° DEM.
//   2. stations: residual r = T_obs − T_terrain at Air4Thai stations over the last 24 h, as two kriged fields:
//      mean residual (systematic: valley inversions, urban heat, model bias) kept at every lead, and the latest residual
//      minus that mean (today's weather) faded with lead, e-folding 6 h. Both fade to 0 far from stations (krigeField).
//   3. verification: each station left out in turn, latest hour, ECMWF bilinear vs terrain vs terrain + stations.
import { krigeField } from './rk.mjs';

export const T2CFG = { lapse: 6.5e-3, efoldH: 6, step: 0.1, windowH: 24, minObs: 12, maxAbsResid: 8, demStep: 0.025 };

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
  const st = [];
  for (const s of obsRows) {
    const z = zAt(s.lat, s.lon), res = [];
    for (const [t, To] of s.rows) {
      if (t < now - cfg.windowH * 3600e3 || t > now || To == null || !isFinite(To)) continue;
      const Tm = t2SeaLevel(M, s.lat, s.lon, t, cfg.lapse); if (Tm == null) continue;
      const r = To - (Tm - cfg.lapse * z); if (Math.abs(r) > cfg.maxAbsResid) continue;   // a broken sensor or a wrong station position
      res.push([t, r, To]);
    }
    if (res.length < cfg.minObs) continue;
    const mean = res.reduce((a, x) => a + x[1], 0) / res.length, last = res[res.length - 1];
    if (now - last[0] > 3 * 3600e3) continue;
    st.push({ id: s.id, lat: s.lat, lon: s.lon, z, mean, tLast: last[0], rLast: last[1], TLast: last[2], n: res.length, res });
  }
  if (st.length < 10) { log(`t2 downscaling: only ${st.length} stations with ≥ ${cfg.minObs} h of temperature, station correction skipped`); return { stations: st.length, fields: null }; }
  const tA = Math.max(...st.map(s => s.tLast));
  const lats = st.map(s => s.lat), lons = st.map(s => s.lon), pad = 3.6;   // krigeField fades to 0 within ≤ 400 km
  const W = Math.floor((Math.min(...lons) - pad) / cfg.step) * cfg.step, S = Math.floor((Math.min(...lats) - pad) / cfg.step) * cfg.step;
  const E = Math.ceil((Math.max(...lons) + pad) / cfg.step) * cfg.step, N = Math.ceil((Math.max(...lats) + pad) / cfg.step) * cfg.step;
  const spec = { lon0: +W.toFixed(4), lat0: +S.toFixed(4), step: cfg.step, nx: Math.round((E - W) / cfg.step) + 1, ny: Math.round((N - S) / cfg.step) + 1 };
  const fMean = krigeField(st.map(s => ({ lat: s.lat, lon: s.lon, y: s.mean })), spec, { K: 16, declusterDeg: 0.25 });
  const fAnom = krigeField(st.map(s => ({ lat: s.lat, lon: s.lon, y: s.rLast - s.mean })), spec, { K: 16, declusterDeg: 0.25 });
  if (!fMean || !fAnom) return { stations: st.length, fields: null };

  // verification, each station left out in turn:
  //   all station-hours of the last 24 h: ECMWF bilinear, terrain, terrain + kriged mean residual of the other stations
  //   latest hour: terrain + mean, and + latest anomaly of the other stations
  // each part of the station correction is published only if it lowers the left-out error in this run
  const Er = { ecmwf: [], terrain: [], mean: [] }, L = { terrain: [], mean: [], anom: [] };
  for (let i = 0; i < st.length; i++) {
    const s = st[i], others = st.filter((_, j) => j !== i), one = { lon0: s.lon, lat0: s.lat, step: cfg.step, nx: 1, ny: 1 };
    const m = krigeField(others.map(o => ({ lat: o.lat, lon: o.lon, y: o.mean })), one, { K: 16, declusterDeg: 0.25 })?.values[0] ?? 0;
    const a = krigeField(others.map(o => ({ lat: o.lat, lon: o.lon, y: o.rLast - o.mean })), one, { K: 16, declusterDeg: 0.25 })?.values[0] ?? 0;
    for (const [t, r, To] of s.res) { const Tb = t2Bilinear(M, s.lat, s.lon, t, sampleMet); if (Tb != null) Er.ecmwf.push(Tb - To); Er.terrain.push(-r); Er.mean.push(m - r); }
    L.terrain.push(-s.rLast); L.mean.push(m - s.rLast); L.anom.push(m + a - s.rLast);
  }
  const stat = e => ({ rmse: +Math.sqrt(e.reduce((a, x) => a + x * x, 0) / e.length).toFixed(2), bias: +(e.reduce((a, x) => a + x, 0) / e.length).toFixed(2), n: e.length });
  const cv = { n: st.length, hour: new Date(tA).toISOString().slice(0, 13) + 'Z', h24: { ecmwf: stat(Er.ecmwf), terrain: stat(Er.terrain), mean: stat(Er.mean) },
               latest: { terrain: stat(L.terrain), mean: stat(L.mean), anom: stat(L.anom) } };
  const useMean = cv.h24.mean.rmse < cv.h24.terrain.rmse, base = useMean ? cv.latest.mean.rmse : cv.latest.terrain.rmse;
  const useAnom = useMean ? cv.latest.anom.rmse < base : false;
  cv.useMean = useMean; cv.useAnom = useAnom;
  // compact numbers kept for the run log / page
  cv.ecmwf = cv.h24.ecmwf; cv.terrain = cv.h24.terrain; cv.stations = useMean ? cv.h24.mean : cv.h24.terrain;
  log(`t2 downscaling: ${st.length} stations, mean residual ${fMean.mean} °C (range ${fMean.vario.a_km} km); left-out RMSE/bias, ${cv.h24.ecmwf.n} station-hours: ` +
      `ECMWF ${cv.h24.ecmwf.rmse}/${cv.h24.ecmwf.bias} → terrain ${cv.h24.terrain.rmse}/${cv.h24.terrain.bias} → + station mean ${cv.h24.mean.rmse}/${cv.h24.mean.bias} °C; ` +
      `latest hour ${cv.hour}: terrain ${cv.latest.terrain.rmse}, + mean ${cv.latest.mean.rmse}, + anomaly ${cv.latest.anom.rmse} °C → station mean ${useMean ? 'used' : 'not used'}, anomaly ${useAnom ? 'used' : 'not used'}`);
  if (!useMean) return { stations: st.length, cv, file: null };

  // crop to cells that carry a correction, store ×100 as row differences (as rk-bias / ml-field)
  const { nx: fnx, ny: fny } = spec; let x0 = fnx, x1 = -1, y0 = fny, y1 = -1;
  for (const f of [fMean.values, fAnom.values]) for (let iy = 0; iy < fny; iy++) for (let ix = 0; ix < fnx; ix++) if (f[iy * fnx + ix] !== 0) { if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iy < y0) y0 = iy; if (iy > y1) y1 = iy; }
  if (x1 < 0) return { stations: st.length, cv, fields: null };
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, SC = 100;
  const enc = f => { const out = new Array(nx * ny); for (let iy = 0; iy < ny; iy++) { let prev = 0;
    for (let ix = 0; ix < nx; ix++) { const q = Math.round(Math.max(-cfg.maxAbsResid, Math.min(cfg.maxAbsResid, f[(iy + y0) * fnx + ix + x0])) * SC); out[iy * nx + ix] = q - prev; prev = q; } } return out; };
  const file = { tA, useMean, useAnom, lapse: cfg.lapse, efoldH: cfg.efoldH, lon0: +(spec.lon0 + x0 * cfg.step).toFixed(4), lat0: +(spec.lat0 + y0 * cfg.step).toFixed(4), step: cfg.step, nx, ny,
                 enc: 'int-dx', scale: SC, mean: enc(fMean.values), anom: enc(fAnom.values), cv,
                 stations: st.map(s => [s.id, +s.lat.toFixed(4), +s.lon.toFixed(4), +s.mean.toFixed(2), +(s.rLast - s.mean).toFixed(2)]) };
  return { stations: st.length, cv, file };
}

// elevation grid stored as integers (m) with row differences; the page undoes it
export function packDEM(d) {
  const out = new Array(d.nx * d.ny);
  for (let iy = 0; iy < d.ny; iy++) { let prev = 0; for (let ix = 0; ix < d.nx; ix++) { const q = Math.round(d.values[iy * d.nx + ix]); out[iy * d.nx + ix] = q - prev; prev = q; } }
  return { lon0: d.lon0, lat0: d.lat0, step: d.step, nx: d.nx, ny: d.ny, enc: 'int-dx', values: out, source: d.source, key: d.key };
}

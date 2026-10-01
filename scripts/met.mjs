// Meteorology for the dispersion model and the regression kriging, fetched once every few hours
// from Open-Meteo with a fixed model (ECMWF IFS HRES, 9 km) so runs are reproducible.
// Two nested grids: fine over northern Thailand, coarse over the whole domain.
// Stored per grid as flat arrays [time][iy][ix] for: u, v (100 m wind, m/s), blh (m), cls (Pasquill–Gifford class ×2), pr (mm/h).

export const MET_MODEL = 'ecmwf_ifs';
const VARS = 'wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,shortwave_radiation,cloud_cover,precipitation';
const DEG = Math.PI / 180;

// Pasquill–Gifford class (1=A … 6=F) from 10 m wind, insolation and cloud, after Turner (1970). Same as the page.
export function pgClass(u, sw, cc) {
  if (cc >= 90) return 4;   // overcast: neutral (D) day or night, Turner (1970)
  if (sw > 10) {
    const ins = sw > 600 ? 0 : sw > 300 ? 1 : 2;
    const T = [[1, 1.5, 2], [1.5, 2, 3], [2, 2.5, 3], [3, 3.5, 4], [3, 4, 4]];
    return T[u < 2 ? 0 : u < 3 ? 1 : u < 5 ? 2 : u < 6 ? 3 : 4][ins];
  }
  const cloudy = cc >= 50;
  if (u < 2) return 6; if (u < 3) return cloudy ? 5 : 6; if (u < 5) return cloudy ? 4 : 5; return 4;
}

export async function fetchMet(grids, { get, sleep, log, pastDays = 2, forecastDays = 4, keepFrom, keepTo }) {
  const out = { model: MET_MODEL, fetched: Date.now(), vars: ['u', 'v', 'blh', 'cls', 'pr'], times: null, grids: [] };
  for (const gs of grids) {
    const nx = Math.round((gs.bbox[2] - gs.bbox[0]) / gs.step) + 1, ny = Math.round((gs.bbox[3] - gs.bbox[1]) / gs.step) + 1;
    const pts = []; for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) pts.push([gs.bbox[1] + iy * gs.step, gs.bbox[0] + ix * gs.step]);
    const per = [];
    for (let i = 0; i < pts.length; i += 100) {
      const c = pts.slice(i, i + 100);
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.map(p => p[0].toFixed(3)).join(',')}&longitude=${c.map(p => p[1].toFixed(3)).join(',')}` +
        `&hourly=${VARS}&models=${MET_MODEL}&wind_speed_unit=ms&timeformat=unixtime&timezone=GMT&past_days=${pastDays}&forecast_days=${forecastDays}`;
      let js = await (await get(url)).json(); if (!Array.isArray(js)) js = [js];
      for (const o of js) { if (!out.times) out.times = o.hourly.time.map(s => s * 1000); per.push(o.hourly); }
      if (i + 100 < pts.length) await sleep(12000); // ≤ 500 locations/min
    }
    // keep the useful time window
    const T = out.times, a = Math.max(0, T.findIndex(t => t >= keepFrom)), b = keepTo ? Math.max(a + 1, T.findLastIndex(t => t <= keepTo) + 1) : T.length, nt = b - a;
    const N = nt * nx * ny, d = { u: new Array(N), v: new Array(N), blh: new Array(N), cls: new Array(N), pr: new Array(N) };
    let missBLH = 0;
    for (let p = 0; p < pts.length; p++) {
      const h = per[p];
      for (let k = 0; k < nt; k++) {
        const t = a + k, i = k * nx * ny + p;
        const ws = h.wind_speed_100m?.[t] ?? h.wind_speed_10m?.[t] ?? 2, wd = (h.wind_direction_100m?.[t] ?? h.wind_direction_10m?.[t] ?? 0) * DEG;
        d.u[i] = Math.round(-ws * Math.sin(wd) * 10) / 10; d.v[i] = Math.round(-ws * Math.cos(wd) * 10) / 10;
        const sw = h.shortwave_radiation?.[t] ?? 0, blh = h.boundary_layer_height?.[t];
        if (blh == null) missBLH++;
        d.blh[i] = Math.round((blh ?? (sw > 50 ? 1500 : 300)) / 10) * 10;
        d.cls[i] = Math.round(pgClass(h.wind_speed_10m?.[t] ?? ws * 0.7, sw, h.cloud_cover?.[t] ?? 50) * 2);
        d.pr[i] = Math.round((h.precipitation?.[t] ?? 0) * 10) / 10;
      }
    }
    out.times = T; out.grids.push({ lon0: gs.bbox[0], lat0: gs.bbox[1], step: gs.step, nx, ny, a, nt, data: d });
    log(`met ${gs.name}: ${pts.length} points × ${nt} h at ${gs.step}° (${MET_MODEL})${missBLH ? `, BLH missing in ${missBLH} values (filled)` : ''}`);
  }
  // all grids share one time axis window: use the first grid's
  const g0 = out.grids[0]; out.times = out.times.slice(g0.a, g0.a + g0.nt);
  for (const g of out.grids) { delete g.a; delete g.nt; }
  return out;
}

// bilinear in space, linear in time, finest grid that contains the point
export function sampleMet(M, lat, lon, t) {
  const T = M.times, nt = T.length;
  let ft = (t - T[0]) / 3600e3; ft = Math.min(Math.max(ft, 0), nt - 1.0001);
  const it = Math.floor(ft), at = ft - it;
  for (const g of M.grids) {
    let fx = (lon - g.lon0) / g.step, fy = (lat - g.lat0) / g.step;
    const inside = fx >= 0 && fy >= 0 && fx <= g.nx - 1 && fy <= g.ny - 1;
    if (!inside && g !== M.grids[M.grids.length - 1]) continue;
    fx = Math.min(Math.max(fx, 0), g.nx - 1.0001); fy = Math.min(Math.max(fy, 0), g.ny - 1.0001);
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy, nxy = g.nx * g.ny, o = {};
    for (const k of M.vars) { const a = g.data[k]; let s = 0;
      for (const [dt, wt] of [[0, 1 - at], [1, at]]) { const b = (it + dt) * nxy;
        s += wt * ((1 - ax) * (1 - ay) * a[b + iy * g.nx + ix] + ax * (1 - ay) * a[b + iy * g.nx + ix + 1] + (1 - ax) * ay * a[b + (iy + 1) * g.nx + ix] + ax * ay * a[b + (iy + 1) * g.nx + ix + 1]); }
      o[k] = s; }
    o.cls /= 2; o.ws = Math.hypot(o.u, o.v);
    return o;
  }
}

// Compact copy for the web page: same values (already rounded to 0.1 m/s, 10 m, 0.1 mm/h), stored as integers and
// as differences from the previous hour at the same grid point, which gzip compresses well. Trimmed to [from, to].
export const MET_SCALE = { u: 10, v: 10, blh: 0.1, cls: 1, pr: 10 };
export function packMet(M, from, to) {
  const T = M.times, a = Math.max(0, T.findIndex(t => t >= from)), b = Math.max(a + 1, T.findLastIndex(t => t <= to) + 1), nt = b - a;
  const grids = M.grids.map(g => {
    const n = g.nx * g.ny, data = {};
    for (const k of M.vars) {
      const src = g.data[k], sc = MET_SCALE[k] ?? 1, out = new Array(nt * n);
      for (let t = 0; t < nt; t++) for (let p = 0; p < n; p++) {
        const q = Math.round(src[(a + t) * n + p] * sc);
        out[t * n + p] = t ? q - Math.round(src[(a + t - 1) * n + p] * sc) : q;
      }
      data[k] = out;
    }
    return { lon0: g.lon0, lat0: g.lat0, step: g.step, nx: g.nx, ny: g.ny, data };
  });
  return { model: M.model, fetched: M.fetched, vars: M.vars, enc: 'int-dt', scale: MET_SCALE, times: T.slice(a, b), grids };
}
export function unpackMet(P) {
  if (P.enc !== 'int-dt') return P;
  const nt = P.times.length;
  for (const g of P.grids) { const n = g.nx * g.ny;
    for (const k of P.vars) { const d = g.data[k], sc = P.scale[k] ?? 1, out = new Float64Array(d.length);
      for (let p = 0; p < n; p++) { let q = 0; for (let t = 0; t < nt; t++) { q += d[t * n + p]; out[t * n + p] = q / sc; } }
      g.data[k] = out; } }
  delete P.enc; return P;
}

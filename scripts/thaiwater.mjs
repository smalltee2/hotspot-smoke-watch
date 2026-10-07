// Independent check of the observed-rain layer against Thai rain gauges (live forecast only).
// ThaiWater (HAII) public API, latest reading per station: rain_1h (mm in the hour ending at rainfall_datetime, Thai time).
// Each run stores the newest hourly gauge values; once GSMaP has that hour, the gauges are compared with
//   (a) GSMaP 0.1° cell, (b) GSMaP interpolated bilinearly, (c) (b) × the CHELSA rain-pattern factor (the page's 0.025° rain).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { unpack, GSCFG } from './gsmap.mjs';

const URL_ = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h', HOUR = 3600e3;
function findLatLon(o, depth = 0) {
  let lat = null, lon = null;
  if (!o || typeof o !== 'object' || depth > 3) return [lat, lon];
  for (const [k, v] of Object.entries(o)) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n === 'number' && isFinite(n)) { if (lat == null && /lat/i.test(k) && n > 0 && n < 30) lat = n; if (lon == null && /lon|long/i.test(k) && n > 90 && n < 115) lon = n; }
  }
  if (lat == null || lon == null) for (const v of Object.values(o)) if (v && typeof v === 'object') { const [a, b] = findLatLon(v, depth + 1); lat ??= a; lon ??= b; if (lat != null && lon != null) break; }
  return [lat, lon];
}

// store: { [hourStartUTCms]: [[lat, lon, mm], ...] }
export async function fetchGauges(store, now, { get, log = console.log } = {}) {
  store ||= {};
  for (const k of Object.keys(store)) if (+k < now - 48 * HOUR) delete store[k];   // 48 h: the daily archive of yesterday needs ~34 h
  let js; try { js = await (await get(URL_)).json(); } catch (e) { log(`ThaiWater rain: ${e.message}`); return store; }
  const rows = Array.isArray(js?.data) ? js.data : [];
  let n = 0;
  for (const r of rows) {
    const mm = parseFloat(r.rain_1h), dt = r.rainfall_datetime; if (!isFinite(mm) || mm < 0 || mm > 200 || !dt) continue;
    const dm = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(dt), tEnd = dm && dm[3] === '00' ? Date.parse(`${dm[1]}T${dm[2]}:00:00+07:00`) : NaN;   // whole hours only (rain_1h = the hour ending then) if (!isFinite(tEnd) || now - tEnd > 6 * HOUR) continue;
    const [lat, lon] = findLatLon(r); if (lat == null) continue;
    const t0 = tEnd - HOUR; (store[t0] ||= []); if (store[t0].length < 5000 && !store[t0].some(g => g[0] === +lat.toFixed(4) && g[1] === +lon.toFixed(4))) { store[t0].push([+lat.toFixed(4), +lon.toFixed(4), +mm.toFixed(1)]); n++; }
  }
  log(`ThaiWater rain: ${rows.length} stations listed, ${n} new hourly readings stored`);
  return store;
}

const facCache = {};
async function factor(dataDir, m) {
  const k = String(m).padStart(2, '0'); if (k in facCache) return facCache[k];
  try { const meta = JSON.parse(await fs.readFile(path.join(dataDir, 'static', 'prclim', 'meta.json'), 'utf8'));
    facCache[k] = { meta, f: zlib.inflateSync(await fs.readFile(path.join(dataDir, 'static', 'prclim', meta.files[k]))) }; } catch { facCache[k] = null; }
  return facCache[k];
}

// score every stored gauge hour that GSMaP now covers and that has not been scored; returns summary rows
export async function scoreGauges(store, gcache, dataDir, scored = {}) {
  const c = GSCFG, out = [];
  for (const [k, G] of Object.entries(store || {})) {
    const h = gcache?.hours?.[k]; if (!h || scored[k] === h.src) continue;
    const a = unpack(h.d), F = await factor(dataDir, new Date(+k + 7 * HOUR).getUTCMonth() + 1), e = { cell: [], bil: [], fine: [] }, ob = [];
    for (const [lat, lon, mm] of G) {
      const fx = (lon - c.lon0) / 0.1, fy = (lat - c.lat0) / 0.1, xi = Math.round(fx), yi = Math.round(fy);
      if (xi < 0 || yi < 0 || xi >= c.nx || yi >= c.ny) continue;
      const cell = a[yi * c.nx + xi]; if (cell < 0) continue;
      const x0 = Math.max(0, Math.min(c.nx - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(c.ny - 2, Math.floor(fy))), ax = fx - x0, ay = fy - y0;
      let s = 0, w = 0; for (const [dx, dy, wt] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) { const q = a[(y0 + dy) * c.nx + x0 + dx]; if (q >= 0) { s += wt * q; w += wt; } }
      const bil = w ? s / w / 10 : cell / 10;
      let fac = 1; if (F) { const M = F.meta, ix = Math.round((lon - M.lon0) / M.step), iy = Math.round((lat - M.lat0) / M.step); if (ix >= 0 && iy >= 0 && ix < M.nx && iy < M.ny) fac = F.f[iy * M.nx + ix] / 50; }
      ob.push(mm); e.cell.push(cell / 10); e.bil.push(bil); e.fine.push(bil * fac);
    }
    if (ob.length < 30) continue;
    const st = p => { const n = ob.length, mo = ob.reduce((x, y) => x + y, 0) / n, mp = p.reduce((x, y) => x + y, 0) / n; let cv = 0, vo = 0, vp = 0, se = 0;
      for (let i = 0; i < n; i++) { cv += (p[i] - mp) * (ob[i] - mo); vo += (ob[i] - mo) ** 2; vp += (p[i] - mp) ** 2; se += (p[i] - ob[i]) ** 2; }
      return [+Math.sqrt(se / n).toFixed(3), vo && vp ? +(cv / Math.sqrt(vo * vp)).toFixed(3) : null, +(mp - mo).toFixed(3)]; };
    // timing check: interpolated GSMaP of the neighbouring hours against the same gauge readings
    const lag = {};
    for (const L of [-2, -1, 1, 2]) { const hL = gcache.hours[+k + L * HOUR]; if (!hL) continue; const aL = unpack(hL.d), p = [], o = [];
      for (const [lat, lon, mm] of G) { const xi = Math.round((lon - c.lon0) / 0.1), yi = Math.round((lat - c.lat0) / 0.1); if (xi < 0 || yi < 0 || xi >= c.nx || yi >= c.ny) continue; const q = aL[yi * c.nx + xi]; if (q < 0) continue; p.push(q / 10); o.push(mm); }
      if (p.length > 30) { const n = p.length, mp = p.reduce((x, y) => x + y, 0) / n, mo = o.reduce((x, y) => x + y, 0) / n; let cv = 0, vp = 0, vo = 0; for (let i = 0; i < n; i++) { cv += (p[i] - mp) * (o[i] - mo); vp += (p[i] - mp) ** 2; vo += (o[i] - mo) ** 2; } lag[L] = vp && vo ? +(cv / Math.sqrt(vp * vo)).toFixed(3) : null; } }
    out.push({ hour: new Date(+k).toISOString().slice(0, 13) + 'Z', src: h.src, n: ob.length, wet: ob.filter(v => v >= 0.5).length, cell: st(e.cell), bil: st(e.bil), fine: st(e.fine), lag });   // lag: cell r with GSMaP shifted, by this hour's src (now/nrt)
    scored[k] = h.src;
  }
  return out;
}

// GSMaP at a point for the hour starting tStart: 0.1° cell, bilinear, bilinear × CHELSA factor (the page's 0.025° value); null if not held
export async function gsmapAt(gcache, dataDir, lat, lon, tStart) {
  const h = gcache?.hours?.[tStart]; if (!h) return null;
  const c = GSCFG, a = h._a || (h._a = unpack(h.d)), fx = (lon - c.lon0) / 0.1, fy = (lat - c.lat0) / 0.1, xi = Math.round(fx), yi = Math.round(fy);
  if (xi < 0 || yi < 0 || xi >= c.nx || yi >= c.ny) return null;
  const cell = a[yi * c.nx + xi]; if (cell < 0) return null;
  const x0 = Math.max(0, Math.min(c.nx - 2, Math.floor(fx))), y0 = Math.max(0, Math.min(c.ny - 2, Math.floor(fy))), ax = fx - x0, ay = fy - y0;
  let s = 0, w = 0; for (const [dx, dy, wt] of [[0, 0, (1 - ax) * (1 - ay)], [1, 0, ax * (1 - ay)], [0, 1, (1 - ax) * ay], [1, 1, ax * ay]]) { const q = a[(y0 + dy) * c.nx + x0 + dx]; if (q >= 0) { s += wt * q; w += wt; } }
  const bil = w ? s / w / 10 : cell / 10, F = await factor(dataDir, new Date(tStart + 7 * HOUR).getUTCMonth() + 1);
  let fac = 1; if (F) { const M = F.meta, ix = Math.round((lon - M.lon0) / M.step), iy = Math.round((lat - M.lat0) / M.step); if (ix >= 0 && iy >= 0 && ix < M.nx && iy < M.ny) fac = F.f[iy * M.nx + ix] / 50; }
  return { cell: cell / 10, bil: +bil.toFixed(2), fine: +(bil * fac).toFixed(2), src: h.src };
}

// the month's CHELSA rain-pattern factor at a point (1 where there is no file), same lookup as the page
export async function rainFactor(dataDir, lat, lon, t) {
  const F = await factor(dataDir, new Date(t + 7 * HOUR).getUTCMonth() + 1); if (!F) return 1;
  const M = F.meta, ix = Math.round((lon - M.lon0) / M.step), iy = Math.round((lat - M.lat0) / M.step);
  return ix >= 0 && iy >= 0 && ix < M.nx && iy < M.ny ? F.f[iy * M.nx + ix] / 50 : 1;
}

// Live forecast only: observed rain from Google DeepMind PARDIG (global satellite precipitation, 0.1°, every 15 min, CC BY 4.0),
// read anonymously from the public bucket gs://pardig_1 (no key):
//   NRT/zarr/2026_to_present/<YYYYMMDDTHHMMSS>/predictions.zarr/precipitation/c/0/0
//   one Zarr v3 store per 15-min frame; one zstd chunk 1801 × 3600 float32, lat −90..90 (row 0 = 90° S), lon 0..359.9,
//   "Precipitation rate at the valid time" in m/h (instantaneous); about 4–5 h behind real time (2–8 h per the provider).
// Evaluated against 675,601 ThaiWater gauge-hours, 9–15 Nov 2026 (rain hours >= 0.5 mm/h): PARDIG caught 71 % of them with 52 %
// of its rain hours false (CSI 0.40); GSMaP Gauge_NRT, used until then, 44 % with 68 % false (CSI 0.23); better on every day.
// PARDIG uses ECMWF atmospheric fields among its inputs, so it is not the truth for fitting or judging corrections of ECMWF rain
// (fit_rain_blend.py, the weather-ML rain gate): those keep the radar and the gauges.
// Hours: the mean rate over the hour STARTING at t (as GSMaP), the trapezoid over the five frames t, t+15, …, t+60 min.
import zlib from 'node:zlib';

export const PDCFG = {
  base: 'https://storage.googleapis.com/pardig_1/NRT/zarr/2026_to_present',
  lon0: 92.0, lat0: 5.0, nx: 181, ny: 201,   // crop 92–110 E, 5–25 N on PARDIG's own grid (cell centres on whole tenths)
  keepH: 48, firstH: 24, frameMin: 15,
  source: 'Google DeepMind PARDIG near-real-time (CC BY 4.0), hourly mean of the 15-min rain rate',
};
const HOUR = 3600e3, MIN = 60e3, GX = 3600, GY = 1801;
const stamp = t => new Date(t).toISOString().replace(/[-:]/g, '').slice(0, 15);
export const frameUrl = t => `${PDCFG.base}/${stamp(t)}/predictions.zarr/precipitation/c/0/0`;
const pack = a => zlib.deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { level: 9 }).toString('base64');
const unpack = s => { const b = zlib.inflateSync(Buffer.from(s, 'base64')); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

/** One decompressed global frame (Float32, m/h) -> Int16 crop, rows south to north, 0.1 mm/h, −1 missing. */
export function cropFrame(g, c = PDCFG) {
  if (g.length !== GX * GY) throw new Error(`unexpected PARDIG grid size ${g.length}`);
  const out = new Int16Array(c.nx * c.ny), x0 = Math.round(c.lon0 * 10);
  for (let y = 0; y < c.ny; y++) {
    const row = Math.round((c.lat0 + y * 0.1 + 90) * 10) * GX + x0;
    for (let x = 0; x < c.nx; x++) { const v = g[row + x]; out[y * c.nx + x] = !isFinite(v) || v < 0 ? -1 : Math.min(3000, Math.round(v * 1e4)); }   // m/h -> 0.1 mm/h
  }
  return out;
}

/** Hourly mean (0.1 mm/h) from the five frames t, t+15, t+30, t+45, t+60 (trapezoid); a cell missing in any frame is missing. */
export function hourMean(f) {
  const n = f[0].length, out = new Int16Array(n), w = [0.5, 1, 1, 1, 0.5];
  for (let i = 0; i < n; i++) { let s = 0, bad = false; for (let k = 0; k < 5; k++) { const v = f[k][i]; if (v < 0) { bad = true; break; } s += w[k] * v; } out[i] = bad ? -1 : Math.round(s / 4); }
  return out;
}

/** A field on another 0.1° grid whose cell centres sit at the corners of this grid's cells (GSMaP: x.x5°) -> this grid: the mean
 *  of the four cells around each centre, missing ones left out (the area-weighted remap for a half-cell offset). */
export function remapHalfCell(src, s, c = PDCFG) {
  const out = new Int16Array(c.nx * c.ny).fill(-1), ox = Math.round((c.lon0 - s.lon0) / 0.1 - 0.5), oy = Math.round((c.lat0 - s.lat0) / 0.1 - 0.5);
  for (let y = 0; y < c.ny; y++) for (let x = 0; x < c.nx; x++) {
    let sum = 0, k = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const xs = x + ox + dx, ys = y + oy + dy; if (xs < 0 || ys < 0 || xs >= s.nx || ys >= s.ny) continue; const v = src[ys * s.nx + xs]; if (v >= 0) { sum += v; k++; } }
    if (k) out[y * c.nx + x] = Math.round(sum / k);
  }
  return out;
}

async function fetchFrame(t, get) {
  const r = await get(frameUrl(t));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('this Node has no zstd (needs Node >= 22.15)');
  const b = zlib.zstdDecompressSync(Buffer.from(await r.arrayBuffer()));
  return cropFrame(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
}

/** cache: { grid, frames: { [t]: b64 }, miss: { [t]: tries }, hours: { [hourStart]: { src: 'pardig', d: b64 } } }.
 *  Fetches the frames still needed for the last keepH hours (firstH on the first fill), builds the hours whose five frames are all
 *  in, and drops frames no hour needs any more. `get(url)` resolves to a fetch Response (404 allowed). Returns the cache. */
export async function updatePardig(cache, now, { get = (u) => fetch(u, { signal: AbortSignal.timeout(60e3) }), log = console.log, maxFrames = 220, conc = 8 } = {}) {
  const c = PDCFG;
  cache ||= {}; cache.grid = { lon0: c.lon0, lat0: c.lat0, nx: c.nx, ny: c.ny, step: 0.1 }; cache.frames ||= {}; cache.miss ||= {}; cache.hours ||= {};
  const old = now - c.keepH * HOUR - HOUR;
  for (const o of [cache.frames, cache.miss, cache.hours]) for (const k of Object.keys(o)) if (+k < old) delete o[k];
  const back = Object.keys(cache.hours).length ? c.keepH : c.firstH, last = Math.floor(now / HOUR) * HOUR - HOUR, want = [];
  for (let h = last; h >= now - back * HOUR; h -= HOUR) if (!cache.hours[h]) for (let m = 0; m <= 60; m += c.frameMin) {
    const t = h + m * MIN; if (t > now || cache.frames[t] || want.includes(t)) continue;
    if ((cache.miss[t] || 0) >= 3 && t < now - 12 * HOUR) continue;   // a frame still missing 12 h on is not coming: stop asking
    want.push(t);
  }
  want.sort((a, b) => b - a); want.length = Math.min(want.length, maxFrames);   // newest first
  let got = 0, absent = 0, err = 0; const q = [...want];
  await Promise.all(Array.from({ length: conc }, async () => { while (q.length) { const t = q.shift();
    try { const f = await fetchFrame(t, get); if (f) { cache.frames[t] = pack(f); got++; delete cache.miss[t]; } else { absent++; cache.miss[t] = (cache.miss[t] || 0) + 1; } }
    catch (e) { err++; if (err <= 2) log(`PARDIG frame ${stamp(t)}: ${e.message}`); } } }));
  let built = 0;
  for (let h = last; h >= now - back * HOUR; h -= HOUR) {
    if (cache.hours[h]) continue;
    const ts = [0, 15, 30, 45, 60].map(m => h + m * MIN); if (!ts.every(t => cache.frames[t])) continue;
    cache.hours[h] = { src: 'pardig', d: pack(hourMean(ts.map(t => unpack(cache.frames[t])))) }; built++;
  }
  // a frame is needed only by hours not built yet (a frame on the hour belongs to that hour and to the one before)
  for (const k of Object.keys(cache.frames)) { const t = +k, h = Math.floor(t / HOUR) * HOUR, users = t === h ? [h, h - HOUR] : [h];
    if (users.every(u => cache.hours[u] || u < old)) delete cache.frames[k]; }
  const hs = Object.keys(cache.hours).map(Number).sort((a, b) => a - b);
  log(`PARDIG: ${got} frames read, ${absent} not published yet${err ? `, ${err} failed` : ''}; ${built} hours built, ${hs.length} held, latest hour starting ${hs.length ? new Date(hs.at(-1)).toISOString().slice(0, 13) + 'Z' : '–'}`);
  return cache;
}

/** The observed rain of the page and the met grids, on PARDIG's grid: each hour from PARDIG when `usePardig` and PARDIG has it,
 *  else GSMaP (remapped; its src 'nrt'/'now' kept). The result has the shape of the GSMaP cache plus its grid. */
export function obsRain(pcache, gcache, gcfg, usePardig) {
  const hours = {}, ts = new Set([...Object.keys(pcache?.hours || {}), ...Object.keys(gcache?.hours || {})]);
  for (const k of ts) {
    if (usePardig && pcache?.hours?.[k]) { hours[k] = { src: 'pardig', d: pcache.hours[k].d }; continue; }   // copies: gsmapAt caches decoded fields on hour objects
    const g = gcache?.hours?.[k]; if (!g) continue;
    const z = zlib.inflateSync(Buffer.from(g.d, 'base64')), a = new Int16Array(z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength));
    hours[k] = { src: g.src, d: pack(remapHalfCell(a, gcfg)) };
  }
  return { grid: { lon0: PDCFG.lon0, lat0: PDCFG.lat0, nx: PDCFG.nx, ny: PDCFG.ny, step: 0.1 }, hours };
}

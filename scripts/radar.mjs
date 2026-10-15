// Live forecast only: weather radar as the dense rain observation, the way the monitors are for PM2.5.
// Source: RainViewer public weather-maps API (composite of the national radar networks it receives; over this domain the Thai
// Meteorological Department radars), 10-min frames for the last 2 h, drawn as map tiles in the "Universal Blue" colour scheme.
// Each hourly run:
//   1. fetches the new frames over Thailand (RVCFG.bbox) as 512-px tiles at zoom 6 (≈1.2 km pixels), no smoothing, no snow colours,
//      turns the colours back into dBZ with the scheme's table (scripts/radar_colors) and into rain rate with Marshall–Palmer
//      Z = 200 R^1.6, and averages the pixels into 0.025° cells (the page's grid);
//   2. keeps the frames in the Actions cache (radar-cache.json) and forms hourly means (hour STARTING at the time, like GSMaP);
//   3. scores the radar against the ThaiWater rain gauges and keeps a multiplicative adjustment factor (gauge/radar over 7 days);
//   4. extrapolates the latest frame with the echo motion of the last 20 min (block cross-correlation, Lagrangian persistence)
//      for the next 3 h, as a nowcast the page blends with ECMWF by lead;
//   5. publishes the last 12 h and the nowcast at 0.025° in rain-obs.json (field "radar"), replaces ECMWF rain in the
//      meteorology used by the smoke model where the radar sees, and archives the values at the stations and gauges for the
//      ML experts and for fitting the blend weights (scripts/mlwx.mjs; replay/fit_blend.py style).
// Coverage mask: the API's coverage tiles (transparent = a radar sees here). Cells outside coverage are -1 (missing), so the
// page and the merge fall back to GSMaP / ECMWF there (Laos, Myanmar, Cambodia and the sea beyond radar range).
import zlib from 'node:zlib';

const HOUR = 3600e3, MIN = 60e3, DEG = Math.PI / 180;
export const RVCFG = {
  api: 'https://api.rainviewer.com/public/weather-maps.json',
  z: 6, size: 512, color: 2, opts: '0_0',          // zoom 6 × 512 px ≈ 1.2 km; colour 2 = Universal Blue; 0_0 = no smoothing, no snow colours
  bbox: [97, 5.5, 106, 21], step: 0.025,            // Thailand; cell centres from (lon0, lat0)
  keepFramesH: 3, keepHoursH: 72, webH: 24,          // frames and hourly fields held in the cache (72 h: the ECMWF diagnostics and
                                                     // the 48-h diurnal persistence); hours published to the page (24 h covers persistence at every lead)
  minFrames: 4,                                      // frames (of 6) an hourly mean needs
  nowLeadH: 3, block: 40, search: 8,                 // nowcast: 3 h; motion blocks of 40 cells (1°), search ±8 cells (±0.2°) per 10 min
  minDbz: 10, maxRate: 100,                          // below 10 dBZ no rain; rates capped (hail, clutter)
  maskRefreshH: 24, paceMs: 700,                     // coverage mask refreshed daily; ≤ ~85 tile requests/min (limit 100/min/IP)
};
export const GRID = (() => { const [W, S, E, N] = RVCFG.bbox, st = RVCFG.step; return { lon0: W, lat0: S, step: st, nx: Math.round((E - W) / st) + 1, ny: Math.round((N - S) / st) + 1 }; })();

// ---- Universal Blue colour table (RainViewer rainviewer_api_colors_table.csv, rain block): dBZ -> RGBA; matched exactly, else nearest
const UB = `-10:63615914 -9:66635a19 -8:69665c1e -7:6c685d24 -6:6f6b5f29 -5:726e612e -4:75706234 -3:78736439 -2:7c75653e -1:7f786744 0:827b6949 1:857d6a4e 2:88806c54 3:8b826d59 4:8e856f5e 5:92887164 6:9e93756e 7:aa9e7978 8:b6a97e82 9:c2b4828c 10:cec08796 11:d2c48ba0 12:d6c88faa 13:dacc93b4 14:ded097be 15:88ddeeff 16:6cd1ebff 17:51c5e8ff 18:36bae5ff 19:1baee2ff 20:00a3e0ff 21:009ad5ff 22:0091caff 23:0088bfff 24:007fb4ff 25:0077aaff 26:0070a3ff 27:00699cff 28:006295ff 29:005b8eff 30:005588ff 31:005180ff 32:004e78ff 33:004a70ff 34:004768ff 35:ffee00ff 36:ffe000ff 37:ffd200ff 38:ffc500ff 39:ffb700ff 40:ffaa00ff 41:ff9f00ff 42:ff9500ff 43:ff8b00ff 44:ff8100ff 45:ff4400ff 46:f23600ff 47:e62800ff 48:d91b00ff 49:cd0d00ff 50:c10000ff 51:a80000ff 52:8f0000ff 53:760000ff 54:5d0000ff 55:ffaaffff 56:ff9fffff 57:ff95ffff 58:ff8bffff 59:ff81ffff 60:ff77ffff 61:ff6cffff 62:ff62ffff 63:ff58ffff 64:ff4effff 65:ffffffff 75:00ff00ff`;
const PAL = UB.split(' ').map(s => { const [d, h] = s.split(':'); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), parseInt(h.slice(6, 8), 16), +d]; });
const EXACT = new Map(PAL.map(p => [(p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]) >>> 0, p[4]]));
const NEAR = new Map();
export function dbzOf(r, g, b, a) {
  if (a === 0) return -32;
  const k = (r << 24 | g << 16 | b << 8 | a) >>> 0; const e = EXACT.get(k); if (e !== undefined) return e;
  let m = NEAR.get(k); if (m !== undefined) return m;
  let best = 1e9; for (const p of PAL) { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2 + 2 * (p[3] - a) ** 2; if (d < best) { best = d; m = p[4]; } }
  if (best > 3 * 48 * 48) m = -32;   // not a palette colour (edge blending): no echo
  NEAR.set(k, m); return m;
}
// Marshall–Palmer (1948) Z = 200 R^1.6, mm/h
export const rateOf = dbz => dbz < RVCFG.minDbz ? 0 : Math.min(RVCFG.maxRate, Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6));

// ---- minimal PNG decoder (8-bit RGB, RGBA, grey, grey+alpha and palette; non-interlaced) -> { w, h, rgba }
export function decodePNG(buf) {
  const b = Buffer.from(buf); if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 8, ctype = 6, plte = null, trns = null; const idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len); p += 12 + len;
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; if (d[12]) throw new Error('interlaced PNG'); }
    else if (type === 'PLTE') plte = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break; }
  if (depth !== 8) throw new Error(`PNG depth ${depth}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype]; if (!ch) throw new Error(`PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = new Uint8Array(w * h * 4), line = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], o = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) { const x = raw[o + i], a = i >= ch ? line[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0; let v;
      switch (f) { case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + up; break; case 3: v = x + ((a + up) >> 1); break;
        default: { const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); } }
      line[i] = v & 255; }
    for (let x = 0; x < w; x++) { const o4 = (y * w + x) * 4, i = x * ch;
      if (ctype === 6) { out[o4] = line[i]; out[o4 + 1] = line[i + 1]; out[o4 + 2] = line[i + 2]; out[o4 + 3] = line[i + 3]; }
      else if (ctype === 2) { out[o4] = line[i]; out[o4 + 1] = line[i + 1]; out[o4 + 2] = line[i + 2]; out[o4 + 3] = 255; }
      else if (ctype === 3) { const k = line[i]; out[o4] = plte[k * 3]; out[o4 + 1] = plte[k * 3 + 1]; out[o4 + 2] = plte[k * 3 + 2]; out[o4 + 3] = trns && k < trns.length ? trns[k] : 255; }
      else if (ctype === 0) { out[o4] = out[o4 + 1] = out[o4 + 2] = line[i]; out[o4 + 3] = 255; }
      else { out[o4] = out[o4 + 1] = out[o4 + 2] = line[i]; out[o4 + 3] = line[i + 1]; } }
    prev.set(line);
  }
  return { w, h, rgba: out };
}

// ---- tiles covering the box at zoom z, and the pixel -> cell lookup (computed once per tile position)
export function tileList() { const n = 2 ** RVCFG.z, [W, S, E, N] = RVCFG.bbox, X = lon => Math.floor((lon + 180) / 360 * n), Y = lat => Math.floor((1 - Math.log(Math.tan(lat * DEG) + 1 / Math.cos(lat * DEG)) / Math.PI) / 2 * n);
  const out = []; for (let x = X(W); x <= X(E); x++) for (let y = Y(N); y <= Y(S); y++) out.push([x, y]); return out; }
const CELLIDX = new Map();   // "x,y" -> Int32Array of cell index per pixel (-1 outside)
function cellIndex(x, y) { const k = x + ',' + y; let a = CELLIDX.get(k); if (a) return a;
  const n = 2 ** RVCFG.z, S = RVCFG.size, G = GRID; a = new Int32Array(S * S);
  for (let py = 0; py < S; py++) { const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / S) / n))) / DEG, iy = Math.round((lat - G.lat0) / G.step);
    for (let px = 0; px < S; px++) { const lon = (x + (px + 0.5) / S) / n * 360 - 180, ix = Math.round((lon - G.lon0) / G.step);
      a[py * S + px] = ix < 0 || iy < 0 || ix >= G.nx || iy >= G.ny ? -1 : iy * G.nx + ix; } }
  CELLIDX.set(k, a); return a; }

// cell field from one frame's tiles: mean rain rate (mm/h) of the pixels in each cell; count of pixels per cell
function frameField(tiles) {   // tiles: [{x, y, png}]
  const G = GRID, n = G.nx * G.ny, sum = new Float32Array(n), cnt = new Uint16Array(n);
  for (const { x, y, png } of tiles) { const { rgba } = decodePNG(png), idx = cellIndex(x, y);
    for (let p = 0; p < idx.length; p++) { const c = idx[p]; if (c < 0) continue; const o = p * 4; sum[c] += rateOf(dbzOf(rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3])); cnt[c]++; } }
  return { sum, cnt }; }
function maskField(tiles) {   // coverage tiles: transparent = covered
  const G = GRID, n = G.nx * G.ny, cov = new Uint16Array(n), cnt = new Uint16Array(n);
  for (const { x, y, png } of tiles) { const { rgba } = decodePNG(png), idx = cellIndex(x, y);
    for (let p = 0; p < idx.length; p++) { const c = idx[p]; if (c < 0) continue; cnt[c]++; if (rgba[p * 4 + 3] < 128) cov[c]++; } }
  const m = new Uint8Array(n); for (let c = 0; c < n; c++) m[c] = cnt[c] && cov[c] * 2 >= cnt[c] ? 1 : 0; return m; }

export const packI16 = a => zlib.deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { level: 9 }).toString('base64');
export const unpackI16 = s => { const b = zlib.inflateSync(Buffer.from(s, 'base64')); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };
const packU8 = a => zlib.deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { level: 9 }).toString('base64');
const unpackU8 = s => new Uint8Array(zlib.inflateSync(Buffer.from(s, 'base64')));

// ---- hourly update of the cache: { mask: { t, d }, frames: { [tMs]: d }, hours: { [tStartMs]: { d, n } }, fetched }
// Frame and hour fields: Int16 ×10 mm/h, -1 = no radar coverage. Hours are the mean of the frames in (t, t+60 min].
export async function updateRadar(cache, now, { get, sleep, log = console.log } = {}) {
  cache = cache || { frames: {}, hours: {} }; cache.frames ||= {}; cache.hours ||= {};
  const api = await (await get(RVCFG.api)).json(), past = (api?.radar?.past || []).filter(f => f && f.path && f.time);
  if (!api?.host || !past.length) throw new Error('no radar frames listed');
  const tiles = tileList(); let req = 0;
  const fetchTiles = async urlOf => { const out = []; for (const [x, y] of tiles) { if (req++) await sleep(RVCFG.paceMs); out.push({ x, y, png: Buffer.from(await (await get(urlOf(x, y))).arrayBuffer()) }); } return out; };
  // coverage mask, refreshed daily
  if (!cache.mask || now - cache.mask.t > RVCFG.maskRefreshH * HOUR) {
    try { const m = maskField(await fetchTiles((x, y) => `${api.host}/v2/coverage/0/${RVCFG.size}/${RVCFG.z}/${x}/${y}/0/0_0.png`));
      cache.mask = { t: now, d: packU8(m), covered: +(m.reduce((a, v) => a + v, 0) / m.length).toFixed(3) }; log(`radar coverage mask: ${(cache.mask.covered * 100).toFixed(0)} % of the Thailand box covered`); }
    catch (e) { log(`radar coverage mask failed: ${e.message}${cache.mask ? ' (keeping previous)' : ''}`); }
  }
  const mask = cache.mask ? unpackU8(cache.mask.d) : null;
  // new frames
  let nNew = 0;
  for (const f of past.sort((a, b) => a.time - b.time)) { const t = f.time * 1000; if (cache.frames[t]) continue;
    try { const { sum, cnt } = frameField(await fetchTiles((x, y) => `${api.host}${f.path}/${RVCFG.size}/${RVCFG.z}/${x}/${y}/${RVCFG.color}/${RVCFG.opts}.png`));
      const a = new Int16Array(sum.length); for (let c = 0; c < a.length; c++) a[c] = !cnt[c] || (mask && !mask[c]) ? -1 : Math.min(3000, Math.round(sum[c] / cnt[c] * 10));
      cache.frames[t] = packI16(a); nNew++; }
    catch (e) { log(`radar frame ${new Date(t).toISOString().slice(11, 16)}Z failed: ${e.message}`); } }
  for (const k of Object.keys(cache.frames)) if (+k < now - RVCFG.keepFramesH * HOUR) delete cache.frames[k];
  for (const k of Object.keys(cache.hours)) if (+k < now - RVCFG.keepHoursH * HOUR) delete cache.hours[k];
  // hourly means for hours that have ended (frames at :10 … :00 of the next hour)
  const times = Object.keys(cache.frames).map(Number).sort((a, b) => a - b);
  for (let T = Math.floor((times[0] || now) / HOUR) * HOUR; T + HOUR <= now; T += HOUR) {
    const fr = times.filter(t => t > T && t <= T + HOUR); if (fr.length < RVCFG.minFrames) continue;
    if (cache.hours[T] && cache.hours[T].n >= fr.length) continue;
    const n = GRID.nx * GRID.ny, s = new Float32Array(n), c = new Uint8Array(n);
    for (const t of fr) { const a = unpackI16(cache.frames[t]); for (let i = 0; i < n; i++) if (a[i] >= 0) { s[i] += a[i]; c[i]++; } }
    const h = new Int16Array(n); for (let i = 0; i < n; i++) h[i] = c[i] * 2 >= fr.length ? Math.round(s[i] / c[i]) : -1;
    cache.hours[T] = { d: packI16(h), n: fr.length };
  }
  cache.fetched = now; cache.latest = times[times.length - 1] || null;
  log(`radar: ${past.length} frames listed, ${nNew} new (${req} tile requests), ${times.length} frames and ${Object.keys(cache.hours).length} hourly fields held, latest ${cache.latest ? new Date(cache.latest).toISOString().slice(11, 16) + 'Z' : '-'}`);
  return cache;
}

// ---- value at a point (mm/h) for the hour starting tStart; null = no field or no coverage
export function radarAt(cache, lat, lon, tStart, factor = 1) {
  const h = cache?.hours?.[tStart]; if (!h) return null; const a = h._a || (h._a = unpackI16(h.d)), G = GRID;
  const ix = Math.round((lon - G.lon0) / G.step), iy = Math.round((lat - G.lat0) / G.step); if (ix < 0 || iy < 0 || ix >= G.nx || iy >= G.ny) return null;
  const q = a[iy * G.nx + ix]; return q < 0 ? null : +(q / 10 * factor).toFixed(2); }

// ---- gauges: score the radar hours against the ThaiWater readings (hour starting tStart -> [lat, lon, mm]) and return the
// adjustment factor gauge/radar over the kept rows (wet pairs only, both ≥ 0.1 mm), clamped to 0.5–2.5; 1 until 200 wet pairs
export function scoreRadar(gaugeStore, cache, scored = {}, rows = []) {
  const out = [];
  for (const [k, G] of Object.entries(gaugeStore || {})) { const h = cache?.hours?.[k]; if (!h || scored[k] === h.n) continue;
    const p = [], o = []; for (const [lat, lon, mm] of G) { const r = radarAt(cache, lat, lon, +k); if (r == null) continue; p.push(r); o.push(mm); }
    if (p.length < 30) continue; const n = p.length; let se = 0, sg = 0, sr = 0, wet = 0, hit = 0, fa = 0, miss = 0;
    const mp = p.reduce((a, b) => a + b, 0) / n, mo = o.reduce((a, b) => a + b, 0) / n; let cv = 0, vp = 0, vo = 0;
    for (let i = 0; i < n; i++) { se += (p[i] - o[i]) ** 2; cv += (p[i] - mp) * (o[i] - mo); vp += (p[i] - mp) ** 2; vo += (o[i] - mo) ** 2;
      const w = o[i] >= 0.5, e = p[i] >= 0.5; if (w) wet++; if (w && e) hit++; if (!w && e) fa++; if (w && !e) miss++; if (o[i] >= 0.1 && p[i] >= 0.1) { sg += o[i]; sr += p[i]; } }
    out.push({ hour: new Date(+k).toISOString().slice(0, 13) + 'Z', n, wet, rmse: +Math.sqrt(se / n).toFixed(3), r: vp && vo ? +(cv / Math.sqrt(vp * vo)).toFixed(3) : null, bias: +(mp - mo).toFixed(3), pod: wet ? +(hit / wet).toFixed(2) : null, far: hit + fa ? +(fa / (hit + fa)).toFixed(2) : null, sg: +sg.toFixed(1), sr: +sr.toFixed(1), nwet: wet });
    scored[k] = h.n; }
  const all = [...rows.filter(r => !out.some(x => x.hour === r.hour)), ...out];   // an hour re-scored (more frames) replaces its old row
  const SG = all.reduce((a, r) => a + r.sg, 0), SR = all.reduce((a, r) => a + r.sr, 0), NW = all.reduce((a, r) => a + r.nwet, 0);
  const factor = NW >= 200 && SR > 0 ? +Math.min(2.5, Math.max(0.5, SG / SR)).toFixed(2) : 1;
  return { rows: out, factor, nWet: NW };
}

// ---- replace ECMWF rain in the met grids by the (adjusted) radar hourly means where the radar sees (≥ half the node's cells)
export function mergeRadarIntoMet(M, cache, factor = 1) {
  if (!cache?.hours) return 0; const G = GRID; let nRep = 0;
  for (let k = 0; k < M.times.length; k++) { const h = cache.hours[M.times[k] - HOUR]; if (!h) continue; const a = h._a || (h._a = unpackI16(h.d));
    M.grids.forEach(g => { const n = g.nx * g.ny, half = g.step / 2;
      for (let p = 0; p < n; p++) { const la = g.lat0 + Math.floor(p / g.nx) * g.step, lo = g.lon0 + (p % g.nx) * g.step;
        const x0 = Math.max(0, Math.ceil((lo - half - G.lon0) / G.step - 1e-6)), x1 = Math.min(G.nx - 1, Math.floor((lo + half - G.lon0) / G.step + 1e-6));
        const y0 = Math.max(0, Math.ceil((la - half - G.lat0) / G.step - 1e-6)), y1 = Math.min(G.ny - 1, Math.floor((la + half - G.lat0) / G.step + 1e-6));
        if (x1 < x0 || y1 < y0) continue; let s = 0, v = 0, all = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { all++; const q = a[y * G.nx + x]; if (q >= 0) { s += q / 10; v++; } }
        if (v < 0.5 * all) continue; g.data.pr[k * n + p] = Math.round(s / v * factor * 10) / 10; nRep++; } }); }
  return nRep;
}

// ---- nowcast: echo motion from the last three frames (block cross-correlation of 10-min pairs), Lagrangian extrapolation of the
// latest frame in 10-min steps for RVCFG.nowLeadH hours; hourly means on the clock hours from the hour of the latest frame.
// Returns { t0 (latest frame), issued, hours: [tStart...], fields: [Int16...], motion: { u, v (cells / 10 min, domain mean), blocks } }
export function nowcast(cache) {
  const times = Object.keys(cache?.frames || {}).map(Number).sort((a, b) => a - b); if (times.length < 3) return null;
  const T = times.slice(-3), F = T.map(t => unpackI16(cache.frames[t])), G = GRID, nx = G.nx, ny = G.ny, B = RVCFG.block, S = RVCFG.search;
  if (T[2] - T[0] > 25 * MIN) return null;   // need three consecutive 10-min frames
  const val = (a, i) => a[i] < 0 ? 0 : a[i];
  // per-block displacement (dx, dy in cells per 10 min) maximising the correlation of frame k-1 shifted onto frame k, two pairs averaged
  const bx = Math.ceil(nx / B), by = Math.ceil(ny / B), blocks = [];
  for (let jb = 0; jb < by; jb++) for (let ib = 0; ib < bx; ib++) { const x0 = ib * B, y0 = jb * B, x1 = Math.min(nx, x0 + B), y1 = Math.min(ny, y0 + B);
    let best = null;
    for (const [A, Bf, kk] of [[F[0], F[1], 1], [F[1], F[2], 1], [F[0], F[2], 2]]) { let sum = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += val(Bf, y * nx + x); if (sum < 50) continue;   // ≥ 5 mm/h·cells of rain in the block
      let bc = -1, bd = null; const Sk = S * kk;   // the 20-min pair halves the quantisation (cells per 10 min)
      for (let dy = -Sk; dy <= Sk; dy++) for (let dx = -Sk; dx <= Sk; dx++) { let sab = 0, saa = 0, sbb = 0;
        for (let y = y0; y < y1; y++) { const ys = y - dy; if (ys < 0 || ys >= ny) continue; for (let x = x0; x < x1; x++) { const xs = x - dx; if (xs < 0 || xs >= nx) continue; const a = val(A, ys * nx + xs), b = val(Bf, y * nx + x); sab += a * b; saa += a * a; sbb += b * b; } }
        const c = saa && sbb ? sab / Math.sqrt(saa * sbb) : 0; if (c > bc) { bc = c; bd = [dx, dy]; } }
      if (bd && bc > 0.3) { best ||= [0, 0, 1, 0]; best[0] += bd[0] / kk; best[1] += bd[1] / kk; best[2] = Math.min(best[2], bc); best[3]++; } }
    blocks.push({ ib, jb, d: best ? [best[0] / best[3], best[1] / best[3], best[2]] : null }); }
  const good = blocks.filter(b => b.d); if (!good.length) return null;
  const mu = good.reduce((a, b) => a + b.d[0], 0) / good.length, mv = good.reduce((a, b) => a + b.d[1], 0) / good.length;
  const bu = new Float32Array(bx * by).fill(mu), bv = new Float32Array(bx * by).fill(mv);
  for (const b of good) { bu[b.jb * bx + b.ib] = b.d[0]; bv[b.jb * bx + b.ib] = b.d[1]; }
  // smooth the block vectors once (3×3 mean) so neighbouring blocks move together
  const su = new Float32Array(bx * by), sv = new Float32Array(bx * by);
  for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) { let u = 0, v = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= bx || jj >= by) continue; u += bu[jj * bx + ii]; v += bv[jj * bx + ii]; n++; } su[j * bx + i] = u / n; sv[j * bx + i] = v / n; }
  // extrapolate: value at cell (x, y) after k steps = latest frame at (x - k·u, y - k·v) (nearest cell); outside the grid or
  // outside coverage -> missing. Hourly means on clock hours from the hour of the latest frame; the current hour mixes observed
  // frames (already in the cache) with extrapolated ones.
  const t0 = T[2], last = F[2], steps = RVCFG.nowLeadH * 6 + 6, fields = new Map();   // step k -> Int16 field
  const H0 = Math.floor(t0 / HOUR) * HOUR, hours = [];
  for (let H = H0; H < H0 + (RVCFG.nowLeadH + 1) * HOUR; H += HOUR) {
    const n = nx * ny, s = new Float32Array(n), c = new Uint8Array(n); let used = 0;
    for (let t = H + 10 * MIN; t <= H + HOUR; t += 10 * MIN) {
      let a; if (t <= t0) { if (!cache.frames[t]) continue; a = unpackI16(cache.frames[t]); }
      else { const k = Math.round((t - t0) / (10 * MIN)); if (k > steps) continue; a = fields.get(k);
        if (!a) { a = new Int16Array(n); for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const i = y * nx + x, bi = Math.min(by - 1, Math.floor(y / B)) * bx + Math.min(bx - 1, Math.floor(x / B));
            const xs = Math.round(x - k * su[bi]), ys = Math.round(y - k * sv[bi]); a[i] = last[i] < 0 || xs < 0 || ys < 0 || xs >= nx || ys >= ny || last[ys * nx + xs] < 0 ? -1 : last[ys * nx + xs]; } fields.set(k, a); } }
      used++; for (let i = 0; i < n; i++) if (a[i] >= 0) { s[i] += a[i]; c[i]++; } }
    if (!used) continue; const h = new Int16Array(n); for (let i = 0; i < n; i++) h[i] = c[i] * 2 >= used ? Math.round(s[i] / c[i]) : -1; hours.push([H, h, used]); }
  const kmh = 0.025 * 111 * 6;   // cells per 10 min -> km/h
  return { t0, issued: Date.now(), hours: hours.map(h => h[0]), fields: hours.map(h => h[1]), frames: hours.map(h => h[2]),
           motion: { u: +(mu * kmh).toFixed(1), v: +(mv * kmh).toFixed(1), blocks: good.length, of: blocks.length } };
}

// ---- page file part: the last webH hourly fields, the coverage mask, the factor and the nowcast
export function webRadar(cache, now, factor, nc) {
  const ts = Object.keys(cache?.hours || {}).map(Number).filter(t => t >= now - RVCFG.webH * HOUR).sort((a, b) => a - b);
  if (!ts.length && !nc) return null;
  return { source: 'Weather radar via RainViewer (Thailand: Thai Meteorological Department), Universal Blue colours -> dBZ -> Marshall–Palmer rain rate, hourly mean over the hour starting at each time, 0.025° cells; -1 = no radar coverage',
           lon0: GRID.lon0, lat0: GRID.lat0, step: GRID.step, nx: GRID.nx, ny: GRID.ny, scale: 10, enc: 'deflate-int16', factor,
           latest: cache.latest || null, mask: cache.mask ? cache.mask.d : null, times: ts, d: ts.map(t => cache.hours[t].d),
           nowcast: nc ? { t0: nc.t0, hours: nc.hours, frames: nc.frames, d: nc.fields.map(packI16), motion: nc.motion } : null };
}

// ---- ECMWF against the radar over the last DIAG.windowH hours (the rain analogue of the Kalman filter for CAMS): on a 0.25° lattice
// over the radar box, from ECMWF as issued (met.json, not merged with observations) and the gauge-adjusted radar hourly means:
//   timing: shiftH (h, −6…+6) = how many hours LATE ECMWF's rain is: the s that best correlates ECMWF(t + s) with the radar at t over all
//           covered node-hours; the corrected forecast at t reads ECMWF at t + shiftH
//   amount: per node, ln((R + 1)/(E + 1)) of the window totals (mm), shrunk toward 0 with the node's wet hours (n/(n + 10)), smoothed
//           over 3 × 3 nodes and limited to ±ln 4
// The page applies both with weights by lead fitted on the station log (rainfc-*.csv; scripts/fit_rain_blend.py); zero until fitted.
export const DIAG = { windowH: 72, step: 0.25, maxShiftH: 6, wetMm: 0.2, shrinkN: 10, maxLn: Math.log(4), minWet: 200 };
export function rainDiag(metPure, cache, factor, now, sample) {
  const hours = Object.keys(cache?.hours || {}).map(Number).filter(t => t >= now - DIAG.windowH * HOUR && t + HOUR <= now).sort((a, b) => a - b);
  if (hours.length < 24) return null;
  const [W, S, E, N] = RVCFG.bbox, st = DIAG.step, nx = Math.round((E - W) / st) + 1, ny = Math.round((N - S) / st) + 1, G = GRID, half = Math.round(st / 2 / G.step);
  // the radar hour list may have gaps (hours with too few frames): ECMWF is kept on a contiguous hourly axis from hours[0] and radar
  // hour k is matched by its offset hk[k], never by position; hours outside met.json's range are missing (sampleMet would clamp them)
  const hk = hours.map(H => Math.round((H - hours[0]) / HOUR)), span = hk[hk.length - 1] + 1, mT = metPure.times, mT0 = mT[0], mT1 = mT[mT.length - 1];
  const R = new Float32Array(nx * ny * hours.length).fill(NaN), Ev = new Map();   // radar at node-hour; ECMWF series per node (hour index −6…+6)
  hours.forEach((H, k) => { const h = cache.hours[H], a = h._a || (h._a = unpackI16(h.d));
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const cx = Math.round((W + i * st - G.lon0) / G.step), cy = Math.round((S + j * st - G.lat0) / G.step); let s = 0, n = 0, all = 0;
      for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) { if (x < 0 || y < 0 || x >= G.nx || y >= G.ny) continue; all++; const q = a[y * G.nx + x]; if (q >= 0) { s += q / 10; n++; } }
      if (all && n >= 0.5 * all) R[(k * ny + j) * nx + i] = s / n * factor; } });
  const ecm = (i, j) => { const key = j * nx + i; let e = Ev.get(key); if (e) return e; e = new Float32Array(span + 2 * DIAG.maxShiftH);
    for (let q = 0; q < e.length; q++) { const t = hours[0] + (q - DIAG.maxShiftH) * HOUR + HOUR; if (t < mT0 || t > mT1) { e[q] = NaN; continue; }
      const m = sample(metPure, S + j * st, W + i * st, t); e[q] = m && isFinite(m.pr) ? m.pr : NaN; }   // pr at t = rain of the hour ending t
    Ev.set(key, e); return e; };
  // timing
  const rBy = {}; let best = 0, bestR = -2, nWet = 0;
  for (let s = -DIAG.maxShiftH; s <= DIAG.maxShiftH; s++) { let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let e = null; for (let k = 0; k < hours.length; k++) { const r = R[(k * ny + j) * nx + i]; if (!(r === r)) continue; e ||= ecm(i, j); const x = e[hk[k] + DIAG.maxShiftH - s]; if (!(x === x)) continue;
        n++; sx += x; sy += r; sxx += x * x; syy += r * r; sxy += x * r; if (s === 0 && r >= 0.5) nWet++; } }
    const cv = sxy / n - sx / n * sy / n, vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2, r = n > 100 && vx > 0 && vy > 0 ? cv / Math.sqrt(vx * vy) : null;
    rBy[s] = r == null ? null : +r.toFixed(3); if (r != null && r > bestR) { bestR = r; best = s; } }
  const sIdx = nWet >= DIAG.minWet && rBy[0] != null && bestR - rBy[0] >= 0.02 ? best : 0, shiftH = -sIdx;   // kept only with enough rain and a clear gain; index s reads ECMWF(t − s)
  // amount field
  const lnf = new Float32Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let sr = 0, se = 0, n = 0, w = 0; const e = ecm(i, j);
    for (let k = 0; k < hours.length; k++) { const r = R[(k * ny + j) * nx + i]; if (!(r === r)) continue; const x = e[hk[k] + DIAG.maxShiftH - sIdx]; if (!(x === x)) continue; sr += r; se += x; n++; if (r >= DIAG.wetMm || x >= DIAG.wetMm) w++; }
    if (n >= 24) lnf[j * nx + i] = Math.log((sr + 1) / (se + 1)) * w / (w + DIAG.shrinkN); }
  const out = new Int16Array(nx * ny); let nNodes = 0, sum = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { let s = 0, n = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const v = lnf[jj * nx + ii]; if (v === v) { s += v; n++; } }
    const v = n ? Math.max(-DIAG.maxLn, Math.min(DIAG.maxLn, s / n)) : 0; out[j * nx + i] = Math.round(v * 100); if (n) { nNodes++; sum += v; } }
  const rByLate = Object.fromEntries(Object.entries(rBy).map(([k, v]) => [-k, v]));   // keyed by hours late
  return { t: now, hours: hours.length, shiftH, rByShift: rByLate, nWet, lon0: W, lat0: S, step: st, nx, ny, lnf100: Array.from(out), meanFactor: nNodes ? +Math.exp(sum / nNodes).toFixed(2) : 1, nNodes };
}
// ln-factor at a point (bilinear on the lattice; 0 outside)
export function diagFactorAt(D, lat, lon) { if (!D) return 1; const fx = (lon - D.lon0) / D.step, fy = (lat - D.lat0) / D.step; if (fx < 0 || fy < 0 || fx > D.nx - 1 || fy > D.ny - 1) return 1;
  const x0 = Math.min(Math.floor(fx), D.nx - 2), y0 = Math.min(Math.floor(fy), D.ny - 2), ax = fx - x0, ay = fy - y0, a = D.lnf100, i = y0 * D.nx + x0;
  return Math.exp(((1 - ax) * (1 - ay) * a[i] + ax * (1 - ay) * a[i + 1] + (1 - ax) * ay * a[i + D.nx] + ax * ay * a[i + D.nx + 1]) / 100); }
// diurnal persistence: the gauge-adjusted radar of the same hour on the latest day already observed (valid hour H, latest radar hour
// Hobs): H − 24·ceil((H − Hobs)/24 h); null where no radar
export function persistAt(cache, factor, lat, lon, H, Hobs) { const back = Math.max(1, Math.ceil((H - Hobs) / (24 * HOUR))) * 24 * HOUR; return radarAt(cache, lat, lon, H - back, factor); }

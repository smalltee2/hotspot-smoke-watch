// Terrain elevation on a regular lon/lat grid, built once from the public AWS Terrain Tiles
// (Terrarium PNG encoding, largely SRTM-derived over Southeast Asia). No API key, no dependencies.
// elevation (m) = R*256 + G + B/256 - 32768
import zlib from 'node:zlib';

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w, h, depth, ctype, interlace; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (depth !== 8 || interlace || !ch) throw new Error(`unsupported PNG (depth ${depth}, color ${ctype}, interlace ${interlace})`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0, b = y ? out[o - stride + x] : 0, c = (x >= ch && y) ? out[o - stride + x - ch] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : pb <= pc ? b : c; }
      out[o + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

const lon2x = (lon, n) => Math.floor((lon + 180) / 360 * n);
const lat2y = (lat, n) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
const y2lat = (y, n) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;

// Mean elevation (m, sea clipped to 0) on grid points lon0+ix*step, lat0+iy*step covering bbox [W,S,E,N]
export async function buildDEM(bbox, step, { zoom = 7, fetchTile, log = console.log } = {}) {
  const [W, S, E, N] = bbox, n = 2 ** zoom;
  const nx = Math.round((E - W) / step) + 1, ny = Math.round((N - S) / step) + 1;
  const sum = new Float64Array(nx * ny), cnt = new Uint32Array(nx * ny);
  const x0 = lon2x(W, n), x1 = lon2x(E, n), y0 = lat2y(N, n), y1 = lat2y(S, n);
  let ok = 0, bad = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    let img;
    try { img = decodePNG(await fetchTile(zoom, tx, ty)); ok++; } catch (e) { bad++; log(`DEM tile ${zoom}/${tx}/${ty}: ${e.message}`); continue; }
    for (let py = 0; py < img.h; py++) {
      const lat = y2lat(ty + (py + .5) / img.h, n), iy = Math.round((lat - S) / step); if (iy < 0 || iy >= ny) continue;
      for (let px = 0; px < img.w; px++) {
        const lon = (tx + (px + .5) / img.w) / n * 360 - 180, ix = Math.round((lon - W) / step); if (ix < 0 || ix >= nx) continue;
        const o = (py * img.w + px) * img.ch, e = img.data[o] * 256 + img.data[o + 1] + img.data[o + 2] / 256 - 32768;
        sum[iy * nx + ix] += Math.max(0, e); cnt[iy * nx + ix]++;
      }
    }
  }
  const values = Array.from(sum, (s, i) => cnt[i] ? Math.round(s / cnt[i]) : 0);
  log(`DEM: ${ok} tiles read, ${bad} failed, grid ${nx}×${ny} at ${step}°`);
  if (!ok) throw new Error('no DEM tiles could be read');
  return { lon0: W, lat0: S, step, nx, ny, values, source: 'AWS Terrain Tiles (Terrarium, zoom ' + zoom + ')' };
}

export function sampleGrid(G, lat, lon) {
  const fx = (lon - G.lon0) / G.step, fy = (lat - G.lat0) / G.step;
  if (fx < 0 || fy < 0 || fx > G.nx - 1 || fy > G.ny - 1) return null;
  const x0 = Math.min(Math.floor(fx), G.nx - 2), y0 = Math.min(Math.floor(fy), G.ny - 2), ax = fx - x0, ay = fy - y0, v = G.values;
  return (1 - ax) * (1 - ay) * v[y0 * G.nx + x0] + ax * (1 - ay) * v[y0 * G.nx + x0 + 1] + (1 - ax) * ay * v[(y0 + 1) * G.nx + x0] + ax * ay * v[(y0 + 1) * G.nx + x0 + 1];
}

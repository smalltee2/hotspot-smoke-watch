// MODIS land cover (MCD12Q1, IGBP classes, Terra+Aqua combined, annual) for per-fire fuel types, as in FINN.
// Read once a year from NASA GIBS map tiles (EPSG:4326, "500m" tile set, zoom 6: 4.5° tiles of 512 px ≈ 0.0088° ≈ 1 km),
// decoded exactly through the published GIBS colour map (colormaps/v1.3/MODIS_IGBP_Land_Cover_Type.xml). No key needed.
import zlib from 'node:zlib';
import { decodePNG } from './dem.mjs';

export const LC_LAYER = 'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual';
// GIBS colour → IGBP class (0 = water, 255 = unclassified)
const RGB2IGBP = new Map(Object.entries({
  '33,138,33': 1, '49,204,49': 2, '152,204,49': 3, '150,250,150': 4, '141,186,141': 5, '186,141,141': 6, '245,222,179': 7,
  '218,235,157': 8, '255,213,0': 9, '240,185,103': 10, '71,131,181': 11, '250,239,115': 12, '255,0,0': 13, '153,147,86': 14,
  '255,255,255': 15, '191,191,189': 16, '134,202,227': 17, '100,100,100': 255 }));
const Z = 6, TDEG = 288 / 2 ** Z, PX = 512;

export async function buildLandcover(bbox, { get, log, year }) {
  // use the previous year's map, as FINN does; step back if GIBS does not have it yet (an error, or blank tiles)
  for (let y = year - 1; y >= year - 4; y--) {
    try {
      const LC = await buildYear(bbox, y, get, log);
      if (LC.unknownFrac < 0.5) return LC;
      log(`land cover ${y}: ${(100 * LC.unknownFrac).toFixed(0)} % of pixels empty, trying the year before`);
    } catch (e) { log(`land cover ${y} not available: ${e.message}`); }
  }
  throw new Error('no land-cover year available');
}
async function buildYear(bbox, yr, get, log) {
  const [W, S, E, N] = bbox;
  const c0 = Math.floor((W + 180) / TDEG), c1 = Math.floor((E + 180) / TDEG), r0 = Math.floor((90 - N) / TDEG), r1 = Math.floor((90 - S) / TDEG);
  const nc = c1 - c0 + 1, nr = r1 - r0 + 1, w = nc * PX, h = nr * PX, cls = new Uint8Array(w * h).fill(254);  // 254 = no data
  await get(tileUrl(`${yr}-01-01`, r0, c0), {}, 1);   // fail fast if this year is not served
  let ok = 0, unknown = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    let img; try { img = decodePNG(Buffer.from(await (await get(tileUrl(`${yr}-01-01`, r, c))).arrayBuffer())); } catch (e) { log(`land cover tile ${r}/${c}: ${e.message}`); continue; }
    const lut = new Uint8Array(256).fill(254);
    if (img.palette) for (let i = 0; i * 3 < img.palette.length; i++) { const k = `${img.palette[3 * i]},${img.palette[3 * i + 1]},${img.palette[3 * i + 2]}`; lut[i] = RGB2IGBP.get(k) ?? 254; }
    for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
      let v;
      if (img.palette) v = lut[img.data[y * img.w + x]];
      else { const o = (y * img.w + x) * img.ch; v = img.ch === 4 && img.data[o + 3] === 0 ? 254 : RGB2IGBP.get(`${img.data[o]},${img.data[o + 1]},${img.data[o + 2]}`) ?? 254; }
      if (v === 254) unknown++;
      cls[((r - r0) * PX + y) * w + (c - c0) * PX + x] = v;
    }
    ok++;
  }
  if (!ok) throw new Error('no land-cover tiles could be read');
  const unknownFrac = unknown / (nc * nr * PX * PX);
  log(`land cover: MODIS IGBP ${yr}, ${ok}/${nc * nr} tiles, ${(100 * unknownFrac).toFixed(2)} % of pixels without a class`);
  return { year: yr, west: -180 + c0 * TDEG, north: 90 - r0 * TDEG, res: TDEG / PX, w, h, unknownFrac, cls };
}
function tileUrl(time, row, col) { return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${LC_LAYER}/default/${time}/500m/${Z}/${row}/${col}.png`; }

export function landcoverAt(LC, lat, lon) {
  const x = Math.floor((lon - LC.west) / LC.res), y = Math.floor((LC.north - lat) / LC.res);
  if (x < 0 || y < 0 || x >= LC.w || y >= LC.h) return null;
  const v = LC.cls[y * LC.w + x]; return v === 254 ? null : v;
}
// compact cache: small JSON header line + deflated class raster
export function packLandcover(LC) { const { cls, ...hdr } = LC; return Buffer.concat([Buffer.from(JSON.stringify(hdr) + '\n'), zlib.deflateSync(Buffer.from(cls), { level: 9 })]); }
export function unpackLandcover(buf) { const nl = buf.indexOf(10); const hdr = JSON.parse(buf.subarray(0, nl).toString()); return { ...hdr, cls: new Uint8Array(zlib.inflateSync(buf.subarray(nl + 1))) }; }

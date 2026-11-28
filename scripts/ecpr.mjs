// ECMWF open-data rain (data/ecmwf-pr.json, written by scripts/ecmwf_pr.py) read the way the page reads it (loadEcpr / ecprAt in
// index.html), so the pipeline can log the rain base the page really shows (column ecpr_mmh of rainfc-*.csv). Logging only: the
// pipeline's own rain stays the Open-Meteo field (the rain blend and weather-ML fits are on it).
//   file  { run, lon0, lat0, step, nx, ny, scale, enc: 'deflate-int16', t0: [ms], t1: [ms], d: [b64, ...] }: block k holds the mean
//         rate (mm/h × scale) over (t0[k], t1[k]] (3 h, later 6 h), rows south to north, zlib-deflated little-endian Int16.
// Staleness is not checked here: ecmwf_pr.py removes the file when its newest run is more than 36 h old, and the page reads
// whatever file is published, so this reads the same file the same way.
import fs from 'node:fs/promises';
import zlib from 'node:zlib';

/** Decoded copy of an ecmwf-pr.json document (its `d` blocks inflated to Int16Array `a`, as the page's loadEcpr), or null. */
export function decodeEcpr(o) {
  if (!o || !Array.isArray(o.d) || !Array.isArray(o.t0) || !Array.isArray(o.t1)) return null;
  const a = o.d.map(b => { const buf = zlib.inflateSync(Buffer.from(b, 'base64')); return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); });
  const { d, ...rest } = o; return { ...rest, a };
}

/** Reads and decodes the file; null when it is missing or unreadable (the page then falls back to the met rain). */
export async function loadEcpr(file) {
  try { return decodeEcpr(JSON.parse(await fs.readFile(file, 'utf8'))); } catch { return null; }
}

/** Rain (mm/h) for the hour ENDING t (ms) at lat, lon, exactly as the page's ecprAt: the block holding the middle of the hour,
 *  bilinear in space; undefined before the run, beyond its end, outside the box or without a file (the page uses MET then). */
export function ecprAt(E, lat, lon, t) {
  if (!E) return undefined; const m = t - 1800e3;
  const k = E.t1.findIndex((t1, i) => m > E.t0[i] && m <= t1); if (k < 0) return undefined;
  const fx = (lon - E.lon0) / E.step, fy = (lat - E.lat0) / E.step; if (fx < 0 || fy < 0 || fx > E.nx - 1 || fy > E.ny - 1) return undefined;
  const x0 = Math.min(E.nx - 2, Math.floor(fx)), y0 = Math.min(E.ny - 2, Math.floor(fy)), ax = fx - x0, ay = fy - y0, a = E.a[k], i = y0 * E.nx + x0;
  return ((1 - ax) * (1 - ay) * a[i] + ax * (1 - ay) * a[i + 1] + (1 - ax) * ay * a[i + E.nx] + ax * ay * a[i + E.nx + 1]) / E.scale;
}

/** How many leading columns of `header` to write into a log file whose current text is `text` (null: no file yet).
 *  A new file gets the full header. An existing file keeps the columns its own header line names, when that line is a leading
 *  part of `header` (a file begun before columns were added at the end): rows then match their file's header and columns are
 *  never shifted. A header line that is not such a prefix is left as it was before (full rows), as appendCSV always did. */
export function logCols(text, header) {
  const all = header.split(',').length; if (text == null || text === '') return all;
  const first = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')).trim();
  return first && (header === first || header.startsWith(first + ',')) ? first.split(',').length : all;
}

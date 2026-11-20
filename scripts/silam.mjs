// SILAM PM2.5 forecast (FMI, CC BY 4.0) in the Node pipeline: reads the daily extracts that scripts/silam.py writes to
// data/history/<YYYY-MM>/silam-<YYYYMMDD>.json (crop of the 0.2° global grid, hourly, about 5 days per run), joins the newest runs
// (the newer run wins where they overlap; the older one supplies the hours before the newer run starts, which the 24-h means of
// the map correction need), and gives the pipeline the same shapes it uses for CAMS:
//   times [ms], st[i] = series at station i (bilinear), grid[p] = series at grid node p, gdef {lon0, lat0, step, nx, ny}.
import fs from 'node:fs/promises';
import path from 'node:path';

const HOUR = 3600e3;

/** One extract -> { run, lon0, lat0, step, nx, ny, times, fields: Float32Array per hour (µg/m³, NaN where missing) }. */
export function decodeRun(doc) {
  const { nx, ny, scale = 10 } = doc, fields = doc.values.map(a => {
    const v = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) { let q = 0; for (let x = 0; x < nx; x++) { const k = y * nx + x; q += a[k]; v[k] = q < 0 ? NaN : q / scale; } }
    return v; });
  return { run: doc.run, source: doc.source, lon0: doc.lon0, lat0: doc.lat0, step: doc.step, nx, ny, times: doc.times.slice(), fields };
}

/** Runs (decoded, any order) -> one hourly sequence on the newest run's grid; each hour from the newest run that has it.
 *  Runs on another grid are left out. Returns null without runs. */
export function combineRuns(runs) {
  const rs = runs.filter(Boolean).sort((a, b) => (a.run < b.run ? 1 : -1)); if (!rs.length) return null;
  const g = rs[0], same = r => r.nx === g.nx && r.ny === g.ny && Math.abs(r.lon0 - g.lon0) < 1e-6 && Math.abs(r.lat0 - g.lat0) < 1e-6 && Math.abs(r.step - g.step) < 1e-9;
  const byT = new Map(), runOf = new Map();
  for (const r of rs) { if (!same(r)) continue; r.times.forEach((t, k) => { if (!byT.has(t)) { byT.set(t, r.fields[k]); runOf.set(t, r.run); } }); }
  const times = [...byT.keys()].sort((a, b) => a - b);
  // keep the longest run of consecutive hours ending at the last hour (interpT needs an even hourly step)
  let i0 = times.length - 1; while (i0 > 0 && times[i0] - times[i0 - 1] === HOUR) i0--;
  const T = times.slice(i0);
  return { run: g.run, runs: [...new Set(T.map(t => runOf.get(t)))], source: g.source, lon0: g.lon0, lat0: g.lat0, step: g.step, nx: g.nx, ny: g.ny,
    times: T, fields: T.map(t => byT.get(t)) };
}

/** Bilinear value of one hourly field at (lat, lon); null outside the grid or next to a missing cell. */
export function valueAt(S, f, lat, lon) {
  const e = 1e-6, fx = Math.min(S.nx - 1, (lon - S.lon0) / S.step), fy = Math.min(S.ny - 1, (lat - S.lat0) / S.step);
  if ((lon - S.lon0) / S.step < -e || (lat - S.lat0) / S.step < -e || (lon - S.lon0) / S.step > S.nx - 1 + e || (lat - S.lat0) / S.step > S.ny - 1 + e) return null;   // e: grid edges despite rounding
  const x0 = Math.max(0, Math.min(Math.floor(fx), S.nx - 2)), y0 = Math.max(0, Math.min(Math.floor(fy), S.ny - 2)), ax = Math.max(0, fx - x0), ay = Math.max(0, fy - y0);
  const a = f[y0 * S.nx + x0], b = f[y0 * S.nx + x0 + 1], c = f[(y0 + 1) * S.nx + x0], d = f[(y0 + 1) * S.nx + x0 + 1];
  if (!(a >= 0 && b >= 0 && c >= 0 && d >= 0)) return null;
  return (1 - ax) * (1 - ay) * a + ax * (1 - ay) * b + (1 - ax) * ay * c + ax * ay * d;
}
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
export const seriesAt = (S, lat, lon) => S.fields.map(f => r1(valueAt(S, f, lat, lon)));

/** The model in the shapes the pipeline's map correction (runRK) takes. */
export function asModel(S, stations) {
  const n = S.nx * S.ny, grid = new Array(n);
  for (let p = 0; p < n; p++) grid[p] = S.fields.map(f => (f[p] >= 0 ? f[p] : null));
  return { name: 'SILAM', times: S.times, st: stations.map(s => seriesAt(S, s.lat, s.lon)), grid, gdef: { lon0: S.lon0, lat0: S.lat0, step: S.step, nx: S.nx, ny: S.ny } };
}

/** The page's file (data/silam.json): hours from tFrom on, same encoding as the extracts (integers × 10, differences along x). */
export function forPage(S, tFrom) {
  const k0 = Math.max(0, S.times.findIndex(t => t >= tFrom));
  const values = S.fields.slice(k0).map(f => { const out = new Array(f.length);
    for (let y = 0; y < S.ny; y++) { let prev = 0; for (let x = 0; x < S.nx; x++) { const k = y * S.nx + x, q = f[k] >= 0 ? Math.round(f[k] * 10) : -10; out[k] = q - prev; prev = q; } }
    return out; });
  return { run: S.run, runs: S.runs, source: S.source, lon0: S.lon0, lat0: S.lat0, step: S.step, nx: S.nx, ny: S.ny, times: S.times.slice(k0), scale: 10, enc: 'int-dx', values };
}

/** The newest runs (up to `keep`, run dates within the last `maxAgeD` days) from the history folder, joined; null if none. */
export async function loadSilam(histDir, now, { keep = 2, maxAgeD = 3, log = () => {} } = {}) {
  const files = [];
  for (const e of await fs.readdir(histDir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory())
    for (const f of await fs.readdir(path.join(histDir, e.name)).catch(() => [])) { const m = /^silam-(\d{8})\.json$/.exec(f); if (m) files.push([m[1], path.join(histDir, e.name, f)]); }
  const minRun = new Date(now - maxAgeD * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const pick = files.filter(([d]) => d >= minRun).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, keep);
  const runs = []; for (const [d, f] of pick) { try { runs.push(decodeRun(JSON.parse(await fs.readFile(f, 'utf8')))); } catch (e) { log(`SILAM run ${d} unreadable: ${e.message}`); } }
  return combineRuns(runs);
}

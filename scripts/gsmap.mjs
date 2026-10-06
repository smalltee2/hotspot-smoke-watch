// Live forecast only: observed rain from JAXA GSMaP (gauge-calibrated, 0.1°, hourly), sftp://hokusai.eorc.jaxa.jp
//   older hours: GSMaP_Gauge_NRT v6   /realtime/hourly_G/YYYY/MM/DD/gsmap_gauge.YYYYMMDD.HH00.dat.gz      (about 4-5 h behind real time)
//   newest hours: GSMaP_Gauge_NOW     /now/half_hour_G/YYYY/MM/DD/gsmap_gauge_now.YYYYMMDD.HH00.dat.gz   (about 1-2 h behind)
//   an hour first taken from NOW is replaced by NRT once NRT has it.
// File format (GrADS control files on the server): float32 little-endian, 3600 × 1200, lon 0.05..359.95, lat 59.95 (first row)
// .. -59.95 (YREV), hourly averaged rain rate in mm/h over the hour that STARTS at HH:00; negative = missing.
// Needs GSMAP_USER / GSMAP_PASS and the server key in ~/.ssh/known_hosts (the workflow pins it); without them it does nothing.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

export const GSCFG = { host: 'hokusai.eorc.jaxa.jp', keepH: 48, webH: 24, lon0: 92.05, lat0: 5.05, nx: 180, ny: 200 };   // crop 92-110 E, 5-25 N (cell centres)
const HOUR = 3600e3, NX = 3600, NY = 1200;
const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, ''), hh = t => new Date(t).toISOString().slice(11, 13);
const dir = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '/');
const nrtPath = t => `/realtime/hourly_G/${dir(t)}/gsmap_gauge.${ymd(t)}.${hh(t)}00.dat.gz`;
const nowPath = t => `/now/half_hour_G/${dir(t)}/gsmap_gauge_now.${ymd(t)}.${hh(t)}00.dat.gz`;

// global file -> Int16 crop, rows south to north, 0.1 mm/h, -1 missing
export function cropGsmap(buf, c = GSCFG) {
  const raw = zlib.gunzipSync(buf);
  if (raw.length !== NX * NY * 4) throw new Error(`unexpected size ${raw.length}`);
  const out = new Int16Array(c.nx * c.ny), i0 = Math.round((c.lon0 - 0.05) / 0.1);
  for (let y = 0; y < c.ny; y++) {
    const lat = c.lat0 + y * 0.1, j = Math.round((59.95 - lat) / 0.1);
    for (let x = 0; x < c.nx; x++) { const v = raw.readFloatLE((j * NX + i0 + x) * 4); out[y * c.nx + x] = v < 0 || !isFinite(v) ? -1 : Math.min(3000, Math.round(v * 10)); }
  }
  return out;
}
const pack = a => zlib.deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { level: 9 }).toString('base64');
export const unpack = s => { const b = zlib.inflateSync(Buffer.from(s, 'base64')); return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2); };

function sftpBatch(lines, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, SSHPASS: process.env.GSMAP_PASS };
    const p = execFile('sshpass', ['-e', 'sftp', '-oBatchMode=no', '-oStrictHostKeyChecking=yes', '-P', '22', '-b', '-', `${process.env.GSMAP_USER}@${GSCFG.host}`],
      { cwd, env, timeout: 15 * 60e3, maxBuffer: 8 << 20 }, (err, so, se) => resolve({ err, out: String(so) + String(se) }));
    p.stdin.end(lines.join('\n') + '\n');
  });
}

// cache: { hours: { [t_ms]: { src: 'nrt'|'now', d: base64 } } }; returns the updated cache
export async function updateGsmap(cache, now, { log = console.log } = {}) {
  cache ||= { hours: {} }; cache.hours ||= {};
  for (const k of Object.keys(cache.hours)) if (+k < now - GSCFG.keepH * HOUR) delete cache.hours[k];
  if (!process.env.GSMAP_USER || !process.env.GSMAP_PASS) { log('GSMaP: no credentials, observed rain skipped'); return cache; }
  const tEnd = Math.floor(now / HOUR) * HOUR - HOUR, want = [];
  for (let t = tEnd; t >= now - GSCFG.keepH * HOUR; t -= HOUR) { const c = cache.hours[t]; if (!c || c.src !== 'nrt') want.push(t); }
  if (!want.length) return cache;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'gsmap-')), lines = [];
  for (const t of want) { lines.push(`-get ${nrtPath(t)} nrt_${t}.gz`); if (!cache.hours[t] && now - t < 8 * HOUR) lines.push(`-get ${nowPath(t)} now_${t}.gz`); }
  const r = await sftpBatch(lines, tmp);
  if (r.err && !/Fetching|not found|No such file/i.test(r.out)) log(`GSMaP sftp: ${String(r.err.message).slice(0, 200)}`);
  let nN = 0, nW = 0, bad = 0;
  for (const t of want) {
    for (const [src, f] of [['nrt', `nrt_${t}.gz`], ['now', `now_${t}.gz`]]) {
      let b; try { b = await fs.readFile(path.join(tmp, f)); } catch { continue; }
      try { cache.hours[t] = { src, d: pack(cropGsmap(b)) }; src === 'nrt' ? nN++ : nW++; break; } catch (e) { bad++; log(`GSMaP ${f}: ${e.message}`); }
    }
  }
  await fs.rm(tmp, { recursive: true, force: true });
  const ts = Object.keys(cache.hours).map(Number).sort((a, b) => a - b);
  log(`GSMaP: ${nN} NRT + ${nW} NOW hours read${bad ? `, ${bad} unreadable` : ''}; ${ts.length} hours held, latest hour starting ${ts.length ? new Date(ts[ts.length - 1]).toISOString().slice(0, 13) + 'Z' : '–'}`);
  return cache;
}

// observed rain as the met pr (mm in the hour ENDING at the met time): node value = mean of the 0.1° cells within the node's box;
// replaces the ECMWF value only where ≥ 50 % of the cells are valid. Returns the verification against the replaced ECMWF values.
export function mergeIntoMet(M, cache) {
  const c = GSCFG, hours = new Map(Object.entries(cache?.hours || {}).map(([k, v]) => [+k, v]));
  if (!hours.size) return null;
  const pairs = [];   // [ecmwf, observed] at north-grid nodes, for the log
  let nRep = 0, tLast = -Infinity;
  for (let k = 0; k < M.times.length; k++) {
    const h = hours.get(M.times[k] - HOUR); if (!h) continue;
    const a = unpack(h.d); tLast = Math.max(tLast, M.times[k]);
    M.grids.forEach((g, gi) => {
      const n = g.nx * g.ny, half = g.step / 2;
      for (let p = 0; p < n; p++) {
        const la = g.lat0 + Math.floor(p / g.nx) * g.step, lo = g.lon0 + (p % g.nx) * g.step;
        const x0 = Math.max(0, Math.ceil((lo - half - c.lon0) / 0.1 - 1e-6)), x1 = Math.min(c.nx - 1, Math.floor((lo + half - c.lon0) / 0.1 + 1e-6));
        const y0 = Math.max(0, Math.ceil((la - half - c.lat0) / 0.1 - 1e-6)), y1 = Math.min(c.ny - 1, Math.floor((la + half - c.lat0) / 0.1 + 1e-6));
        if (x1 < x0 || y1 < y0) continue;
        let s = 0, v = 0, all = (x1 - x0 + 1) * (y1 - y0 + 1);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const q = a[y * c.nx + x]; if (q >= 0) { s += q / 10; v++; } }
        if (v < 0.5 * all) continue;
        const i = k * n + p, ob = Math.round(s / v * 10) / 10;
        if (gi === 0) pairs.push([g.data.pr[i], ob]);
        g.data.pr[i] = ob; nRep++;
      }
    });
  }
  if (!pairs.length) return { nRep, tLast };
  const sE = pairs.reduce((a, p) => a + p[0], 0), sO = pairs.reduce((a, p) => a + p[1], 0);
  const wetE = pairs.filter(p => p[0] >= 0.5), wetO = pairs.filter(p => p[1] >= 0.5), hit = pairs.filter(p => p[0] >= 0.5 && p[1] >= 0.5).length;
  const mE = sE / pairs.length, mO = sO / pairs.length, cov = pairs.reduce((a, p) => a + (p[0] - mE) * (p[1] - mO), 0);
  const sdE = Math.sqrt(pairs.reduce((a, p) => a + (p[0] - mE) ** 2, 0)), sdO = Math.sqrt(pairs.reduce((a, p) => a + (p[1] - mO) ** 2, 0));
  return { nRep, tLast, n: pairs.length, ratio: sO > 0 ? +(sE / sO).toFixed(2) : null, r: sdE && sdO ? +(cov / sdE / sdO).toFixed(2) : null,
           pod: wetO.length ? +(hit / wetO.length).toFixed(2) : null, far: wetE.length ? +(1 - hit / wetE.length).toFixed(2) : null };
}

// page file: the last webH hours of 0.1° observed rain, deflated Int16 per hour (rows south to north, 0.1 mm/h, -1 missing)
export function webRain(cache, now) {
  const c = GSCFG, ts = Object.keys(cache?.hours || {}).map(Number).filter(t => t >= now - GSCFG.webH * HOUR).sort((a, b) => a - b);
  if (!ts.length) return null;
  return { source: 'JAXA GSMaP gauge-calibrated (Gauge_NRT v6 / Gauge_NOW), hourly mean rain rate over the hour starting at each time',
           lon0: c.lon0, lat0: c.lat0, step: 0.1, nx: c.nx, ny: c.ny, scale: 10, enc: 'deflate-int16', times: ts, src: ts.map(t => cache.hours[t].src), d: ts.map(t => cache.hours[t].d) };
}

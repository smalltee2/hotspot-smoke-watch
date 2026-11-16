// Unit tests of the PARDIG observed rain: node --test scripts/pardig.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDCFG, cropFrame, hourMean, remapHalfCell, obsRain, frameUrl } from './pardig.mjs';

const GX = 3600, GY = 1801;
const pack = a => zlib.deflateSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).toString('base64');
const unpack = s => { const b = zlib.inflateSync(Buffer.from(s, 'base64')); return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

test('frame URL: one store per 15-min frame, named by its UTC time', () => {
  assert.equal(frameUrl(Date.parse('2026-11-15T22:30:00Z')), 'https://storage.googleapis.com/pardig_1/NRT/zarr/2026_to_present/20261115T223000/predictions.zarr/precipitation/c/0/0');
});
test('crop: global frame (row 0 = 90° S, m/h) -> our box, south to north, 0.1 mm/h, missing -1', () => {
  const g = new Float32Array(GX * GY);
  const put = (lat, lon, v) => { g[Math.round((lat + 90) * 10) * GX + Math.round(lon * 10)] = v; };
  put(5.0, 92.0, 0.0012);      // 1.2 mm/h at the box's south-west cell
  put(25.0, 110.0, 0.0305);    // 30.5 mm/h at its north-east cell
  put(13.7, 100.5, NaN);       // missing
  put(13.8, 100.5, -1);        // negative = missing
  put(4.9, 92.0, 0.009);       // just outside: not in the crop
  const c = cropFrame(g);
  assert.equal(c.length, PDCFG.nx * PDCFG.ny);
  assert.equal(c[0], 12);
  assert.equal(c[(PDCFG.ny - 1) * PDCFG.nx + PDCFG.nx - 1], 305);
  const at = (lat, lon) => c[Math.round((lat - PDCFG.lat0) * 10) * PDCFG.nx + Math.round((lon - PDCFG.lon0) * 10)];
  assert.equal(at(13.7, 100.5), -1);
  assert.equal(at(13.8, 100.5), -1);
  assert.equal(at(5.1, 92.0), 0);
  assert.throws(() => cropFrame(new Float32Array(10)), /grid size/);
});
test('hourly mean: trapezoid over t … t+60 min; missing in any frame -> missing', () => {
  // three cells, frames t, t+15, t+30, t+45, t+60
  const f = [[0, 10, -1], [0, 10, 5], [40, 10, 5], [0, 10, 5], [0, 10, 5]].map(r => Int16Array.from(r));
  const m = hourMean(f);
  assert.equal(m[0], 10);   // a 40 at t+30 alone: 40 / 4
  assert.equal(m[1], 10);   // steady
  assert.equal(m[2], -1);
  // the end frames count half: 8 at t and t+60, 0 between -> 8 / 4 = 2
  assert.equal(hourMean([[8], [0], [0], [0], [8]].map(a => Int16Array.from(a)))[0], 2);
});
test('remap: GSMaP centres (x.x5°) -> PARDIG centres (x.x0°), mean of the four around, missing left out', () => {
  const s = { lon0: 92.05, lat0: 5.05, nx: 3, ny: 3 }, a = Int16Array.from([10, 20, 30, 40, 50, 60, 70, 80, -1]);
  const c = { lon0: 92.1, lat0: 5.1, nx: 2, ny: 2 };
  const r = remapHalfCell(a, s, c);
  assert.equal(r[0], 30);                        // (10 + 20 + 40 + 50) / 4, centred at 92.1, 5.1
  assert.equal(r[1], 40);                        // (20 + 30 + 50 + 60) / 4
  assert.equal(r[3], Math.round((50 + 60 + 80) / 3));   // the missing cell left out
  const edge = remapHalfCell(a, s, { lon0: 92.0, lat0: 5.0, nx: 1, ny: 1 });
  assert.equal(edge[0], 10);                     // only one source cell inside the box
});
test('observed rain: PARDIG where it has the hour, else GSMaP remapped; PARDIG off -> GSMaP everywhere', () => {
  const n = PDCFG.nx * PDCFG.ny, gs = { lon0: 92.05, lat0: 5.05, nx: 180, ny: 200 };
  const pd = new Int16Array(n).fill(7), g = new Int16Array(gs.nx * gs.ny).fill(3);
  const pcache = { hours: { 1000: { src: 'pardig', d: pack(pd) } } }, gcache = { hours: { 1000: { src: 'nrt', d: pack(g) }, 2000: { src: 'now', d: pack(g) } } };
  const on = obsRain(pcache, gcache, gs, true);
  assert.deepEqual(Object.keys(on.hours).sort(), ['1000', '2000']);
  assert.equal(on.hours[1000].src, 'pardig'); assert.equal(unpack(on.hours[1000].d)[500], 7);
  assert.equal(on.hours[2000].src, 'now'); assert.equal(unpack(on.hours[2000].d)[500], 3);
  assert.equal(unpack(on.hours[2000].d).length, n);
  assert.notEqual(on.hours[1000], pcache.hours[1000]);   // a copy: decoded fields cached on it never reach the stored cache
  assert.deepEqual(on.grid, { lon0: PDCFG.lon0, lat0: PDCFG.lat0, nx: PDCFG.nx, ny: PDCFG.ny, step: 0.1 });
  const off = obsRain(pcache, gcache, gs, false);
  assert.equal(off.hours[1000].src, 'nrt');
  assert.deepEqual(Object.keys(obsRain(pcache, null, gs, true).hours), ['1000']);
  assert.deepEqual(obsRain(null, null, gs, true).hours, {});
});

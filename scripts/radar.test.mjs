// Unit tests of the radar coverage (scripts/radar.mjs): node --test scripts/radar.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteEchoes, echoCover, clipField, RVCFG } from './radar.mjs';

test('echo footprint: counts only cells with rain, never zeros or missing cells', () => {
  const c = new Uint16Array(5); assert.equal(noteEchoes(c, Int16Array.from([0, -1, 1, 25, 0])), 2); assert.deepEqual([...c], [0, 0, 1, 1, 0]);
});
test('coverage reaches echoRadius cells around an echo (a square), nothing beyond; no echo, no coverage', () => {
  const nx = 41, ny = 41, c = new Uint16Array(nx * ny), r = RVCFG.echoRadius; c[20 * nx + 20] = 3;
  const cov = echoCover(c, nx, ny, r);
  assert.equal(cov[20 * nx + 20 + r], 1); assert.equal(cov[(20 + r) * nx + 20 - r], 1);
  assert.equal(cov[20 * nx + 20 + r + 1], 0); assert.equal(cov[(20 - r - 1) * nx + 20], 0);
  assert.equal(cov.reduce((a, v) => a + v, 0), (2 * r + 1) ** 2);
  assert.equal(echoCover(new Uint16Array(nx * ny), nx, ny, r).reduce((a, v) => a + v, 0), 0);
});
test('clipping: dry cells outside coverage become missing (the forecast or satellite is used there); idempotent', () => {
  const a = Int16Array.from([0, 5, 0, -1]), cov = Uint8Array.from([1, 1, 0, 0]);
  assert.equal(clipField(a, cov), true); assert.deepEqual([...a], [0, 5, -1, -1]); assert.equal(clipField(a, cov), false);
});
import zlib from 'node:zlib';
import { updateRadar, tileList, GRID, radarAt } from './radar.mjs';
// a 512 × 512 RGBA PNG, transparent but for an optional square of one colour
function png(fill) { const S = RVCFG.size, raw = Buffer.alloc((S * 4 + 1) * S);
  if (fill) for (let y = fill.y0; y < fill.y1; y++) for (let x = fill.x0; x < fill.x1; x++) raw.set(fill.rgba, y * (S * 4 + 1) + 1 + x * 4);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); }
test('updateRadar: with an all-covered API mask, only the echo footprint is kept as measured; the rest is missing', async () => {
  const now = Date.UTC(2026, 10, 24, 12, 5), t0 = Math.floor(now / 3600e3) * 3600e3 - 3600e3, frames = [1, 2, 3, 4, 5, 6].map(k => ({ time: (t0 + k * 600e3) / 1000, path: '/v2/radar/' + k }));
  const [ex, ey] = tileList()[0], rain = png({ x0: 200, x1: 220, y0: 200, y1: 220, rgba: [0x00, 0x55, 0x88, 0xff] }), clear = png(null);
  const get = async u => ({ json: async () => ({ host: 'https://tiles', radar: { past: frames } }), arrayBuffer: async () => (u.includes('/coverage/') ? clear : u.includes(`/${ex}/${ey}/`) ? rain : clear) });
  const c = await updateRadar(null, now, { get, sleep: async () => {}, log: () => {} });
  assert.ok(c.mask && c.cover); assert.ok(c.cover.covered > 0 && c.cover.covered < 0.05, `coverage ${c.cover.covered}`);
  const h = Object.keys(c.hours).map(Number)[0]; assert.ok(h);
  const [W, , , N] = RVCFG.bbox, n = 2 ** RVCFG.z, DEG = Math.PI / 180;   // a point inside the echo square, and one far away (still inside the box)
  const lon = (ex + 210 / 512) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (ey + 210 / 512) / n))) / DEG;
  assert.ok(radarAt(c, lat, lon, h) > 0, 'echo kept'); assert.equal(radarAt(c, 6, 105.5, h), null, 'far from any echo: missing, not dry');
  const c2 = await updateRadar(c, now + 600e3, { get, sleep: async () => {}, log: () => {} }); assert.equal(c2.cover.covered, c.cover.covered);   // the counts carry over
});

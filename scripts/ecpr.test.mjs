import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { decodeEcpr, ecprAt, logCols } from './ecpr.mjs';

const H = 3600e3, RUN = Date.UTC(2026, 10, 28, 0);
// hand-made file: 3 × 2 nodes at 0.25° from 100 E, 10 N; two blocks (0, 3] h and (3, 9] h; values mm/h × 10, rows south to north
const enc = v => zlib.deflateSync(Buffer.from(new Int16Array(v).buffer)).toString('base64');
const DOC = { run: RUN, lon0: 100, lat0: 10, step: 0.25, nx: 3, ny: 2, scale: 10, enc: 'deflate-int16',
  t0: [RUN, RUN + 3 * H], t1: [RUN + 3 * H, RUN + 9 * H], d: [enc([0, 10, 20, 40, 50, 60]), enc([5, 5, 5, 5, 5, 300])] };
const E = decodeEcpr(DOC);

test('decodes the blocks as the page does (deflate Int16)', () => {
  assert.equal(E.a.length, 2); assert.deepEqual([...E.a[0]], [0, 10, 20, 40, 50, 60]); assert.equal(E.d, undefined);
  assert.equal(decodeEcpr(null), null); assert.equal(decodeEcpr({ run: 1 }), null);
});

test('nodes, bilinear, units mm/h', () => {
  assert.equal(ecprAt(E, 10, 100, RUN + H), 0);
  assert.equal(ecprAt(E, 10, 100.25, RUN + H), 1);
  assert.equal(ecprAt(E, 10.25, 100.5, RUN + H), 6);   // the north-east corner (x0, y0 held at nx-2, ny-2)
  assert.ok(Math.abs(ecprAt(E, 10.125, 100.125, RUN + H) - (0 + 1 + 4 + 5) / 4) < 1e-12);
  assert.ok(Math.abs(ecprAt(E, 10.0625, 100.375, RUN + H) - (0.75 * (0.5 * 1 + 0.5 * 2) + 0.25 * (0.5 * 5 + 0.5 * 6))) < 1e-12);
});

test('block holding the middle of the hour ending t', () => {
  assert.equal(ecprAt(E, 10, 100, RUN), undefined);           // hour ending at the run start: middle before t0
  assert.equal(ecprAt(E, 10.25, 100.5, RUN + 3 * H), 6);      // hour 02-03: middle 02:30 in (0, 3]
  assert.equal(ecprAt(E, 10.25, 100.5, RUN + 4 * H), 30);     // hour 03-04: middle 03:30 in (3, 9]
  assert.equal(ecprAt(E, 10.25, 100.5, RUN + 9 * H), 30);
  assert.equal(ecprAt(E, 10.25, 100.5, RUN + 10 * H), undefined);   // beyond the run
});

test('outside the box or without a file: undefined (the page falls back to the met rain)', () => {
  assert.equal(ecprAt(null, 10, 100, RUN + H), undefined);
  assert.equal(ecprAt(E, 9.99, 100, RUN + H), undefined);
  assert.equal(ecprAt(E, 10, 99.99, RUN + H), undefined);
  assert.equal(ecprAt(E, 10.26, 100, RUN + H), undefined);
  assert.equal(ecprAt(E, 10, 100.51, RUN + H), undefined);
});

test('same as the page code on the same data', () => {
  // the page's ecprAt, copied from index.html (its per-hour cache of the block index kept)
  function pageEcprAt(ECPR, lat, lon, t) { const E = ECPR; if (!E) return undefined; const m = t - 1800e3;
    if (E._t !== m) { E._t = m; E._k = E.t1.findIndex((t1, i) => m > E.t0[i] && m <= t1); } const k = E._k; if (k < 0) return undefined;
    const fx = (lon - E.lon0) / E.step, fy = (lat - E.lat0) / E.step; if (fx < 0 || fy < 0 || fx > E.nx - 1 || fy > E.ny - 1) return undefined;
    const x0 = Math.min(E.nx - 2, Math.floor(fx)), y0 = Math.min(E.ny - 2, Math.floor(fy)), ax = fx - x0, ay = fy - y0, a = E.a[k], i = y0 * E.nx + x0;
    return ((1 - ax) * (1 - ay) * a[i] + ax * (1 - ay) * a[i + 1] + (1 - ax) * ay * a[i + E.nx] + ax * ay * a[i + E.nx + 1]) / E.scale; }
  const P = decodeEcpr(DOC);
  for (let h = -1; h <= 11; h++) for (let lat = 9.9; lat <= 10.35; lat += 0.037) for (let lon = 99.9; lon <= 100.6; lon += 0.041)
    assert.equal(ecprAt(E, lat, lon, RUN + h * H), pageEcprAt(P, lat, lon, RUN + h * H));
});

test('log columns follow the header of an existing file', () => {
  const HDR = 'a,b,c,d';
  assert.equal(logCols(null, HDR), 4);                    // new file: full header
  assert.equal(logCols('a,b,c,d\n1,2,3,4\n', HDR), 4);
  assert.equal(logCols('a,b,c\n1,2,3\n', HDR), 3);        // begun before d was added: keep 3 columns
  assert.equal(logCols('a,b\r\n1,2\r\n', HDR), 2);
  assert.equal(logCols('x,y\n', HDR), 4);                 // not a prefix: as before (full rows)
  assert.equal(logCols('a,b,cc\n', HDR), 4);
});

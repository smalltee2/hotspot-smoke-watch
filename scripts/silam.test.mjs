// Unit tests of the SILAM reader: node --test scripts/silam.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRun, combineRuns, valueAt, seriesAt, asModel, forPage } from './silam.mjs';
const near = (a, b, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

const H = 3600e3, T0 = Date.UTC(2026, 10, 20, 1);
// a 3 × 2 grid (rows south to north), encoded as the extracts are: integers × 10, differences along x, −10 = missing
const enc = rows => rows.map(r => r.map((q, x) => (x ? q - r[x - 1] : q))).flat();
const doc = (run, t0, hours, val) => ({ run, lon0: 100, lat0: 10, step: 0.2, nx: 3, ny: 2, scale: 10, enc: 'int-dx',
  times: Array.from({ length: hours }, (_, k) => t0 + k * H), values: Array.from({ length: hours }, (_, k) => enc(val(k))) });

test('decode: differences along x, × 10, missing cells', () => {
  const d = decodeRun(doc('20261120', T0, 2, k => [[100 + k, 120, -10], [80, 90, 100]]));
  assert.equal(d.fields.length, 2);
  assert.deepEqual([...d.fields[0]].slice(0, 2), [10, 12]); assert.ok(Number.isNaN(d.fields[0][2]));
  assert.deepEqual([...d.fields[1]].slice(3), [8, 9, 10]); near(d.fields[1][0], 10.1);
});
test('combine: the newer run wins; the older one supplies the earlier hours; hours stay consecutive', () => {
  const old = decodeRun(doc('20261119', T0 - 24 * H, 48, () => [[10, 10, 10], [10, 10, 10]]));
  const neu = decodeRun(doc('20261120', T0, 48, () => [[20, 20, 20], [20, 20, 20]]));
  const c = combineRuns([old, neu]);
  assert.equal(c.times.length, 72); assert.equal(c.times[0], T0 - 24 * H); assert.equal(c.times.at(-1), T0 + 47 * H);
  assert.equal(c.fields[0][0], 1); assert.equal(c.fields[24][0], 2); assert.equal(c.fields[71][0], 2);
  assert.deepEqual(c.runs.sort(), ['20261119', '20261120']); assert.equal(c.run, '20261120');
  // a gap before the newer run: only the consecutive hours ending at the last hour are kept
  const gap = combineRuns([decodeRun(doc('20261118', T0 - 60 * H, 10, () => [[1, 1, 1], [1, 1, 1]])), neu]);
  assert.equal(gap.times[0], T0); assert.equal(gap.times.length, 48);
  assert.equal(combineRuns([]), null);
});
test('bilinear value, series at a station, model shapes and the page file', () => {
  const S = combineRuns([decodeRun(doc('20261120', T0, 3, k => [[100, 200, 300], [100, 200, 300 + k * 10]]))]);
  near(valueAt(S, S.fields[0], 10, 100.1), 15);            // halfway between 10 and 20
  near(valueAt(S, S.fields[0], 10.1, 100.3), 25);
  assert.equal(valueAt(S, S.fields[0], 9.9, 100), null);           // outside
  assert.deepEqual(seriesAt(S, 10.2, 100.4), [30, 31, 32]);
  const M = asModel(S, [{ lat: 10, lon: 100 }]);
  assert.equal(M.grid.length, 6); assert.deepEqual(M.grid[5], [30, 31, 32]); assert.deepEqual(M.st[0], [10, 10, 10]);
  assert.deepEqual(M.gdef, { lon0: 100, lat0: 10, step: 0.2, nx: 3, ny: 2 });
  const P = forPage(S, T0 + H); assert.equal(P.times.length, 2);
  assert.deepEqual([...decodeRun({ ...P, run: 'x' }).fields[1]], [...S.fields[2]]);   // round trip
});

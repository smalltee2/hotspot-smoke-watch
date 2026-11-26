import { test } from 'node:test'; import assert from 'node:assert/strict';
import { dropSpikes } from './obsqc.mjs';
const H = 3600e3, ser = vals => vals.map((v, i) => [i * H, v]);
test('the a4t:19t fault of 25 Nov 2026 is dropped, both hours', () => {
  const { kept, dropped } = dropSpikes(ser([50, 54, 33, 904, 998, 37]));
  assert.deepEqual(dropped.map(r => r[1]), [904, 998]); assert.deepEqual(kept.map(r => r[1]), [50, 54, 33, 37]); });
test('a real smoke rise is kept', () => {
  assert.equal(dropSpikes(ser([31, 153, 221, 180])).dropped.length, 0);
  assert.equal(dropSpikes(ser([60, 140, 320, 450, 400])).dropped.length, 0); });
test('a first value or one after a gap of more than 3 h is kept', () => {
  assert.equal(dropSpikes([[0, 900]]).dropped.length, 0);
  assert.equal(dropSpikes([[0, 20], [5 * H, 900]]).dropped.length, 0); });

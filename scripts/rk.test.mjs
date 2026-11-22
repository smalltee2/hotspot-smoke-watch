// Unit tests of the residual kriging: node --test scripts/rk.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { krige } from './rk.mjs';

const v = { c0: 0.01, c1: 0.06, a: 50 }, maxKm = 150;
test('no seams: the estimate changes smoothly across the edge of the search radius, also with only 1–3 sparse monitors', () => {
  const pts = [[9.1, 99.3], [8.4, 99.9], [7.0, 100.5]], res = [-0.4, -0.45, -0.5];
  let prev = null, maxJump = 0;
  for (let lo = 96; lo <= 104; lo += 0.01) { const k = krige(pts, res, v, 8.5, lo, { maxKm }); if (prev != null) maxJump = Math.max(maxJump, Math.abs(k.est - prev)); prev = k.est; }
  assert.ok(maxJump < 0.01, `largest step ${maxJump}`);
  const one = krige([[21, 105.8]], [0.5], v, 21, 105.8, { maxKm }); assert.ok(one.est > 0.2);   // a lone monitor still corrects its surroundings
});
test('far from every monitor the correction is 0; at a monitor it is close to the monitor', () => {
  const pts = [[13.7, 100.5], [13.8, 100.6], [13.6, 100.4], [13.75, 100.45]], res = [0.3, 0.32, 0.28, 0.31];
  assert.equal(krige(pts, res, v, 20, 100.5, { maxKm }).est, 0);
  const k = krige(pts, res, v, 13.7, 100.5, { maxKm }); assert.ok(Math.abs(k.est - 0.3) < 0.08, String(k.est)); assert.ok(k.varOK >= 0 && k.varOK <= v.c0 + v.c1);
  assert.ok(isFinite(krige([[13.7, 100.5], [13.7, 100.5]], [0.2, 0.25], v, 13.7, 100.5, { maxKm }).est));   // two monitors at one spot
});

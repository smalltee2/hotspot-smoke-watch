// Unit tests of the climatology-blend fit: node --test scripts/fit_clim_blend.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blend, fitLead, FIT } from './fit_clim_blend.mjs';

test('blend in log space: w = 0 keeps the forecast, w = 1 gives the climatology, between is geometric', () => {
  assert.ok(Math.abs(blend(80, 20, 0) - 80) < 1e-9); assert.ok(Math.abs(blend(80, 20, 1) - 20) < 1e-9);
  assert.ok(Math.abs(blend(80, 20, 0.5) - (Math.sqrt(81 * 21) - 1)) < 1e-9);
});
test('a forecast that is far too high on clean days: the fit pulls it toward the climatology, keeping the high hours', () => {
  const rows = []; for (let i = 0; i < 3000; i++) rows.push([60, 15, 15]);   // forecast 60, usual and measured 15
  for (let i = 0; i < 200; i++) rows.push([90, 20, 80]);                     // real haze: still caught after the pull
  const r = fitLead(rows); assert.ok(r.decided); assert.ok(r.w > 0); assert.ok(r.best.rmse < r.base.rmse);
  assert.ok(r.best.hit >= r.base.hit); assert.ok(r.best.fa <= r.base.fa);
});
test('a pull that would miss high hours is refused; too few rows keep 0', () => {
  const rows = []; for (let i = 0; i < 3000; i++) rows.push([20, 20, 21]);
  for (let i = 0; i < 100; i++) rows.push([45, 10, 50]);                     // a haze episode the climatology does not know
  assert.equal(fitLead(rows).w, 0);
  const few = Array.from({ length: 100 }, () => [60, 15, 15]); const r = fitLead(few);
  assert.equal(r.decided, false); assert.equal(r.w, 0); assert.ok(FIT.minRows > 100);
});

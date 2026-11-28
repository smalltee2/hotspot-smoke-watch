import test from 'node:test';
import assert from 'node:assert/strict';
import { climW, climActive, climBlendSeries, blendLn } from './climblend.mjs';
import { blend } from './fit_clim_blend.mjs';

const H = 3600e3, hours = Array.from({ length: 100 }, (_, i) => i * H), jNow = 3;
test('weights: zero before the first lead, linear between, last beyond', () => {
  const tab = [[24, 0.2], [48, 0.4], [72, 0]];
  assert.equal(climW(tab, 12), 0); assert.equal(climW(tab, 24), 0.2); assert.ok(Math.abs(climW(tab, 36) - 0.3) < 1e-12);
  assert.equal(climW(tab, 72), 0); assert.equal(climW(tab, 90), 0); assert.equal(climW([], 30), 0);
});
test('all weights zero: nothing changes (the state until the fit has run)', () => {
  const tab = [[24, 0], [48, 0], [72, 0], [96, 0]], corr = hours.map(() => 50);
  assert.equal(climActive(tab), false); assert.equal(climBlendSeries(corr, corr.slice(), hours, jNow, tab, () => Math.log(11)), null);
});
test('same formula as the fit, only on forecast hours with a weight and a climatology', () => {
  const tab = [[24, 0.5], [48, 0.5]], corr = hours.map(() => 50), fc24 = hours.map(() => 50), r = climBlendSeries(corr, fc24, hours, jNow, tab, () => Math.log(10 + 1));
  assert.equal(r.corr[jNow + 23], 50); assert.equal(r.corr[jNow], 50);                       // before the first lead
  assert.equal(r.corr[jNow + 24], Math.round(blend(50, 10, 0.5) * 10) / 10); assert.equal(r.corr[jNow + 24], Math.round(blendLn(50, Math.log(11), 0.5) * 10) / 10);
  assert.equal(corr[jNow + 24], 50);                                                         // the input is not touched (it goes to the logs)
  assert.equal(r.fc24[jNow + 23], 50); assert.ok(r.fc24[jNow + 24] < 50 && r.fc24[jNow + 24] > r.corr[jNow + 24]);   // one changed hour of 24
  assert.equal(r.fc24[jNow + 60], r.corr[jNow + 60]);                                        // a window of changed hours only
  assert.equal(climBlendSeries(corr, fc24, hours, jNow, tab, () => NaN), null);              // no climatology for the station
});

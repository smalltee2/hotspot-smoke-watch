import test from 'node:test'; import assert from 'node:assert/strict';
import { PMNOW, errNow, nowcastSeries, storeForecast } from './pmnow.mjs';
const H = 3600e3, t0 = Date.UTC(2026, 10, 28, 10), hours = Array.from({ length: 12 }, (_, k) => t0 + (k - 2) * H), jNow = 2;
test('errNow: the newest hour against the stored forecast, clamped, and only when recent', () => {
  const fc = { [t0 - H]: 19 }; // stored forecast 19 for the hour ending t0-1h
  assert.equal(+errNow([t0 - H, 39], fc, t0).toFixed(4), +Math.log(40 / 20).toFixed(4));
  assert.equal(errNow([t0 - H, 900], fc, t0), PMNOW.maxErr);
  assert.equal(errNow([t0 - 4 * H, 39], { [t0 - 4 * H]: 19 }, t0), null);
  assert.equal(errNow([t0 - H, 39], {}, t0), null);
});
test('nowcastSeries: fades with lead, past hours and leads > 6 h untouched', () => {
  const base = hours.map(() => 20), e = Math.log(2), out = nowcastSeries(base, hours, t0, jNow, e);
  assert.deepEqual(out.slice(0, 3), [20, 20, 20]);                                  // past and current hour
  assert.equal(out[3], Math.round((21 * Math.exp(Math.exp(-1 / 2) * e) - 1) * 10) / 10);   // lead 1: ×2^0.61
  assert.ok(out[3] > out[5] && out[5] > out[8] && out[8] > 20);                     // fading
  assert.equal(out[9], 20);                                                         // lead 7: cut
  assert.deepEqual(nowcastSeries(base, hours, t0, jNow, null), base);
});
test('storeForecast keeps the next hours and drops old ones', () => {
  const st = { x: { [t0 - 20 * H]: 5 } }; storeForecast(st, 'x', hours.map((_, k) => k), hours, jNow, t0);
  assert.equal(st.x[t0 - 20 * H], undefined); assert.equal(st.x[t0 + H], 3); assert.equal(st.x[t0 + 6 * H], 8); assert.equal(st.x[t0 + 7 * H], undefined);
});

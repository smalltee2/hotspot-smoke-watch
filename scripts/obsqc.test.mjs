import { test } from 'node:test'; import assert from 'node:assert/strict';
import { isSpike, resetAfterSpikes, dropSpikes } from './obsqc.mjs';
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
test('hour-keyed maps of the scoring scripts', async () => {
  const { dropSpikesHourKeys } = await import('./obsqc.mjs');
  const m = new Map([['a4t:19t|2026-11-24T18', 54], ['a4t:19t|2026-11-24T19', 33], ['a4t:19t|2026-11-24T20', 904], ['a4t:19t|2026-11-24T21', 998], ['a4t:19t|2026-11-24T22', 37], ['x|2026-11-24T20', 40]]);
  assert.equal(dropSpikesHourKeys(m), 2); assert.equal(m.has('a4t:19t|2026-11-24T20'), false); assert.equal(m.size, 4); });

test('isSpike: a latest value against the recent hours (OpenAQ sensors of Nov 2026)', () => {
  const H = 3600e3, t = Date.parse('2026-11-12T01:00Z');
  assert.equal(isSpike([[t - 3 * H, 18.6], [t - 2 * H, 19], [t - H, 22]], t, 326.5), true);     // 4143986
  assert.equal(isSpike([[t - 2 * H, 80], [t - H, 150]], t, 326.5), false);                      // a real rise
  assert.equal(isSpike([[t - 5 * H, 10]], t, 500), false);                                      // nothing in the last 3 h to compare with
  assert.equal(isSpike([[t, 10]], t, 500), false);                                              // the same hour is not "before"
  assert.equal(isSpike([[t - H, 20]], t, 290), false);                                          // not above 300
});
test('resetAfterSpikes: clears the filters once when they already took the spike hour in', () => {
  const H = 3600e3, t = Date.parse('2026-11-24T20:00Z'), now = t + 5 * H, seen = {};
  const kf = { 'a4t:19t': { t: t + H, b: 3.4 }, 'a4t:05t': { t: t + H, b: 0.1 } }, kfA = { 'a4t:19t': { t: t + H, b: 3.3 } }, kfSlow = {};
  assert.deepEqual(resetAfterSpikes([{ id: 'a4t:19t', t }, { id: 'a4t:19t', t: t + H }], seen, [kf, kfA, kfSlow], now), ['a4t:19t']);
  assert.equal(kf['a4t:19t'], undefined); assert.equal(kfA['a4t:19t'], undefined); assert.equal(kf['a4t:05t'].b, 0.1);
  // the next runs report the same spikes again (48-h window): the rebuilt filter is left alone
  kf['a4t:19t'] = { t: now, b: 0.2 };
  assert.deepEqual(resetAfterSpikes([{ id: 'a4t:19t', t }], seen, [kf, kfA, kfSlow], now + H), []); assert.equal(kf['a4t:19t'].b, 0.2);
  // a spike dropped before any filter saw its hour: nothing to reset
  const kf2 = { x: { t: t - H, b: 0.3 } }; assert.deepEqual(resetAfterSpikes([{ id: 'x', t }], {}, [kf2], now), []); assert.equal(kf2.x.b, 0.3);
  // old entries are pruned
  resetAfterSpikes([], seen, [kf], now + 200 * H); assert.deepEqual(seen, {});
});

import { test } from 'node:test'; import assert from 'node:assert/strict';
import { isSpike, resetAfterSpikes, dropSpikes, neighbourSpikes, stuckNow, NSPIKE, STUCK } from './obsqc.mjs';
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

// neighbour spike test: the station under test at (14, 100), neighbours a few km away, `far` beyond NSPIKE.R
const xy = n => new Map([['s', { lat: 14, lon: 100 }], ...Array.from({ length: n }, (_, i) => ['n' + i, { lat: 14.02 + 0.01 * i, lon: 100.02 }]), ['far', { lat: 16, lon: 100 }]]);
const flat = (n, len, v = 22) => Array.from({ length: n }, (_, i) => ['n' + i, ser(Array(len).fill(v + i % 3))]);
const vals = a => a.map(d => d.v);
test('neighbour spikes: Loei a4t:72t, 27 Nov 2026 (no neighbours): one hour at 104, dropped when the next hour falls back', () => {
  const r = neighbourSpikes(new Map([['s', ser([16, 19, 19, 104, 38, 43, 28])]]), xy(0));
  assert.deepEqual(r.dropped, [{ id: 's', t: 3 * H, v: 104, base: 19, nNb: 0 }]); assert.deepEqual(r.pending, []); });
test('neighbour spikes: a4t:50t, 20 Nov 2026: two hours among many flat neighbours, both dropped', () => {
  const r = neighbourSpikes(new Map([['s', ser([24, 22, 31, 153, 221, 30, 17])], ...flat(12, 7)]), xy(12), NSPIKE, new Set(['s']));
  assert.deepEqual(vals(r.dropped), [153, 221]); assert.equal(r.dropped[0].nNb, 12); assert.deepEqual(r.pending, []); });
test('neighbour spikes: a4t:18t, 24 Nov 2026: a rise that lasts is released, nothing dropped', () => {
  // few of the neighbours rise, and late: the third held hour releases the hold (level lasted L hours)
  const nb = flat(10, 8); nb[0][1] = ser([22, 22, 22, 24, 26, 40, 60, 70]); nb[1][1] = ser([23, 23, 23, 23, 30, 45, 62, 66]);
  const r = neighbourSpikes(new Map([['s', ser([30, 31, 31, 142, 181, 92, 123, 110])], ...nb]), xy(10), NSPIKE, new Set(['s']));
  assert.deepEqual(r, { dropped: [], pending: [] });
  // without neighbours two hours are enough (Liso)
  assert.deepEqual(neighbourSpikes(new Map([['s', ser([14, 14, 14, 66, 67, 30])]]), xy(0)), { dropped: [], pending: [] }); });
test('neighbour spikes: neighbours rising together, or one already as high, never held', () => {
  const up = flat(6, 4); up[0][1] = ser([20, 21, 22, 60]); up[1][1] = ser([22, 22, 24, 58]);   // 2 of 6 >= 20 %
  assert.deepEqual(neighbourSpikes(new Map([['s', ser([20, 20, 20, 100])], ...up]), xy(6)).pending, []);
  const high = flat(6, 4); high[3][1] = ser([70, 70, 70, 70]);                                   // >= 0.6 x 100
  assert.deepEqual(neighbourSpikes(new Map([['s', ser([20, 20, 20, 100])], ...high]), xy(6), NSPIKE, new Set(['s'])).pending, []);
  // a rising station beyond R km is no neighbour; one neighbour alone (< K) cannot confirm
  const r = neighbourSpikes(new Map([['s', ser([20, 20, 20, 100])], ['far', ser([20, 20, 20, 100])], ['n0', ser([20, 20, 20, 100])]]), xy(1), NSPIKE, new Set(['s']));
  assert.deepEqual(vals(r.pending), [100]); assert.equal(r.pending[0].nNb, 1); });
test('neighbour spikes: a hold open at the end of the window is pending; the next hour decides', () => {
  const r = neighbourSpikes(new Map([['s', ser([20, 20, 20, 100])], ...flat(5, 4)]), xy(5), NSPIKE, new Set(['s']));
  assert.deepEqual(r.dropped, []); assert.deepEqual(r.pending, [{ id: 's', t: 3 * H, v: 100, base: 20, nNb: 5 }]);
  assert.deepEqual(vals(neighbourSpikes(new Map([['s', ser([20, 20, 20, 100, 25])], ...flat(5, 5)]), xy(5), NSPIKE, new Set(['s'])).dropped), [100]);
  // the neighbours are only neighbours unless asked for: without `only` every series is tested
  assert.deepEqual(neighbourSpikes(new Map([['s', ser([20, 20, 20, 100])], ...flat(5, 4)]), xy(5)).pending.map(d => d.id), ['s']); });
test('neighbour spikes: a station silent after the jump (a4t:19t) has the held hours dropped; too little history is not judged', () => {
  const nb = flat(4, 12), r = neighbourSpikes(new Map([['s', ser([50, 54, 50, 250, 280])], ...nb]), xy(4), NSPIKE, new Set(['s']));
  assert.deepEqual(vals(r.dropped), [250, 280]); assert.deepEqual(r.pending, []);
  const back = neighbourSpikes(new Map([['s', [[0, 20], [H, 20], [2 * H, 20], [3 * H, 100], [8 * H, 90], [9 * H, 95]]], ...nb]), xy(4), NSPIKE, new Set(['s']));
  assert.deepEqual(vals(back.dropped), [100]);   // 5 h later: the hold is closed, and 90 has no hours before it to be compared with
  assert.deepEqual(neighbourSpikes(new Map([['s', ser([20, 100, 20])]]), xy(0)), { dropped: [], pending: [] }); });

// stuck at zero: sensor 'z' with neighbours within STUCK.R km
const sxy = new Map([['z', { lat: 18, lon: 99 }], ['a', { lat: 18.2, lon: 99 }], ['b', { lat: 18, lon: 99.3 }], ['c', { lat: 17.8, lon: 99.1 }], ['lone', { lat: 12, lon: 105 }]]);
const hrs = (n, f) => Array.from({ length: n }, (_, i) => [i * H, typeof f === 'function' ? f(i) : f]);
test('stuck: flat zeros while the neighbours are at 17 (sensor 2847191, Oct–Nov 2026)', () => {
  const now = 11 * H + 20 * 60e3, st = stuckNow({ z: hrs(12, 0), a: hrs(12, 17), b: hrs(12, 18.5), c: hrs(12, 15) }, sxy, now, []);
  assert.deepEqual([...st], ['z']); assert.deepEqual(st.info.get('z'), { t: 11 * H, v: 0, kind: 'zero', nNb: 3, nbMed: 17 });
  assert.equal(stuckNow({ z: hrs(7, 0), a: hrs(12, 17), b: hrs(12, 18.5) }, sxy, now).size, 0);                              // fewer than minN values
  assert.equal(stuckNow({ z: hrs(12, i => (i % 4 ? 0 : 3)), a: hrs(12, 17), b: hrs(12, 18.5) }, sxy, now).size, 0);          // 75 % zeros < share
  assert.equal(stuckNow({ z: hrs(12, i => (i === 11 ? 2 : 0)), a: hrs(12, 17), b: hrs(12, 18.5) }, sxy, now).size, 0);       // the newest value is not zero
  assert.equal(STUCK.Z, 0.5); assert.equal(stuckNow({ z: hrs(12, 0.4), a: hrs(12, 17), b: hrs(12, 18.5) }, sxy, now).size, 1); });
test('stuck: a clean day, the neighbours also about zero: not stuck', () => {
  const now = 11 * H; assert.equal(stuckNow({ z: hrs(12, 0), a: hrs(12, 0.3), b: hrs(12, 2), c: hrs(12, 4) }, sxy, now).size, 0);
  assert.equal(stuckNow({ z: hrs(12, 0), a: hrs(12, 9), b: hrs(12, 9.8) }, sxy, now).size, 0);   // neighbours' median below T
});
test('stuck: without neighbours only after 48 h of zeros', () => {
  assert.equal(stuckNow({ lone: hrs(12, 0) }, sxy, 11 * H).size, 0); assert.equal(stuckNow({ lone: hrs(28, 0) }, sxy, 27 * H).size, 0);
  const st = stuckNow({ lone: hrs(48, 0), a: hrs(48, 17), b: hrs(48, 17) }, sxy, 47 * H); assert.deepEqual([...st], ['lone']); assert.equal(st.info.get('lone').kind, 'isolated');
  assert.equal(stuckNow({ z: hrs(48, 0), a: hrs(48, 3) }, sxy, 47 * H).size, 1);                // one neighbour (< K) is no witness either way
});
test('stuck: the latch holds until a value above Z, also when the neighbours turn clean or the sensor is silent', () => {
  const clean = { a: hrs(13, 2), b: hrs(13, 3) };
  assert.equal(stuckNow({ z: hrs(13, 0), ...clean }, sxy, 12 * H, []).size, 0);
  const st = stuckNow({ z: hrs(13, 0), ...clean }, sxy, 12 * H, ['z']); assert.deepEqual([...st], ['z']); assert.equal(st.info.get('z').kind, 'latch');
  assert.equal(stuckNow({ z: hrs(13, i => (i === 12 ? 6 : 0)), ...clean }, sxy, 12 * H, ['z']).size, 0);       // reports again
  assert.deepEqual([...stuckNow({ z: hrs(10, 0), ...clean }, sxy, 12 * H, ['z'])], ['z']);                      // no new value: still the old zero
  assert.deepEqual([...stuckNow({ ...clean }, sxy, 12 * H, new Set(['z', 'gone']))], ['z']);                   // dropped out of the history; a station no longer listed is forgotten
  // values after `now` are not looked at; numeric ids come back as strings
  assert.equal(stuckNow({ z: hrs(13, i => (i === 12 ? 6 : 0)), a: hrs(13, 17), b: hrs(13, 17) }, sxy, 11 * H).size, 1);
  assert.deepEqual([...stuckNow(new Map([[7, hrs(12, 0)], ['a', hrs(12, 17)], ['b', hrs(12, 17)]]), new Map([...sxy, ['7', sxy.get('z')]]), 11 * H)], ['7']); });

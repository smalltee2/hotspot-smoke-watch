// Unit tests of the candidate PM2.5 correction: node --test scripts/ml2.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { histFeatures, highScore, rows2From, NAMES2, HIST_NAMES, ML2 } from './ml2.mjs';
import { NAMES } from './ml.mjs';

const H = 3600e3, ln1 = v => Math.log(v + 1), near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const T0 = Date.parse('2026-11-10T00:00:00Z');
// a station whose value is its Thai-independent "hour index" pattern: v(t) = 10 + hour of day (UTC), +100 on one marked hour
const mk = (id, from, to, f) => { const m = new Map(); for (let t = from; t <= to; t += H) { const v = f(t); if (v != null) m.set(`${id}|${t}`, v); } return m; };
const hod = t => new Date(t).getUTCHours();

test('names: the live inputs plus five history inputs', () => {
  assert.equal(NAMES2.length, NAMES.length + 5); assert.deepEqual(NAMES2.slice(-5), HIST_NAMES);
});
test('history: only hours ending by issue − 1 h are used; same hour on the newest known day', () => {
  const tI = T0 + 7 * H + 7 * 60e3, obs = mk('s', T0 - 12 * 24 * H, T0 + 30 * H, t => 10 + hod(t) + (t > T0 + 6 * H ? 1000 : 0));   // values after the cut-off are poisoned
  // lead 3 (valid 10:00): newest known day at 10:00 is yesterday
  let f = histFeatures(obs, 's', tI, T0 + 10 * H);
  near(f[0], ln1(20)); near(f[1], ln1(20)); near(f[4], ln1(20));
  near(f[2], ln1(33));                       // max of the last 24 known hours: hour 23 -> 33
  assert.ok(f.every(v => v < ln1(100)), 'no value from after the cut-off');
  // lead 24 (valid 07:00 tomorrow): 07:00 today is not known yet (cut-off 06:00) -> yesterday 07:00, i.e. 48 h before the valid hour
  f = histFeatures(obs, 's', tI, T0 + 31 * H); near(f[0], ln1(17));
  // lead 23 (valid 06:00 tomorrow): 06:00 today is known -> 24 h before
  f = histFeatures(obs, 's', tI, T0 + 30 * H); near(f[0], ln1(16));
});
test('history: a peak yesterday at this hour is seen; missing data gives NaN, not zero', () => {
  const tI = T0 + 7 * H, peak = T0 - 24 * H + 21 * H;   // 21:00 yesterday
  const obs = mk('s', T0 - 12 * 24 * H, T0 + 6 * H, t => t === peak ? 90 : 12);
  const f = histFeatures(obs, 's', tI, T0 + 21 * H);     // forecast for 21:00 today
  near(f[0], ln1(90)); near(f[1], ln1(12)); near(f[2], ln1(90)); near(f[4], ln1(12));
  assert.ok(f[3] >= ln1(12) && f[3] < ln1(90));          // one hour in 72 does not move the 90th percentile to the peak
  const none = histFeatures(new Map(), 's', tI, T0 + 21 * H); assert.ok(none.every(Number.isNaN));
  const few = histFeatures(mk('s', T0, T0 + 5 * H, () => 12), 's', tI, T0 + 21 * H);   // 6 known hours only
  assert.ok(Number.isNaN(few[2]) && Number.isNaN(few[3]) && Number.isNaN(few[4]));
  assert.ok(histFeatures(obs, 'other', tI, T0 + 21 * H).every(Number.isNaN));
});
test('training rows: leads <= 24 h, target obs − F on the concentration scale, limited', () => {
  const obs = new Map(), base = { tIssue: T0, id: 's', hloc: '7', x: new Array(NAMES.length).fill(0) };
  const rows = rows2From([{ ...base, tValid: T0 + 3 * H, lead: 3, F: 20, obs: 31 }, { ...base, tValid: T0 + 48 * H, lead: 48, F: 20, obs: 31 }, { ...base, tValid: T0 + H, lead: 1, F: 20, obs: 400 }, { ...base, tValid: T0 + H, lead: 1, F: NaN, obs: 3 }], obs);
  assert.equal(rows.length, 2); assert.equal(rows[0].y, 11); assert.equal(rows[1].y, ML2.clip); assert.equal(rows[0].x.length, NAMES2.length); assert.equal(rows[0].hloc, 7);
});
test('check: v2 is published only when it is at least as good on hits, false-alarm share and RMSE, with enough rows', () => {
  const many = (o, a, b, n) => Array.from({ length: n }, () => [o, a, b]);
  // 200 high hours: live catches 50, v2 100; false alarms 30 each; the rest low and equal
  const P = [...many(50, 40, 45, 50), ...many(50, 30, 45, 50), ...many(50, 30, 30, 100), ...many(20, 40, 40, 30), ...many(10, 11, 10, 25000)];
  let k = highScore(P); assert.equal(k.high, 200); assert.equal(k.hit1, 50); assert.equal(k.hit2, 100); assert.ok(k.fa2 < k.fa1); assert.ok(k.rmse2 <= k.rmse1); assert.equal(k.decided, true); assert.equal(k.ok, true);
  assert.equal(highScore(P.map(([o, a, b]) => [o, b, a])).ok, false);            // the other way round: fewer hits
  assert.equal(highScore([...P, ...many(10, 10, 60, 300)]).ok, false);           // many more false alarms
  assert.equal(highScore([...P, ...many(10, 10, 36, 4000)]).ok, false);          // same hits and false alarms, larger error
  k = highScore(P.slice(0, 500)); assert.equal(k.decided, false); assert.equal(k.ok, false);   // too few rows: not decided, live correction kept
});

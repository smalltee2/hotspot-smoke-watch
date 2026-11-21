// Unit tests of the public accuracy summary: node --test scripts/accuracy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACC, band, NEW, addPair, scores, scoreRows } from './accuracy.mjs';

test('Thai PCD bands: upper edges belong to the lower band', () => {
  assert.deepEqual([0, 15, 15.1, 25, 25.1, 37.5, 37.6, 75, 75.1, 300].map(band), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});
test('sums and scores: band, error, bias, high hours caught and false alarms', () => {
  const a = NEW();
  addPair(a, 10, 12);    // same band (0), −2
  addPair(a, 40, 50);    // both >= 37.5: caught, same band (3), −10
  addPair(a, 40, 20);    // false alarm, +20
  addPair(a, 30, 45);    // missed high hour, −15
  const s = scores(a);
  assert.equal(s.n, 4); assert.equal(s.bandRight, 0.5); assert.equal(s.mae, (2 + 10 + 20 + 15) / 4); assert.equal(s.bias, (-2 - 10 + 20 - 15) / 4);
  assert.equal(s.obsMean, (12 + 50 + 20 + 45) / 4);
  assert.equal(s.high, 2); assert.equal(s.caught, 1); assert.equal(s.warned, 2); assert.equal(s.falseAlarms, 1);
  assert.equal(scores(a, 5), null);
});
test('log rows: hourly reference monitors only, three horizons, window, one row per station × lead × hour', () => {
  const H = 3600e3, tEnd = Date.parse('2026-11-18T05:00Z'), iso = t => new Date(t).toISOString().slice(0, 16) + 'Z';
  const obs = new Map([['a|2026-11-18T05', 40], ['a|2026-11-18T04', 10], ['b|2026-11-18T05', 40], ['c|2026-11-18T05', 40], ['a|2026-11-10T05', 10]]);
  const row = (id, L, tv, f, x = {}) => ({ station_id: id, lead_h: String(L), valid_utc: iso(tv), obs_basis: 'h', monitor: '1', correctedML: String(f), correctedA: '1', corrected: '1', ...x });
  const rows = [
    row('a', 1, tEnd, 41), row('a', 1, tEnd, 99),          // the repeat is ignored
    row('a', 24, tEnd, 20), row('a', 12, tEnd - H, 12),
    row('a', 48, tEnd, 40),                                 // two days ahead
    row('a', 36, tEnd, 40),                                 // lead not scored
    row('a', 6, tEnd + H, 40),                              // after the newest measured hour
    row('a', 6, Date.parse('2026-11-10T05:00Z'), 10),       // older than 7 days
    row('b', 3, tEnd, 40, { monitor: '0' }),                // low-cost sensor
    row('c', 3, tEnd, 40, { obs_basis: '24' }),             // 24-h-mean feed
    row('b', 3, tEnd, '', { monitor: '', correctedML: '', correctedA: '38' }),   // old row: monitor from the station list, ML missing
  ];
  const m = scoreRows(rows, obs, tEnd, id => id === 'b');
  assert.deepEqual([...m.keys()].sort(), ['a', 'b']);
  const a = m.get('a');
  assert.equal(a.s[0], 1); assert.equal(a.s[7], 1);         // 41 vs 40: caught
  assert.equal(a.l[0], 2); assert.equal(a.l[5], 1); assert.equal(a.l[7], 0); assert.equal(a.l[1], 20 + 2);
  assert.equal(a.d2[0], 1); assert.equal(a.d2[7], 1);      // 40 vs 40 at 48 h: caught
  assert.equal(a.s[0] + a.l[0] + a.d2[0], 4);              // the 36-h row is not counted
  assert.equal(m.get('b').s[0], 1); assert.equal(m.get('b').s[7], 1);
  assert.deepEqual(ACC.horizons, { s: [1, 3, 6], l: [12, 24], d2: [48] });
});
test('daily means: published 24-h mean 24 h and 48 h ahead against the measured 24-h mean (>= 18 hours), not other leads', () => {
  const H = 3600e3, tEnd = Date.parse('2026-11-18T05:00Z'), iso = t => new Date(t).toISOString().slice(0, 16) + 'Z', obs = new Map();
  for (let q = 0; q < 24; q++) obs.set(`a|${new Date(tEnd - q * H).toISOString().slice(0, 13)}`, 20);                 // measured 24-h mean 20
  for (let q = 0; q < 17; q++) obs.set(`b|${new Date(tEnd - q * H).toISOString().slice(0, 13)}`, 40);                 // only 17 hours
  const row = (id, L, f24) => ({ station_id: id, lead_h: String(L), valid_utc: iso(tEnd), obs_basis: 'h', monitor: '1', correctedML: '20', blend24ML: String(f24) });
  const m = scoreRows([row('a', 24, 30), row('a', 48, 22), row('a', 12, 99), row('b', 24, 40)], obs, tEnd);
  const a = m.get('a');
  assert.equal(a.y1[0], 1); assert.equal(a.y1[4], 0); assert.equal(a.y1[1], 10);   // 30 vs 20: other band, error 10
  assert.equal(a.y2[0], 1); assert.equal(a.y2[4], 1);                                // 22 vs 20: same band
  assert.equal(a.l[0], 2);                                                           // the hourly scores are unchanged
  assert.equal(m.get('b')?.y1?.[0] ?? 0, 0);                                         // too few measured hours
});

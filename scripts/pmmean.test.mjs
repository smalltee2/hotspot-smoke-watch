// Unit tests of the weekly / monthly mean maps: node --test scripts/pmmean.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { addHour, meanOf, updatePmMean, thaiDay, periods, PMM } from './pmmean.mjs';

const H = 3600e3, g = { lon0: 100, lat0: 10, step: 0.05, nx: 2, ny: 1 };
test('day document: sums hours once, a missing value blanks the cell for the day', () => {
  const doc = {}, t = Date.parse('2026-11-22T03:00Z');
  assert.equal(addHour(doc, { ...g, t, values: [10, 20] }), true);
  assert.equal(addHour(doc, { ...g, t: t + 60e3, values: [99, 99] }), false);   // same hour again
  assert.equal(addHour(doc, { ...g, t: t + H, values: [30, null] }), true);
  assert.deepEqual(doc.sum, [40, -1]); assert.equal(doc.hours.length, 2); assert.equal(doc.day, '2026-11-22');
});
test('mean: complete days only, ×10 integers', () => {
  const day = (d, v, n) => ({ ...g, day: d, hours: Array.from({ length: n }, (_, i) => i), sum: v.map(x => x * n) });
  const m = meanOf([day('2026-11-21', [10, 20], 24), day('2026-11-20', [30, 40], 20), day('2026-11-19', [99, 99], 5)]);
  assert.equal(m.days, 2); assert.equal(m.from, '2026-11-20'); assert.equal(m.to, '2026-11-21'); assert.deepEqual(m.values, [200, 300]);
  assert.equal(meanOf([day('2026-11-19', [1, 1], 3)]), null);
});
test('periods: yesterday, last week Monday–Sunday, last calendar month (Thai dates)', () => {
  const P = periods(Date.parse('2026-12-02T03:00Z'));   // Wednesday 2 Dec, Thai
  assert.deepEqual([P.day.from, P.day.to], ['2026-12-01', '2026-12-01']);
  assert.deepEqual([P.week.from, P.week.to], ['2026-11-23', '2026-11-29']);
  assert.deepEqual([P.month.month, P.month.from, P.month.to, P.month.want], ['2026-11', '2026-11-01', '2026-11-30', 30]);
  const M = periods(Date.parse('2026-11-29T20:00Z'));   // Monday 30 Nov 03:00 Thai
  assert.deepEqual([M.week.from, M.week.to], ['2026-11-23', '2026-11-29']); assert.equal(M.day.from, '2026-11-29');
});
test('update: yesterday, last week and last month from the day files; the finished month saved once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-')), out = path.join(dir, 'pm-mean.json'), hist = path.join(dir, 'history');
  // 23 Nov – 1 Dec (Thai): value = day of month, 24 hours each
  for (let d = 0; d < 9; d++) { const t0 = Date.parse('2026-11-22T17:00Z') + d * 24 * H, v = +thaiDay(t0).slice(8, 10);
    for (let h = 0; h < 24; h++) await updatePmMean(hist, out, { ...g, t: t0 + h * H, values: [v, v] }, t0 + h * H); }
  const now = Date.parse('2026-12-01T20:00Z');   // Wednesday 2 Dec 03:00 Thai
  const msg = await updatePmMean(hist, out, null, now), doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(doc.day.values, [10, 10]); assert.equal(doc.day.from, '2026-12-01');                       // yesterday = 1 Dec
  assert.equal(doc.week.days, 7); assert.deepEqual(doc.week.values, [260, 260]);                             // 23–29 Nov: mean 26
  assert.equal(doc.month.month, '2026-11'); assert.equal(doc.month.days, 8); assert.equal(doc.month.want, 30); assert.deepEqual(doc.month.values, [265, 265]);   // 23–30 Nov
  assert.ok(fs.existsSync(path.join(hist, '2026-11', 'pmmonth-202611.json'))); assert.match(msg, /last month 2026-11: 8 of 30/);
  fs.rmSync(dir, { recursive: true, force: true });
});

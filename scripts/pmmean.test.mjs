// Unit tests of the weekly / monthly mean maps: node --test scripts/pmmean.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { addHour, meanOf, updatePmMean, thaiDay, PMM } from './pmmean.mjs';

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
test('update: stores the hour, leaves today out of the means, writes the published file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmm-')), out = path.join(dir, 'pm-mean.json'), hist = path.join(dir, 'history');
  const t0 = Date.parse('2026-11-20T17:00Z');   // 21 Nov 00:00 Thai
  for (let h = 0; h < 24; h++) await updatePmMean(hist, out, { ...g, t: t0 + h * H, values: [10, 20] }, t0 + h * H);
  const now = t0 + 25 * H; const msg = await updatePmMean(hist, out, { ...g, t: now, values: [50, 50] }, now);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.week.days, 1); assert.equal(doc.week.to, '2026-11-21'); assert.deepEqual(doc.week.values, [100, 200]); assert.match(msg, /1 complete day/);
  assert.ok(fs.existsSync(path.join(hist, '2026-11', 'pmday-20261122.json')));   // today's file started, not yet in the means
  assert.equal(thaiDay(now), '2026-11-22'); assert.equal(PMM.week, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

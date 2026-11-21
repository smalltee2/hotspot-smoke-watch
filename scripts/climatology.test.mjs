// Unit tests of the station climatology: node --test scripts/climatology.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellOf, cellStats, parseOaq, csvSplit, thaiTime } from './climatology.mjs';

test('cells: Thai month × hour of the stamp', () => {
  assert.equal(cellOf(Date.parse('2026-03-10T13:00:00Z')), 2 * 24 + 20);      // 20:00 Thai, March
  assert.equal(cellOf(Date.parse('2026-12-31T20:00:00Z')), 0 * 24 + 3);       // 03:00 Thai on 1 January
  assert.equal(thaiTime('2026-03-10 20:00:00'), Date.parse('2026-03-10T13:00:00Z'));
});
test('stats: mean and 90th percentile per cell, × 10 integers, −1 below minN, bad values left out', () => {
  const t0 = Date.parse('2026-03-01T13:00:00Z'), s = [];
  for (let d = 0; d < 20; d++) s.push([t0 + d * 864e5, d < 17 ? 50 : 150]);   // 20 values at 20:00 Thai in March: 17 × 50, 3 × 150
  s.push([t0 + 3600e3, 40], [t0, -5], [t0, 3000]);                              // one value at 21:00; two broken values
  const r = cellStats(s, 10), k = 2 * 24 + 20;
  assert.equal(r.n, 21); assert.equal(r.mean[k], 650); assert.equal(r.p90[k], 1500);
  assert.equal(r.mean[k + 1], -1); assert.equal(r.mean.length, 288);
});
test('OpenAQ archive rows: pm25 only, quoted names with commas, time with offset', () => {
  assert.deepEqual(csvSplit('1,"a, b",x'), ['1', 'a, b', 'x']);
  const txt = '"location_id","sensors_id","location","datetime","lat","lon","parameter","units","value"\n' +
    '9,1,"Station, Hanoi","2026-03-15T20:00:00+07:00",21,105,"pm25","µg/m³",55.5\n9,2,"Station, Hanoi","2026-03-15T20:00:00+07:00",21,105,"pm10","µg/m³",80\n';
  assert.deepEqual(parseOaq(txt), [[Date.parse('2026-03-15T13:00:00Z'), 55.5]]);
  assert.deepEqual(parseOaq(''), []);
});

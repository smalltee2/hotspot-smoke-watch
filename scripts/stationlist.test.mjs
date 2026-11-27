import test from 'node:test'; import assert from 'node:assert/strict';
import { mergeStations } from './stationlist.mjs';
test('new stations are added with name, area and position; old ones are kept', () => {
  const old = { stations: { 'a4t:05t': { name: 'Old', lat: 13.7, lon: 100.5, cc: 'TH', provider: 'Air4Thai', monitor: true, seen: '2026-11-01' } } };
  const j = mergeStations(old, [{ id: 'a4t:19t', name: 'X', nameTH: 'เอ็กซ์', area: 'A, Samut Prakan', areaTH: 'ก, สมุทรปราการ', lat: 13.570123, lon: 100.786456, country: 'TH', provider: 'Air4Thai', monitor: true },
    { id: 4946812, name: 'Sensor', lat: 21, lon: 105.8, country: 'VN', provider: 'AirGradient', monitor: false }, { id: 'bad', lat: NaN, lon: 1 }], '2026-11-27');
  assert.deepEqual(Object.keys(j.stations), ['4946812', 'a4t:05t', 'a4t:19t']);
  assert.equal(j.stations['a4t:05t'].seen, '2026-11-01');
  assert.deepEqual(j.stations['a4t:19t'], { name: 'X', nameTH: 'เอ็กซ์', area: 'A, Samut Prakan', areaTH: 'ก, สมุทรปราการ', lat: 13.5701, lon: 100.7865, cc: 'TH', provider: 'Air4Thai', monitor: true, seen: '2026-11-27' });
  assert.equal(j.stations['4946812'].monitor, false);
});
test('the same stations on the same day give the same text (no commit churn)', () => {
  const st = [{ id: 'a4t:19t', name: 'X', lat: 13.57, lon: 100.78, country: 'TH', provider: 'Air4Thai', monitor: true }];
  const a = mergeStations(null, st, '2026-11-27'); assert.equal(JSON.stringify(mergeStations(a, st, '2026-11-27')), JSON.stringify(a));
});

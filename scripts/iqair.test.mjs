// Unit tests of the IQAir comparison feed: node --test scripts/iqair.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNearest, pickCities, updateIqair, forPage, IQAIR } from './iqair.mjs';

const reply = (aqi, ts = '2026-11-22T07:00:00.000Z') => ({ status: 'success', data: { city: 'Chiang Mai', state: 'Chiang Mai', country: 'Thailand',
  location: { type: 'Point', coordinates: [98.98, 18.79] }, current: { pollution: { ts, aqius: aqi, mainus: 'p2' }, weather: {} } } });
test('parse: city, place, time and US AQI; failures give null', () => {
  const v = parseNearest(reply(68));
  assert.equal(v.aqius, 68); assert.equal(v.lat, 18.79); assert.equal(v.lon, 98.98); assert.equal(v.t, Date.parse('2026-11-22T07:00:00Z')); assert.equal(v.name, 'Chiang Mai, Chiang Mai');
  assert.equal(parseNearest({ status: 'fail', data: { message: 'call_limit_reached' } }), null);
  assert.equal(parseNearest(null), null);
});
test('pick: never asked first, then the oldest', () => {
  const st = {}; for (const c of IQAIR.cities.slice(0, 3)) st[c[0]] = { asked: 100 };
  st[IQAIR.cities[0][0]].asked = 50;
  const p = pickCities(st, 3).map(c => c[0]);
  assert.ok(!p.includes(IQAIR.cities[1][0]) && !p.includes(IQAIR.cities[2][0]));   // the never-asked ones come first
});
test('update: keeps replies, stops on the call limit, never puts the key in the log', async () => {
  const state = {}, logs = []; let n = 0;
  const fake = async url => { n++; assert.ok(url.includes('key=SECRET')); return { status: 200, json: async () => n === 3 ? { status: 'fail', data: { message: 'call_limit_reached' } } : reply(50 + n) }; };
  const ok = await updateIqair(state, Date.parse('2026-11-22T07:10:00Z'), 'SECRET', m => logs.push(m), fake);
  assert.equal(ok, 2); assert.equal(n, 3);   // stopped at the limit
  assert.ok(!logs.join(' ').includes('SECRET')); assert.match(logs[0], /call_limit_reached/);
  const page = forPage(state, Date.parse('2026-11-22T08:00:00Z')); assert.equal(page.length, 2); assert.ok(page.every(c => c.aqius > 50));
  assert.equal(forPage(state, Date.parse('2026-11-23T08:00:00Z')).length, 0);       // too old
  assert.equal(await updateIqair({}, Date.now(), '', () => {}, fake), 0);            // no key: nothing asked
});

import test from 'node:test'; import assert from 'node:assert/strict';
import { PMNOW, errNow, nowcastSeries, storeForecast } from './pmnow.mjs';
const H = 3600e3, t0 = Date.UTC(2026, 10, 28, 10), hours = Array.from({ length: 12 }, (_, k) => t0 + (k - 2) * H), jNow = 2;
test('errNow: the newest hour against the stored forecast, clamped, only when at most 1 h old on the run hour, not at skipped stations', () => {
  const fc = { [t0 - H]: 19 }; // stored forecast 19 for the hour ending t0-1h
  assert.equal(+errNow([t0 - H, 24], fc, t0 + 10 * 60e3).toFixed(4), +Math.log(25 / 20).toFixed(4));   // a run 10 min past the hour
  assert.equal(errNow([t0 - H, 39], fc, t0), PMNOW.maxErr);                     // ln 2 clamped to 0.5
  assert.equal(errNow([t0 - H, 1], fc, t0), -PMNOW.maxErr);
  assert.equal(errNow([t0 - 2 * H, 39], { [t0 - 2 * H]: 19 }, t0 + 10 * 60e3), null);   // 2 h old: stale
  assert.equal(errNow([t0 - H, 39], {}, t0), null);
  assert.equal(errNow([t0 - H, 24], fc, t0, PMNOW, 'a4t:50t'), null);           // a station whose values are often revised
  assert.notEqual(errNow([t0 - H, 24], fc, t0, PMNOW, 'a4t:36t'), null);
});
test('nowcastSeries: fades with lead (tau 1.5 h), past hours and leads > 6 h untouched', () => {
  const base = hours.map(() => 20), e = 0.5, out = nowcastSeries(base, hours, t0, jNow, e);
  assert.deepEqual(out.slice(0, 3), [20, 20, 20]);                                  // past and current hour
  assert.equal(out[3], Math.round((21 * Math.exp(Math.exp(-1 / 1.5) * e) - 1) * 10) / 10);   // lead 1
  assert.ok(out[3] > out[5] && out[5] > out[8] && out[8] >= 20);                    // fading
  assert.equal(out[9], 20);                                                         // lead 7: cut
  assert.deepEqual(nowcastSeries(base, hours, t0, jNow, null), base);
});
test('storeForecast keeps the next hours and drops old ones', () => {
  const st = { x: { [t0 - 20 * H]: 5 } }; storeForecast(st, 'x', hours.map((_, k) => k), hours, jNow, t0);
  assert.equal(st.x[t0 - 20 * H], undefined); assert.equal(st.x[t0 + H], 3); assert.equal(st.x[t0 + 6 * H], 8); assert.equal(st.x[t0 + 7 * H], undefined);
});
test('pmNowCheck rebuilds every row with the current definition, on the hours each run really had', async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const { pmNowCheck } = await import('./pmnow.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmnow-')), m = path.join(dir, '2026-11'); await fs.mkdir(m);
  const iso = t => new Date(t).toISOString().slice(0, 13) + ':00Z', t0 = Date.UTC(2026, 10, 20, 10);
  const head = 'issued_utc,valid_utc,station_id,lead_h,obs_basis,monitor,correctedML';
  // run t0-1h: 1-h forecast 20 for the hour t0. Run t0+1h: forecasts 30 at leads 1 and 3. Measured: hour t0 = 60 (error ln(61/21)
  // clamped to 0.5), and 40 / 38 at the valid hours. A station of the skip list and a non-Air4Thai monitor get the same rows.
  for (const id of ['a4t:1t', 'a4t:50t', '4946812']) {
    await fs.appendFile(path.join(m, 'fcst-20261120T09.csv'), (id === 'a4t:1t' ? head + '\n' : '') + `${iso(t0 - H)},${iso(t0)},${id},1,h,1,20\n`);
    await fs.appendFile(path.join(m, 'fcst-20261120T11.csv'), (id === 'a4t:1t' ? head + '\n' : '') + `${iso(t0 + H)},${iso(t0 + 2 * H)},${id},1,h,1,30\n${iso(t0 + H)},${iso(t0 + 4 * H)},${id},3,h,1,30\n`); }
  const obs = new Map(); for (const id of ['a4t:1t', 'a4t:50t', '4946812']) { obs.set(`${id}|${t0}`, 60); obs.set(`${id}|${t0 + 2 * H}`, 40); obs.set(`${id}|${t0 + 4 * H}`, 38); }
  const day = Date.UTC(2026, 10, 21), ob = `time_utc,station_id,obs_pm25,cams_raw,cams_plus_inc\n${new Date(t0).toISOString()},a4t:1t,60,10,10\n${new Date(t0).toISOString()},a4t:50t,60,10,10\n`;
  let k = await pmNowCheck(dir, day, obs, 14);   // no obs log: the newest hour is unknown, nothing moves
  assert.equal(k.n, 6); assert.equal(k.hit2, 0); assert.equal(k.rebuilt, 6);      // 3 rows each at a4t:1t and a4t:50t; the Hanoi monitor is not nowcast
  await fs.writeFile(path.join(m, 'obs-20261120T12.csv'), ob);                      // hour t0 first seen by the run of t0+2h: 2 h old for the run of t0+1h
  assert.equal((await pmNowCheck(dir, day, obs, 14)).hit2, 0);
  await fs.rm(path.join(m, 'obs-20261120T12.csv')); await fs.writeFile(path.join(m, 'obs-20261120T11.csv'), ob);   // seen by the run itself: 1 h old
  k = await pmNowCheck(dir, day, obs, 14);
  assert.equal(k.hit1, 0); assert.equal(k.hit2, 1);   // a4t:1t lead 1: 31·e^(0.5·e^(−1/1.5)) − 1 ≈ 38.9; lead 3 ≈ 33; a4t:50t (skip list) unchanged
  assert.equal(k.decided, false);
  await fs.rm(dir, { recursive: true });
});

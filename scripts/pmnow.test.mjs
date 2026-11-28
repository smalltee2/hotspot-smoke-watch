import test from 'node:test'; import assert from 'node:assert/strict';
import { PMNOW, errNow, nowcastSeries, storeForecast } from './pmnow.mjs';
const H = 3600e3, t0 = Date.UTC(2026, 10, 28, 10), hours = Array.from({ length: 12 }, (_, k) => t0 + (k - 2) * H), jNow = 2;
test('errNow: the newest hour against the stored forecast, clamped, and only when recent', () => {
  const fc = { [t0 - H]: 19 }; // stored forecast 19 for the hour ending t0-1h
  assert.equal(+errNow([t0 - H, 39], fc, t0).toFixed(4), +Math.log(40 / 20).toFixed(4));
  assert.equal(errNow([t0 - H, 900], fc, t0), PMNOW.maxErr);
  assert.equal(errNow([t0 - 4 * H, 39], { [t0 - 4 * H]: 19 }, t0), null);
  assert.equal(errNow([t0 - H, 39], {}, t0), null);
});
test('nowcastSeries: fades with lead, past hours and leads > 6 h untouched', () => {
  const base = hours.map(() => 20), e = Math.log(2), out = nowcastSeries(base, hours, t0, jNow, e);
  assert.deepEqual(out.slice(0, 3), [20, 20, 20]);                                  // past and current hour
  assert.equal(out[3], Math.round((21 * Math.exp(Math.exp(-1 / 2) * e) - 1) * 10) / 10);   // lead 1: ×2^0.61
  assert.ok(out[3] > out[5] && out[5] > out[8] && out[8] > 20);                     // fading
  assert.equal(out[9], 20);                                                         // lead 7: cut
  assert.deepEqual(nowcastSeries(base, hours, t0, jNow, null), base);
});
test('storeForecast keeps the next hours and drops old ones', () => {
  const st = { x: { [t0 - 20 * H]: 5 } }; storeForecast(st, 'x', hours.map((_, k) => k), hours, jNow, t0);
  assert.equal(st.x[t0 - 20 * H], undefined); assert.equal(st.x[t0 + H], 3); assert.equal(st.x[t0 + 6 * H], 8); assert.equal(st.x[t0 + 7 * H], undefined);
});
test('pmNowCheck rebuilds the nowcast in logs written before it existed', async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const { pmNowCheck } = await import('./pmnow.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pmnow-')), m = path.join(dir, '2026-11'); await fs.mkdir(m);
  const iso = t => new Date(t).toISOString().slice(0, 13) + ':00Z', t0 = Date.UTC(2026, 10, 20, 10);
  // run at t0-1h: 1-h forecast 20 for the hour t0; run at t0: lead 1 and 3 forecasts 20; measured at t0-... see below
  const head = 'issued_utc,valid_utc,station_id,lead_h,obs_basis,monitor,correctedML';
  await fs.writeFile(path.join(m, 'fcst-20261120T09.csv'), `${head}\n${iso(t0 - H)},${iso(t0)},a4t:1t,1,h,1,20\n`);
  await fs.writeFile(path.join(m, 'fcst-20261120T11.csv'), `${head}\n${iso(t0 + H)},${iso(t0 + 2 * H)},a4t:1t,1,h,1,20\n${iso(t0 + H)},${iso(t0 + 4 * H)},a4t:1t,3,h,1,20\n`);
  const obs = new Map([[`a4t:1t|${t0}`, 99], [`a4t:1t|${t0 + 2 * H}`, 40], [`a4t:1t|${t0 + 4 * H}`, 38]]);   // newest hour 99 vs its forecast 20: error ln(100/21), clamped to 1.5
  // without the run's own log of measured hours the newest hour is unknown: nothing is moved
  const k0 = await pmNowCheck(dir, Date.UTC(2026, 10, 21), obs, 14); assert.equal(k0.hit2, 0); assert.equal(k0.ideal.hit2, 1);
  // the hour t0 was first seen (value 99) by the run of t0 + 2 h: too late for the run of t0 + 1 h
  await fs.writeFile(path.join(m, 'obs-20261120T12.csv'), `time_utc,station_id,obs_pm25,cams_raw,cams_plus_inc\n${new Date(t0).toISOString()},a4t:1t,99,10,10\n`);
  assert.equal((await pmNowCheck(dir, Date.UTC(2026, 10, 21), obs, 14)).hit2, 0);
  // seen by the run of t0 + 1 h itself: used
  await fs.rm(path.join(m, 'obs-20261120T12.csv')); await fs.writeFile(path.join(m, 'obs-20261120T11.csv'), `time_utc,station_id,obs_pm25,cams_raw,cams_plus_inc\n${new Date(t0).toISOString()},a4t:1t,99,10,10\n`);
  const k = await pmNowCheck(dir, Date.UTC(2026, 10, 21), obs, 14);
  assert.equal(k.rebuilt, 3); assert.equal(k.n, 3); assert.equal(k.high, 3);   // the first run's row counts too (no newer hour to correct it: unchanged)
  assert.equal(k.hit1, 0);                         // without: all 20
  assert.equal(k.hit2, 1);                         // with: lead 1 → 21·e^(1.5·e^-0.5) − 1 ≈ 51; lead 3 → 21·e^(1.5·e^-1.5) − 1 ≈ 28
  assert.equal(k.decided, false);                  // far too few rows
  await fs.rm(dir, { recursive: true });
});

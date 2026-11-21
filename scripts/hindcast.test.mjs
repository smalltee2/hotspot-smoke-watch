// Unit tests of the hindcast expert: node --test scripts/hindcast.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib';
import { inHcSeason, hcFeatures, hcExpert, HC_NAMES } from './hindcast.mjs';
import { seasonRows, score } from './hindcast_train.mjs';
import { setHindcastModel, predictExpert, mlCorrection, mlActive, dailyLearn } from './ml.mjs';

const T = s => Date.parse(s), H = 3600e3;
test('season: 18 Dec – 30 Apr by Thai date only', () => {
  assert.equal(inHcSeason(T('2026-12-17T16:59Z')), false);   // 17 Dec 23:59 Thai
  assert.equal(inHcSeason(T('2026-12-17T17:00Z')), true);    // 18 Dec 00:00 Thai
  assert.equal(inHcSeason(T('2027-03-10T00:00Z')), true);
  assert.equal(inHcSeason(T('2027-04-30T16:00Z')), true);
  assert.equal(inHcSeason(T('2027-04-30T17:00Z')), false);   // 1 May Thai
  assert.equal(inHcSeason(T('2026-11-22T00:00Z')), false);
});
test('features in HC_NAMES order; missing values become NaN', () => {
  const x = hcFeatures({ lead: 24, cams: 30, cams24: 20, obs24_last: 40, hloc: 6, doy: 60, lat: 18.8, lon: 99 });
  assert.equal(x.length, HC_NAMES.length); assert.equal(x[0], 24); assert.ok(Math.abs(x[1] - Math.log(31)) < 1e-12); assert.ok(Math.abs(x[3] - Math.log(41)) < 1e-12);
  assert.ok(Math.abs(x[4] - 1) < 1e-12);   // 06:00 -> sin = 1
  assert.ok(Number.isNaN(hcFeatures({ lead: 3, cams: 10 })[2]));
});
test('expert: CAMS hourly shape × the predicted 24-h ratio, relative to F; 0 out of season or without CAMS 24-h mean', () => {
  const pred = () => Math.log(2);   // the model says: 24-h mean = 2 × (CAMS 24-h mean + 1) − 1
  const r = { tValid: T('2027-03-01T12:00Z'), cams: 29, cams24: 19, F: 39, lead: 12, obs24_last: 50, hloc: 19, doy: 60, lat: 18, lon: 99 };
  const q = hcExpert({}, r, pred); assert.ok(Math.abs(q - (Math.log(30) + Math.log(2) - Math.log(40))) < 1e-12);   // B = 30·2 − 1 = 59
  assert.equal(hcExpert({}, { ...r, tValid: T('2026-11-22T00:00Z') }, pred), 0);
  assert.equal(hcExpert({}, { ...r, cams24: '' }, pred), 0);
  assert.equal(hcExpert(null, r, pred), 0);
});
test('training rows: 24-h mean of 8 three-hourly leads, run taken 12 h late, lead L − 12, persistence at base + 12 h', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-')), lines = ['issue_utc,valid_utc,lead_h,station_id,cams_pm25,obs_pm25'];
  for (let L = 0; L <= 72; L += 3) lines.push(`2026-01-10T00:00Z,${new Date(T('2026-01-10T00:00Z') + L * H).toISOString().slice(0, 16)}Z,${L},701,${10 + L},${50 + L}`);
  fs.writeFileSync(path.join(dir, 'cams_obs_3h_2026.csv.gz'), zlib.gzipSync(lines.join('\n') + '\n'));
  const rows = await seasonRows(dir, 2026, new Map([['701', { lat: 13.9, lon: 100.5 }]]));
  assert.equal(rows.length, 18);                 // leads 21, 24, …, 72
  const r = rows.find(x => x.lead === 12);       // L = 24: CAMS leads 3…24 -> mean of 13…34 = 23.5; persistence = obs at lead 12 = 62
  assert.equal(r.c24, 23.5); assert.equal(r.oAv, 62); assert.equal(r.obs, 74); assert.equal(r.tValid, T('2026-01-11T00:00Z'));
  assert.ok(Math.abs(r.y - (Math.log(75) - Math.log(24.5))) < 1e-12);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('score: RMSE, bias, hours >= 37.5 caught and false-alarm share', () => {
  const s = score([40, 10, 50, 20], [45, 12, 20, 40]);
  assert.equal(s.caught, 1); assert.equal(s.high, 2); assert.equal(s.fa, 0.5); assert.equal(s.bias, 0.75);
});
test('ml ensemble: the loaded hindcast model is an expert, scored and weighted; absent without the model', () => {
  const model = { type: 'hindcast', f0: Math.log(2), edges: HC_NAMES.map(() => []), trees: [], n: 1 };
  assert.equal(setHindcastModel(model), true);
  const r = { tValid: T('2027-03-01T12:00Z'), cams: 29, cams24: 19, F: 39, lead: 12, obs24_last: 50, hloc: 19, doy: 60, lat: 18, lon: 99 };
  assert.ok(Math.abs(predictExpert(model, r) - (Math.log(60) - Math.log(40))) < 1e-12);
  // a day where the chain is 2× too low and CAMS says so: the hindcast expert earns weight over base
  const rows = []; for (let i = 0; i < 400; i++) rows.push({ ...r, tValid: T('2027-03-01T00:00Z') + (i % 24) * H, y: Math.log(60) - Math.log(40), x: new Array(30).fill(NaN), hloc: i % 24 });
  const state = { ml: { weights: { base: 1 }, models: {}, lastDay: null } };
  dailyLearn(state, rows, { now: T('2027-03-02T00:00Z'), dayStart: T('2027-02-28T17:00Z'), dayEnd: T('2027-03-01T17:00Z') });
  assert.ok(state.ml.weights.hindcast > 0); assert.equal(state.ml.models.hindcast, undefined);   // never stored in the state
  assert.equal(mlActive(state), true); assert.ok(mlCorrection(state, { ...r, x: null }) > 0);
  setHindcastModel(null); assert.equal(mlActive({ ml: { weights: { base: 0.5, hindcast: 0.5 }, models: {} } }), false);
});

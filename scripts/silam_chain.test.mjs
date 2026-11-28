// Unit tests of the SILAM chain's bookkeeping: node --test scripts/silam_chain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_KEYS, stateFor, pickModel, pageDoc } from './silam_chain.mjs';

test('state: shared keys from the CAMS run, model keys from the last SILAM run, never the CAMS ones', () => {
  const main = { stations: [1], obsHist: { a: 1 }, kf: { cams: 1 }, ml: { cams: 1 }, kfSlow: { cams: 1 }, cams: { big: 1 }, silamState: { kf: { sil: 1 }, ml: { sil: 1 } } };
  const st = stateFor(main);
  assert.deepEqual(st.stations, [1]); assert.deepEqual(st.obsHist, { a: 1 });
  assert.deepEqual(st.kf, { sil: 1 }); assert.deepEqual(st.ml, { sil: 1 });
  assert.equal('kfSlow' in st, false); assert.equal('cams' in st, false); assert.equal('silamState' in st, false);
  assert.deepEqual(main.kf, { cams: 1 });   // the main state is not touched
  assert.deepEqual(stateFor({ stations: [] }), { stations: [] });   // first run: no model state at all
  const back = pickModel({ ...st, kfA: { x: 1 }, stations: [2], cams: {} });
  assert.deepEqual(Object.keys(back).sort(), ['kf', 'kfA', 'ml']); assert.ok(MODEL_KEYS.includes('assimKappa')); assert.ok(MODEL_KEYS.includes('stuck') && MODEL_KEYS.includes('stuckT'));
});
test('page file: own files under data/silam/, shared parts from the CAMS run', () => {
  const sil = { model: { name: 'SILAM' }, runlog: ['x'], hours: [1], rk: { biasFine: { file: 'data/rk-bias.json' } }, rkA: { biasFine: { file: 'data/rk-bias-A.json' } },
    ml: { field: { file: 'data/ml-field.json', t0: 5 } }, t2down: null, rainObs: null, met: { file: 'data/met-web.json' }, dem: { file: 'data/static/elev.json' } };
  const d = pageDoc(sil, { t2down: { a: 1 }, rainObs: { b: 1 }, met: { file: 'data/met-web.json', fetched: 9 } });
  assert.equal(d.rk.biasFine.file, 'data/silam/rk-bias.json'); assert.equal(d.rkA.biasFine.file, 'data/silam/rk-bias-A.json');
  assert.equal(d.ml.field.file, 'data/silam/ml-field.json'); assert.equal(d.ml.field.t0, 5);
  assert.deepEqual(d.t2down, { a: 1 }); assert.deepEqual(d.rainObs, { b: 1 }); assert.equal(d.met.fetched, 9);
  assert.equal(d.dem.file, 'data/static/elev.json'); assert.equal('runlog' in d, false);
  assert.equal(sil.rk.biasFine.file, 'data/rk-bias.json');   // the input is not changed
  assert.equal(pageDoc({ rk: null, ml: null }, null).rk, null);
});

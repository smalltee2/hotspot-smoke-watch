// SILAM through the whole chain CAMS goes through: runs scripts/update.mjs a second time with HSW_MODEL=silam, so the fire
// assimilation, the Kalman filters, the station forecasts, the self-learning corrections, the 0.025° map correction and the logs
// are the same program, fed with the SILAM forecast instead of CAMS. This wrapper only keeps the two runs apart:
//   work folder   data/silam-run/ (made new each time, removed afterwards)
//   state         the model's own filter and learning state rides inside data/state.json as `silamState` (the Actions cache
//                 list is not changed); everything else (station list, measurements history, …) is the CAMS run's, fresh
//   logs          data/history/silam/YYYY-MM/…  and  data/mltrain/silam/…  (same branches, 35 days / 2 years)
//   page files    data/silam/latest.json (+ rk-bias.json, rk-bias-A.json, ml-field.json), and a `silam` entry in data/latest.json
//                 that tells the page the layer is there; without a good run the entry is absent and the page hides the layer
// Model-independent parts of latest.json (temperature, observed rain) are taken from the CAMS run's file.
// Run: node scripts/silam_chain.mjs   (after update.mjs; never fails the job)
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), DATA = path.join(ROOT, 'data');
const RUN = path.join(DATA, 'silam-run'), OUT = path.join(DATA, 'silam');
// state of update.mjs that belongs to the PM2.5 model; all other keys are shared and come from the CAMS run each time
export const MODEL_KEYS = ['kf', 'kfA', 'kfSlow', 'incFc', 'assimKappa', 'ml', 'ml2', 'spikeSeen', 'pmNow', 'pmNowFc', 'stuck', 'stuckT'];   // spikeSeen: which dropped spikes each model's filters were already reset for; stuck, stuckT: the sensors each model's run found stuck at zero
const readJSON = async (p, d) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } };
const writeJSON = async (p, o) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p + '.tmp', JSON.stringify(o)); await fs.rename(p + '.tmp', p); };
const warn = m => { console.log('SILAM chain: ' + m); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=SILAM chain::${m}`); };

/** The state the SILAM run starts from: shared keys of the CAMS run + the model keys saved by the last SILAM run. */
export function stateFor(main) {
  const st = { ...main }, sil = main.silamState || {}; delete st.silamState; delete st.cams;
  for (const k of MODEL_KEYS) { if (k in sil) st[k] = sil[k]; else delete st[k]; }
  return st;
}
/** The model keys of a finished SILAM run, to keep in the main state. */
export const pickModel = st => Object.fromEntries(MODEL_KEYS.filter(k => k in st).map(k => [k, st[k]]));
/** latest.json of the SILAM run for the page: its own files under data/silam/, shared parts from the CAMS run's file. */
export function pageDoc(sil, cams) {
  const d = { ...sil }, fix = f => (typeof f === 'string' ? f.replace(/^data\/(rk-bias(-A)?\.json|ml-field\.json)$/, 'data/silam/$1') : f);
  for (const k of ['rk', 'rkA']) if (d[k]?.biasFine) d[k] = { ...d[k], biasFine: { ...d[k].biasFine, file: fix(d[k].biasFine.file) } };
  if (d.ml?.field?.file) d.ml = { ...d.ml, field: { ...d.ml.field, file: fix(d.ml.field.file) } };
  for (const k of ['t2down', 'rainObs', 'met', 'metTraj', 'dem', 'obsWx', 'iqair']) if (cams && cams[k] != null) d[k] = cams[k];
  delete d.runlog;
  return d;
}

async function main() {
  const t0 = Date.now(), mainState = await readJSON(path.join(DATA, 'state.json'), null), camsLatest = await readJSON(path.join(DATA, 'latest.json'), null);
  if (!mainState || !camsLatest) return warn('no state or latest.json from the CAMS run: skipped');
  await fs.rm(RUN, { recursive: true, force: true }); await fs.mkdir(RUN, { recursive: true });
  await fs.mkdir(path.join(DATA, 'history', 'silam'), { recursive: true }); await fs.mkdir(path.join(DATA, 'mltrain', 'silam'), { recursive: true });
  await fs.symlink(path.join(DATA, 'history', 'silam'), path.join(RUN, 'history')); await fs.symlink(path.join(DATA, 'mltrain', 'silam'), path.join(RUN, 'mltrain'));
  await fs.symlink(path.join(DATA, 'static'), path.join(RUN, 'static')).catch(() => {});
  for (const f of ['met.json', 'landcover.bin', 'latest.json']) await fs.copyFile(path.join(DATA, f), path.join(RUN, f)).catch(() => {});
  await writeJSON(path.join(RUN, 'state.json'), stateFor(mainState));
  const code = await new Promise(res => { const c = spawn(process.execPath, [path.join(ROOT, 'scripts', 'update.mjs')], { stdio: 'inherit', env: { ...process.env, HSW_MODEL: 'silam', HSW_DATA: RUN } }); c.on('exit', res); c.on('error', () => res(1)); });
  const sil = code === 0 ? await readJSON(path.join(RUN, 'latest.json'), null) : null, st = await readJSON(path.join(RUN, 'state.json'), null);
  if (!sil || sil.model?.name !== 'SILAM' || !st) { await fs.rm(OUT, { recursive: true, force: true }); await fs.rm(RUN, { recursive: true, force: true }); return warn(`the SILAM run failed (exit ${code}); layer off this hour`); }
  await fs.rm(OUT, { recursive: true, force: true }); await fs.mkdir(OUT, { recursive: true });
  for (const f of ['rk-bias.json', 'rk-bias-A.json', 'ml-field.json']) await fs.copyFile(path.join(RUN, f), path.join(OUT, f)).catch(() => {});
  await writeJSON(path.join(OUT, 'latest.json'), pageDoc(sil, camsLatest));
  // the CAMS run's state may have been rewritten since it was read: read it again, add the model keys
  const cur = await readJSON(path.join(DATA, 'state.json'), mainState); cur.silamState = pickModel(st); await writeJSON(path.join(DATA, 'state.json'), cur);
  const lat = await readJSON(path.join(DATA, 'latest.json'), camsLatest);
  lat.silam = { file: 'data/silam/latest.json', generated: sil.generated, run: sil.model.run, runs: sil.model.runs, t1: sil.hours.at(-1) };
  await writeJSON(path.join(DATA, 'latest.json'), lat);
  await fs.rm(RUN, { recursive: true, force: true });
  console.log(`SILAM chain: run ${sil.model.run}, ${sil.hours.length} h to ${new Date(sil.hours.at(-1)).toISOString().slice(0, 13)}Z, ${sil.stations.length} stations, ${((Date.now() - t0) / 1e3).toFixed(0)} s`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(async e => { warn(`failed: ${e.message}`); await fs.rm(RUN, { recursive: true, force: true }).catch(() => {}); process.exitCode = 0; });

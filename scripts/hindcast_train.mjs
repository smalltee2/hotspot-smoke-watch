// One-off training of the hindcast expert (scripts/hindcast.mjs) from the CAMS hindcast pairs on the "hindcast" branch.
//   git fetch origin hindcast && git archive FETCH_HEAD data/hindcast | tar -x -C /tmp/hc
//   node scripts/hindcast_train.mjs /tmp/hc/data/hindcast data/static/hc-model.json
// Rows: Air4Thai monitors (24-h running means, reference, site check not failed), every CAMS run, leads L = 21…72 h where the
// eight 3-hourly values L−21…L exist (their mean is the CAMS 24-h mean ending at the valid hour). As in operation, the run is
// taken to arrive 12 h after its base time: the lead used is L − 12 and the measured 24-h mean known then is the one at base + 12 h.
// First a leave-one-season-out test (train on two seasons, score the third) against raw CAMS and persistence, then the model on
// all three seasons is written with the test results inside.
import fs from 'node:fs'; import zlib from 'node:zlib'; import readline from 'node:readline';
import { makeEngine } from './mlcore.mjs';
import { HC_NAMES, hcFeatures } from './hindcast.mjs';
import { csvSplit } from './climatology.mjs';

export const HCFIT = { seasons: [2024, 2025, 2026], thr: 37.5, delayH: 12,
  gbm: { nTrees: 300, depth: 4, lr: 0.06, minLeaf: 200, bins: 32, subsample: 0.8, lambda: 1, maxRows: 400000 } };
const H = 3600e3, ln1 = v => Math.log(Math.max(0, v) + 1);

function parseLine(l, h) { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }

/** training rows of one season from the pairs file and the station table */
export async function seasonRows(dir, season, keep) {
  const groups = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(`${dir}/cams_obs_3h_${season}.csv.gz`).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let h = null;
  for await (const l of rl) { if (!h) { h = l.split(','); continue; } const r = parseLine(l, h), st = keep.get(r.station_id); if (!st) continue;
    const k = `${r.station_id}|${r.issue_utc}`; let g = groups.get(k); if (!g) groups.set(k, g = { id: r.station_id, tI: Date.parse(r.issue_utc), st, c: new Array(25).fill(NaN), o: new Array(25).fill(NaN) });
    const i = +r.lead_h / 3; if (Number.isInteger(i) && i >= 0 && i <= 24) { g.c[i] = +r.cams_pm25; g.o[i] = +r.obs_pm25; } }
  const rows = [], d = HCFIT.delayH / 3;
  for (const g of groups.values()) { const oAv = g.o[d]; if (!isFinite(oAv)) continue;
    for (let i = 7; i <= 24; i++) { const L = 3 * i; if (L < 21 || !isFinite(g.o[i])) continue;
      let s = 0, ok = true; for (let q = i - 7; q <= i; q++) { if (!isFinite(g.c[q])) { ok = false; break; } s += g.c[q]; } if (!ok) continue;
      const c24 = s / 8, tV = g.tI + L * H, dt = new Date(tV);
      const f = { lead: L - HCFIT.delayH, cams: g.c[i], cams24: c24, obs24_last: oAv, hloc: new Date(tV + 7 * H).getUTCHours(),
        doy: Math.floor((tV - Date.UTC(dt.getUTCFullYear(), 0, 1)) / 864e5) + 1, lat: g.st.lat, lon: g.st.lon };
      rows.push({ season, tValid: tV, id: g.id, lead: f.lead, hloc: f.hloc, obs: g.o[i], c24, oAv, x: hcFeatures(f), y: ln1(g.o[i]) - ln1(c24) }); } }
  return rows;
}

/** RMSE, bias, hours >= thr caught and false-alarm share of predictions p against obs o */
export function score(p, o, thr = HCFIT.thr) { let se = 0, b = 0, hi = 0, fc = 0, hit = 0;
  for (let i = 0; i < o.length; i++) { se += (p[i] - o[i]) ** 2; b += p[i] - o[i]; const H_ = o[i] >= thr, F_ = p[i] >= thr; hi += H_; fc += F_; hit += H_ && F_; }
  const n = Math.max(1, o.length); return { n: o.length, rmse: +Math.sqrt(se / n).toFixed(2), bias: +(b / n).toFixed(2), caught: hit, high: hi, fa: +((fc - hit) / Math.max(1, fc)).toFixed(3) }; }

async function main() {
  const dir = process.argv[2], out = process.argv[3] || 'data/static/hc-model.json';
  if (!dir) { console.error('usage: node scripts/hindcast_train.mjs <data/hindcast dir> [out.json]'); process.exitCode = 1; return; }
  const stLines = fs.readFileSync(`${dir}/stations.csv`, 'utf8').trim().split('\n'), sh = csvSplit(stLines[0]);
  const eng = makeEngine(HC_NAMES, 2), all = [];
  for (const season of HCFIT.seasons) {
    const keep = new Map();
    for (const l of stLines.slice(1)) { const v = csvSplit(l), r = {}; sh.forEach((k, i) => r[k] = v[i]);   // station names may hold quoted commas
      if (+r.season !== season || r.type !== 'reference' || r.obs_basis !== '24h_running_mean' || String(r.site_qc).startsWith('fail')) continue;
      if (!isFinite(+r.lat) || !isFinite(+r.lon)) continue; keep.set(r.station_id, { lat: +r.lat, lon: +r.lon }); }
    const rows = await seasonRows(dir, season, keep); console.log(`season ${season}: ${keep.size} Air4Thai monitors, ${rows.length} rows`); for (const r of rows) all.push(r);
  }
  const cv = {};
  for (const test of HCFIT.seasons) {
    const m = eng.trainGBM(all.filter(r => r.season !== test), 'hindcast', HCFIT.gbm), te = all.filter(r => r.season === test);
    for (const L of [12, 24, 36, 48, 60]) { const t = te.filter(r => r.lead === L), o = t.map(r => r.obs);
      const res = { cams: score(t.map(r => r.c24), o), persistence: score(t.map(r => r.oAv), o), hindcast: score(t.map(r => (r.c24 + 1) * Math.exp(eng.predictExpert(m, r)) - 1), o) };
      (cv[test] ||= {})[L] = res;
      console.log(`test ${test} lead ${L} h: CAMS RMSE ${res.cams.rmse} caught ${res.cams.caught}/${res.cams.high} FA ${res.cams.fa} · persistence ${res.persistence.rmse} ${res.persistence.caught} ${res.persistence.fa} · hindcast ${res.hindcast.rmse} ${res.hindcast.caught} ${res.hindcast.fa}`); }
  }
  const m = eng.trainGBM(all, 'hindcast', HCFIT.gbm);
  const doc = { version: 1, names: HC_NAMES, trained: new Date().toISOString().slice(0, 10), rows: all.length, seasons: HCFIT.seasons,
    source: 'CAMS global forecasts (Copernicus ADS) and Air4Thai via OpenAQ, branch "hindcast" data/hindcast', cv, model: m };
  fs.writeFileSync(out, JSON.stringify(doc));
  console.log(`hindcast model: ${all.length} rows, importance ${JSON.stringify(m.importance)}, ${(fs.statSync(out).size / 1024).toFixed(0)} KB -> ${out}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exitCode = 1; });

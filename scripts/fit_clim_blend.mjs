// Fit of CFG.climBlend (scripts/update.mjs): how much the long-lead PM2.5 forecast should be pulled toward the station
// climatology, by lead, for one model. Reads the climfc-*.csv logs (published forecast F and climatological mean C at the hourly
// reference monitors) and the measured hourly values, and for each lead tries w = 0, 0.05, …, 1 on
//   ln(B+1) = (1−w)·ln(F+1) + w·ln(C+1)
// A lead keeps w > 0 only when that w lowers the RMSE AND catches at least as many hours >= 37.5 µg/m³ as w = 0 AND has no larger
// false-alarm share, on at least MINROWS rows with MINHIGH high hours; otherwise its weight stays 0. Paste the printed weights
// into CFG.climBlend unchanged.
// Run: node scripts/fit_clim_blend.mjs [historyDir] [obsDir]
//   CAMS:  node scripts/fit_clim_blend.mjs data/history data/history
//   SILAM: node scripts/fit_clim_blend.mjs data/history/silam data/history
import fs from 'node:fs/promises';
import path from 'node:path';

export const FIT = { thr: 37.5, minRows: 2000, minHigh: 50, step: 0.05 };
const H = 3600e3;
const parse = txt => { const L = txt.trim().split('\n'); if (L.length < 2) return []; const h = L[0].split(','); return L.slice(1).map(l => { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
export const blend = (F, C, w) => Math.exp((1 - w) * Math.log(F + 1) + w * Math.log(C + 1)) - 1;

/** rows [[F, C, O], …] of one lead -> scores of every w, and the chosen w (0 unless it wins on all three counts). */
export function fitLead(rows, f = FIT) {
  const score = w => { let se = 0, hit = 0, fc = 0, high = 0;
    for (const [F, C, O] of rows) { const B = blend(F, C, w); se += (B - O) ** 2; const hi = O >= f.thr; high += hi; if (B >= f.thr) { fc++; hit += hi; } }
    return { w, rmse: Math.sqrt(se / Math.max(1, rows.length)), hit, fc, high, fa: (fc - hit) / Math.max(1, fc) }; };
  const all = []; for (let w = 0; w <= 1 + 1e-9; w += f.step) all.push(score(+w.toFixed(2)));
  const base = all[0], ok = rows.length >= f.minRows && base.high >= f.minHigh;
  let best = base; if (ok) for (const s of all) if (s.rmse < best.rmse && s.hit >= base.hit && s.fa <= base.fa) best = s;
  return { n: rows.length, decided: ok, base, best, w: best.w };
}

async function files(dir, re) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    for (const f of await fs.readdir(path.join(dir, e.name))) if (re.test(f)) out.push(path.join(dir, e.name, f));
  return out.sort(); }

async function main() {
  const hist = process.argv[2] || 'data/history', obsDir = process.argv[3] || 'data/history', obs = new Map();
  for (const f of await files(obsDir, /^a4t-\d{8}\.csv$/)) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = +r.pm25; if (r.pm25 !== '' && isFinite(v)) obs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); }
  for (const f of await files(obsDir, /^obs-\d{8}T\d{2}\.csv$/)) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = +r.obs_pm25, t = Date.parse(r.time_utc);
    if (r.obs_pm25 === '' || !isFinite(v) || !isFinite(t)) continue; const k = `${r.station_id}|${new Date(Math.round(t / H) * H).toISOString().slice(0, 13)}`; if (!obs.has(k)) obs.set(k, v); }
  const byLead = new Map();
  for (const f of await files(hist, /^climfc-\d{8}T\d{2}\.csv$/)) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const O = obs.get(`${r.station_id}|${r.valid_utc.slice(0, 13)}`), F = +r.forecast, C = +r.clim_mean; if (O == null || !isFinite(F) || !isFinite(C)) continue;
    const L = +r.lead_h; if (!byLead.has(L)) byLead.set(L, []); byLead.get(L).push([F, C, O]); }
  if (!byLead.size) return console.log(`no climfc rows with measurements in ${hist}`);
  const out = [];
  for (const L of [...byLead.keys()].sort((a, b) => a - b)) { const r = fitLead(byLead.get(L)); out.push([L, r.w]);
    console.log(`lead ${L} h: n=${r.n}, high=${r.base.high}${r.decided ? '' : ' (too few rows: kept 0)'}; w=0: RMSE ${r.base.rmse.toFixed(2)}, caught ${r.base.hit}, FA ${(r.base.fa * 100).toFixed(0)}% · chosen w=${r.w}: RMSE ${r.best.rmse.toFixed(2)}, caught ${r.best.hit}, FA ${(r.best.fa * 100).toFixed(0)}%`); }
  console.log('weights for CFG.climBlend: ' + JSON.stringify(out));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exitCode = 1; });

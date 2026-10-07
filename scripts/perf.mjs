// Model performance of the live forecast, recomputed from the forecast and observation logs kept on GitHub (data/history, 35 days).
// Writes data/perf.json (scores) and data/perf-series.json (station time series), read by perf.html.
// Same definitions as the daily evaluation on the Mac (live_eval/daily_eval.py, daily_report.py):
//   Thai day of a valid hour = the Thai calendar day of the hour's end minus 1 h (hours ending 01:00 … 24:00 Thai)
//   observed 24-h mean = mean of the 24 hourly values ending at the valid hour (≥ 18 of 24); stations reporting 24-h means use them as is
//   persistence = the newest observation the forecast had at issue time (obs_last / obs24_last in the log; older logs: the hour
//   ending at the issue time); forecasts compared on identical rows
//   groups: Air4Thai 24-h stations (reference, basis '24'), hourly reference monitors, low-cost sensors (monitor = 0)
//   the published system = blend + fire assimilation + machine learning where present (blend24ML ▸ blend24A ▸ blend24)
// Run: node scripts/perf.mjs [--force]   (skips when data/perf.json is younger than 3 h)
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), DATA = path.join(ROOT, 'data'), HIST = path.join(DATA, 'history');
const H = 3600e3, TH = 7 * H, LEADS = [1, 3, 6, 12, 24, 48], THRESH = [37.5, 75], SERIES_DAYS = 10, SERIES_LEADS = [6, 24];
const force = process.argv.includes('--force');
const thaiDay = t => new Date(t - H + TH).toISOString().slice(0, 10);   // Thai day of the hour ending at t
const num = v => { if (v == null || v === '') return null; const x = +v; return Number.isFinite(x) ? x : null; };
const first = (...v) => { for (const x of v) { const n = num(x); if (n != null) return n; } return null; };
const parse = txt => { const L = txt.trim().split('\n'); if (L.length < 2) return []; const h = L[0].split(',');
  return L.slice(1).map(l => { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
async function readJSON(f, d) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } }
async function list(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory())
    for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f));
  return out.sort(); }

// running statistics of forecast-observation pairs
const agg = () => ({ n: 0, se: 0, sa: 0, sf: 0, so: 0, sff: 0, soo: 0, sfo: 0 });
function add(a, f, o) { a.n++; const e = f - o; a.se += e * e; a.sa += Math.abs(e); a.sf += f; a.so += o; a.sff += f * f; a.soo += o * o; a.sfo += f * o; }
function fin(a) { if (!a || a.n < 5) return null; const n = a.n, mf = a.sf / n, mo = a.so / n, vf = a.sff / n - mf * mf, vo = a.soo / n - mo * mo, c = a.sfo / n - mf * mo;
  return { n, rmse: +Math.sqrt(a.se / n).toFixed(3), mae: +(a.sa / n).toFixed(3), bias: +(mf - mo).toFixed(3), r: vf > 1e-12 && vo > 1e-12 ? +(c / Math.sqrt(vf * vo)).toFixed(3) : null, obsMean: +mo.toFixed(2), mse: a.se / n }; }

async function main() {
  const outF = path.join(DATA, 'perf.json'), old = await readJSON(outF, null);
  if (!force && old && Date.now() - old.generated < 3 * H) { console.log('perf: up to date'); return; }
  const t0 = Date.now(), latest = await readJSON(path.join(DATA, 'latest.json'), {}), meta = new Map((latest.stations || []).map(s => [String(s.id), s]));
  const files = await list(HIST), today = new Date(Date.now() + TH).toISOString().slice(0, 10);

  // ---------------------------------------------------------------- observations
  const obs = new Map();   // "id|YYYY-MM-DDTHH" (hour end, UTC) → value
  const k13 = t => new Date(t).toISOString().slice(0, 13);
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = num(r.pm25); if (v != null) obs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.obs_pm25), t = Date.parse(r.time_utc); if (v == null || !Number.isFinite(t)) continue;
    const k = `${r.station_id}|${k13(Math.round(t / H) * H)}`; if (!obs.has(k)) obs.set(k, v); }
  const obs24 = (id, t) => { let s = 0, n = 0; for (let i = 0; i < 24; i++) { const v = obs.get(`${id}|${k13(t - i * H)}`); if (v != null) { s += v; n++; } } return n >= 18 ? s / n : null; };

  // ---------------------------------------------------------------- forecasts
  const D = {}, ST = {}, CT = {}, SER = new Map(), days = new Set();
  const A = (o, k) => (o[k] ||= agg());
  const groupOf = (basis, mon) => mon === '0' ? 'lc' : basis === '24' ? 'a4t24' : 'href';
  const tSeries = Date.parse(today + 'T00:00:00+07:00') - SERIES_DAYS * 864e5;
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f))) {
    const seen = new Set();
    for (const r of parse(await fs.readFile(f, 'utf8'))) {
      const id = r.station_id, L = +r.lead_h; if (!LEADS.includes(L)) continue;
      const kk = `${id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(kk)) continue; seen.add(kk);   // older logs held several runs: keep the first
      const tv = Date.parse(r.valid_utc), ti = Date.parse(r.issued_utc), day = thaiDay(tv); if (!(day < today)) continue;   // complete Thai days only
      const m = meta.get(id) || {}, basis = r.obs_basis || (m.avg24 ? '24' : 'h'), mon = r.monitor ?? (m.monitor === false ? '0' : '1'), g = groupOf(basis, mon);
      const o1 = obs.get(`${id}|${r.valid_utc.slice(0, 13)}`), o24 = basis === '24' ? o1 : obs24(id, tv);
      if (o1 == null && o24 == null) continue;
      days.add(day);
      const pI1 = obs.get(`${id}|${r.issued_utc.slice(0, 13)}`), pI24 = basis === '24' ? pI1 : obs24(id, ti);
      const l1 = num(r.obs_last), l24 = num(r.obs24_last);
      const pers1 = l1 != null || l24 != null ? l1 : pI1;
      const pers24 = l1 != null || l24 != null ? (basis === 'h' ? l24 : (l24 ?? l1)) : (basis === 'h' ? pI24 : (pI24 ?? pI1));
      const sys24 = first(r.blend24ML, r.blend24A, r.blend24), sys1 = first(r.correctedML, r.correctedA, r.corrected);
      // 24-h means
      const F24 = { cams: num(r.cams24), kalman: num(r.corr24), blend: num(r.blend24), system: sys24, persistence: pers24 };
      if (o24 != null && Object.values(F24).every(v => v != null)) {
        for (const [mdl, v] of Object.entries(F24)) { add(A(D, `${day}|${L}|${g}|24h|${mdl}`), v, o24); }
        for (const mdl of ['cams', 'system', 'persistence']) add(A(ST, `${id}|${L}|${mdl}`), F24[mdl], o24);
        for (const T of THRESH) for (const mdl of ['cams', 'system', 'persistence']) { const c = (CT[`${day}|${L}|${g}|${T}|${mdl}`] ||= { h: 0, m: 0, f: 0, n: 0 });
          const fo = F24[mdl] >= T, ob = o24 >= T; c.n++; if (fo && ob) c.h++; else if (ob) c.m++; else if (fo) c.f++; }
        const ad = num(r.blend24A), ml = num(r.blend24ML);   // add-on effects on the rows where they exist
        if (ad != null) { add(A(D, `${day}|${L}|${g}|24h|+assim`), ad, o24); add(A(D, `${day}|${L}|${g}|24h|+assim_base`), F24.blend, o24); }
        if (ml != null) { add(A(D, `${day}|${L}|${g}|24h|+ml`), ml, o24); add(A(D, `${day}|${L}|${g}|24h|+ml_base`), first(r.blend24A, r.blend24), o24); }
      }
      // hourly values (hourly stations)
      const F1 = { cams: num(r.cams_raw), kalman: num(r.corrected), system: sys1, persistence: pers1 };
      if (basis === 'h' && o1 != null && Object.values(F1).every(v => v != null)) for (const [mdl, v] of Object.entries(F1)) add(A(D, `${day}|${L}|${g}|1h|${mdl}`), v, o1);
      // station time series (reference stations, two leads, last SERIES_DAYS days)
      if (g !== 'lc' && SERIES_LEADS.includes(L) && tv >= tSeries) {
        let s = SER.get(id); if (!s) SER.set(id, s = {});
        (s[L] ||= []).push([Math.round((tv - tSeries) / H), o1 ?? null, o24 != null ? +o24.toFixed(1) : null, num(r.cams24), sys24, num(r.cams_raw), sys1]);
      }
    }
  }
  const dayList = [...days].sort();

  // ---------------------------------------------------------------- 0.025° map vs CAMS at left-out monitors (the 10 UTC run of each Thai day)
  const MAPD = [];
  for (const day of dayList) {
    const d = new Date(day + 'T00:00:00Z'); let rows = null;
    for (const h of [10, 11, 9, 12, 8, 13, 7]) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h)), iso = t.toISOString();
      const fn = path.join(HIST, iso.slice(0, 7), `map-${iso.slice(0, 13).replace(/[-:]/g, '')}.csv`);
      try { rows = parse(await fs.readFile(fn, 'utf8')); if (rows.length) break; } catch {} }
    if (!rows?.length) continue;
    const ver = rows.some(r => r.version === 'mapA') ? 'mapA' : 'map';
    for (const grp of ['1', '0']) { const a = agg(), c = agg();
      for (const r of rows) { if (r.version !== ver || r.monitor !== grp) continue; const o = num(r.obs24), m = num(r.map_loo), cc = num(r.cams24); if (o == null || m == null || cc == null) continue; add(a, m, o); add(c, cc, o); }
      const fa = fin(a), fc = fin(c); if (fa && fc) MAPD.push({ day, group: grp === '1' ? 'reference' : 'low-cost', map: fa, cams: fc }); }
  }

  // ---------------------------------------------------------------- weather (from 7 Oct 2026): temperature and rain at the Air4Thai stations, GSMaP vs gauges
  const tObs = new Map(), rObs = new Map(), WX = {}, GA = {};
  for (const f of files.filter(f => /a4tw-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = num(r.temp_c); if (v != null) tObs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); }
  for (const f of files.filter(f => /rainobs-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const day = thaiDay(Date.parse(r.hour_end_utc));
    if (r.kind === 'a4t') { const v = num(r.gsmap_fine); if (v != null) rObs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); continue; }
    const g = num(r.gauge_mm); if (g == null) continue;
    for (const m of ['gsmap_cell', 'gsmap_bil', 'gsmap_fine']) { const v = num(r[m]); if (v == null) continue; add(A(GA, `${day}|hourly|${m}`), v, g);
      const tk = `${day}|${r.lat},${r.lon}|${m}`; (GA._tot ||= {})[tk] = (GA._tot[tk] || [0, 0]); GA._tot[tk][0] += v; GA._tot[tk][1] += g; } }
  if (GA._tot) { for (const [k, [f, o]] of Object.entries(GA._tot)) { const [day, , m] = k.split('|'); add(A(GA, `${day}|daytotal|${m}`), f, o); } delete GA._tot; }
  const wdays = new Set();
  for (const f of files.filter(f => /wxf-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const L = +r.lead_h, tv = Date.parse(r.valid_utc), day = thaiDay(tv); if (!(day < today)) continue;
    const k = `${r.station_id}|${r.valid_utc.slice(0, 13)}`, to = tObs.get(k), ro = rObs.get(k);
    if (to != null) { const hr = new Date(tv - H / 2 + TH).getUTCHours(), dn = hr >= 7 && hr < 19 ? 'day' : 'night';
      for (const [mdl, col] of [['ECMWF', 't2_ecmwf'], ['terrain', 't2_terrain'], ['0.025° page', 't2_down'], ['learned', 't2_ml']]) { const v = num(r[col]); if (v == null) continue;
        add(A(WX, `${day}|${L}|t2|all|${mdl}`), v, to); add(A(WX, `${day}|${L}|t2|${dn}|${mdl}`), v, to); wdays.add(day); } }
    if (ro != null) for (const [mdl, col] of [['ECMWF', 'pr_ecmwf'], ['0.025° page', 'pr_fine'], ['learned', 'pr_ml']]) { const v = num(r[col]); if (v == null) continue; add(A(WX, `${day}|${L}|rain|all|${mdl}`), v, ro); wdays.add(day); }
  }

  // ---------------------------------------------------------------- learning logs
  const MLW = [];
  for (const f of files.filter(f => /\/(ml|mlwx)-\d{8}\.json$/.test(f))) { const j = await readJSON(f, null); if (!j) continue;
    if (/\/ml-/.test(f)) MLW.push({ day: j.day, var: 'PM2.5', weights: j.weights, verifiedDays: j.verifiedDays });
    else for (const v of ['t2', 'pr']) if (j[v]) MLW.push({ day: j[v].day, var: v === 't2' ? 'temperature' : 'rain', weights: j[v].weights, verifiedDays: j[v].verifiedDays }); }

  // ---------------------------------------------------------------- output
  const daily = []; for (const [k, a] of Object.entries(D)) { const [day, L, g, metric, model] = k.split('|'), s = fin(a); if (s) daily.push({ day, lead: +L, group: g, metric, model, ...s }); }
  const stations = []; const byS = new Map();
  for (const [k, a] of Object.entries(ST)) { const [id, L, mdl] = k.split('|'), s = fin(a); if (!s) continue; const key = id + '|' + L; let o = byS.get(key); if (!o) byS.set(key, o = { id, lead: +L }); o[mdl] = s; }
  for (const o of byS.values()) { const m = meta.get(o.id) || {}; if (!o.system || !o.persistence || m.lat == null) continue;
    stations.push({ id: o.id, name: m.name || o.id, provider: m.provider || '', lat: m.lat, lon: m.lon, monitor: m.monitor !== false, lead: o.lead, n: o.system.n,
      rmse: o.system.rmse, rmsePers: o.persistence.rmse, rmseCams: o.cams?.rmse ?? null, bias: o.system.bias, ss: o.persistence.mse > 0 ? +(1 - o.system.mse / o.persistence.mse).toFixed(3) : null }); }
  const cont = []; for (const [k, c] of Object.entries(CT)) { const [day, L, g, T, mdl] = k.split('|'); cont.push({ day, lead: +L, group: g, thr: +T, model: mdl, ...c }); }
  const wx = []; for (const [k, a] of Object.entries(WX)) { const [day, L, v, part, mdl] = k.split('|'), s = fin(a); if (s) wx.push({ day, lead: +L, var: v, part, model: mdl, ...s }); }
  const gauges = []; for (const [k, a] of Object.entries(GA)) { const [day, kind, m] = k.split('|'), s = fin(a); if (s) gauges.push({ day, kind, model: m.replace('gsmap_', ''), ...s }); }
  for (const arr of [daily, stations, wx, gauges]) for (const x of arr) delete x.mse;
  const out = { generated: Date.now(), days: dayList, wxDays: [...wdays].sort(), leads: LEADS,
    groups: { a4t24: 'Air4Thai stations (24-h means)', href: 'Hourly reference monitors', lc: 'Low-cost sensors' },
    definitions: 'Thai days (hours ending 01–24 Thai time); 24-h mean = 24 hourly values ending at the valid hour (≥ 18); persistence = newest observation at issue time; system = published forecast (blend + fire assimilation + ML where present); identical rows per comparison.',
    daily, stations, cont, map: MAPD, wx, gauges, ml: MLW.sort((a, b) => a.day < b.day ? -1 : 1) };
  await fs.writeFile(outF, JSON.stringify(out));
  const ser = { t0: tSeries, step: H, cols: ['i', 'obs1', 'obs24', 'cams24', 'sys24', 'cams1', 'sys1'], stations: {} };
  for (const [id, s] of SER) { const m = meta.get(id) || {}; ser.stations[id] = { name: m.name || id, provider: m.provider || '', ...s }; }
  await fs.writeFile(path.join(DATA, 'perf-series.json'), JSON.stringify(ser));
  console.log(`perf: ${dayList.length} days (${dayList[0]}–${dayList[dayList.length - 1]}), ${daily.length} daily scores, ${stations.length} station scores, ${MAPD.length} map days, ${wx.length} weather scores, ${gauges.length} gauge scores, series for ${SER.size} stations; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
main().catch(e => { console.error('perf failed:', e.stack || e.message); process.exitCode = 0; });

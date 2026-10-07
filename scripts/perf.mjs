// Model performance of the live forecast for every forecast parameter (PM2.5, 2-m temperature, rain), recomputed from the logs kept
// on GitHub (data/history, 35 days). Every parameter gets the same analysis, so perf.html shows the same sections for each:
//   daily scores per Thai day × lead × group × value type × forecast (n, RMSE, MAE, bias, r) on identical rows
//   station scores (skill of the published forecast against the reference, by lead)
//   threshold events (hits, misses, false alarms) · station time series (10 days, two leads) · self-learning weights
//   an independent check (PM2.5: the 0.025° map at left-out monitors vs CAMS; rain: GSMaP vs ThaiWater gauges)
// Definitions (as the Mac evaluation, live_eval/*.py):
//   Thai day of a valid hour = Thai calendar day of the hour's end minus 1 h
//   PM2.5: observed 24-h mean = 24 hourly values ending at the valid hour (≥ 18); reference = persistence (newest observation at issue);
//          published = blend + fire assimilation + ML where present; raw = CAMS
//   temperature: Air4Thai hourly mean ending at the valid hour vs the forecast at valid − 30 min; raw = ECMWF; published = after learning
//          (t2_ml; equal to the 0.025° value until learning has weight); reference = same-hour persistence (the observation 24 h, or
//          48 h for leads ≥ 24 h, before the valid hour — the newest same-hour value known at issue)
//   rain: mm in the hour ending at the valid hour, observed = JAXA GSMaP gauge-calibrated at 0.025° at the station; raw = ECMWF;
//          published = after learning (pr_ml); reference = same-hour persistence as for temperature; also daily totals per lead
// Run: node scripts/perf.mjs [--force]   (skips when data/perf.json is younger than 3 h)
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), DATA = path.join(ROOT, 'data'), HIST = path.join(DATA, 'history');
const H = 3600e3, TH = 7 * H, LEADS = [1, 3, 6, 12, 24, 48], SERIES_DAYS = 10, SERIES_LEADS = [6, 24];
const NORTH = [96.5, 14.5, 102.5, 21.5];
const force = process.argv.includes('--force');
const thaiDay = t => new Date(t - H + TH).toISOString().slice(0, 10);
const k13 = t => new Date(t).toISOString().slice(0, 13);
const num = v => { if (v == null || v === '') return null; const x = +v; return Number.isFinite(x) ? x : null; };
const first = (...v) => { for (const x of v) { const n = num(x); if (n != null) return n; } return null; };
const parse = txt => { const L = txt.trim().split('\n'); if (L.length < 2) return []; const h = L[0].split(',');
  return L.slice(1).map(l => { const v = l.split(','), o = {}; h.forEach((k, i) => o[k] = v[i]); return o; }); };
async function readJSON(f, d) { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } }
async function list(dir) { const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory())
    for (const f of await fs.readdir(path.join(dir, e.name)).catch(() => [])) out.push(path.join(dir, e.name, f));
  return out.sort(); }

const agg = () => ({ n: 0, se: 0, sa: 0, sf: 0, so: 0, sff: 0, soo: 0, sfo: 0 });
function add(a, f, o) { a.n++; const e = f - o; a.se += e * e; a.sa += Math.abs(e); a.sf += f; a.so += o; a.sff += f * f; a.soo += o * o; a.sfo += f * o; }
function fin(a, minN = 5) { if (!a || a.n < minN) return null; const n = a.n, mf = a.sf / n, mo = a.so / n, vf = a.sff / n - mf * mf, vo = a.soo / n - mo * mo, c = a.sfo / n - mf * mo;
  return { n, rmse: +Math.sqrt(a.se / n).toFixed(3), mae: +(a.sa / n).toFixed(3), bias: +(mf - mo).toFixed(3), r: vf > 1e-12 && vo > 1e-12 ? +(c / Math.sqrt(vf * vo)).toFixed(3) : null, obsMean: +mo.toFixed(3), mse: a.se / n }; }

// one parameter's collector: everything the page shows, built the same way for every parameter
function collector(def) {
  const D = {}, ST = {}, CT = {}, SER = new Map(), days = new Set();
  return { def, days,
    pair(day, L, g, metric, F, o, stationId) {   // F: {model: value} on identical rows
      if (o == null || Object.values(F).some(v => v == null)) return;
      days.add(day);
      for (const [m, v] of Object.entries(F)) add(D[`${day}|${L}|${g}|${metric}|${m}`] ||= agg(), v, o);
      if (stationId && metric === def.stationMetric && g === def.stationGroupOf(stationId)) for (const m of [def.raw, def.published, def.ref]) add(ST[`${stationId}|${L}|${m}`] ||= agg(), F[m], o);
      if (metric === def.thrMetric && g === def.allGroup) for (const T of def.thresholds) for (const m of [def.raw, def.published, def.ref]) {
        const c = (CT[`${day}|${L}|${T}|${m}`] ||= { h: 0, m: 0, f: 0, n: 0 }), fo = F[m] >= T, ob = o >= T; c.n++; if (fo && ob) c.h++; else if (ob) c.m++; else if (fo) c.f++; }
    },
    extra(day, L, g, metric, model, f, o) { if (f == null || o == null) return; add(D[`${day}|${L}|${g}|${metric}|${model}`] ||= agg(), f, o); },
    serie(id, L, i, vals) { let s = SER.get(id); if (!s) SER.set(id, s = {}); (s[L] ||= []).push([i, ...vals.map(v => v == null ? null : +(+v).toFixed(2))]); },
    out(meta) {
      const daily = []; for (const [k, a] of Object.entries(D)) { const [day, L, g, metric, model] = k.split('|'), s = fin(a); if (s) { delete s.mse; daily.push({ day, lead: +L, group: g, metric, model, ...s }); } }
      const byS = new Map(); for (const [k, a] of Object.entries(ST)) { const [id, L, m] = k.split('|'), s = fin(a); if (!s) continue; const key = id + '|' + L; let o = byS.get(key); if (!o) byS.set(key, o = { id, lead: +L }); o[m] = s; }
      const stations = []; for (const o of byS.values()) { const m = meta.get(o.id) || {}, P = o[def.published], R = o[def.ref]; if (!P || !R || m.lat == null) continue;
        stations.push({ id: o.id, name: m.name || o.id, provider: m.provider || '', lat: m.lat, lon: m.lon, group: def.stationGroupOf(o.id), lead: o.lead, n: P.n,
          rmse: P.rmse, rmseRef: R.rmse, rmseRaw: o[def.raw]?.rmse ?? null, bias: P.bias, ss: R.mse > 0 ? +(1 - P.mse / R.mse).toFixed(3) : null }); }
      const cont = []; for (const [k, c] of Object.entries(CT)) { const [day, L, T, m] = k.split('|'); cont.push({ day, lead: +L, thr: +T, model: m, ...c }); }
      const series = {}; for (const [id, s] of SER) { const m = meta.get(id) || {}; series[id] = { name: m.name || id, provider: m.provider || '', ...s }; }
      return { stats: { daily, stations, cont, days: [...days].sort() }, series };
    } };
}

async function main() {
  const outF = path.join(DATA, 'perf.json'), old = await readJSON(outF, null);
  if (!force && old && old.version === 2 && Date.now() - old.generated < 3 * H) { console.log('perf: up to date'); return; }
  const t0 = Date.now(), latest = await readJSON(path.join(DATA, 'latest.json'), {}), meta = new Map((latest.stations || []).map(s => [String(s.id), s]));
  const files = await list(HIST), today = process.env.PERF_TODAY || new Date(Date.now() + TH).toISOString().slice(0, 10);   // PERF_TODAY: local tests only
  const tSeries = Date.parse(today + 'T00:00:00+07:00') - SERIES_DAYS * 864e5, si = t => Math.round((t - tSeries) / H);
  const inNorth = id => { const m = meta.get(id); return m && m.lon >= NORTH[0] && m.lon <= NORTH[2] && m.lat >= NORTH[1] && m.lat <= NORTH[3]; };

  // ================================================================ PM2.5
  const obs = new Map();
  for (const f of files.filter(f => /a4t-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = num(r.pm25); if (v != null) obs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); }
  for (const f of files.filter(f => /obs-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const v = num(r.obs_pm25), t = Date.parse(r.time_utc); if (v == null || !Number.isFinite(t)) continue;
    const k = `${r.station_id}|${k13(Math.round(t / H) * H)}`; if (!obs.has(k)) obs.set(k, v); }
  const obs24 = (id, t) => { let s = 0, n = 0; for (let i = 0; i < 24; i++) { const v = obs.get(`${id}|${k13(t - i * H)}`); if (v != null) { s += v; n++; } } return n >= 18 ? s / n : null; };
  const pmGroup = new Map();   // station id → group, from the logs
  const PM = collector({ raw: 'cams', published: 'system', ref: 'persistence', allGroup: '__none__', thrMetric: '24h', thresholds: [37.5, 75], stationMetric: '24h',
    stationGroupOf: id => pmGroup.get(id) });
  const pmThr = {};   // thresholds per group (each group has its own table)
  for (const f of files.filter(f => /fcst-\d{8}T\d{2}\.csv$/.test(f))) {
    const seen = new Set();
    for (const r of parse(await fs.readFile(f, 'utf8'))) {
      const id = r.station_id, L = +r.lead_h; if (!LEADS.includes(L)) continue;
      const kk = `${id}|${L}|${r.valid_utc.slice(0, 13)}`; if (seen.has(kk)) continue; seen.add(kk);
      const tv = Date.parse(r.valid_utc), ti = Date.parse(r.issued_utc), day = thaiDay(tv); if (!(day < today)) continue;
      const m = meta.get(id) || {}, basis = r.obs_basis || (m.avg24 ? '24' : 'h'), mon = r.monitor ?? (m.monitor === false ? '0' : '1');
      const g = mon === '0' ? 'lc' : basis === '24' ? 'a4t24' : 'href'; pmGroup.set(id, g);
      const o1 = obs.get(`${id}|${r.valid_utc.slice(0, 13)}`), o24 = basis === '24' ? o1 : obs24(id, tv);
      if (o1 == null && o24 == null) continue;
      const pI1 = obs.get(`${id}|${r.issued_utc.slice(0, 13)}`), pI24 = basis === '24' ? pI1 : obs24(id, ti), l1 = num(r.obs_last), l24 = num(r.obs24_last);
      const pers1 = l1 != null || l24 != null ? l1 : pI1, pers24 = l1 != null || l24 != null ? (basis === 'h' ? l24 : (l24 ?? l1)) : (basis === 'h' ? pI24 : (pI24 ?? pI1));
      const sys24 = first(r.blend24ML, r.blend24A, r.blend24), sys1 = first(r.correctedML, r.correctedA, r.corrected);
      const F24 = { cams: num(r.cams24), kalman: num(r.corr24), blend: num(r.blend24), system: sys24, persistence: pers24 };
      PM.pair(day, L, g, '24h', F24, o24, id);
      if (o24 != null && Object.values(F24).every(v => v != null)) {   // add-on effects on the rows where they exist
        const ad = num(r.blend24A), mlv = num(r.blend24ML);
        if (ad != null) { PM.extra(day, L, g, '24h', '+assim', ad, o24); PM.extra(day, L, g, '24h', '+assim_base', F24.blend, o24); }
        if (mlv != null) { PM.extra(day, L, g, '24h', '+ml', mlv, o24); PM.extra(day, L, g, '24h', '+ml_base', first(r.blend24A, r.blend24), o24); }
      }
      if (o24 != null && Object.values(F24).every(v => v != null)) for (const T of [37.5, 75]) for (const mm of ['cams', 'system', 'persistence']) {
        const c = (pmThr[`${day}|${L}|${g}|${T}|${mm}`] ||= { h: 0, m: 0, f: 0, n: 0 }), fo = F24[mm] >= T, ob = o24 >= T; c.n++; if (fo && ob) c.h++; else if (ob) c.m++; else if (fo) c.f++; }
      if (basis === 'h') PM.pair(day, L, g, '1h', { cams: num(r.cams_raw), kalman: num(r.corrected), system: sys1, persistence: pers1 }, o1, null);
      if (g !== 'lc' && SERIES_LEADS.includes(L) && tv >= tSeries) PM.serie(id, L, si(tv), [o24, num(r.cams24), sys24, o1, num(r.cams_raw), sys1]);
    }
  }
  const pmOut = PM.out(meta);
  pmOut.stats.cont = Object.entries(pmThr).map(([k, c]) => { const [day, L, g, T, m] = k.split('|'); return { day, lead: +L, group: g, thr: +T, model: m, ...c }; });
  // independent check: the 0.025° map at left-out monitors vs CAMS (10 UTC analysis of each Thai day)
  const pmCheck = [];
  for (const day of pmOut.stats.days) {
    const d = new Date(day + 'T00:00:00Z'); let rows = null;
    for (const h of [10, 11, 9, 12, 8, 13, 7]) { const iso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h)).toISOString();
      try { rows = parse(await fs.readFile(path.join(HIST, iso.slice(0, 7), `map-${iso.slice(0, 13).replace(/[-:]/g, '')}.csv`), 'utf8')); if (rows.length) break; } catch {} }
    if (!rows?.length) continue;
    const ver = rows.some(r => r.version === 'mapA') ? 'mapA' : 'map';
    for (const grp of ['1', '0']) { const a = agg(), c = agg();
      for (const r of rows) { if (r.version !== ver || r.monitor !== grp) continue; const o = num(r.obs24), m = num(r.map_loo), cc = num(r.cams24); if (o == null || m == null || cc == null) continue; add(a, m, o); add(c, cc, o); }
      const fa = fin(a), fc = fin(c); if (fa && fc) { delete fa.mse; delete fc.mse; pmCheck.push({ day, group: grp === '1' ? 'reference monitors' : 'low-cost sensors', a: fa, b: fc }); } }
  }

  // ================================================================ temperature and rain (Air4Thai stations, from 7 Oct 2026)
  const tObs = new Map(), rObs = new Map();
  for (const f of files.filter(f => /a4tw-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) { const v = num(r.temp_c); if (v != null) tObs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); }
  const rainCheck = {};
  for (const f of files.filter(f => /rainobs-\d{8}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const day = thaiDay(Date.parse(r.hour_end_utc));
    if (r.kind === 'a4t') { const v = num(r.gsmap_fine); if (v != null) rObs.set(`${r.station_id}|${r.hour_end_utc.slice(0, 13)}`, v); continue; }
    const g = num(r.gauge_mm); if (g == null) continue;
    for (const m of ['gsmap_cell', 'gsmap_bil', 'gsmap_fine']) { const v = num(r[m]); if (v == null) continue; add(rainCheck[`${day}|hourly|${m}`] ||= agg(), v, g);
      const tk = `${day}|${r.lat},${r.lon}|${m}`; (rainCheck._tot ||= {})[tk] ||= [0, 0]; rainCheck._tot[tk][0] += v; rainCheck._tot[tk][1] += g; } }
  if (rainCheck._tot) { for (const [k, [f, o]] of Object.entries(rainCheck._tot)) { const [day, , m] = k.split('|'); add(rainCheck[`${day}|daytotal|${m}`] ||= agg(), f, o); } delete rainCheck._tot; }
  const wxGroup = id => (inNorth(id) ? 'north' : 'south');
  const T2 = collector({ raw: 'ecmwf', published: 'learned', ref: 'persistence', allGroup: 'all', thrMetric: '1h', thresholds: [35, 40], stationMetric: '1h', stationGroupOf: () => 'all' });
  const PR = collector({ raw: 'ecmwf', published: 'learned', ref: 'persistence', allGroup: 'all', thrMetric: '1h', thresholds: [0.5, 5], stationMetric: '1h', stationGroupOf: () => 'all' });
  const prTot = {};   // daily totals per station, lead and forecast
  const persLag = L => 24 * Math.ceil((L + 1) / 24) * H;   // same hour, newest day known at issue time
  for (const f of files.filter(f => /wxf-\d{8}T\d{2}\.csv$/.test(f))) for (const r of parse(await fs.readFile(f, 'utf8'))) {
    const L = +r.lead_h, tv = Date.parse(r.valid_utc), day = thaiDay(tv), id = r.station_id; if (!(day < today) || !LEADS.includes(L)) continue;
    // day/night by the hour end in Thai time, as the downscaling bins (t2Bin: hours ending 07–18 = day)
    const hr = new Date(tv + TH).getUTCHours(), dn = hr >= 7 && hr < 19 ? 'day' : 'night', reg = wxGroup(id), k = `${id}|${r.valid_utc.slice(0, 13)}`, kp = `${id}|${k13(tv - persLag(L))}`;
    const to = tObs.get(k);
    if (to != null) {
      const F = { ecmwf: num(r.t2_ecmwf), terrain: num(r.t2_terrain), page: num(r.t2_down), learned: first(r.t2_ml, r.t2_down), persistence: tObs.get(kp) ?? null };
      for (const g of ['all', reg, dn]) T2.pair(day, L, g, '1h', F, to, g === 'all' ? id : null);
      if (SERIES_LEADS.includes(L) && tv >= tSeries) T2.serie(id, L, si(tv), [to, F.ecmwf, F.learned]);
    }
    const ro = rObs.get(k);
    if (ro != null) {
      const F = { ecmwf: num(r.pr_ecmwf), page: num(r.pr_fine), learned: first(r.pr_ml, r.pr_fine), persistence: rObs.get(kp) ?? null };
      for (const g of ['all', reg, dn]) PR.pair(day, L, g, '1h', F, ro, g === 'all' ? id : null);
      if (Object.values(F).every(v => v != null)) { const tk = `${day}|${L}|${id}`, t = (prTot[tk] ||= { o: 0, n: 0, reg, F: { ecmwf: 0, page: 0, learned: 0, persistence: 0 } }); t.o += ro; t.n++; for (const m in F) t.F[m] += F[m]; }
      if (SERIES_LEADS.includes(L) && tv >= tSeries) PR.serie(id, L, si(tv), [ro, F.ecmwf, F.learned]);
    }
  }
  for (const [tk, t] of Object.entries(prTot)) { if (t.n < 20) continue; const [day, L, id] = tk.split('|'); const sc = 24 / t.n;   // scaled to 24 h when a few hours are missing
    const F = Object.fromEntries(Object.entries(t.F).map(([m, v]) => [m, v * sc])); for (const g of ['all', t.reg]) PR.pair(day, +L, g, 'day', F, t.o * sc, null); }
  const t2Out = T2.out(meta), prOut = PR.out(meta);
  const rcheck = []; for (const [k, a] of Object.entries(rainCheck)) { const [day, kind, m] = k.split('|'), s = fin(a); if (s) { delete s.mse; rcheck.push({ day, kind, model: m.replace('gsmap_', ''), ...s }); } }

  // ================================================================ learning logs
  const ml = { pm25: [], t2: [], rain: [] };
  for (const f of files.filter(f => /\/(ml|mlwx)-\d{8}\.json$/.test(f))) { const j = await readJSON(f, null); if (!j) continue;
    if (/\/ml-/.test(f)) ml.pm25.push({ day: j.day, weights: j.weights });
    else { if (j.t2) ml.t2.push({ day: j.t2.day, weights: j.t2.weights }); if (j.pr) ml.rain.push({ day: j.pr.day, weights: j.pr.weights }); } }
  for (const k in ml) ml[k].sort((a, b) => a.day < b.day ? -1 : 1);

  // ================================================================ output
  const params = {
    pm25: { label: 'PM2.5', unit: 'µg/m³', decimals: 1, since: null, ...pmOut.stats,
      models: [['cams', 'raw CAMS'], ['kalman', 'Kalman'], ['blend', 'blend'], ['system', 'published system'], ['persistence', 'persistence']], raw: 'cams', published: 'system', ref: 'persistence',
      groups: { a4t24: 'Air4Thai stations (24-h means)', href: 'Hourly reference monitors', lc: 'Low-cost sensors' }, defaultGroup: 'href',
      metrics: { '24h': '24-h mean (Thai AQI basis)', '1h': 'hourly value' }, metricGroups: { '1h': ['href', 'lc'] },
      stationGroups: { a4t24: 'Air4Thai 24-h', href: 'hourly reference', lc: 'low-cost' }, stationMetric: '24h',
      thresholds: [[37.5, '37.5 µg/m³ (Thai PCD orange: unhealthy for sensitive groups)'], [75, '75 µg/m³ (Thai PCD red: unhealthy)']], thrMetric: '24h',
      refNote: 'persistence = the newest observation the forecast had at issue time',
      steps: [['Kalman correction of CAMS', 'cams', 'kalman'], ['blend (Kalman + station weighting)', 'kalman', 'blend'], ['fire assimilation', '+assim_base', '+assim'], ['self-learning correction', '+ml_base', '+ml']],
      series: { cols: { '24h': [1, 2, 3], '1h': [4, 5, 6] } },
      check: { title: '0.025° map against CAMS at left-out monitors', note: 'Leave-one-out value of the published map at each monitor (24-h means, 10 UTC analysis) against raw CAMS, by day.', aLabel: '0.025° map (left out)', bLabel: 'raw CAMS', rows: pmCheck },
      ml: ml.pm25 },
    t2: { label: '2-m temperature', unit: '°C', decimals: 1, since: '2026-10-07', ...t2Out.stats,
      models: [['ecmwf', 'raw ECMWF'], ['terrain', 'terrain-corrected'], ['page', '0.025° (before learning)'], ['learned', 'published (after learning)'], ['persistence', 'persistence']], raw: 'ecmwf', published: 'learned', ref: 'persistence',
      groups: { all: 'All Air4Thai stations', north: 'Northern box (96.5–102.5 E, 14.5–21.5 N)', south: 'Outside the northern box', day: 'Daytime (hours ending 07–18 Thai)', night: 'Night (hours ending 19–06 Thai)' }, defaultGroup: 'all',
      metrics: { '1h': 'hourly value' }, metricGroups: {}, stationGroups: { all: 'Air4Thai' }, stationMetric: '1h',
      thresholds: [[35, '35 °C (TMD hot)'], [40, '40 °C (TMD very hot)']], thrMetric: '1h',
      refNote: 'persistence = the temperature observed at the same hour on the newest day known at issue time (24 h before valid for leads < 24 h, 48 h for +24 h, 72 h for +48 h). The station-residual step is scored at the stations the residual field is built from, so it is an upper bound for other places; the left-out check is on the developer page',
      steps: [['terrain (lapse-rate) correction', 'ecmwf', 'terrain'], ['station residual (day/night)', 'terrain', 'page'], ['self-learning correction', 'page', 'learned']],
      series: { cols: { '1h': [1, 2, 3] } }, check: null, ml: ml.t2 },
    rain: { label: 'Rain', unit: 'mm', decimals: 1, since: '2026-10-07', ...prOut.stats,
      models: [['ecmwf', 'raw ECMWF'], ['page', '0.025° (before learning)'], ['learned', 'published (after learning)'], ['persistence', 'persistence']], raw: 'ecmwf', published: 'learned', ref: 'persistence',
      groups: { all: 'All Air4Thai stations', north: 'Northern box', south: 'Outside the northern box', day: 'Daytime (hours ending 07–18 Thai)', night: 'Night (hours ending 19–06 Thai)' }, defaultGroup: 'all',
      metrics: { '1h': 'hourly amount (mm in the hour)', day: 'daily total (mm per Thai day)' }, metricGroups: { day: ['all', 'north', 'south'] }, stationGroups: { all: 'Air4Thai' }, stationMetric: '1h',
      thresholds: [[0.5, '0.5 mm in an hour (wet hour)'], [5, '5 mm in an hour (heavy shower)']], thrMetric: '1h',
      steps: [['CHELSA rain-pattern factor (0.025°)', 'ecmwf', 'page'], ['self-learning correction', 'page', 'learned']],
      refNote: 'observed = JAXA GSMaP gauge-calibrated rain at 0.025° at the station, which carries the same CHELSA pattern factor as the 0.025° forecast, so the factor step is not independently verified here (the gauge check below is); persistence = the rain at the same hour on the newest day known at issue time',
      series: { cols: { '1h': [1, 2, 3] } },
      check: { title: 'GSMaP (the rain observation) against ThaiWater gauges', note: 'Independent check of the observed rain used above: GSMaP 0.1° cell, interpolated, and the 0.025° page value against rain gauges; hourly amounts and daily totals.', gauge: true, rows: rcheck },
      ml: ml.rain },
  };
  for (const k in params) params[k].days = params[k].days || [];
  const out = { version: 2, generated: Date.now(), leads: LEADS, params,
    definitions: 'Thai days (hours ending 01–24 Thai time); forecasts compared on identical rows; skill = 1 − MSE(published)/MSE(reference). Recomputed every 3 hours from the forecast and observation logs (scripts/perf.mjs; GitHub keeps 35 days).' };
  await fs.writeFile(outF, JSON.stringify(out));
  const ser = { t0: tSeries, step: H, params: { pm25: pmOut.series, t2: t2Out.series, rain: prOut.series } };
  await fs.writeFile(path.join(DATA, 'perf-series.json'), JSON.stringify(ser));
  const msg = `PM2.5 ${params.pm25.days.length} days, ${params.pm25.daily.length} scores, ${params.pm25.stations.length} station scores; temperature ${params.t2.days.length} days, ${params.t2.daily.length} scores; rain ${params.rain.days.length} days, ${params.rain.daily.length} scores, ${rcheck.length} gauge scores; ${((Date.now() - t0) / 1000).toFixed(1)} s`;
  console.log('perf: ' + msg); if (process.env.GITHUB_ACTIONS) console.log(`::notice title=model performance::${msg}`);
}
main().catch(e => { console.error('perf failed:', e.stack || e.message); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=model performance::perf.mjs failed: ${e.message}`); process.exitCode = 0; });

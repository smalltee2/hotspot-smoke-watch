// Hourly update for Hotspot Smoke Watch.
// Runs in GitHub Actions (Node 20+, no dependencies). Reads keys from env:
//   OPENAQ_API_KEY, FIRMS_MAP_KEY
// Writes:
//   data/latest.json   – what the web page reads
//   data/state.json    – Kalman filter state, station list, cached CAMS forecast
//   data/static/elev.json – terrain elevation grid (built once)
//   data/met.json      – ECMWF IFS HRES meteorology on nested grids (refreshed every 6 h)
//   data/history/YYYY-MM/obs-YYYYMMDDTHH.csv, fcst-YYYYMMDDTHH.csv – for verification (committed)
//   latest/met/state/runlog/verify JSON are published to GitHub Pages and carried between runs in the Actions cache, not committed
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDEM, sampleGrid } from './dem.mjs';
import { regressionKriging } from './rk.mjs';
import { fetchMet, sampleMet, packMet, MET_MODEL } from './met.mjs';
import { buildLandcover, landcoverAt, packLandcover, unpackLandcover } from './landcover.mjs';
import { loadModel } from './model.mjs';
import { assimilateFires, assimSummary } from './assim.mjs';
import { loadDataset, dailyLearn, mlCorrection, mlActive, FEAT_COLS, storeDay, loadSeasonRows } from './ml.mjs';
import zlib from 'node:zlib';

// ------------------------------------------------------------------ config
const CFG = {
  // area for stations, hotspots and the corrected PM2.5 grid [W,S,E,N]
  bbox: [92.0, 5.5, 110.0, 24.5],
  gridBbox: [92.0, 5.5, 110.0, 24.0],  // covers every region in the page's drop-down
  gridStep: 0.5,                 // deg; keeps Open-Meteo calls inside the free tier
  camsRefreshH: 12,              // CAMS is issued twice a day; with the met pulls this stays under Open-Meteo's 10k/day free limit
  met: { refreshH: 12,   // ECMWF HRES full runs are 00/12 UTC; 12 h keeps Open-Meteo use under the free daily limit
          grids: [ { name: 'north', bbox: [96.5, 14.5, 102.5, 21.5], step: 0.25 }, { name: 'domain', bbox: [92, 5, 110, 25], step: 1.0 } ] },
  stationRefreshH: 24,
  maxStations: 300,
  obsMaxAgeH: 3,                 // ignore station values older than this
  firmsSources: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'],
  firmsDays: 2,
  // Kalman filter on log-ratio bias b = ln(obs+1) - ln(raw+1)
  kf: { Q: 0.02, R: 0.15, P0: 0.5, maxGapH: 48 },
  // slow station bias (long memory, ~ weeks): removed from the innovations of the fire-emission assimilation so that only the
  // episodic, fire-driven part of the CAMS error is attributed to fires
  kfSlow: { Q: 0.002, R: 0.15, P0: 0.5, maxGapH: 168 },
  assimilate: true,              // fire-emission assimilation; both pages forecast with it (the developer page can switch it off)
  biasLeadEfoldH: 48,            // bias correction fades with lead time
  rk: { residStep: 0.1, demStep: 0.05, minStations: 15, K: 16, declusterDeg: 0.25 },   // cell declustering of the regression (0.25° ≈ 28 km cells)  // regression kriging; residual grid and DEM resolution
  logLeads: [1, 3, 6, 12, 24, 48],
  // Air4Thai stations on OpenAQ report PM2.5 as a 24-h running mean, not hourly values (verified on Jan–Apr 2026: flat daily cycle,
  // mean hour-to-hour change 0.4 µg/m3); their correction and kriging therefore compare like with like (24-h means)
  avg24Providers: ['Air4Thai', 'Air4Thai · Bangkok (BMA)'],
  // Thailand: hourly PM2.5 straight from the Pollution Control Department (Air4Thai); these replace the OpenAQ copies of the
  // same monitors (24-h means). Their server sends an incomplete certificate chain, so the workflow adds Let's Encrypt's
  // intermediates (scripts/certs/air4thai-chain.pem, chaining to ISRG Root X1) through NODE_EXTRA_CA_CERTS.
  // If Air4Thai cannot be reached when the station list is rebuilt, the OpenAQ copies are used as before.
  a4t: { list: 'https://air4thai.pcd.go.th/services/getNewAQI_JSON.php', hist: 'https://air4thai.pcd.go.th/webV2/history/api/data.php',
         dedupKm: 1.0, chunk: 40, retryH: 3, types: ['GROUND', 'BKK'] },   // BKK = Bangkok Metropolitan Administration network (not in the hourly history service: read from the
  // live feed, which gives the 24-h mean used for the AQI, so they are handled like the 24-h-mean stations); MOBILE units left out
  stationListVer: 3,             // bump to force a rebuild of the station list on the next run
  blendW: 0.5,                   // station 24-h forecast = w·persistence + (1−w)·corrected CAMS (provisional; to be fitted by lead from the hindcast)
};
const PM25_ID = 2; // OpenAQ parameter id for pm25
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DATA = path.join(ROOT, 'data');
const now = Date.now();
const HOUR = 3600e3;
const RUNLOG = [];
const SECRETS = [process.env.FIRMS_MAP_KEY, process.env.OPENAQ_API_KEY].map(k => (k || '').trim()).filter(k => k.length > 6);
const log = (...a) => { let line = a.join(' '); for (const k of SECRETS) line = line.split(k).join('***'); RUNLOG.push(line); console.log(new Date().toISOString().slice(11, 19), line); };

// ------------------------------------------------------------------ helpers
async function readJSON(p, dflt) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return dflt; } }
async function writeJSON(p, o) { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, JSON.stringify(o)); }
async function appendCSV(p, header, rows) {
  if (!rows.length) return;
  await fs.mkdir(path.dirname(p), { recursive: true });
  let exists = true; try { await fs.access(p); } catch { exists = false; }
  await fs.appendFile(p, (exists ? '' : header + '\n') + rows.map(r => r.join(',')).join('\n') + '\n');
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, opt = {}, tries = 3, waitMs = 2000) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(60e3) });
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r;
    } catch (e) {
      if (e.cause?.code && !e.message.includes(e.cause.code)) e.message += ` (${e.cause.code})`;   // e.g. ECONNRESET, UND_ERR_CONNECT_TIMEOUT
      if (i === tries - 1) throw e; await sleep(waitMs * (i + 1)); }
  }
  throw new Error(`HTTP 429 (rate limited) after ${tries} tries: ${url.split('?')[0]}`);
}
function km(a, b, c, d) { const p = Math.PI / 180, dl = (c - a) * p, dn = (d - b) * p;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); }
const inBox = (lat, lon, b) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
const r1 = x => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ OpenAQ
const OAQ = 'https://api.openaq.org/v3';
const oaqHeaders = () => ({ 'X-API-Key': (process.env.OPENAQ_API_KEY || '').trim(), Accept: 'application/json' });

async function oaqStations() {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const q = `bbox=${CFG.bbox.join(',')}&parameters_id=${PM25_ID}&limit=1000&page=${page}`;
    const js = await (await get(`${OAQ}/locations?${q}`, { headers: oaqHeaders() })).json();
    const res = js.results || [];
    for (const L of res) {
      const s = (L.sensors || []).find(s => s.parameter?.id === PM25_ID || s.parameter?.name === 'pm25');
      if (!s || !L.coordinates) continue;
      out.push({ id: L.id, sensor: s.id, name: L.name || `OpenAQ ${L.id}`, lat: L.coordinates.latitude, lon: L.coordinates.longitude,
        monitor: !!L.isMonitor, provider: L.provider?.name || '', country: L.country?.code || '',
        last: Date.parse(L.datetimeLast?.utc || '') || 0 });
    }
    if (res.length < 1000) break;
    await sleep(1100);
  }
  return out;
}
// latest pm25 for many stations; try the one-call endpoint, fall back to per-location
async function oaqLatest(stations) {
  const bySensor = new Map(stations.map(s => [s.sensor, s]));
  const byLoc = new Map(stations.map(s => [s.id, s]));
  const vals = new Map();
  try {
    for (let page = 1; page <= 20; page++) {
      const js = await (await get(`${OAQ}/parameters/${PM25_ID}/latest?limit=1000&page=${page}`, { headers: oaqHeaders() })).json();
      const res = js.results || [];
      for (const m of res) {
        const st = bySensor.get(m.sensorsId) || byLoc.get(m.locationsId);
        const t = Date.parse(m.datetime?.utc || '');
        if (st && isFinite(m.value) && isFinite(t)) vals.set(st.id, { t, v: m.value });
      }
      if (res.length < 1000) break;
      await sleep(1100);
    }
    log(`OpenAQ latest (bulk): ${vals.size} stations`);
  } catch (e) { log('bulk latest failed:', e.message); }
  if (vals.size < stations.length * 0.3) {
    for (const st of stations) {
      if (vals.has(st.id)) continue;
      try {
        const js = await (await get(`${OAQ}/locations/${st.id}/latest`, { headers: oaqHeaders() })).json();
        const m = (js.results || []).find(m => m.sensorsId === st.sensor);
        const t = Date.parse(m?.datetime?.utc || '');
        if (m && isFinite(m.value) && isFinite(t)) vals.set(st.id, { t, v: m.value });
      } catch (e) { log(`latest ${st.id}: ${e.message}`); }
      await sleep(1100); // stay under 60 requests/min
    }
    log(`OpenAQ latest (per location): ${vals.size} stations`);
  }
  return vals;
}

// ------------------------------------------------------------------ Air4Thai (Pollution Control Department, Thailand)
const thaiTime = s => Date.parse(String(s).trim().replace(' ', 'T') + '+07:00');   // their times are Thai local time (UTC+7)
const thaiDate = t => new Date(t + 7 * HOUR).toISOString().slice(0, 10);
async function a4tStations() {
  const js = await (await get(CFG.a4t.list, {}, 3, 3000)).json();
  return (js.stations || []).filter(x => CFG.a4t.types.includes(x.stationType || 'GROUND')).map(x => {
    const L = x.AQILast || {}, pm = +(L.PM25?.value ?? -1), bkk = x.stationType === 'BKK', last = pm >= 0 && L.date ? thaiTime(`${L.date} ${L.time || '00:00'}:00`) : 0;
    return { id: 'a4t:' + x.stationID, code: x.stationID, name: x.nameEN || x.nameTH || x.stationID, nameTH: x.nameTH || '', lat: +x.lat, lon: +x.long,
      monitor: true, provider: bkk ? 'Air4Thai · Bangkok (BMA)' : 'Air4Thai', ...(bkk ? { feed24: true } : { hourly: true }), country: 'TH', last, pm: pm >= 0 ? pm : null };
  }).filter(s => isFinite(s.lat) && isFinite(s.lon) && inBox(s.lat, s.lon, CFG.bbox));
}
// hourly PM2.5 (µg/m³) for many stations between two Thai dates. Each value is the mean of the hour ENDING at its time stamp
// (the latest hour appears about 20 min after it closes). Returns Map code → [[t_utc_ms, value], …]
async function a4tHourly(codes, d0, d1) {
  const out = new Map();
  for (let i = 0; i < codes.length; i += CFG.a4t.chunk) {
    const q = `stationID=${codes.slice(i, i + CFG.a4t.chunk).join(',')}&param=PM25&type=hr&sdate=${d0}&edate=${d1}&stime=00&etime=23`;
    const js = await (await get(`${CFG.a4t.hist}?${q}`, {}, 3, 3000)).json();
    if (js.result && js.result !== 'OK') throw new Error(`Air4Thai history: ${js.error || js.result}`);
    for (const st of js.stations || []) {
      const rows = [];
      for (const d of st.data || []) { const v = d.PM25 == null || d.PM25 === '' ? NaN : +d.PM25, t = thaiTime(d.DATETIMEDATA);
        if (isFinite(v) && v >= 0 && v < 1500 && isFinite(t) && t <= now + HOUR) rows.push([t, v]); }
      out.set(st.stationID, rows.sort((a, b) => a[0] - b[0]));
    }
    if (i + CFG.a4t.chunk < codes.length) await sleep(800);
  }
  return out;
}

// ------------------------------------------------------------------ FIRMS
async function firmsHotspots() {
  const key = (process.env.FIRMS_MAP_KEY || '').trim();
  if (!key) { log('FIRMS_MAP_KEY missing, skipping hotspots'); return []; }
  const rows = []; firmsHotspots.ok = false;
  for (const src of CFG.firmsSources) {
    try {
      // FIRMS sometimes drops connections from cloud runners: 5 tries, 10–50 s apart
      const txt = await (await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${CFG.bbox.join(',')}/${CFG.firmsDays}`, {}, 5, 10000)).text();
      const lines = txt.trim().split('\n'); const head = lines[0].split(',');
      if (!head.includes('latitude')) { log(`FIRMS ${src}: unexpected reply: ${txt.slice(0, 120).replace(/\s+/g, ' ')}`); continue; }
      const ix = k => head.indexOf(k);
      for (const l of lines.slice(1)) {
        const v = l.split(',');
        const tm = String(v[ix('acq_time')]).padStart(4, '0');
        const t = Date.parse(`${v[ix('acq_date')]}T${tm.slice(0, 2)}:${tm.slice(2)}:00Z`);
        rows.push([+(+v[ix('latitude')]).toFixed(4), +(+v[ix('longitude')]).toFixed(4), r1(+v[ix('frp')] || 0), t,
          (v[ix('confidence')] || 'n').toLowerCase()[0], src.split('_')[1]]);
      }
      log(`FIRMS ${src}: ${lines.length - 1}`); firmsHotspots.ok = true;
    } catch (e) { log(`FIRMS ${src} failed: ${e.message}`); }
  }
  return rows;
}

// ------------------------------------------------------------------ CAMS via Open-Meteo
async function camsSeries(points) {
  const out = []; let times = null;
  for (let i = 0; i < points.length; i += 100) {
    const c = points.slice(i, i + 100);
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${c.map(p => p[0].toFixed(3)).join(',')}` +
      `&longitude=${c.map(p => p[1].toFixed(3)).join(',')}&hourly=pm2_5&timeformat=unixtime&timezone=GMT&past_days=1&forecast_days=4`;
    let js = await (await get(url)).json(); if (!Array.isArray(js)) js = [js];
    for (const o of js) { if (!times) times = o.hourly.time.map(s => s * 1000); out.push(o.hourly.pm2_5.map(v => v == null ? null : r1(v))); }
    if (i + 100 < points.length) await sleep(12000); // ≤ 500 locations/min (free tier allows 600)
  }
  return { times, series: out };
}

// ------------------------------------------------------------------ Kalman bias
function kfStep(st, y, tObs, par = CFG.kf) {
  const { Q, R, P0, maxGapH } = par;
  if (!st || (tObs - st.t) > maxGapH * HOUR) st = { b: 0, P: P0, t: tObs - HOUR };
  const steps = Math.max(1, Math.round((tObs - st.t) / HOUR));
  let P = st.P + Q * steps;                 // predict (random walk)
  const K = P / (P + R);
  const b = st.b + K * (y - st.b);          // update
  P = (1 - K) * P;
  return { b, P, t: tObs, n: (st.n || 0) + 1 };
}
const correct = (raw, b, leadH) => Math.max(0, (raw + 1) * Math.exp(b * Math.exp(-Math.max(0, leadH) / CFG.biasLeadEfoldH)) - 1);
function interpT(times, arr, t) {
  const f = (t - times[0]) / HOUR; if (f < 0 || f > times.length - 1) return null;
  const i = Math.floor(f), a = f - i, x = arr[i], y = arr[Math.min(i + 1, arr.length - 1)];
  if (x == null || y == null) return x ?? y; return x + (y - x) * a;
}

// 24-h mean of an hourly series ending at time t (≥ 18 of 24 hours)
function mean24T(times, arr, t) { let s = 0, n = 0; for (let h = 0; h < 24; h++) { const v = interpT(times, arr, t - h * HOUR); if (v != null) { s += v; n++; } } return n >= 18 ? s / n : null; }
const isAvg24 = s => !s.hourly && CFG.avg24Providers.includes(s.provider);   // OpenAQ copies of Air4Thai: 24-h running means

// ------------------------------------------------------------------ main
async function main() {
  if (!process.env.OPENAQ_API_KEY) throw new Error('OPENAQ_API_KEY is not set');
  const state = await readJSON(path.join(DATA, 'state.json'), {});
  state.kf ||= {}; state.kfSlow ||= {}; state.obsHist ||= {};

  // 1. station list (daily)
  const a4tRetry = state.stations && !state.stations.some(s => s.hourly || s.feed24) && now - (state.a4tTried || 0) > CFG.a4t.retryH * HOUR;
  if (!state.stations || state.stationsCap !== CFG.maxStations || state.stationListVer !== CFG.stationListVer || now - (state.stationsAt || 0) > CFG.stationRefreshH * HOUR || a4tRetry) {
    try {
      const all = await oaqStations();
      let fresh = all.filter(s => now - s.last < 7 * 24 * HOUR);
      state.a4tTried = now;
      try {
        const a4 = (await a4tStations()).filter(s => now - s.last < 7 * 24 * HOUR);
        if (a4.length < 20) throw new Error(`only ${a4.length} active stations`);
        // drop OpenAQ copies of the same monitors (any OpenAQ site within dedupKm of an Air4Thai station)
        const before = fresh.length;
        fresh = fresh.filter(o => !a4.some(a => km(o.lat, o.lon, a.lat, a.lon) <= CFG.a4t.dedupKm));
        log(`Air4Thai direct: ${a4.length} active stations; replaced ${before - fresh.length} OpenAQ copies`);
        fresh = a4.concat(fresh);
      } catch (e) { log(`Air4Thai station list unavailable (${e.message}); using OpenAQ copies of Thai monitors`); }
      fresh.sort((a, b) => (b.monitor - a.monitor) || ((b.hourly ? 1 : 0) - (a.hourly ? 1 : 0)) || (b.last - a.last));
      if (state.stations) state.prevStations = state.stations;
      state.stations = fresh.slice(0, CFG.maxStations);
      state.stationsAt = now; state.stationsCap = CFG.maxStations; state.stationListVer = CFG.stationListVer;
      log(`stations: ${all.length} with pm25 in area, ${fresh.length} active, keeping ${state.stations.length}`);
    } catch (e) {
      if (!state.stations) throw e;
      log(`station list refresh failed (${e.message}); keeping the previous list`);
    }
  }
  // readings are attached fresh each run, so a station that stops reporting does not keep an old value
  for (const s of state.stations) delete s.obs;
  let stations = state.stations;

  // 2. CAMS forecast at stations + grid (every few hours)
  const g = CFG.gridBbox, step = CFG.gridStep;
  const nx = Math.round((g[2] - g[0]) / step) + 1, ny = Math.round((g[3] - g[1]) / step) + 1;
  const gridPts = []; for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) gridPts.push([g[1] + iy * step, g[0] + ix * step]);
  const stIds = stations.map(s => s.id).join(',');
  const gridKey = `${g.join(',')}|${step}`;
  if (!state.cams || now - state.cams.at > CFG.camsRefreshH * HOUR || state.cams.stIds !== stIds || state.cams.gridKey !== gridKey) {
    const pts = stations.map(s => [s.lat, s.lon]).concat(gridPts);
    try {
      const { times, series } = await camsSeries(pts);
      state.cams = { at: now, times, stIds, gridKey, st: series.slice(0, stations.length), grid: series.slice(stations.length) };
      log(`CAMS refreshed: ${pts.length} points × ${times.length} h`);
    } catch (e) {
      log(`CAMS refresh failed: ${e.message}`);
      const prevOK = state.cams && state.cams.gridKey === gridKey;
      if (prevOK && state.cams.stIds !== stIds && state.prevStations && state.prevStations.map(s => s.id).join(',') === state.cams.stIds) {
        stations = state.stations = state.prevStations; state.stationsAt = 0;   // go back to the list the old forecast matches; retry next run
        log('using the previous CAMS forecast and the previous station list');
      } else if (!prevOK || state.cams.stIds !== stIds) throw e;   // cannot continue without a forecast for these stations
      else log('using the previous CAMS forecast');
    }
  }
  const C = state.cams;

  // 3a. observations (no correction yet: the fire assimilation runs first, and the corrections are then fitted to what it leaves)
  const obs = await oaqLatest(stations.filter(s => !s.hourly && !s.feed24));
  // Air4Thai direct: the last ~2 days of hourly values in one or a few requests; also kept as a daily archive (one file per Thai day)
  const a4tSt = stations.filter(s => s.hourly), a4tH = new Map();
  if (stations.some(s => s.feed24)) {   // Bangkok (BMA) stations: latest 24-h mean from the live feed
    try { const cur = new Map((await a4tStations()).map(x => [x.id, x]));
      let n = 0; for (const s of stations) if (s.feed24) { const x = cur.get(s.id); if (x && x.pm != null && x.last) { obs.set(s.id, { t: x.last, v: x.pm }); n++; } }
      log(`Air4Thai Bangkok (BMA) feed: ${n} stations`); } catch (e) { log(`Air4Thai live feed unavailable: ${e.message}`); }
  }
  if (a4tSt.length) {
    try {
      const got = await a4tHourly(a4tSt.map(s => s.code), thaiDate(now - 24 * HOUR), thaiDate(now));
      for (const s of a4tSt) { const rows = got.get(s.code) || []; a4tH.set(s.id, rows); const last = rows[rows.length - 1]; if (last) obs.set(s.id, { t: last[0], v: last[1] }); }
      log(`Air4Thai hourly: ${[...a4tH.values()].filter(r => r.length).length}/${a4tSt.length} stations, latest hour ${new Date(Math.max(0, ...[...obs.entries()].filter(([k]) => String(k).startsWith('a4t:')).map(([, o]) => o.t))).toISOString().slice(0, 16)}Z`);
      const yday = thaiDate(now - 24 * HOUR), arch = path.join(DATA, 'history', yday.slice(0, 7), `a4t-${yday.replace(/-/g, '')}.csv`);
      const dayRows = []; for (const s of a4tSt) for (const [t, v] of a4tH.get(s.id) || []) if (thaiDate(t - HOUR) === yday) dayRows.push([new Date(t).toISOString().slice(0, 16) + 'Z', s.id, v]);
      // written once, from 03:00 Thai time, so the last hours of the day (published ~20 min late) are complete
      if (new Date(now + 7 * HOUR).getUTCHours() >= 3 && dayRows.length > a4tSt.length * 12 && await fs.access(arch).then(() => false, () => true)) {
        await appendCSV(arch, 'hour_end_utc,station_id,pm25', dayRows); log(`Air4Thai archive ${path.basename(arch)}: ${dayRows.length} hourly values`); }
    } catch (e) { log(`Air4Thai hourly unavailable: ${e.message}`); }
  }
  stations.forEach(s => {
    const o = obs.get(s.id); if (!o || now - o.t > CFG.obsMaxAgeH * HOUR || o.v < 0 || o.v > 1500) return;
    s.obs = o;
    if (s.hourly) { state.obsHist[s.id] = (a4tH.get(s.id) || []).filter(([t]) => t > now - 50 * HOUR).map(([t, v]) => [t, r1(v)]); return; }
    const hk = Math.round(o.t / HOUR) * HOUR, H = (state.obsHist[s.id] ||= []);
    if (!H.some(([t]) => t === hk)) H.push([hk, r1(o.v)]);
  });
  for (const id of Object.keys(state.obsHist)) { state.obsHist[id] = state.obsHist[id].filter(([t]) => t > now - 50 * HOUR); if (!state.obsHist[id].length) delete state.obsHist[id]; }
  // 24-h mean of observations ending at the latest hour; valid with ≥ 18 of 24 hourly values (75 %) and a recent last value
  function obs24(id, s) {
    if (s && isAvg24(s)) return s.obs ? { v: r1(s.obs.v), n: 24, tEnd: s.obs.t, valid: now - s.obs.t <= CFG.obsMaxAgeH * HOUR, native: true } : null;   // already a 24-h mean
    const H = state.obsHist[id] || []; if (!H.length) return null;
    const tEnd = Math.max(...H.map(([t]) => t)), w = H.filter(([t]) => t > tEnd - 24 * HOUR);
    return { v: r1(w.reduce((a, [, v]) => a + v, 0) / w.length), n: w.length, tEnd, valid: w.length >= 18 && now - tEnd <= CFG.obsMaxAgeH * HOUR };
  }
  // kind of a station's values: 'hm' = mean of the hour ending at t (Air4Thai direct), '24' = 24-h mean ending at t, 'h' = hourly (OpenAQ)
  const kindOf = s => s.hourly ? 'hm' : isAvg24(s) ? '24' : 'h';

  // 3b. meteorology (fixed model, nested grids), refreshed every few hours
  let met = await readJSON(path.join(DATA, 'met.json'), null);
  const metKey = JSON.stringify(CFG.met.grids) + MET_MODEL + '|n2';
  if (!met || met.key !== metKey || now - met.fetched > CFG.met.refreshH * HOUR) {
    try {
      met = await fetchMet(CFG.met.grids, { get, sleep, log, keepFrom: now - 36 * HOUR });
      met.key = metKey; await writeJSON(path.join(DATA, 'met.json'), met);
    } catch (e) { log(`met refresh failed: ${e.message}${met ? ' (keeping previous)' : ''}`); }
  }
  // compact copy for the page: 36 h back (dispersion spin-up) to 75 h ahead (longest forecast option + interpolation)
  if (met) { const web = packMet(met, now - 36 * HOUR, now + 75 * HOUR); await writeJSON(path.join(DATA, 'met-web.json'), web);
    log(`met-web: ${web.times.length} h, ${(JSON.stringify(web).length / 1024).toFixed(0)} KB (full ${(JSON.stringify(met).length / 1024).toFixed(0)} KB)`); }

  // 3c. hotspots
  let hot = await firmsHotspots(); let hotReused = false;
  if (!hot.length) {   // FIRMS unreachable or empty: keep the last good set (≤ 12 h old) rather than blanking the map
    const prev = await readJSON(path.join(DATA, 'latest.json'), null);
    const rows = prev?.hotspots?.rows || [], age = now - (prev?.hotspots?.fetched || prev?.generated || 0);
    if (rows.length && age < 12 * HOUR) { hot = rows; hotReused = true; log(`FIRMS returned nothing; reusing ${rows.length} hotspots from ${Math.round(age / 6e4)} min ago`); }
  }
  // MODIS IGBP land cover at each detection (per-fire fuel type, as in FINN); map cached, refreshed for a new year
  let LC = null;
  try { LC = unpackLandcover(await fs.readFile(path.join(DATA, 'landcover.bin'))); } catch { }
  const yNow = new Date(now).getUTCFullYear();
  if (!LC || (LC.year < yNow - 1 && now - (LC.built || 0) > 30 * 864e5)) {
    try { const nl = await buildLandcover(CFG.bbox, { get, log, year: yNow }); nl.built = now; LC = nl; await fs.writeFile(path.join(DATA, 'landcover.bin'), packLandcover(LC)); }
    catch (e) { log(`land cover unavailable: ${e.message}${LC ? ' (keeping previous map)' : ''}`); if (LC) { LC.built = now; await fs.writeFile(path.join(DATA, 'landcover.bin'), packLandcover(LC)); } }
  }
  if (LC) {
    hot = hot.map(r => [...r.slice(0, 6), landcoverAt(LC, r[0], r[1])]);
    const cnt = {}; for (const r of hot) cnt[r[6]] = (cnt[r[6]] || 0) + 1;
    log(`land cover at hotspots (IGBP ${LC.year}): ${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  const hotFetched = firmsHotspots.ok && !hotReused ? now : null;   // only a real FIRMS reply resets the age of the hotspot set

  // 3d. fire-emission data assimilation (scripts/assim.mjs): the last ~48 h of measurements correct the emissions of each fire
  //     group (0.5° × local day) in our puff model; the rescaled fires give a forecast increment that moves with the wind.
  //     Innovations: measured − CAMS with the station's slow bias removed. The slow bias is learned only from hours with little
  //     modelled fire smoke, so persistent burning-season smoke is not absorbed into it.
  let assim = null;
  if (CFG.assimilate && met && hot.length) {
    try {
      const M = loadModel();
      const hots = hot.map(([lat, lon, frp, t, conf, sat, igbp]) => ({ lat, lon, frp, t, igbp: igbp ?? null, sat: sat || 'VIIRS', level: conf === 'l' ? 'l' : conf === 'h' ? 'h' : 'n', pass: `${sat}|${Math.round(t / 6e5)}` }));
      const aobs = [];
      stations.forEach((s, i) => {
        const kind = kindOf(s), bs = state.kfSlow[s.id]?.b || 0, H = state.obsHist[s.id] || [];
        // 24-h-mean stations: two non-overlapping values (latest and 24 h before) to limit correlated repeats
        const use = kind === '24' ? H.filter(([t]) => { const last = H[H.length - 1][0]; return t === last || Math.abs(t - (last - 24 * HOUR)) < HOUR / 2; }) : H;
        for (const [t, v] of use) {
          const raw = kind === '24' ? mean24T(C.times, C.st[i], t) : interpT(C.times, C.st[i], kind === 'hm' ? t - HOUR / 2 : t); if (raw == null) continue;
          aobs.push({ id: s.id, lat: s.lat, lon: s.lon, t, y: v, c: (raw + 1) * Math.exp(bs) - 1, kind }); } });
      assim = assimilateFires({ M, hots, W: { times: met.times, sample: (la, lo, t) => sampleMet(met, la, lo, t) }, obs: aobs, now, kappa: state.assimKappa || undefined, log });
      assim.at = now;
      if (assim.status === 'ok') state.assimKappa = assim.kappaNext; else log(`fire assimilation: ${assim.status}`);
    } catch (e) { log(`fire assimilation failed: ${e.message}`); assim = null; }
  }
  const incAt = (s, t, kind) => assim?.inc ? assim.incAt(s.lat, s.lon, t, kind) : 0;
  const fireAt = (s, t, kind) => assim?.prior ? assim.fireAt(s.lat, s.lon, t, kind) : 0;

  // 3e. Kalman filters, in sequence after the assimilation:
  //     kf   — bias of CAMS (public forecast, unchanged method)
  //     kfA  — bias of CAMS + assimilation increment (corrects only what the assimilation leaves; no double counting)
  //     kfSlow — slow bias of CAMS, updated only at hours with < 1 µg/m³ of modelled fire smoke
  state.kfA ||= {};
  const obsRows = [];
  const updateAll = (s, t, v, raw, kind) => {
    const inc = incAt(s, t, kind), rawA = Math.max(0, raw + inc);
    const y = Math.log(v + 1) - Math.log(raw + 1), yA = Math.log(v + 1) - Math.log(rawA + 1);
    if (!(state.kf[s.id] && t <= state.kf[s.id].t)) state.kf[s.id] = kfStep(state.kf[s.id], y, t);
    if (!(state.kfA[s.id] && t <= state.kfA[s.id].t)) state.kfA[s.id] = kfStep(state.kfA[s.id], yA, t);
    if (!(state.kfSlow[s.id] && t <= state.kfSlow[s.id].t) && fireAt(s, t, kind) < 1) state.kfSlow[s.id] = kfStep(state.kfSlow[s.id], y, t, CFG.kfSlow);
    obsRows.push([new Date(t).toISOString(), s.id, r1(v), r1(raw), r1(rawA)]);
  };
  stations.forEach((s, i) => {
    if (!s.obs) return; const kind = kindOf(s);
    if (s.hourly) {   // every hour not yet used, in time order; the hour-ending mean is compared with CAMS at mid-hour
      for (const [t, v] of (a4tH.get(s.id) || []).filter(([t]) => t > now - 12 * HOUR)) {
        if (state.kf[s.id] && t <= state.kf[s.id].t && state.kfA[s.id] && t <= state.kfA[s.id].t) continue;
        const raw = interpT(C.times, C.st[i], t - HOUR / 2); if (raw == null) continue;
        updateAll(s, t, v, raw, kind);
      }
      return;
    }
    const o = s.obs; if (state.kf[s.id] && o.t <= state.kf[s.id].t && state.kfA[s.id] && o.t <= state.kfA[s.id].t) return;   // already used
    const raw = kind === '24' ? mean24T(C.times, C.st[i], o.t) : interpT(C.times, C.st[i], o.t); if (raw == null) return;
    updateAll(s, o.t, o.v, raw, kind);   // 24-h-mean stations: observed 24-h mean vs CAMS (+ increment) 24-h mean
  });
  log(`Kalman updated at ${new Set(obsRows.map(r => r[1])).size} stations (${obsRows.length} values)`);

  // 4. corrected forecasts at stations: without (corr, fc24) and with (corrA, fc24A) the fire assimilation
  const t0 = Math.floor(now / HOUR) * HOUR;
  const iNow = Math.max(0, C.times.findIndex(t => t >= t0));
  const i0 = Math.max(0, iNow - 24);        // output starts 24 h back so 24-h running means are complete
  const hours = C.times.slice(i0), jNow = iNow - i0;
  function stationForecast(s, raw, k) {
    const b = k && now - k.t < CFG.kf.maxGapH * HOUR ? k.b : 0, a24 = isAvg24(s);
    const corr = raw.map((v, j) => v == null ? null : r1(correct(v, b, (hours[j] - (k?.t || now)) / HOUR)));
    let fc24 = null;
    const o24n = !a24 ? obs24(s.id, s) : null;
    if (!a24 && o24n && o24n.valid) {
      // hourly monitors: 24-h mean ending at each hour = observed hours up to now, corrected forecast after; future hours are
      // blended with persistence of the current observed 24-h mean (same weight as for the 24-h-mean stations)
      const hist = new Map((state.obsHist[s.id] || []).map(([t, v]) => [t, v]));
      const val = hours.map((t, j) => j <= jNow ? (hist.has(t) ? hist.get(t) : null) : corr[j]);
      fc24 = hours.map((t, j) => {
        let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? val[q] : null; if (v != null) { su += v; n++; } }
        if (n < 18) return null; const m = su / n; return r1(j <= jNow ? m : CFG.blendW * o24n.v + (1 - CFG.blendW) * m);
      });
    }
    if (a24) {   // 24-h-mean stations: past hours carry the observed 24-h means; future = blend of persistence and corrected forecast (no fade)
      const hist = new Map((state.obsHist[s.id] || []).map(([t, v]) => [t, v])), nf = raw.map(v => v == null ? null : Math.max(0, (v + 1) * Math.exp(b) - 1));
      const o0 = s.obs && now - s.obs.t <= CFG.obsMaxAgeH * HOUR ? s.obs.v : null;
      fc24 = hours.map((t, j) => {
        if (j <= jNow) return hist.has(t) ? hist.get(t) : null;
        let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? nf[q] : null; if (v != null) { su += v; n++; } }
        if (n < 18) return null; const m = su / n; return r1(o0 != null ? CFG.blendW * o0 + (1 - CFG.blendW) * m : m);
      });
    }
    return { b, corr, fc24 };
  }
  const anyInc = !!assim?.inc;
  const outStations = stations.map((s, i) => {
    const k = state.kf[s.id], raw = C.st[i].slice(i0), F = stationForecast(s, raw, k);
    let A = null, incS = null;
    if (anyInc) { incS = hours.map(t => r1(incAt(s, t, 'h'))); const rawA = raw.map((v, j) => v == null ? null : Math.max(0, v + incS[j]));
      A = stationForecast(s, rawA, state.kfA[s.id]); }
    else { const kA = state.kfA[s.id]; A = stationForecast(s, raw, kA); }   // no increment: same as CAMS, but with its own filter state
    return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, monitor: s.monitor, provider: s.provider, cc: s.country, avg24: isAvg24(s), hourly: !!s.hourly, ...(s.nameTH ? { nameTH: s.nameTH } : {}),
      obs: s.obs ? { t: s.obs.t, v: r1(s.obs.v) } : null, obs24: obs24(s.id, s), bias: k ? +F.b.toFixed(3) : null, nUpd: k?.n || 0, raw, corr: F.corr, fc24: F.fc24,
      corrA: A.corr, fc24A: A.fc24, ...(incS && incS.some(v => Math.abs(v) >= 0.1) ? { inc: incS } : {}),
      // measured values on the page's hour axis up to now (hourly values, or the reported 24-h means for 24-h stations), for the map comparison layer
      obsSeries: (() => { const h = new Map((state.obsHist[s.id] || []).map(([t, v]) => [t, v])); const a = hours.slice(0, jNow + 1).map(t => h.has(t) ? h.get(t) : null); return a.some(v => v != null) ? a : null; })() };
  });

  // 4c. self-learning post-processing (scripts/ml.mjs): once a day, score yesterday's experts on the newly verified day and
  //     retrain them; every hour, apply the weighted correction to the hourly stations' forecasts (only once an expert has
  //     earned weight). Features are the values known now, also written to the forecast log for training.
  const season = await readJSON(path.join(DATA, 'ml', 'season.json'), null);
  const thaiHour = new Date(now + 7 * HOUR).getUTCHours(), yday = thaiDate(now - 24 * HOUR);
  let mlRec = null;
  if (thaiHour >= 4 && state.ml?.lastDay !== yday) {
    try {
      const meta = new Map(stations.map(s => [String(s.id), { lat: s.lat, lon: s.lon }]));
      const dayStart = Date.parse(yday + 'T00:00:00+07:00'), dayEnd = dayStart + 864e5;
      const rows = await loadDataset(path.join(DATA, 'history'), meta, { from: dayEnd - 36 * 864e5, to: dayEnd });
      // long-term training store (branch "mltrain", 2 years): the verified day's rows, then the season expert's data
      const nStored = await storeDay(path.join(DATA, 'mltrain'), rows, dayStart, zlib.gzipSync);
      const seasonRows = await loadSeasonRows(path.join(DATA, 'mltrain'), dayStart + 12 * HOUR, zlib.gunzipSync, dayEnd);
      log(`ML store: ${nStored} rows for ${yday}; season ${seasonRows.season}: ${seasonRows.days} days, ${seasonRows.rows.length} rows`);
      mlRec = dailyLearn(state, rows, { now, dayStart, dayEnd, season, seasonRows, log });
      await writeJSON(path.join(DATA, 'history', yday.slice(0, 7), `ml-${yday.replace(/-/g, '')}.json`), mlRec);
    } catch (e) { log(`ML daily learning failed: ${e.message}`); }
  }
  const mlOn = mlActive(state, season);
  const featAt = (s, i, j) => {   // features of station s for output hour j (known at issue time)
    const t = hours[j], m = met ? sampleMet(met, s.lat, s.lon, t) : null, o24 = obs24(s.id, s);
    return { inc: incAt(s, t, 'h'), fire: fireAt(s, t, 'h'), blh: m ? m.blh : '', ws: m ? m.ws : '', pr: m ? m.pr : '',
      obs_last: s.obs && !isAvg24(s) ? s.obs.v : '', obs24_last: o24 && o24.valid ? o24.v : '', kfAb: state.kfA[s.id]?.b ?? 0,
      hloc: new Date(t + 7 * HOUR).getUTCHours(), doy: Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / 864e5) + 1 };
  };
  const featCache = new Map();
  const feats = (s, i, j) => { const k = `${i}|${j}`; if (!featCache.has(k)) featCache.set(k, featAt(s, i, j)); return featCache.get(k); };
  if (mlOn) {
    let nAdj = 0;
    outStations.forEach((o, i) => {
      const s = stations[i]; if (isAvg24(s) || !o.corrA) return;
      const corrM = o.corrA.map((v, j) => { if (v == null || j <= jNow) return v;
        const f = feats(s, i, j), q = mlCorrection(state, { ...f, lead: (hours[j] - t0) / HOUR, F: v, cams: o.raw[j], lat: s.lat, lon: s.lon, x: null }, season);
        return r1(Math.max(0, (v + 1) * Math.exp(q) - 1)); });
      // 24-h means for the AQI: measured hours up to now, ML-corrected forecast after, blended with persistence as before
      const o24n = obs24(s.id, s); let fc24M = o.fc24A;
      if (o24n && o24n.valid) { const hist = new Map((state.obsHist[s.id] || []).map(([t, v]) => [t, v]));
        const val = hours.map((t, j) => j <= jNow ? (hist.has(t) ? hist.get(t) : null) : corrM[j]);
        fc24M = hours.map((t, j) => { let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? val[q] : null; if (v != null) { su += v; n++; } }
          if (n < 18) return null; const m = su / n; return r1(j <= jNow ? m : CFG.blendW * o24n.v + (1 - CFG.blendW) * m); }); }
      o.corrM = corrM; o.fc24M = fc24M; nAdj++;
    });
    log(`ML correction applied at ${nAdj} hourly stations (weights ${JSON.stringify(state.ml.weights)})`);
  }

  // 5. regression kriging (RIMM-type) at the analysis hour, in log space:
  //    ln(obs+1) = b0 + b1 ln(C+1) + b2 elev_km + b3 ln(BLH/1000) + b4 wind100 + residual;  residual → ordinary kriging on a 0.1° grid.
  //    Two versions: C = CAMS (rk, public) and C = CAMS + assimilation increment (rkA): the kriging then corrects only what the
  //    assimilation leaves, so the same error is not corrected twice. The page applies B to the hourly C with a lead-time fade.
  let dem = await readJSON(path.join(DATA, 'static', 'elev.json'), null);
  const demKey = `${g.join(',')}|${CFG.rk.demStep}`;
  if (!dem || dem.key !== demKey) {
    try {
      dem = await buildDEM(g, CFG.rk.demStep, { log, fetchTile: async (z, x, y) =>
        Buffer.from(await (await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`)).arrayBuffer()) });
      dem.key = demKey;
      await writeJSON(path.join(DATA, 'static', 'elev.json'), dem);
    } catch (e) { log(`DEM unavailable, regression without elevation: ${e.message}`); dem = null; }
  }
  const rs = CFG.rk.residStep, rnx = Math.round((g[2] - g[0]) / rs) + 1, rny = Math.round((g[3] - g[1]) / rs) + 1;
  function runRK(withInc) {
    const label = withInc ? 'RK+assim' : 'RK';
    const rkObs = [];
    // the kriging works on 24-h means (what Air4Thai reports and what the AQI uses): observed 24-h mean vs model 24-h mean
    stations.forEach((s, i) => {
      if (!s.monitor || !s.obs || now - s.obs.t > CFG.obsMaxAgeH * HOUR) return;
      const o24 = obs24(s.id, s); if (!o24 || !o24.valid) return;
      let c = mean24T(C.times, C.st[i], s.obs.t); if (c == null) return;
      if (withInc) c = Math.max(0, c + incAt(s, s.obs.t, '24'));
      const x = [Math.log(c + 1)]; if (dem) { const e = sampleGrid(dem, s.lat, s.lon); if (e == null) return; x.push(e / 1000); }
      if (met) { const m = sampleMet(met, s.lat, s.lon, s.obs.t); x.push(Math.log(Math.max(m.blh, 50) / 1000), m.ws); }
      rkObs.push({ lat: s.lat, lon: s.lon, y: Math.log(o24.v + 1), x, obs: o24.v, cams: c, t: s.obs.t, cc: s.country });
    });
    if (rkObs.length < CFG.rk.minStations) { log(`${label} skipped: only ${rkObs.length} monitors with fresh data`); return null; }
    const out = regressionKriging(rkObs, { lon0: g[0], lat0: g[1], step: rs, nx: rnx, ny: rny }, { K: CFG.rk.K, declusterDeg: CFG.rk.declusterDeg });
    if (!out) return null;
    const err = (a, b) => ({ rmse: +Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length).toFixed(2), mb: +(a.reduce((s, v, i) => s + v - b[i], 0) / a.length).toFixed(2) });
    // leave-one-out scores that are not dominated by the dense Bangkok network: declustering-weighted, and by area
    const W = out.weights, werr = (a, b) => { const sw = W.reduce((x, v) => x + v, 0); return { rmse: +Math.sqrt(a.reduce((s, v, i) => s + W[i] * (v - b[i]) ** 2, 0) / sw).toFixed(2), mb: +(a.reduce((s, v, i) => s + W[i] * (v - b[i]), 0) / sw).toFixed(2) }; };
    const areaOf = r => r.cc && r.cc !== 'TH' ? 'outside Thailand' : inBox(r.lat, r.lon, [100.3, 13.45, 100.95, 14.05]) ? 'Bangkok' : inBox(r.lat, r.lon, [97.3, 16.5, 101.4, 20.5]) ? 'upper North' : 'rest of Thailand';
    const byArea = {}; rkObs.forEach((r, i) => { const a = areaOf(r); (byArea[a] ||= []).push(i); });
    const areaCV = Object.fromEntries(Object.entries(byArea).map(([a, ix]) => [a, { n: ix.length, cams: err(ix.map(i => rkObs[i].cams), ix.map(i => rkObs[i].obs)), rk: err(ix.map(i => out.cv[i]), ix.map(i => rkObs[i].obs)) }]));
    const o = rkObs.map(r => r.obs), tSorted = rkObs.map(r => r.t).sort((a, b) => a - b);
    const rk = { t: tSorted[Math.floor(tSorted.length / 2)], n: rkObs.length, withAssim: withInc, beta: out.beta.map(b => +b.toFixed(4)), predictors: ['ln(CAMS+1)', ...(dem ? ['elevation_km'] : []), ...(met ? ['ln(BLH_km)', 'wind100_ms'] : [])],
      vario: { ...out.vario, c0: +out.vario.c0.toFixed(4), c1: +out.vario.c1.toFixed(4) }, maxKm: out.maxKm, leadEfoldH: CFG.biasLeadEfoldH,
      cv: { n: o.length, cams: err(rkObs.map(r => r.cams), o), rk: err(out.cv, o), cover1s: out.cvCover1s, sdMedian: out.cvSdMedian,
        declustered: { cams: werr(rkObs.map(r => r.cams), o), rk: werr(out.cv, o) }, byArea: areaCV },
      regCov: { s2n: +out.regCov.s2n.toPrecision(4), xbar: out.regCov.xbar.map(x => +x.toPrecision(6)), covSlope: out.regCov.covSlope && out.regCov.covSlope.map(r => r.map(x => +x.toPrecision(6))) } };
    // bias field for the page: B = predicted ln(PM24+1) − ln(C24+1) on the residual grid, applied to the hourly C as (c+1)·e^(w·B) − 1;
    // total σ (kriged residual + regression part) on the same grid
    const R = out.resid, cg = C.grid, gnx = nx, gny = ny, B = new Array(R.nx * R.ny), SD = new Array(R.nx * R.ny);
    const inc24 = withInc && assim?.inc ? assim.incGrid24({ lon0: R.lon0, lat0: R.lat0, step: R.step, nx: R.nx, ny: R.ny }, rk.t) : null;
    const cams24At = (lat, lon) => { const fx = (lon - g[0]) / step, fy = (lat - g[1]) / step; if (fx < 0 || fy < 0 || fx > gnx - 1 || fy > gny - 1) return null;
      const x0 = Math.min(Math.floor(fx), gnx - 2), y0 = Math.min(Math.floor(fy), gny - 2), ax = fx - x0, ay = fy - y0;
      const P = [[y0 * gnx + x0, (1 - ax) * (1 - ay)], [y0 * gnx + x0 + 1, ax * (1 - ay)], [(y0 + 1) * gnx + x0, (1 - ax) * ay], [(y0 + 1) * gnx + x0 + 1, ax * ay]];
      let su = 0, n = 0; for (let h = 0; h < 24; h++) { let v = 0, ok = true; for (const [p, w] of P) { const q = interpT(C.times, cg[p], rk.t - h * HOUR); if (q == null) { ok = false; break; } v += w * q; } if (ok) { su += v; n++; } }
      return n >= 18 ? su / n : null; };
    const { s2n, xbar, covSlope } = out.regCov;
    for (let iy = 0; iy < R.ny; iy++) for (let ix = 0; ix < R.nx; ix++) {
      const lat = R.lat0 + iy * R.step, lon = R.lon0 + ix * R.step, q = iy * R.nx + ix; let c24 = cams24At(lat, lon);
      if (c24 == null) { B[q] = 0; SD[q] = null; continue; }
      if (inc24) c24 = Math.max(0, c24 + inc24[q]);
      const x = [Math.log(c24 + 1)]; if (dem) x.push((sampleGrid(dem, lat, lon) ?? 0) / 1000);
      if (met) { const m = sampleMet(met, lat, lon, rk.t); x.push(Math.log(Math.max(m.blh, 50) / 1000), m.ws); }
      const reg = out.beta[0] + x.reduce((a, v, j) => a + out.beta[j + 1] * v, 0);
      B[q] = Math.round((reg - x[0] + R.values[q]) * 1000) / 1000;
      let rv = s2n; if (covSlope) for (let a = 0; a < x.length; a++) for (let b2 = 0; b2 < x.length; b2++) rv += (x[a] - xbar[a]) * covSlope[a][b2] * (x[b2] - xbar[b2]);
      SD[q] = Math.round(Math.sqrt((R.sd[q] ?? 0) ** 2 + Math.max(0, rv)) * 100) / 100;
    }
    rk.basis = '24h'; rk.bias = { lon0: R.lon0, lat0: R.lat0, step: R.step, nx: R.nx, ny: R.ny, values: B, sd: SD };
    rk.decluster = { cellDeg: out.declusterDeg, weightRange: out.weightRange };
    log(`${label}: ${rk.n} monitors (declustered, ${out.declusterDeg}° cells, weights ${out.weightRange.join('–')}), beta=[${rk.beta.join(', ')}], range ${rk.vario.a_km} km, LOO RMSE model ${rk.cv.cams.rmse} → RK ${rk.cv.rk.rmse} µg/m³ (declustered ${rk.cv.declustered.cams.rmse} → ${rk.cv.declustered.rk.rmse}), ±1σ coverage ${rk.cv.cover1s}`);
    log(`${label} LOO by area (model → RK, µg/m³): ` + Object.entries(areaCV).map(([a, v]) => `${a} n=${v.n} ${v.cams.rmse}→${v.rk.rmse}`).join(' · '));
    return rk;
  }
  const rk = runRK(false), rkA = anyInc ? runRK(true) : null;   // without an increment rkA would equal rk
  const gridRaw = hours.map((t, j) => gridPts.map((_, p) => { const v = C.grid[p][i0 + j]; return v == null ? -1 : r1(v); }));

  // 7. outputs
  await writeJSON(path.join(DATA, 'latest.json'), {
    generated: now, camsIssued: C.at, bbox: CFG.bbox, runlog: RUNLOG,
    method: { kf: CFG.kf, biasLeadEfoldH: CFG.biasLeadEfoldH, rk: CFG.rk },
    rk, rkA, assim: assimSummary(assim), ml: state.ml ? { active: mlOn, weights: state.ml.weights, lastDay: state.ml.lastDay, experts: Object.keys(state.ml.models || {}).concat(season ? ['season'] : []), last: mlRec } : null, dem: dem ? { file: 'data/static/elev.json', step: dem.step, source: dem.source } : null,
    met: met ? { file: 'data/met-web.json', model: met.model, fetched: met.fetched, grids: met.grids.map(g => ({ step: g.step, bbox: [g.lon0, g.lat0, g.lon0 + (g.nx - 1) * g.step, g.lat0 + (g.ny - 1) * g.step] })) } : null,
    hours, stations: outStations,
    grid: { lon0: g[0], lat0: g[1], step, nx, ny, values: gridRaw },  // raw CAMS; the page applies rk
    hotspots: { cols: ['lat', 'lon', 'frp', 't', 'conf', 'sat', 'igbp'], igbpYear: LC?.year ?? null, rows: hot, fetched: hotFetched ?? (await readJSON(path.join(DATA, 'latest.json'), null))?.hotspots?.fetched ?? null },
  });
  // history: one small new file per run (never rewritten), so git stores each row once
  const iso = new Date(now).toISOString(), ym = iso.slice(0, 7), stamp = iso.slice(0, 13).replace(/[-:]/g, '');
  const hdir = path.join(DATA, 'history', ym);
  await appendCSV(path.join(hdir, `obs-${stamp}.csv`), 'time_utc,station_id,obs_pm25,cams_raw,cams_plus_inc', obsRows);
  // forecast log: without and with the fire assimilation (corrA, blend24A), so verify.mjs scores both on the same rows
  const fRows = [], stIndex = new Map(stations.map((s, i) => [s.id, i]));
  const m24 = (arr, j) => { if (!arr) return ''; let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? arr[q] : null; if (v != null) { su += v; n++; } } return n >= 18 ? r1(su / n) : ''; };
  for (const s of outStations) if (s.monitor) for (const L of CFG.logLeads) { const j = jNow + L; if (j < hours.length && s.raw[j] != null)
    fRows.push([new Date(now).toISOString().slice(0, 13) + ':00Z', new Date(hours[j]).toISOString().slice(0, 13) + ':00Z', s.id, L, s.raw[j], s.corr[j],
      s.fc24 ? m24(s.raw, j) : '', s.fc24 ? m24(s.corr, j) : '', s.fc24?.[j] != null ? s.fc24[j] : '', s.avg24 ? '24' : 'h',
      s.corrA?.[j] ?? '', s.fc24A?.[j] != null ? s.fc24A[j] : '', s.corrM?.[j] ?? '', s.fc24M?.[j] != null ? s.fc24M[j] : '',
      ...(() => { const i = stIndex.get(s.id), f = feats(stations[i], i, j); return FEAT_COLS.map(k => f[k] === '' || f[k] == null ? '' : (typeof f[k] === 'number' ? +f[k].toFixed(3) : f[k])); })()]); }
  const fcstFile = path.join(hdir, `fcst-${stamp}.csv`);   // one file per issue hour: a second run in the same hour must not double-count it
  if (await fs.access(fcstFile).then(() => false, () => true)) await appendCSV(fcstFile, 'issued_utc,valid_utc,station_id,lead_h,cams_raw,corrected,cams24,corr24,blend24,obs_basis,correctedA,blend24A,correctedML,blend24ML,' + FEAT_COLS.join(','), fRows);
  else log(`forecast log for ${stamp} already written this hour`);
  await writeJSON(path.join(DATA, 'state.json'), state);
  log(`done: ${outStations.length} stations, ${hot.length} hotspots, grid ${nx}×${ny}×${hours.length}`);
}

main().catch(async e => {
  log(`FAILED: ${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await writeJSON(path.join(DATA, 'runlog.json'), { at: now, ok: !process.exitCode, log: RUNLOG });
});

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
  biasLeadEfoldH: 48,            // bias correction fades with lead time
  rk: { residStep: 0.1, demStep: 0.05, minStations: 15, K: 16 },  // regression kriging; residual grid and DEM resolution
  logLeads: [1, 3, 6, 12, 24, 48],
  // Air4Thai stations on OpenAQ report PM2.5 as a 24-h running mean, not hourly values (verified on Jan–Apr 2026: flat daily cycle,
  // mean hour-to-hour change 0.4 µg/m3); their correction and kriging therefore compare like with like (24-h means)
  avg24Providers: ['Air4Thai'],
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
function kfStep(st, y, tObs) {
  const { Q, R, P0, maxGapH } = CFG.kf;
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
const isAvg24 = s => CFG.avg24Providers.includes(s.provider);

// ------------------------------------------------------------------ main
async function main() {
  if (!process.env.OPENAQ_API_KEY) throw new Error('OPENAQ_API_KEY is not set');
  const state = await readJSON(path.join(DATA, 'state.json'), {});
  state.kf ||= {}; state.obsHist ||= {};

  // 1. station list (daily)
  if (!state.stations || state.stationsCap !== CFG.maxStations || now - (state.stationsAt || 0) > CFG.stationRefreshH * HOUR) {
    try {
      const all = await oaqStations();
      const fresh = all.filter(s => now - s.last < 7 * 24 * HOUR);
      fresh.sort((a, b) => (b.monitor - a.monitor) || (b.last - a.last));
      if (state.stations) state.prevStations = state.stations;
      state.stations = fresh.slice(0, CFG.maxStations);
      state.stationsAt = now; state.stationsCap = CFG.maxStations;
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

  // 3. observations + Kalman update
  const obs = await oaqLatest(stations);
  const obsRows = [];
  stations.forEach((s, i) => {
    const o = obs.get(s.id); if (!o || now - o.t > CFG.obsMaxAgeH * HOUR || o.v < 0 || o.v > 1500) return;
    s.obs = o;
    // keep the last 30 h of hourly observations per station for standard 24-h means (AQI)
    const hk = Math.round(o.t / HOUR) * HOUR, H = (state.obsHist[s.id] ||= []);
    if (!H.some(([t]) => t === hk)) H.push([hk, r1(o.v)]);
    state.obsHist[s.id] = H.filter(([t]) => t > now - 30 * HOUR);
    const k = state.kf[s.id];
    if (k && o.t <= k.t) return;            // already used this hour
    const raw = isAvg24(s) ? mean24T(C.times, C.st[i], o.t) : interpT(C.times, C.st[i], o.t); if (raw == null) return;
    const y = Math.log(o.v + 1) - Math.log(raw + 1);   // 24-h-mean stations: observed 24-h mean vs CAMS 24-h mean
    state.kf[s.id] = kfStep(k, y, o.t);
    obsRows.push([new Date(o.t).toISOString(), s.id, r1(o.v), r1(raw)]);
  });
  log(`Kalman updated at ${obsRows.length} stations`);

  for (const id of Object.keys(state.obsHist)) { state.obsHist[id] = state.obsHist[id].filter(([t]) => t > now - 30 * HOUR); if (!state.obsHist[id].length) delete state.obsHist[id]; }
  // 24-h mean of observations ending at the latest hour; valid with ≥ 18 of 24 hourly values (75 %) and a recent last value
  function obs24(id, s) {
    if (s && isAvg24(s)) return s.obs ? { v: r1(s.obs.v), n: 24, tEnd: s.obs.t, valid: now - s.obs.t <= CFG.obsMaxAgeH * HOUR, native: true } : null;   // already a 24-h mean
    const H = state.obsHist[id] || []; if (!H.length) return null;
    const tEnd = Math.max(...H.map(([t]) => t)), w = H.filter(([t]) => t > tEnd - 24 * HOUR);
    return { v: r1(w.reduce((a, [, v]) => a + v, 0) / w.length), n: w.length, tEnd, valid: w.length >= 18 && now - tEnd <= CFG.obsMaxAgeH * HOUR };
  }

  // 4. corrected forecasts at stations
  const t0 = Math.floor(now / HOUR) * HOUR;
  const iNow = Math.max(0, C.times.findIndex(t => t >= t0));
  const i0 = Math.max(0, iNow - 24);        // output starts 24 h back so 24-h running means are complete
  const hours = C.times.slice(i0), jNow = iNow - i0;
  const outStations = stations.map((s, i) => {
    const k = state.kf[s.id]; const b = k && now - k.t < CFG.kf.maxGapH * HOUR ? k.b : 0;
    const raw = C.st[i].slice(i0);
    const corr = raw.map((v, j) => v == null ? null : r1(correct(v, b, (hours[j] - (k?.t || now)) / HOUR)));
    const a24 = isAvg24(s);
    // 24-h-mean stations: forecast of the 24-h mean ending at each future hour = blend of persistence and corrected CAMS (no fade);
    // past hours carry the observed 24-h means
    let fc24 = null;
    if (a24) {
      const hist = new Map((state.obsHist[s.id] || []).map(([t, v]) => [t, v])), nf = raw.map(v => v == null ? null : Math.max(0, (v + 1) * Math.exp(b) - 1));
      const o0 = s.obs && now - s.obs.t <= CFG.obsMaxAgeH * HOUR ? s.obs.v : null;
      fc24 = hours.map((t, j) => {
        if (j <= jNow) return hist.has(t) ? hist.get(t) : null;
        let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? nf[q] : null; if (v != null) { su += v; n++; } }
        if (n < 18) return null; const m = su / n; return r1(o0 != null ? CFG.blendW * o0 + (1 - CFG.blendW) * m : m);
      });
    }
    return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, monitor: s.monitor, provider: s.provider, cc: s.country, avg24: a24,
      obs: s.obs ? { t: s.obs.t, v: r1(s.obs.v) } : null, obs24: obs24(s.id, s), bias: k ? +b.toFixed(3) : null, nUpd: k?.n || 0, raw, corr, fc24 };
  });

  // 4b. meteorology (fixed model, nested grids), refreshed every few hours
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

  // 5. regression kriging (RIMM-type) at the analysis hour, in log space:
  //    ln(obs+1) = b0 + b1 ln(CAMS+1) + b2 elev_km + b3 ln(BLH/1000) + b4 wind100 + residual;  residual → ordinary kriging on a 0.1° grid.
  //    The page applies it to every forecast hour, fading the correction with lead time (biasLeadEfoldH).
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
  let rk = null;
  const rkObs = [];
  // the kriging works on 24-h means (what Air4Thai reports and what the AQI uses): observed 24-h mean vs CAMS 24-h mean
  stations.forEach((s, i) => {
    if (!s.monitor || !s.obs || now - s.obs.t > CFG.obsMaxAgeH * HOUR) return;
    const o24 = obs24(s.id, s); if (!o24 || !o24.valid) return;
    const c = mean24T(C.times, C.st[i], s.obs.t); if (c == null) return;
    const x = [Math.log(c + 1)]; if (dem) { const e = sampleGrid(dem, s.lat, s.lon); if (e == null) return; x.push(e / 1000); }
    if (met) { const m = sampleMet(met, s.lat, s.lon, s.obs.t); x.push(Math.log(Math.max(m.blh, 50) / 1000), m.ws); }
    rkObs.push({ lat: s.lat, lon: s.lon, y: Math.log(o24.v + 1), x, obs: o24.v, cams: c, t: s.obs.t });
  });
  if (rkObs.length >= CFG.rk.minStations) {
    const rs = CFG.rk.residStep, rnx = Math.round((g[2] - g[0]) / rs) + 1, rny = Math.round((g[3] - g[1]) / rs) + 1;
    const out = regressionKriging(rkObs, { lon0: g[0], lat0: g[1], step: rs, nx: rnx, ny: rny }, { K: CFG.rk.K });
    if (out) {
      const err = (a, b) => ({ rmse: +Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length).toFixed(2), mb: +(a.reduce((s, v, i) => s + v - b[i], 0) / a.length).toFixed(2) });
      const o = rkObs.map(r => r.obs), tSorted = rkObs.map(r => r.t).sort((a, b) => a - b);
      rk = { t: tSorted[Math.floor(tSorted.length / 2)], n: rkObs.length, beta: out.beta.map(b => +b.toFixed(4)), predictors: ['ln(CAMS+1)', ...(dem ? ['elevation_km'] : []), ...(met ? ['ln(BLH_km)', 'wind100_ms'] : [])],
        vario: { ...out.vario, c0: +out.vario.c0.toFixed(4), c1: +out.vario.c1.toFixed(4) }, maxKm: out.maxKm, leadEfoldH: CFG.biasLeadEfoldH,
        cv: { n: o.length, cams: err(rkObs.map(r => r.cams), o), rk: err(out.cv, o), cover1s: out.cvCover1s, sdMedian: out.cvSdMedian },
        regCov: { s2n: +out.regCov.s2n.toPrecision(4), xbar: out.regCov.xbar.map(x => +x.toPrecision(6)), covSlope: out.regCov.covSlope && out.regCov.covSlope.map(r => r.map(x => +x.toPrecision(6))) }, resid: out.resid };
      // bias field for the page: B = predicted ln(PM24+1) − ln(CAMS24+1), on the residual grid; applied to hourly CAMS as (c+1)·e^(w·B) − 1.
      // Total σ (kriged residual + regression part) on the same grid.
      { const R = out.resid, cg = C.grid, gnx = nx, gny = ny, B = new Array(R.nx * R.ny), SD = new Array(R.nx * R.ny);
        const cams24At = (lat, lon) => { const fx = (lon - g[0]) / step, fy = (lat - g[1]) / step; if (fx < 0 || fy < 0 || fx > gnx - 1 || fy > gny - 1) return null;
          const x0 = Math.min(Math.floor(fx), gnx - 2), y0 = Math.min(Math.floor(fy), gny - 2), ax = fx - x0, ay = fy - y0;
          const P = [[y0 * gnx + x0, (1 - ax) * (1 - ay)], [y0 * gnx + x0 + 1, ax * (1 - ay)], [(y0 + 1) * gnx + x0, (1 - ax) * ay], [(y0 + 1) * gnx + x0 + 1, ax * ay]];
          let su = 0, n = 0; for (let h = 0; h < 24; h++) { let v = 0, ok = true; for (const [p, w] of P) { const q = interpT(C.times, cg[p], rk.t - h * HOUR); if (q == null) { ok = false; break; } v += w * q; } if (ok) { su += v; n++; } }
          return n >= 18 ? su / n : null; };
        const { s2n, xbar, covSlope } = out.regCov;
        for (let iy = 0; iy < R.ny; iy++) for (let ix = 0; ix < R.nx; ix++) {
          const lat = R.lat0 + iy * R.step, lon = R.lon0 + ix * R.step, q = iy * R.nx + ix, c24 = cams24At(lat, lon);
          if (c24 == null) { B[q] = 0; SD[q] = null; continue; }
          const x = [Math.log(c24 + 1)]; if (dem) x.push((sampleGrid(dem, lat, lon) ?? 0) / 1000);
          if (met) { const m = sampleMet(met, lat, lon, rk.t); x.push(Math.log(Math.max(m.blh, 50) / 1000), m.ws); }
          const reg = out.beta[0] + x.reduce((a, v, j) => a + out.beta[j + 1] * v, 0);
          B[q] = Math.round((reg - x[0] + R.values[q]) * 1000) / 1000;
          let rv = s2n; if (covSlope) for (let a = 0; a < x.length; a++) for (let b2 = 0; b2 < x.length; b2++) rv += (x[a] - xbar[a]) * covSlope[a][b2] * (x[b2] - xbar[b2]);
          SD[q] = Math.round(Math.sqrt((R.sd[q] ?? 0) ** 2 + Math.max(0, rv)) * 100) / 100;
        }
        rk.basis = '24h'; rk.bias = { lon0: R.lon0, lat0: R.lat0, step: R.step, nx: R.nx, ny: R.ny, values: B, sd: SD }; delete rk.resid; }
      log(`RK: ${rk.n} monitors, beta=[${rk.beta.join(', ')}], range ${rk.vario.a_km} km, LOO RMSE CAMS ${rk.cv.cams.rmse} → RK ${rk.cv.rk.rmse} µg/m³, ±1σ coverage ${rk.cv.cover1s}`);
    }
  } else log(`RK skipped: only ${rkObs.length} monitors with fresh data`);
  const gridRaw = hours.map((t, j) => gridPts.map((_, p) => { const v = C.grid[p][i0 + j]; return v == null ? -1 : r1(v); }));

  // 6. hotspots
  let hot = await firmsHotspots(); let hotReused = false;
  if (!hot.length) {   // FIRMS unreachable or empty: keep the last good set (≤ 12 h old) rather than blanking the map
    const prev = await readJSON(path.join(DATA, 'latest.json'), null);
    const rows = prev?.hotspots?.rows || [], age = now - (prev?.hotspots?.fetched || prev?.generated || 0);
    if (rows.length && age < 12 * HOUR) { hot = rows; hotReused = true; log(`FIRMS returned nothing; reusing ${rows.length} hotspots from ${Math.round(age / 6e4)} min ago`); }
  }
  // 6b. MODIS IGBP land cover at each detection (per-fire fuel type, as in FINN); map cached, refreshed for a new year
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

  // 7. outputs
  await writeJSON(path.join(DATA, 'latest.json'), {
    generated: now, camsIssued: C.at, bbox: CFG.bbox, runlog: RUNLOG,
    method: { kf: CFG.kf, biasLeadEfoldH: CFG.biasLeadEfoldH, rk: CFG.rk },
    rk, dem: dem ? { file: 'data/static/elev.json', step: dem.step, source: dem.source } : null,
    met: met ? { file: 'data/met-web.json', model: met.model, fetched: met.fetched, grids: met.grids.map(g => ({ step: g.step, bbox: [g.lon0, g.lat0, g.lon0 + (g.nx - 1) * g.step, g.lat0 + (g.ny - 1) * g.step] })) } : null,
    hours, stations: outStations,
    grid: { lon0: g[0], lat0: g[1], step, nx, ny, values: gridRaw },  // raw CAMS; the page applies rk
    hotspots: { cols: ['lat', 'lon', 'frp', 't', 'conf', 'sat', 'igbp'], igbpYear: LC?.year ?? null, rows: hot, fetched: hotFetched ?? (await readJSON(path.join(DATA, 'latest.json'), null))?.hotspots?.fetched ?? null },
  });
  // history: one small new file per run (never rewritten), so git stores each row once
  const iso = new Date(now).toISOString(), ym = iso.slice(0, 7), stamp = iso.slice(0, 13).replace(/[-:]/g, '');
  const hdir = path.join(DATA, 'history', ym);
  await appendCSV(path.join(hdir, `obs-${stamp}.csv`), 'time_utc,station_id,obs_pm25,cams_raw', obsRows);
  const fRows = [];
  const m24 = (arr, j) => { let su = 0, n = 0; for (let q = j - 23; q <= j; q++) { const v = q >= 0 ? arr[q] : null; if (v != null) { su += v; n++; } } return n >= 18 ? r1(su / n) : ''; };
  for (const s of outStations) if (s.monitor) for (const L of CFG.logLeads) { const j = jNow + L; if (j < hours.length && s.raw[j] != null)
    fRows.push([new Date(now).toISOString().slice(0, 13) + ':00Z', new Date(hours[j]).toISOString().slice(0, 13) + ':00Z', s.id, L, s.raw[j], s.corr[j],
      s.avg24 ? m24(s.raw, j) : '', s.avg24 ? m24(s.corr, j) : '', s.avg24 && s.fc24?.[j] != null ? s.fc24[j] : '']); }
  const fcstFile = path.join(hdir, `fcst-${stamp}.csv`);   // one file per issue hour: a second run in the same hour must not double-count it
  if (await fs.access(fcstFile).then(() => false, () => true)) await appendCSV(fcstFile, 'issued_utc,valid_utc,station_id,lead_h,cams_raw,corrected,cams24,corr24,blend24', fRows);
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

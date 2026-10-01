// Hourly update for Hotspot Smoke Watch.
// Runs in GitHub Actions (Node 20+, no dependencies). Reads keys from env:
//   OPENAQ_API_KEY, FIRMS_MAP_KEY
// Writes:
//   data/latest.json   – what the web page reads
//   data/state.json    – Kalman filter state, station list, cached CAMS forecast
//   data/history/obs-YYYY-MM.csv, data/history/fcst-YYYY-MM.csv – for verification
import fs from 'node:fs/promises';
import path from 'node:path';

// ------------------------------------------------------------------ config
const CFG = {
  // area for stations, hotspots and the corrected PM2.5 grid [W,S,E,N]
  bbox: [92.0, 9.0, 110.0, 24.5],
  gridBbox: [96.0, 13.0, 106.0, 22.5],
  gridStep: 0.5,                 // deg; keeps Open-Meteo calls inside the free tier
  camsRefreshH: 6,               // CAMS runs twice a day, no need to re-pull hourly
  stationRefreshH: 24,
  maxStations: 300,
  obsMaxAgeH: 3,                 // ignore station values older than this
  firmsSources: ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'],
  firmsDays: 2,
  // Kalman filter on log-ratio bias b = ln(obs+1) - ln(raw+1)
  kf: { Q: 0.02, R: 0.15, P0: 0.5, maxGapH: 48 },
  biasLeadEfoldH: 48,            // bias correction fades with lead time
  idw: { power: 2, radiusKm: 150 },
  logLeads: [1, 3, 6, 12, 24, 48],
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
async function get(url, opt = {}, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(60e3) });
      if (r.status === 429) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      return r;
    } catch (e) { if (i === tries - 1) throw e; await sleep(2000 * (i + 1)); }
  }
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
  const rows = [];
  for (const src of CFG.firmsSources) {
    try {
      const txt = await (await get(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/${CFG.bbox.join(',')}/${CFG.firmsDays}`)).text();
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
      log(`FIRMS ${src}: ${lines.length - 1}`);
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

// ------------------------------------------------------------------ main
async function main() {
  if (!process.env.OPENAQ_API_KEY) throw new Error('OPENAQ_API_KEY is not set');
  const state = await readJSON(path.join(DATA, 'state.json'), {});
  state.kf ||= {};

  // 1. station list (daily)
  if (!state.stations || state.stationsCap !== CFG.maxStations || now - (state.stationsAt || 0) > CFG.stationRefreshH * HOUR) {
    const all = await oaqStations();
    const fresh = all.filter(s => now - s.last < 7 * 24 * HOUR);
    fresh.sort((a, b) => (b.monitor - a.monitor) || (b.last - a.last));
    state.stations = fresh.slice(0, CFG.maxStations);
    state.stationsAt = now; state.stationsCap = CFG.maxStations;
    log(`stations: ${all.length} with pm25 in area, ${fresh.length} active, keeping ${state.stations.length}`);
  }
  const stations = state.stations;

  // 2. CAMS forecast at stations + grid (every few hours)
  const g = CFG.gridBbox, step = CFG.gridStep;
  const nx = Math.round((g[2] - g[0]) / step) + 1, ny = Math.round((g[3] - g[1]) / step) + 1;
  const gridPts = []; for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) gridPts.push([g[1] + iy * step, g[0] + ix * step]);
  const stIds = stations.map(s => s.id).join(',');
  if (!state.cams || now - state.cams.at > CFG.camsRefreshH * HOUR || state.cams.stIds !== stIds) {
    const pts = stations.map(s => [s.lat, s.lon]).concat(gridPts);
    try {
      const { times, series } = await camsSeries(pts);
      state.cams = { at: now, times, stIds, st: series.slice(0, stations.length), grid: series.slice(stations.length) };
      log(`CAMS refreshed: ${pts.length} points × ${times.length} h`);
    } catch (e) {
      log(`CAMS refresh failed: ${e.message}`);
      if (!state.cams || state.cams.stIds !== stIds) throw e;   // cannot continue without a forecast for these stations
      log('using the previous CAMS forecast');
    }
  }
  const C = state.cams;

  // 3. observations + Kalman update
  const obs = await oaqLatest(stations);
  const obsRows = [];
  stations.forEach((s, i) => {
    const o = obs.get(s.id); if (!o || now - o.t > CFG.obsMaxAgeH * HOUR || o.v < 0 || o.v > 1500) return;
    s.obs = o;
    const k = state.kf[s.id];
    if (k && o.t <= k.t) return;            // already used this hour
    const raw = interpT(C.times, C.st[i], o.t); if (raw == null) return;
    const y = Math.log(o.v + 1) - Math.log(raw + 1);
    state.kf[s.id] = kfStep(k, y, o.t);
    obsRows.push([new Date(o.t).toISOString(), s.id, r1(o.v), r1(raw)]);
  });
  log(`Kalman updated at ${obsRows.length} stations`);

  // 4. corrected forecasts at stations
  const t0 = Math.floor(now / HOUR) * HOUR;
  const i0 = Math.max(0, C.times.findIndex(t => t >= t0));
  const hours = C.times.slice(i0);
  const outStations = stations.map((s, i) => {
    const k = state.kf[s.id]; const b = k && now - k.t < CFG.kf.maxGapH * HOUR ? k.b : 0;
    const raw = C.st[i].slice(i0);
    const corr = raw.map((v, j) => v == null ? null : r1(correct(v, b, (hours[j] - (k?.t || now)) / HOUR)));
    return { id: s.id, name: s.name, lat: s.lat, lon: s.lon, monitor: s.monitor, provider: s.provider, cc: s.country,
      obs: s.obs ? { t: s.obs.t, v: r1(s.obs.v) } : null, bias: k ? +b.toFixed(3) : null, nUpd: k?.n || 0, raw, corr };
  });

  // 5. corrected grid: inverse-distance weighting of station log-bias, fading to 0 beyond radius
  const active = outStations.filter(s => s.bias != null && s.monitor);
  const biasPts = active.length ? active : outStations.filter(s => s.bias != null);
  const gridBias = gridPts.map(([la, lo]) => {
    let wsum = 0, bsum = 0;
    for (const s of biasPts) { const d = km(la, lo, s.lat, s.lon); if (d > CFG.idw.radiusKm) continue;
      const w = 1 / Math.max(d, 5) ** CFG.idw.power; wsum += w; bsum += w * s.bias; }
    if (!wsum) return 0;
    const nearest = Math.min(...biasPts.map(s => km(la, lo, s.lat, s.lon)));
    return (bsum / wsum) * Math.max(0, 1 - nearest / CFG.idw.radiusKm);
  });
  const gridCorr = hours.map((t, j) => gridPts.map((_, p) => { const v = C.grid[p][i0 + j]; return v == null ? -1 : Math.round(correct(v, gridBias[p], (t - now) / HOUR)); }));

  // 6. hotspots
  const hot = await firmsHotspots();

  // 7. outputs
  await writeJSON(path.join(DATA, 'latest.json'), {
    generated: now, camsIssued: C.at, bbox: CFG.bbox, runlog: RUNLOG,
    method: { kf: CFG.kf, biasLeadEfoldH: CFG.biasLeadEfoldH, idw: CFG.idw },
    hours, stations: outStations,
    grid: { lon0: g[0], lat0: g[1], step, nx, ny, values: gridCorr },
    hotspots: { cols: ['lat', 'lon', 'frp', 't', 'conf', 'sat'], rows: hot },
  });
  const ym = new Date(now).toISOString().slice(0, 7);
  await appendCSV(path.join(DATA, 'history', `obs-${ym}.csv`), 'time_utc,station_id,obs_pm25,cams_raw', obsRows);
  const fRows = [];
  for (const s of outStations) for (const L of CFG.logLeads) { const j = L; if (j < hours.length && s.raw[j] != null)
    fRows.push([new Date(now).toISOString().slice(0, 13) + ':00Z', new Date(hours[j]).toISOString().slice(0, 13) + ':00Z', s.id, L, s.raw[j], s.corr[j]]); }
  await appendCSV(path.join(DATA, 'history', `fcst-${ym}.csv`), 'issued_utc,valid_utc,station_id,lead_h,cams_raw,corrected', fRows);
  await writeJSON(path.join(DATA, 'state.json'), state);
  log(`done: ${outStations.length} stations, ${hot.length} hotspots, grid ${nx}×${ny}×${hours.length}`);
}

main().catch(async e => {
  log(`FAILED: ${e.stack || e.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await writeJSON(path.join(DATA, 'runlog.json'), { at: now, ok: !process.exitCode, log: RUNLOG });
});

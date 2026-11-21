// Multi-year PM2.5 background of every reference monitor ("climatology"): what each station usually measures in each month
// and hour of the day, from the last 3 years of hourly measurements. It gives the self-learning correction v2 (scripts/ml2.mjs)
// knowledge of seasons it has not seen in its own short logs (above all the burning season), instead of starting from nothing.
// Sources:
//   OpenAQ archive (public s3://openaq-data-archive, records/csv.gz/locationid=<id>/year=<y>/month=<m>/*.csv.gz): the reference
//     monitors on OpenAQ, and OpenAQ's copies of the Air4Thai stations (the OpenAQ location within 1 km of each Air4Thai
//     station, found with the OpenAQ v3 locations API, key OPENAQ_API_KEY). Those copies hold the 24-h running mean, not the
//     hourly value, so they give the level of each month well but flatten the hour of day: such stations are marked basis '24h'.
//   Air4Thai history service (PCD): it keeps only the last 2–3 months (checked 21 Nov 2026: nothing before 1 Sep 2026), so it is
//     used only for Air4Thai stations without an OpenAQ copy (basis 'h', a few months).
// Station list: the hourly run's (data/state.json, restored from the Actions cache by the workflow).
// Output: data/static/pm-clim.json (committed by .github/workflows/climatology.yml; built once, as prior knowledge):
//   { version, built, from, to, minN, cell: 'month×hour (Thai time, hour-ending stamp)', stations: { id: { n, mean: [288], p90: [288] } } }
//   mean/p90 are µg/m³ × 10 as integers, index (month−1)·24 + hour, −1 where fewer than minN values.
// Run: node scripts/climatology.mjs   (NODE_EXTRA_CA_CERTS=scripts/certs/air4thai-chain.pem for Air4Thai)
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), DATA = path.join(ROOT, 'data');
export const CLIM = { years: 3, minN: 10, a4tHist: 'https://air4thai.pcd.go.th/webV2/history/api/data.php', a4tChunk: 40,
  oaqArchive: 'https://openaq-data-archive.s3.amazonaws.com', oaqApi: 'https://api.openaq.org/v3', copyKm: 1.0, conc: 24 };
const H = 3600e3, TH = 7 * H;
export const cellOf = t => { const d = new Date(t + TH); return d.getUTCMonth() * 24 + d.getUTCHours(); };   // Thai month × hour of the stamp
export const thaiTime = s => Date.parse(s.replace(' ', 'T') + '+07:00');

/** Values of one station -> { n, mean, p90 } over the 288 month × hour cells (× 10 integers, −1 below minN). */
export function cellStats(series, minN = CLIM.minN) {
  const cells = Array.from({ length: 288 }, () => []); let n = 0;
  for (const [t, v] of series) if (isFinite(t) && v >= 0 && v < 1500) { cells[cellOf(t)].push(v); n++; }
  const mean = [], p90 = [];
  for (const c of cells) { if (c.length < minN) { mean.push(-1); p90.push(-1); continue; }
    c.sort((a, b) => a - b); mean.push(Math.round(c.reduce((a, b) => a + b, 0) / c.length * 10)); p90.push(Math.round(c[Math.min(c.length - 1, Math.floor(0.9 * (c.length - 1) + 0.5))] * 10)); }
  return { n, mean, p90 };
}
/** One OpenAQ archive day file (csv text) -> [[t, pm25], …]; other parameters and broken rows left out. */
// one CSV line, quotes respected (station names can hold commas)
export function csvSplit(l) { const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c; }
  out.push(cur.replace(/\r$/, '')); return out; }
export function parseOaq(txt) {
  const out = [], L = txt.trim().split('\n'); if (L.length < 2) return out;
  const h = csvSplit(L[0]), iT = h.indexOf('datetime'), iP = h.indexOf('parameter'), iV = h.indexOf('value');
  for (const l of L.slice(1)) { const v = csvSplit(l); if (v[iP] !== 'pm25') continue;
    const t = Date.parse(v[iT]), x = +v[iV]; if (isFinite(t) && isFinite(x)) out.push([t, x]); }
  return out;
}
const km = (a, b, c, d) => { const p = Math.PI / 180, dl = (c - a) * p, dn = (d - b) * p; const h = Math.sin(dl / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dn / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
/** OpenAQ copy of each station: the nearest location within maxKm (one location serves one station). Map station id -> location id. */
export function matchCopies(stations, locations, maxKm = CLIM.copyKm) {
  const pairs = [];
  for (const s of stations) for (const L of locations) { const d = km(s.lat, s.lon, L.lat, L.lon); if (d <= maxKm) pairs.push([d, s.id, L.id]); }
  pairs.sort((a, b) => a[0] - b[0]); const out = new Map(), used = new Set();
  for (const [, sid, lid] of pairs) if (!out.has(sid) && !used.has(lid)) { out.set(sid, lid); used.add(lid); }
  return out;
}
async function oaqLocations(bbox, log) {
  const key = (process.env.OPENAQ_API_KEY || '').trim(); if (!key) { log('OPENAQ_API_KEY not set: no OpenAQ copies of the Air4Thai stations'); return []; }
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const js = await (await get(`${CLIM.oaqApi}/locations?bbox=${bbox.join(',')}&parameters_id=2&limit=1000&page=${page}`, 3, { 'X-API-Key': key, Accept: 'application/json' })).json();
    for (const L of js.results || []) if (L.coordinates) out.push({ id: L.id, lat: L.coordinates.latitude, lon: L.coordinates.longitude, provider: L.provider?.name || '' });
    if ((js.results || []).length < 1000) break; await new Promise(s => setTimeout(s, 1100)); }
  return out;
}
const months = (from, to) => { const out = []; const d = new Date(from); d.setUTCDate(1); while (d.getTime() < to) { out.push([d.getUTCFullYear(), d.getUTCMonth() + 1]); d.setUTCMonth(d.getUTCMonth() + 1); } return out; };
async function get(url, tries = 3, headers = {}) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { signal: AbortSignal.timeout(60e3), headers: { 'User-Agent': 'sea-haf-climatology', ...headers } });
  if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; } catch (e) { if (i === tries - 1) throw e; await new Promise(s => setTimeout(s, 3000 * (i + 1))); } } }
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

async function air4thai(codes, from, to, log) {
  const out = new Map(codes.map(c => [c, []])); let req = 0, fail = 0;
  for (const [y, m] of months(from, to)) {
    const d0 = `${y}-${String(m).padStart(2, '0')}-01`, last = new Date(Date.UTC(y, m, 0)).getUTCDate(), d1 = `${y}-${String(m).padStart(2, '0')}-${last}`;
    for (let i = 0; i < codes.length; i += CLIM.a4tChunk) { req++;
      try { const js = await (await get(`${CLIM.a4tHist}?stationID=${codes.slice(i, i + CLIM.a4tChunk).join(',')}&param=PM25&type=hr&sdate=${d0}&edate=${d1}&stime=00&etime=23`)).json();
        for (const st of js.stations || []) { const a = out.get(st.stationID); if (!a) continue;
          for (const d of st.data || []) { const v = d.PM25 == null || d.PM25 === '' ? NaN : +d.PM25, t = thaiTime(d.DATETIMEDATA || ''); if (isFinite(v) && isFinite(t)) a.push([t, v]); } } }
      catch (e) { fail++; if (fail <= 3) log(`Air4Thai ${d0}: ${e.message}`); }
      await new Promise(s => setTimeout(s, 400)); } }
  log(`Air4Thai history: ${codes.length} stations, ${req} requests (${fail} failed), ${[...out.values()].reduce((a, v) => a + v.length, 0)} hourly values`);
  return out;
}
async function openaq(ids, from, to, log) {
  const out = new Map(ids.map(id => [id, []])); const keys = [];
  for (const id of ids) for (const [y, m] of months(from, to)) keys.push([id, y, m]);
  let files = 0, fail = 0; const todo = [];
  await pool(keys, CLIM.conc, async ([id, y, m]) => {   // the day files of each month
    try { const pre = `records/csv.gz/locationid=${id}/year=${y}/month=${String(m).padStart(2, '0')}/`;
      const r = await get(`${CLIM.oaqArchive}/?list-type=2&prefix=${pre}`); if (!r) return;
      for (const x of (await r.text()).matchAll(/<Key>([^<]+\.csv\.gz)<\/Key>/g)) todo.push([id, x[1]]); }
    catch (e) { fail++; if (fail <= 3) log(`OpenAQ ${id} ${y}-${m}: ${e.message}`); } });
  await pool(todo, CLIM.conc, async ([id, k]) => {
    try { const f = await get(`${CLIM.oaqArchive}/${k}`); if (!f) return; files++;
      out.get(id).push(...parseOaq(zlib.gunzipSync(Buffer.from(await f.arrayBuffer())).toString('utf8'))); }
    catch (e) { fail++; if (fail <= 6) log(`OpenAQ ${k}: ${e.message}`); } });
  log(`OpenAQ archive: ${ids.length} locations, ${files} of ${todo.length} day files (${fail} failed), ${[...out.values()].reduce((a, v) => a + v.length, 0)} hourly values`);
  return out;
}

async function main() {
  const log = m => console.log('climatology: ' + m), t0 = Date.now();
  const state = JSON.parse(await fs.readFile(path.join(DATA, 'state.json'), 'utf8').catch(() => '{}'));
  const st = (state.stations || []).filter(s => s.monitor && !s.feed24);   // Bangkok BMA feed stations are not in the history service
  if (!st.length) throw new Error('no station list (data/state.json from the hourly run)');
  const now = Date.now(), to = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1), from = Date.UTC(new Date(to).getUTCFullYear() - CLIM.years, new Date(to).getUTCMonth(), 1);
  const a4 = st.filter(s => String(s.id).startsWith('a4t:')), oq = st.filter(s => !String(s.id).startsWith('a4t:') && Number.isFinite(+s.id));
  const copies = matchCopies(a4, await oaqLocations([92.0, 5.5, 110.0, 24.5], log).catch(e => { log(`OpenAQ locations: ${e.message}`); return []; }));
  log(`OpenAQ copies of Air4Thai stations: ${copies.size} of ${a4.length} within ${CLIM.copyKm} km`);
  const noCopy = a4.filter(s => !copies.has(s.id));
  const O = await openaq([...new Set([...oq.map(s => +s.id), ...copies.values()])], from, to, log);
  const A = noCopy.length ? await air4thai(noCopy.map(s => s.code || String(s.id).slice(4)), from, to, log) : new Map();
  const stations = {};
  for (const s of a4) {
    if (copies.has(s.id)) { const r = cellStats(O.get(copies.get(s.id)) || []); if (r.n) { stations[s.id] = { ...r, basis: '24h', src: `openaq:${copies.get(s.id)}` }; continue; } }
    const r = cellStats(A.get(s.code || String(s.id).slice(4)) || []); if (r.n) stations[s.id] = { ...r, basis: 'h', src: 'air4thai' }; }
  for (const s of oq) { const r = cellStats(O.get(+s.id) || []); if (r.n) stations[s.id] = { ...r, basis: 'h', src: `openaq:${s.id}` }; }
  const doc = { version: 1, built: now, from, to, minN: CLIM.minN, cell: 'month×hour (Thai time, hour-ending stamp), µg/m³ × 10, −1 below minN',
    basis: "per station: 'h' hourly values, '24h' OpenAQ copy of an Air4Thai station holding 24-h running means (month level right, hour of day flattened)", stations };
  await fs.mkdir(path.join(DATA, 'static'), { recursive: true }); await fs.writeFile(path.join(DATA, 'static', 'pm-clim.json'), JSON.stringify(doc));
  const ok = Object.values(stations).filter(r => r.mean.filter(v => v >= 0).length >= 200).length;
  log(`${Object.keys(stations).length} stations (${ok} with >= 200 of 288 cells filled; ${Object.values(stations).filter(r => r.basis === '24h').length} from OpenAQ copies of Air4Thai), ${new Date(from).toISOString().slice(0, 7)} – ${new Date(to - 1).toISOString().slice(0, 7)}, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('climatology failed:', e.message); process.exitCode = 1; });

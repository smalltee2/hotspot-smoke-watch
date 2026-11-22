// IQAir real-time AQI at Thai cities, to compare with our map "now" (page layer "Compared with IQAir, now").
// IQAir AirVisual API, Community (free) plan: city-level real-time US AQI only (no forecast, no concentrations); 5 calls a minute,
// 10,000 a month. Each hourly run asks for IQAIR.perRun cities (oldest first), so every city is refreshed every few hours and a month
// uses about perRun × 24 × 31 calls. Endpoint: /v2/nearest_city?lat&lon (IQAir's city nearest to our point).
// The key is read from IQAIR_API_KEY (GitHub Secrets) and never logged: error messages carry the API status only, never the URL.
// State: state.iqair = { [cityId]: { t, aqius, name, lat, lon, asked } }. CAMS run only (update.mjs skips it for SILAM).
// Data: IQAir (https://www.iqair.com), shown with its credit.
export const IQAIR = { perRun: 5, maxAgeH: 6, timeoutMs: 20e3,
  cities: [   // towns with Air4Thai reference monitors, north first (the haze season)
    ['cnx', 'Chiang Mai', 18.788, 98.986], ['cei', 'Chiang Rai', 19.910, 99.840], ['lpg', 'Lampang', 18.290, 99.490], ['mhs', 'Mae Hong Son', 19.300, 97.970],
    ['nan', 'Nan', 18.780, 100.780], ['pyo', 'Phayao', 19.170, 99.900], ['pre', 'Phrae', 18.145, 100.140], ['mst', 'Mae Sot', 16.713, 98.575],
    ['phs', 'Phitsanulok', 16.820, 100.265], ['nsn', 'Nakhon Sawan', 15.700, 100.140], ['kkc', 'Khon Kaen', 16.430, 102.835], ['udn', 'Udon Thani', 17.415, 102.790],
    ['nma', 'Nakhon Ratchasima', 14.975, 102.100], ['ubp', 'Ubon Ratchathani', 15.245, 104.850], ['bkk', 'Bangkok', 13.755, 100.500], ['srt', 'Surat Thani', 9.140, 99.330],
    ['hdy', 'Hat Yai', 7.008, 100.475]] };
const H = 3600e3;

/** one nearest_city reply -> { name, lat, lon, t, aqius } or null (status fail, missing pollution) */
export function parseNearest(j) {
  if (!j || j.status !== 'success' || !j.data?.current?.pollution) return null;
  const d = j.data, p = d.current.pollution, t = Date.parse(p.ts), a = +p.aqius, c = d.location?.coordinates;
  if (!Number.isFinite(t) || !Number.isFinite(a)) return null;
  return { name: [d.city, d.state].filter(Boolean).join(', '), lat: c ? +c[1] : null, lon: c ? +c[0] : null, t, aqius: a };
}
/** the cities to ask this run: never asked first, then the longest ago */
export function pickCities(store, n = IQAIR.perRun, cities = IQAIR.cities) {
  return [...cities].sort((a, b) => (store?.[a[0]]?.asked ?? 0) - (store?.[b[0]]?.asked ?? 0)).slice(0, n);
}
/** asks IQAir for this run's cities and keeps the replies in state.iqair; never throws */
export async function updateIqair(state, now, key, log = () => {}, fetchFn = fetch) {
  if (!key) return 0;
  const store = (state.iqair ||= {}); let ok = 0; const errs = [];
  for (const [id, label, lat, lon] of pickCities(store)) {
    store[id] = { ...(store[id] || {}), asked: now };
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), IQAIR.timeoutMs);
      const r = await fetchFn(`https://api.airvisual.com/v2/nearest_city?lat=${lat}&lon=${lon}&key=${encodeURIComponent(key)}`, { signal: ctl.signal }).finally(() => clearTimeout(tm));
      const j = await r.json().catch(() => null), v = parseNearest(j);
      if (!v) { errs.push(`${label}: ${j?.data?.message || 'HTTP ' + r.status}`); if (/limit|too_many/i.test(j?.data?.message || '')) break; continue; }
      store[id] = { ...v, label, asked: now }; ok++;
    } catch (e) { errs.push(`${label}: ${e.name === 'AbortError' ? 'timeout' : 'request failed'}`); }
  }
  log(`IQAir: ${ok} of ${IQAIR.perRun} cities read${errs.length ? ' (' + errs.join('; ') + ')' : ''}`);
  return ok;
}
/** the page's list: cities with a reading no older than maxAgeH */
export function forPage(state, now) {
  return Object.entries(state.iqair || {}).filter(([, v]) => v.t && now - v.t <= IQAIR.maxAgeH * H && Number.isFinite(v.lat))
    .map(([id, v]) => ({ id, name: v.label || v.name, iqName: v.name, lat: v.lat, lon: v.lon, t: v.t, aqius: v.aqius }));
}

// Who the station ids of the logs are: data/history/stations.json (history branch; no date in the name, so the 35-day pruning
// keeps it). The per-run logs (obs-, fcst-, map-, a4t-*.csv) hold ids only, so a check that reads them could not say where a
// station is (owner, 27 Nov 2026: "a4t:19t is in which province?"). Each run merges the stations it has into the file: name,
// Thai name, area (Air4Thai: tambon, amphoe, province as the feed gives them; OpenAQ: locality), position, country, provider,
// reference monitor or not, and the last Thai date it was in the list. A station that leaves the list keeps its entry.
// The date changes once a day, so the file is rewritten (and committed) once a day, not every hour.
const r4 = v => Math.round(v * 1e4) / 1e4;
export function mergeStations(old, stations, day) {
  const out = { ...(old?.stations || {}) };
  for (const s of stations) { if (s?.id == null || !isFinite(s.lat) || !isFinite(s.lon)) continue;
    out[String(s.id)] = { name: s.name || '', ...(s.nameTH ? { nameTH: s.nameTH } : {}), ...(s.area ? { area: s.area } : {}), ...(s.areaTH ? { areaTH: s.areaTH } : {}),
      lat: r4(s.lat), lon: r4(s.lon), cc: s.country || '', provider: s.provider || '', monitor: !!s.monitor, seen: day }; }
  return { note: 'Station ids used in the logs of this branch. seen = last Thai date the station was in the list.', stations: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) };
}

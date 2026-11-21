"""CAMS global PM2.5 forecasts paired with measured PM2.5 at every station, leads 0-72 h every 3 h (for pre-training the
SEA-HAF machine-learning correction).

    python3 exports/make_cams_station_3h.py            # all three seasons
    python3 exports/make_cams_station_3h.py --season=2026

Reads the archive only (data/<Y>/proc/cams_f32.bin + cams_meta.json, data/<Y>/openaq/, replay/results_bench/site_qc.csv) and
writes exports/cams_station_3h/:
    cams_obs_3h_<Y>.csv.gz   issue_utc, valid_utc, lead_h, station_id, cams_pm25, obs_pm25   (rows with an observation only)
    stations.csv             one row per season and station (coordinates, provider, sensor type, observation basis, site QC)
"""
import sys, json, gzip, logging, pathlib
import numpy as np, pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
CFG = dict(
    seasons=(2024, 2025, 2026),
    leads_h=tuple(range(0, 73, 3)),          # 0, 3, ..., 72
    out=ROOT / 'exports' / 'cams_station_3h',
    site_qc=ROOT / 'replay' / 'results_bench' / 'site_qc.csv',
    avg24_providers=('Air4Thai',),           # OpenAQ copies of Air4Thai are 24-h running means (paper Text S1)
)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('export')
args = sys.argv[1:]
only = next((int(a.split('=')[1]) for a in args if a.startswith('--season=')), None)
SEASONS = (only,) if only else CFG['seasons']


def load_stations(Y):
    """Reference list + low-cost list; one PM2.5 sensor per location (the one with most hours, as replay/archive.mjs does)."""
    d = ROOT / 'data' / str(Y) / 'openaq'
    ref = json.load(open(d / 'stations.json'))
    lc = json.load(open(d / 'stations_msea.json'))
    best = {}
    for s in ref + lc:
        f = d / f'sensor_{s["sensor"]}.csv'
        if not f.exists():
            continue
        o = pd.read_csv(f)
        o = o[o.time_end_utc.str[14:16] == '00']            # full-hour values only (0.4 % of rows end at :30 and are dropped)
        if o.empty:
            continue
        if s['id'] not in best or len(o) > len(best[s['id']][1]):
            best[s['id']] = (s, o)
    log.info(f'{Y}: {len(ref) + len(lc)} sensor entries -> {len(best)} locations with data')
    return best


def bilinear(meta, lat, lon):
    la, lo = np.array(meta['lat']), np.array(meta['lon'])
    dlat, dlon = la[0] - la[1], lo[1] - lo[0]
    fi, fj = (la[0] - lat) / dlat, (lon - lo[0]) / dlon
    ok = (fi >= 0) & (fi <= len(la) - 1) & (fj >= 0) & (fj <= len(lo) - 1)
    i = np.clip(np.floor(fi).astype(int), 0, len(la) - 2); j = np.clip(np.floor(fj).astype(int), 0, len(lo) - 2)
    a, b = fi - i, fj - j
    return ok, i, j, a, b


def season(Y, qc):
    meta = json.load(open(ROOT / 'data' / str(Y) / 'proc' / 'cams_meta.json'))
    A = np.fromfile(ROOT / 'data' / str(Y) / 'proc' / 'cams_f32.bin', np.float32)
    if A.size != np.prod(meta['shape']):
        raise SystemExit(f'{Y}: cams_f32.bin size {A.size} does not match shape {meta["shape"]}')
    A = A.reshape(meta['shape'])
    leads_all = [float(x) for x in meta['leads_h']]
    li = [leads_all.index(float(L)) for L in CFG['leads_h']]
    runs = np.array(meta['runs_ms'], dtype=np.int64)

    best = load_stations(Y)
    ids = np.array(list(best)); S = [best[k][0] for k in ids]
    lat = np.array([s['lat'] for s in S]); lon = np.array([s['lon'] for s in S])
    ok, i, j, a, b = bilinear(meta, lat, lon)
    if (~ok).any():
        log.info(f'{Y}: {(~ok).sum()} locations outside the CAMS grid left out')
    ids, S, i, j, a, b = ids[ok], [s for s, k in zip(S, ok) if k], i[ok], j[ok], a[ok], b[ok]

    # observations as one series per station: valid time (ms) -> value
    obs = {k: dict(zip(pd.to_datetime(best[k][1].time_end_utc).astype('int64') // 10**6, best[k][1].pm25)) for k in ids}

    parts = []
    for L, l in zip(CFG['leads_h'], li):
        F = A[:, l]                                               # (run, lat, lon)
        c = ((1 - a) * (1 - b) * F[:, i, j] + (1 - a) * b * F[:, i, j + 1] + a * (1 - b) * F[:, i + 1, j] + a * b * F[:, i + 1, j + 1])
        tv = runs + int(L) * 3_600_000
        o = np.array([[obs[k].get(t, np.nan) for k in ids] for t in tv], dtype=float)   # (run, station)
        r, s = np.nonzero(np.isfinite(o))
        parts.append(pd.DataFrame(dict(issue_ms=runs[r], lead_h=int(L), station_id=ids[s], cams_pm25=np.round(c[r, s], 1), obs_pm25=o[r, s])))
    D = pd.concat(parts, ignore_index=True).sort_values(['issue_ms', 'lead_h', 'station_id'])
    D.insert(0, 'issue_utc', pd.to_datetime(D.issue_ms, unit='ms').dt.strftime('%Y-%m-%dT%H:%MZ'))
    D.insert(1, 'valid_utc', pd.to_datetime(D.issue_ms + D.lead_h * 3_600_000, unit='ms').dt.strftime('%Y-%m-%dT%H:%MZ'))
    D = D.drop(columns='issue_ms')
    if D.duplicated(['issue_utc', 'lead_h', 'station_id']).any():
        raise SystemExit(f'{Y}: duplicate (issue, lead, station) rows')
    f = CFG['out'] / f'cams_obs_3h_{Y}.csv.gz'
    with gzip.open(f, 'wt', compresslevel=6) as g:
        D.to_csv(g, index=False)
    log.info(f'{Y}: {len(D):,} rows, {D.station_id.nunique()} stations, {len(runs)} runs -> {f.name} ({f.stat().st_size / 1e6:.1f} MB)')

    q = qc[qc.season == Y].set_index('station_id').qc
    used = set(D.station_id.unique())
    return pd.DataFrame([dict(season=Y, station_id=k, sensor_id=s['sensor'], name=s.get('name', ''), provider=s.get('provider', ''),
                              cc=s.get('cc', ''), lat=s['lat'], lon=s['lon'],
                              type='reference' if s.get('monitor', True) is not False else 'low-cost',
                              obs_basis='24h_running_mean' if s.get('provider') in CFG['avg24_providers'] else 'hourly',
                              site_qc=q.get(k, 'not checked'))
                         for k, s in zip(ids, S) if k in used])


def main():
    CFG['out'].mkdir(parents=True, exist_ok=True)
    qc = pd.read_csv(CFG['site_qc'])
    st = pd.concat([season(Y, qc) for Y in SEASONS], ignore_index=True)
    f = CFG['out'] / ('stations.csv' if not only else f'stations_{only}.csv')
    st.to_csv(f, index=False)
    log.info(f'station table: {len(st)} season-stations -> {f.name}')


main()

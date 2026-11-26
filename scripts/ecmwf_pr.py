#!/usr/bin/env python3
"""ECMWF IFS rain at 0.25° over the whole map box, from ECMWF Open Data (CC BY 4.0), for the page's rain forecast.

Open-Meteo gives the pipeline ECMWF at 0.25° over northern Thailand and 1° elsewhere (its free daily limit); outside the north
the page's rain forecast was therefore drawn from a 1° field, so it looked coarse next to the radar. ECMWF publishes the same
model as open data at 0.25° (GRIB2, the 00 and 12 UTC runs every 3 h to 144 h, then every 6 h): this step reads only the total
precipitation of each step (byte ranges from the .index files) from the public mirrors, crops the box and writes rain rates.
The page then downscales it to 0.025° with the CHELSA rain pattern, as before (rainAt / drawGrid in index.html).

For the newest complete 00/12 UTC run not extracted yet, it writes data/history/<YYYY-MM>/ecpr-<YYYYMMDDHH>.json:
  { run, source, lon0, lat0, step, nx, ny, scale: 10, enc: 'deflate-int16', t0: [ms], t1: [ms], d: [b64, ...] }
one block per forecast interval (t0, t1] (3 h, later 6 h): the mean rain rate in mm/h × scale, rows south to north, zlib-deflated
Int16 (as rain-obs.json). It also copies the newest extracted run to data/ecmwf-pr.json, the file the page reads (not a run older than
MAX_AGE_H: after a long failure the page falls back rather than show an old forecast). The history branch keeps the runs 35 days. Never fails the job (the page falls back to the Open-Meteo field).
Run: python3 scripts/ecmwf_pr.py
"""
import base64, datetime as dt, json, os, shutil, sys, time, urllib.request, zlib

MIRRORS = ['https://storage.googleapis.com/ecmwf-open-data', 'https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com']
BOX = (92.0, 5.0, 110.0, 25.0)   # lon0, lat0, lon1, lat1: the page's map box, on the 0.25° grid
STEPS = list(range(0, 145, 3)) + list(range(150, 169, 6))   # to 168 h, as the page's weather forecast
MAX_AGE_H = 36   # a run older than this is not given to the page (in normal running the newest run is at most ~20 h old)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HIST = os.environ.get('ECPR_HIST') or os.path.join(ROOT, 'data', 'history')
OUT = os.environ.get('ECPR_OUT') or os.path.join(ROOT, 'data', 'ecmwf-pr.json')


def warn(msg):
    print(f'ECMWF rain: {msg}')
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::warning title=ECMWF open-data rain::{msg}')


def get(path, rng=None, tries=4):
    """GET from the first mirror that answers (a mirror that throttles, e.g. S3 'SlowDown', is retried after a pause)."""
    err = None
    for k in range(tries):
        for m in MIRRORS:
            try:
                h = {'User-Agent': 'sea-haf-pipeline'}
                if rng:
                    h['Range'] = f'bytes={rng[0]}-{rng[0] + rng[1] - 1}'
                with urllib.request.urlopen(urllib.request.Request(f'{m}/{path}', headers=h), timeout=60) as r:
                    return r.read()
            except Exception as e:   # noqa: BLE001
                err = e
        time.sleep(2 * (k + 1))
    raise RuntimeError(f'{path}: {err}')


def run_path(day, hh, step):
    return f'{day}/{hh:02d}z/ifs/0p25/oper/{day}{hh:02d}0000-{step}h-oper-fc'


def newest_runs(now):
    """00 and 12 UTC runs from the newest back, as (YYYYMMDD, HH); a run counts once its last step's index exists."""
    t = now.replace(minute=0, second=0, microsecond=0)
    t -= dt.timedelta(hours=t.hour % 12)
    out = []
    for k in range(6):
        r = t - dt.timedelta(hours=12 * k)
        out.append((r.strftime('%Y%m%d'), r.hour))
    return out


def tp_range(day, hh, step):
    for line in get(run_path(day, hh, step) + '.index').decode().splitlines():
        o = json.loads(line)
        if o.get('param') == 'tp':
            return o['_offset'], o['_length']
    raise RuntimeError(f'no tp in the index of step {step}')


def need_pygrib():
    """Makes `import pygrib` work (its wheels carry ecCodes); returns an error text or None (as silam.py does for netCDF4)."""
    import importlib, site, subprocess
    try:
        importlib.import_module('pygrib')
        return None
    except ImportError:
        pass
    base = [sys.executable, '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--user', 'pygrib']
    r = subprocess.run(base, capture_output=True, text=True)
    if r.returncode and 'externally-managed' in (r.stderr + r.stdout):
        r = subprocess.run(base + ['--break-system-packages'], capture_output=True, text=True)
    if r.returncode:
        return (r.stderr or r.stdout).strip()[-300:]
    site.addsitedir(site.getusersitepackages())
    importlib.invalidate_caches()
    try:
        importlib.import_module('pygrib')
        return None
    except ImportError as e:
        return f'installed but not importable: {e}'


def crop(msg):
    """the box from a global 0.25° field: list of rows south to north (metres of accumulated rain)"""
    import numpy as np
    vals = np.asarray(msg.values, dtype='float64')
    lats, lons = msg.latlons()
    la, lo = lats[:, 0], lons[0, :]
    lo = np.where(lo > 180, lo - 360, lo)
    ix = [int(np.argmin(np.abs(lo - x))) for x in np.arange(BOX[0], BOX[2] + 1e-6, 0.25)]
    iy = [int(np.argmin(np.abs(la - y))) for y in np.arange(BOX[1], BOX[3] + 1e-6, 0.25)]
    assert abs(lo[ix[0]] - BOX[0]) < 1e-3 and abs(la[iy[-1]] - BOX[3]) < 1e-3, 'grid not on 0.25°'
    return vals[np.ix_(iy, ix)]


def extract(day, hh):
    import numpy as np, pygrib
    base = dt.datetime.strptime(f'{day}{hh:02d}', '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
    acc = {}
    for s in STEPS:
        if s == 0:
            continue
        off, ln = tp_range(day, hh, s)
        acc[s] = crop(pygrib.fromstring(get(run_path(day, hh, s) + '.grib2', (off, ln))))
    prev, prev_s = None, 0
    t0, t1, d = [], [], []
    for s in [x for x in STEPS if x]:
        a = acc[s]
        dif = a - (prev if prev is not None else 0)
        rate = np.clip(dif * 1000 / (s - prev_s), 0, 300)   # m accumulated since the run start -> mean mm/h over (prev_s, s]
        q = np.round(rate * 10).astype('<i2')
        d.append(base64.b64encode(zlib.compress(q.tobytes(), 9)).decode())
        t0.append(int((base + dt.timedelta(hours=prev_s)).timestamp() * 1000)); t1.append(int((base + dt.timedelta(hours=s)).timestamp() * 1000))
        prev, prev_s = a, s
    ny, nx = acc[STEPS[1]].shape
    return {'run': int(base.timestamp() * 1000), 'source': 'ECMWF IFS HRES open data (CC BY 4.0), total precipitation at 0.25°, '
            'mean rain rate over each forecast interval (3 h to 144 h, then 6 h)', 'lon0': BOX[0], 'lat0': BOX[1], 'step': 0.25,
            'nx': int(nx), 'ny': int(ny), 'scale': 10, 'enc': 'deflate-int16', 't0': t0, 't1': t1, 'd': d}


def newest_file():
    best = None
    for dp, _, fs in os.walk(HIST):
        for f in fs:
            if f.startswith('ecpr-') and f.endswith('.json') and (best is None or f > os.path.basename(best)):
                best = os.path.join(dp, f)
    return best


def run_age_h(path, now):
    """hours since the start of the run in the file name ecpr-<YYYYMMDDHH>.json"""
    base = dt.datetime.strptime(os.path.basename(path)[5:15], '%Y%m%d%H').replace(tzinfo=dt.timezone.utc)
    return (now - base).total_seconds() / 3600


def main():
    now = dt.datetime.now(dt.timezone.utc)
    run = None
    for day, hh in newest_runs(now):
        if os.path.exists(os.path.join(HIST, f'{day[:4]}-{day[4:6]}', f'ecpr-{day}{hh:02d}.json')):
            break   # the newest complete run is already extracted
        try:
            tp_range(day, hh, STEPS[-1]); run = (day, hh); break   # complete: its last step is published
        except Exception:   # noqa: BLE001
            continue
    if run:
        err = need_pygrib()
        if err:
            warn(f'pygrib could not be installed: {err}')
        else:
            day, hh = run
            out = os.path.join(HIST, f'{day[:4]}-{day[4:6]}', f'ecpr-{day}{hh:02d}.json')
            try:
                t = time.time(); doc = extract(day, hh)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out + '.tmp', 'w') as f:
                    json.dump(doc, f, separators=(',', ':'))
                os.replace(out + '.tmp', out)
                print(f'ECMWF rain: run {day} {hh:02d}Z, {len(doc["d"])} intervals to {doc["t1"][-1] // 3600000 - doc["run"] // 3600000} h, '
                      f'{doc["nx"]}×{doc["ny"]} at 0.25°, {os.path.getsize(out) / 1e6:.2f} MB, {time.time() - t:.0f} s')
            except Exception as e:   # noqa: BLE001
                warn(f'run {day} {hh:02d}Z not extracted: {e}')
    nf = newest_file()
    if nf and run_age_h(nf, now) > MAX_AGE_H:
        # extraction has failed for a while: an old run must not stand in for the forecast (the page would show it as current)
        if os.path.exists(OUT):
            os.remove(OUT)
        warn(f'newest extracted run {os.path.basename(nf)} is {run_age_h(nf, now):.0f} h old; the page keeps the Open-Meteo rain')
    elif nf:
        shutil.copyfile(nf, OUT)
        print(f'ECMWF rain: page file from {os.path.basename(nf)}')
    else:
        warn('no run extracted yet; the page keeps the Open-Meteo rain')


if __name__ == '__main__':
    main()
    sys.exit(0)

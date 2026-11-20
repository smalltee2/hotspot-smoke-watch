#!/usr/bin/env python3
"""SILAM global PM2.5 forecast (Finnish Meteorological Institute, CC BY 4.0) for our map box.

The files are NetCDF-4 (HDF5 inside), which the Node pipeline cannot read without dependencies, so this one step runs in
Python with the netCDF4 package (installed by the workflow). It reads the public S3 bucket anonymously:
  https://fmi-opendata-silam-surface-netcdf.s3.eu-west-1.amazonaws.com/global/<YYYYMMDD>/silam_glob_v6_1_<YYYYMMDD>_PM25_d<k>.nc
one file per UTC day k = 0..4 of the run (24 hourly fields each, 0.2° global grid, µg/m³; time stamps 01:00 … 24:00 UTC of the
day), published around 05:00 UTC. The run of day D therefore reaches D+5 00:00 UTC.

For each of the newest two complete runs that is not extracted yet, it writes data/history/<YYYY-MM>/silam-<YYYYMMDD>.json:
  { run, source, lon0, lat0, step, nx, ny, times: [ms], scale: 10, enc: 'int-dx', values: [[...], ...] }
values: per hour, the crop 92–110 E × 5.4–24.2 N (rows south to north) as integers × scale, each row stored as differences
along x (as the map-correction files); a missing cell is −10, i.e. −1 µg/m³ after scaling.
The history branch keeps these files 35 days, so they also serve the later comparison with CAMS. Never fails the job.
Run: python3 scripts/silam.py
"""
import datetime as dt, json, os, re, sys, tempfile, urllib.request

BUCKET = 'https://fmi-opendata-silam-surface-netcdf.s3.eu-west-1.amazonaws.com'
BOX = (92.0, 5.4, 110.0, 24.2)   # lon0, lat0, lon1, lat1 (cell centres on SILAM's 0.2° grid)
DAYS = 5
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HIST = os.environ.get('SILAM_HIST') or os.path.join(ROOT, 'data', 'history')   # SILAM_HIST: local tests only


def warn(msg):
    print(f'SILAM: {msg}')
    if os.environ.get('GITHUB_ACTIONS'):
        print(f'::warning title=SILAM::{msg}')


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'sea-haf-pipeline'}), timeout=timeout) as r:
        return r.read()


def need_netcdf4():
    """Makes `import netCDF4` work; returns an error text or None. pip installs into the user's site folder (the runner's system
    Python is not writable); that folder may not exist when Python starts, so it is added to the import path afterwards."""
    import importlib, site, subprocess
    try:
        importlib.import_module('netCDF4')
        return None
    except ImportError:
        pass
    base = [sys.executable, '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--user', 'netCDF4']
    r = subprocess.run(base, capture_output=True, text=True)
    if r.returncode and 'externally-managed' in (r.stderr + r.stdout):
        r = subprocess.run(base + ['--break-system-packages'], capture_output=True, text=True)   # PEP 668 Pythons: a user install only
    if r.returncode:
        return (r.stderr or r.stdout).strip()[-300:]
    site.addsitedir(site.getusersitepackages())
    importlib.invalidate_caches()
    try:
        importlib.import_module('netCDF4')
        return None
    except ImportError as e:
        return f'installed but not importable: {e}'


def runs():
    """Run dates (YYYYMMDD) with all DAYS PM2.5 files present, newest first."""
    xml = get(f'{BUCKET}/?list-type=2&delimiter=/&prefix=global/').decode()
    dates = sorted(re.findall(r'<Prefix>global/(\d{8})/</Prefix>', xml), reverse=True)
    out = []
    for d in dates[:4]:
        keys = get(f'{BUCKET}/?list-type=2&prefix=global/{d}/silam_glob').decode()
        names = set(re.findall(r'<Key>global/\d{8}/([^<]+)</Key>', keys))
        files = [n for k in range(DAYS) for n in names if re.fullmatch(rf'silam_glob_v[\d_]+_{d}_PM25_d{k}\.nc', n)]
        if len(files) == DAYS:
            out.append((d, sorted(files, key=lambda n: int(n[-4]))))
    return out


def extract(date, files):
    import netCDF4
    import numpy as np
    times, fields, grid = [], [], None
    with tempfile.TemporaryDirectory() as tmp:
        for name in files:
            p = os.path.join(tmp, name)
            with open(p, 'wb') as f:
                f.write(get(f'{BUCKET}/global/{date}/{name}', timeout=300))
            with netCDF4.Dataset(p) as ds:
                lat, lon = ds['lat'][:], ds['lon'][:]
                iy = np.where((lat >= BOX[1] - 0.01) & (lat <= BOX[3] + 0.01))[0]
                ix = np.where((lon >= BOX[0] - 0.01) & (lon <= BOX[2] + 0.01))[0]
                if not len(iy) or not len(ix):
                    raise ValueError(f'{name}: the box is not on the grid')
                g = (round(float(lon[ix[0]]), 3), round(float(lat[iy[0]]), 3), round(float(lat[1] - lat[0]), 3), len(ix), len(iy))
                if grid and g != grid:
                    raise ValueError(f'{name}: grid changed within the run')
                grid = g
                v = ds['PM25'][:, iy[0]:iy[-1] + 1, ix[0]:ix[-1] + 1]
                if lat[1] < lat[0]:
                    v = v[:, ::-1, :]   # rows south to north
                units = ds['time'].units   # 'seconds since YYYY-MM-DD HH:MM:SS UTC'
                base = dt.datetime.strptime(units.split('since ')[1].replace(' UTC', '').strip(), '%Y-%m-%d %H:%M:%S').replace(tzinfo=dt.timezone.utc)
                mult = {'seconds': 1, 'minutes': 60, 'hours': 3600}[units.split()[0]]
                for k, s in enumerate(ds['time'][:]):
                    times.append(int((base + dt.timedelta(seconds=int(s) * mult)).timestamp() * 1000))
                    fields.append(np.ma.filled(v[k].astype('float64'), np.nan))
    order = sorted(range(len(times)), key=lambda k: times[k])
    values = []
    for k in order:
        q = np.where(np.isfinite(fields[k]) & (fields[k] >= 0), np.round(fields[k] * 10), -10).astype(int)
        values.append(np.diff(q, axis=1, prepend=0).ravel().tolist())
    lon0, lat0, step, nx, ny = grid
    return {'run': date, 'source': 'FMI SILAM global air-quality forecast (CC BY 4.0), PM2.5, 0.2°', 'lon0': lon0, 'lat0': lat0,
            'step': step, 'nx': nx, 'ny': ny, 'times': [times[k] for k in order], 'scale': 10, 'enc': 'int-dx', 'values': values}


def main():
    try:
        rs = runs()
    except Exception as e:   # noqa: BLE001
        return warn(f'cannot list the bucket: {e}')
    if not rs:
        return warn('no complete run in the bucket')
    todo = [(d, f) for d, f in rs[:2] if not os.path.exists(os.path.join(HIST, f'{d[:4]}-{d[4:6]}', f'silam-{d}.json'))]
    if not todo:
        return print(f'SILAM: runs {", ".join(d for d, _ in rs[:2])} already extracted')
    err = need_netcdf4()   # the reader is installed only when a new run is to be read (about once a day)
    if err:
        return warn(f'netCDF4 could not be installed: {err}')
    for date, files in todo:
        out = os.path.join(HIST, f'{date[:4]}-{date[4:6]}', f'silam-{date}.json')
        try:
            t0 = dt.datetime.now()
            doc = extract(date, files)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out + '.tmp', 'w') as f:
                json.dump(doc, f, separators=(',', ':'))
            os.replace(out + '.tmp', out)
            print(f'SILAM: run {date}: {len(doc["times"])} hours {dt.datetime.fromtimestamp(doc["times"][0] / 1000, dt.timezone.utc):%Y-%m-%dT%H}Z – '
                  f'{dt.datetime.fromtimestamp(doc["times"][-1] / 1000, dt.timezone.utc):%Y-%m-%dT%H}Z, {doc["nx"]}×{doc["ny"]} at {doc["step"]}°, '
                  f'{os.path.getsize(out) / 1e6:.1f} MB, {(dt.datetime.now() - t0).total_seconds():.0f} s')
        except Exception as e:   # noqa: BLE001
            warn(f'run {date} not extracted: {e}')


if __name__ == '__main__':
    main()
    sys.exit(0)

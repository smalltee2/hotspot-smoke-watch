"""Shared loaders and scores for the evaluation chapter (docs/manual/04_evaluation.md, ภาค B).

Imported by the b_*.py scripts in this folder (they put this folder on sys.path themselves, so they can be run with
`python3 -I`). The logic follows the pipeline's own scoring code:
  - measurements: scripts/ml2.mjs loadObsHourly (Air4Thai daily archive a4t-*.csv first, then the run logs obs-*.csv,
    keyed by the hour; the same spike check as scripts/obsqc.mjs dropSpikes: > 300 ug/m3 and > 5 x the largest of the
    3 hours before)
  - forecast log: fcst-*.csv as written by scripts/update.mjs (first row per station, issue hour and lead)
  - scores: scripts/ml2.mjs highScore (hours >= 37.5 caught, false-alarm share) and scripts/accuracy.mjs (colour band
    15 / 25 / 37.5 / 75, NRMSE = RMSE / mean measured)
"""
import glob, json, os, sys
import numpy as np
import pandas as pd

THR = 37.5
BANDS = [15, 25, 37.5, 75]
SPIKE = dict(min=300, ratio=5, backH=3)
FC_COLS = ['issued_utc', 'valid_utc', 'station_id', 'lead_h', 'cams_raw', 'corrected', 'correctedA', 'correctedML',
           'correctedML1', 'correctedML2', 'correctedPre', 'correctedNC', 'obs_last', 'obs_basis', 'monitor',
           'cams24', 'corr24', 'blend24', 'blend24A', 'blend24ML']


def files(root, pat, silam=False):
    """Per-run files under root/YYYY-MM/ (silam=False) or root/silam/YYYY-MM/ (silam=True)."""
    base = os.path.join(root, 'silam') if silam else root
    return sorted(glob.glob(os.path.join(base, '20[0-9][0-9]-[0-9][0-9]', pat)))


def _read(fl, cols):
    fr = []
    for f in fl:
        try:
            fr.append(pd.read_csv(f, usecols=lambda c: c in cols, low_memory=False, on_bad_lines='skip', dtype={'station_id': str}))
        except Exception as e:  # an empty or cut-off file
            print('skip', f, e, file=sys.stderr)
    return pd.concat(fr, ignore_index=True) if fr else pd.DataFrame(columns=list(cols))


def drop_spikes(O):
    """O: station_id, t, obs. Sequential check per station as scripts/obsqc.mjs dropSpikes. Returns (kept, dropped)."""
    keep = np.ones(len(O), bool)
    O = O.sort_values(['station_id', 't']).reset_index(drop=True)
    tt = O.t.values.astype('datetime64[s]').astype(np.int64); vv = O.obs.values; ss = O.station_id.values
    start = 0
    for i in range(1, len(O) + 1):
        if i == len(O) or ss[i] != ss[start]:
            kept = []
            for k in range(start, i):
                t, v = tt[k], vv[k]; mx = -np.inf
                for q in range(len(kept) - 1, -1, -1):
                    if tt[kept[q]] < t - SPIKE['backH'] * 3600: break
                    if tt[kept[q]] < t: mx = max(mx, vv[kept[q]])
                if mx > -np.inf and v > SPIKE['min'] and v > SPIKE['ratio'] * mx: keep[k] = False
                else: kept.append(k)
            start = i
    return O[keep].reset_index(drop=True), O[~keep].reset_index(drop=True)


def load_obs(root, silam=False):
    """Hourly measurements, Map-like DataFrame station_id, t (hour, UTC), obs. a4t daily archive first, then the run logs."""
    a4 = _read([f for f in files(root, 'a4t-*.csv', silam=False)], {'hour_end_utc', 'station_id', 'pm25'})
    a4['t'] = pd.to_datetime(a4.hour_end_utc, utc=True, errors='coerce'); a4 = a4.rename(columns={'pm25': 'obs'})
    ob = _read(files(root, 'obs-*.csv', silam=silam), {'time_utc', 'station_id', 'obs_pm25'})
    ob['t'] = pd.to_datetime(ob.time_utc, utc=True, errors='coerce').dt.round('h'); ob = ob.rename(columns={'obs_pm25': 'obs'})
    O = pd.concat([a4[['station_id', 't', 'obs']], ob[['station_id', 't', 'obs']]], ignore_index=True)
    O['obs'] = pd.to_numeric(O.obs, errors='coerce'); O = O.dropna().drop_duplicates(['station_id', 't'], keep='first')
    O, dropped = drop_spikes(O)
    return O, dropped


def load_fcst(root, silam=False):
    F = _read(files(root, 'fcst-*.csv', silam=silam), set(FC_COLS))
    for c in FC_COLS:
        if c not in F: F[c] = np.nan
    F['ti'] = pd.to_datetime(F.issued_utc, utc=True, errors='coerce'); F['tv'] = pd.to_datetime(F.valid_utc, utc=True, errors='coerce')
    F['lead_h'] = pd.to_numeric(F.lead_h, errors='coerce')
    F = F.dropna(subset=['ti', 'tv', 'lead_h', 'cams_raw']).drop_duplicates(['station_id', 'ti', 'lead_h'], keep='first')
    for c in ['cams_raw', 'corrected', 'correctedA', 'correctedML', 'correctedML1', 'correctedML2', 'correctedPre', 'correctedNC',
              'obs_last', 'monitor', 'cams24', 'corr24', 'blend24', 'blend24A', 'blend24ML']:
        F[c] = pd.to_numeric(F[c], errors='coerce')
    return F


def stations(root):
    p = os.path.join(root, 'stations.json')
    return json.load(open(p))['stations'] if os.path.exists(p) else {}


def group_of(sid, st, monitor):
    """Station type for the tables: Air4Thai direct hourly (a4t:*), Air4Thai via OpenAQ, other reference monitors, low-cost."""
    sid = str(sid); s = st.get(sid, {}); prov = s.get('provider', '') or ''
    if 'BMA' in prov: return 'Bangkok BMA (24-h)'
    if sid.startswith('a4t:'): return 'Air4Thai hourly'
    if monitor == 0 or s.get('monitor') is False: return 'Low-cost'
    if prov.startswith('Air4Thai'): return 'Air4Thai via OpenAQ'
    return 'Other reference'


def pair(F, O):
    """Forecast rows with the measurement of the valid hour."""
    m = F.merge(O.rename(columns={'t': 'tv'}), on=['station_id', 'tv'], how='inner')
    return m


def band(v):
    return np.searchsorted(np.array(BANDS), np.asarray(v, float), side='left')


def score(f, o, thr=THR):
    f = np.asarray(f, float); o = np.asarray(o, float); ok = np.isfinite(f) & np.isfinite(o); f, o = f[ok], o[ok]
    n = len(f)
    if n < 30: return None
    e = f - o; hi = o >= thr; fh = f >= thr
    rmse = float(np.sqrt((e ** 2).mean())); mo = float(o.mean())
    r = float(np.corrcoef(f, o)[0, 1]) if f.std() > 0 and o.std() > 0 else np.nan
    return dict(n=n, obs_mean=mo, bias=float(e.mean()), MAE=float(np.abs(e).mean()), RMSE=rmse, NRMSE=100 * rmse / mo if mo > 0 else np.nan,
                r=r, high=int(hi.sum()), caught=int((hi & fh).sum()), POD=100 * (hi & fh).sum() / hi.sum() if hi.sum() else np.nan,
                warned=int(fh.sum()), FAR=100 * (fh & ~hi).sum() / fh.sum() if fh.sum() else np.nan,
                band=100 * float((band(f) == band(o)).mean()))


def skill(rmse, rmse_ref):
    return 100 * (1 - (rmse / rmse_ref) ** 2) if rmse_ref and np.isfinite(rmse_ref) else np.nan


def md_table(df, floatfmt=None):
    """Markdown table without the tabulate package."""
    cols = list(df.columns); out = ['| ' + ' | '.join(map(str, cols)) + ' |', '|' + '|'.join('---' for _ in cols) + '|']
    for _, r in df.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, (float, np.floating)):
                if not np.isfinite(v): cells.append('–')
                else:
                    fmt = (floatfmt or {}).get(c, '{:.2f}'); cells.append(fmt.format(v))
            else: cells.append(str(v))
        out.append('| ' + ' | '.join(cells) + ' |')
    return '\n'.join(out)


def setup_mpl():
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    plt.rcParams.update({'figure.dpi': 150, 'savefig.dpi': 150, 'font.size': 9, 'axes.grid': True, 'grid.alpha': 0.3,
                         'axes.spines.top': False, 'axes.spines.right': False})
    return plt


def load_pairs(root, silam=False):
    """Forecast rows paired with the measured hour, with the station type (grp) and the published value before the nowcast
    (pub = correctedML, else correctedA, as analysis/highpm_replay.py 'page')."""
    O, dropped = load_obs(root, silam=silam); F = load_fcst(root, silam=silam); st = stations(root)
    F['grp'] = [group_of(s, st, m) for s, m in zip(F.station_id, F.monitor)]
    F['pub'] = F.correctedML.fillna(F.correctedA)
    return F, O, dropped, pair(F, O)


def out_dirs(out):
    os.makedirs(os.path.join(out, 'tables'), exist_ok=True)
    return os.path.join(out, 'tables')


def save_table(df, tdir, name, floatfmt=None, title=''):
    df.to_csv(os.path.join(tdir, name + '.csv'), index=False)
    md = (f'<!-- {title} -->\n' if title else '') + md_table(df, floatfmt)
    open(os.path.join(tdir, name + '.md'), 'w').write(md + '\n')
    print(f'\n### {name} {title}\n' + md)


def period(ts):
    ts = pd.to_datetime(ts)
    return f'{ts.min():%Y-%m-%d %H:%M} – {ts.max():%Y-%m-%d %H:%M} UTC'

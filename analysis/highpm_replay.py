#!/usr/bin/env python3
"""High-PM2.5 diagnosis and replay on the live-forecast logs (SEA-HAF).

Usage:  python3 highpm_replay.py <folder holding the logs, searched recursively> [output folder]
Needs:  pandas, numpy, scikit-learn.   Reads fcst-*.csv, obs-*.csv, a4t-*.csv (per-run, daily or monthly files).

1. Verification by lead at reference monitors (hourly-reporting stations): persistence, raw CAMS, before ML, page (ML).
2. What the hours >= 37.5 ug/m3 are: stations, time of day, episode length, each step's mean on them.
3. Walk-forward replay (train on days before the test day only): a correction with the page's inputs, the same plus station
   history (same hour yesterday and the day before, 24-h maximum, 72-h 90th percentile, 7-day mean at that hour), and that one
   trained on the concentration instead of ln(PM+1). Scores: RMSE, bias, r, hours >= 37.5 caught, false alarms, CSI.
Writes highpm_report.md, highpm_by_lead.csv, highpm_replay.csv, highpm_replay_by_month.csv into the output folder.
"""
import sys, os, glob, numpy as np, pandas as pd
src = sys.argv[1] if len(sys.argv) > 1 else '.'; out = sys.argv[2] if len(sys.argv) > 2 else '.'; os.makedirs(out, exist_ok=True)
THR, LEADS = 37.5, [1, 3, 6, 12, 24]
find = lambda pat: sorted(set(glob.glob(os.path.join(src, '**', pat), recursive=True)))
def read(files, cols):
    fr = []
    for f in files:
        if '.bak' in f: continue
        try: fr.append(pd.read_csv(f, usecols=lambda c: c in cols, low_memory=False, on_bad_lines='skip'))
        except Exception as e: print('skip', f, e, file=sys.stderr)
    return pd.concat(fr, ignore_index=True) if fr else pd.DataFrame(columns=list(cols))
fcf, obf, a4f = find('fcst-*.csv'), find('obs-*.csv'), [f for f in find('a4t-*.csv') if 'a4tw' not in os.path.basename(f)]
print(f'files: fcst {len(fcf)}, obs {len(obf)}, a4t {len(a4f)}', file=sys.stderr)
fc = read(fcf, {'issued_utc', 'valid_utc', 'station_id', 'lead_h', 'cams_raw', 'corrected', 'correctedA', 'correctedML', 'obs_last', 'obs_basis', 'monitor'})
for c in ['correctedA', 'correctedML', 'obs_last', 'obs_basis', 'monitor']:
    if c not in fc: fc[c] = np.nan
fc['station_id'] = fc.station_id.astype(str)
fc['tv'] = pd.to_datetime(fc.valid_utc, utc=True, errors='coerce'); fc['ti'] = pd.to_datetime(fc.issued_utc, utc=True, errors='coerce')
fc = fc.dropna(subset=['tv', 'ti', 'cams_raw']).drop_duplicates(['station_id', 'ti', 'lead_h'])
# station type from the rows that carry it (older files have no obs_basis / monitor column)
basis = fc.dropna(subset=['obs_basis']).groupby('station_id').obs_basis.agg(lambda s: s.astype(str).mode().iat[0]); mon = fc.dropna(subset=['monitor']).groupby('station_id').monitor.max()
fc['basis'] = fc.station_id.map(basis); fc['mon'] = fc.station_id.map(mon)
ob = read(obf, {'time_utc', 'station_id', 'obs_pm25'}); ob['station_id'] = ob.station_id.astype(str); ob['t'] = pd.to_datetime(ob.time_utc, utc=True, errors='coerce').dt.floor('h')
a4 = read(a4f, {'hour_end_utc', 'station_id', 'pm25'}); a4['station_id'] = a4.station_id.astype(str)
a4['t'] = pd.to_datetime(a4.hour_end_utc.astype(str).str.replace(r'Z$', ':00Z', regex=True), utc=True, errors='coerce'); a4 = a4.rename(columns={'pm25': 'obs_pm25'})
O = pd.concat([a4[['station_id', 't', 'obs_pm25']], ob[['station_id', 't', 'obs_pm25']]]); O['obs_pm25'] = pd.to_numeric(O.obs_pm25, errors='coerce')
O = O.dropna().query('obs_pm25 >= 0 and obs_pm25 < 1000').drop_duplicates(['station_id', 't'], keep='first')
m = fc.merge(O.rename(columns={'t': 'tv', 'obs_pm25': 'obs'}), on=['station_id', 'tv'])
m['preML'] = m.correctedA.fillna(m.corrected); m['page'] = m.correctedML.fillna(m.preML)
if m.obs_last.isna().all():   # older logs: persistence from the observations themselves
    m = m.merge(O.rename(columns={'t': 'tip', 'obs_pm25': 'ol'}), left_on=['station_id', m.ti.dt.floor('h') - pd.Timedelta(hours=1)], right_on=['station_id', 'tip'], how='left'); m['obs_last'] = m.ol
d = m[(m.mon == 1) & (m.basis == 'h') & m.lead_h.isin(LEADS + [48])].copy()
d['day'] = (d.tv + pd.Timedelta(hours=7)).dt.normalize(); d['hloc'] = (d.tv + pd.Timedelta(hours=7)).dt.hour; d['month'] = d.day.dt.strftime('%Y-%m')
R = []; P = R.append
P(f'# High-PM2.5 diagnosis and replay\n\nLogs: {d.ti.min():%Y-%m-%d %H:%M} to {d.ti.max():%Y-%m-%d %H:%M} UTC, {d.ti.nunique()} issue hours, {d.day.nunique()} days; '
  f'{d.station_id.nunique()} hourly reference monitors; {len(d)} forecast-measurement pairs.\nMeasured: mean {d.obs.mean():.1f}, p90 {d.obs.quantile(.9):.1f}, max {d.obs.max():.0f} ug/m3; hours >= {THR}: {(d.obs >= THR).mean() * 100:.1f} %.\n')
P('Hours >= 37.5 by month (lead 24): ' + ', '.join(f'{k}: {int(v)}' for k, v in d[(d.lead_h == 24) & (d.obs >= THR)].groupby('month').size().items()) + '\n')
def sc(x, o):
    ok = x.notna() & o.notna(); x, o = x[ok], o[ok]
    if len(x) < 30: return None
    e = x - o; hi = o >= THR; f = x >= THR; hit = int((hi & f).sum()); fa = int((~hi & f).sum()); mi = int((hi & ~f).sum())
    return dict(n=len(x), RMSE=round(float(np.sqrt((e ** 2).mean())), 2), bias=round(float(e.mean()), 2), r=round(float(np.corrcoef(x, o)[0, 1]), 3), caught=hit, high=int(hi.sum()), false=fa,
                CSI=round(hit / max(1, hit + fa + mi), 3), mean_on_high=round(float(x[hi].mean()), 1) if hi.any() else None)
def table(rows): return pd.DataFrame(rows).to_markdown(index=False) if hasattr(pd.DataFrame, 'to_markdown') and _tab else pd.DataFrame(rows).to_string(index=False)
try: import tabulate; _tab = True
except Exception: _tab = False
# 1. by lead, identical rows
rows = []
for L in LEADS + [48]:
    t = d[d.lead_h == L].dropna(subset=['cams_raw', 'preML', 'page', 'obs_last'])
    for name, c in [('persistence', 'obs_last'), ('CAMS raw', 'cams_raw'), ('before ML', 'preML'), ('page', 'page')]:
        s = sc(t[c], t.obs)
        if s: rows.append(dict(lead=L, method=name, **s))
BL = pd.DataFrame(rows); BL.to_csv(os.path.join(out, 'highpm_by_lead.csv'), index=False); P('## 1. By lead (hourly reference monitors, identical rows)\n\n' + table(rows) + '\n')
# 2. what the high hours are
t = d[d.lead_h == 24]; h = t[t.obs >= THR]
if len(h):
    top = h.station_id.value_counts(); o1 = O[O.station_id.isin(d.station_id.unique())].sort_values(['station_id', 't']); o1['hi'] = o1.obs_pm25 >= THR
    o1['run'] = (o1.hi != o1.groupby('station_id').hi.shift()).cumsum(); runs = o1[o1.hi].groupby(['station_id', 'run']).size()
    P(f'## 2. The hours >= {THR}\n\n- {len(h)} of {len(t)} lead-24 pairs; {h.station_id.nunique()} of {t.station_id.nunique()} stations have any; top 10 stations hold {100 * top.head(10).sum() / len(h):.0f} %.\n'
      f'- Episodes: {len(runs)}, median length {runs.median():.0f} h, {100 * runs[runs >= 6].sum() / runs.sum():.0f} % of high hours in episodes of 6 h or more.\n'
      f'- Share by Thai hour (%): ' + ' '.join(f'{k}:{v:.0f}' for k, v in (h.hloc.value_counts(normalize=True).sort_index() * 100).items()) + '\n'
      f'- Mean on high hours (lead 24): measured {h.obs.mean():.1f}, CAMS {h.cams_raw.mean():.1f}, before ML {h.preML.mean():.1f}, page {h.page.mean():.1f}, persistence {h.obs_last.mean():.1f}\n\nTop stations (lead 24):\n')
    st = t.groupby('station_id').agg(n=('obs', 'size'), obs=('obs', 'mean'), cams=('cams_raw', 'mean'), page=('page', 'mean'), high=('obs', lambda s: int((s >= THR).sum())), p95=('obs', lambda s: s.quantile(.95))).sort_values('high', ascending=False).head(12).round(1).reset_index()
    P(table(st.to_dict('records')) + '\n')
    bands = pd.cut(t.obs, [0, 15, 25, 37.5, 50, 75, 1e4], labels=['0-15', '15-25', '25-37.5', '37.5-50', '50-75', '>75'])
    P('Mean by measured band (lead 24):\n\n' + table(t.groupby(bands, observed=True).agg(n=('obs', 'size'), measured=('obs', 'mean'), cams=('cams_raw', 'mean'), before_ML=('preML', 'mean'), page=('page', 'mean'), persistence=('obs_last', 'mean')).round(1).reset_index().to_dict('records')) + '\n')
# 3. replay
try:
    from sklearn.ensemble import HistGradientBoostingRegressor as GB
    e = d[d.lead_h.isin(LEADS)].dropna(subset=['preML', 'cams_raw']).reset_index(drop=True)
    wide = O[O.station_id.isin(e.station_id.unique())].pivot(index='t', columns='station_id', values='obs_pm25').asfreq('h')
    look = lambda tbl, st, tt: tbl.stack().rename('v').reindex(pd.MultiIndex.from_arrays([tt, st])).to_numpy()
    k = np.ceil(e.lead_h / 24).astype(int); tih = e.ti.dt.floor('h')
    e['o_same'] = look(wide, e.station_id, e.tv - pd.to_timedelta(24 * k, unit='h')); e['o_same2'] = look(wide, e.station_id, e.tv - pd.to_timedelta(24 * (k + 1), unit='h'))
    e['max24'] = look(wide.rolling(24, min_periods=12).max(), e.station_id, tih - pd.Timedelta(hours=1)); e['p90_72'] = look(wide.rolling(72, min_periods=36).quantile(.9), e.station_id, tih - pd.Timedelta(hours=1))
    clim = pd.concat([wide.shift(24 * j) for j in range(1, 8)], keys=range(7)).groupby(level=1).mean(); e['clim_h'] = look(clim, e.station_id, e.tv - pd.to_timedelta(24 * (k - 1), unit='h'))
    ln = lambda v: np.log(np.clip(v, 0, None) + 1)
    for c in ['preML', 'cams_raw', 'obs_last', 'o_same', 'o_same2', 'max24', 'p90_72', 'clim_h']: e['l_' + c] = ln(e[c])
    e['hs'] = np.sin(2 * np.pi * e.hloc / 24); e['hc'] = np.cos(2 * np.pi * e.hloc / 24); e['y'] = ln(e.obs)
    BASE = ['lead_h', 'hs', 'hc', 'l_preML', 'l_cams_raw', 'l_obs_last']; NEW = BASE + ['l_o_same', 'l_o_same2', 'l_max24', 'l_p90_72', 'l_clim_h']
    for c in ['gb_base', 'gb_new', 'gb_new_value', 'gb_base_value']: e[c] = np.nan
    days = sorted(e.day.unique()); mk = lambda: GB(max_iter=200, learning_rate=0.08, max_leaf_nodes=31, min_samples_leaf=60, l2_regularization=1.0, random_state=0)
    for i, day in enumerate(days):
        if i < 10: continue
        t0 = day.tz_convert('UTC'); tr = e[(e.tv < t0) & (e.tv >= t0 - pd.Timedelta(days=35))]; te = e.index[e.day == day]   # the last 35 days, all verified before the test day starts
        if len(tr) < 5000 or not len(te): continue
        e.loc[te, 'gb_base'] = np.exp(mk().fit(tr[BASE], tr.y).predict(e.loc[te, BASE])) - 1; e.loc[te, 'gb_new'] = np.exp(mk().fit(tr[NEW], tr.y).predict(e.loc[te, NEW])) - 1
        e.loc[te, 'gb_base_value'] = np.clip(mk().fit(tr[BASE], tr.obs).predict(e.loc[te, BASE]), 0, None); e.loc[te, 'gb_new_value'] = np.clip(mk().fit(tr[NEW], tr.obs).predict(e.loc[te, NEW]), 0, None)
        print(f'replay {day:%Y-%m-%d} ({i + 1}/{len(days)})', file=sys.stderr)
    t = e.dropna(subset=['gb_base', 'gb_new', 'gb_new_value', 'obs_last']); M = [('persistence', 'obs_last'), ('CAMS raw', 'cams_raw'), ('before ML', 'preML'), ('page', 'page'), ('replay: page inputs, log scale', 'gb_base'), ('replay: page inputs, value scale', 'gb_base_value'), ('replay: + station history, log scale', 'gb_new'), ('replay: + station history, value scale', 'gb_new_value')]
    rows = [dict(lead=L, method=n, **s) for L in LEADS for n, c in M if (s := sc(t[t.lead_h == L][c], t[t.lead_h == L].obs))]
    pd.DataFrame(rows).to_csv(os.path.join(out, 'highpm_replay.csv'), index=False)
    P(f'## 3. Replay (walk-forward, trained on the 35 days before each test day)\n\nTest rows {len(t)}, test days {t.day.nunique()} ({t.day.min():%Y-%m-%d} to {t.day.max():%Y-%m-%d}), hours >= {THR}: {int((t.obs >= THR).sum())}; measured mean on them {t.obs[t.obs >= THR].mean():.1f}.\n\n' + table(rows) + '\n')
    rows = [dict(month=mo, lead=L, method=n, **s) for mo, tm in t.groupby('month') for L in [1, 24] for n, c in M if (s := sc(tm[tm.lead_h == L][c], tm[tm.lead_h == L].obs))]
    pd.DataFrame(rows).to_csv(os.path.join(out, 'highpm_replay_by_month.csv'), index=False); P('By month, leads 1 and 24:\n\n' + table(rows) + '\n')
    # each test day: does the best replay catch at least as many high hours as the page, with no more false alarms? (the gate that would switch the page)
    g = t[t.lead_h == 24].groupby('day').apply(lambda x: pd.Series({'high': int((x.obs >= THR).sum()), 'page_hit': int(((x.page >= THR) & (x.obs >= THR)).sum()), 'new_hit': int(((x.gb_new_value >= THR) & (x.obs >= THR)).sum()), 'page_fa': int(((x.page >= THR) & (x.obs < THR)).sum()), 'new_fa': int(((x.gb_new_value >= THR) & (x.obs < THR)).sum()), 'page_rmse': float(np.sqrt(((x.page - x.obs) ** 2).mean())), 'new_rmse': float(np.sqrt(((x.gb_new_value - x.obs) ** 2).mean()))}))
    P(f'Per test day (lead 24): replay (+history, value scale) has lower RMSE than the page on {int((g.new_rmse < g.page_rmse).sum())} of {len(g)} days; catches at least as many high hours on {int((g.new_hit >= g.page_hit).sum())}; total caught {int(g.new_hit.sum())} vs {int(g.page_hit.sum())}, false alarms {int(g.new_fa.sum())} vs {int(g.page_fa.sum())}.\n')
except ImportError: P('## 3. Replay skipped: scikit-learn is not installed (pip install scikit-learn)\n')
open(os.path.join(out, 'highpm_report.md'), 'w').write('\n'.join(R)); print('\n'.join(R))

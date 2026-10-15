#!/usr/bin/env python3
"""Fit the weights of the rain blend (CFG.rainBlend in scripts/update.mjs, applied by rainBlend() in index.html) from the hourly logs
on the "history" branch, as replay/fit_blend.py did for the PM2.5 persistence weights:
   rainfc-YYYYMMDD.csv   every 3 h, at the hourly stations, by lead L (h): ECMWF, ECMWF read shiftH later (timing), ECMWF x the
                         72-h radar/ECMWF factor (amount), the radar of the same hour on the latest observed day (persistence),
                         the radar nowcast (L <= 3), and the CHELSA pattern factor the page applies to ECMWF
   rainobs-YYYYMMDD.csv  the truth: gauge-adjusted radar of the hour at the stations (radar_mmh)
For each lead the forecast is   y = b + sum_m w_m (x_m - b)   on ln(R + 0.2), b = ln(ECMWF x CHELSA + 0.2); weights are fitted by
non-negative least squares (a member with no value on a row counts as equal to b there), capped at 1, and checked by leaving one
week out at a time. A member keeps its weight at a lead only if the out-of-week MSE beats ECMWF alone.
usage: python3 fit_rain_blend.py <history dir>      (the folder holding the YYYY-MM/ subfolders)
"""
import csv, glob, math, os, sys
from datetime import datetime, timedelta
import numpy as np

hist = sys.argv[1] if len(sys.argv) > 1 else 'data/history'
EPS, MEMBERS = 0.2, ['shift', 'amount', 'persist', 'nowcast']
BINS = [1, 2, 3, 6, 9, 12, 18, 24, 30, 36, 42, 48]
truth = {}
for f in glob.glob(os.path.join(hist, '*', 'rainobs-*.csv')):
    with open(f) as fh:
        for r in csv.DictReader(fh):
            if r.get('kind') == 'a4t' and r.get('radar_mmh'):
                try: truth[(r['station_id'], r['hour_end_utc'])] = float(r['radar_mmh'])
                except ValueError: pass
ln = lambda x: math.log(max(0.0, x) + EPS)
num = lambda v: float(v) if v not in ('', None) else None
rows = []
for f in sorted(glob.glob(os.path.join(hist, '*', 'rainfc-*.csv'))):
    with open(f) as fh:
        for r in csv.DictReader(fh):
            he = (datetime.strptime(r['hour_start_utc'][:13], '%Y-%m-%dT%H') + timedelta(hours=1)).strftime('%Y-%m-%dT%H:00Z')
            y = truth.get((r['station_id'], he))
            if y is None: continue
            ch = num(r['chelsa_factor']) or 1.0
            b = ln(num(r['ecmwf_mmh']) * ch)
            xs = {'shift': num(r['ecmwf_shift_mmh']), 'amount': num(r['ecmwf_amount_mmh']), 'persist': num(r['persist_mmh']), 'nowcast': num(r['nowcast_mmh'])}
            d = [(ln(xs[m] * (ch if m in ('shift', 'amount') else 1.0)) - b) if xs[m] is not None else 0.0 for m in MEMBERS]
            rows.append((int(float(r['lead_h'])), r['issued_utc'][:10], ln(y) - b, d, y >= 0.5))
print(f'{len(rows)} station-leads with a radar observation ({sum(r[4] for r in rows)} wet >= 0.5 mm)')
def nnls(X, y):
    act = list(range(X.shape[1]))
    while act:
        w = np.linalg.lstsq(X[:, act], y, rcond=None)[0]
        if (w >= 0).all(): out = np.zeros(X.shape[1]); out[act] = np.minimum(w, 1.0); return out
        act = [a for a, v in zip(act, w) if v > 0]
    return np.zeros(X.shape[1])
week = lambda d: datetime.strptime(d, '%Y-%m-%d').isocalendar()[:2]
out = {m: [] for m in MEMBERS}
for L in BINS:
    R = [r for r in rows if r[0] == L]
    if len(R) < 300 or sum(r[4] for r in R) < 30: print(f'lead {L:2d} h: {len(R)} rows, {sum(r[4] for r in R)} wet: too few, weights stay 0'); [out[m].append([L, 0]) for m in MEMBERS]; continue
    X, y = np.array([r[3] for r in R]), np.array([r[2] for r in R]); w = nnls(X, y)
    wk = sorted({week(r[1]) for r in R}); loo = []
    for k in wk:
        tr = [i for i, r in enumerate(R) if week(r[1]) != k]; te = [i for i, r in enumerate(R) if week(r[1]) == k]
        if len(tr) < 200 or len(te) < 30: continue
        wt = nnls(X[tr], y[tr]); loo.append((float(np.mean((y[te] - X[te] @ wt) ** 2)), float(np.mean(y[te] ** 2))))
    keep = bool(loo) and sum(a for a, _ in loo) < sum(b for _, b in loo)
    msg = f'; out-of-week MSE blend {np.mean([a for a, _ in loo]):.3f} vs ECMWF {np.mean([b for _, b in loo]):.3f}' if loo else '; no week to leave out'
    print(f'lead {L:2d} h: n {len(R)}, wet {sum(r[4] for r in R)}, weights ' + ', '.join(f'{m} {v:.2f}' for m, v in zip(MEMBERS, w)) + msg + ('' if keep else ' -> NOT kept (weights 0)'))
    for m, v in zip(MEMBERS, w): out[m].append([L, round(float(v), 2) if keep else 0])
print('\nPaste into CFG.rainBlend in scripts/update.mjs:')
nc = [p for p in out['nowcast'] if p[0] <= 3]
print('  rainBlend: { ' + ', '.join(f'{m}: {out[m]}' for m in ['shift', 'amount', 'persist']) + f', nowcast: {nc} }},')

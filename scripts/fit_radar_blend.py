#!/usr/bin/env python3
"""Fit the weight of the radar nowcast against ECMWF by lead, from the hourly logs (history branch):
   radarnow-YYYYMMDD.csv  nowcast and ECMWF rain (mm/h) at the Air4Thai stations for the next hours, by lead (h)
   rainobs-YYYYMMDD.csv   the observed rain of those hours (column radar_mmh = gauge-adjusted radar; gsmap_fine as fallback)
For each lead bin (0–1, 1–2, 2–3, 3–4 h) the least-squares weight w of  w·nowcast + (1−w)·ecmwf  against the observation,
on ln(R + 0.2) as the ML experts use, with a leave-one-week-out check. Paste the result into NOWCAST_W in index.html.
usage: python3 fit_radar_blend.py <history dir>   (the folder holding YYYY-MM/ subfolders)
"""
import csv, glob, math, os, sys
from collections import defaultdict

hist = sys.argv[1] if len(sys.argv) > 1 else 'data/history'
EPS = 0.2
obs = {}
for f in glob.glob(os.path.join(hist, '*', 'rainobs-*.csv')):
    with open(f) as fh:
        for r in csv.DictReader(fh):
            if r.get('kind') != 'a4t': continue
            v = r.get('radar_mmh') or r.get('gsmap_fine')
            try: obs[(r['station_id'], r['hour_end_utc'])] = float(v)
            except (TypeError, ValueError): pass
rows = []
for f in glob.glob(os.path.join(hist, '*', 'radarnow-*.csv')):
    with open(f) as fh:
        for r in csv.DictReader(fh):
            he = r['hour_start_utc'][:13]  # hour_end = hour_start + 1 h
            from datetime import datetime, timedelta
            t = datetime.strptime(he, '%Y-%m-%dT%H') + timedelta(hours=1)
            key = (r['station_id'], t.strftime('%Y-%m-%dT%H:00Z'))
            if key not in obs: continue
            rows.append((float(r['lead_h']), float(r['nowcast_mmh']), float(r['ecmwf_mmh']), obs[key], r['issued_utc'][:10]))
print(f'{len(rows)} station-hours with an observation')
ln = lambda x: math.log(max(0.0, x) + EPS)
def fit(R):
    # minimise sum (w·a + (1−w)·b − y)^2 on the log scale: w = sum((a−b)(y−b)) / sum((a−b)^2)
    num = sum((ln(a) - ln(b)) * (ln(y) - ln(b)) for _, a, b, y, _ in R); den = sum((ln(a) - ln(b)) ** 2 for _, a, b, y, _ in R)
    return max(0.0, min(1.0, num / den)) if den else None
def mse(R, w):
    return sum((w * ln(a) + (1 - w) * ln(b) - ln(y)) ** 2 for _, a, b, y, _ in R) / len(R)
for lo, hi in [(0, 1), (1, 2), (2, 3), (3, 4)]:
    R = [r for r in rows if lo <= r[0] < hi]
    if len(R) < 200: print(f'lead {lo}–{hi} h: only {len(R)} rows'); continue
    w = fit(R)
    weeks = sorted({r[4][:7] + str(int(r[4][8:10]) // 7) for r in R}); loo = []
    for wk in weeks:
        tr = [r for r in R if r[4][:7] + str(int(r[4][8:10]) // 7) != wk]; te = [r for r in R if r[4][:7] + str(int(r[4][8:10]) // 7) == wk]
        if len(tr) < 100 or len(te) < 20: continue
        wt = fit(tr); loo.append((mse(te, wt), mse(te, 0.0), mse(te, 1.0)))
    cv = f'; leave-one-week-out MSE: blend {sum(x[0] for x in loo)/len(loo):.3f}, ECMWF {sum(x[1] for x in loo)/len(loo):.3f}, nowcast {sum(x[2] for x in loo)/len(loo):.3f}' if loo else ''
    print(f'lead {lo}–{hi} h: n {len(R)}, wet obs {sum(1 for r in R if r[3] >= 0.5)}, w = {w:.2f} (MSE {mse(R, w):.3f}; ECMWF alone {mse(R, 0.0):.3f}; nowcast alone {mse(R, 1.0):.3f}){cv}')

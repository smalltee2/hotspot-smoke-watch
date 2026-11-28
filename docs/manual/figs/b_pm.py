#!/usr/bin/env python3
"""ภาค B sections 1 and 3: evaluation design and the incremental results (raw CAMS -> each correction stage -> published).

usage: python3 -I b_pm.py <history dir (the folder holding YYYY-MM/)> [output dir, default: this folder]
Writes tables/B_inventory, B_incr_<group>, B_bma24, B_rk_map (.csv and .md) and fig_B1_incremental.png, fig_B2_lowcost.png.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
F, O, dropped, m = load_pairs(root)
print(f'forecast rows {len(F)}, issued {period(F.ti)}; measurements {len(O)} ({period(O.t)}), spikes dropped {len(dropped)}; pairs {len(m)}')

# ---- B.1 inventory: stations and pairs by type
inv = []
for g, d in F.groupby('grp'):
    p = m[m.grp == g]; p1 = p[p.lead_h == 1]
    inv.append(dict(group=g, basis='/'.join(sorted(d.obs_basis.dropna().astype(str).unique())), stations_logged=d.station_id.nunique(),
                    stations_scored=p.station_id.nunique(), first_valid=f'{p.tv.min():%Y-%m-%d}' if len(p) else '–', last_valid=f'{p.tv.max():%Y-%m-%d}' if len(p) else '–',
                    pairs_all_leads=len(p), pairs_lead1=len(p1), obs_mean=p1.obs.mean(), obs_p99=p1.obs.quantile(.99), obs_max=p1.obs.max(),
                    pct_ge_37_5=100 * (p1.obs >= THR).mean()))
inv = pd.DataFrame(inv)
save_table(inv, tdir, 'B_inventory', {'obs_mean': '{:.1f}', 'obs_p99': '{:.1f}', 'obs_max': '{:.0f}', 'pct_ge_37_5': '{:.1f}'},
           f'issued {period(F.ti)}')
print('issue hours', F.ti.nunique(), 'days', F.ti.dt.normalize().nunique())
print('dropped spikes:\n', dropped.to_string())

# ---- B.2-4 incremental, hourly basis, identical rows (all stages and persistence present)
STAGES = [('persistence', 'obs_last'), ('CAMS raw', 'cams_raw'), ('+Kalman', 'corrected'), ('+Kalman/assim', 'correctedA'), ('published (+ML v1)', 'pub')]
LEADS = sorted(F.lead_h.unique().astype(int))
res = {}
for g in ['Air4Thai hourly', 'Low-cost', 'Other reference']:
    h = m[(m.grp == g) & (m.obs_basis == 'h')].dropna(subset=[c for _, c in STAGES])
    rows = []
    for L in LEADS:
        t = h[h.lead_h == L]
        sc = {name: score(t[c], t.obs) for name, c in STAGES}
        if sc['CAMS raw'] is None: continue
        for name, c in STAGES:
            s = sc[name]; rows.append(dict(lead_h=L, method=name, **{k: s[k] for k in ['n', 'obs_mean', 'bias', 'MAE', 'RMSE', 'NRMSE', 'r', 'high', 'caught', 'POD', 'FAR', 'band']},
                                           SS_pers=skill(s['RMSE'], sc['persistence']['RMSE']), SS_raw=skill(s['RMSE'], sc['CAMS raw']['RMSE'])))
    R = pd.DataFrame(rows); res[g] = R
    key = g.split()[0].replace('-', '').lower()
    save_table(R, tdir, f'B_incr_{key}', {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'bias': '{:.2f}', 'MAE': '{:.2f}', 'RMSE': '{:.2f}', 'NRMSE': '{:.0f}', 'r': '{:.2f}',
                                          'POD': '{:.0f}', 'FAR': '{:.0f}', 'band': '{:.0f}', 'SS_pers': '{:.0f}', 'SS_raw': '{:.0f}'},
               f'{g}, hourly basis, valid {period(h.tv)}, stations {h.station_id.nunique()}')

# ---- B.5 Bangkok BMA and other 24-h-mean feeds: the 24-h forecast chain (verify.mjs: like-for-like on 24-h values)
S24 = [('CAMS raw 24h', 'cams24'), ('+Kalman 24h', 'corr24'), ('blend24', 'blend24'), ('+assim = published', 'blend24A')]   # ML is not applied at 24-h-mean stations (blend24ML empty there)
b = m[(m.obs_basis == '24')].dropna(subset=[c for _, c in S24])
rows = []
for L in LEADS:
    t = b[b.lead_h == L]
    sc = {n: score(t[c], t.obs) for n, c in S24}
    if sc['CAMS raw 24h'] is None: continue
    for n, c in S24:
        s = sc[n]; rows.append(dict(lead_h=L, method=n, **{k: s[k] for k in ['n', 'obs_mean', 'bias', 'MAE', 'RMSE', 'NRMSE', 'r', 'band']}, SS_raw=skill(s['RMSE'], sc['CAMS raw 24h']['RMSE'])))
save_table(pd.DataFrame(rows), tdir, 'B_bma24', {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'NRMSE': '{:.0f}', 'band': '{:.0f}', 'SS_raw': '{:.0f}', 'r': '{:.2f}'},
           f'24-h-mean stations (BMA and OpenAQ copies), valid {period(b.tv)}, stations {b.station_id.nunique()}')

# ---- B.6 regression-kriging map: leave-one-out 24-h value at the input sites (map-*.csv), against raw CAMS 24-h
mp = pd.concat([pd.read_csv(f, dtype={'station_id': str}) for f in files(root, 'map-*.csv')], ignore_index=True)
mp = mp.drop_duplicates(['run_utc', 'version', 'station_id'])
rows = []
for (ver, mon), d in mp.groupby(['version', 'monitor']):
    d = d.dropna(subset=['obs24', 'cams24', 'map_loo'])
    for name, c in [('CAMS raw 24h', 'cams24'), ('RK map (leave-one-out)', 'map_loo')]:
        s = score(d[c], d.obs24); rows.append(dict(version=ver, sites='reference' if mon == 1 else 'low-cost (scaled)', method=name, runs=d.run_utc.nunique(),
                                                    sites_n=d.station_id.nunique(), **{k: s[k] for k in ['n', 'obs_mean', 'bias', 'MAE', 'RMSE', 'NRMSE', 'r', 'band']}))
save_table(pd.DataFrame(rows), tdir, 'B_rk_map', {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'NRMSE': '{:.0f}', 'band': '{:.0f}', 'r': '{:.2f}'},
           f'map-*.csv, runs {period(pd.to_datetime(mp.run_utc, utc=True))}')
print('note: obs24 of low-cost rows in map-*.csv is on the reference scale (scaleLowcost) as fed to the kriging')

# ---- figures
plt = setup_mpl()
COL = {'persistence': '#999999', 'CAMS raw': '#d62728', '+Kalman': '#ff7f0e', '+Kalman/assim': '#2ca02c', 'published (+ML v1)': '#1f77b4'}
for g, fname in [('Air4Thai hourly', 'fig_B1_incremental.png'), ('Low-cost', 'fig_B2_lowcost.png')]:
    R = res[g]; fig, ax = plt.subplots(1, 4, figsize=(11, 3.0))
    for name, _ in STAGES:
        d = R[R.method == name]
        for a, k in zip(ax, ['RMSE', 'r', 'POD', 'FAR']): a.plot(d.lead_h, d[k], 'o--' if name == '+Kalman/assim' else 'o-', ms=3, color=COL[name], label=name, lw=1.0 if name == '+Kalman/assim' else 1.5)
    for a, k, lab in zip(ax, ['RMSE', 'r', 'POD', 'FAR'], ['RMSE (µg/m³)', 'Pearson r', 'Hours ≥ 37.5 caught (%)', 'False-alarm share (%)']):
        a.set_xscale('log'); a.set_xticks(LEADS); a.set_xticklabels(LEADS); a.set_xlabel('Lead (h)'); a.set_ylabel(lab)
    n = int(R[R.lead_h == 1].n.iloc[0]); tv = m[m.grp == g].tv
    h_, l_ = ax[0].get_legend_handles_labels(); fig.legend(h_, l_, loc='lower center', ncol=5, fontsize=8, frameon=False)
    fig.suptitle(f'{g} stations, hourly PM2.5, valid {tv.min():%Y-%m-%d} to {tv.max():%Y-%m-%d} (n = {n:,} pairs at lead 1 h; identical rows for all methods)', fontsize=9)
    fig.tight_layout(rect=(0, 0.08, 1, 1)); fig.savefig(os.path.join(out, fname)); plt.close(fig)
print('figures written')

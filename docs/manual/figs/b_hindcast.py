#!/usr/bin/env python3
"""ภาค B section 7: hindcast smoke seasons 2024-2026 (18 Dec - 30 Apr): raw CAMS skill, and the persistence nowcast at 3 h.

usage: python3 -I b_hindcast.py <hindcast dir (holding cams_obs_3h_<Y>.csv.gz and stations.csv)> [output dir]
Data: CAMS global atmospheric composition forecasts (Copernicus Atmosphere Monitoring Service) paired with OpenAQ station PM2.5
on the `hindcast` branch. Contains modified Copernicus Atmosphere Monitoring Service information 2023-2026; neither the European
Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.

Groups: hourly reference monitors (Hanoi, AirNow), low-cost sensors (raw values, as in the live logs), Air4Thai (24-h running
means: scored against the 24-h mean of the same CAMS run, 8 values at 3-h steps, leads >= 21 h). Sites failing the whole-season
neighbour check (site_qc 'fail...') are left out.
Nowcast at 3 h (scripts/pmnow.mjs rule, tau = 2 h, error clamped at +-1.5 on ln(PM + 1)), operational timing: at the issue hour
t the newest run is the one with base <= t - 12 h (lead at t: 12-21 h), the error of the measured hour t against that run's
value for t is carried to t + 3 h: nc = (C + 1) exp(exp(-3/2) e) - 1.
Writes tables/B_hc_raw, B_hc_nowcast and fig_B9_hindcast.png.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

src = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
ST = pd.read_csv(os.path.join(src, 'stations.csv'), dtype={'station_id': str})
ST = ST[~ST.site_qc.astype(str).str.startswith('fail')]
LEADS = [3, 6, 12, 24, 48, 72]
raw_rows, nc_rows, fig_rows = [], [], []
for Y in [2024, 2025, 2026]:
    f = os.path.join(src, f'cams_obs_3h_{Y}.csv.gz')
    if not os.path.exists(f): print('missing', f); continue
    D = pd.read_csv(f, dtype={'station_id': str}); st = ST[ST.season == Y].set_index('station_id')
    D = D[D.station_id.isin(st.index)].copy()
    D['grp'] = np.where(st.loc[D.station_id, 'obs_basis'].to_numpy() == '24h_running_mean', 'Air4Thai (24-h mean)',
                        np.where(st.loc[D.station_id, 'type'].to_numpy() == 'reference', 'Reference hourly', 'Low-cost hourly'))
    season = f'{pd.to_datetime(D.valid_utc).min():%Y-%m-%d} – {pd.to_datetime(D.valid_utc).max():%Y-%m-%d}'
    # 24-h mean of the same run for the Air4Thai rows
    a = D[D.grp == 'Air4Thai (24-h mean)'].sort_values(['station_id', 'issue_utc', 'lead_h'])
    a['c24'] = a.groupby(['station_id', 'issue_utc']).cams_pm25.transform(lambda s: s.rolling(8, min_periods=8).mean())
    D.loc[a.index, 'c24'] = a.c24
    for g in ['Reference hourly', 'Low-cost hourly', 'Air4Thai (24-h mean)']:
        for L in LEADS:
            t = D[(D.grp == g) & (D.lead_h == L)]
            c = 'c24' if g.startswith('Air4Thai') else 'cams_pm25'
            if g.startswith('Air4Thai') and L < 21: continue
            s = score(t[c], t.obs_pm25)
            if s: raw_rows.append(dict(season=Y, period=season, group=g, lead_h=L, stations=t.station_id.nunique(), **{k: s[k] for k in ['n', 'obs_mean', 'bias', 'RMSE', 'NRMSE', 'r', 'high', 'POD', 'FAR', 'band']}))
    # nowcast at 3 h, hourly groups
    H = D[D.grp != 'Air4Thai (24-h mean)'][['issue_utc', 'valid_utc', 'lead_h', 'station_id', 'grp', 'cams_pm25', 'obs_pm25']]
    now = H[H.lead_h.isin([12, 15, 18, 21])].rename(columns={'valid_utc': 'now_utc', 'cams_pm25': 'c_now', 'obs_pm25': 'o_now', 'lead_h': 'lead_now'})
    tgt = H[H.lead_h.isin([15, 18, 21, 24])].copy(); tgt['now_utc'] = (pd.to_datetime(tgt.valid_utc) - pd.Timedelta(hours=3)).dt.strftime('%Y-%m-%dT%H:%MZ')
    J = tgt.merge(now[['issue_utc', 'now_utc', 'station_id', 'c_now', 'o_now', 'lead_now']], on=['issue_utc', 'now_utc', 'station_id'])
    J = J[J.lead_now == J.lead_h - 3]
    e = np.clip(np.log(J.o_now.clip(lower=0) + 1) - np.log(J.c_now.clip(lower=0) + 1), -1.5, 1.5).fillna(0.0)
    J['nc'] = np.clip((J.cams_pm25 + 1) * np.exp(np.exp(-3 / 2.0) * e) - 1, 0, None)
    for g, t in J.groupby('grp'):
        for name, c in [('CAMS raw', 'cams_pm25'), ('CAMS + nowcast', 'nc'), ('persistence', 'o_now')]:
            s = score(t[c], t.obs_pm25)
            nc_rows.append(dict(season=Y, group=g, method=name, stations=t.station_id.nunique(), **{k: s[k] for k in ['n', 'obs_mean', 'bias', 'RMSE', 'r', 'high', 'caught', 'POD', 'FAR']}))
    print(Y, season, len(D), 'rows')
FM = {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'NRMSE': '{:.0f}', 'POD': '{:.0f}', 'FAR': '{:.0f}', 'band': '{:.0f}', 'r': '{:.2f}'}
RR = pd.DataFrame(raw_rows); save_table(RR, tdir, 'B_hc_raw', FM, 'hindcast branch, raw CAMS (0.4°, 00/12 UTC runs) vs OpenAQ stations, smoke seasons')
NC = pd.DataFrame(nc_rows); save_table(NC, tdir, 'B_hc_nowcast', FM, 'lead 3 h after the newest available run (run age 12-21 h)')

plt = setup_mpl()
fig, ax = plt.subplots(1, 3, figsize=(10, 2.9), sharey=False)
cols = {2024: '#1b9e77', 2025: '#d95f02', 2026: '#7570b3'}
for a, g in zip(ax, ['Reference hourly', 'Low-cost hourly', 'Air4Thai (24-h mean)']):
    for Y in [2024, 2025, 2026]:
        d = RR[(RR.group == g) & (RR.season == Y)]
        if len(d): a.plot(d.lead_h, d.NRMSE, 'o-', ms=3, color=cols[Y], label=f'{Y - 1}/{str(Y)[2:]}')
    a.set_title(g, fontsize=9); a.set_xlabel('Lead (h)'); a.set_xticks(LEADS)
ax[0].set_ylabel('NRMSE of raw CAMS (%)'); ax[0].legend(fontsize=7, frameon=False, title='season', title_fontsize=7)
fig.suptitle('Hindcast smoke seasons (18 Dec – 30 Apr): raw CAMS against stations', fontsize=9)
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B9_hindcast.png')); plt.close(fig)

#!/usr/bin/env python3
"""ภาค B section 9: case studies. (a) The highest-PM2.5 period in the logs: the Thai days with the most hours >= 37.5 ug/m3 at the
Air4Thai hourly stations (found from the data, not set by hand); (b) the instrument spike at a4t:19t (25 Nov 2026).

usage: python3 -I b_case.py <history dir> [output dir]
Writes tables/B_case_days, B_case_scores, B_case_spike and fig_B6_case.png, fig_B7_spike.png.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
F, O, dropped, m = load_pairs(root); st = stations(root)
hourly_a4t = set(F[(F.grp == 'Air4Thai hourly') & (F.obs_basis == 'h')].station_id)
a = O[O.station_id.isin(hourly_a4t)].copy(); a['day'] = (a.t + pd.Timedelta(hours=7)).dt.normalize()
days = a.groupby('day').agg(stations=('station_id', 'nunique'), hours=('obs', 'size'), mean=('obs', 'mean'), high=('obs', lambda s: int((s >= THR).sum())))
days = days[days.hours >= 1500]   # full days only
days['day'] = days.index.strftime('%Y-%m-%d'); days = days.reset_index(drop=True)
save_table(days.sort_values('high', ascending=False).head(8)[['day', 'stations', 'hours', 'mean', 'high']], tdir, 'B_case_days', {'mean': '{:.1f}'},
           'Thai days with the most hours >= 37.5 at Air4Thai hourly stations (days with >= 1500 measured hours)')
# the episode: the top day with its neighbours while the daily count stays above the median count
d0 = pd.Timestamp(days.sort_values('high').day.iloc[-1]); med = days.high.median(); s = days.set_index(pd.to_datetime(days.day)).high
lo = d0; hi_ = d0
while (lo - pd.Timedelta(days=1)) in s.index and s[lo - pd.Timedelta(days=1)] > 2 * med: lo -= pd.Timedelta(days=1)
while (hi_ + pd.Timedelta(days=1)) in s.index and s[hi_ + pd.Timedelta(days=1)] > 2 * med: hi_ += pd.Timedelta(days=1)
t0 = (lo - pd.Timedelta(hours=7)).tz_localize('UTC'); t1 = (hi_ + pd.Timedelta(hours=17)).tz_localize('UTC')
print(f'episode (Thai days): {lo:%Y-%m-%d} – {hi_:%Y-%m-%d}; median daily count {med}')
h = m[(m.grp == 'Air4Thai hourly') & (m.obs_basis == 'h')].dropna(subset=['cams_raw', 'pub', 'obs_last'])
rows = []
for lab, sel in [(f'episode {lo:%d}-{hi_:%d %b}', (h.tv >= t0) & (h.tv < t1)), ('rest of the record', ~((h.tv >= t0) & (h.tv < t1)))]:
    for L in [1, 24]:
        t = h[sel & (h.lead_h == L)]
        for name, c in [('persistence', 'obs_last'), ('CAMS raw', 'cams_raw'), ('published', 'pub')]:
            sc = score(t[c], t.obs); rows.append(dict(period=lab, lead_h=L, method=name, **{k: sc[k] for k in ['n', 'obs_mean', 'bias', 'RMSE', 'r', 'high', 'caught', 'POD', 'FAR']}))
save_table(pd.DataFrame(rows), tdir, 'B_case_scores', {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'POD': '{:.0f}', 'FAR': '{:.0f}', 'r': '{:.2f}'},
           f'Air4Thai hourly, episode valid {t0:%Y-%m-%d %H} – {t1:%Y-%m-%d %H} UTC')

plt = setup_mpl()
w0, w1 = t0 - pd.Timedelta(days=1), t1 + pd.Timedelta(days=1)
top = a[(a.t >= t0) & (a.t < t1) & (a.obs >= THR)].station_id.value_counts().index[0]
fig, ax = plt.subplots(2, 1, figsize=(9, 5.2), sharex=True)
net = h[(h.tv >= w0) & (h.tv < w1)]
ob = net[net.lead_h == 1].groupby('tv').obs.mean()
ax[0].plot(ob.index, ob, 'k-', lw=1.6, label='measured')
for L, ls in [(1, '-'), (24, '--')]:
    x = net[net.lead_h == L].groupby('tv')[['cams_raw', 'pub']].mean()
    ax[0].plot(x.index, x.cams_raw, color='#d62728', ls=ls, lw=1, label=f'CAMS raw, lead {L} h'); ax[0].plot(x.index, x.pub, color='#1f77b4', ls=ls, lw=1, label=f'published, lead {L} h')
ax[0].set_ylabel('Mean PM2.5 (µg/m³)'); ax[0].set_title(f'(a) Mean over Air4Thai hourly stations ({net.station_id.nunique()})', fontsize=9, loc='left')
x1 = m[(m.station_id == top) & (m.tv >= w0) & (m.tv < w1)]
o1 = O[(O.station_id == top) & (O.t >= w0) & (O.t < w1)]
ax[1].plot(o1.t, o1.obs, 'k-', lw=1.6, label='measured')
for L, ls in [(1, '-'), (24, '--')]:
    x = x1[x1.lead_h == L].sort_values('tv'); ax[1].plot(x.tv, x.cams_raw, color='#d62728', ls=ls, lw=1); ax[1].plot(x.tv, x.pub, color='#1f77b4', ls=ls, lw=1)
ax[1].axhline(THR, color='grey', lw=0.8, ls=':'); ax[0].axhline(THR, color='grey', lw=0.8, ls=':')
ax[1].set_ylabel('PM2.5 (µg/m³)'); ax[1].set_title(f'(b) {top} {st.get(top, {}).get("name", "").strip()} (most hours ≥ 37.5 in the episode)', fontsize=9, loc='left')
for q in ax: q.axvspan(t0, t1, color='orange', alpha=0.08)
ax[0].legend(fontsize=7, ncol=3, frameon=False); ax[1].set_xlabel('Time (UTC)')
ax[1].xaxis.set_major_formatter(__import__('matplotlib').dates.DateFormatter('%d %b'))
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B6_case.png')); plt.close(fig)

# (b) the spike at a4t:19t: what was measured (spikes included), and what was published at lead 1 and 24 h
sid = 'a4t:19t'; s0, s1 = pd.Timestamp('2026-11-23T17:00Z'), pd.Timestamp('2026-11-28T03:00Z')
raw = pd.concat([O[O.station_id == sid], dropped[dropped.station_id == sid]]); raw = raw[(raw.t >= s0) & (raw.t < s1)].sort_values('t')   # measured, spikes included
fs = F[(F.station_id == sid) & (F.tv >= s0) & (F.tv < s1)]
rows = []
for lab, a_, b_ in [('before (24 Nov 00 – 24 Nov 20 UTC)', '2026-11-24T00:00Z', '2026-11-24T20:00Z'), ('after the spike (24 Nov 22 – 27 Nov 01 UTC)', '2026-11-24T22:00Z', '2026-11-27T01:00Z'),
                    ('after the filter reset (27 Nov 01 – 28 Nov 03 UTC)', '2026-11-27T01:00Z', '2026-11-28T04:00Z')]:
    t = fs[(fs.lead_h == 1) & (fs.tv >= pd.Timestamp(a_)) & (fs.tv < pd.Timestamp(b_))]
    ob_ = O[(O.station_id == sid) & (O.t >= pd.Timestamp(a_)) & (O.t < pd.Timestamp(b_))].obs
    rows.append(dict(window=lab, forecasts=len(t), measured_hours=len(ob_), obs_mean=ob_.mean() if len(ob_) else np.nan, cams_raw_mean=t.cams_raw.mean(),
                     kalman_mean=t.corrected.mean(), kalman_max=t.corrected.max(), published_mean=t.pub.mean(), published_max=t.pub.max()))
save_table(pd.DataFrame(rows), tdir, 'B_case_spike', {'obs_mean': '{:.1f}', 'cams_raw_mean': '{:.1f}', 'kalman_mean': '{:.1f}', 'kalman_max': '{:.1f}', 'published_mean': '{:.1f}', 'published_max': '{:.1f}'},
           f'{sid}, lead 1 h; spikes dropped by the check: ' + ', '.join(f'{r.t:%d %b %H} UTC {r.obs:.0f}' for r in dropped[dropped.station_id == sid].itertuples()))
fig, ax = plt.subplots(figsize=(9, 3.0))
ax.plot(raw.t, raw.obs.clip(upper=120), 'k.-', lw=1, ms=3, label='measured (spikes clipped at 120 for display)')
for L, ls in [(1, '-'), (24, '--')]:
    x = fs[fs.lead_h == L].sort_values('tv'); ax.plot(x.tv, x.pub, color='#1f77b4', ls=ls, lw=1.2, label=f'published, lead {L} h'); ax.plot(x.tv, x.cams_raw, color='#d62728', ls=ls, lw=0.8, label=f'CAMS raw, lead {L} h')
dd = dropped[dropped.station_id == sid]
if len(dd): ax.annotate('spikes ' + ', '.join(f'{v:.0f}' for v in dd.obs), (dd.t.iloc[0], 124), fontsize=7, ha='right', color='crimson')
ax.set_ylim(0, 135); ax.set_ylabel('PM2.5 (µg/m³)'); ax.set_xlabel('Time (UTC)'); ax.legend(fontsize=7, ncol=3, frameon=False, loc='upper right')
ax.xaxis.set_major_formatter(__import__('matplotlib').dates.DateFormatter('%d %b %H'))
ax.set_title(f'{sid} {st.get(sid, {}).get("name", "").strip()}: instrument spike and the Kalman bias it left', fontsize=9, loc='left')
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B7_spike.png')); plt.close(fig)

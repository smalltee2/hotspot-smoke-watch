#!/usr/bin/env python3
"""ภาค B section 5: the short-range nowcast (scripts/pmnow.mjs) against the forecast without it, leads 1-6 h.

usage: python3 -I b_nowcast.py <history dir> [output dir]
Rows logged with correctedPre / correctedNC are used as logged. Older rows (before 28 Nov 2026) are rebuilt exactly as
pmNowCheck in scripts/pmnow.mjs does: without = the published correctedML; with = that value moved by the error of the newest
measured hour (the hour ending at issue - 1 h) against the 1-h forecast of the run issued 2 h before, e = clamp(ln(o+1) - ln(f+1),
+-1.5), nc = (pub + 1) exp(exp(-L / 2 h) e) - 1.
Writes tables/B_nowcast_lead, B_nowcast_gate, B_nowcast_prior and fig_B4_nowcast.png.
"""
import os, sys
sys.dont_write_bytecode = True   # nothing written beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

TAU, MAXERR, MAXLEAD = 2.0, 1.5, 6
root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
F, O, _, _ = load_pairs(root)
H = F[(F.obs_basis == 'h') & (F.monitor != 0)].copy()
Om = O.set_index(['station_id', 't']).obs
# every run's 1-h published forecast, by station and valid hour
p1 = H[(H.lead_h == 1) & H.correctedML.notna()].set_index(['station_id', 'tv']).correctedML
p1 = p1[~p1.index.duplicated()]
X = H[(H.lead_h <= MAXLEAD)].copy()
logged = X.correctedNC.notna() & X.correctedPre.notna()
tL = X.ti - pd.Timedelta(hours=1)
oL = Om.reindex(pd.MultiIndex.from_arrays([X.station_id, tL])).to_numpy()
fL = p1.reindex(pd.MultiIndex.from_arrays([X.station_id, tL])).to_numpy()
e = np.clip(np.log(np.clip(oL, 0, None) + 1) - np.log(np.clip(fL, 0, None) + 1), -MAXERR, MAXERR)
nc = np.round(np.clip((X.correctedML + 1) * np.exp(np.exp(-X.lead_h / TAU) * e) - 1, 0, None), 1)
X['without'] = np.where(logged, X.correctedPre, X.correctedML)
X['with'] = np.where(logged, X.correctedNC, np.where(np.isfinite(e), nc, X.correctedML))
X['has_err'] = np.isfinite(e) | logged
X = X.merge(O.rename(columns={'t': 'tv'}), on=['station_id', 'tv']).dropna(subset=['without', 'with'])
print(f'rows {len(X)}, logged with the nowcast columns {int(logged.sum())}, rebuilt {len(X) - int(X.correctedNC.notna().sum())}; with a recent error {X.has_err.mean() * 100:.0f} %')


def tab(d, label):
    rows = []
    for L in sorted(d.lead_h.unique()):
        t = d[d.lead_h == L]
        for name, c in [('without (published)', 'without'), ('with nowcast', 'with')]:
            s = score(t[c], t.obs); rows.append(dict(set=label, lead_h=int(L), method=name, **{k: s[k] for k in ['n', 'bias', 'MAE', 'RMSE', 'r', 'high', 'caught', 'POD', 'warned', 'FAR', 'band']}))
    return rows


FMT = {'n': '{:.0f}', 'POD': '{:.0f}', 'FAR': '{:.0f}', 'band': '{:.0f}', 'r': '{:.2f}'}
a4 = X[X.station_id.str.startswith('a4t:')]
rows = tab(a4, 'Air4Thai hourly') + tab(X, 'all hourly reference monitors')
save_table(pd.DataFrame(rows), tdir, 'B_nowcast_lead', FMT, f'valid {period(X.tv)}; Air4Thai stations {a4.station_id.nunique()}, all {X.station_id.nunique()}')

# the daily gate as pmNowCheck computes it: last 14 days before the Thai midnight of the last full day, pooled leads 1-6 h
dayEnd = (X.tv.max() + pd.Timedelta(hours=7)).normalize() - pd.Timedelta(hours=7)
g = X[(X.tv >= dayEnd - pd.Timedelta(days=14)) & (X.tv < dayEnd)]
hi = g.obs >= THR; w1 = g.without >= THR; w2 = g['with'] >= THR
k = dict(window=f'{g.tv.min():%Y-%m-%d %H} – {g.tv.max():%Y-%m-%d %H} UTC', n=len(g), high=int(hi.sum()), caught_without=int((hi & w1).sum()), caught_with=int((hi & w2).sum()),
         FA_without=100 * (w1 & ~hi).sum() / max(1, w1.sum()), FA_with=100 * (w2 & ~hi).sum() / max(1, w2.sum()),
         RMSE_without=float(np.sqrt(((g.without - g.obs) ** 2).mean())), RMSE_with=float(np.sqrt(((g['with'] - g.obs) ** 2).mean())))
k['decided'] = k['n'] >= 20000 and k['high'] >= 50
k['would_pass'] = k['decided'] and k['caught_with'] >= k['caught_without'] and k['FA_with'] <= k['FA_without'] and k['RMSE_with'] <= k['RMSE_without']
save_table(pd.DataFrame([k]), tdir, 'B_nowcast_gate', {'FA_without': '{:.1f}', 'FA_with': '{:.1f}', 'RMSE_without': '{:.3f}', 'RMSE_with': '{:.3f}'},
           'pmNowCheck recomputed from the logs (not the recorded state)')

# the prior test window: Air4Thai hourly, 16-27 Nov 2026 (Thai dates), lead 1 and 3
pr = a4[(a4.tv >= pd.Timestamp('2026-11-15T17:00Z')) & (a4.tv < pd.Timestamp('2026-11-27T17:00Z'))]
save_table(pd.DataFrame(tab(pr, 'Air4Thai 16-27 Nov')), tdir, 'B_nowcast_prior', FMT, f'valid {period(pr.tv)}')

plt = setup_mpl()
R = pd.DataFrame(tab(a4, 'a4'))
fig, ax = plt.subplots(1, 3, figsize=(9, 2.8))
for name, col in [('without (published)', '#1f77b4'), ('with nowcast', '#9467bd')]:
    d = R[R.method == name]
    for a, kk in zip(ax, ['RMSE', 'POD', 'FAR']): a.plot(d.lead_h, d[kk], 'o-', color=col, label=name)
for a, lab in zip(ax, ['RMSE (µg/m³)', 'Hours ≥ 37.5 caught (%)', 'False-alarm share (%)']): a.set_xticks([1, 3, 6]); a.set_xlabel('Lead (h)'); a.set_ylabel(lab)
ax[0].legend(fontsize=7, frameon=False)
fig.suptitle(f'Nowcast at Air4Thai hourly stations, valid {a4.tv.min():%Y-%m-%d} to {a4.tv.max():%Y-%m-%d} (n = {int(R.n.iloc[0]):,} at 1 h)', fontsize=9)
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B4_nowcast.png')); plt.close(fig)

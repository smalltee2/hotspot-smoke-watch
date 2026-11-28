#!/usr/bin/env python3
"""ภาค B section 4: CAMS against SILAM on the overlapping period, identical station / issue hour / lead rows.

usage: python3 -I b_silam.py <history dir> [output dir]
SILAM's logs are in <history>/silam/YYYY-MM/ (same columns; cams_raw there holds raw SILAM). Both are scored against the same
measurements (the CAMS run's logs and the Air4Thai archive). Writes tables/B_silam and fig_B3_silam.png.
"""
import os, sys
sys.dont_write_bytecode = True   # nothing written beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
F, O, _, _ = load_pairs(root)
S = load_fcst(root, silam=True); S['pub'] = S.correctedML.fillna(S.correctedA)
k = ['station_id', 'ti', 'lead_h']
J = F[k + ['tv', 'grp', 'obs_basis', 'cams_raw', 'pub']].merge(S[k + ['cams_raw', 'pub']].rename(columns={'cams_raw': 'silam_raw', 'pub': 'silam_pub'}), on=k)
J = J.merge(O.rename(columns={'t': 'tv'}), on=['station_id', 'tv']).dropna(subset=['cams_raw', 'pub', 'silam_raw', 'silam_pub'])
J = J[J.obs_basis == 'h']
print(f'overlap: issued {period(J.ti)}, rows {len(J)}')
rows = []
for g in ['Air4Thai hourly', 'Low-cost']:
    for L in sorted(J.lead_h.unique()):
        t = J[(J.grp == g) & (J.lead_h == L)]
        for name, c in [('CAMS raw', 'cams_raw'), ('SILAM raw', 'silam_raw'), ('CAMS published', 'pub'), ('SILAM published', 'silam_pub')]:
            s = score(t[c], t.obs)
            if s: rows.append(dict(group=g, lead_h=int(L), method=name, **{q: s[q] for q in ['n', 'obs_mean', 'bias', 'MAE', 'RMSE', 'NRMSE', 'r', 'high', 'caught', 'POD', 'FAR', 'band']}))
R = pd.DataFrame(rows)
save_table(R, tdir, 'B_silam', {'n': '{:.0f}', 'obs_mean': '{:.1f}', 'NRMSE': '{:.0f}', 'POD': '{:.0f}', 'FAR': '{:.0f}', 'band': '{:.0f}', 'r': '{:.2f}'},
           f'valid {period(J.tv)}; Air4Thai hourly stations {J[J.grp == "Air4Thai hourly"].station_id.nunique()}, low-cost {J[J.grp == "Low-cost"].station_id.nunique()}')

plt = setup_mpl()
fig, ax = plt.subplots(1, 3, figsize=(9.5, 2.9)); d = R[R.group == 'Air4Thai hourly']
sty = {'CAMS raw': ('#d62728', '--'), 'SILAM raw': ('#8c564b', '--'), 'CAMS published': ('#d62728', '-'), 'SILAM published': ('#8c564b', '-')}
for name, (col, ls) in sty.items():
    x = d[d.method == name]
    for a, q in zip(ax, ['RMSE', 'bias', 'r']): a.plot(x.lead_h, x[q], marker='o', ms=3, color=col, ls=ls, label=name)
for a, lab in zip(ax, ['RMSE (µg/m³)', 'Bias (µg/m³)', 'Pearson r']):
    a.set_xscale('log'); a.set_xticks([1, 3, 6, 12, 24, 48]); a.set_xticklabels([1, 3, 6, 12, 24, 48]); a.set_xlabel('Lead (h)'); a.set_ylabel(lab)
ax[0].legend(fontsize=7, frameon=False)
fig.suptitle(f'CAMS vs SILAM at Air4Thai hourly stations, identical rows, valid {J.tv.min():%Y-%m-%d} to {J.tv.max():%Y-%m-%d}', fontsize=9)
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B3_silam.png')); plt.close(fig)

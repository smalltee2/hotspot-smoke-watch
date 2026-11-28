#!/usr/bin/env python3
"""ภาค B section 6: PM2.5 correction v1 (live, correctedML1) against v2 (candidate, correctedML2) on the pmHighCheck criteria
(scripts/ml2.mjs): hourly reference monitors, leads <= 24 h, hours >= 37.5 ug/m3 caught, false-alarm share, RMSE.

usage: python3 -I b_ml2.py <history dir> [output dir]
Writes tables/B_ml2_lead, B_ml2_window, B_ml2_recorded and fig_B5_ml2.png.
"""
import glob, json, os, sys
sys.dont_write_bytecode = True   # nothing written beside the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)
F, O, _, m = load_pairs(root)
d = m[(m.obs_basis == 'h') & (m.monitor != 0) & (m.lead_h <= 24) & m.correctedML2.notna()].copy()
d['v1'] = d.correctedML1.fillna(d.correctedML).fillna(d.correctedA)
d = d.dropna(subset=['v1'])
print(f'rows with v2: {len(d)}, issued {period(d.ti)}, stations {d.station_id.nunique()}')


def hs(t):
    hi = t.obs >= THR; f1 = t.v1 >= THR; f2 = t.correctedML2 >= THR
    return dict(n=len(t), high=int(hi.sum()), caught_v1=int((hi & f1).sum()), caught_v2=int((hi & f2).sum()),
                FA_v1=100 * (f1 & ~hi).sum() / max(1, f1.sum()), FA_v2=100 * (f2 & ~hi).sum() / max(1, f2.sum()),
                RMSE_v1=float(np.sqrt(((t.v1 - t.obs) ** 2).mean())), RMSE_v2=float(np.sqrt(((t.correctedML2 - t.obs) ** 2).mean())),
                bias_v1=float((t.v1 - t.obs).mean()), bias_v2=float((t.correctedML2 - t.obs).mean()))


FMT = {'FA_v1': '{:.0f}', 'FA_v2': '{:.0f}', 'RMSE_v1': '{:.2f}', 'RMSE_v2': '{:.2f}', 'bias_v1': '{:.2f}', 'bias_v2': '{:.2f}'}
rows = [dict(lead_h=int(L), **hs(t)) for L, t in d.groupby('lead_h')] + [dict(lead_h='1-24 pooled', **hs(d))]
save_table(pd.DataFrame(rows), tdir, 'B_ml2_lead', FMT, f'valid {period(d.tv)}, hourly reference monitors {d.station_id.nunique()}')

dayEnd = (d.tv.max() + pd.Timedelta(hours=7)).normalize() - pd.Timedelta(hours=7)
w = d[(d.tv >= dayEnd - pd.Timedelta(days=14)) & (d.tv < dayEnd)]
k = hs(w); k['window'] = f'{w.tv.min():%Y-%m-%d %H} – {w.tv.max():%Y-%m-%d %H} UTC'
k['decided'] = k['n'] >= 20000 and k['high'] >= 100
k['would_pass'] = k['decided'] and k['caught_v2'] >= k['caught_v1'] and k['FA_v2'] <= k['FA_v1'] and k['RMSE_v2'] <= k['RMSE_v1']
save_table(pd.DataFrame([k]), tdir, 'B_ml2_window', FMT, 'pmHighCheck recomputed (no `since` cut)')

# the checks the pipeline recorded (ml-YYYYMMDD.json, key v2.check), CAMS and SILAM
rec = []
for model, base in [('CAMS', root), ('SILAM', os.path.join(root, 'silam'))]:
    for f in sorted(glob.glob(os.path.join(base, '20[0-9][0-9]-[0-9][0-9]', 'ml-*.json'))):
        c = (json.load(open(f)).get('v2') or {}).get('check')
        if c: rec.append(dict(model=model, day=os.path.basename(f)[3:11], n=c['n'], high=c['high'], caught_v1=c['hit1'], caught_v2=c['hit2'],
                              FA_v1=100 * c['fa1'], FA_v2=100 * c['fa2'], RMSE_v1=c['rmse1'], RMSE_v2=c['rmse2'], decided=c['decided'], ok=c['ok']))
R = pd.DataFrame(rec)
save_table(R, tdir, 'B_ml2_recorded', FMT, 'state.ml2.check as recorded each day in ml-YYYYMMDD.json')

plt = setup_mpl()
fig, ax = plt.subplots(1, 3, figsize=(10, 2.9))
c = R[(R.model == 'CAMS') & (R.n > 0)]; x = pd.to_datetime(c.day)
for a, (k1, k2, lab) in zip(ax, [('caught_v1', 'caught_v2', 'Hours ≥ 37.5 caught (count)'), ('FA_v1', 'FA_v2', 'False-alarm share (%)'), ('RMSE_v1', 'RMSE_v2', 'RMSE (µg/m³)')]):
    a.plot(x, c[k1], 'o-', color='#1f77b4', label='v1 (live)'); a.plot(x, c[k2], 's-', color='#e377c2', label='v2 (candidate)')
    a.set_ylabel(lab); a.tick_params(axis='x', rotation=45); a.set_xlabel('Day of check (2026)')
    a.xaxis.set_major_formatter(__import__('matplotlib').dates.DateFormatter('%d %b'))
ax[0].legend(fontsize=7, frameon=False)
fig.suptitle('pmHighCheck as recorded by the CAMS run (14-day window, hourly reference monitors, leads ≤ 24 h)', fontsize=9)
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B5_ml2.png')); plt.close(fig)

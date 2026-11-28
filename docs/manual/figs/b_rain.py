#!/usr/bin/env python3
"""ภาค B section 8: rain. Scores by rain hours >= 0.5 mm/h caught (POD) and the false-alarm share, as fit_rain_blend.py and
obsRainCheck (scripts/update.mjs) do, not only by error on ln(R + 0.2).

(a) Observed rain products against the ThaiWater gauges (rainobs-*.csv, kind 'gauge', gauge_mm): GSMaP (gsmap_cell), PARDIG
    (pardig_cell) and the radar (radar_mmh; gauge-adjusted with a 7-day gauge/radar factor, so not independent of the gauges).
(b) ECMWF and the rain blend against the radar truth at the hourly stations (rainfc-*.csv vs rainobs kind 'a4t' radar_mmh), as
    fit_rain_blend.py: the blend is rebuilt with the weights now in CFG.rainBlend (y = b + sum w_m (x_m - b) on ln(R + 0.2),
    b = ln(ECMWF x CHELSA + 0.2)). Rows issued up to 8 Nov 2026 were inside the first fit (15 Oct - 8 Nov); later rows are
    independent of it. PARDIG uses ECMWF among its inputs, so it is not used as truth here.

usage: python3 -I b_rain.py <history dir> [output dir]
Writes tables/B_rain_obs, B_rain_fc and fig_B8_rain.png.
"""
import csv, glob, math, os, sys
from datetime import datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from b_common import *

WET, EPS = 0.5, 0.2
# CFG.rainBlend in scripts/update.mjs (fit of 8 Nov 2026); leads not listed are 0
W = {'shift': {1: 0.12, 2: 0.14}, 'amount': {}, 'persist': {1: 0.12, 2: 0.19}, 'nowcast': {1: 0.74, 2: 0.5}}
root = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.abspath(__file__)); tdir = out_dirs(out)


def cat(f, o):
    f = np.asarray(f, float); o = np.asarray(o, float); fw = f >= WET; ow = o >= WET
    hit = int((fw & ow).sum()); fc = int(fw.sum()); wet = int(ow.sum())
    return dict(n=len(f), wet=wet, caught=hit, POD=100 * hit / max(1, wet), warned=fc, FAR=100 * (fc - hit) / max(1, fc), CSI=100 * hit / max(1, wet + fc - hit),
                bias_freq=fc / max(1, wet))


def rd(pat, cols):
    fr = []
    for f in sorted(glob.glob(os.path.join(root, '20[0-9][0-9]-[0-9][0-9]', pat))):
        with open(f) as fh:
            rows = [{k: r.get(k) for k in cols} for r in csv.DictReader(fh)]   # DictReader: files whose header gained a column mid-day
        fr.append(pd.DataFrame(rows))
    return pd.concat(fr, ignore_index=True)


# (a) observed products at the gauges
G = rd('rainobs-*.csv', ['hour_end_utc', 'kind', 'station_id', 'lat', 'lon', 'gauge_mm', 'gsmap_cell', 'pardig_cell', 'radar_mmh'])
T = G[G.kind == 'a4t'].copy(); G = G[G.kind == 'gauge'].copy()
for c in ['gauge_mm', 'gsmap_cell', 'pardig_cell', 'radar_mmh']: G[c] = pd.to_numeric(G[c], errors='coerce')
G['station_id'] = G.lat.astype(str) + ',' + G.lon.astype(str)   # gauge rows carry no id: the position is the gauge
G = G.dropna(subset=['gauge_mm']).drop_duplicates(['station_id', 'hour_end_utc'])
G['t'] = pd.to_datetime(G.hour_end_utc, utc=True)
rows = []
for name, c in [('GSMaP', 'gsmap_cell'), ('PARDIG', 'pardig_cell'), ('Radar (gauge-adjusted)', 'radar_mmh')]:
    d = G.dropna(subset=[c]); rows.append(dict(set='own period', product=name, period=f'{d.t.min():%Y-%m-%d} – {d.t.max():%Y-%m-%d}', gauges=d.station_id.nunique(), **cat(d[c], d.gauge_mm)))
both = G.dropna(subset=['gsmap_cell', 'pardig_cell'])
for name, c in [('GSMaP', 'gsmap_cell'), ('PARDIG', 'pardig_cell')]:
    rows.append(dict(set='same gauge-hours', product=name, period=f'{both.t.min():%Y-%m-%d} – {both.t.max():%Y-%m-%d}', gauges=both.station_id.nunique(), **cat(both[c], both.gauge_mm)))
FM = {'POD': '{:.0f}', 'FAR': '{:.0f}', 'CSI': '{:.0f}', 'bias_freq': '{:.2f}'}
save_table(pd.DataFrame(rows), tdir, 'B_rain_obs', FM, 'rainobs-*.csv, ThaiWater gauges, hourly, wet = >= 0.5 mm/h')

# (b) ECMWF and the blend against the radar at the hourly stations
T['radar_mmh'] = pd.to_numeric(T.radar_mmh, errors='coerce'); T = T.dropna(subset=['radar_mmh']).drop_duplicates(['station_id', 'hour_end_utc'])
truth = T.set_index(['station_id', 'hour_end_utc']).radar_mmh
R = rd('rainfc-*.csv', ['issued_utc', 'hour_start_utc', 'lead_h', 'station_id', 'ecmwf_mmh', 'ecmwf_shift_mmh', 'ecmwf_amount_mmh', 'persist_mmh', 'nowcast_mmh', 'chelsa_factor'])
R['k'] = R.issued_utc.str[:13]; R = R.drop_duplicates(['k', 'station_id', 'lead_h'])
for c in ['lead_h', 'ecmwf_mmh', 'ecmwf_shift_mmh', 'ecmwf_amount_mmh', 'persist_mmh', 'nowcast_mmh', 'chelsa_factor']: R[c] = pd.to_numeric(R[c], errors='coerce')
R['he'] = (pd.to_datetime(R.hour_start_utc.str[:13] + ':00Z', utc=True) + pd.Timedelta(hours=1)).dt.strftime('%Y-%m-%dT%H:00Z')
R['obs'] = truth.reindex(pd.MultiIndex.from_arrays([R.station_id, R.he])).to_numpy()
R = R.dropna(subset=['obs', 'ecmwf_mmh']); R['lead_h'] = R.lead_h.astype(int)
ch = R.chelsa_factor.fillna(1.0); lnR = lambda x: np.log(np.clip(x, 0, None) + EPS)
b = lnR(R.ecmwf_mmh * ch); R['ecmwf_page'] = R.ecmwf_mmh * ch
y = b.copy()
for mname, col, scale in [('shift', 'ecmwf_shift_mmh', True), ('amount', 'ecmwf_amount_mmh', True), ('persist', 'persist_mmh', False), ('nowcast', 'nowcast_mmh', False)]:
    w = R.lead_h.map(W[mname]).fillna(0.0); x = R[col] * (ch if scale else 1.0)
    y = y + np.where(x.notna() & (w > 0), w * (lnR(x) - b), 0.0)
R['blend'] = np.exp(y) - EPS
R['ti'] = pd.to_datetime(R.issued_utc, utc=True)
rows = []
for per, sel in [('in the first fit (issued ≤ 8 Nov)', R.ti < pd.Timestamp('2026-11-09T00:00Z')), ('after the fit (issued ≥ 9 Nov)', R.ti >= pd.Timestamp('2026-11-09T00:00Z'))]:
    for L in sorted(R.lead_h.unique()):
        t = R[sel & (R.lead_h == L)]
        if not len(t): continue
        for name, c in [('ECMWF (x CHELSA)', 'ecmwf_page'), ('blend (CFG.rainBlend)', 'blend'), ('radar persistence', 'persist_mmh'), ('radar nowcast', 'nowcast_mmh')]:
            tt = t.dropna(subset=[c])
            if len(tt) < 100 or (c == 'blend' and L > 2): continue
            rows.append(dict(period=per, lead_h=L, member=name, issued=f'{tt.ti.min():%m-%d} – {tt.ti.max():%m-%d}', **cat(tt[c], tt.obs),
                             mse_lnR=float(((lnR(tt[c]) - lnR(tt.obs)) ** 2).mean())))
RF = pd.DataFrame(rows)
save_table(RF, tdir, 'B_rain_fc', {**FM, 'mse_lnR': '{:.3f}'}, f'rainfc-*.csv vs radar at {R.station_id.nunique()} hourly stations, issued {period(R.ti)}')

plt = setup_mpl()
fig, ax = plt.subplots(1, 3, figsize=(10, 2.9))
A = pd.DataFrame([r for r in rows if r['period'].startswith('after')])
for name, col in [('ECMWF (x CHELSA)', '#1f77b4'), ('blend (CFG.rainBlend)', '#2ca02c'), ('radar persistence', '#7f7f7f'), ('radar nowcast', '#9467bd')]:
    d = A[A.member == name]
    for a, q in zip(ax, ['POD', 'FAR', 'CSI']): a.plot(d.lead_h, d[q], 'o-', ms=3, color=col, label=name)
for a, lab in zip(ax, ['Rain hours caught (%)', 'False-alarm share (%)', 'CSI (%)']): a.set_xlabel('Lead (h)'); a.set_ylabel(lab)
ax[0].legend(fontsize=7, frameon=False)
fig.suptitle(f'Rain ≥ 0.5 mm/h at the hourly stations against the gauge-adjusted radar, issued 9 Nov – {R.ti.max():%d %b %Y}', fontsize=9)
fig.tight_layout(); fig.savefig(os.path.join(out, 'fig_B8_rain.png')); plt.close(fig)

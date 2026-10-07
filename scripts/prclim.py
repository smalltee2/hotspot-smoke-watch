"""Monthly rain-pattern factors for downscaling GSMaP (0.1°) rain to 0.025° (live forecast only).
factor(x, month) = P_clim(x) / P_clim_smooth(x)
  P_clim        CHELSA V2.1 1981-2010 monthly precipitation, 30 arc-s, averaged to 0.025° cells (4 x 4 per GSMaP cell)
  P_clim_smooth the same field averaged to the GSMaP 0.1° cells and interpolated bilinearly back to 0.025°
so the factor keeps the fine terrain pattern (wetter windward slopes and ridges, drier valleys) and averages to about 1 over
each 0.1° cell; the page multiplies the bilinearly interpolated GSMaP rain by it. Sea (no CHELSA data): factor 1. Clipped to 0.2-5.
   python scripts/prclim.py files.txt data/static/prclim"""
import sys, re, json, zlib, pathlib
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling

W, S, E, N, ST = 92.0, 5.0, 110.0, 25.0, 0.025
NX, NY = round((E - W) / ST), round((N - S) / ST)            # 720 x 800 cells, centres W+ST/2 ...
names = [l.strip() for l in open(sys.argv[1]) if l.strip()]
out = pathlib.Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
base = 'https://os.unil.cloud.switch.ch/chelsa02/'
meta = {'source': 'CHELSA V2.1 monthly precipitation climatology 1981-2010 (Karger et al. 2017, doi:10.1038/sdata.2017.122; data doi:10.16904/envidat.228)',
        'lon0': W + ST / 2, 'lat0': S + ST / 2, 'step': ST, 'nx': NX, 'ny': NY, 'rows': 'south to north', 'enc': 'zlib uint8, factor = value/50',
        'files': {}, 'stats': {}}

def bilinear_blocks(B):
    """block means B (200 x 180, NaN = no data) at 0.1° cell centres -> 0.025° cell centres, NaN-aware bilinear"""
    by, bx = B.shape
    fy = (np.arange(NY) + 0.5) / 4 - 0.5; fx = (np.arange(NX) + 0.5) / 4 - 0.5
    y0 = np.clip(np.floor(fy).astype(int), 0, by - 2); x0 = np.clip(np.floor(fx).astype(int), 0, bx - 2)
    ay = np.clip(fy - y0, 0, 1)[:, None]; ax = np.clip(fx - x0, 0, 1)[None, :]
    num = np.zeros((NY, NX)); den = np.zeros((NY, NX))
    for dy, wy in ((0, 1 - ay), (1, ay)):
        for dx, wx in ((0, 1 - ax), (1, ax)):
            v = B[(y0 + dy)[:, None], (x0 + dx)[None, :]]; w = wy * wx * np.isfinite(v)
            num += np.where(np.isfinite(v), v, 0) * w; den += w
    return np.where(den > 0, num / np.maximum(den, 1e-12), np.nan)

for m in range(1, 13):
    cand = [n for n in names if re.search(rf'(_pr_{m:02d}_|_{m:02d}_1981|1981-2010_{m:02d}[_.])', n)]
    if not cand: raise SystemExit(f'no file for month {m}')
    url = cand[0] if cand[0].startswith('http') else base + cand[0]
    with rasterio.open('/vsicurl/' + url) as src:
        win = from_bounds(W, S, E, N, src.transform)
        a = src.read(1, window=win, out_shape=(NY, NX), resampling=Resampling.average, masked=True)
        scale = src.scales[0] if src.scales else 1.0
    P = np.flipud(np.ma.filled(a.astype('float64'), np.nan)) * scale            # rows south to north
    P[P < 0] = np.nan
    B = np.nanmean(P.reshape(NY // 4, 4, NX // 4, 4), axis=(1, 3))             # 0.1° cell means (GSMaP cells)
    Sm = bilinear_blocks(B)
    R = np.where(np.isfinite(P) & np.isfinite(Sm) & (Sm > 0), P / np.where(Sm > 0, Sm, 1), 1.0)
    R = np.clip(R, 0.2, 5.0)
    q = np.round(R * 50).astype(np.uint8)
    f = out / f'factor_{m:02d}.bin'; f.write_bytes(zlib.compress(q.tobytes(), 9))
    cellmean = np.nanmean(np.where(np.isfinite(P), R, np.nan).reshape(NY // 4, 4, NX // 4, 4), axis=(1, 3))
    meta['files'][f'{m:02d}'] = f.name
    meta['stats'][f'{m:02d}'] = {'src': cand[0], 'land_cells': int(np.isfinite(P).sum()), 'p05': float(np.nanpercentile(R[np.isfinite(P)], 5)),
                                 'p95': float(np.nanpercentile(R[np.isfinite(P)], 95)), 'cellmean_median': float(np.nanmedian(cellmean)), 'kB': round(f.stat().st_size / 1024)}
    print(m, meta['stats'][f'{m:02d}'], flush=True)
    print(f"::notice title=prclim {m:02d}::{json.dumps(meta['stats'][f'{m:02d}'])}", flush=True)
json.dump(meta, open(out / 'meta.json', 'w'), indent=1)

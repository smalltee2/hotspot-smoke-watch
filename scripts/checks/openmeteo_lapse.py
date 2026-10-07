"""One-off: the lapse rate Open-Meteo applies to temperature_2m (its 90-m DEM downscaling): default request vs elevation=nan."""
import json, sys, urllib.request, time
pts = [(18.588, 98.487), (18.805, 98.92), (19.3, 97.97), (18.0, 98.8), (20.4, 99.9), (19.9, 99.8), (17.2, 99.2), (16.6, 98.6), (18.3, 99.5), (19.1, 98.0)]
out = []
for la, lo in pts:
    u = f'https://api.open-meteo.com/v1/forecast?latitude={la}&longitude={lo}&hourly=temperature_2m&models=ecmwf_ifs&forecast_days=1&timezone=GMT'
    try:
        a = json.load(urllib.request.urlopen(u, timeout=30)); b = json.load(urllib.request.urlopen(u + '&elevation=nan', timeout=30)); time.sleep(1)
        za, zb = a['elevation'], b['elevation']; d = [x - y for x, y in zip(a['hourly']['temperature_2m'], b['hourly']['temperature_2m']) if x is not None and y is not None]
    except Exception as e:
        out.append(f'{la},{lo}: failed {e!r} ' + (str(getattr(e, "read", lambda: b"")())[:200])); continue
    if not d or za is None or zb is None: out.append(f'{la},{lo}: no data (elev {za}/{zb}, keys {list(a)[:8]})'); continue
    m = sum(d) / len(d); sd = (sum((x - m) ** 2 for x in d) / len(d)) ** .5
    g = round(m / ((za - zb) / 1000), 2) if abs(za - zb) > 20 else None
    out.append(f'{la},{lo}: z_default {za} m, z_model {zb} m, dT {m:+.2f} (sd {sd:.2f}) -> lapse {g} degC/km')
print('\n'.join(out)); print('::notice title=Open-Meteo lapse::' + ' | '.join(out))

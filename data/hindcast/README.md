# CAMS PM2.5 forecasts paired with station PM2.5, leads 0–72 h every 3 h

Made by `exports/make_cams_station_3h.py` from the SEA-HAF hindcast archive (rerun: `python3 exports/make_cams_station_3h.py`).

## Files

| File | Rows | Size |
|---|---|---|
| `cams_obs_3h_2024.csv.gz` | 1,222,414 | 9.1 MB |
| `cams_obs_3h_2025.csv.gz` | 1,971,283 | 14.8 MB |
| `cams_obs_3h_2026.csv.gz` | 3,076,513 | 23.0 MB |
| `stations.csv` | 1,444 season-stations | 0.2 MB |

Columns of `cams_obs_3h_<Y>.csv.gz`:

- `issue_utc`: CAMS run base time.
- `valid_utc`: issue time plus lead.
- `lead_h`: 0, 3, …, 72.
- `station_id`: OpenAQ location ID.
- `cams_pm25`: µg m⁻³, bilinear from the 0.4° grid.
- `obs_pm25`: µg m⁻³, the value for the hour ending at `valid_utc`.

Only rows with an observation are included.

Columns of `stations.csv`:

- `season`, `station_id`, `sensor_id`, `name`, `provider`, `cc`, `lat`, `lon`
- `type`: reference or low-cost.
- `obs_basis`: `hourly` or `24h_running_mean`.
- `site_qc`: the result of the hindcast paper's whole-season neighbour check, taken from `replay/results_bench/site_qc.csv`; `not checked` where the site is absent from that table.

## Sources
- **CAMS:** the CAMS global atmospheric composition forecast (ADS dataset `cams-global-atmospheric-composition-forecasts`, `pm2p5`). It has 00 and 12 UTC runs and 0.4° resolution. The runs cover 18 Dec–30 Apr of 2023/24, 2024/25 and 2025/26 with no missing run (270, 268 and 268 runs).
- **Observations:** OpenAQ v3, as archived in `data/<Y>/openaq/`. Reference monitors are Air4Thai copies plus Hanoi, AirNow, CPCB and SPARTAN; low-cost sensors are mostly AirGradient.
  - Where a location has several PM2.5 sensors, the one with the most hours is used, as in `replay/archive.mjs`.
  - Values ending at :30 (0.4 % of rows) are dropped.

## Attribution and licences
- **CAMS:** Contains modified Copernicus Atmosphere Monitoring Service information 2023–2026 (CAMS global atmospheric composition forecasts, https://doi.org/10.24381/04a0b097). The values were interpolated from the CAMS grid to the stations. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains.
- **PM2.5 observations:** retrieved through OpenAQ (https://openaq.org). The data come from the original providers: the Pollution Control Department of Thailand (Air4Thai), the Hanoi Air Quality Monitoring Network, AirNow, CPCB, SPARTAN and the AirGradient, HabitatMap and Clarity sensor networks. Licences are set by each provider; check the provider's terms on OpenAQ before redistributing the observations. Credit OpenAQ and the original provider when using them.

## Use with care
- **Air4Thai values are 24-h running means, not hourly values** (`obs_basis = 24h_running_mean`). CAMS is instantaneous, so pair these with a 24-h mean of CAMS, or leave them out of hourly training.
- **Low-cost values are raw.** The hindcast paper scales AirGradient to Air4Thai with ref = −3.286 + 0.9245·S (`replay/airgradient_colocation.json`).
- **The issue time is the run time, not the time the run became available.** The live system receives a run about 12 h after its base time (the delay used in the hindcast replay), so a model that mimics operation should pair issue hour t with the newest run whose base time is ≤ t − 12 h.
- **The 2024 season includes the 20 Bangkok Air4Thai stations that mix hourly and 24-h values** (`site_qc = fail: mixed basis`).
- **CAMS is interpolated from the 0.4° ADS grid.** The live code reads CAMS from Open-Meteo at the station coordinates, so values can differ slightly.

## Checks
- Five random 2026 rows were recomputed from the raw netCDF in `data/2026/cams/*.zip` (xarray bilinear interpolation) and from the sensor CSVs. Both CAMS and the observation matched to 0.1 µg m⁻³.
- No row is duplicated on (issue_utc, lead_h, station_id), no observation is negative and no CAMS value is missing.

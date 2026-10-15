# SEA-HAF

Southeast Asia Hybrid Air-quality Forecast: a hybrid physics–statistics–machine-learning PM2.5 forecast for mainland Southeast Asia (formerly "Hotspot Smoke Watch"; the repository name and site address are unchanged).

Hourly PM2.5 warning page for Northern Thailand and mainland Southeast Asia.

- **Total PM2.5 forecast**: CAMS global forecast (via Open-Meteo), corrected every hour against reference monitors on OpenAQ with a per-station Kalman filter on log-ratio bias, spread between stations by inverse-distance weighting.
- **Fire smoke**: VIIRS hotspots from NASA FIRMS → FRP-based PM2.5 emission (Wooster et al. 2005; Akagi et al. 2011) → Gaussian puff dispersion with Open-Meteo forecast winds (Briggs 1973 σ, Heffter 1965 long-range σy).
- **Warnings**: towns and stations banded on Thailand's PCD PM2.5 scale (1 June 2023).
- **Verification**: forecasts are logged and scored against later observations by lead time (`data/verify.json`).
- **Rain, the same way as PM2.5** (`scripts/radar.mjs`): the weather radar is the dense observation. Hourly, the last 2 h of RainViewer frames over Thailand (Thai Meteorological Department radars) are decoded (Universal Blue colours → dBZ → Marshall–Palmer rain rate) and averaged to 0.025° cells; the hourly means are scored against the ThaiWater gauges (adjustment factor gauge/radar over 7 days), replace ECMWF rain in the meteorology used by the smoke model where a radar sees, feed the ML rain experts as the truth (`rainobs-*.csv` column `radar_mmh`), and are published to the page (`rain-obs.json`, field `radar`). The latest frame is extrapolated along the echo motion (block cross-correlation) for 3 h. For 3–48 h the radar corrects ECMWF the way the monitors correct CAMS: every hour ECMWF is compared with the radar over the last 72 h for its timing (how many hours late its rain comes) and amount (a 0.25° radar/ECMWF factor field), and the page can blend ECMWF read later, ECMWF × the factor and the radar of the same hour on the latest observed day (diurnal persistence) by lead (`CFG.rainBlend`). All these weights are zero, and the nowcast keeps provisional weights, until `scripts/fit_rain_blend.py` has been run on the station log `rainfc-*.csv` (every 3 h, all members by lead) against the radar truth in `rainobs-*.csv`. The ML rain experts already take the radar as truth and as their recent-rain inputs. Outside radar coverage (Laos, Myanmar, Cambodia) nothing changes.
- **Where the air comes from**: tap a place on the map → *Where is the air from?* draws an ensemble of 27 backward trajectories (48 h or 24 h) arriving at 100, 500 and 1500 m above ground, HYSPLIT-style (9 members per height with the winds read ±0.25° around the parcel), from ECMWF winds at 10 m, 100 m, 925, 850 and 700 hPa (`data/met-traj.json`, loaded on first use), and lists the countries the air passed over and the fire hotspots near the paths.
- **Ventilation**: map layer and place-card readout of the ventilation index (ECMWF boundary-layer height × 100-m wind, m²/s, drawn at 0.025° with the wind adjusted for terrain exposure and sheltering — MicroMet weighting of Liston & Elder 2006, within ±40 %; below 2,000 poor, 2,000–6,000 moderate, above 6,000 good — the US NMC air-pollution-potential criterion of Stackpole 1967 / Gross 1970); the forecast summary gives each day's mean.
- **Automatic refresh**: an open page checks `data/stamp.json` every 3 minutes and loads a new run in place (keeping the chosen hour and place); a new page version reloads the page.

## How it runs

| Part | Where | What |
|---|---|---|
| `scripts/update.mjs` | GitHub Actions, hourly | OpenAQ obs, CAMS, FIRMS → Kalman correction → `data/latest.json` |
| `scripts/verify.mjs` | same job | RMSE / bias / r by lead time → `data/verify.json` |
| `index.html` + `index_modern.html` | GitHub Pages (deployed by the workflow) | the site's default page (`/`) is the redesign (`index_modern.html` layout with the page code of `index.html`, built by `scripts/build_modern.mjs`); the original layout stays at `/classic.html`. Both read `data/*.json` and run the fire-smoke model in the browser |

Large, changing files (`latest.json`, `met.json`, `state.json`) are not committed: they are published to Pages and carried between runs in the Actions cache. Git keeps only the per-run verification CSVs in `data/history/YYYY-MM/` and the static terrain grid `data/static/elev.json`.

No dependencies; Node 20.

## Setup

1. **Secrets** (Settings → Secrets and variables → Actions): `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`.
2. **Workflow permissions** (Settings → Actions → General): *Read and write permissions*.
3. **Pages** (Settings → Pages): Source **GitHub Actions**. The hourly workflow publishes `index.html` and the data files as a Pages artifact.
4. Actions → *Hourly update* → *Run workflow* for the first run.

Tunable settings are in the `CFG` block at the top of `scripts/update.mjs` (area, grid step, Kalman Q/R, IDW radius, bias fade with lead time).

## Data sources

NASA FIRMS (VIIRS NRT) · OpenAQ v3 · Copernicus CAMS via Open-Meteo air-quality API · Open-Meteo forecast API · Natural Earth boundaries · CARTO / OpenTopoMap / Esri basemaps.

Screening tool: no plume rise, chemistry or wet removal in the fire-smoke model; check against ground monitors before acting on a warning.

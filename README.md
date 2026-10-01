# Hotspot Smoke Watch

Hourly PM2.5 warning page for Northern Thailand and mainland Southeast Asia.

- **Total PM2.5 forecast**: CAMS global forecast (via Open-Meteo), corrected every hour against reference monitors on OpenAQ with a per-station Kalman filter on log-ratio bias, spread between stations by inverse-distance weighting.
- **Fire smoke**: VIIRS hotspots from NASA FIRMS → FRP-based PM2.5 emission (Wooster et al. 2005; Akagi et al. 2011) → Gaussian puff dispersion with Open-Meteo forecast winds (Briggs 1973 σ, Heffter 1965 long-range σy).
- **Warnings**: towns and stations banded on Thailand's PCD PM2.5 scale (1 June 2023).
- **Verification**: forecasts are logged and scored against later observations by lead time (`data/verify.json`).

## How it runs

| Part | Where | What |
|---|---|---|
| `scripts/update.mjs` | GitHub Actions, hourly | OpenAQ obs, CAMS, FIRMS → Kalman correction → `data/latest.json` |
| `scripts/verify.mjs` | same job | RMSE / bias / r by lead time → `data/verify.json` |
| `index.html` | GitHub Pages | reads `data/*.json`; runs the fire-smoke model in the browser |

No dependencies; Node 20.

## Setup

1. **Secrets** (Settings → Secrets and variables → Actions): `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`.
2. **Workflow permissions** (Settings → Actions → General): *Read and write permissions*.
3. **Pages** (Settings → Pages): Deploy from branch `main`, folder `/ (root)`.
4. Actions → *Hourly update* → *Run workflow* for the first run.

Tunable settings are in the `CFG` block at the top of `scripts/update.mjs` (area, grid step, Kalman Q/R, IDW radius, bias fade with lead time).

## Data sources

NASA FIRMS (VIIRS NRT) · OpenAQ v3 · Copernicus CAMS via Open-Meteo air-quality API · Open-Meteo forecast API · Natural Earth boundaries · CARTO / OpenTopoMap / Esri basemaps.

Screening tool: no plume rise, chemistry or wet removal in the fire-smoke model; check against ground monitors before acting on a warning.

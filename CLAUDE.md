# SEA-HAF (hotspot-smoke-watch) — project rules

Hourly PM2.5 and fire-smoke forecast page for mainland Southeast Asia. Vanilla JS + Leaflet page (`index.html`), Node 20 data
pipeline (`scripts/*.mjs`, no dependencies) run by GitHub Actions (`.github/workflows/update.yml`) and published to GitHub Pages.
See `README.md` for the method and data sources.

## Rules

1. **Keys stay only in GitHub Secrets.** `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`, `GSMAP_USER`, `GSMAP_PASS`, `DEV_USER`, `DEV_PASS`
   are read from `process.env` in the workflow. Never write a key, token or password into any file in the repository (code,
   data, workflow YAML, comments, commit messages) or into `data/*.json`.

2. **Rebuild `index_modern.html` after editing `index.html`.** The redesign (`index_modern.html`) holds only the markup and
   styles; its page code is copied from `index.html` by `scripts/build_modern.mjs`. After any change to the code of
   `index.html` run

       node scripts/build_modern.mjs index.html index_modern.html index_modern.html

   and commit both files. If the builder warns about missing ids, bring the redesign's markup up to date instead of leaving the
   two pages apart. New element ids added to `index.html` must also be added to `index_modern.html`.

3. **Don't turn off certificate checks.** Never set `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, `curl -k`,
   `verify=False` or the like. Servers that fail to send their intermediate certificates (Air4Thai) are handled by adding the
   chain to `scripts/certs/*.pem` and passing it through `NODE_EXTRA_CA_CERTS` in the workflow.

4. **Keep the rain and radar blend weights at zero until `scripts/fit_rain_blend.py` has been run.** `CFG.rainBlend` in
   `scripts/update.mjs` (`shift`, `amount`, `persist`) must stay `[[1, 0], [48, 0]]`, and `nowcast` keeps its provisional
   weights, until the fit has been run on enough radar history (`rainfc-*.csv` / `rainobs-*.csv` on the `history` branch).
   Only paste in weights that the fit script produced; don't hand-tune them.

## Working notes

- `data/latest.json`, `data/met.json`, `data/state.json` are not committed: they are published to Pages and carried between
  runs in the Actions cache. Git keeps the per-run CSVs in `data/history/` and the static grids in `data/static/`.
- Check syntax before committing: `for f in scripts/*.mjs; do node --check "$f"; done`.
- The page is bilingual (Thai/English via `data-th` and `T()`); keep both strings when changing user-facing text.
- Judge rain corrections by rain hours caught (>= 0.5 mm/h) and false alarms, not only by error on ln(R + 0.2): that error
  can be lowered by forecasting less rain everywhere. `fit_rain_blend.py` and the weather-ML rain gate (`rainDetectCheck` in
  `scripts/update.mjs`) both require catching at least as many rain hours as uncorrected ECMWF, with no more false alarms.
- Observed satellite rain: Google DeepMind PARDIG (`scripts/pardig.mjs`, public bucket, no key; its cache rides inside
  `gsmap-cache.json`) with GSMaP for the newest hours and as fallback; `obsRainCheck` in `scripts/update.mjs` scores both against the
  ThaiWater gauges daily (rainobs `pardig_cell`, `gsmap_cell`) and hands the page back to GSMaP if PARDIG falls behind. PARDIG uses
  ECMWF fields among its inputs: don't use it as the truth for fitting or judging ECMWF rain corrections. Don't add files to the
  workflow's Actions-cache path list: it changes the cache key and the next run starts without its state.
- PM2.5 correction v2 (`scripts/ml2.mjs`) is a candidate run beside the live correction (`scripts/ml.mjs`): station-history inputs
  and a µg/m³ target, logged as `correctedML2` (the live one as `correctedML1`; `correctedML` is whichever is published).
  `pmHighCheck` publishes v2 only while it catches at least as many hours >= 37.5 µg/m³, with no larger false-alarm share and
  no larger RMSE, over 14 days. Don't switch it on by hand or loosen the check to make it pass; judge PM2.5 changes by high hours
  caught and false alarms as well as RMSE (`analysis/highpm_replay.py` reruns the diagnosis on any copy of the logs).
- SILAM (FMI) is a second model beside CAMS: `scripts/silam.py` extracts the runs (the one Python step: NetCDF-4), then
  `scripts/silam_chain.mjs` runs `update.mjs` again with `HSW_MODEL=silam`, so SILAM goes through the same program as CAMS
  (without the fire assimilation: SILAM has its own fire emissions). Don't
  write SILAM-only copies of pipeline steps: change `update.mjs` once and both models get it; guard with `SIL` only what must differ.
  Its state is `state.silamState` (keys `MODEL_KEYS` in `silam_chain.mjs`: add a key there when `update.mjs` gets new per-model
  state), logs in `data/history/silam/`, page files in `data/silam/`. The default page data, the warnings shown first and the
  accuracy card stay CAMS until the logged comparison shows SILAM is at least as good.
- Public page is `/` (redesign), the original layout is `/classic.html`, the developer page `/dev.html`.
- The redesign's glass menu frames: styles in `index_modern.html` ("Glass menu frames"), motion in `glass/nav.mjs`, WebGL2 water
  (wide layout only) in `glass/water.mjs`, wired by `glass/boot.mjs`; the workflow publishes these three to `_site/glass/`.
  Run `node --test glass/*.test.mjs` after changing them. Text on the glass must keep >= 4.5:1 in both themes.

## Scheduled work

- **Rain-blend refit, monthly** (1st of the month, 08:51 Bangkok, a scheduled task in Claude Code): run `scripts/fit_rain_blend.py`
  on the `history` branch logs (the last ~35 days), set `CFG.rainBlend` exactly from its output if it changed, PR, merge and
  check the run. First fit 8 Nov 2026 (15 Oct - 8 Nov): kept 1-2 h, 3-48 h on ECMWF. Expect weights to return with the rainy season.

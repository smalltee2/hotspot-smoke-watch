# SEA-HAF (hotspot-smoke-watch) — project rules

Hourly PM2.5 and fire-smoke forecast page for mainland Southeast Asia. Vanilla JS + Leaflet page (`index.html`), Node 20 data
pipeline (`scripts/*.mjs`, no dependencies) run by GitHub Actions (`.github/workflows/update.yml`) and published to GitHub Pages.
See `README.md` for the method and data sources.

## Rules

1. **Keys stay only in GitHub Secrets.** `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`, `GSMAP_USER`, `GSMAP_PASS`, `IQAIR_API_KEY`, `CHAT_EXPORT_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DEV_USER`, `DEV_PASS`
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

5. **Keep the climatology-blend weights at zero until `scripts/fit_clim_blend.mjs` has been run.** `CFG.climBlend` in
   `scripts/update.mjs` (`cams`, `silam`: pull of long-lead PM2.5 forecasts toward the station climatology) stays all zero until
   the fit has been run on about 2 weeks of `climfc-*.csv` logs (`data/history` for CAMS, `data/history/silam` for SILAM). Only
   paste in weights the fit printed; it keeps a weight only where high hours caught and false alarms are no worse.

## Working notes

- Commits and PRs: no `Co-Authored-By` line and no model name (owner, 26 Nov 2026), whatever an attribution template says.
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
- Station climatology (`scripts/climatology.mjs`, `.github/workflows/climatology.yml`, built once by hand) writes `data/static/pm-clim.json`,
  read by v2 as inputs. Changing v2's input list (`HIST_NAMES` in `scripts/ml2.mjs`) restarts its learning (`state.ml2.nFeat`) and
  its check counts only rows logged since (`state.ml2.since`): that is intended, don't carry old experts over.
- Hindcast expert (`scripts/hindcast.mjs`, model `data/static/hc-model.json`, trained once by `scripts/hindcast_train.mjs` from the
  `hindcast` branch's `data/hindcast/`): a fixed expert of the PM2.5 correction v1, trained on archived CAMS, so loaded in the CAMS
  run only (never for SILAM) and active 18 Dec – 30 Apr. Don't give it weight by hand; the daily scoring decides. Keep the
  Copernicus notice of the hindcast data when copying it.
- SILAM (FMI) is a second model beside CAMS: `scripts/silam.py` extracts the runs (the one Python step: NetCDF-4), then
  `scripts/silam_chain.mjs` runs `update.mjs` again with `HSW_MODEL=silam`, so SILAM goes through the same program as CAMS
  (without the fire assimilation: SILAM has its own fire emissions). Don't
  write SILAM-only copies of pipeline steps: change `update.mjs` once and both models get it; guard with `SIL` only what must differ.
  Its state is `state.silamState` (keys `MODEL_KEYS` in `silam_chain.mjs`: add a key there when `update.mjs` gets new per-model
  state), logs in `data/history/silam/`, page files in `data/silam/`. The default page data, the warnings shown first and the
  accuracy card stay CAMS until the logged comparison shows SILAM is at least as good.
- Ask SEA-HAF (chat): the topic classifier is `scripts/chatml.mjs` (page copy `chatMLfeat` / `chatMLpredict` in index.html must stay identical; `scripts/chatml.test.mjs` checks). Retrain with `node scripts/chat_train.mjs` after changing `scripts/chat_data.mjs` or `chat/data/`; never train on `chat/test.json` or `chat/test_real.json` (real questions the admin labelled on the dev page; `chat_learn.mjs` keeps a fixed third of the admin's labels there). The model kind (linear or the small network) is picked by the development set, not by hand; keep the MASSIVE attribution (`chat/data/README.md`). The local-LLM helper (`scripts/chat_llm_label.mjs`, run on the admin's own computer) only suggests topics (`api/suggest.js`) and writes training questions (`--generate`, `api/generated.js`, kind llmgen: training rows only, never test questions); never let a suggestion become a label without the admin's click, and keep its topic list equal to `INTENTS` (tested). Answers come only from the page's data, never from the model.
- Cloudflare Pages copy (`cloudflare/pages/`, deployed by the last step of update.yml): run wrangler only in a folder outside the repository (inside it wrangler rewrites the project as a Worker); keep page paths relative (the site is at the root on pages.dev, under `/hotspot-smoke-watch/` on GitHub); a Cloudflare failure must never stop the GitHub deploy.
- ECMWF rain on the page comes from ECMWF open data at 0.25° (`scripts/ecmwf_pr.py`, `data/ecmwf-pr.json`, history `ecpr-*.json`); the pipeline keeps the Open-Meteo rain (the rain blend and weather-ML fits are on it): don't switch the pipeline's rain to the open-data field without refitting.
- Main site: https://sea-haf.pages.dev (Cloudflare Pages); backup: GitHub Pages (same `_site`, deployed first). Public page is `/` (redesign), the original layout is `/classic.html`, the developer page `/dev.html`.
- The redesign's glass menu frames: styles in `index_modern.html` ("Glass menu frames"), motion in `glass/nav.mjs`, WebGL2 water
  (wide layout only) in `glass/water.mjs`, wired by `glass/boot.mjs`; the workflow publishes these three to `_site/glass/`.
  Run `node --test glass/*.test.mjs` after changing them. Text on the glass must keep >= 4.5:1 in both themes.

## Scheduled work

- **Rain-blend refit, monthly** (1st of the month, 08:51 Bangkok, a scheduled task in Claude Code): run `scripts/fit_rain_blend.py`
  on the `history` branch logs (the last ~35 days), set `CFG.rainBlend` exactly from its output if it changed, PR, merge and
  check the run. First fit 8 Nov 2026 (15 Oct - 8 Nov): kept 1-2 h, 3-48 h on ECMWF. Expect weights to return with the rainy season.

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
- Public page is `/` (redesign), the original layout is `/classic.html`, the developer page `/dev.html`.

## Scheduled work

- **Rain-blend fit, early November 2026** (about 3 weeks of radar history needed): run `scripts/fit_rain_blend.py` on the
  `history` branch logs, review the per-lead weights it prints, then set `CFG.rainBlend` in `scripts/update.mjs` from its output.
  This touches the live forecast, so do it in Claude Code with the run output in hand, not from memory.

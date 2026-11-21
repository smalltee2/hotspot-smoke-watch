// Hindcast expert of the self-learning PM2.5 correction (scripts/ml.mjs): a gradient-boosted model trained once, offline, on three
// burning seasons of archived CAMS forecasts paired with measured PM2.5 (18 Dec – 30 Apr of 2023/24, 2024/25, 2025/26; branch
// "hindcast", data/hindcast/cams_obs_3h_<Y>.csv.gz, Air4Thai monitors that pass the hindcast's site check).
// It learns how CAMS misses in the burning season (the 24-h mean at a monitor from the CAMS 24-h mean, the CAMS hourly value, the
// measured 24-h mean when the run arrived, lead, time of day, day of year and place), so the ensemble knows the season before it
// has lived through it. The model file is data/static/hc-model.json (scripts/hindcast_train.mjs); it is a fixed expert: it is not
// retrained by the daily learning, which only scores it with the others and gives it weight while it helps.
//   prediction  y = ln(obs24 + 1) − ln(cams24 + 1)      (from the model)
//   hourly      B = (cams + 1)·e^y − 1                   (the CAMS hour-to-hour shape kept)
//   expert      r̂ = ln(B + 1) − ln(F + 1)               (the same target as the other experts: the error left after the chain)
// Outside 18 Dec – 30 Apr (Thai date), or without a CAMS 24-h mean, it gives 0 (the plain chain). CAMS chain only: the SILAM run
// does not load it.
export const HC_NAMES = ['lead', 'lnCams', 'lnCams24', 'lnObs24', 'hsin', 'hcos', 'dsin', 'dcos', 'lat', 'lon'];
export const HC = { fromMD: 1218, toMD: 430 };   // the season the archive covers (month*100 + day, Thai date)
const ln1 = v => Math.log(Math.max(0, v) + 1);
const num = v => (v == null || v === '' || !isFinite(+v) ? NaN : +v);

/** true when the Thai calendar date of t is inside the archived season (18 Dec – 30 Apr) */
export function inHcSeason(t) { const d = new Date(t + 7 * 3600e3), md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); return md >= HC.fromMD || md <= HC.toMD; }

/** features in HC_NAMES order from {lead, cams, cams24, obs24_last, hloc, doy, lat, lon} */
export function hcFeatures(r) {
  const h = num(r.hloc), d = num(r.doy), o = num(r.obs24_last), c = num(r.cams), c24 = num(r.cams24);
  return [num(r.lead), isFinite(c) ? ln1(c) : NaN, isFinite(c24) ? ln1(c24) : NaN, isFinite(o) ? ln1(o) : NaN,
    Math.sin(2 * Math.PI * h / 24), Math.cos(2 * Math.PI * h / 24), Math.sin(2 * Math.PI * d / 365.25), Math.cos(2 * Math.PI * d / 365.25), num(r.lat), num(r.lon)];
}

/** the expert's correction r̂ (log space, relative to the chain's forecast F) for one row; 0 when it does not apply */
export function hcExpert(model, r, predict) {
  if (!model || !isFinite(+r.tValid) || !inHcSeason(+r.tValid)) return 0;
  const c = num(r.cams), c24 = num(r.cams24), F = num(r.F); if (!(c >= 0) || !(c24 >= 0) || !(F >= 0)) return 0;
  const y = predict(model, { x: hcFeatures(r) }); if (!isFinite(y)) return 0;
  return ln1(c) + y - ln1(F);
}

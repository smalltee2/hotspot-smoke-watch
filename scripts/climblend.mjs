// Applies CFG.climBlend (scripts/update.mjs): the pull of the long-lead PM2.5 forecast toward the station climatology,
//   ln(B+1) = (1−w)·ln(F+1) + w·ln(C+1),   w by lead (weights printed by scripts/fit_clim_blend.mjs, never set by hand)
// to the series that is PUBLISHED for a monitor. The logs (fcst-*.csv, climfc-*.csv) keep the forecast before the blend, so the
// fit, the learning corrections and the daily checks always see the same quantity whatever the weights are.
// With all weights zero (the state until the fit has run) nothing is changed and the caller gets null.

/** weight at lead L (h) from a table [[lead, w], …] sorted by lead: 0 before the first lead (the fit has no rows there), linear
 *  between the leads, the last weight beyond the last lead. */
export function climW(tab, L) {
  if (!tab?.length || L < tab[0][0]) return 0;
  for (let k = 1; k < tab.length; k++) if (L <= tab[k][0]) { const [a, wa] = tab[k - 1], [b, wb] = tab[k]; const f = (L - a) / (b - a); return wa * (1 - f) + wb * f; }
  return tab[tab.length - 1][1];
}
export const climActive = tab => !!tab && tab.some(([, w]) => w > 0);
export const blendLn = (F, lnC, w) => Math.exp((1 - w) * Math.log(F + 1) + w * lnC) - 1;

/** One station. corr = hourly forecast by index of hours (null where missing), fc24 = its 24-h mean series or null, jNow = index of
 *  the current hour, lnClim(t) = ln(C+1) of the station for the valid time t (NaN when the station has no climatology).
 *  -> { corr, fc24, n } with new arrays (n = hours changed), or null when nothing changes.
 *  The 24-h mean moves by the mean change of the forecast hours inside its 24-h window. */
export function climBlendSeries(corr, fc24, hours, jNow, tab, lnClim, HOURMS = 3600e3) {
  if (!climActive(tab) || !corr) return null;
  const out = corr.slice(), d = new Array(corr.length).fill(0); let n = 0;
  for (let j = jNow + 1; j < corr.length; j++) { const F = corr[j]; if (F == null) continue;
    const w = climW(tab, Math.round((hours[j] - hours[jNow]) / HOURMS)); if (!(w > 0)) continue;
    const lc = lnClim(hours[j]); if (!Number.isFinite(lc)) continue;
    const B = Math.max(0, Math.round(blendLn(F, lc, w) * 10) / 10); d[j] = B - F; out[j] = B; n++; }
  if (!n) return null;
  let f24 = null;
  if (fc24) { f24 = fc24.slice(); for (let j = jNow + 1; j < fc24.length; j++) { if (fc24[j] == null) continue; let s = 0; for (let k = Math.max(0, j - 23); k <= j; k++) s += d[k];
      if (s) f24[j] = Math.max(0, Math.round((fc24[j] + s / 24) * 10) / 10); } }
  return { corr: out, fc24: f24, n };
}

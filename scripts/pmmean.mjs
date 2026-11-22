// Weekly and monthly mean PM2.5 maps (for the developer page's "Save image": 7-day and 30-day means of the past).
// Every CAMS run adds its hourly analysis (the RK map at the analysis hour: hourly CAMS × the station bias field, on a 0.05° grid)
// to the file of its Thai day, data/history/YYYY-MM/pmday-YYYYMMDD.json (running sum + hour count; kept 35 days on the history
// branch like the other logs). Then data/pm-mean.json (published) gets the mean over the 7 and the 30 most recent complete days
// (>= minHours analysed hours; today, still running, is left out). Fewer days than asked while the store fills: the file says how many.
import fs from 'node:fs/promises';
import path from 'node:path';

export const PMM = { minHours: 18, week: 7, month: 30 };
const H = 3600e3;
export const thaiDay = t => new Date(t + 7 * H).toISOString().slice(0, 10);
const sameGrid = (a, b) => a && b && a.nx === b.nx && a.ny === b.ny && Math.abs(a.lon0 - b.lon0) < 1e-6 && Math.abs(a.lat0 - b.lat0) < 1e-6 && Math.abs(a.step - b.step) < 1e-9;

/** adds one hourly analysis grid { t, lon0, lat0, step, nx, ny, values (µg/m³ or null) } to a day document; returns false when
 *  that hour is already in it (a second run in the same hour) or the grid differs (then the day starts again) */
export function addHour(doc, ana) {
  const hourKey = Math.round(ana.t / H) * H;
  if (!doc || !sameGrid(doc, ana)) doc = Object.assign(doc || {}, { day: thaiDay(ana.t), lon0: ana.lon0, lat0: ana.lat0, step: ana.step, nx: ana.nx, ny: ana.ny, hours: [], sum: new Array(ana.nx * ana.ny).fill(0) });
  if (doc.hours.includes(hourKey)) return false;
  for (let q = 0; q < doc.sum.length; q++) { const v = ana.values[q]; if (doc.sum[q] < 0) continue; doc.sum[q] = v == null || !(v >= 0) ? -1 : Math.round((doc.sum[q] + v) * 10) / 10; }
  doc.hours.push(hourKey); return true;
}
/** mean of the day documents (complete days, same grid as the first): { from, to, days, step…, values ×10 integers, −1 = none } */
export function meanOf(docs) {
  const ok = docs.filter(d => d.hours.length >= PMM.minHours); if (!ok.length) return null;
  const g = ok[0], use = ok.filter(d => sameGrid(d, g)), n = g.nx * g.ny, acc = new Float64Array(n), cnt = new Uint16Array(n);
  for (const d of use) { const h = d.hours.length; for (let q = 0; q < n; q++) { const s = d.sum[q]; if (s >= 0) { acc[q] += s / h; cnt[q]++; } } }
  const values = new Array(n); for (let q = 0; q < n; q++) values[q] = cnt[q] ? Math.round(acc[q] / cnt[q] * 10) : -1;
  const days = use.map(d => d.day).sort();
  return { from: days[0], to: days.at(-1), days: days.length, lon0: g.lon0, lat0: g.lat0, step: g.step, nx: g.nx, ny: g.ny, scale: 10, values };
}
/** stores this run's analysis and rewrites the published means; never throws (returns a log line) */
export async function updatePmMean(histDir, outFile, ana, now = Date.now()) {
  try {
    if (ana) {
      const day = thaiDay(ana.t), f = path.join(histDir, day.slice(0, 7), `pmday-${day.replace(/-/g, '')}.json`);
      const doc = JSON.parse(await fs.readFile(f, 'utf8').catch(() => 'null'));
      const d2 = doc || {}; if (addHour(d2, ana)) { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(d2)); }
    }
    const today = thaiDay(now), files = [];
    for (const m of await fs.readdir(histDir).catch(() => [])) for (const x of await fs.readdir(path.join(histDir, m)).catch(() => []))
      if (/^pmday-\d{8}\.json$/.test(x) && x.slice(6, 14) < today.replace(/-/g, '')) files.push(path.join(histDir, m, x));
    files.sort().reverse();   // newest first
    const docs = []; for (const f of files.slice(0, PMM.month)) { try { docs.push(JSON.parse(await fs.readFile(f, 'utf8'))); } catch (e) { /* skip a broken file */ } }
    const full = docs.filter(d => d.hours?.length >= PMM.minHours);
    const week = meanOf(full.slice(0, PMM.week)), month = meanOf(full.slice(0, PMM.month));
    await fs.writeFile(outFile, JSON.stringify({ version: 1, generated: now, basis: 'hourly analysis (CAMS x station bias field), 0.05 deg', week, month }));
    return `weekly / monthly mean maps: ${full.length} complete day(s) stored; week ${week ? week.days + ' d to ' + week.to : 'none'}, month ${month ? month.days + ' d' : 'none'}`;
  } catch (e) { return `weekly / monthly mean maps failed: ${e.message}`; }
}

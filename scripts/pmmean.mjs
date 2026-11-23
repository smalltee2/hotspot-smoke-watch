// Daily, weekly and monthly mean PM2.5 maps (the "Save image" button): yesterday (00–24 h Thai time), last week (Monday–Sunday)
// and last calendar month, all as Thai dates.
// Every CAMS run adds its hourly analysis (the RK map at the analysis hour: hourly CAMS × the station bias field, on a 0.05° grid)
// to the file of its Thai day, data/history/YYYY-MM/pmday-YYYYMMDD.json (running sum + hour count; kept 35 days on the history
// branch like the other logs). data/pm-mean.json (published) holds the mean of yesterday, of last week's days and of last month's days (days
// with >= minHours analysed hours). A finished month is also written once to data/history/YYYY-MM/pmmonth-YYYYMM.json (no 8-digit
// date in the name, so the 35-day pruning keeps it) while all its days are still stored; later runs read that file.
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
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
/** yesterday, last week (Monday–Sunday) and last calendar month, as Thai dates, for the Thai date of now */
export function periods(now) {
  const today = thaiDay(now), wd = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;   // Monday = 0
  const wFrom = addDays(today, -wd - 7), wTo = addDays(wFrom, 6);
  const m0 = today.slice(0, 7) + '-01', mTo = addDays(m0, -1), mFrom = mTo.slice(0, 7) + '-01';
  const y = addDays(today, -1);
  return { day: { from: y, to: y, want: 1 }, week: { from: wFrom, to: wTo, want: 7 }, month: { month: mTo.slice(0, 7), from: mFrom, to: mTo, want: +mTo.slice(8, 10) } };
}
const readJ = async f => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch (e) { return null; } };
/** stores this run's analysis and rewrites the published means; never throws (returns a log line) */
export async function updatePmMean(histDir, outFile, ana, now = Date.now()) {
  try {
    if (ana) {
      const day = thaiDay(ana.t), f = path.join(histDir, day.slice(0, 7), `pmday-${day.replace(/-/g, '')}.json`);
      const d2 = (await readJ(f)) || {}; if (addHour(d2, ana)) { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(d2)); }
    }
    const P = periods(now), files = [];
    for (const m of await fs.readdir(histDir).catch(() => [])) for (const x of await fs.readdir(path.join(histDir, m)).catch(() => []))
      if (/^pmday-\d{8}\.json$/.test(x)) files.push({ f: path.join(histDir, m, x), day: `${x.slice(6, 10)}-${x.slice(10, 12)}-${x.slice(12, 14)}` });
    const load = async (from, to) => { const out = []; for (const x of files) if (x.day >= from && x.day <= to) { const d = await readJ(x.f); if (d?.hours) out.push(d); } return out; };
    const day = meanOf(await load(P.day.from, P.day.to)), week = meanOf(await load(P.week.from, P.week.to));
    // last month: its saved file, else from the day files (then saved, once, while all its days are still kept)
    const mf = path.join(histDir, P.month.month, `pmmonth-${P.month.month.replace('-', '')}.json`);
    let month = await readJ(mf);
    if (!month) { month = meanOf(await load(P.month.from, P.month.to)); if (month) { await fs.mkdir(path.dirname(mf), { recursive: true }); await fs.writeFile(mf, JSON.stringify(month)); } }
    const wrap = (m, p) => m ? { ...m, ...p, days: m.days, from: p.from, to: p.to, firstDay: m.from, lastDay: m.to } : null;
    await fs.writeFile(outFile, JSON.stringify({ version: 2, generated: now, basis: 'hourly analysis (CAMS x station bias field), 0.05 deg', day: wrap(day, P.day), week: wrap(week, P.week), month: wrap(month, P.month) }));
    return `daily / weekly / monthly mean maps: ${files.length} day file(s); yesterday ${P.day.from}: ${day ? 'yes' : 'no data'}; last week ${P.week.from}..${P.week.to}: ${week ? week.days + ' of 7 days' : 'no data'}; last month ${P.month.month}: ${month ? month.days + ' of ' + P.month.want + ' days' : 'no data'}`;
  } catch (e) { return `daily / weekly / monthly mean maps failed: ${e.message}`; }
}

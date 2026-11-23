// Ask SEA-HAF: the Amazon MASSIVE rows used as training data of the topic classifier (chat/data/massive.json), made once by hand:
//   curl -sSO https://amazon-massive-nlu-dataset.s3.amazonaws.com/amazon-massive-dataset-1.1.tar.gz   (in a scratch folder)
//   tar xzf amazon-massive-dataset-1.1.tar.gz 1.1/data/th-TH.jsonl 1.1/data/en-US.jsonl
//   node scripts/chat_massive.mjs <that folder>/1.1/data
// MASSIVE 1.1 (FitzGerald et al. 2022, Amazon.com Inc. or its affiliates), licence CC BY 4.0; the rows are kept as published apart
// from removing the wake word "olly". Its intents map to ours: weather_query -> wx, general_greet -> hi, every other intent -> other
// (assistant requests outside dust, fire and weather: alarms, music, news, recipes, ...). Rows that mention dust, smoke, fog, fire
// or air quality are left out, as they may belong to our other topics. "other" is sampled evenly over MASSIVE's intents.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OURS = /ฝุ่น|ควัน|หมอก|ไฟ|เผา|มลพิษ|คุณภาพอากาศ|pm ?2|aqi|dust|smoke|smog|haze|fog|mist|fire|burn|pollut|air quality/i;
const N_OTHER = { 'th-TH': 1400, 'en-US': 350 }, N_WX = { 'th-TH': 900, 'en-US': 250 };
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }
function shuffle(a, r) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
/** MASSIVE jsonl rows of one locale -> [{q, y}] */
export function mapMassive(rows, locale, seed = 5) {
  const r = rng(seed), clean = s => String(s).replace(/\bolly\b[,]?/gi, ' ').replace(/\s+/g, ' ').trim();
  const ok = rows.map(x => ({ ...x, utt: clean(x.utt) })).filter(x => x.utt.length >= 2 && !OURS.test(x.utt));
  const wx = shuffle(ok.filter(x => x.intent === 'weather_query'), r).slice(0, N_WX[locale] ?? 300).map(x => ({ q: x.utt, y: 'wx' }));
  const hi = ok.filter(x => x.intent === 'general_greet').map(x => ({ q: x.utt, y: 'hi' }));
  const by = new Map(); for (const x of ok) if (x.intent !== 'weather_query' && x.intent !== 'general_greet') (by.get(x.intent) || by.set(x.intent, []).get(x.intent)).push(x);
  const lists = [...by.values()].map(a => shuffle(a, r)), other = [], want = N_OTHER[locale] ?? 400;
  for (let i = 0; other.length < want && lists.some(a => i < a.length); i++) for (const a of lists) if (i < a.length && other.length < want) other.push({ q: a[i].utt, y: 'other' });   // round robin: every intent gets a share
  const seen = new Set(); return [...wx, ...hi, ...other].filter(x => { const k = x.y + '|' + x.q.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]; if (!dir) { console.log('usage: node scripts/chat_massive.mjs <folder with th-TH.jsonl and en-US.jsonl>'); process.exit(1); }
  const out = [];
  for (const loc of ['th-TH', 'en-US']) { const rows = fs.readFileSync(path.join(dir, `${loc}.jsonl`), 'utf8').trim().split('\n').map(l => JSON.parse(l)); const m = mapMassive(rows, loc); out.push(...m);
    const c = {}; m.forEach(x => c[x.y] = (c[x.y] || 0) + 1); console.log(`${loc}: ${rows.length} rows -> ${m.length}`, c); }
  const f = path.join(ROOT, 'chat', 'data', 'massive.json'); fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '[\n' + out.map(x => JSON.stringify(x)).join(',\n') + '\n]\n');
  console.log(`wrote ${path.relative(ROOT, f)}: ${out.length} rows (MASSIVE 1.1, CC BY 4.0)`);
}

// Builds the redesigned page (published at /index_modern.html) from two sources:
//   index_modern.html  the redesign: <head>, styles and page markup
//   index.html         the page code (everything from the first <script> after the styles), so every fix and feature of the
//                      original page reaches the redesign automatically
// The code is taken from index.html only when the redesign has every element id of index.html (the code finds the page by id);
// otherwise index_modern.html is published as it is, with a warning, until its markup is brought up to date. Extra elements in the
// redesign are allowed: features used only there (e.g. #btnLegToggle) check that their element exists.
// Run: node scripts/build_modern.mjs index.html index_modern.html <out.html>
import fs from 'node:fs';
const [orig, modern, out] = process.argv.slice(2);
const A = fs.readFileSync(orig, 'utf8'), B = fs.readFileSync(modern, 'utf8');
const split = s => { const i = s.indexOf('<script>', s.indexOf('</style>')); if (i < 0) throw new Error('no page code found'); return [s.slice(0, i), s.slice(i)]; };
const [aMark, aCode] = split(A), [bMark, bCode] = split(B);
const ids = s => new Set([...s.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const ia = ids(aMark), ib = ids(bMark), miss = [...ia].filter(x => !ib.has(x)), extra = [...ib].filter(x => !ia.has(x));
if (miss.length) {
  fs.writeFileSync(out, B);
  const msg = `index_modern.html published as it is: its markup differs from index.html (missing ids: ${miss.join(' ') || '-'}; extra ids: ${extra.join(' ') || '-'})`;
  console.log(msg); if (process.env.GITHUB_ACTIONS) console.log(`::warning title=redesigned page::${msg}`);
} else {
  fs.writeFileSync(out, bMark + aCode);
  console.log(`index_modern.html built: redesign markup + current page code${aCode === bCode ? ' (unchanged)' : ' (code updated from index.html)'}${extra.length ? `; ids only in the redesign: ${extra.join(' ')}` : ''}`);
}

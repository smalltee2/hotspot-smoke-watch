// Thai province borders of the page (the "geoProv" data block of index.html and of index_modern.html), built once by hand so that they coincide with the
// district and sub-district borders (data/static/th-adm2.json, th-adm3.json; scripts/admin_bounds.mjs). Before 27 Nov 2026 the
// Thai provinces came from the World Bank set like the neighbouring countries', and a chosen province's outline did not sit on
// its districts' borders. The provinces are the districts dissolved, with no further simplification:
//   mapshaper -i data/static/th-adm2.json -dissolve2 pen copy-fields=pth -o adm1.json format=geojson precision=0.0001
//   node scripts/province_bounds.mjs adm1.json index.html
//   node scripts/province_bounds.mjs adm1.json index_modern.html
// Run it on both pages: the block sits in the markup part, before the page code, which build_modern.mjs does not copy over.
// Only the geometry of the 77 Thai features changes; their names (n, th) and order stay, as the page's lists (REGION_PROV,
// saved choices) use them. Other countries' provinces stay World Bank. Source and licence as for the districts (RTSD 2022 via
// OCHA COD-AB, CC BY-IGO).
import fs from 'node:fs';
const [src, html] = process.argv.slice(2); if (!src || !html) { console.error('usage: node scripts/province_bounds.mjs adm1.json index.html'); process.exit(1); }
const NAME = { Phangnga: 'Phang Nga', 'Lop Buri': 'Lopburi' };   // OCHA spelling -> the page's
const A = new Map(JSON.parse(fs.readFileSync(src, 'utf8')).features.map(f => [NAME[f.properties.pen] || f.properties.pen, f.geometry]));
// rings of fewer than 4 points and holes smaller than about 1 km² (dissolve slivers) are dropped
const area = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
const clean = g => { const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(pg => pg.filter((r, i) => r.length >= 4 && (i === 0 || area(r) > 1e-4))).filter(pg => pg.length);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }; };
let s = fs.readFileSync(html, 'utf8');
const m = /(<script[^>]*id="geoProv"[^>]*>)([\s\S]*?)(<\/script>)/.exec(s); if (!m) throw new Error('no geoProv block in ' + html);
const J = JSON.parse(m[2]); let n = 0;
for (const f of J.features) { if (f.properties.c !== 'THA') continue; const g = A.get(f.properties.n); if (!g) throw new Error('no dissolved province for ' + f.properties.n); f.geometry = clean(g); n++; }
if (n !== 77 || A.size !== 77) throw new Error(`expected 77 provinces, replaced ${n} of ${A.size}`);
s = s.slice(0, m.index) + m[1] + JSON.stringify(J) + m[3] + s.slice(m.index + m[0].length);
fs.writeFileSync(html, s); console.log(html, n, 'Thai provinces replaced; geoProv', (JSON.stringify(J).length / 1024).toFixed(0), 'KB');

// District (amphoe, ADM2) and sub-district (tambon, ADM3) boundaries of Thailand for the page, built once by hand:
//   node scripts/admin_bounds.mjs <th_adm2.geojson> <th_adm3.geojson>
// Input: OCHA COD-AB Thailand (Royal Thai Survey Department, 2019; CC BY-IGO), as simplified (Visvalingam, mapshaper) in the
// mapthai package (github.com/piyayut-ch/mapthai, data-raw/geojson, MIT). Output: data/static/th-adm2.json and th-adm3.json,
// GeoJSON with short properties (c: P-code, en / th: name, pen / pth: province, den / dth: district for ADM3) and coordinates
// rounded to 4 decimals (~11 m), consecutive repeats dropped. Keep the attribution (the page and README cite it).
import fs from 'node:fs';
const [a2, a3] = process.argv.slice(2); if (!a2 || !a3) { console.error('usage: node scripts/admin_bounds.mjs th_adm2.geojson th_adm3.geojson'); process.exit(1); }
const r4 = v => Math.round(v * 1e4) / 1e4;
const ring = r => { const out = []; for (const [x, y] of r) { const p = [r4(x), r4(y)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); } return out.length >= 4 ? out : null; };
const geom = g => { const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(pg => pg.map(ring).filter(Boolean)).filter(pg => pg.length);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }; };
const ATTR = 'Administrative boundaries: Royal Thai Survey Department (2019) via OCHA HDX COD-AB Thailand, CC BY-IGO; simplified by the mapthai package (MIT)';
for (const [src, out, lv] of [[a2, 'data/static/th-adm2.json', 2], [a3, 'data/static/th-adm3.json', 3]]) {
  const j = JSON.parse(fs.readFileSync(src, 'utf8'));
  const features = j.features.map(f => { const p = f.properties;
    const props = { c: p[`ADM${lv}_PCODE`], en: p[`ADM${lv}_EN`], th: p[`ADM${lv}_TH`], pen: p.ADM1_EN, pth: p.ADM1_TH, ...(lv === 3 ? { d: p.ADM2_PCODE, den: p.ADM2_EN, dth: p.ADM2_TH } : {}) };
    return { type: 'Feature', properties: props, geometry: geom(f.geometry) }; });
  fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', attribution: ATTR, level: lv, features }));
  console.log(out, features.length, 'features', (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
}

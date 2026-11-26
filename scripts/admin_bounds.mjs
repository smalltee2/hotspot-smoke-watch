// District (amphoe, ADM2) and sub-district (tambon, ADM3) boundaries of Thailand for the page, built once by hand:
//   node scripts/admin_bounds.mjs <adm2.geojson> <adm3.geojson>
// Input (since 26 Nov 2026): OCHA COD-AB Thailand tha_admbnda_adm3_rtsd_20220121 (Royal Thai Survey Department, 2022; CC BY-IGO)
// as extracted and simplified in github.com/prasertcbs/thailand_gis (tambon_simplify/…_geo.json), then with mapshaper 0.6:
//   mapshaper -i …adm3…_geo.json -simplify 60% keep-shapes -clean -o adm3.json format=geojson precision=0.0001
//   mapshaper -i adm3.json -dissolve2 ADM2_PCODE copy-fields=ADM2_EN,ADM2_TH,ADM1_EN,ADM1_TH,ADM1_PCODE -o adm2.json …
// (districts dissolved from the simplified sub-districts, so their borders coincide). The COD's Thai names are cut at 16
// characters; scripts/admin_names_fix.json (P-code -> full name, from the owner's RTSD shapefile and the English names) restores
// the 10 that were cut. Output: data/static/th-adm2.json and th-adm3.json,
// GeoJSON with short properties (c: P-code, en / th: name, pen / pth: province, den / dth: district for ADM3) and coordinates
// rounded to 4 decimals (~11 m), consecutive repeats dropped. Keep the attribution (the page and README cite it).
import fs from 'node:fs';
const [a2, a3] = process.argv.slice(2); if (!a2 || !a3) { console.error('usage: node scripts/admin_bounds.mjs th_adm2.geojson th_adm3.geojson'); process.exit(1); }
const r4 = v => Math.round(v * 1e4) / 1e4;
const ring = r => { const out = []; for (const [x, y] of r) { const p = [r4(x), r4(y)]; const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p); } return out.length >= 4 ? out : null; };
const geom = g => { const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(pg => pg.map(ring).filter(Boolean)).filter(pg => pg.length);
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }; };
const ATTR = 'Administrative boundaries: Royal Thai Survey Department (2022) via OCHA HDX COD-AB Thailand, CC BY-IGO; simplified (prasertcbs/thailand_gis, mapshaper)';
const FIX = JSON.parse(fs.readFileSync(new URL('./admin_names_fix.json', import.meta.url), 'utf8')), full = (code, th) => FIX[code] || th;
for (const [src, out, lv] of [[a2, 'data/static/th-adm2.json', 2], [a3, 'data/static/th-adm3.json', 3]]) {
  const j = JSON.parse(fs.readFileSync(src, 'utf8'));
  const features = j.features.map(f => { const p = f.properties;
    const props = { c: p[`ADM${lv}_PCODE`], en: p[`ADM${lv}_EN`], th: full(p[`ADM${lv}_PCODE`], p[`ADM${lv}_TH`]), pen: p.ADM1_EN, pth: p.ADM1_TH, ...(lv === 3 ? { d: p.ADM2_PCODE, den: p.ADM2_EN, dth: full(p.ADM2_PCODE, p.ADM2_TH) } : {}) };
    return { type: 'Feature', properties: props, geometry: geom(f.geometry) }; });
  fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', attribution: ATTR, level: lv, features }));
  console.log(out, features.length, 'features', (fs.statSync(out).size / 1e6).toFixed(2), 'MB');
}

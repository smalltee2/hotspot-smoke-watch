// Print out/SEA-HAF_manual.html to PDF with headless Chromium (MathML equations, Sarabun font).
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('file://' + path.resolve(__dirname, 'out/SEA-HAF_manual.html'), { waitUntil: 'load' });
  await p.pdf({ path: path.resolve(__dirname, 'out/SEA-HAF_manual.pdf'), format: 'A4', printBackground: true,
    displayHeaderFooter: true, headerTemplate: '<span></span>',
    footerTemplate: '<div style="font-size:8px;width:100%;text-align:center"><span class="pageNumber"></span></div>',
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' } });
  await b.close();
})();

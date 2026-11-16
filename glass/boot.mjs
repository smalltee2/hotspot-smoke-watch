// Glass menu frames of the redesigned page (index_modern.html only; loaded there as a module, so the classic and developer
// pages, which share the page code of index.html, are unaffected). The look itself is CSS ("Glass menu frames" in the
// page's styles); this file adds the motion (glass/nav.mjs) and, in the wide layout, the WebGL2 water (glass/water.mjs).
import { watchPill, watchCompact } from './nav.mjs';
import { startWater } from './water.mjs';

const B = document.body;
const phone = matchMedia('(max-width: 860px)');
const glassOK = CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');

// The pill: the side panel's tabs (computers) and the bottom tab bar (phones).
watchPill(document.querySelector('main > aside .tabs'), '[aria-selected="true"]');
watchPill(document.getElementById('tabbar'), '[aria-current="page"]');

// Phones: the bottom bar draws in while the sheet is read downwards. Never while the sheet is lowered to its peek.
const aside = document.querySelector('main > aside');
const compactOn = () => phone.matches && B.dataset.sheet !== 'peek';
const stopCompact = watchCompact(aside, (c) => B.classList.toggle('bar-compact', c), compactOn);
new MutationObserver(() => { if (!compactOn()) B.classList.remove('bar-compact'); }).observe(B, { attributes: true, attributeFilter: ['data-sheet'] });
phone.addEventListener('change', () => B.classList.remove('bar-compact'));
void stopCompact;

// Water: the wide layout only, not when transparency is turned down, and only where the CSS glass works too.
const wide = matchMedia('(min-width: 861px)');
const lessGlass = matchMedia('(prefers-reduced-transparency: reduce)');
let water = null;
function stopWater() {
  if (!water) return;
  water.stop?.();
  water.canvas.remove();
  B.classList.remove('water-on');
  water = null;
}
function syncWater() {
  const want = glassOK && wide.matches && !lessGlass.matches && !water?.lost;
  if (!want) { if (water && !water.lost) stopWater(); return; }
  if (water) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'water';
  canvas.setAttribute('aria-hidden', 'true');
  B.prepend(canvas);
  water = { canvas, lost: false, stop: null };
  const w = water;
  // shown only once the first frame is drawn (an undrawn canvas is black); a lost context hands the look back to the CSS glass
  w.stop = startWater(canvas, B, () => { if (water === w) B.classList.add('water-on'); }, () => { w.stop?.(); w.stop = null; B.classList.remove('water-on'); canvas.remove(); w.lost = true; });
  if (!w.stop) { canvas.remove(); water = { lost: true, canvas }; }
}
syncWater();
wide.addEventListener('change', syncWater);
lessGlass.addEventListener('change', syncWater);

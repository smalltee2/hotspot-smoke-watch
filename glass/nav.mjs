// Motion of the glass menu frames of the redesigned page (index_modern.html), ported from the SEEN prototype
// (seen-faculty-screening src/webapp/navGlass.ts, React hooks) to plain DOM watchers:
//   - one pill sits behind the chosen item of a menu and slides to the next one
//       computers: the side panel's tab row (.tabs, the chosen tab has aria-selected="true")
//       phones:    the bottom tab bar (#tabbar, the chosen button has aria-current="page")
//   - the phone's bottom bar draws in to its icons while the bottom sheet is read downwards and comes back on the way up.
// The pure parts (pillBox, placePill, nextCompact) are unit-tested in glass/glass.test.mjs.

/** Where the chosen item sits inside the menu, in the menu's own coordinates; null when none is shown (no item chosen, the
 *  chosen item is hidden, or the menu itself is hidden). `selector` picks the chosen item. */
export function pillBox(nav, selector) {
  const el = [...nav.querySelectorAll(selector)].find((x) => x.offsetParent !== null && x.offsetWidth > 0);
  return el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null;
}

/** Sets the pill's place on the menu (CSS custom properties --pill-x/y/w/h, read by the page's styles). The first placement is
 *  marked data-pill="first" so it does not slide in from the corner; later ones are "on" and slide. */
export function placePill(nav, box) {
  if (!box) { nav.removeAttribute('data-pill'); return; }
  for (const [k, v] of Object.entries(box)) nav.style.setProperty(`--pill-${k}`, `${v}px`);
  nav.setAttribute('data-pill', nav.hasAttribute('data-pill') ? 'on' : 'first');
}

/** Keeps the pill on the chosen item: when the choice changes (attributes), when the labels change (language switch) and when
 *  the menu is resized. Returns the stop function. */
export function watchPill(nav, selector) {
  if (!nav) return () => {};
  let queued = 0;
  const place = () => { queued = 0; placePill(nav, pillBox(nav, selector)); };
  const soon = () => { if (!queued) queued = requestAnimationFrame(place); };
  place();
  const mo = new MutationObserver(soon);
  mo.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'class', 'hidden', 'style'] });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null;
  ro?.observe(nav);
  for (const b of nav.children) ro?.observe(b);
  document.fonts?.ready?.then(soon);
  return () => { mo.disconnect(); ro?.disconnect(); if (queued) cancelAnimationFrame(queued); };
}

/** Whether the bottom bar is small: never near the top; small after moving down, full again after moving up; a few pixels of
 *  jitter change nothing. */
export function nextCompact(prev, y, lastY) {
  if (y < 80) return false;
  const dy = y - lastY;
  if (dy > 6) return true;
  if (dy < -6) return false;
  return prev;
}

/** Calls onChange(compact) as the scroller is read down or up (see nextCompact) while enabled() is true; false otherwise.
 *  Returns the stop function. */
export function watchCompact(scroller, onChange, enabled) {
  if (!scroller) return () => {};
  let compact = false, last = scroller.scrollTop;
  const set = (v) => { if (v !== compact) { compact = v; onChange(v); } };
  const on = () => {
    const y = scroller.scrollTop;
    if (!enabled()) { set(false); last = y; return; }
    set(nextCompact(compact, y, last));
    if (Math.abs(y - last) > 6) last = y;
  };
  scroller.addEventListener('scroll', on, { passive: true });
  return () => { scroller.removeEventListener('scroll', on); set(false); };
}

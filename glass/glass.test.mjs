// Unit tests of the glass menu frames: node --test glass/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillBox, placePill, nextCompact } from './nav.mjs';
import { cssRgb, paneOf, measurePanes, MAX_PANES, PANE_SELECTOR } from './water.mjs';

/** The few element features placePill uses. */
function fakeNav() {
  const props = new Map(), attrs = new Map();
  return {
    props, attrs,
    el: {
      style: { setProperty: (k, v) => void props.set(k, v) },
      setAttribute: (k, v) => void attrs.set(k, v),
      removeAttribute: (k) => void attrs.delete(k),
      hasAttribute: (k) => attrs.has(k),
    },
  };
}
const item = (x, w, shown = true) => ({ offsetLeft: x, offsetTop: 4, offsetWidth: shown ? w : 0, offsetHeight: shown ? 30 : 0, offsetParent: shown ? {} : null });

test('pill: measures the chosen item that is shown', () => {
  const asked = [];
  const nav = { querySelectorAll: (s) => { asked.push(s); return [item(0, 60, false), item(68, 72)]; } };
  assert.deepEqual(pillBox(nav, '[aria-selected="true"]'), { x: 68, y: 4, w: 72, h: 30 });
  assert.deepEqual(asked, ['[aria-selected="true"]']);
});
test('pill: none when no chosen item is shown', () => {
  assert.equal(pillBox({ querySelectorAll: () => [] }, 'x'), null);
  assert.equal(pillBox({ querySelectorAll: () => [item(10, 50, false)] }, 'x'), null);
});
test('pill: placed on the chosen item; the first placement does not slide', () => {
  const n = fakeNav();
  placePill(n.el, { x: 10, y: 0, w: 70, h: 52 });
  assert.equal(n.attrs.get('data-pill'), 'first');
  assert.equal(n.props.get('--pill-x'), '10px');
  assert.equal(n.props.get('--pill-w'), '70px');
  assert.equal(n.props.get('--pill-h'), '52px');
  placePill(n.el, { x: 90, y: 0, w: 70, h: 52 });
  assert.equal(n.attrs.get('data-pill'), 'on');
  assert.equal(n.props.get('--pill-x'), '90px');
});
test('pill: hidden when no item is chosen', () => {
  const n = fakeNav();
  placePill(n.el, { x: 10, y: 0, w: 70, h: 52 });
  placePill(n.el, null);
  assert.equal(n.attrs.has('data-pill'), false);
  placePill(n.el, { x: 10, y: 0, w: 70, h: 52 });
  assert.equal(n.attrs.get('data-pill'), 'first');   // shown again: no slide from the old place
});
test('bottom bar: small on the way down, full on the way up, never near the top', () => {
  assert.equal(nextCompact(false, 40, 0), false);
  assert.equal(nextCompact(true, 79, 300), false);
  assert.equal(nextCompact(false, 200, 150), true);
  assert.equal(nextCompact(true, 203, 200), true);    // jitter keeps the state
  assert.equal(nextCompact(false, 197, 200), false);
  assert.equal(nextCompact(true, 150, 200), false);
  assert.equal(nextCompact(false, 207, 200), true);
});

test('colours: computed colours in the forms browsers return', () => {
  assert.deepEqual(cssRgb('rgb(40, 58, 120)'), [40 / 255, 58 / 255, 120 / 255]);
  assert.deepEqual(cssRgb('rgba(255, 255, 255, 0.5)'), [1, 1, 1]);
  assert.deepEqual(cssRgb('rgb(40 58 120 / 0.5)'), [40 / 255, 58 / 255, 120 / 255]);
  assert.deepEqual(cssRgb('color(srgb 0.1 0.3 0.2)'), [0.1, 0.3, 0.2]);
  assert.deepEqual(cssRgb('  color(srgb 1 0.5 0 / 0.4) '), [1, 0.5, 0]);
  assert.equal(cssRgb(''), null);
  assert.equal(cssRgb(undefined), null);
  assert.equal(cssRgb('transparent'), null);
});
test('panes: from a box; the corner radius is at most half the shorter side', () => {
  const box = { left: 12, top: 68, width: 380, height: 800 };
  assert.deepEqual(paneOf(box, '26px', '0.8'), { x: 12, y: 68, w: 380, h: 800, r: 26, f: 0.8 });
  assert.equal(paneOf({ left: 0, top: 0, width: 38, height: 38 }, '50%').r, 19);
  assert.equal(paneOf({ left: 0, top: 0, width: 120, height: 32 }, '9999px').r, 16);
  assert.equal(paneOf(box, '').r, 0);
  assert.equal(paneOf(box, '26px').f, 0.44);          // no --water-fill: the prototype's fill
  assert.equal(paneOf(box, '26px', ' 1.7').f, 1);     // clamped to 0–1
});
test('panes: an element that is not shown is left out', () => {
  assert.equal(paneOf({ left: 0, top: 0, width: 0, height: 0 }, '26px'), null);
  assert.equal(paneOf({ left: 0, top: 0, width: 40, height: 0 }, '26px'), null);
});
test('panes: measured from the page, hidden ones skipped, at most MAX_PANES', () => {
  const el = (w, vis = 'visible', disp = 'block') => ({ rect: { left: 1, top: 2, width: w, height: 30 }, getBoundingClientRect() { return this.rect; }, cs: { visibility: vis, display: disp, borderTopLeftRadius: '9999px', getPropertyValue: () => '0.6' } });
  const els = [el(380, 'hidden'), el(90), el(0), el(60, 'visible', 'none'), ...Array.from({ length: 12 }, () => el(40))];
  let asked = '';
  const root = { querySelectorAll: (s) => { asked = s; return els; } };
  const out = measurePanes(root, (e) => e.cs);
  assert.equal(asked, PANE_SELECTOR);
  assert.equal(out.length, MAX_PANES);
  assert.deepEqual(out[0], { x: 1, y: 2, w: 90, h: 30, r: 15, f: 0.6 });
});

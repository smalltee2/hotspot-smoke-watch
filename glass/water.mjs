// Water and glass drawn with WebGL2 behind the redesigned page (index_modern.html), computers and tablets in the wide layout
// only (> 860 px), ported from the SEEN prototype (seen-faculty-screening src/webapp/waterGlass.ts).
// A shader cannot read the page's HTML, so it bends only what it draws itself: slow indigo-and-slate "water" behind the window
// (the page's ink and smoke colours; orange stays for fire data). The side panel and the round buttons of the header are panes
// of glass over that water: their rims bend it like a thick pane (rounded-rect SDF), and a highlight follows the pointer.
// The map and everything on phones are HTML and are untouched. One fragment shader, no texture, no library.
// Drawing stops IDLE_MS after the last movement, while the tab is hidden, and under "reduce motion" (one still frame).
// Without WebGL2, or when the context is lost, the CSS glass of the page stays (startWater returns null / calls onLost).
// The pure parts (cssRgb, paneOf, measurePanes) are unit-tested in glass/glass.test.mjs.

/** Glass panes the shader can draw at once. */
export const MAX_PANES = 8;
/** Panes, in the order they are drawn: the side panel, then the header's buttons. */
export const PANE_SELECTOR = 'main > aside, header .status > .btn';
/** Drawing goes on this long after the last movement. */
export const IDLE_MS = 4000;
/** Drawing resolution limit (device pixels per CSS pixel). */
export const MAX_DPR = 1.5;

/** "rgb(40, 58, 120)", "rgba(…)" or "color(srgb 0.1 0.3 0.2)" → [r, g, b] in 0–1; null when unreadable. */
export function cssRgb(s) {
  const t = String(s ?? '').trim();
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(t);
  if (srgb) return [Number(srgb[1]), Number(srgb[2]), Number(srgb[3])];
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
  return m ? [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] : null;
}

/** A pane from an element's box and its corner radius ("26px", "50%", "9999px"): the radius never exceeds half the shorter
 *  side; boxes with no size (hidden elements) are left out. `fill` is how much of the panel colour covers the water inside
 *  (0–1, from the element's --water-fill; default 0.44 as in the prototype). */
export function paneOf(box, radius, fill = '') {
  if (!(box.width > 0 && box.height > 0)) return null;
  const half = Math.min(box.width, box.height) / 2;
  const n = parseFloat(radius);
  const r = !Number.isFinite(n) ? 0 : String(radius).trim().endsWith('%') ? (half * 2 * n) / 100 : n;
  const f = parseFloat(fill);
  return { x: box.left, y: box.top, w: box.width, h: box.height, r: Math.max(0, Math.min(half, r)), f: Number.isFinite(f) ? Math.max(0, Math.min(1, f)) : 0.44 };
}

/** The panes shown on the page, at most MAX_PANES; elements that are hidden (visibility) or have no size are left out.
 *  `style` is getComputedStyle (replaceable in tests). */
export function measurePanes(root, style = (el) => getComputedStyle(el)) {
  const out = [];
  for (const el of root.querySelectorAll(PANE_SELECTOR)) {
    const cs = style(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const p = paneOf(el.getBoundingClientRect(), cs.borderTopLeftRadius, cs.getPropertyValue('--water-fill'));
    if (p) out.push(p);
    if (out.length === MAX_PANES) break;
  }
  return out;
}

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;      // window, CSS px
uniform float uDpr, uTime, uDark;
uniform vec2 uPtr;      // pointer, CSS px
uniform vec3 uBase, uA, uB, uPanel;
uniform vec4 uRect[${MAX_PANES}];
uniform float uRad[${MAX_PANES}];
uniform float uFill[${MAX_PANES}];
uniform int uN;

float blob(vec2 p, vec2 c, vec2 r) { vec2 d = (p - c) / r; return exp(-dot(d, d) * 1.6); }

// The water: three soft pools of colour that drift, warped slowly, with faint bands of light.
vec3 field(vec2 p) {
  float t = uTime;
  float asp = uRes.x / uRes.y;
  vec2 w = p / uRes; w.x *= asp;
  w += 0.035 * vec2(sin(w.y * 3.1 + t * 0.21) + 0.5 * sin(w.y * 7.3 - t * 0.17), cos(w.x * 2.7 - t * 0.19) + 0.5 * cos(w.x * 6.1 + t * 0.13));
  float a1 = blob(w, vec2(-0.05 + 0.05 * sin(t * 0.11), -0.08), vec2(0.75, 0.62));
  float b1 = blob(w, vec2(0.05, 1.08 + 0.04 * cos(t * 0.09)), vec2(0.6, 0.5));
  float a2 = blob(w, vec2(asp * 1.05, -0.05 + 0.05 * sin(t * 0.07 + 1.0)), vec2(0.7, 0.5));
  float sa = mix(0.26, 0.17, uDark), sb = mix(0.22, 0.15, uDark);
  vec3 c = uBase;
  c = mix(c, uA, sa * a1); c = mix(c, uB, sb * b1); c = mix(c, uA, sa * 0.85 * a2);
  float k = sin(w.x * 9.0 + sin(w.y * 5.0 + t * 0.25) * 1.6 + t * 0.12) * sin(w.y * 8.0 - sin(w.x * 4.0 - t * 0.2) * 1.4);
  k = smoothstep(0.55, 1.0, k);
  c += mix(0.05, 0.03, uDark) * k * (a1 + b1 + a2 + 0.25);
  return c;
}

float sdRR(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 col = field(p);
  for (int i = 0; i < ${MAX_PANES}; i++) {
    if (i >= uN) break;
    vec2 hb = uRect[i].zw * 0.5;
    vec2 q = p - (uRect[i].xy + hb);
    float r = uRad[i];
    float d = sdRR(q, hb, r);
    if (d < 0.0) {
      // Inside a pane: the rim bends the water like the edge of a thick pane.
      // A small pane (a round button) has a thin rim, or it would be all highlight.
      float bez = min(26.0, min(hb.x, hb.y) * 0.5);
      float e = 1.0 - clamp(-d / bez, 0.0, 1.0);
      float e3 = e * e * e;
      vec2 n = normalize(vec2(sdRR(q + vec2(1.0, 0.0), hb, r) - sdRR(q - vec2(1.0, 0.0), hb, r), sdRR(q + vec2(0.0, 1.0), hb, r) - sdRR(q - vec2(0.0, 1.0), hb, r)) + 1e-5);
      vec3 g = field(p - n * e3 * bez * 2.2);
      g.r = field(p - n * e3 * bez * 2.6).r; // the colours part slightly at the rim
      // how much of the panel colour covers the water: the pane's own fill inside, a little less on the rim
      g = mix(g, uPanel, mix(uFill[i], uFill[i] * 0.68, e));
      vec2 l = normalize(uPtr - p + 1e-3);
      g += mix(0.35, 0.10, uDark) * pow(max(dot(n, l), 0.0), 2.0) * e3;
      g += mix(0.22, 0.06, uDark) * max(dot(n, vec2(0.0, -1.0)), 0.0) * e3;
      g -= 0.045 * max(dot(n, vec2(0.0, 1.0)), 0.0) * e3;
      g += mix(0.30, 0.10, uDark) * smoothstep(1.5, 0.0, -d);
      col = g;
    } else {
      col *= 1.0 - mix(0.07, 0.25, uDark) * exp(-d / 14.0);
    }
  }
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
  console.warn('[water] shader:', gl.getShaderInfoLog(s));
  return null;
}

/** Starts drawing on `canvas` for the page `root` (document.body). Returns the stop function, or null when WebGL2 or the
 *  shader is not available (the page then keeps its CSS glass). `onDrawn` is called after the first frame is on the canvas
 *  (a tab opened in the background draws nothing until it is shown, and an undrawn canvas is black); `onLost` if the browser
 *  takes the context away later. */
export function startWater(canvas, root, onDrawn, onLost) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn('[water] program:', gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(prog, name);
  const U = { res: u('uRes'), dpr: u('uDpr'), time: u('uTime'), dark: u('uDark'), ptr: u('uPtr'), base: u('uBase'), a: u('uA'), b: u('uB'), panel: u('uPanel'), rect: u('uRect'), rad: u('uRad'), fill: u('uFill'), n: u('uN') };

  // The theme's colours, read through a hidden element so var() and color-mix() are resolved.
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
  root.appendChild(probe);
  const colour = (v, fallback) => { probe.style.color = ''; probe.style.color = v; return cssRgb(getComputedStyle(probe).color) ?? fallback; };
  let colours;
  const readColours = () => {
    const base = colour('var(--bg)', [0.973, 0.98, 0.988]);
    colours = { base, a: colour('var(--ink)', [0.157, 0.227, 0.47]), b: colour('var(--smoke)', [0.278, 0.333, 0.412]), panel: colour('var(--panel)', [1, 1, 1]), dark: base[0] + base[1] + base[2] < 1.2 ? 1 : 0 };
  };
  readColours();

  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  const ptr = { x: 260, y: -200, tx: 260, ty: -200 };
  let time = 0, last = 0, until = 0, frame = 0, stopped = false, drawn = false;

  const draw = (now) => {
    frame = 0;
    if (stopped || document.hidden || gl.isContextLost()) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = window.innerWidth, h = window.innerHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (!still.matches) {
      time += last ? Math.min(0.1, (now - last) / 1000) : 0;
      ptr.x += (ptr.tx - ptr.x) * 0.12;
      ptr.y += (ptr.ty - ptr.y) * 0.12;
    } else { ptr.x = ptr.tx; ptr.y = ptr.ty; }
    last = now;
    const panes = measurePanes(root);
    const rect = new Float32Array(MAX_PANES * 4), rad = new Float32Array(MAX_PANES), fill = new Float32Array(MAX_PANES);
    panes.forEach((p, i) => { rect.set([p.x, p.y, p.w, p.h], i * 4); rad[i] = p.r; fill[i] = p.f; });
    gl.uniform2f(U.res, w, h);
    gl.uniform1f(U.dpr, dpr);
    gl.uniform1f(U.time, time);
    gl.uniform1f(U.dark, colours.dark);
    gl.uniform2f(U.ptr, ptr.x, ptr.y);
    gl.uniform3fv(U.base, colours.base);
    gl.uniform3fv(U.a, colours.a);
    gl.uniform3fv(U.b, colours.b);
    gl.uniform3fv(U.panel, colours.panel);
    gl.uniform4fv(U.rect, rect);
    gl.uniform1fv(U.rad, rad);
    gl.uniform1fv(U.fill, fill);
    gl.uniform1i(U.n, panes.length);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!drawn) { drawn = true; onDrawn(); }
    if (!still.matches && now < until) frame = requestAnimationFrame(draw);
    else last = 0;
  };
  /** Something moved: draw, and keep drawing for a while. */
  const kick = () => { until = performance.now() + IDLE_MS; if (!frame && !stopped) frame = requestAnimationFrame(draw); };
  // under "reduce motion" the picture stays still: the highlight does not follow the pointer (only a change of layout or theme
  // draws the one still frame again)
  const onPointer = (e) => { if (still.matches) return; ptr.tx = e.clientX; ptr.ty = e.clientY; kick(); };
  const onTheme = () => { readColours(); kick(); };
  const onContextLost = (e) => { e.preventDefault(); onLost(); };
  const themeWatch = new MutationObserver(onTheme);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'lang'] });
  const scheme = window.matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', onTheme);
  const sizeWatch = typeof ResizeObserver === 'function' ? new ResizeObserver(kick) : null;
  sizeWatch?.observe(root);
  for (const el of root.querySelectorAll('header, header .status, main > aside')) sizeWatch?.observe(el);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('resize', kick);
  window.addEventListener('keydown', kick);
  document.addEventListener('scroll', kick, { passive: true, capture: true });
  document.addEventListener('visibilitychange', kick);
  root.addEventListener('transitionend', kick);
  canvas.addEventListener('webglcontextlost', onContextLost);
  kick();

  return () => {
    stopped = true;
    if (frame) cancelAnimationFrame(frame);
    themeWatch.disconnect();
    scheme.removeEventListener('change', onTheme);
    sizeWatch?.disconnect();
    window.removeEventListener('pointermove', onPointer);
    window.removeEventListener('resize', kick);
    window.removeEventListener('keydown', kick);
    document.removeEventListener('scroll', kick, { capture: true });
    document.removeEventListener('visibilitychange', kick);
    root.removeEventListener('transitionend', kick);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    probe.remove();
  };
}

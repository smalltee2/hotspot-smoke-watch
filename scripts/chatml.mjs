// Ask SEA-HAF: the question classifier (which topic a question is about). Character n-grams (2–4, so Thai without spaces and
// typos still match) hashed into DIM buckets, binary, L2-normalised; then either multinomial logistic regression (kind linear,
// weights int8 with one scale per topic) or a small neural network (kind mlp: one hidden layer of ReLU units, the input weights int8
// with one scale per unit), trained by SGD (chat/model.json; scripts/chat_train.mjs picks the kind on its development set). The page has the same featurize / predict (index.html, chatML*):
// keep the two identical — scripts/chatml.test.mjs checks the page copy against this file.
// Only the topic is learned: places, days and parts of the day are read by rules, and every answer is computed from the data.
export const INTENTS = ['pm', 'adv', 'rank', 'hot', 'wx', 'fog', 'acc', 'src', 'how', 'whatpm', 'aqi', 'hi', 'other'];
export const DIM = 8192;

/** text -> sorted unique bucket ids of its character 2-, 3- and 4-grams */
export function featurize(text, dim = DIM) {
  const s = ' ' + String(text).toLowerCase().replace(/[!?.,;:"“”'‘’()\[\]{}<>…~]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const ids = new Set();
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) {
    let h = 2166136261 ^ n; const g = s.slice(i, i + n);
    for (let k = 0; k < g.length; k++) { h ^= g.charCodeAt(k); h = Math.imul(h, 16777619); }
    ids.add((h >>> 0) % dim);
  }
  return [...ids].sort((a, b) => a - b);
}
/** probabilities of the topics for one text, with a model as stored (int8 weights) or as trained (float) */
export function predict(model, text) {
  const f = featurize(text, model.dim), w = model.w || decodeW(model), K = model.intents.length, z = new Float64Array(K), norm = 1 / Math.sqrt(Math.max(1, f.length));
  if (model.kind === 'mlp') {   // one hidden layer of H ReLU units: W1 stored by feature (j*H + h), one scale per hidden unit; W2 (K x H) as numbers
    const H = model.hidden, h = new Float64Array(H);
    for (let u = 0; u < H; u++) h[u] = model.b1[u];
    for (const j of f) { const off = j * H; for (let u = 0; u < H; u++) h[u] += w[off + u] * (model.scale ? model.scale[u] : 1) * norm; }
    for (let u = 0; u < H; u++) if (h[u] < 0) h[u] = 0;
    for (let k = 0; k < K; k++) { let a = model.b[k]; for (let u = 0; u < H; u++) a += model.w2[k * H + u] * h[u]; z[k] = a; }
  } else for (let k = 0; k < K; k++) { let a = model.b[k]; const sc = model.scale ? model.scale[k] : 1, off = k * model.dim; for (const j of f) a += w[off + j] * sc * norm; z[k] = a; }
  const m = Math.max(...z); let su = 0; const p = [...z].map(v => { const e = Math.exp(v - m); su += e; return e; });
  return p.map(v => v / su);
}
const DEC = new WeakMap();   // decoded int8 weights, kept out of the model object (it is written to JSON)
function decodeW(model) { let w = DEC.get(model); if (!w) { const bin = Buffer.from(model.q, 'base64'); w = new Int8Array(bin.buffer, bin.byteOffset, bin.length); DEC.set(model, w); } return w; }
/** train on [{q, y}] (y a topic name); returns a float model */
export function train(rows, { epochs = 25, lr = 0.5, l2 = 1e-5, seed = 7, dim = DIM, intents = INTENTS } = {}) {
  const K = intents.length, W = new Float64Array(K * dim), b = new Float64Array(K), X = rows.map(r => featurize(r.q, dim)), Y = rows.map(r => intents.indexOf(r.y));
  if (Y.some(y => y < 0)) throw new Error('unknown topic in the training rows');
  let s = seed >>> 0; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
  const idx = rows.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const eta = lr / (1 + ep * 0.15);
    for (const i of idx) {
      const f = X[i], norm = 1 / Math.sqrt(Math.max(1, f.length)), z = new Float64Array(K);
      for (let k = 0; k < K; k++) { let a = b[k]; const off = k * dim; for (const j of f) a += W[off + j] * norm; z[k] = a; }
      const m = Math.max(...z); let su = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - m); su += z[k]; }
      for (let k = 0; k < K; k++) { const g = z[k] / su - (k === Y[i] ? 1 : 0), off = k * dim; b[k] -= eta * g; for (const j of f) W[off + j] -= eta * (g * norm + l2 * W[off + j]); }
    }
  }
  return { dim, intents, w: W, b: [...b] };
}
/** train a small neural network (one hidden layer of `hidden` ReLU units) on [{q, y}] by SGD with momentum; returns a float model.
 *  The input is the same hashed n-gram vector; the hidden layer lets topics depend on combinations of n-grams. */
export function trainMLP(rows, { hidden = 48, epochs = 14, lr = 0.02, mom = 0.9, l2 = 2e-6, drop = 0.1, seed = 7, dim = DIM, intents = INTENTS } = {}) {
  const K = intents.length, H = hidden, X = rows.map(r => featurize(r.q, dim)), Y = rows.map(r => intents.indexOf(r.y));
  if (Y.some(y => y < 0)) throw new Error('unknown topic in the training rows');
  let s = seed >>> 0; const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const W1 = new Float64Array(dim * H).map(() => gauss() * 0.5), b1 = new Float64Array(H).fill(0.01), W2 = new Float64Array(K * H).map(() => gauss() * Math.sqrt(2 / H)), b2 = new Float64Array(K);
  const V1 = new Float64Array(dim * H), V2 = new Float64Array(K * H), vb1 = new Float64Array(H), vb2 = new Float64Array(K);
  const idx = rows.map((_, i) => i), h = new Float64Array(H), mask = new Float64Array(H), z = new Float64Array(K), gh = new Float64Array(H);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const eta = lr / (1 + ep * 0.25);
    for (const i of idx) {
      const f = X[i], norm = 1 / Math.sqrt(Math.max(1, f.length));
      for (let u = 0; u < H; u++) h[u] = b1[u];
      for (const j of f) { const off = j * H; for (let u = 0; u < H; u++) h[u] += W1[off + u] * norm; }
      for (let u = 0; u < H; u++) { mask[u] = h[u] > 0 && rnd() >= drop ? 1 / (1 - drop) : 0; h[u] *= mask[u]; }   // ReLU + dropout
      let mx = -Infinity; for (let k = 0; k < K; k++) { let a = b2[k]; for (let u = 0; u < H; u++) a += W2[k * H + u] * h[u]; z[k] = a; if (a > mx) mx = a; }
      let su = 0; for (let k = 0; k < K; k++) { z[k] = Math.exp(z[k] - mx); su += z[k]; }
      gh.fill(0);
      for (let k = 0; k < K; k++) { const g = z[k] / su - (k === Y[i] ? 1 : 0);
        for (let u = 0; u < H; u++) { const o = k * H + u; gh[u] += g * W2[o]; V2[o] = mom * V2[o] - eta * (g * h[u] + l2 * W2[o]); W2[o] += V2[o]; }
        vb2[k] = mom * vb2[k] - eta * g; b2[k] += vb2[k]; }
      for (let u = 0; u < H; u++) { gh[u] *= mask[u]; vb1[u] = mom * vb1[u] - eta * gh[u]; b1[u] += vb1[u]; }
      for (const j of f) { const off = j * H; for (let u = 0; u < H; u++) { const o = off + u; V1[o] = mom * V1[o] - eta * (gh[u] * norm + l2 * W1[o]); W1[o] += V1[o]; } }
    }
  }
  return { kind: 'mlp', dim, hidden: H, intents, w: W1, b1: [...b1], w2: [...W2], b: [...b2] };
}
/** float model -> stored model: int8 weights with one scale per topic (base64), biases rounded */
export function quantize(m, meta = {}) {
  if (m.kind === 'mlp') {   // W1 as int8 with one scale per hidden unit; the small output layer as rounded numbers
    const H = m.hidden, q = new Int8Array(m.dim * H), mx = new Float64Array(H);
    for (let j = 0; j < m.dim; j++) for (let u = 0; u < H; u++) mx[u] = Math.max(mx[u], Math.abs(m.w[j * H + u]));
    const scale = [...mx].map(v => +((v / 127) || 1).toPrecision(6));
    for (let j = 0; j < m.dim; j++) for (let u = 0; u < H; u++) q[j * H + u] = Math.round(m.w[j * H + u] / scale[u]);
    return { version: 2, ...meta, kind: 'mlp', dim: m.dim, hidden: H, intents: m.intents, b1: m.b1.map(v => +v.toFixed(5)), w2: m.w2.map(v => +v.toFixed(5)), b: m.b.map(v => +v.toFixed(5)), scale, q: Buffer.from(q.buffer).toString('base64') };
  }
  const K = m.intents.length, q = new Int8Array(K * m.dim), scale = [];
  for (let k = 0; k < K; k++) { let mx = 0; for (let j = 0; j < m.dim; j++) mx = Math.max(mx, Math.abs(m.w[k * m.dim + j])); const sc = mx / 127 || 1; scale.push(+sc.toPrecision(6));
    for (let j = 0; j < m.dim; j++) q[k * m.dim + j] = Math.round(m.w[k * m.dim + j] / scale[k]); }
  return { version: 1, ...meta, dim: m.dim, intents: m.intents, b: m.b.map(v => +v.toFixed(5)), scale, q: Buffer.from(q.buffer).toString('base64') };
}
/** accuracy and per-topic recall on [{q, y}] */
export function evaluate(model, rows) {
  let ok = 0; const per = {};
  for (const r of rows) { const p = predict(model, r.q), k = p.indexOf(Math.max(...p)), hit = model.intents[k] === r.y; if (hit) ok++;
    (per[r.y] ||= [0, 0])[1]++; if (hit) per[r.y][0]++; }
  return { n: rows.length, acc: rows.length ? ok / rows.length : 0, per: Object.fromEntries(Object.entries(per).map(([k, [a, n]]) => [k, +(a / n).toFixed(2)])) };
}

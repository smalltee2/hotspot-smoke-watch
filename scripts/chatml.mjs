// Ask SEA-HAF: the question classifier (which topic a question is about). Character n-grams (2–4, so Thai without spaces and
// typos still match) hashed into DIM buckets, binary, L2-normalised; multinomial logistic regression trained by SGD; weights
// stored as int8 with one scale per topic (chat/model.json). The page has the same featurize / predict (index.html, chatML*):
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
  for (let k = 0; k < K; k++) { let a = model.b[k]; const sc = model.scale ? model.scale[k] : 1, off = k * model.dim; for (const j of f) a += w[off + j] * sc * norm; z[k] = a; }
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
/** float model -> stored model: int8 weights with one scale per topic (base64), biases rounded */
export function quantize(m, meta = {}) {
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

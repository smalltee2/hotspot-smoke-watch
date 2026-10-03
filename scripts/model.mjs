// Loads the smoke model exactly as the web page runs it: the code between /*MODEL-START*/ and /*MODEL-END*/ in index.html,
// so the pipeline (emission assimilation), the hindcast and the page cannot drift apart.
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export function loadModel(file = path.join(ROOT, 'index.html')) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf('/*MODEL-START*/'), b = html.indexOf('/*MODEL-END*/');
  if (a < 0 || b < 0) throw new Error('model markers not found in ' + file);
  const names = ['KG_PER_MJ', 'confOK', 'FINN_EF', 'finnType', 'clusterSources', 'fireRate', 'plumeTop', 'simulate', 'concAt'];
  const code = html.slice(a, b) + `\n;({${names.map(n => `${n}:typeof ${n}!=='undefined'?${n}:undefined`).join(',')}})`;
  const ctx = vm.createContext({ Math, Date, JSON, console, Map, Set, Float32Array, Float64Array, Uint8Array, Int16Array, Int32Array, Array, Number, Object, String, isFinite, parseFloat, parseInt });
  const M = vm.runInContext(code, ctx, { filename: 'index.html#model' });
  for (const n of names) if (M[n] === undefined) throw new Error('model export missing: ' + n);
  return M;
}

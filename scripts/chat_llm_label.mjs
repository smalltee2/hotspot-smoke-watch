#!/usr/bin/env node
// Ask SEA-HAF: a local LLM on the admin's own computer (Mac: Ollama or LM Studio) suggests the topic of each question waiting in the
// labelling queue. The suggestions appear on the dev page ("Chat questions to label") as one click; the admin still decides, so
// only a person's click becomes a label (and the real test questions, chat/test_real.json, stay checked by a person).
//
// Stand-alone (Node 18+, no packages, nothing else from the repository), so it can be downloaded on its own:
//   curl -O https://raw.githubusercontent.com/smalltee2/hotspot-smoke-watch/main/scripts/chat_llm_label.mjs
//   ollama pull qwen2.5:7b                       # once (or any model that writes Thai; see --model)
//   node chat_llm_label.mjs                      # asks for the key (the CHAT_EXPORT_TOKEN value) without showing it
// Options:
//   --model NAME       model name (default qwen2.5:7b)
//   --api ollama|openai  Ollama (http://localhost:11434, default) or an OpenAI-compatible server such as LM Studio (http://localhost:1234)
//   --url URL          the LLM server's address, if not the default of --api
//   --site URL         the SEA-HAF site (default https://sea-haf.pages.dev)
//   --n N              questions per run (default 100)
//   --redo             ask again for questions that already have a suggestion
//   --dry              print the suggestions only, send nothing
//   --generate N       instead: write about N new questions per topic (varied Thai styles, Northern Thai, Isan, English), keep
//                      only those the model then classifies back to the same topic, and send them as training rows (never test
//                      questions; api/generated.js). With --dry they are only printed.
//   --topics a,b       with --generate: only these topics
//   --daily            the daily job: suggest topics for the queue, then write --generate N questions a topic (default 10)
//   --install-daily HH:MM   (macOS) run --daily every day at HH:MM (default 07:41) with launchd: copies this script to
//                      ~/Library/Application Support/SEA-HAF/, writes ~/Library/LaunchAgents/th.seahaf.chat-llm.plist, logs to
//                      ~/Library/Logs/sea-haf-chat-llm.log. A day the Mac was asleep at that time runs when it wakes.
//                      Run it again after downloading a newer script; --uninstall-daily removes the job.
//   --save-key         (macOS) store the key in the login Keychain (asked without echo), for the daily job
// The key is read from the environment variable CHAT_EXPORT_TOKEN, else from the macOS login Keychain (item "sea-haf-chat",
// saved by --save-key), else typed when asked. It is never written to a file.
// The questions go only to the LLM on this computer and back to the SEA-HAF site.

export const TOPICS = {
  pm: 'the PM2.5 / dust / haze / smoke level or air quality at a place (or near me), now or on a day or part of the day; whether it will rise or fall; a bare place name or place + day',
  adv: 'health advice because of the dust: masks or N95, going out, running, cycling, children, the elderly, asthma, pregnancy, pets, opening windows, air purifiers',
  rank: 'which provinces or regions have the worst or cleanest air, top-N lists, comparing provinces, where to go for clean air',
  hot: 'fire hotspots, burning, forest fires, crop burning, satellite fire detections, how many fires and where',
  wx: 'the weather forecast: rain, umbrella, storms, temperature (hot or cold), wind, humidity, clouds or sun (not dust or air quality)',
  fog: 'fog or mist forecasts, fog when driving, visibility in fog, sea of mist at viewpoints (smoke haze หมอกควัน is pm, not fog)',
  acc: 'how accurate or reliable the forecast is, its error, hit rate, comparison with station measurements',
  src: 'where the data come from (satellites, stations, CAMS, Air4Thai, OpenAQ, IQAir, NASA FIRMS), how often it is updated, what time the data are for',
  how: 'how SEA-HAF works: its models, machine learning, how the forecast is made and corrected, what SEA-HAF is, who made it, how far ahead it forecasts',
  whatpm: 'what PM2.5 is, its size, why it is harmful, its health effects in general, where it comes from (general knowledge, not the level at a place)',
  aqi: 'what the AQI is, its colour levels, the Thai AQI vs the US AQI, the thresholds (37.5, 75 µg/m³), µg/m³ vs AQI',
  hi: 'greetings, thanks, praise, what the bot can do, goodbyes, testing the bot',
  other: 'anything else: outside dust, fire, weather and fog (gold price, lottery, football, news, cooking, homework, shopping, jokes, ...), or not a question at all',
};
const EXAMPLES = [
  ['ฝุ่นเชียงใหม่พรุ่งนี้เช้าเป็นไง', 'pm'], ['ลำพูน', 'pm'], ['ควรใส่ n95 ไหมวันนี้', 'adv'], ['จังหวัดไหนฝุ่นน้อยสุด', 'rank'],
  ['มีไฟป่าแถวแม่แจ่มไหม', 'hot'], ['พรุ่งนี้ฝนตกไหม', 'wx'], ['หมอกควันหนาไหม', 'pm'], ['ทะเลหมอกดอยอินทนนท์', 'fog'],
  ['พยากรณ์แม่นแค่ไหน', 'acc'], ['ข้อมูลอัปเดตกี่โมง', 'src'], ['ใช้ ai พยากรณ์ไหม', 'how'], ['pm2.5 อันตรายยังไง', 'whatpm'],
  ['aqi สีส้มหมายถึงอะไร', 'aqi'], ['ขอบคุณจ้า', 'hi'], ['เครื่องฟอกอากาศยี่ห้อไหนดี', 'other'], ['หวยงวดนี้', 'other'],
];
export function prompt(q) {
  const sys = 'You classify questions sent to "Ask SEA-HAF", a chatbot of a PM2.5 and fire-smoke forecast for Thailand. Questions are mostly Thai '
    + '(also Northern Thai, Isan, English, typos). Pick the ONE topic the question is about.\nTopics:\n'
    + Object.entries(TOPICS).map(([k, d]) => `- ${k}: ${d}`).join('\n')
    + '\nReply with JSON only, no other text: {"topic": "<one of ' + Object.keys(TOPICS).join(', ') + '>", "confidence": <0 to 1>}';
  const shots = EXAMPLES.flatMap(([eq, y]) => [{ role: 'user', content: eq }, { role: 'assistant', content: JSON.stringify({ topic: y, confidence: 0.95 }) }]);
  return [{ role: 'system', content: sys }, ...shots, { role: 'user', content: q }];
}
/** the model's reply -> {y, conf} or null */
export function parseReply(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/); if (!m) return null;
  let o; try { o = JSON.parse(m[0]); } catch (e) { return null; }
  const y = String(o.topic || o.y || '').trim().toLowerCase(); if (!(y in TOPICS)) return null;
  const c = +o.confidence; return { y, conf: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5 };
}
export async function askLLM(q, { api = 'ollama', url, model = 'qwen2.5:7b', fetchFn = fetch } = {}) {
  const messages = prompt(q);
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    if (api === 'openai') {
      const r = await fetchFn((url || 'http://localhost:1234') + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 60 }) });
      if (!r.ok) throw new Error(`LLM server HTTP ${r.status}`); text = (await r.json()).choices?.[0]?.message?.content;
    } else {
      const r = await fetchFn((url || 'http://localhost:11434') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, format: 'json', options: { temperature: 0, num_predict: 60 } }) });
      if (!r.ok) throw new Error(`LLM server HTTP ${r.status}${r.status === 404 ? ` (is the model pulled? ollama pull ${model})` : ''}`); text = (await r.json()).message?.content;
    }
    const p = parseReply(text); if (p) return p;
  }
  return null;
}
/** one run: read the queue, ask the LLM for each question, send the suggestions; returns counts */
export async function run({ site = 'https://sea-haf.pages.dev', token, n = 100, redo = false, dry = false, log = console.log, fetchFn = fetch, ...llm }) {
  const auth = { Authorization: 'Bearer ' + token };
  const r = await fetchFn(`${site}/api/label?n=${n}`, { headers: auth });
  if (r.status === 401) throw new Error('the key was not accepted (it is the CHAT_EXPORT_TOKEN value)');
  if (!r.ok) throw new Error(`SEA-HAF site HTTP ${r.status}`);
  const { queue = [], waiting = 0 } = await r.json(), todo = queue.filter(x => redo || !x.llm);
  log(`${waiting} questions waiting; asking the LLM about ${todo.length}${dry ? ' (dry run: nothing sent)' : ''}`);
  let sent = 0, failed = 0;
  for (const x of todo) {
    const p = await askLLM(x.q, { ...llm, fetchFn });
    if (!p) { failed++; log(`  ?  ${x.q}`); continue; }
    log(`  ${p.y.padEnd(6)} ${(p.conf * 100).toFixed(0).padStart(3)} %  ${x.q}`);
    if (dry) continue;
    const s = await fetchFn(`${site}/api/suggest`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ q: x.q, y: p.y, conf: p.conf, model: llm.model || 'qwen2.5:7b' }) });
    if (s.ok) sent++; else failed++;
  }
  log(`done: ${sent} suggestions sent, ${failed} without an answer${sent ? '; confirm them on the dev page (method tab, "Chat questions to label")' : ''}`);
  return { asked: todo.length, sent, failed };
}
const STYLES = ['casual spoken Thai (มั้ย, ป่ะ, อ่ะ, จ้า)', 'polite Thai (ครับ/ค่ะ)', 'formal Thai (กรุณา, ขอทราบ)', 'very short keyword style',
  'a long question with personal context', 'Northern Thai (คำเมือง: ก่อ, เจ้า, บ่)', 'Isan (บ่, เด้อ, หลาย)', 'Thai mixed with English words', 'Thai with common typos', 'English'];
export function genPrompt(y, n, style) {
  return [{ role: 'system', content: 'You write realistic questions that people in Thailand type into "Ask SEA-HAF", a chatbot of a PM2.5 and fire-smoke forecast. '
    + 'Reply with JSON only: {"questions": ["...", "..."]}' },
  { role: 'user', content: `Write ${n} different questions about this topic only: ${TOPICS[y]}.\nStyle: ${style}. Use many different places in Thailand, days and times. `
    + 'Each question must clearly belong to this topic and to no other. No phone numbers, e-mails or links. No numbering.' }];
}
/** questions written by the model for a topic, kept only when it classifies them back to that topic */
export async function generate(y, n, { api = 'ollama', url, model = 'qwen2.5:7b', fetchFn = fetch, seed = 1, log = () => {} } = {}) {
  const out = new Map(), per = Math.min(10, n);
  for (let k = 0; out.size < n && k < Math.ceil(n / per) * 2; k++) {
    const style = STYLES[(k + seed) % STYLES.length], messages = genPrompt(y, per, style); let text;
    if (api === 'openai') { const r = await fetchFn((url || 'http://localhost:1234') + '/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, temperature: 0.9, max_tokens: 900 }) }); if (!r.ok) throw new Error(`LLM server HTTP ${r.status}`); text = (await r.json()).choices?.[0]?.message?.content; }
    else { const r = await fetchFn((url || 'http://localhost:11434') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, format: 'json', options: { temperature: 0.9, num_predict: 900, seed: seed * 100 + k } }) }); if (!r.ok) throw new Error(`LLM server HTTP ${r.status}`); text = (await r.json()).message?.content; }
    let qs = []; try { qs = JSON.parse(String(text).match(/\{[\s\S]*\}/)?.[0] || '{}').questions || []; } catch (e) { qs = []; }
    for (const q0 of qs) { const q = String(q0).replace(/^\s*\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim();
      if (q.length < 2 || q.length > 200 || /\d{7,}|@|https?:|www\./i.test(q) || out.has(q.toLowerCase())) continue;
      const back = await askLLM(q, { api, url, model, fetchFn });   // round trip: the model must read it as the same topic
      if (back?.y === y) out.set(q.toLowerCase(), q); else log(`    dropped (${back?.y || '?'}): ${q}`);
      if (out.size >= n) break; }
  }
  return [...out.values()];
}
export async function runGenerate({ site = 'https://sea-haf.pages.dev', token, per = 30, topics = Object.keys(TOPICS), dry = false, log = console.log, fetchFn = fetch, ...llm }) {
  let total = 0;
  for (const y of topics) {
    if (!(y in TOPICS)) throw new Error('unknown topic ' + y);
    const qs = await generate(y, per, { ...llm, fetchFn, log, seed: Math.floor(Date.now() / 864e5) });
    log(`${y}: ${qs.length} questions`); qs.slice(0, 5).forEach(q => log('  ' + q)); if (qs.length > 5) log('  …');
    if (dry || !qs.length) { total += qs.length; continue; }
    const r = await fetchFn(`${site}/api/generated`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model || 'qwen2.5:7b', items: qs.map(q => ({ q, y })) }) });
    if (r.status === 401) throw new Error('the key was not accepted (it is the CHAT_EXPORT_TOKEN value)');
    if (!r.ok) throw new Error(`SEA-HAF site HTTP ${r.status}`); total += qs.length;
  }
  log(`done: ${total} questions ${dry ? 'written (dry run: nothing sent)' : 'sent as training rows; the weekly training (or a run of "Chat bot training") uses them'}`);
  return total;
}
// ---- macOS: the key in the login Keychain, and the daily job (launchd)
const KC = ['-s', 'sea-haf-chat', '-a', 'CHAT_EXPORT_TOKEN'], LABEL = 'th.seahaf.chat-llm';
async function keychainKey() {
  if (process.platform !== 'darwin') return '';
  const { execFileSync } = await import('node:child_process');
  try { return execFileSync('/usr/bin/security', ['find-generic-password', ...KC, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { return ''; }
}
async function saveKey() {
  if (process.platform !== 'darwin') throw new Error('--save-key is for macOS (Keychain)');
  const { execFileSync } = await import('node:child_process');
  console.log('Paste the key (the CHAT_EXPORT_TOKEN value) when asked, twice; it is not shown.');
  // "-w" last: the security tool asks for the key itself, so it never appears in a command line
  execFileSync('/usr/bin/security', ['add-generic-password', '-U', ...KC, '-l', 'SEA-HAF chat key', '-w'], { stdio: 'inherit' });
  console.log('saved in the login Keychain as "sea-haf-chat" (remove: security delete-generic-password -s sea-haf-chat)');
}
/** the launchd job description for --daily at hh:mm */
export function plist({ node, script, hour, minute, log, args = [] }) {
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>${[node, script, '--daily', ...args].map(v => `<string>${x(v)}</string>`).join('')}</array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${x(log)}</string><key>StandardErrorPath</key><string>${x(log)}</string>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
`;
}
async function installDaily(at, extra) {
  if (process.platform !== 'darwin') throw new Error('--install-daily is for macOS (launchd)');
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os'), { execFileSync } = await import('node:child_process');
  const m = /^(\d{1,2}):(\d{2})$/.exec(at || '07:41'); if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('time as HH:MM, e.g. 07:41');
  if (!(await keychainKey())) throw new Error('no key in the Keychain yet: run  node chat_llm_label.mjs --save-key  first');
  const home = os.homedir(), dir = path.join(home, 'Library/Application Support/SEA-HAF'), script = path.join(dir, 'chat_llm_label.mjs');
  const agent = path.join(home, 'Library/LaunchAgents', LABEL + '.plist'), log = path.join(home, 'Library/Logs/sea-haf-chat-llm.log');
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(path.dirname(agent), { recursive: true });
  fs.copyFileSync(new URL(import.meta.url).pathname, script);
  fs.writeFileSync(agent, plist({ node: process.execPath, script, hour: +m[1], minute: +m[2], log, args: extra }));
  const uid = process.getuid(); try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' }); } catch (e) {}
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, agent]);
  console.log(`daily job installed: every day at ${m[1].padStart(2, '0')}:${m[2]} (suggest topics, then write new training questions)\n  script ${script}\n  log    ${log}\n  run now: launchctl kickstart gui/${uid}/${LABEL}`);
}
async function uninstallDaily() {
  const fs = await import('node:fs'), path = await import('node:path'), os = await import('node:os'), { execFileSync } = await import('node:child_process');
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${LABEL}`], { stdio: 'ignore' }); } catch (e) {}
  fs.rmSync(path.join(os.homedir(), 'Library/LaunchAgents', LABEL + '.plist'), { force: true }); console.log('daily job removed');
}
function readHidden(question) {   // the key typed without echo
  return new Promise(res => { const { stdin, stdout } = process; stdout.write(question); let s = '';
    if (!stdin.isTTY) { stdin.once('data', d => res(String(d).trim())); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    // a paste arrives as one chunk (maybe with the newline, maybe wrapped in bracketed-paste marks): read it letter by letter
    const on = d => { for (const c of String(d).replace(/\x1b\[20[01]~/g, '')) {
      if (c === '\r' || c === '\n' || c === '\u0004') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); stdout.write('\n'); res(s.trim()); return; }
      if (c === '\u0003') process.exit(1); else if (c === '\u007f' || c === '\b') s = s.slice(0, -1); else if (c >= ' ') s += c; } };
    stdin.on('data', on); });
}
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('chat_llm_label.mjs')) {
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 && a[i + 1] && !a[i + 1].startsWith('--') ? a[i + 1] : undefined; };
  (async () => {
    if (a.includes('--save-key')) return saveKey();
    if (a.includes('--uninstall-daily')) return uninstallDaily();
    if (a.includes('--install-daily')) {   // pass the model / server options on to the daily job
      const extra = []; for (const k of ['model', 'api', 'url', 'site', 'generate']) if (opt(k)) extra.push('--' + k, opt(k));
      return installDaily(opt('install-daily'), extra); }
    const genDry = a.includes('--dry') && a.includes('--generate');
    const token = genDry ? '' : (process.env.CHAT_EXPORT_TOKEN || '').trim() || await keychainKey() || (process.stdin.isTTY ? await readHidden('SEA-HAF key (CHAT_EXPORT_TOKEN, not shown): ') : '');
    if (!token && !genDry) { console.log('no key (set CHAT_EXPORT_TOKEN, or run --save-key once); stopped'); process.exit(1); }
    const llm = { api: opt('api') || 'ollama', url: opt('url'), model: opt('model') || 'qwen2.5:7b' };
    if (a.includes('--daily')) {
      console.log(`--- ${new Date().toISOString()} daily job`);
      await run({ token, site: opt('site'), n: 200, ...llm });
      await runGenerate({ token, site: opt('site'), per: +(opt('generate') || 10), ...llm });
      return; }
    if (a.includes('--generate')) await runGenerate({ token, site: opt('site'), per: +(opt('generate') || 30), topics: opt('topics') ? opt('topics').split(',') : undefined, dry: a.includes('--dry'), ...llm });
    else await run({ token, site: opt('site'), n: +(opt('n') || 100), redo: a.includes('--redo'), dry: a.includes('--dry'), ...llm });
  })().catch(e => { console.log('stopped: ' + e.message + (/ECONNREFUSED|fetch failed/.test(e.message) ? ' (is Ollama / LM Studio running?)' : '')); process.exit(1); });
}

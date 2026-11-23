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
// The key is read from the environment variable CHAT_EXPORT_TOKEN, or typed when asked; it is never written to a file.
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
  const a = process.argv.slice(2), opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  (async () => {
    const token = (process.env.CHAT_EXPORT_TOKEN || '').trim() || await readHidden('SEA-HAF key (CHAT_EXPORT_TOKEN, not shown): ');
    if (!token) { console.log('no key; stopped'); process.exit(1); }
    await run({ token, site: opt('site'), n: +(opt('n') || 100), redo: a.includes('--redo'), dry: a.includes('--dry'), api: opt('api') || 'ollama', url: opt('url'), model: opt('model') || 'qwen2.5:7b' });
  })().catch(e => { console.log('stopped: ' + e.message + (/ECONNREFUSED|fetch failed/.test(e.message) ? ' (is Ollama / LM Studio running?)' : '')); process.exit(1); });
}

// Unit tests of the local-LLM labelling helper (scripts/chat_llm_label.mjs), with a fake LLM server and site: node --test scripts/chat_llm_label.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOPICS, prompt, parseReply, askLLM, run, generate, runGenerate } from './chat_llm_label.mjs';
import { INTENTS } from './chatml.mjs';

test('the helper knows the same topics as the classifier, and its examples use them', () => {
  assert.deepEqual(Object.keys(TOPICS), INTENTS);
  const m = prompt('ฝุ่นลำปาง'); assert.equal(m[0].role, 'system'); assert.equal(m.at(-1).content, 'ฝุ่นลำปาง');
  for (const x of m.filter(x => x.role === 'assistant')) assert.ok(JSON.parse(x.content).topic in TOPICS);
});
test('replies: JSON found in text, topic checked, confidence clamped', () => {
  assert.deepEqual(parseReply('{"topic":"fog","confidence":0.8}'), { y: 'fog', conf: 0.8 });
  assert.deepEqual(parseReply('Sure! {"topic": "PM", "confidence": 3}'), { y: 'pm', conf: 1 });
  assert.equal(parseReply('{"topic":"weather"}'), null);
  assert.equal(parseReply('no idea'), null);
});
const json = o => ({ ok: true, status: 200, json: async () => o });
test('Ollama and OpenAI-compatible servers; one retry when the reply is not usable', async () => {
  let calls = 0;
  const ollama = async (u, o) => { calls++; assert.match(u, /11434\/api\/chat$/); const b = JSON.parse(o.body); assert.equal(b.format, 'json'); assert.equal(b.options.temperature, 0);
    return json({ message: { content: calls === 1 ? 'hmm' : '{"topic":"hot","confidence":0.7}' } }); };
  assert.deepEqual(await askLLM('ไฟป่าเยอะไหม', { fetchFn: ollama }), { y: 'hot', conf: 0.7 }); assert.equal(calls, 2);
  const lm = async u => { assert.match(u, /1234\/v1\/chat\/completions$/); return json({ choices: [{ message: { content: '{"topic":"wx","confidence":0.9}' } }] }); };
  assert.deepEqual(await askLLM('ฝนตกไหม', { api: 'openai', fetchFn: lm }), { y: 'wx', conf: 0.9 });
});
test('a run: reads the queue with the key, skips questions already suggested, sends the rest; --dry sends nothing', async () => {
  const sent = [];
  const fake = async (u, o = {}) => {
    if (u.includes('/api/label')) { assert.equal(o.headers.Authorization, 'Bearer k'); return json({ waiting: 3, queue: [{ q: 'ฝุ่นลำปาง' }, { q: 'หวย', llm: { y: 'other' } }, { q: 'หมอกดอยเต่า' }] }); }
    if (u.includes('/api/suggest')) { sent.push(JSON.parse(o.body)); return { ok: true, status: 200 }; }
    const q = JSON.parse(o.body).messages.at(-1).content; return json({ message: { content: JSON.stringify({ topic: q.includes('หมอก') ? 'fog' : 'pm', confidence: 0.9 }) } });
  };
  const r = await run({ token: 'k', fetchFn: fake, log: () => {} });
  assert.deepEqual(r, { asked: 2, sent: 2, failed: 0 });
  assert.deepEqual(sent.map(x => [x.q, x.y, x.model]), [['ฝุ่นลำปาง', 'pm', 'qwen2.5:7b'], ['หมอกดอยเต่า', 'fog', 'qwen2.5:7b']]);
  sent.length = 0; await run({ token: 'k', fetchFn: fake, dry: true, log: () => {} }); assert.equal(sent.length, 0);
  await assert.rejects(run({ token: 'x', fetchFn: async () => ({ ok: false, status: 401 }), log: () => {} }), /key was not accepted/);
});
test('--generate: questions kept only when classified back to their topic; sent as training rows; --dry sends nothing', async () => {
  const posted = [];
  const fake = async (u, o = {}) => {
    if (u.includes('/api/generated')) { posted.push(JSON.parse(o.body)); return { ok: true, status: 200 }; }
    const b = JSON.parse(o.body), last = b.messages.at(-1).content;
    if (last.startsWith('Write ')) return json({ message: { content: JSON.stringify({ questions: ['1. หมอกลงดอยอินทนนท์ไหม', 'ฝนตกไหม', 'หมอกหนาไหมเช้านี้', 'call 0812345678 หมอก', 'หมอกลงดอยอินทนนท์ไหม'] }) } });
    return json({ message: { content: JSON.stringify({ topic: last.includes('หมอก') ? 'fog' : 'wx', confidence: 0.9 }) } });
  };
  const qs = await generate('fog', 2, { fetchFn: fake });
  assert.deepEqual(qs, ['หมอกลงดอยอินทนนท์ไหม', 'หมอกหนาไหมเช้านี้']);
  assert.equal(await runGenerate({ token: 'k', per: 2, topics: ['fog'], fetchFn: fake, log: () => {} }), 2);
  assert.deepEqual(posted[0].items, [{ q: 'หมอกลงดอยอินทนนท์ไหม', y: 'fog' }, { q: 'หมอกหนาไหมเช้านี้', y: 'fog' }]);
  posted.length = 0; await runGenerate({ per: 2, topics: ['fog'], dry: true, fetchFn: fake, log: () => {} }); assert.equal(posted.length, 0);
});

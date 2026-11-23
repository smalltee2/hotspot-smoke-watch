-- SEA-HAF D1 database (binding DB). Applied by .github/workflows/cloudflare-setup.yml; safe to run again.
-- Ask SEA-HAF: questions viewers labelled in the chat (the topic they picked), for the weekly training of the topic classifier.
-- Only the question, the topic, the kind and the time: nothing about the viewer.
CREATE TABLE IF NOT EXISTS chat_feedback (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  t    TEXT NOT NULL,          -- ISO time (UTC)
  q    TEXT NOT NULL,          -- the question, 2-200 characters
  y    TEXT NOT NULL,          -- the topic the viewer picked
  kind TEXT NOT NULL           -- 'pick' / 'fix' (the viewer chose the topic), 'unsure' (the classifier's guess), 'collect' (collecting mode)
);
CREATE INDEX IF NOT EXISTS chat_feedback_t ON chat_feedback (t);
-- The admin's labels from the dev page (functions/api/label.js), one per question (qk = the question in lower case, without spaces).
-- y is a topic or 'skip'. Made on first use by the Functions as well (functions/_common.js ensure).
CREATE TABLE IF NOT EXISTS chat_label (
  qk TEXT PRIMARY KEY,
  q  TEXT NOT NULL,
  y  TEXT NOT NULL,
  t  TEXT NOT NULL
);
-- Topics suggested by the admin's local LLM (functions/api/suggest.js, scripts/chat_llm_label.mjs); shown on the labelling queue,
-- never a label by itself. Made on first use by the Functions as well.
CREATE TABLE IF NOT EXISTS chat_suggest (
  qk    TEXT PRIMARY KEY,
  y     TEXT NOT NULL,
  conf  REAL,
  model TEXT,
  t     TEXT NOT NULL
);

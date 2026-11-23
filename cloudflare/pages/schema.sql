-- SEA-HAF D1 database (binding DB). Applied by .github/workflows/cloudflare-setup.yml; safe to run again.
-- Ask SEA-HAF: questions viewers labelled in the chat (the topic they picked), for the weekly training of the topic classifier.
-- Only the question, the topic, the kind and the time: nothing about the viewer.
CREATE TABLE IF NOT EXISTS chat_feedback (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  t    TEXT NOT NULL,          -- ISO time (UTC)
  q    TEXT NOT NULL,          -- the question, 2-200 characters
  y    TEXT NOT NULL,          -- the topic the viewer picked
  kind TEXT NOT NULL           -- 'pick' (which do you mean?) or 'fix' (not what I asked?)
);
CREATE INDEX IF NOT EXISTS chat_feedback_t ON chat_feedback (t);

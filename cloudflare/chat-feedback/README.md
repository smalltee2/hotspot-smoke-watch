# Ask SEA-HAF feedback Worker

Keeps the questions viewers label in the chat ("which do you mean?" / "not what I asked?") for the weekly training of the chat's
topic classifier (`.github/workflows/chat-train.yml`). Stores only the question text, the topic, the kind and the time; never the
IP or anything else about the viewer. Questions with phone numbers, e-mails or links are refused; 40 per sender per day.

## Set up (Cloudflare dashboard, about 10 minutes)

1. **KV namespace:** Storage & Databases → KV → *Create a namespace* → name `sea-haf-chat-feedback`.
2. **Worker:** Workers & Pages → *Create* → *Create Worker* → name `sea-haf-chat-feedback` → *Deploy* → *Edit code* → replace
   everything with `worker.js` from this folder → *Deploy*.
3. In the Worker, **Settings → Bindings → Add → KV namespace**: variable name `FEEDBACK`, namespace `sea-haf-chat-feedback`.
4. **Settings → Variables and Secrets:**
   - add a *Text* variable `ALLOWED_ORIGINS` = `https://smalltee2.github.io` (add the custom domain too, comma-separated, if the
     site gets one);
   - add a *Secret* `EXPORT_TOKEN` = a long random string (e.g. from a password manager). Keep it; do not paste it anywhere else.
5. In GitHub: repository **Settings → Secrets and variables → Actions → New repository secret** `CHAT_EXPORT_TOKEN` = the same string.
6. Send the Worker's address (`https://sea-haf-chat-feedback.<your-subdomain>.workers.dev`) to the maintainer, or put it in
   `chat/config.json`: `"endpoint": "<address>/feedback"`, `"exportUrl": "<address>/export"`.

Or with Wrangler: `npx wrangler kv namespace create FEEDBACK` (paste the id into `wrangler.toml`), `npx wrangler secret put EXPORT_TOKEN`,
`npx wrangler deploy`.

## Check

- `<address>/feedback` in a browser answers 404 "SEA-HAF chat feedback" (only POST from the site is accepted).
- `<address>/export` without the token answers 401.
- After a viewer corrects an answer, *Actions → Chat bot training → Run workflow* logs "chat learn: N sheet rows, …".

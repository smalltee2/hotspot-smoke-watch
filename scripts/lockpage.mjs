// Locks a page of the site behind a username and password (the developer page, the performance page).
// GitHub Pages serves every file publicly and cannot check a login, so the page is encrypted at build time instead:
//   key = PBKDF2-SHA256(username + "\n" + password, fixed salt, 600 000 iterations) → AES-256-GCM, random IV per build.
// The published file holds only the ciphertext and a login form; the browser derives the key from what is typed and decrypts
// the page in place (same address, so the page's relative data paths keep working). "Remember on this device" keeps the
// derived key (never the password) in this browser's storage; it stays valid until the username or password is changed.
// The username and password come from GitHub Secrets (DEV_USER, DEV_PASS) and never appear in the repository or the site.
// Without them the page is replaced by a notice (fails closed: an unconfigured build never publishes the page in the clear).
// Run: DEV_USER=… DEV_PASS=… node scripts/lockpage.mjs <in.html> <out.html> "<title>"
import fs from 'node:fs/promises';
import { webcrypto as C } from 'node:crypto';

const SALT = 'a50b17bc6c4e8a0cdf8e55dd1b17ac2f', ITER = 600000;   // the salt is not secret; changing it logs every device out
const [inF, outF, title = 'SEA-HAF'] = process.argv.slice(2);
const user = process.env.DEV_USER || '', pass = process.env.DEV_PASS || '';
const b64 = u8 => Buffer.from(u8).toString('base64');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const shell = (body, script = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · sign in</title>
<style>
:root{--bg:#eceeed;--panel:#f8f8f6;--line:#d3d6d3;--fg:#1d2321;--muted:#5d6763;--accent:#c4420f;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#151918;--panel:#1d2220;--line:#323936;--fg:#e7eae8;--muted:#9aa5a0;--accent:#ff7a3d;--bad:#ff6b5e}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;padding:16px}
form,.box{width:100%;max-width:340px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px 20px 16px}
h1{margin:0 0 2px;font-size:1.1rem}h1 span{color:var(--accent)}p{margin:0 0 14px;color:var(--muted);font-size:.85rem}
label{display:block;font-size:.8rem;color:var(--muted);margin:10px 0 3px}
input[type=text],input[type=password]{width:100%;padding:9px 10px;font:inherit;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
.rem{display:flex;align-items:center;gap:7px;margin:12px 0 0;color:var(--muted);font-size:.82rem}
button{width:100%;margin-top:14px;padding:10px;font:600 .95rem system-ui,sans-serif;border:0;border-radius:6px;background:var(--accent);color:#fff;cursor:pointer}
button[disabled]{opacity:.6;cursor:wait}#msg{min-height:1.3em;margin:10px 0 0;color:var(--bad);font-size:.85rem}
</style></head><body>${body}${script}</body></html>`;

async function main() {
  if (!inF || !outF) throw new Error('usage: node scripts/lockpage.mjs <in.html> <out.html> "<title>"');
  if (!user || !pass) {   // not configured: publish a notice, never the page itself
    await fs.writeFile(outF, shell(`<div class="box"><h1>SEA-<span>HAF</span></h1><p>This page is private and is not available at the moment.</p></div>`));
    console.log(`lockpage: ${outF} replaced by a notice (DEV_USER / DEV_PASS not set)`);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=private pages::${outF} not published: add the DEV_USER and DEV_PASS secrets`);
    return;
  }
  const html = await fs.readFile(inF), enc = new TextEncoder();
  const base = await C.subtle.importKey('raw', enc.encode(user + '\n' + pass), 'PBKDF2', false, ['deriveKey']);
  const key = await C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(SALT, 'hex'), iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = C.getRandomValues(new Uint8Array(12)), ct = new Uint8Array(await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, html));
  const kid = b64(new Uint8Array(await C.subtle.digest('SHA-256', new Uint8Array(await C.subtle.exportKey('raw', key))))).slice(0, 12);   // tells a remembered key from an old one
  const form = `<form id="f" autocomplete="on"><h1>SEA-<span>HAF</span></h1><p>${esc(title)}: private page</p>
  <label for="u">Username</label><input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  <label class="rem"><input id="r" type="checkbox" checked> Remember on this device</label>
  <button id="b" type="submit">Sign in</button><div id="msg" role="alert"></div></form>`;
  const js = `<script>
(()=>{const D={iv:"${b64(iv)}",ct:"${b64(ct)}",salt:"${SALT}",iter:${ITER},kid:"${kid}"},K="hsw.pagekey",S=window.crypto&&crypto.subtle,
u8=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)),hex=h=>new Uint8Array(h.match(/../g).map(x=>parseInt(x,16))),$=id=>document.getElementById(id);
const show=async key=>{const pt=await S.decrypt({name:"AES-GCM",iv:u8(D.iv)},key,u8(D.ct));const h=new TextDecoder().decode(pt);
  if(document.readyState!=="complete") await new Promise(r=>addEventListener("load",r,{once:true}));   // document.open() is ignored while this page is still loading
  document.open();document.write(h);document.close();};
const get=()=>{try{return JSON.parse(localStorage.getItem(K)||"null");}catch(e){return null;}},put=v=>{try{v?localStorage.setItem(K,JSON.stringify(v)):localStorage.removeItem(K);}catch(e){}};
if(!S){$("msg").textContent="This browser cannot open private pages (needs a secure https connection).";$("b").disabled=true;return;}
(async()=>{const s=get();if(s&&s.kid===D.kid){try{await show(await S.importKey("raw",u8(s.k),"AES-GCM",true,["decrypt"]));return;}catch(e){}}if(s)put(null);$("u").focus();})();
$("f").onsubmit=async e=>{e.preventDefault();const b=$("b");b.disabled=true;$("msg").textContent="";b.textContent="Checking…";
  try{const base=await S.importKey("raw",new TextEncoder().encode($("u").value.trim()+"\\n"+$("p").value),"PBKDF2",false,["deriveKey"]);
    const key=await S.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:hex(D.salt),iterations:D.iter},base,{name:"AES-GCM",length:256},true,["decrypt"]);
    await S.decrypt({name:"AES-GCM",iv:u8(D.iv)},key,u8(D.ct));
    if($("r").checked){const raw=new Uint8Array(await S.exportKey("raw",key));put({kid:D.kid,k:btoa(String.fromCharCode(...raw))});}else put(null);
    await show(key);}
  catch(err){b.disabled=false;b.textContent="Sign in";$("msg").textContent="Wrong username or password.";$("p").value="";$("p").focus();}};
})();
</script>`;
  await fs.writeFile(outF, shell(form, js));
  console.log(`lockpage: ${outF} encrypted (${html.length} bytes)`);
}
main().catch(e => { console.error('lockpage failed:', e.message); process.exit(1); });

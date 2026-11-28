# บทที่ 6 เอกสารอ้างอิงทางเทคนิค (Technical Reference)

> ภาค C3 ของคู่มือ SEA-HAF เขียนตามแบบ *NCAR ARW (WRF) User's Guide*: การติดตั้ง, workflow, ตารางค่าตั้ง (เทียบ namelist),
> module reference และ output reference
>
> ทุกค่าในบทนี้คัดลอกจากโค้ดบน branch `main` (commit ล่าสุดที่ตรวจคือ PR #164, 28 พ.ย. 2026) และระบุตำแหน่งไว้ใน
> `<!-- src: ไฟล์:บรรทัด -->` ถ้าเอกสารนี้ขัดกับโค้ด **ให้ถือโค้ดเป็นหลัก** ความไม่ตรงกันที่พบระหว่างเขียนอยู่ใน
> `docs/manual/ISSUES_C3.md`
>
> บทนี้ไม่มีค่า key, token หรือรหัสผ่านใด ๆ บอกเฉพาะ**ชื่อ** secret เท่านั้น

---

## 6.1 การติดตั้งและการรัน (Installation and running)

### 6.1.1 ความต้องการของระบบ

| ส่วน | ต้องการ | หมายเหตุ |
|---|---|---|
| Pipeline หลัก (`scripts/*.mjs`) | Node.js 20 ขึ้นไป **ไม่มี npm dependency** (ไม่มี `package.json`) | ใช้เฉพาะโมดูลในตัวของ Node (`fs`, `path`, `zlib`, `crypto`, `child_process`, `readline`) และ `fetch` ในตัว <!-- src: scripts/update.mjs:2 --> workflow ใช้ `node-version: '22'` <!-- src: .github/workflows/update.yml:34-36 --> |
| SILAM | Python 3 + `netCDF4` | `scripts/silam.py` ติดตั้ง `netCDF4` เองด้วย `pip install --user` เฉพาะเมื่อมี run ใหม่ให้อ่าน <!-- src: scripts/silam.py:37-46 --> |
| ฝน ECMWF open data | Python 3 + `pygrib` | `scripts/ecmwf_pr.py` ติดตั้ง `pygrib` เองเมื่อจำเป็น (`need_pygrib`) <!-- src: scripts/ecmwf_pr.py:74 --> |
| ตัวคูณรูปแบบฝน CHELSA | Python 3.12 + `rasterio`, `numpy` | เฉพาะ `scripts/prclim.py` ใน workflow `prclim.yml` (รันครั้งเดียว) <!-- src: .github/workflows/prclim.yml:20-43 --> |
| fit น้ำหนัก rain blend | Python 3 + `numpy` | `scripts/fit_rain_blend.py` รันด้วยมือเดือนละครั้ง <!-- src: scripts/fit_rain_blend.py:18-20 --> |
| วิเคราะห์ชั่วโมง PM2.5 สูง | Python 3 | `analysis/highpm_replay.py` (ไม่อยู่ใน workflow) |
| GSMaP | `sshpass` + `sftp` และ host key ของ JAXA ใน `~/.ssh/known_hosts` | workflow ติดตั้ง `sshpass` และ pin fingerprint ของ server ให้ <!-- src: .github/workflows/update.yml:79-87 --> |
| Cloudflare Pages | `npx wrangler@4.160.1` | ดาวน์โหลดตอนรัน ไม่ใช่ dependency ของ repo <!-- src: .github/workflows/update.yml:299 --> |

Python ใช้เฉพาะ `scripts/silam.py`, `scripts/ecmwf_pr.py`, `scripts/prclim.py`, `scripts/fit_rain_blend.py`
และสคริปต์ตรวจ `scripts/checks/openmeteo_lapse.py` ส่วนอื่นทั้งหมดเป็น JavaScript (ES modules) ที่รันด้วย Node
(`fit_clim_blend.mjs` และ `hindcast_train.mjs` ก็เป็น Node)

### 6.1.2 GitHub Secrets ที่ต้องมี (บอกเฉพาะชื่อ)

ตั้งที่ Settings → Secrets and variables → Actions ค่าทั้งหมดอ่านจาก `process.env` ใน workflow เท่านั้น
**ห้ามเขียนค่าลงไฟล์ใดใน repository, ใน `data/*.json`, ใน commit message หรือในคู่มือนี้** (CLAUDE.md กฎข้อ 1)

| ชื่อ secret | ใช้ที่ | ถ้าไม่มี |
|---|---|---|
| `OPENAQ_API_KEY` | `update.mjs` (OpenAQ v3), `climatology.mjs` | **run ล้มทันที**: `OPENAQ_API_KEY is not set` <!-- src: scripts/update.mjs:373 --> |
| `FIRMS_MAP_KEY` | `update.mjs` (NASA FIRMS area API) | ข้ามจุดความร้อน: `FIRMS_MAP_KEY missing, skipping hotspots` <!-- src: scripts/update.mjs:309-310 --> |
| `GSMAP_USER`, `GSMAP_PASS` | `gsmap.mjs` (sftp ไป JAXA) | ข้าม GSMaP: `GSMaP: no credentials, observed rain skipped` <!-- src: scripts/gsmap.mjs:48 --> |
| `IQAIR_API_KEY` | `iqair.mjs` (AirVisual API, แผน Community ฟรี) | ไม่ดึง IQAir (ชั้นเทียบ IQAir ว่าง) <!-- src: scripts/update.mjs:479 --> |
| `CHAT_EXPORT_TOKEN` | `chat_learn.mjs` (อ่าน `/api/export`), `cloudflare-setup.yml` (ตั้ง Pages secret `EXPORT_TOKEN`) | การเทรนแชตรายสัปดาห์ไม่เพิ่มคำถามใหม่ <!-- src: scripts/chat_learn.mjs:81 --> |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ขั้น deploy Cloudflare ใน `update.yml`, `cloudflare-setup.yml` | ข้ามขั้น Cloudflare (เว็บ GitHub Pages ยังขึ้นตามปกติ) <!-- src: .github/workflows/update.yml:282-286 --> |
| `DEV_USER`, `DEV_PASS` | `lockpage.mjs` (เข้ารหัส `/dev.html`, `/perf.html`) | เผยแพร่หน้าประกาศแทนหน้าจริง (fail closed) <!-- src: scripts/lockpage.mjs:7-8,15,40 --> |

Workflow ยังต้องการสิทธิ์ *Read and write permissions* (Settings → Actions → General) และ Pages แบบ Source = GitHub Actions
<!-- src: README.md:66-71 -->

### 6.1.3 การรัน pipeline ในเครื่อง

ลำดับเดียวกับ workflow (ดู 6.2.1) แบบย่อ:

```bash
# 1) ดึง log 35 วัน และคลังฝึก ML (ถ้าต้องการให้ ML/การตรวจทำงานเหมือนจริง)
git fetch --depth=1 origin history && git archive FETCH_HEAD data/history | tar -x
git fetch --depth=1 origin mltrain && git archive FETCH_HEAD data/mltrain | tar -x
# 2) (ไม่บังคับ) SILAM และฝน ECMWF open data
python3 scripts/silam.py
python3 scripts/ecmwf_pr.py
# 3) รอบ CAMS: ใส่ key เป็นตัวแปรแวดล้อมของ shell เท่านั้น ห้ามเขียนลงไฟล์
export OPENAQ_API_KEY=...  FIRMS_MAP_KEY=...          # ค่าจริงไม่อยู่ในคู่มือ
export NODE_EXTRA_CA_CERTS=scripts/certs/air4thai-chain.pem
export HSW_HTTP_CACHE=/tmp/hsw-http
node scripts/update.mjs && node scripts/verify.mjs
# 4) รอบ SILAM (รัน update.mjs ซ้ำด้วย HSW_MODEL=silam ในโฟลเดอร์งานแยก)
node scripts/silam_chain.mjs
# 5) สรุปผล
node scripts/perf.mjs --force
node scripts/accuracy.mjs
```

<!-- src: .github/workflows/update.yml:61-133 -->

ไม่มี `data/state.json` ในเครื่อง: รอบแรกจะสร้างรายชื่อสถานี ดึง CAMS และ met ใหม่ทั้งหมด (คล้ายกรณี cache หาย ดูบทที่ 7.5)

#### ตัวแปรแวดล้อม (environment variables)

| ตัวแปร | ใช้ใน | ความหมาย |
|---|---|---|
| `OPENAQ_API_KEY` | `update.mjs`, `climatology.mjs` | key ของ OpenAQ v3 (header `X-API-Key`) จำเป็น <!-- src: scripts/update.mjs:211 --> |
| `FIRMS_MAP_KEY` | `update.mjs` | MAP_KEY ของ NASA FIRMS <!-- src: scripts/update.mjs:309 --> |
| `GSMAP_USER`, `GSMAP_PASS` | `gsmap.mjs` | บัญชี sftp ของ JAXA; ส่งผ่าน `SSHPASS` และถูกแทนด้วย `***` ใน log <!-- src: scripts/gsmap.mjs:37-57 --> |
| `IQAIR_API_KEY` | `update.mjs` → `iqair.mjs` | key ของ AirVisual; ไม่ถูกเขียนลง log (ทดสอบใน `iqair.test.mjs`) |
| `NODE_EXTRA_CA_CERTS` | Node runtime | ไฟล์ PEM ของ intermediate certificate ที่ Air4Thai ไม่ส่งมา (6.1.4) |
| `HSW_HTTP_CACHE` | `update.mjs` | โฟลเดอร์เก็บคำตอบ HTTP: รอบ CAMS เขียน (ชื่อไฟล์ = SHA-1 ของ URL) รอบ SILAM อ่านกลับ จึงใช้ค่าวัดชุดเดียวกันและถามแหล่งข้อมูลครั้งเดียว <!-- src: scripts/update.mjs:183-196 --> |
| `HSW_MODEL` | `update.mjs` | `silam` = ใช้ SILAM แทน CAMS (กริด 0.2°, ไม่มี fire assimilation, ไม่ทำขั้นที่ไม่ขึ้นกับโมเดล PM2.5) ค่าอื่นหรือไม่ตั้ง = CAMS <!-- src: scripts/update.mjs:112-115 --> |
| `HSW_DATA` | `update.mjs` | โฟลเดอร์ข้อมูลของรอบ SILAM (`silam_chain.mjs` ตั้งเป็น `data/silam-run/`) ใช้เฉพาะเมื่อ `HSW_MODEL=silam` <!-- src: scripts/update.mjs:113; scripts/silam_chain.mjs:51 --> |
| `GITHUB_ACTIONS` | ทุกสคริปต์ | ถ้ามี จะพิมพ์ annotation `::notice` / `::warning` ของ GitHub |
| `DEV_USER`, `DEV_PASS` | `lockpage.mjs` | ชื่อผู้ใช้และรหัสผ่านของหน้าที่ล็อก <!-- src: scripts/lockpage.mjs:15 --> |
| `CHAT_EXPORT_TOKEN` | `chat_learn.mjs` | Bearer token ของ `/api/export` <!-- src: scripts/chat_learn.mjs:82 --> |
| `ACC_NOW` | `accuracy.mjs` | เวลาจำลอง "ตอนนี้" ใช้ทดสอบในเครื่องเท่านั้น <!-- src: scripts/accuracy.mjs:133 --> |
| `PERF_TODAY` | `perf.mjs` | วันที่จำลอง ใช้ทดสอบในเครื่องเท่านั้น <!-- src: scripts/perf.mjs:72 --> |
| `SILAM_HIST` | `silam.py` | โฟลเดอร์ history ทดแทน (ทดสอบในเครื่อง) <!-- src: scripts/silam.py:23 --> |
| `ECPR_HIST`, `ECPR_OUT` | `ecmwf_pr.py` | โฟลเดอร์ history และไฟล์ผลทดแทน (ทดสอบ) <!-- src: scripts/ecmwf_pr.py:24-25 --> |
| `SEAHAF_UPDATED` | `chat_llm_label.mjs` | ธงภายในของการอัปเดตตัวเอง ไม่ต้องตั้งเอง <!-- src: scripts/chat_llm_label.mjs:191,201 --> |

ตัวแปรที่ **ห้ามตั้ง**: `NODE_TLS_REJECT_UNAUTHORIZED` (หรือการปิดตรวจ certificate แบบใดก็ตาม) ตาม CLAUDE.md กฎข้อ 3

### 6.1.4 ใบรับรองของ Air4Thai และ `NODE_EXTRA_CA_CERTS`

server ของกรมควบคุมมลพิษ (`air4thai.pcd.go.th`) ส่ง certificate chain ไม่ครบ (ไม่ส่ง intermediate ของ Let's Encrypt)
Node จึงตรวจ chain ไม่ผ่าน วิธีแก้ที่ใช้คือเพิ่ม intermediate ไว้ใน `scripts/certs/air4thai-chain.pem` (chain ไปที่ ISRG Root X1)
แล้วส่งให้ Node ผ่าน `NODE_EXTRA_CA_CERTS` <!-- src: scripts/update.mjs:75-78; .github/workflows/update.yml:108 -->

- ตั้งในขั้น "Fetch data…", ขั้น SILAM chain และใน `climatology.yml` <!-- src: .github/workflows/update.yml:108,119; .github/workflows/climatology.yml:54 -->
- ถ้า Let's Encrypt เปลี่ยน intermediate ให้ใส่ intermediate ใหม่ลงไฟล์ `.pem` นี้ (ต่อท้ายได้หลายใบ)
- **ห้าม**ใช้ `NODE_TLS_REJECT_UNAUTHORIZED=0`, `rejectUnauthorized: false`, `curl -k`, `verify=False` หรือวิธีปิดการตรวจอื่น (CLAUDE.md กฎข้อ 3)
- ถ้า Air4Thai ใช้ไม่ได้ตอนสร้างรายชื่อสถานี ระบบกลับไปใช้สำเนาของสถานีไทยบน OpenAQ (ค่าเฉลี่ย 24 ชม.) <!-- src: scripts/update.mjs:401 -->

---

## 6.2 Workflows (`.github/workflows/`)

### 6.2.1 `update.yml` — Hourly update

| รายการ | ค่า |
|---|---|
| Trigger | (1) external cron (cron-job.org → `workflow_dispatch` ทุกชั่วโมงที่นาที :07); (2) `schedule: '37 */3 * * *'` เป็นสำรองทุก 3 ชม.; (3) `workflow_dispatch` ด้วยมือ; (4) `push` ไป `main` ที่แก้ `scripts/**`, `index.html`, `index_modern.html`, `chat/**`, `assets/**` หรือตัว workflow <!-- src: .github/workflows/update.yml:3-9 --> |
| Permissions | `contents: write`, `pages: write`, `id-token: write` <!-- src: .github/workflows/update.yml:16-19 --> |
| Concurrency | group `hourly-update`, `cancel-in-progress: false` (รอบใหม่รอรอบเก่า ไม่ยกเลิก) <!-- src: .github/workflows/update.yml:21-23 --> |
| Runner / time limit | `ubuntu-latest`, `timeout-minutes: 25` <!-- src: .github/workflows/update.yml:27-28 --> |
| Environment | `github-pages` |

| # | Step | เงื่อนไข / ข้อผิดพลาด | Input | Output |
|---|---|---|---|---|
| 1 | `actions/checkout@v5`, `actions/setup-node@v5` (Node 22) | – | repo | – |
| 2 | Restore working state (`actions/cache/restore@v6`) | key `pipeline-state-<run_id>-<attempt>`, `restore-keys: pipeline-state-` (เอา cache ล่าสุด) <!-- src: .github/workflows/update.yml:38-59 --> | Actions cache | 16 ไฟล์ใน `data/` (ดู 7.5) |
| 3 | Restore history / mltrain (`id: restore`) | ลอง `git ls-remote` และ `git fetch --depth=1` 3 ครั้ง ห่าง 10 วินาที; branch ที่มีอยู่แต่ fetch ไม่ได้ ⇒ **job ล้ม** (กันการเขียนทับด้วย tree ว่าง) <!-- src: .github/workflows/update.yml:61-77 --> | branch `history`, `mltrain` | `data/history/`, `data/mltrain/` |
| 4 | GSMaP server access | ข้ามถ้าไม่มี `GSMAP_USER`; ติดตั้ง `sshpass`; `ssh-keyscan -t ecdsa hokusai.eorc.jaxa.jp` แล้วรับ key เฉพาะเมื่อ fingerprint ตรงกับค่าที่ pin ไว้ ไม่ตรง ⇒ warning และข้ามฝนสังเกต <!-- src: .github/workflows/update.yml:79-87 --> | secret `GSMAP_USER` | `~/.ssh/known_hosts` |
| 5 | SILAM forecast: `python3 scripts/silam.py` | `if: restore success`, `continue-on-error: true`, 6 นาที <!-- src: .github/workflows/update.yml:89-93 --> | FMI S3 bucket | `data/history/YYYY-MM/silam-YYYYMMDD.json` |
| 6 | ECMWF rain 0.25°: `python3 scripts/ecmwf_pr.py` | `continue-on-error: true`, 5 นาที <!-- src: .github/workflows/update.yml:95-99 --> | ECMWF open data (GCS / AWS mirror) | `data/history/YYYY-MM/ecpr-YYYYMMDDHH.json`, `data/ecmwf-pr.json` |
| 7 | Fetch data, correct forecast, write JSON: `node scripts/update.mjs && node scripts/verify.mjs` | ขั้นหลัก ล้ม ⇒ job ล้ม (แต่ขั้นที่มี `if: always()` ยังทำ) env: `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`, `GSMAP_USER`, `GSMAP_PASS`, `IQAIR_API_KEY`, `NODE_EXTRA_CA_CERTS`, `HSW_HTTP_CACHE` <!-- src: .github/workflows/update.yml:101-110 --> | ทุกแหล่งข้อมูล, state, history | `latest.json`, `state.json`, log CSV, ฯลฯ (6.5) และ `verify.json` |
| 8 | SILAM through the same chain: `node scripts/silam_chain.mjs` | `continue-on-error: true`, 8 นาที; env: `OPENAQ_API_KEY`, `FIRMS_MAP_KEY`, `NODE_EXTRA_CA_CERTS`, `HSW_HTTP_CACHE` <!-- src: .github/workflows/update.yml:112-121 --> | `state.json`, `latest.json`, `met.json`, HTTP cache | `data/silam/*.json`, `state.silamState`, `latest.json.silam`, `data/history/silam/` |
| 9 | Model performance: `node scripts/perf.mjs` | `if: always()`, `continue-on-error`, คำนวณใหม่เมื่อ `perf.json` อายุ ≥ 3 ชม. <!-- src: .github/workflows/update.yml:123-127; scripts/perf.mjs:16 --> | `data/history/` | `perf.json`, `perf-series.json` |
| 10 | Public accuracy: `node scripts/accuracy.mjs` | `if: always()`, `continue-on-error`, 3 นาที <!-- src: .github/workflows/update.yml:129-133 --> | `data/history/`, `latest.json` | `accuracy.json` |
| 11 | Save working state (`actions/cache/save@v6`) | `if: always()`; path list เดียวกับขั้น 2 <!-- src: .github/workflows/update.yml:135-156 --> | 16 ไฟล์ | Actions cache |
| 12 | Commit static files (main) และ history | `if: always() && restore success`; commit `data/static` ไป `main` (pull --rebase, push 3 ครั้ง); ลบไฟล์ใน `data/history` ที่วันที่ในชื่อเก่ากว่า 35 วัน; อัปเดต branch `history` ผ่าน worktree: run แรกของวัน UTC ใหม่ = orphan commit เดียวแล้ว force push (`snap-history`), run อื่น = commit ต่อท้าย <!-- src: .github/workflows/update.yml:158-184 --> | `data/static`, `data/history` | branch `main`, `history` |
| 13 | Save ML training store | ลบไฟล์เก่ากว่า 730 วัน; orphan commit เดียวต่อรอบ force push ผ่าน `snap-mltrain` <!-- src: .github/workflows/update.yml:186-202 --> | `data/mltrain` | branch `mltrain` |
| 14 | Build site (`id: build`) | `if: always()`; env `DEV_USER`, `DEV_PASS` (ดูรายละเอียดด้านล่าง) <!-- src: .github/workflows/update.yml:204-255 --> | `index.html`, `index_modern.html`, `perf.html`, `glass/`, `assets/`, `chat/`, `data/` | `_site/` |
| 15 | `configure-pages@v6`, `upload-pages-artifact@v5` (path `_site`) | ถ้า build สำเร็จ | `_site` | Pages artifact |
| 16 | `sleep 15` แล้ว `deploy-pages@v5` (`id: deployment`, `continue-on-error`) | ล้ม ⇒ `sleep 45` แล้ว `deployment_retry` อีกครั้ง; ล้มครั้งที่สอง ⇒ job ล้ม <!-- src: .github/workflows/update.yml:263-276 --> | artifact | GitHub Pages |
| 17 | `id: cf`: ตรวจว่ามี `CLOUDFLARE_API_TOKEN` และ `CLOUDFLARE_ACCOUNT_ID` | output `on=true/false` <!-- src: .github/workflows/update.yml:282-284 --> | secrets | – |
| 18 | Deploy to Cloudflare Pages | `continue-on-error`; ถ้า `wrangler.toml` ยังมี `SET_BY_CLOUDFLARE_SETUP` ⇒ warning ให้รัน setup ก่อน; คัด `functions/`, `wrangler.toml`, `_site` ไปที่ `$RUNNER_TEMP/cfpages` (นอก repo) แล้ว `npx -y wrangler@4.160.1 pages deploy site --project-name sea-haf --branch main --commit-dirty=true` ลอง 3 ครั้ง (รอ 20, 40 วินาที) <!-- src: .github/workflows/update.yml:285-302 --> | `_site`, `cloudflare/pages/` | https://sea-haf.pages.dev |

รายละเอียดขั้น Build site <!-- src: .github/workflows/update.yml:211-255 -->

1. `_site/dev.html` = `index.html` ตามที่เขียน (หน้า developer)
2. `_site/classic.html` = `index.html` ที่เปลี่ยน `<html lang="en">` เป็น `data-mode="public"`
3. `_site/index.html` = `node scripts/build_modern.mjs index.html index_modern.html _site/index.html` แล้วตั้ง `data-mode="public"`; คัดลอกเป็น `_site/index_modern.html` ด้วย
4. คัด `glass/nav.mjs`, `glass/water.mjs`, `glass/boot.mjs` → `_site/glass/`; `assets/*.svg` → `_site/assets/`; `chat/model.json`, `chat/config.json` → `_site/chat/`
5. `BUILD` = 12 ตัวแรกของ SHA-1 ของ `index.html index_modern.html glass/*.mjs` (สามไฟล์) ใส่ใน `<meta name="build">` ของทั้ง 4 หน้า และ `_site/build.txt`
6. `_site/data/stamp.json` = `{generated, build}` (หน้าเว็บตรวจทุก 3 นาทีเพื่อรีเฟรชอัตโนมัติ)
7. `lockpage.mjs` เข้ารหัส `dev.html` และ `perf.html`; ถ้า `dev.html` ยังมี `data-mode` หรือ `id="map"` (ไม่ได้เข้ารหัส) ⇒ ขั้นนี้ล้ม
8. ถ้าไม่มี `data/met-traj.json` แต่มี `met.json` และ `latest.json` ⇒ สร้างใหม่ด้วย `packTraj` (ช่วง −49 ชม. ถึง +75 ชม.)
9. คัดไฟล์ข้อมูลไป `_site/data/`: `latest.json met-web.json met-traj.json ml-field.json t2-corr.json rain-obs.json ecmwf-pr.json wx-ml.json perf.json perf-series.json rk-bias.json rk-bias-A.json verify.json runlog.json accuracy.json pm-mean.json`; static `elev.json elev025.json th-adm2.json th-adm3.json`, โฟลเดอร์ `data/static/prclim/`, `data/pm-days/` และ `data/silam/*.json` (ถ้ามี `data/silam/latest.json`)

### 6.2.2 `climatology.yml` — Station climatology

| รายการ | ค่า |
|---|---|
| Trigger | `workflow_dispatch` เท่านั้น (สร้างครั้งเดียวเป็นความรู้ตั้งต้น ไม่สร้างใหม่ตามรอบ) <!-- src: .github/workflows/climatology.yml:3-9 --> |
| Permissions / concurrency / time limit | `contents: write`; group `climatology`; 90 นาที |

| # | Step | Input | Output |
|---|---|---|---|
| 1 | checkout, setup-node 22 | – | – |
| 2 | Restore the hourly run's state: `cache/restore@v6` ด้วย path list **เดียวกับ** update.yml (version ของ cache ขึ้นกับ list), key `climatology-none-<run_id>`, `restore-keys: pipeline-state-`; **ไม่ save** จึงไม่แตะ cache ของรอบรายชั่วโมง <!-- src: .github/workflows/climatology.yml:27-50 --> | Actions cache | `data/state.json` (รายชื่อสถานี) |
| 3 | `node scripts/climatology.mjs` env `OPENAQ_API_KEY`, `NODE_EXTRA_CA_CERTS` <!-- src: .github/workflows/climatology.yml:51-55 --> | OpenAQ archive บน S3, OpenAQ v3 locations, Air4Thai history | `data/static/pm-clim.json` |
| 4 | Commit `data/static/pm-clim.json` ไป `main` (pull --rebase/push 4 ครั้ง) <!-- src: .github/workflows/climatology.yml:56-63 --> | – | commit บน `main` |

### 6.2.3 `prclim.yml` — Rain climatology factors

| รายการ | ค่า |
|---|---|
| Trigger | `workflow_dispatch`; `push` ไป `main` ที่แก้ `prclim.yml` หรือ `scripts/prclim.py` <!-- src: .github/workflows/prclim.yml:7-11 --> |
| Time limit | 40 นาที, Python 3.12 |

| # | Step | Input | Output |
|---|---|---|---|
| 1 | Find the CHELSA files: list bucket `os.unil.cloud.switch.ch/chelsa02` (prefix climatologies/pr) แล้วถ้าไม่ครบ 12 ไฟล์ลอง bucket EnviCloud ชื่อมาตรฐาน V2.1; ต้องได้ ≥ 12 ไฟล์ <!-- src: .github/workflows/prclim.yml:22-39 --> | CHELSA V2.1 1981–2010 COG | `files.txt` |
| 2 | Build the factors: `pip install rasterio numpy`; `python scripts/prclim.py files.txt data/static/prclim` | `files.txt` | `data/static/prclim/factor_MM.bin` (12 ไฟล์), `meta.json` |
| 3 | ThaiWater reachability (`continue-on-error`): curl `rain_24h` และ `thailand_main` | ThaiWater API | annotation เท่านั้น |
| 4 | Commit `data/static/prclim` | – | commit บน `main` |

### 6.2.4 `chat-train.yml` — Chat bot training

| รายการ | ค่า |
|---|---|
| Trigger | `schedule: '23 20 * * 0'` (วันจันทร์ 03:23 เวลาไทย) และ `workflow_dispatch` <!-- src: .github/workflows/chat-train.yml:12-15 --> |
| Permissions / time limit | `contents: write`, 10 นาที |

| # | Step | Input | Output |
|---|---|---|---|
| 1 | `node scripts/chat_learn.mjs` env `CHAT_EXPORT_TOKEN` | `/api/export` ของ Cloudflare Pages (`chat/config.json` → `feedback.exportUrl`) | `chat/learned.json`, `chat/test_real.json` |
| 2 | `node scripts/chat_train.mjs --gate` | `scripts/chat_data.mjs`, `chat/data/*`, `chat/learned.json` | `chat/model.json` (คงโมเดลเดิมถ้าความแม่นบนชุดทดสอบลดลงเกิน 1 จุด) |
| 3 | `node --test scripts/chatml.test.mjs scripts/chat_pages.test.mjs` | – | ผลทดสอบ |
| 4 | Commit `chat/learned.json chat/test_real.json chat/model.json` | – | commit บน `main` (รอบรายชั่วโมงถัดไปเผยแพร่) |

<!-- src: .github/workflows/chat-train.yml:33-48 -->

### 6.2.5 `lapse-check.yml` — Open-Meteo lapse-rate check

ครั้งเดียว: `push` ไป `main` ที่แก้ตัว workflow หรือ `scripts/checks/openmeteo_lapse.py`; `contents: read`; 5 นาที;
รัน `python3 scripts/checks/openmeteo_lapse.py` ซึ่งเทียบ `temperature_2m` ของ Open-Meteo แบบปกติกับ `elevation=nan` ที่ 10 จุดในภาคเหนือ
เพื่อหา lapse rate ที่ Open-Meteo ใช้ ผลเป็น annotation เท่านั้น ไม่มีไฟล์ output <!-- src: .github/workflows/lapse-check.yml:1-14; scripts/checks/openmeteo_lapse.py:1-4 -->

### 6.2.6 `cloudflare-setup.yml` — Cloudflare setup

| รายการ | ค่า |
|---|---|
| Trigger | `workflow_dispatch` (ครั้งเดียว รันซ้ำได้ปลอดภัย ของที่มีอยู่แล้วไม่ถูกแก้) <!-- src: .github/workflows/cloudflare-setup.yml:3-12 --> |
| env | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CHAT_EXPORT_TOKEN` (จาก secrets), `PROJECT=sea-haf`, `DB_NAME=sea-haf-db`, `KV_TITLE=sea-haf-kv` <!-- src: .github/workflows/cloudflare-setup.yml:21-27 --> |
| สิทธิ์ของ API token (ที่เจ้าของสร้าง) | Cloudflare Pages Edit, D1 Edit, Workers KV Storage Edit <!-- src: .github/workflows/cloudflare-setup.yml:8-10 --> |

| # | Step | Output |
|---|---|---|
| 1 | Check the secrets: ไม่มี token/account ⇒ error | – |
| 2 | Pages project `sea-haf` (production branch `main`, direct upload), D1 `sea-haf-db` และตารางจาก `cloudflare/pages/schema.sql` (ทุกคำสั่ง `IF NOT EXISTS`), KV `sea-haf-kv`; เขียน `database_id` และ KV `id` ลง `cloudflare/pages/wrangler.toml` (ไม่ใช่ความลับ) <!-- src: .github/workflows/cloudflare-setup.yml:36-59 --> | Cloudflare resources, `wrangler.toml` |
| 3 | Pages secret `EXPORT_TOKEN` จาก `CHAT_EXPORT_TOKEN` (รัน wrangler ใน `$RUNNER_TEMP`) | Pages secret |
| 4 | Commit the ids | commit `wrangler.toml` บน `main` |

---

## 6.3 Configuration reference (เทียบ namelist ของ WRF)

### 6.3.1 `const CFG` ใน `scripts/update.mjs`

<!-- src: scripts/update.mjs:38-102 -->

สัญลักษณ์ **[ห้ามปรับเอง]** = ค่าที่ต้องมาจากสคริปต์ fit เท่านั้น (6.3.3)

| คีย์ | ค่าปัจจุบัน | หน่วย | ความหมาย | ใช้โดย |
|---|---|---|---|---|
| `bbox` | `[92.0, 5.5, 110.0, 24.5]` | ° [W,S,E,N] | พื้นที่ค้นสถานี จุดความร้อน และ DEM ของอุณหภูมิ | `update.mjs` (OpenAQ, Air4Thai, FIRMS), `landcover.mjs`, `t2down` key <!-- src: scripts/update.mjs:40 --> |
| `gridBbox` | `[92.0, 5.5, 110.0, 24.0]`; โหมด SILAM `[92.0, 5.4, 110.0, 24.2]` | ° | กริดที่ดึง CAMS และกริดของ RK / ML field | `update.mjs` <!-- src: scripts/update.mjs:41,114 --> |
| `gridStep` | `0.5`; โหมด SILAM `0.2` | ° | ระยะกริด CAMS (คุมจำนวนจุดใน free tier ของ Open-Meteo) | `update.mjs` <!-- src: scripts/update.mjs:42,114 --> |
| `camsRefreshH` | `12` | ชม. | ดึง CAMS ใหม่เมื่ออายุเกิน (CAMS ออกวันละ 2 รอบ) หรือรายชื่อสถานี/กริดเปลี่ยน | `update.mjs` <!-- src: scripts/update.mjs:43,422 --> |
| `met.refreshH` | `12` | ชม. | ดึง ECMWF IFS ใหม่เมื่ออายุเกิน | `update.mjs` → `met.mjs` <!-- src: scripts/update.mjs:44,514 --> |
| `met.grids` | `north`: bbox `[96.5, 14.5, 102.5, 21.5]`, step `0.25`; `domain`: bbox `[92, 5, 110, 25]`, step `1.0` | ° | กริดซ้อนของอุตุนิยมวิทยา (ละเอียดในภาคเหนือ) | `met.mjs fetchMet` <!-- src: scripts/update.mjs:45 --> |
| `stationRefreshH` | `24` | ชม. | สร้างรายชื่อสถานีใหม่วันละครั้ง | `update.mjs` <!-- src: scripts/update.mjs:46 --> |
| `budget.optionalMin` | `16` | นาที นับจากเริ่ม run | เกินแล้วข้ามขั้นไม่จำเป็น (radar frames, GSMaP/gauges, t2/weather ML) เพื่อให้ forecast และ state ยังถูกเขียนก่อน job ถูกฆ่าที่ 25 นาที (ไม่ใช้ในโหมด SILAM) | `update.mjs late()` <!-- src: scripts/update.mjs:47-49,371 --> |
| `budget.fallbackMin` | `6` | นาที | เวลาสูงสุดของการดึง OpenAQ ทีละ location เมื่อ bulk ล้ม | `oaqLatest` <!-- src: scripts/update.mjs:254 --> |
| `maxStations` | `700` | สถานี | จำนวนสถานีสูงสุด (reference monitor ก่อน แล้วเซนเซอร์ราคาประหยัด) | `update.mjs` <!-- src: scripts/update.mjs:50,404 --> |
| `obsMaxAgeH` | `3` | ชม. | ไม่ใช้ค่าวัดที่เก่ากว่านี้ | `update.mjs` (หลายจุด) <!-- src: scripts/update.mjs:51,482 --> |
| `firmsSources` | `['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT']` | – | ชุดข้อมูล FIRMS ที่ดึง | `firmsHotspots` <!-- src: scripts/update.mjs:52 --> |
| `firmsDays` | `2` | วัน | ช่วงย้อนหลังของจุดความร้อน | `firmsHotspots` <!-- src: scripts/update.mjs:53 --> |
| `kf` | `{ Q: 0.02, R: 0.15, P0: 0.5, maxGapH: 48 }` | Q, R, P0: (หน่วย ln)²; maxGapH: ชม. | Kalman filter บน log-ratio bias b = ln(obs+1) − ln(raw+1): Q = process noise ต่อชั่วโมง, R = observation noise, P0 = ความแปรปรวนเริ่มต้น, เริ่มใหม่ถ้าห่างเกิน maxGapH; สถานีค่าเฉลี่ย 24 ชม. ใช้ R × 24 | `kfStep`, `stationForecast` <!-- src: scripts/update.mjs:55,347-356,845 --> |
| `kfSlow` | `{ Q: 0.002, R: 0.15, P0: 0.5, maxGapH: 168 }` | เหมือน `kf` | bias ช้า (หลายสัปดาห์) ของ CAMS ปรับเฉพาะชั่วโมงที่ควันไฟจำลอง < 1 µg/m³ ใช้หักออกจาก innovation ของ fire assimilation | `update.mjs` → `assim.mjs` <!-- src: scripts/update.mjs:56-58,851 --> |
| `assimilate` | `true`; โหมด SILAM `false` | bool | เปิด fire-emission assimilation (SILAM มีการปล่อยจากไฟของตัวเอง ตัดสิน 21 พ.ย. 2026) | `update.mjs` → `assim.mjs` <!-- src: scripts/update.mjs:59,115 --> |
| `biasLeadEfoldH` | `48` | ชม. | การแก้ bias จาง e-fold ตาม lead: (raw+1)·exp(b·e^(−L/48)) − 1 | `correct()`; ส่งให้หน้าเว็บใน `latest.json` `rk.leadEfoldH` <!-- src: scripts/update.mjs:60,357 --> |
| `rk.residStep` | `0.025` | ° | กริด residual ของ regression kriging (แผนที่ 0.025°) | `runRK`, `rk.mjs` <!-- src: scripts/update.mjs:63 --> |
| `rk.coarseStep` | `0.1` | ° | สำเนาหยาบใน `latest.json` (`rk.bias`) | `runRK` <!-- src: scripts/update.mjs:1131 --> |
| `rk.demStep` | `0.05` | ° | ความละเอียด DEM ของ RK (`data/static/elev.json`) | `buildDEM` <!-- src: scripts/update.mjs:1058 --> |
| `rk.minStations` | `15` | สถานี | น้อยกว่านี้ข้าม RK | `runRK` <!-- src: scripts/update.mjs:1085 --> |
| `rk.K` | `16` | สถานี | จำนวนเพื่อนบ้านใน kriging | `regressionKriging`, `krigeField` |
| `rk.declusterDeg` | `0.25` | ° | ขนาดเซลล์ declustering ของ regression (≈ 28 กม.) | `regressionKriging` |
| `rk.lowcost` | `LOWCOST` (6.3.2) | – | ค่าตั้งเซนเซอร์ราคาประหยัด | `lowcost.mjs`, `runRK` <!-- src: scripts/update.mjs:63 --> |
| `mlField` | `0.1` | ° | กริดของแผนที่แก้ ML (kriged ทุก 3 ชม. ถึง `MLCFG.applyMaxLeadH`) | `update.mjs` → `ml-field.json` <!-- src: scripts/update.mjs:64,1016 --> |
| `logLeads` | `[1, 3, 6, 12, 24, 48]` | ชม. | lead ที่บันทึกใน `fcst-*.csv` และ `wxf-*.csv` | `update.mjs` <!-- src: scripts/update.mjs:65 --> |
| `climBlend` **[ห้ามปรับเอง]** | `cams: [[24,0],[48,0],[72,0],[96,0]]`, `silam: [[24,0],[48,0],[72,0],[96,0],[120,0]]` | [lead ชม., w] | น้ำหนักดึง forecast ระยะยาวเข้าหา climatology: ln(B+1) = (1−w)·ln(F+1) + w·ln(C+1) **ปัจจุบันเป็นศูนย์และยังไม่มีโค้ดที่นำไปใช้** | `fit_clim_blend.mjs` (ผู้ผลิตค่า) <!-- src: scripts/update.mjs:66-70 --> |
| `climLogLeads` | `[24, 36, 48, 60, 72, 84, 96, 108, 120]` | ชม. | lead ที่บันทึกใน `climfc-*.csv` ทุก 3 ชม. | `update.mjs` <!-- src: scripts/update.mjs:71,1215-1222 --> |
| `avg24Providers` | `['Air4Thai', 'Air4Thai · Bangkok (BMA)']` | – | provider ที่ค่าเป็นค่าเฉลี่ยเคลื่อนที่ 24 ชม. (สำเนาบน OpenAQ และ BMA feed) | `isAvg24` <!-- src: scripts/update.mjs:74,366 --> |
| `a4t.list` | `https://air4thai.pcd.go.th/services/getNewAQI_JSON.php` | URL | รายชื่อสถานี Air4Thai และค่าล่าสุด | `a4tStations` <!-- src: scripts/update.mjs:79 --> |
| `a4t.hist` | `https://air4thai.pcd.go.th/webV2/history/api/data.php` | URL | ค่ารายชั่วโมงย้อนหลัง | `a4tHourly` |
| `a4t.dedupKm` | `1.0` | กม. | ตัดสำเนา OpenAQ ที่อยู่ใกล้สถานี Air4Thai | `update.mjs` <!-- src: scripts/update.mjs:80,398 --> |
| `a4t.chunk` | `40` | สถานี/คำขอ | จำนวนสถานีต่อคำขอ history | `a4tHourly` |
| `a4t.retryH` | `3` | ชม. | ลอง Air4Thai ใหม่เมื่อรายชื่อไม่มีสถานี hourly | `update.mjs` <!-- src: scripts/update.mjs:385 --> |
| `a4t.types` | `['GROUND', 'BKK']` | – | ประเภทสถานีที่ใช้ (BKK = เครือข่าย กทม. อ่านจาก live feed เป็นค่าเฉลี่ย 24 ชม.; ไม่ใช้ MOBILE) | `a4tStations` <!-- src: scripts/update.mjs:80-81 --> |
| `stationListVer` | `3` | – | เพิ่มค่าเพื่อบังคับสร้างรายชื่อสถานีใหม่ในรอบถัดไป | `update.mjs` <!-- src: scripts/update.mjs:82,388 --> |
| `blendByLead` | `[[1,0.97],[3,0.94],[6,0.89],[12,0.78],[24,0.68],[48,0.5]]` | [lead ชม., w] | ค่าเฉลี่ย 24 ชม. ของสถานี = w·persistence + (1−w)·corrected; เส้นตรงใน ln(L); fit บน hindcast 2024–26 (ค่าคงที่ 0.5 ตั้งแต่ 48 ชม.) | `blendW` → `stationForecast` <!-- src: scripts/update.mjs:83-87,105-106 --> |
| `blendBelt.box` | `[97, 17.5, 105.5, 22.5]` | ° | เขตไฟภาคเหนือ (SEA-HAF v1.0, 6 ต.ค. 2026) | `inBelt` <!-- src: scripts/update.mjs:92,104 --> |
| `blendBelt.byLead` | `[[1,0.97],[3,0.94],[6,0.89],[12,0.78],[24,0.74],[48,0.65]]` | [lead ชม., w] | น้ำหนัก persistence ในเขตไฟ (24 ชม. 0.74, 48 ชม. 0.65) | `blendW` |
| `rainBlend.shift` **[ห้ามปรับเอง]** | `[[1,0.12],[2,0.14],[3,0],[6,0],[9,0],[12,0],[18,0],[24,0],[30,0],[36,0],[42,0],[48,0]]` | [lead ชม., w] | น้ำหนักของ ECMWF ที่อ่านเลื่อนเวลา `shiftH` บน ln(R+0.2) | หน้าเว็บ `rainBlend()` ผ่าน `latest.json rainObs.corr.w` <!-- src: scripts/update.mjs:100,646; index.html:2101 --> |
| `rainBlend.amount` **[ห้ามปรับเอง]** | ศูนย์ทุก lead (1–48 ชม.) | [lead, w] | น้ำหนักของ ECMWF × ตัวคูณ radar/ECMWF 72 ชม. | หน้าเว็บ |
| `rainBlend.persist` **[ห้ามปรับเอง]** | `[[1,0.12],[2,0.19],[3,0],…,[48,0]]` | [lead, w] | น้ำหนักของ radar ชั่วโมงเดียวกันของวันล่าสุดที่สังเกต (diurnal persistence) | หน้าเว็บ |
| `rainBlend.nowcast` **[ห้ามปรับเอง]** | `[[1,0.74],[2,0.5],[3,0]]` | [lead, w] | น้ำหนักของ radar nowcast (ค่าที่ fit แทนค่าชั่วคราวในหน้าเว็บ; ถ้าเป็น `null`/ว่าง หน้าเว็บใช้ค่าตั้งต้นของตัวเอง) | หน้าเว็บ `nowcastFitted()` <!-- src: index.html:2099-2100 --> |
| `rainLogLeads` | `[1, 2, 3, 6, 9, 12, 18, 24, 30, 36, 42, 48]` | ชม. | lead ที่บันทึกใน `rainfc-*.csv` ทุก 3 ชม. | `update.mjs` <!-- src: scripts/update.mjs:101,636 --> |

ค่าคงที่อื่นใน `update.mjs` ที่ไม่อยู่ใน `CFG`: `PM25_ID = 2` (parameter id ของ pm25 ใน OpenAQ) <!-- src: scripts/update.mjs:103 -->,
ช่วงค่าที่รับ 0 ≤ PM2.5 < 1500 µg/m³ <!-- src: scripts/update.mjs:293,482 -->, ค่าเฉลี่ย 24 ชม. ต้องมี ≥ 18 จาก 24 ชั่วโมง <!-- src: scripts/update.mjs:365,498 -->,
ช่วงหน้าต่างของ `met-web.json` −36 ถึง +75 ชม. และของ `met-traj.json` −49 ถึง +75 ชม. <!-- src: scripts/update.mjs:650,653 -->
และ hotspot ที่ใช้ซ้ำได้เมื่อ FIRMS ล่มต้องอายุ < 12 ชม. <!-- src: scripts/update.mjs:782 -->

### 6.3.2 ค่าคงที่ที่ export จากโมดูลอื่น

#### การแก้ด้วย ML v1 — `scripts/ml.mjs`

`MLCFG` <!-- src: scripts/ml.mjs:31-35 -->

| คีย์ | ค่า | หน่วย | ความหมาย |
|---|---|---|---|
| `applyMaxLeadH` | `24` | ชม. | ใช้การแก้ ML กับ lead ≤ 24 ชม. เท่านั้น (hindcast 2024–26: ช่วยที่ 24 ชม. แต่ไม่ช่วยที่ 48 ชม.) |
| `maxLeadH` | `48` | ชม. | lead สูงสุดที่บันทึกและฝึก expert |
| `windows` | `{ day: 3, week: 7, month: 30 }` | วัน | หน้าต่างข้อมูลฝึกของ expert แต่ละตัว |
| `minDays` | `{ day: 1, week: 7, month: 30 }` | วัน | วันที่ตรวจแล้วขั้นต่ำก่อน expert เริ่มทำงาน |
| `shrinkK` | `20` | แถว | shrinkage n/(n+20) ของ expert `day` |
| `ridgeLambda` | `3` | – | ridge penalty ของ expert `week` (คูณ n/100) |
| `gbm` | `{ nTrees: 150, depth: 3, lr: 0.08, minLeaf: 40, bins: 32, subsample: 0.8, lambda: 1, maxRows: 120000 }` | – | gradient-boosted trees ของ `month` / `season` |
| `eta` | `2` | – | learning rate ของ exponentially weighted forecaster: w ← w·exp(−η·L) |
| `share` | `0.05` | – | fixed share α |
| `clip` | `Math.LN2` (= 0.693) | ln | จำกัดการแก้รวมที่ ±ln 2 (ไม่เกินสองเท่า) |
| `minRowsDay` | `300` | แถว | แถวขั้นต่ำต่อวันที่ใช้ให้คะแนน |

| ค่าคงที่ | ค่า | ความหมาย |
|---|---|---|
| `EXPERTS` | `['base', 'day', 'week', 'month', 'season', 'hindcast']` <!-- src: scripts/ml.mjs:36 --> | expert ของ v1 |
| `STORE` | `{ maxPerDay: 8000, keepDays: 730, minDaysSeason: 30 }` <!-- src: scripts/ml.mjs:46 --> | คลังฝึกระยะยาว (branch `mltrain`): สุ่มแถวไม่เกิน 8,000 ต่อวัน เก็บ 730 วัน, expert `season` ต้องมี ≥ 30 วัน |
| `FEAT_COLS` | `['inc','fire','blh','ws','pr','obs_last','obs24_last','kfAb','hloc','doy','t2','rh','ws10','wd','o_ws','o_wd','o_t2','o_rh']` <!-- src: scripts/ml.mjs:77 --> | คอลัมน์ feature ดิบที่เขียนลง `fcst-*.csv` |
| `NAMES` | `['lead','lnF','lnCams','lnInc','lnFire','lnBlh','ws','pr','lnObsLast','lnObs24','kfAb','hsin','hcos','dsin','dcos','lat','lon','t2','rh','ws10','wdsin','wdcos','oT2','oRh','oWs','oWdsin','oWdcos','dT2','dRh','dWs']` (30 ตัว) <!-- src: scripts/ml.mjs:78 --> | feature ของ model (หลังแปลงด้วย `featureVector`) |
| `LC_SAMPLE` | `8` <!-- src: scripts/ml.mjs:105 --> | ใช้เซนเซอร์ราคาประหยัดที่ผ่าน QC 1 ใน 8 sensor-day ในการฝึก |

ฤดูกาลของ `seasonOf` (กรมอุตุนิยมวิทยา, วันที่ไทย): ฤดูร้อน 16 ก.พ.–15 พ.ค., ฤดูฝน 16 พ.ค.–15 ต.ค., ฤดูหนาว 16 ต.ค.–15 ก.พ. <!-- src: scripts/ml.mjs:39-44 -->

#### แกนการเรียนรู้ร่วม — `scripts/mlcore.mjs`

| ค่าคงที่ | ค่า |
|---|---|
| `CORECFG` | `{ windows: { day: 3, week: 7, month: 30 }, minDays: { day: 1, week: 7, month: 30 }, shrinkK: 20, ridgeLambda: 3, gbm: { nTrees: 150, depth: 3, lr: 0.08, minLeaf: 40, bins: 32, subsample: 0.8, lambda: 1, maxRows: 120000 }, eta: 2, share: 0.05, minRowsDay: 200, minDaysSeason: 30 }` <!-- src: scripts/mlcore.mjs:11-13 --> |
| `EXPERTS` | `['base', 'day', 'week', 'month', 'season']` (ไม่มี hindcast) <!-- src: scripts/mlcore.mjs:14 --> |

#### การแก้ ML v2 (ผู้สมัคร) — `scripts/ml2.mjs`

`ML2` <!-- src: scripts/ml2.mjs:24 -->

| คีย์ | ค่า | หน่วย | ความหมาย |
|---|---|---|---|
| `clip` | `60` | µg/m³ | จำกัดเป้า y = obs − F ที่ ±60 |
| `maxLeadH` | `24` | ชม. | lead สูงสุดที่ฝึกและใช้ |
| `thr` | `37.5` | µg/m³ | เกณฑ์ "ชั่วโมงสูง" ของประตู |
| `checkDays` | `14` | วัน | หน้าต่างของ `pmHighCheck` |
| `minRows` | `20000` | แถว | แถวขั้นต่ำก่อนตัดสิน |
| `minHigh` | `100` | ชั่วโมง | ชั่วโมงสูงขั้นต่ำก่อนตัดสิน |
| `obsDays` | `10` | วัน | ประวัติค่าวัดที่โหลดเพื่อคำนวณ feature ตอนพยากรณ์ |

| ค่าคงที่ | ค่า |
|---|---|
| `HIST_NAMES` | `['lnOSame', 'lnOSame2', 'lnMax24', 'lnP90_72', 'lnClimH', 'lnClimMH', 'lnP90MH']` (5 จาก log + 2 จาก climatology หลายปี) <!-- src: scripts/ml2.mjs:25 --> |
| `NAMES2` | `[...NAMES, ...HIST_NAMES]` (37 ตัว) <!-- src: scripts/ml2.mjs:36 --> |
| `CFG2` | `{ ...CORECFG, minRowsDay: 300, minDays: { day: 1, week: 7, month: 10 }, gbm: { ...CORECFG.gbm, nTrees: 200, depth: 5, minLeaf: 60 } }` <!-- src: scripts/ml2.mjs:39 --> |
| `ENG2` | `makeEngine(NAMES2, ML2.clip, CFG2)` (ใช้ expert `base, day, week, month, season` ของ mlcore) <!-- src: scripts/ml2.mjs:40 --> |

การเปลี่ยน `HIST_NAMES` ทำให้ `state.ml2.nFeat` ไม่ตรง ⇒ การเรียนรู้ v2 เริ่มใหม่ และประตูนับเฉพาะแถวตั้งแต่ `state.ml2.since` (ตั้งใจ) <!-- src: scripts/update.mjs:382 -->

#### Fire assimilation — `scripts/assim.mjs`

`ASSIM` <!-- src: scripts/assim.mjs:21-22 -->

| คีย์ | ค่า | หน่วย | ความหมาย |
|---|---|---|---|
| `groupDeg` | `0.5` | ° | กลุ่มไฟ = เซลล์ 0.5° × วันสุริยะท้องถิ่น |
| `sigmaB` | `Math.LN2` | ln | prior σ ของ ln(ตัวคูณการปล่อย) (ไม่แน่นอนราวสองเท่า) |
| `sigmaMin` | `3` | µg/m³ | ค่าต่ำสุดของ σ ค่าวัด |
| `rel` | `0.3` | – | σ ค่าวัดเชิงสัมพัทธ์ (30 % ของ y) |
| `epsModel` | `0.5` | – | ความคลาดเคลื่อนของ transport model ต่อสัญญาณไฟที่จำลอง |
| `kappa0` / `kappaMin` / `kappaMax` | `4` / `1` / `20` | – | ตัวคูณ R เริ่มต้นและขอบเขต (ปรับด้วย χ² test) |
| `minF` | `1.0` | µg/m³ | ใช้เฉพาะค่าวัดที่โมเดลบอกว่ารับควันไฟ ≥ 1 |
| `windowH` | `48` | ชม. | หน้าต่างค่าวัดย้อนหลัง |
| `spinupH` | `6` | ชม. | spin-up ของ puff model |
| `maxSources` | `800` | กลุ่ม | จำนวนกลุ่มไฟสูงสุด |
| `maxIter` | `10` | รอบ | Gauss–Newton |
| `horizonH` | `72` | ชม. | ระยะพยากรณ์ของ increment |

#### Hindcast expert — `scripts/hindcast.mjs`, `scripts/hindcast_train.mjs`

| ค่าคงที่ | ค่า |
|---|---|
| `HC_NAMES` | `['lead', 'lnCams', 'lnCams24', 'lnObs24', 'hsin', 'hcos', 'dsin', 'dcos', 'lat', 'lon']` <!-- src: scripts/hindcast.mjs:13 --> |
| `HC` | `{ fromMD: 1218, toMD: 430 }` = ใช้งาน 18 ธ.ค.–30 เม.ย. (วันที่ไทย; month×100 + day) <!-- src: scripts/hindcast.mjs:14 --> |
| `HCFIT` | `{ seasons: [2024, 2025, 2026], thr: 37.5, delayH: 12, gbm: { nTrees: 300, depth: 4, lr: 0.06, minLeaf: 200, bins: 32, subsample: 0.8, lambda: 1, maxRows: 400000 } }` (`delayH` = run มาถึงช้า 12 ชม. หลัง base time) <!-- src: scripts/hindcast_train.mjs:14-15 --> |

#### Climatology และ clim-blend fit

| ค่าคงที่ | ค่า |
|---|---|
| `CLIM` (`climatology.mjs`) | `{ years: 3, minN: 10, a4tHist: 'https://air4thai.pcd.go.th/webV2/history/api/data.php', a4tChunk: 40, oaqArchive: 'https://openaq-data-archive.s3.amazonaws.com', oaqApi: 'https://api.openaq.org/v3', copyKm: 1.0, conc: 24 }` (3 ปี, ≥ 10 ค่าต่อเซลล์, สำเนา OpenAQ ภายใน 1 กม., ดาวน์โหลดพร้อมกัน 24) <!-- src: scripts/climatology.mjs:21-22 --> |
| `FIT` (`fit_clim_blend.mjs`) | `{ thr: 37.5, minRows: 2000, minHigh: 50, step: 0.05 }` (ลอง w = 0, 0.05, …, 1) <!-- src: scripts/fit_clim_blend.mjs:14 --> |

#### Nowcast และการตรวจข้อมูลวัด

| ค่าคงที่ | ค่า | ความหมาย |
|---|---|---|
| `PMNOW` (`pmnow.mjs`) | `{ tauH: 2, maxLeadH: 6, maxErr: 1.5, maxAgeH: 3, checkDays: 14, keepH: 12 }` <!-- src: scripts/pmnow.mjs:15 --> | error จาง e^(−L/2 ชม.), ตัดหลัง 6 ชม., error (ln) จำกัด ±1.5, ค่าวัดล่าสุดต้องอายุ ≤ 3 ชม., ประตู 14 วัน, เก็บ forecast เก่า 12 ชม. |
| `SPIKE` (`obsqc.mjs`) | `{ min: 300, ratio: 5, backH: 3 }` <!-- src: scripts/obsqc.mjs:8 --> | ตัดค่าที่ > 300 µg/m³ และ > 5 เท่าของค่าสูงสุดที่เก็บไว้ใน 3 ชม. ก่อนหน้า; `resetAfterSpikes` เก็บประวัติ `keepH = 96` ชม. <!-- src: scripts/obsqc.mjs:43 --> |
| `LOWCOST` (`lowcost.mjs`) | `{ use: true, a: -3.286, b: 0.9245, windowD: 30, keepD: 35, minDays: 10, minCommon: 7, r1: 50, r2: 100, rMin: 0.6, ratio: [0.5, 2] }` <!-- src: scripts/lowcost.mjs:8 --> | ref = a + b·sensor; QC ย้อนหลัง 30 วัน (เก็บ 35 วัน) ต้องมี ≥ 10 วัน, เพื่อนบ้านใน 50 กม. (≥ 2 สถานี) หรือ 100 กม. (≥ 1) ที่มีวันร่วม ≥ 7, r ≥ 0.6 กับ median ของเพื่อนบ้าน และอัตราส่วนเฉลี่ย 0.5–2 |
| `PMM` (`pmmean.mjs`) | `{ minHours: 18, week: 7, month: 30 }` <!-- src: scripts/pmmean.mjs:16 --> | วันหนึ่งต้องมีการวิเคราะห์ ≥ 18 ชั่วโมงจึงนับเป็นวันสมบูรณ์ |

#### อุตุนิยมวิทยา — `scripts/met.mjs`, `scripts/t2down.mjs`, `scripts/mlwx.mjs`

| ค่าคงที่ | ค่า |
|---|---|
| `MET_MODEL` | `'ecmwf_ifs'` (ECMWF IFS HRES 9 กม. ผ่าน Open-Meteo; ระดับความกดใช้ `ecmwf_ifs025`) <!-- src: scripts/met.mjs:11,51 --> |
| `UP_VARS` | `['u925', 'v925', 'u850', 'v850', 'u700', 'v700', 'z925', 'z850', 'z700']` <!-- src: scripts/met.mjs:13 --> |
| `N2_DEFAULT` | `1e-4` s⁻² (ใช้เมื่อคำขอ pressure level ล้ม) <!-- src: scripts/met.mjs:14 --> |
| `MET_TAPER` | `0.5` ° (ความกว้างรอยต่อกริดซ้อน) <!-- src: scripts/met.mjs:110 --> |
| `MET_SCALE` | `{ u: 10, v: 10, blh: 0.1, cls: 1, pr: 10, n2: 1e6, t2: 10, u10: 10, v10: 10, rh: 1, cc: 1 }` (ตัวคูณจำนวนเต็มใน `met-web.json`) <!-- src: scripts/met.mjs:141 --> |
| `TRAJ_VARS` | `['u10', 'v10', 'u', 'v', ...UP_VARS]` <!-- src: scripts/met.mjs:160 --> |
| `TRAJ_SCALE` | `{ u10: 10, v10: 10, u: 10, v: 10, u925: 10, v925: 10, u850: 10, v850: 10, u700: 10, v700: 10, z925: 0.1, z850: 0.1, z700: 0.1 }` <!-- src: scripts/met.mjs:161 --> |
| `T2CFG` | `{ lapse: 6.5e-3, efoldH: 6, step: 0.1, windowH: 48, minObs: 6, maxAbsResid: 12, demStep: 0.025, obsOffsetMs: 1800e3, bins: { day: 07–18 น., night: อื่น ๆ }, north: [96.5, 14.5, 102.5, 21.5] }` (Γ = 6.5 °C/กม., anomaly จาง e-fold 6 ชม., อ่าน ECMWF ที่ valid − 30 นาที) <!-- src: scripts/t2down.mjs:13-14 --> |
| `WXML` | `{ leads: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48], fieldStep: 0.1, rainEps: 0.2, keepDays: 730, maxPerDay: 6000 }` <!-- src: scripts/mlwx.mjs:15 --> |
| `T2_NAMES` | `['lead','hsin','hcos','dsin','dcos','lat','lon','elev','t2','dDown','lnPr','lastErr','oT2']`; engine `T2ENG = makeEngine(T2_NAMES, 5)` (จำกัด ±5 °C) <!-- src: scripts/mlwx.mjs:16,18 --> |
| `PR_NAMES` | `['lead','hsin','hcos','dsin','dcos','lat','lon','elev','lnPr','t2','lnObsLast','lnObs6']`; engine `PRENG = makeEngine(PR_NAMES, Math.log(4))` (จำกัดสี่เท่า) <!-- src: scripts/mlwx.mjs:17,19 --> |

#### ฝน — `gsmap.mjs`, `pardig.mjs`, `radar.mjs`, Python

| ค่าคงที่ | ค่า |
|---|---|
| `GSCFG` | `{ host: 'hokusai.eorc.jaxa.jp', keepH: 48, webH: 24, lon0: 92.05, lat0: 5.05, nx: 180, ny: 200 }` (crop 92–110 E, 5–25 N, 0.1°) <!-- src: scripts/gsmap.mjs:14 --> |
| `PDCFG` | `{ base: 'https://storage.googleapis.com/pardig_1/NRT/zarr/2026_to_present', lon0: 92.0, lat0: 5.0, nx: 181, ny: 201, keepH: 48, firstH: 24, frameMin: 15, source: … }` <!-- src: scripts/pardig.mjs:13-18 --> |
| `RVCFG` | `{ api: 'https://api.rainviewer.com/public/weather-maps.json', z: 6, size: 512, color: 2, opts: '0_0', bbox: [97, 5.5, 106, 21], step: 0.025, keepFramesH: 3, keepHoursH: 72, webH: 24, minFrames: 4, nowLeadH: 3, block: 40, search: 8, minDbz: 10, maxRate: 100, maskRefreshH: 24, paceMs: 700, despeckle: { r: 2, min: 11 }, echoRadius: 4, echoMin: 1, echoHours: 2 }` <!-- src: scripts/radar.mjs:23-37 --> |
| `GRID` | กริด 0.025° จาก `RVCFG.bbox` (lon0 97, lat0 5.5) <!-- src: scripts/radar.mjs:38 --> |
| `DIAG` | `{ windowH: 72, step: 0.25, maxShiftH: 6, wetMm: 0.2, shrinkN: 10, maxLn: Math.log(4), minWet: 200 }` (ECMWF เทียบ radar: timing ±6 ชม., amount ±ln 4) <!-- src: scripts/radar.mjs:303 --> |
| `silam.py` | `BOX = (92.0, 5.4, 110.0, 24.2)`, `DAYS = 5` <!-- src: scripts/silam.py:20-21 --> |
| `ecmwf_pr.py` | `BOX = (92.0, 5.0, 110.0, 25.0)`, `STEPS` = 0–144 ทุก 3 ชม. และ 150–168 ทุก 6 ชม., `MAX_AGE_H = 36` <!-- src: scripts/ecmwf_pr.py:20-22 --> |
| `prclim.py` | `W, S, E, N, ST = 92.0, 5.0, 110.0, 25.0, 0.025` (720 × 800 เซลล์), ตัวคูณจำกัด 0.2–5 <!-- src: scripts/prclim.py:6,13-14 --> |
| `fit_rain_blend.py` | `EPS = 0.2`, `MEMBERS = ['shift', 'amount', 'persist', 'nowcast']`, `BINS = [1, 2, 3, 6, 9, 12, 18, 24, 30, 36, 42, 48]`; lead ต้องมี ≥ 300 แถวและ ≥ 30 ชั่วโมงเปียก <!-- src: scripts/fit_rain_blend.py:23-25,61 --> |

#### ความแม่นยำ, IQAir, kriging

| ค่าคงที่ | ค่า |
|---|---|
| `ACC` (`accuracy.mjs`) | `{ days: 7, horizons: { s: [1, 3, 6], l: [12, 24], d2: [48] }, daily: { y1: 24, y2: 48 }, minHours24: 18, bands: [15, 25, 37.5, 75], thr: 37.5, mapeMin: 10, month: { days: 30, leads: { m1: 24, m2: 48 } } }` <!-- src: scripts/accuracy.mjs:23-26 --> |
| `COLS` (`accuracy.mjs`) | `['n','sumAbsErr','sumErr','sumObs','sameBand','obsHigh','fcHigh','caught','sumF','sumF2','sumO2','sumFO','nMape','sumApe']` <!-- src: scripts/accuracy.mjs:39 --> |
| `IQ_KM` | `15` กม. (จุดพยากรณ์ที่ใกล้เมือง IQAir ที่สุด) <!-- src: scripts/accuracy.mjs:103 --> |
| `IQAIR` (`iqair.mjs`) | `{ perRun: 9, perMinute: 5, maxAgeH: 6, timeoutMs: 20e3, cities: [27 เมือง: 17 ในไทย + 10 ในลาว กัมพูชา เมียนมา เวียดนาม มาเลเซีย] }` <!-- src: scripts/iqair.mjs:9-20 --> |
| `KRIGE` (`rk.mjs`) | `{ kappa: 1 }` (shrinkage ของ local mean ใน tapered kriging) <!-- src: scripts/rk.mjs:65 --> |
| `regressionKriging` defaults | `maxLogCorr = ln 3`, `minPerPredictor = 10` (ตัด predictor ถ้าสถานีน้อยกว่า 10 × (p+1)) <!-- src: scripts/rk.mjs:114-116 --> |

#### SILAM chain, landcover, แชต

| ค่าคงที่ | ค่า |
|---|---|
| `MODEL_KEYS` (`silam_chain.mjs`) | `['kf', 'kfA', 'kfSlow', 'incFc', 'assimKappa', 'ml', 'ml2', 'spikeSeen', 'pmNow', 'pmNowFc']` <!-- src: scripts/silam_chain.mjs:19 --> |
| `LC_LAYER` (`landcover.mjs`) | `'MODIS_Combined_L3_IGBP_Land_Cover_Type_Annual'` <!-- src: scripts/landcover.mjs:7 --> |
| `INTENTS` (`chatml.mjs`) | `['pm','adv','rank','hot','wx','fog','acc','src','how','whatpm','aqi','hi','other']` (13 หัวข้อ) <!-- src: scripts/chatml.mjs:7 --> |
| `DIM` (`chatml.mjs`) | `8192` buckets <!-- src: scripts/chatml.mjs:8 --> |
| `DEV_SHARE` (`chat_train.mjs`) | `0.15` (development set) <!-- src: scripts/chat_train.mjs:28 --> |
| `TEST_SHARE`, `MAX_NEW`, `MAX_GEN` (`chat_learn.mjs`) | `1/3`, `200`, `4000` <!-- src: scripts/chat_learn.mjs:16,18,63 --> |
| `TOPICS`, `UPDATE_URL` (`chat_llm_label.mjs`) | คำอธิบายหัวข้อที่ส่งให้ LLM (เท่ากับ `INTENTS`, ทดสอบ); URL ของไฟล์บน `main` สำหรับอัปเดตตัวเอง <!-- src: scripts/chat_llm_label.mjs:35,188 --> |

### 6.3.3 ค่าที่ห้ามปรับด้วยมือ (do not hand-tune)

| ค่า | ผู้ผลิตค่า | เหตุผล |
|---|---|---|
| `CFG.rainBlend` (`shift`, `amount`, `persist`, `nowcast`) | `scripts/fit_rain_blend.py` บน `rainfc-*.csv` + `rainobs-*.csv` (branch `history`, ~35 วันล่าสุด) | การ fit ด้วย MSE บน ln(R + 0.2) อย่างเดียวลด error ได้ด้วยการพยากรณ์ฝนน้อยลงทุกที่ (ต.ค.–พ.ย. 2026: ที่ lead 3–48 ชม. blend จับชั่วโมงฝนได้น้อยลงหนึ่งในสาม) สคริปต์จึงเก็บน้ำหนักของ lead หนึ่งไว้เฉพาะเมื่อ (1) MSE นอกสัปดาห์ต่ำกว่า ECMWF, (2) จับชั่วโมงฝน ≥ 0.5 mm/h ได้ไม่น้อยกว่า และ (3) สัดส่วน false alarm ไม่มากกว่า การปรับเองข้ามทั้งสามข้อนี้ <!-- src: scripts/fit_rain_blend.py:6-11,74-80 --> fit ครั้งแรก 8 พ.ย. 2026 (ข้อมูล 15 ต.ค.–8 พ.ย.) เก็บเฉพาะ lead 1–2 ชม. <!-- src: scripts/update.mjs:93-99 --> นอกจากนั้น PARDIG ใช้ ECMWF เป็น input จึงห้ามใช้เป็นค่าจริงในการ fit (CLAUDE.md) |
| `CFG.climBlend` (`cams`, `silam`) | `scripts/fit_clim_blend.mjs` บน `climfc-*.csv` ราว 2 สัปดาห์ (`data/history` สำหรับ CAMS, `data/history/silam` สำหรับ SILAM) | การดึงเข้าหา climatology ลด RMSE ได้ด้วยการกดค่าสูงลง สคริปต์จึงเก็บ w > 0 เฉพาะเมื่อ RMSE ต่ำลง **และ** จับชั่วโมง ≥ 37.5 µg/m³ ได้ไม่น้อยกว่า w = 0 **และ** สัดส่วน false alarm ไม่มากกว่า บน ≥ 2,000 แถวที่มี ≥ 50 ชั่วโมงสูง <!-- src: scripts/fit_clim_blend.mjs:5-7,20-27 --> ณ วันที่เขียน ทุกค่าเป็น 0 และ `update.mjs` บันทึกค่าเท่านั้น ยังไม่มีโค้ดที่ใช้น้ำหนัก (ต้องเพิ่มเมื่อ fit ได้ค่าไม่เป็นศูนย์) <!-- src: README.md:14 --> |

ค่าอื่นที่ fit มาแล้วและควรถือว่า "ไม่ปรับด้วยมือ" เช่นกัน: `CFG.blendByLead` และ `CFG.blendBelt.byLead` (fit บน hindcast 2024–26 และตรวจแบบ leave-one-season-out) <!-- src: scripts/update.mjs:83-92 -->
และ `LOWCOST.a`, `LOWCOST.b` (fit จาก co-location 154,651 คู่ที่ 90 จุด) <!-- src: scripts/lowcost.mjs:2-3 --> ส่วนประตู (`pmHighCheck` และอื่น ๆ) ห้ามผ่อนเกณฑ์เพื่อให้ผ่าน (CLAUDE.md)

---

## 6.4 Module reference (`scripts/`)

รูปแบบ: **หน้าที่ · เรียกโดย · ฟังก์ชันที่ export · input · output · test**

ผลการรัน `node --test scripts/*.test.mjs` (Node v22.23.4, 28 พ.ย. 2026): **tests 90, pass 90, fail 0** จาก 18 ไฟล์ทดสอบ (ใช้เวลา ≈ 1.6 วินาที)
ทดสอบของ glass แยกรันด้วย `node --test glass/*.test.mjs` (CLAUDE.md)

### 6.4.1 Pipeline หลัก

#### `update.mjs`
- **หน้าที่:** pipeline รายชั่วโมง: รายชื่อสถานี → CAMS (หรือ SILAM) → ค่าวัด (OpenAQ, Air4Thai, BMA) + spike check → IQAir → met → radar / GSMaP / PARDIG / gauges → t2 downscaling + weather ML → FIRMS + land cover → fire assimilation → Kalman (`kf`, `kfA`, `kfSlow`) → station forecast + blend → ML v1 / v2 → nowcast → RK → output และ log <!-- src: scripts/update.mjs:384-1224 -->
- **เรียกโดย:** `update.yml` ขั้น 7; `silam_chain.mjs` (โหมด SILAM)
- **export:** ไม่มี (สคริปต์) ฟังก์ชันภายในที่สำคัญ: `rainDetectCheck(histDir, dayEnd, days=14)`, `obsRainCheck(histDir, dayEnd, days=14)`, `get(url, opt, tries=3, waitMs=2000, timeoutMs=60e3)`, `oaqStations()`, `oaqLatest(stations)`, `a4tStations()`, `a4tHourly(codes, d0, d1)`, `firmsHotspots()`, `camsSeries(points)`, `kfStep(st, y, tObs, par)`, `correct(raw, b, leadH)`, `stationForecast(s, raw, k)`, `runRK(withInc, M)`, `backfillStore(base, dayStart, store)`
- **input:** `data/state.json`, `data/met.json`, `data/latest.json` (hotspot สำรอง), `data/radar-cache.json`, `data/gsmap-cache.json`, `data/landcover.bin`, `data/static/{pm-clim,hc-model,elev,elev025}.json`, `data/static/prclim/`, `data/history/**` (log 35 วัน), `data/mltrain/**`, แหล่งข้อมูลภายนอก
- **output:** ดู 6.5 (`latest.json`, `state.json`, `met.json`, `met-web.json`, `met-traj.json`, `rain-obs.json`, `t2-corr.json`, `wx-ml.json`, `ml-field.json`, `rk-bias.json`, `rk-bias-A.json`, `pm-mean.json`, `pm-days/`, `runlog.json`, log ใน `data/history/` และคลังใน `data/mltrain/`)
- **test:** ไม่มีไฟล์ทดสอบโดยตรง (ส่วนประกอบทดสอบผ่านโมดูลย่อย)

#### `verify.mjs`
- **หน้าที่:** จับคู่ forecast ใน log กับค่าวัดภายหลัง ให้คะแนนตาม lead (หน้าต่าง 30 วัน, reference monitor เท่านั้น) <!-- src: scripts/verify.mjs:1-9 -->
- **เรียกโดย:** `update.yml` ขั้น 7 ต่อจาก `update.mjs`
- **export:** ไม่มี
- **input:** `data/history/**/obs-*.csv`, `a4t-*.csv`, `fcst-*.csv`
- **output:** `data/verify.json`
- **test:** ไม่มี

#### `accuracy.mjs`
- **หน้าที่:** ผลรวมความแม่นยำรายสถานีสำหรับหน้าเว็บ (7 วัน hourly; ค่าเฉลี่ยวันปฏิทิน 30 วัน; เซนเซอร์ราคาประหยัดแยก; IQAir) <!-- src: scripts/accuracy.mjs:1-18 -->
- **เรียกโดย:** `update.yml` ขั้น 10
- **export:** `ACC`, `band(v)`, `COLS`, `NEW()`, `addPair(a, f, o)`, `nrmseOf(a)`, `r2Of(a)`, `scores(a, minN=1)`, `scoreDays(rows, obs, tEnd, isMonitor, out, want)`, `scoreRows(rows, obs, tEnd, isMonitor, out, want)`, `IQ_KM`, `usAqiToPm(a)` (US AQI EPA 2024 → µg/m³), `scoreIqair(iq, fc1, points, t0, tEnd)`
- **input:** `data/latest.json`, `data/history/**/{a4t,obs,fcst,iqair}-*.csv`
- **output:** `data/accuracy.json`
- **test:** `accuracy.test.mjs` (9): band ของ PCD, ผลรวมและคะแนน, แถว log, ค่าเฉลี่ยรายวัน, IQAir, เซนเซอร์แยก, R² และ MAPE, ค่าเฉลี่ยวันปฏิทิน, NRMSE

#### `perf.mjs`
- **หน้าที่:** ผลงานของโมเดลทุกตัวแปร (PM2.5, t2, ฝน) สำหรับ `perf.html`; ข้ามถ้า `perf.json` อายุ < 3 ชม. (ยกเว้น `--force`) <!-- src: scripts/perf.mjs:1-16 -->
- **เรียกโดย:** `update.yml` ขั้น 9
- **export:** ไม่มี
- **input:** `data/history/**`
- **output:** `data/perf.json`, `data/perf-series.json`
- **test:** ไม่มี

### 6.4.2 ไฟและควัน

#### `model.mjs`
- **หน้าที่:** โหลด smoke model ตามที่หน้าเว็บรัน (โค้ดระหว่าง `/*MODEL-START*/` และ `/*MODEL-END*/` ใน `index.html`) เพื่อให้ pipeline, hindcast และหน้าเว็บไม่แยกกัน <!-- src: scripts/model.mjs:1-5 -->
- **เรียกโดย:** `update.mjs` (fire assimilation)
- **export:** `loadModel(file = index.html)`
- **input:** `index.html` · **output:** object ของโมเดล · **test:** ไม่มี

#### `assim.mjs`
- **หน้าที่:** Bayesian inversion ของการปล่อยของกลุ่มไฟ (0.5° × วันท้องถิ่น) จากค่าวัด 48 ชม.; ให้ increment ที่เคลื่อนตามลม <!-- src: scripts/assim.mjs:1-20 -->
- **เรียกโดย:** `update.mjs` (เฉพาะ CAMS, `CFG.assimilate`)
- **export:** `ASSIM`, `assimilateFires({ M, hots, W, obs, now, kappa, cfg, log })`, `assimSummary(a)`
- **input:** hotspot, met (ผ่าน `sampleMet`), ค่าวัด reference monitor · **output:** object `assim` (สรุปใน `latest.json.assim`; `kappaNext` → `state.assimKappa`) · **test:** ไม่มี

### 6.4.3 การตรวจข้อมูลวัด

#### `obsqc.mjs`
- **หน้าที่:** ตัด spike ของเครื่องมือ (เหตุการณ์ a4t:19t 25 พ.ย. 2026) และ reset Kalman ที่รับ spike ไปแล้ว <!-- src: scripts/obsqc.mjs:1-7 -->
- **เรียกโดย:** `update.mjs`, `ml2.mjs`, `verify.mjs`, `accuracy.mjs`, `perf.mjs`
- **export:** `SPIKE`, `dropSpikes(rows, par)` → `{kept, dropped}`, `dropSpikesHourKeys(obs, par)` → จำนวนที่ตัด, `isSpike(recent, t, v, par)` → bool, `resetAfterSpikes(dropped, seen, filters, now, keepH=96)` → id ที่ reset
- **input/output:** ในหน่วยความจำ
- **test:** `obsqc.test.mjs` (6): เหตุการณ์ a4t:19t, ควันจริงที่ขึ้นเร็วไม่ถูกตัด, ค่าแรกหรือหลังช่องว่าง > 3 ชม., hour-keyed map, `isSpike`, `resetAfterSpikes`

#### `lowcost.mjs`
- **หน้าที่:** แปลงเซนเซอร์ราคาประหยัดเป็นสเกลอ้างอิง และ QC แบบ rolling ย้อนหลัง (เทียบเพื่อนบ้าน) <!-- src: scripts/lowcost.mjs:1-7 -->
- **เรียกโดย:** `update.mjs`
- **export:** `LOWCOST`, `scaleLowcost(v, cfg)`, `updateDaily(daily, stations, obs24, dayNow, cfg)`, `lowcostQC(daily, stations, dayNow, cfg)` → Map id → `'pass' | 'isolated' | 'too few days' | 'fail: …'`
- **input:** `state.daily` · **output:** `state.daily`, `latest.json stations[].qc` · **test:** ไม่มี

#### `pmmean.mjs`
- **หน้าที่:** แผนที่ค่าเฉลี่ยรายวัน/สัปดาห์/เดือน และแผนที่รายวันสำหรับปฏิทินของ "บันทึกภาพ" <!-- src: scripts/pmmean.mjs:1-11 -->
- **เรียกโดย:** `update.mjs` (CAMS เท่านั้น)
- **export:** `PMM`, `thaiDay(t)`, `addHour(doc, ana)`, `meanOf(docs)`, `dayFile(doc)`, `periods(now)`, `updatePmMean(histDir, outFile, ana, now)`
- **input:** `data/history/YYYY-MM/pmday-*.json`, `pmmonth-*.json` · **output:** `pmday-*.json`, `pmmonth-YYYYMM.json`, `data/pm-mean.json`, `data/pm-days/YYYYMMDD.json`, `data/pm-days/index.json`
- **test:** `pmmean.test.mjs` (5)

#### `stationlist.mjs`
- **หน้าที่:** รวมรายชื่อสถานีของ log ลง `data/history/stations.json` (สถานีที่ออกจากรายชื่อยังคงอยู่) <!-- src: scripts/stationlist.mjs:1-6 -->
- **เรียกโดย:** `update.mjs` (CAMS เท่านั้น)
- **export:** `mergeStations(old, stations, day)`
- **input/output:** `data/history/stations.json` · **test:** `stationlist.test.mjs` (2)

### 6.4.4 การแก้ไบแอสเชิงพื้นที่

#### `rk.mjs`
- **หน้าที่:** regression kriging ใน log space (RIMM-type): regression บน ln(C+1), ความสูง, ln(BLH), ลม 100 ม. + tapered residual kriging (Wendland taper; ไม่มีรอยต่อ) <!-- src: scripts/rk.mjs:1-3,60-64 -->
- **เรียกโดย:** `update.mjs` (RK, ML field, weather ML field), `t2down.mjs`, `ml.mjs`/`mlcore.mjs` (`solve`)
- **export:** `ols(X, y, w)`, `solve(A, b)`, `fitVariogram(pts, res, {binKm=15, maxKm=400, w})`, `KRIGE`, `krige(pts, res, v, lat, lon, {K=16, maxKm=400, skip})`, `declusterWeights(pts, cellDeg)`, `clampAux(x, R)`, `regressionKriging(obs, gridSpec, opt)`, `krigeField(obs, gridSpec, {K=16, declusterDeg=0})`
- **test:** `rk.test.mjs` (2): ไม่มีรอยต่อที่ขอบรัศมีค้นหา; ไกลจากทุกสถานีการแก้เป็น 0

### 6.4.5 ML

#### `ml.mjs` (v1, ที่เผยแพร่)
- **หน้าที่:** ensemble ออนไลน์ของ expert (base, day, week, month, season, hindcast) รวมด้วย fixed-share forecaster; เป้า r = ln(obs+1) − ln(F+1) <!-- src: scripts/ml.mjs:1-21 -->
- **เรียกโดย:** `update.mjs`; `ml2.mjs` (ใช้ `NAMES`, `featureVector`); `mlwx.mjs` (`seasonOf`)
- **export:** `setHindcastModel(m)`, `MLCFG`, `EXPERTS`, `seasonOf(t)`, `STORE`, `storeDay(dir, rows, dayStart, gzip)`, `loadSeasonRows(dir, t, gunzip, before)`, `FEAT_COLS`, `NAMES`, `featureVector(r)`, `LC_SAMPLE`, `loadDataset(histDir, meta, {from, to, lowcost})`, `trainGBM(rows, opt, type)`, `predGBM(m, r)`, `predictExpert(m, r)`, `dailyLearn(state, rows, {now, dayStart, dayEnd, season, seasonRows, log})`, `mlCorrection(state, r, season)`, `mlActive(state, season)`
- **input:** `fcst-*.csv`, `obs-*.csv`, `a4t-*.csv` (35 วัน), `data/mltrain/<season>/train-YYYYMMDD.csv.gz` · **output:** `state.ml`, `data/history/YYYY-MM/ml-YYYYMMDD.json`, `data/mltrain/<season>/train-*.csv.gz`
- **test:** ผ่าน `hindcast.test.mjs` (expert hindcast ใน ensemble)

#### `mlcore.mjs`
- **หน้าที่:** สำเนาทั่วไปของ engine ที่รับชื่อ feature และ clip เป็นพารามิเตอร์ (ใช้กับ v2, weather ML, hindcast) <!-- src: scripts/mlcore.mjs:1-8 -->
- **export:** `CORECFG`, `EXPERTS`, `makeEngine(names, clip, cfg)` → `{ dailyLearn, correction, active, trainGBM, predictExpert, … }`
- **test:** ทางอ้อมผ่าน `ml2.test.mjs`, `hindcast.test.mjs`

#### `ml2.mjs` (v2, ผู้สมัคร)
- **หน้าที่:** การแก้ v2 ที่รันคู่กับ v1: เป้าเป็น µg/m³ (obs − F), input เพิ่มประวัติสถานีและ climatology; เผยแพร่เฉพาะเมื่อ `pmHighCheck` ผ่าน <!-- src: scripts/ml2.mjs:1-18 -->
- **เรียกโดย:** `update.mjs`; `pmnow.mjs` (`highScore`, `listFiles`, `parseCSV`, `fileDay`, `ML2`)
- **export:** `ML2`, `HIST_NAMES`, `setClimatology(doc)`, `climFeatures(id, tValid)`, `NAMES2`, `CFG2`, `ENG2`, `parseCSV(txt)`, `listFiles(dir)`, `fileDay(f)`, `loadObsHourly(histDir, from, extra)`, `histFeatures(obs, id, tIssue, tValid)`, `rows2From(rows, obs)`, `predict2(st, f, obs, id, tIssue, tValid)`, `highScore(pairs, thr)`, `pmHighCheck(histDir, dayEnd, obs, days, since)`
- **input:** `data/static/pm-clim.json`, log ใน `data/history/` · **output:** `state.ml2`, คอลัมน์ `correctedML2` ใน `fcst-*.csv`, `ml-*.json` ส่วน `v2`
- **test:** `ml2.test.mjs` (6): ชื่อ input (live + 7), ใช้เฉพาะชั่วโมงที่จบก่อน issue − 1 ชม., เห็นยอดของเมื่อวาน, แถวฝึก, ประตู, input climatology

#### `mlwx.mjs`
- **หน้าที่:** การแก้แบบเรียนรู้ของอุณหภูมิ 2 ม. และฝน (expert ห้าตัวแบบเดียวกัน) <!-- src: scripts/mlwx.mjs:1-8 -->
- **เรียกโดย:** `update.mjs` (CAMS เท่านั้น)
- **export:** `WXML`, `T2_NAMES`, `PR_NAMES`, `T2ENG`, `PRENG`, `t2Features(o)`, `prFeatures(o)`, `loadWxObs(histDir)`, `loadWxDataset(histDir, meta, {from, to})`, `storeWxDay(dir, varName, names, rows, dayStart, gzip)`, `loadWxSeason(dir, varName, names, t, gunzip, before)`
- **input:** `wxf-*.csv`, `a4tw-*.csv`, `rainobs-*.csv` · **output:** `state.wxml`, `mlwx-*.json`, `data/mltrain/wx/<var>/…`, `data/wx-ml.json`
- **test:** ไม่มี

### 6.4.6 Hindcast และ climatology

#### `hindcast.mjs`
- **หน้าที่:** expert hindcast (GBM ที่ฝึกครั้งเดียวจาก CAMS ย้อนหลัง 3 ฤดูไฟ), ใช้ใน CAMS run เท่านั้น 18 ธ.ค.–30 เม.ย. <!-- src: scripts/hindcast.mjs:1-12 -->
- **export:** `HC_NAMES`, `HC`, `inHcSeason(t)`, `hcFeatures(r)`, `hcExpert(model, r, predict)`
- **input:** `data/static/hc-model.json` (ผ่าน `setHindcastModel`) · **test:** `hindcast.test.mjs` (6)

#### `hindcast_train.mjs`
- **หน้าที่:** ฝึก hindcast expert ครั้งเดียว (leave-one-season-out แล้วฝึกบนทั้งสามฤดู) <!-- src: scripts/hindcast_train.mjs:1-7 -->
- **เรียกโดย:** ด้วยมือ: `node scripts/hindcast_train.mjs <data/hindcast> data/static/hc-model.json`
- **export:** `HCFIT`, `seasonRows(dir, season, keep)`, `score(p, o, thr)`
- **input:** branch `hindcast`: `data/hindcast/cams_obs_3h_<Y>.csv.gz`, `stations.csv` · **output:** `data/static/hc-model.json` · **test:** ใน `hindcast.test.mjs`

#### `climatology.mjs`
- **หน้าที่:** ค่าเฉลี่ยและ percentile ที่ 90 รายเดือน × ชั่วโมงของทุก reference monitor จาก 3 ปี <!-- src: scripts/climatology.mjs:1-15 -->
- **เรียกโดย:** `climatology.yml`
- **export:** `CLIM`, `cellOf(t)`, `thaiTime(s)`, `cellStats(series, minN)`, `csvSplit(l)`, `parseOaq(txt)`, `matchCopies(stations, locations, maxKm)`
- **input:** `data/state.json` (รายชื่อ), OpenAQ archive S3, OpenAQ v3, Air4Thai history · **output:** `data/static/pm-clim.json`
- **test:** `climatology.test.mjs` (4)

#### `fit_clim_blend.mjs`
- **หน้าที่:** fit `CFG.climBlend` ราย lead (6.3.3) <!-- src: scripts/fit_clim_blend.mjs:1-10 -->
- **เรียกโดย:** ด้วยมือ: `node scripts/fit_clim_blend.mjs data/history data/history` (CAMS), `node scripts/fit_clim_blend.mjs data/history/silam data/history` (SILAM)
- **export:** `FIT`, `blend(F, C, w)`, `fitLead(rows, f)`
- **input:** `climfc-*.csv`, `a4t-*.csv`, `obs-*.csv` · **output:** พิมพ์ `weights for CFG.climBlend: [...]` (ไม่เขียนไฟล์)
- **test:** `fit_clim_blend.test.mjs` (3)

### 6.4.7 Nowcast

#### `pmnow.mjs`
- **หน้าที่:** nowcast 1–6 ชม. ที่สถานีรายชั่วโมง: error ล่าสุด (ln) จาง e^(−L/τ) <!-- src: scripts/pmnow.mjs:1-11 -->
- **เรียกโดย:** `update.mjs`
- **export:** `PMNOW`, `errNow(last, fc, now, par)`, `nowcastSeries(base, hours, t0, jNow, e, par)`, `storeForecast(store, id, base, hours, jNow, now, par)`, `pmNowCheck(histDir, dayEnd, obs, days, since, par)`
- **input:** `state.pmNowFc`, `fcst-*.csv` · **output:** `state.pmNow`, `state.pmNowFc`, คอลัมน์ `correctedPre`/`correctedNC`
- **test:** `pmnow.test.mjs` (4)

### 6.4.8 อุตุนิยมวิทยา

#### `met.mjs`
- **หน้าที่:** ดึง ECMWF IFS จาก Open-Meteo บนกริดซ้อน, sample, และแพ็กไฟล์ให้หน้าเว็บ <!-- src: scripts/met.mjs:1-9 -->
- **export:** `MET_MODEL`, `UP_VARS`, `N2_DEFAULT`, `pgClass(u, sw, cc)` (Pasquill–Gifford ตาม Turner 1970), `fetchMet(grids, {get, sleep, log, pastDays=3, forecastDays=4, keepFrom, keepTo})`, `MET_TAPER`, `metEdgeW(g, lat, lon)`, `metWeights(M, lat, lon)`, `sampleMet(M, lat, lon, t)`, `MET_SCALE`, `packMet(M, from, to)`, `TRAJ_VARS`, `TRAJ_SCALE`, `packTraj(M, from, to)`, `unpackMet(P)`
- **output:** `data/met.json`, `data/met-web.json`, `data/met-traj.json` · **test:** ไม่มี

#### `t2down.mjs`
- **หน้าที่:** ลดขนาดอุณหภูมิ 2 ม. เป็น 0.025° ด้วย lapse rate + DEM + residual ของสถานี Air4Thai <!-- src: scripts/t2down.mjs:1-7 -->
- **export:** `T2CFG`, `t2Bin(t)`, `t2SeaLevel(M, lat, lon, t, lapse)`, `downscaleT2(M, dem, obsRows, now, {sampleMet, sampleGrid, log, cfg})`, `packDEM(d)`, `t2Down(M, demV, F, lat, lon, t, sampleGrid, tObs)`
- **output:** `data/t2-corr.json`, `data/static/elev025.json` · **test:** ไม่มี

#### `dem.mjs`
- **หน้าที่:** DEM จาก AWS Terrain Tiles (Terrarium, zoom 7) ไม่ต้องใช้ key <!-- src: scripts/dem.mjs:1-3 -->
- **export:** `decodePNG(buf)`, `buildDEM(bbox, step, {zoom=7, fetchTile, log})`, `sampleGrid(G, lat, lon)`
- **output:** `data/static/elev.json`, `elev025.json` · **test:** ไม่มี

#### `landcover.mjs`
- **หน้าที่:** MODIS IGBP land cover จาก NASA GIBS (ปีละครั้ง) สำหรับชนิดเชื้อเพลิงของไฟ <!-- src: scripts/landcover.mjs:1-3 -->
- **export:** `LC_LAYER`, `buildLandcover(bbox, {get, log, year})`, `landcoverAt(LC, lat, lon)`, `packLandcover(LC)`, `unpackLandcover(buf)`
- **output:** `data/landcover.bin` (Actions cache) · **test:** ไม่มี

### 6.4.9 ฝน

#### `radar.mjs`
- **หน้าที่:** radar ผ่าน RainViewer → dBZ → Marshall–Palmer (Z = 200 R^1.6) → 0.025°; ให้คะแนนกับ gauge; nowcast 3 ชม.; ECMWF เทียบ radar (timing/amount) <!-- src: scripts/radar.mjs:1-20 -->
- **export:** `RVCFG`, `GRID`, `dbzOf(r,g,b,a)`, `rateOf(dbz)`, `decodePNG(buf)`, `tileList()`, `packI16`, `unpackI16`, `noteEchoes(counts, a, hour, last)`, `despeckle(a, nx, ny, {r, min})`, `echoSeen(counts)`, `echoCover(counts, nx, ny, r)`, `clipField(a, cov)`, `updateRadar(cache, now, {get, sleep, log})`, `radarAt(cache, lat, lon, tStart, factor)`, `scoreRadar(gaugeStore, cache, scored, rows)`, `mergeRadarIntoMet(M, cache, factor)`, `nowcast(cache)`, `webRadar(cache, now, factor, nc)`, `DIAG`, `rainDiag(metPure, cache, factor, now, sample)`, `diagFactorAt(D, lat, lon)`, `persistAt(cache, factor, lat, lon, H, Hobs)`
- **input/output:** `data/radar-cache.json`; `rain-obs.json` field `radar` · **test:** `radar.test.mjs` (6)

#### `gsmap.mjs`
- **หน้าที่:** ฝนสังเกต JAXA GSMaP Gauge_NRT v6 / Gauge_NOW 0.1° ผ่าน sftp <!-- src: scripts/gsmap.mjs:1-7 -->
- **export:** `GSCFG`, `cropGsmap(buf, c)`, `unpack(s)`, `updateGsmap(cache, now, {log})`, `mergeIntoMet(M, cache)`, `webRain(cache, now, source)`
- **input/output:** `data/gsmap-cache.json` · **test:** ไม่มี (ส่วน remap ทดสอบใน `pardig.test.mjs`)

#### `pardig.mjs`
- **หน้าที่:** ฝนสังเกต Google DeepMind PARDIG 0.1° ทุก 15 นาที จาก bucket สาธารณะ (ไม่ใช้ key), ค่าเฉลี่ยรายชั่วโมงแบบ trapezoid <!-- src: scripts/pardig.mjs:1-11 -->
- **export:** `PDCFG`, `frameUrl(t)`, `cropFrame(g, c)`, `hourMean(f)`, `remapHalfCell(src, s, c)`, `updatePardig(cache, now, {get, log, maxFrames=220, conc=8, deadline})`, `obsRain(pcache, gcache, gcfg, usePardig)`
- **input/output:** `gsmap-cache.json` ส่วน `pardig` · **test:** `pardig.test.mjs` (5)

#### `thaiwater.mjs`
- **หน้าที่:** มาตรวัดฝน ThaiWater (HAII) ค่าล่าสุด `rain_1h`, ให้คะแนน GSMaP/PARDIG, ตัวคูณ CHELSA <!-- src: scripts/thaiwater.mjs:1-5 -->
- **export:** `fetchGauges(store, now, {get, log})`, `scoreGauges(store, gcache, dataDir, scored)`, `gsmapAt(gcache, dataDir, lat, lon, tStart)`, `rainFactor(dataDir, lat, lon, t)`
- **input:** ThaiWater API `rain_24h`, `data/static/prclim/` · **output:** `state.gaugeRain`, `state.rainGaugeScore*` · **test:** ไม่มี

#### `ecmwf_pr.py`, `prclim.py`, `fit_rain_blend.py`
- `ecmwf_pr.py`: ฝน ECMWF IFS 0.25° จาก open data (00/12 UTC) อ่านเฉพาะ total precipitation ด้วย byte range → `ecpr-<run>.json` และ `data/ecmwf-pr.json` (ไม่ส่ง run ที่อายุ > 36 ชม.) ไม่ทำให้ job ล้ม <!-- src: scripts/ecmwf_pr.py:1-16 -->
- `prclim.py`: ตัวคูณรูปแบบฝนรายเดือน CHELSA ที่ 0.025° (`factor = P_clim / P_clim_smooth`, ทะเล = 1, จำกัด 0.2–5) → `data/static/prclim/` <!-- src: scripts/prclim.py:1-7 -->
- `fit_rain_blend.py`: fit `CFG.rainBlend` ด้วย NNLS + leave-one-week-out; พิมพ์บรรทัดสำหรับวางใน `CFG.rainBlend` <!-- src: scripts/fit_rain_blend.py:1-14,80-82 --> ใช้: `python3 scripts/fit_rain_blend.py <history dir>`
- **test:** ไม่มี

### 6.4.10 SILAM

#### `silam.py`
- **หน้าที่:** อ่าน SILAM global (FMI, NetCDF-4, 0.2°) สอง run ล่าสุดที่ยังไม่ได้ดึง ตัดกล่อง 92–110 E × 5.4–24.2 N <!-- src: scripts/silam.py:2-15 -->
- **output:** `data/history/YYYY-MM/silam-YYYYMMDD.json` · ไม่ทำให้ job ล้ม · **test:** ไม่มี

#### `silam.mjs`
- **หน้าที่:** อ่านไฟล์สกัดของ `silam.py` รวม run (run ใหม่ชนะ) และให้รูปแบบเดียวกับ CAMS <!-- src: scripts/silam.mjs:1-5 -->
- **export:** `decodeRun(doc)`, `combineRuns(runs)`, `valueAt(S, f, lat, lon)`, `seriesAt(S, lat, lon)`, `asModel(S, stations)`, `forPage(S, tFrom)`, `loadSilam(histDir, now, {keep=2, maxAgeD=3, log})` (update.mjs เรียกด้วย `keep: 3, maxAgeD: 4`) <!-- src: scripts/update.mjs:427 -->
- **test:** `silam.test.mjs` (3)

#### `silam_chain.mjs`
- **หน้าที่:** รัน `update.mjs` รอบสองด้วย `HSW_MODEL=silam` ในโฟลเดอร์ `data/silam-run/` แยก state/log/ไฟล์หน้าเว็บ <!-- src: scripts/silam_chain.mjs:1-12 -->
- **เรียกโดย:** `update.yml` ขั้น 8
- **export:** `MODEL_KEYS`, `stateFor(main)`, `pickModel(st)`, `pageDoc(sil, cams)`
- **input:** `data/state.json`, `data/latest.json`, `met.json`, `landcover.bin`, `data/static/` · **output:** `data/silam/{latest,rk-bias,rk-bias-A,ml-field}.json`, `state.silamState`, `latest.json.silam`, `data/history/silam/`, `data/mltrain/silam/`
- **test:** `silam_chain.test.mjs` (2)

### 6.4.11 IQAir และขอบเขตการปกครอง

#### `iqair.mjs`
- **หน้าที่:** US AQI ปัจจุบันของ 27 เมือง (AirVisual `nearest_city`), 9 เมืองต่อรอบ ครั้งละ 5 ห่างกันหนึ่งนาที <!-- src: scripts/iqair.mjs:1-20 -->
- **export:** `IQAIR`, `parseNearest(j)`, `pickCities(store, n, cities)`, `updateIqair(state, now, key, log, fetchFn, wait)`, `forPage(state, now)`
- **output:** `state.iqair`, `latest.json.iqair`, `iqair-*.csv` · **test:** `iqair.test.mjs` (4)

#### `admin_bounds.mjs`, `province_bounds.mjs`, `admin_names_fix.json`
- `admin_bounds.mjs`: สร้าง `data/static/th-adm2.json` (อำเภอ) และ `th-adm3.json` (ตำบล) จาก OCHA COD-AB 2022 ครั้งเดียว ด้วยมือ <!-- src: scripts/admin_bounds.mjs:1-13 -->
- `province_bounds.mjs`: แทนรูปทรง 77 จังหวัดไทยในบล็อก `geoProv` ของ `index.html` ด้วยอำเภอที่ dissolve <!-- src: scripts/province_bounds.mjs:1-11 -->
- `admin_names_fix.json`: P-code → ชื่อไทยเต็ม 10 ชื่อที่ COD ตัดที่ 16 ตัวอักษร
- **test:** ไม่มี

### 6.4.12 หน้าเว็บและการ build

| ไฟล์ | หน้าที่ | export / การเรียก | test |
|---|---|---|---|
| `build_modern.mjs` | ประกอบหน้า redesign = markup ของ `index_modern.html` + โค้ดของ `index.html` (ตั้งแต่ `<script>` แรกหลัง `</style>`); ถ้า redesign ขาด id ใดของ `index.html` ⇒ เผยแพร่ `index_modern.html` ตามเดิมพร้อม warning <!-- src: scripts/build_modern.mjs:1-23 --> | `node scripts/build_modern.mjs index.html index_modern.html <out>` | ไม่มี |
| `lockpage.mjs` | เข้ารหัสหน้า: PBKDF2-SHA256 (600,000 รอบ) → AES-256-GCM; ไม่มี `DEV_USER`/`DEV_PASS` ⇒ หน้าประกาศ <!-- src: scripts/lockpage.mjs:1-10 --> | `node scripts/lockpage.mjs <in> <out> "<title>"` | ไม่มี |

### 6.4.13 แชต "ถาม SEA-HAF"

| ไฟล์ | หน้าที่ | export สำคัญ | test |
|---|---|---|---|
| `chatml.mjs` | ตัวจำแนกหัวข้อ: character 2–4-gram hash 8,192 bucket + logistic regression (int8) หรือ MLP หนึ่งชั้น; สำเนาในหน้าเว็บ (`chatMLfeat`/`chatMLpredict`) ต้องเหมือนกัน <!-- src: scripts/chatml.mjs:1-6 --> | `INTENTS`, `DIM`, `featurize`, `predict`, `train`, `trainMLP`, `quantize`, `evaluate` | `chatml.test.mjs` (7) |
| `chat_train.mjs` | ฝึกแล้วเขียน `chat/model.json`; `--gate` คงโมเดลเดิมถ้าแย่ลง > 1 จุด; `--report` ไม่เขียน | `norm`, `share`, `DEV_SHARE`, `buildData` | ใน `chatml.test.mjs` |
| `chat_learn.mjs` | ดึงป้ายจาก `/api/export` (majority ≥ 2/3, ≤ 200 คำถามใหม่ต่อรอบ); ป้ายของ admin หนึ่งในสามไป `chat/test_real.json` | `TEST_SHARE`, `MAX_NEW`, `parseCSV`, `cleanQ`, `merge`, `mergeAdmin`, `MAX_GEN`, `mergeGen` | ใน `chatml.test.mjs`, `chat_pages.test.mjs` |
| `chat_data.mjs` | คำถามแม่แบบ | `templateRows(perTopic=220, seed=11)` | – |
| `chat_augment.mjs` | สร้าง variant (สะกดผิด, ไม่มีวรรณยุกต์, ภาษาพูด ฯลฯ) แบบ deterministic | `rng`, `variant`, `augment`, `usToThai`, `thaiToUs` | ใน `chatml.test.mjs` |
| `chat_massive.mjs` | ทำ `chat/data/massive.json` จาก Amazon MASSIVE 1.1 ครั้งเดียว | `mapMassive` | – |
| `chat_llm_label.mjs` | LLM ในเครื่องของ admin (Ollama/LM Studio) **เสนอ**หัวข้อและเขียนคำถามฝึก (`--generate`); ป้ายเกิดจากการคลิกของ admin เท่านั้น | `TOPICS`, `prompt`, `parseReply`, `askLLM`, `run`, `genPrompt`, `generate`, `runGenerate`, `modelChange`, `plist`, … | `chat_llm_label.test.mjs` (9) |
| (Cloudflare Functions) | `cloudflare/pages/functions/api/{feedback,export,label,suggest,generated}.js` | – | `chat_pages.test.mjs` (7) |

### 6.4.14 สรุปไฟล์ทดสอบ

| ไฟล์ | จำนวน test | ผล |
|---|---|---|
| `accuracy.test.mjs` | 9 | ผ่าน |
| `chat_llm_label.test.mjs` | 9 | ผ่าน |
| `chat_pages.test.mjs` | 7 | ผ่าน |
| `chatml.test.mjs` | 7 | ผ่าน |
| `climatology.test.mjs` | 4 | ผ่าน |
| `fit_clim_blend.test.mjs` | 3 | ผ่าน |
| `hindcast.test.mjs` | 6 | ผ่าน |
| `iqair.test.mjs` | 4 | ผ่าน |
| `ml2.test.mjs` | 6 | ผ่าน |
| `obsqc.test.mjs` | 6 | ผ่าน |
| `pardig.test.mjs` | 5 | ผ่าน |
| `pmmean.test.mjs` | 5 | ผ่าน |
| `pmnow.test.mjs` | 4 | ผ่าน |
| `radar.test.mjs` | 6 | ผ่าน |
| `rk.test.mjs` | 2 | ผ่าน |
| `silam.test.mjs` | 3 | ผ่าน |
| `silam_chain.test.mjs` | 2 | ผ่าน |
| `stationlist.test.mjs` | 2 | ผ่าน |
| **รวม** | **90** | **90 ผ่าน, 0 ล้ม** |

โมดูลที่ยังไม่มีไฟล์ทดสอบของตัวเอง: `update.mjs`, `verify.mjs`, `perf.mjs`, `assim.mjs`, `lowcost.mjs`, `met.mjs`, `t2down.mjs`, `dem.mjs`,
`landcover.mjs`, `gsmap.mjs`, `thaiwater.mjs`, `mlwx.mjs`, `model.mjs`, `build_modern.mjs`, `lockpage.mjs`, `admin_bounds.mjs`,
`province_bounds.mjs` และสคริปต์ Python ทั้งหมด

---

## 6.5 Output reference

### 6.5.1 `data/latest.json` (ไม่ commit; เผยแพร่ไป Pages และเก็บใน Actions cache)

เขียนครั้งเดียวต่อรอบที่ท้าย `main()` <!-- src: scripts/update.mjs:1167-1183 --> และ `silam_chain.mjs` เพิ่มคีย์ `silam` ภายหลัง <!-- src: scripts/silam_chain.mjs:60-61 -->

| คีย์ | ชนิด | ความหมาย |
|---|---|---|
| `generated` | ms (UTC) | เวลารอบ |
| `camsIssued` | ms | เวลาที่ดึง CAMS (`state.cams.at`) |
| `bbox` | [W,S,E,N] | `CFG.bbox` |
| `runlog` | string[] | log ของรอบ (key ของ FIRMS/OpenAQ ถูกแทนด้วย `***`) <!-- src: scripts/update.mjs:119-120 --> |
| `method` | object | `{ kf, biasLeadEfoldH, rk: { …CFG.rk, lowcost: { use, a, b, windowD, minDays } } }` |
| `model` | object | `{ name: 'CAMS' }` หรือ `{ name: 'SILAM', run, runs, source }` |
| `rk`, `rkA` | object \| null | ผล RK ไม่มี/มี assimilation increment: `t, n, nLowcost, withAssim, beta[], predictors[], xRange, maxLogCorr, vario, maxKm, leadEfoldH, cv{n, cams, rk, cover1s, sdMedian, declustered, byArea, byType}, regCov, basis:'24h', bias{lon0,lat0,step,nx,ny,values,sd} (0.1°), biasFine{file,t,lon0,lat0,step,nx,ny} (0.025°), guards, model, decluster` <!-- src: scripts/update.mjs:1098-1152 --> |
| `assim` | object \| null | สรุป fire assimilation (`assimSummary`: สถานะ, diag, groups, `kappaNext`, `cfg{groupDeg, sigmaB, sigmaMin, rel, epsModel, minF, windowH}`, `at`) |
| `ml` | object \| null | `{ active, weights, lastDay, experts[], last (ml-*.json ของวันนั้น), field (ข้อมูล ml-field.json), v2: { published, weights, check } \| null }` |
| `dem` | object \| null | `{ file: 'data/static/elev.json', step, source }` |
| `t2down` | object \| null | `{ wxml{file, t0, active{t2,pr}, weights}, dem, demKey, lapse, efoldH, corr, tA, cv, score24 }` |
| `rainObs` | object \| null | `{ file: 'data/rain-obs.json', times[2], src, verify, gauges, gaugesPardig, radar{latest, factor, hours, nowcast, covered, apiCovered}, corr{t, shiftH, lon0, lat0, step, nx, ny, lnf100, w: CFG.rainBlend, latestH} }` |
| `met` | object \| null | `{ file: 'data/met-web.json', model, fetched, grids[{step, bbox}] }` |
| `metTraj` | object \| null | `{ file: 'data/met-traj.json', fetched }` |
| `hours` | ms[] | แกนเวลาของ series (เริ่ม 24 ชม. ก่อนชั่วโมงปัจจุบัน) <!-- src: scripts/update.mjs:877-878 --> |
| `stations` | object[] | ดูตารางถัดไป |
| `obsWx` | object[] | อากาศที่วัดล่าสุด (≤ 6 ชม.) ที่สถานี Air4Thai: `{id, lat, lon, t, t2, rh, ws, wd}` |
| `iqair` | object[] | `{id, name, iqName, lat, lon, t, aqius}` อายุ ≤ 6 ชม. |
| `grid` | object | CAMS ดิบบนกริด `{lon0, lat0, step, nx, ny, values[hour][point]}` (−1 = ไม่มี) หน้าเว็บนำ `rk` ไปใช้เอง |
| `hotspots` | object | `{ cols: ['lat','lon','frp','t','conf','sat','igbp'], igbpYear, rows[], fetched }` |
| `silam` | object (เพิ่มโดย chain) | `{ file: 'data/silam/latest.json', generated, run, runs, t1 }` ไม่มีคีย์นี้ ⇒ หน้าเว็บซ่อนชั้น SILAM |

ฟิลด์ของ `stations[]` <!-- src: scripts/update.mjs:918-923,1010 -->

| ฟิลด์ | ความหมาย |
|---|---|
| `id`, `name`, `nameTH`, `lat`, `lon`, `cc`, `provider` | ตัวตนสถานี (`a4t:<code>` สำหรับ Air4Thai, ตัวเลขสำหรับ OpenAQ) |
| `monitor`, `avg24`, `hourly` | reference monitor หรือไม่; ค่าเป็นค่าเฉลี่ย 24 ชม.; Air4Thai รายชั่วโมงโดยตรง |
| `qc` | ผล QC ของเซนเซอร์ราคาประหยัด (`pass`, `isolated`, `too few days`, `fail: …`, `none`) |
| `obs` | `{t, v}` ค่าวัดล่าสุดที่ใช้ |
| `held` | `{t, v}` ค่าล่าสุดที่ spike check พักไว้ (แสดงว่า "ยังไม่ยืนยัน" ไม่ใช้ในการแก้ใด) |
| `obs24` | `{v, n, tEnd, valid, native?}` |
| `bias`, `nUpd` | Kalman bias (ln) และจำนวนครั้งที่ปรับ |
| `raw` | CAMS ที่สถานี (Air4Thai: ค่าเฉลี่ยของชั่วโมง (C[t−1]+C[t])/2) |
| `corr`, `fc24` | หลัง Kalman; ค่าเฉลี่ย 24 ชม. ที่ blend กับ persistence |
| `corrA`, `fc24A`, `inc` | เหมือนกันแต่รวม assimilation increment; `inc` = increment (มีเมื่อ ≥ 0.1) |
| `corrM`, `fc24M` | ค่าที่เผยแพร่หลัง ML (v1 หรือ v2) และ nowcast (เมื่อประตูผ่าน) |
| `obsSeries` | ค่าวัดบนแกน `hours` ถึงปัจจุบัน |

### 6.5.2 `data/met.json` (Actions cache เท่านั้น)

`{ model: 'ecmwf_ifs', fetched, vars: ['u','v','blh','cls','pr','n2','t2','u10','v10','rh','cc'], times[], grids[{lon0, lat0, step, nx, ny, data{var: Float[t·ny·nx]}, up{u925…z700}, elev}], key }`
หน่วย: u, v, u10, v10 m/s; blh m; cls = Pasquill–Gifford class × 2; pr mm/h; n2 s⁻²; t2 °C; rh %; cc % ; `key` = `JSON(CFG.met.grids) + MET_MODEL + '|n2t2rh|elev|cc|up60'`
เก็บย้อนหลัง 60 ชม. (สำหรับ back-trajectory 48 ชม.) <!-- src: scripts/met.mjs:31; scripts/update.mjs:511,516 -->
`met-web.json` = สำเนาแพ็กจำนวนเต็มแบบต่างจากชั่วโมงก่อน (`enc: 'int-dt'`, `scale: MET_SCALE`) ช่วง −36…+75 ชม.; `met-traj.json` = ลมหลายระดับ (`TRAJ_VARS`) ช่วง −49…+75 ชม.

### 6.5.3 `data/state.json` (Actions cache เท่านั้น)

| คีย์ | เนื้อหา | เขียนโดย |
|---|---|---|
| `stations`, `prevStations`, `stationsAt`, `stationsCap`, `stationListVer`, `a4tTried` | รายชื่อสถานีปัจจุบัน/ก่อนหน้าและข้อมูลการสร้าง | `update.mjs` 1 |
| `cams` | `{ at, times, stIds, gridKey, st[][], grid[][] }` CAMS ที่ดึงไว้ (ลบออกก่อนรอบ SILAM) | `update.mjs` 2 |
| `obsHist` | id → `[[t, v], …]` ค่าวัด 50 ชม. | `update.mjs` 3a |
| `obsWx` | อากาศที่วัดล่าสุดของ Air4Thai | 3a |
| `iqair` | city id → `{t, aqius, name, label, lat, lon, asked}` | `iqair.mjs` |
| `daily` | id → { วัน UTC: ค่าเฉลี่ย 24 ชม. } เก็บ 35 วัน (QC เซนเซอร์) | `lowcost.mjs` |
| `gaugeRain` | ชั่วโมง → `[[lat, lon, mm], …]` 48 ชม. | `thaiwater.mjs` |
| `gaugeScored`, `gaugeScoredP`, `rainGaugeScore`, `rainGaugeScoreP`, `rainScore` | การให้คะแนน GSMaP/PARDIG กับ gauge (7 วัน) | `update.mjs` 3b'' |
| `obsRainCheck` | ผลประตู PARDIG/GSMaP ของวัน | `obsRainCheck` |
| `radarScored`, `radarScore`, `radarFactor`, `rainDiag` | การให้คะแนน radar, ตัวคูณ gauge/radar, ECMWF เทียบ radar | `radar.mjs` |
| `t2cv`, `t2fc`, `t2score` | ตรวจอุณหภูมิ | `t2down` block |
| `wxml` | `{ t2: {...}, pr: {..., detect}, lastDay }` weather ML และประตู `rainDetectCheck` | `mlwx` block |
| `kf`, `kfA`, `kfSlow` | id → `{b, P, t, n}` Kalman | 3e |
| `incFc` | id → `{h: {t: inc}, m: {t: inc}}` increment ที่พยากรณ์ไว้ 12 ชม. | 4 |
| `assimKappa` | κ ของรอบถัดไป | 3d |
| `spikeSeen` | spike ที่ reset ไปแล้ว (96 ชม.) | `obsqc.mjs` |
| `ml` | `{ weights, models, lastDay, history }` v1 | `ml.mjs` |
| `ml2` | `{ nFeat, since, weights, models, lastDay, check }` v2 | `ml2.mjs` |
| `pmNow`, `pmNowFc` | `{since, check}`; id → {ชั่วโมง: forecast} | `pmnow.mjs` |
| `silamState` | สำเนาคีย์ใน `MODEL_KEYS` ของรอบ SILAM ล่าสุด | `silam_chain.mjs` |

**`MODEL_KEYS` และ `silamState`:** `MODEL_KEYS = ['kf','kfA','kfSlow','incFc','assimKappa','ml','ml2','spikeSeen','pmNow','pmNowFc']`
<!-- src: scripts/silam_chain.mjs:19 --> คือ state ที่เป็นของโมเดล PM2.5 รอบ SILAM เริ่มจาก state ของรอบ CAMS (คีย์ร่วม) แทนคีย์ใน `MODEL_KEYS`
ด้วยของ `silamState` และลบ `cams` ออก (`stateFor`) เมื่อจบ `pickModel` เก็บคีย์เหล่านี้กลับเข้า `state.silamState` ของไฟล์ที่อ่านใหม่ <!-- src: scripts/silam_chain.mjs:25-31,58 -->
เมื่อ `update.mjs` มี state ใหม่ที่เป็นของแต่ละโมเดล ต้องเพิ่มชื่อคีย์ใน `MODEL_KEYS` (CLAUDE.md)

### 6.5.4 `data/accuracy.json`

`{ version: 1, generated, tEnd, days: 7, horizons, daily, month, bands, thr, iqair[], lowcost[], mapeMin, cols: COLS, stations[] }` <!-- src: scripts/accuracy.mjs:166-169 -->
แต่ละสถานี: `{ id, name, nameTH, lat, lon, cc, s, l, d2, y1, y2, m1, m2 }` แต่ละตัวเป็นอาร์เรย์ผลรวม 14 ช่องตาม `COLS`:

| ดัชนี | ชื่อ | ความหมาย |
|---|---|---|
| 0 | `n` | จำนวนคู่ |
| 1 | `sumAbsErr` | Σ\|F − O\| |
| 2 | `sumErr` | Σ(F − O) |
| 3 | `sumObs` | ΣO |
| 4 | `sameBand` | จำนวนคู่ที่อยู่ระดับ PCD เดียวกัน (ขอบ 15 / 25 / 37.5 / 75) |
| 5 | `obsHigh` | O ≥ 37.5 |
| 6 | `fcHigh` | F ≥ 37.5 |
| 7 | `caught` | ทั้งคู่ ≥ 37.5 |
| 8–11 | `sumF`, `sumF2`, `sumO2`, `sumFO` | สำหรับ r, R², NRMSE |
| 12, 13 | `nMape`, `sumApe` | MAPE เฉพาะ O ≥ 10 |

ช่วง: `s` lead 1/3/6, `l` 12/24, `d2` 48 (7 วัน รายชั่วโมง); `y1`/`y2` ค่าเฉลี่ย 24 ชม. ที่ lead 24/48; `m1`/`m2` ค่าเฉลี่ยวันปฏิทิน (run 17 UTC) 30 วัน
ความแม่นยำบนหน้าเว็บ = 100 − NRMSE โดย NRMSE = 100·RMSE / ค่าวัดเฉลี่ย <!-- src: scripts/accuracy.mjs:48 -->

### 6.5.5 `data/history/stations.json` (branch `history`)

`{ note, stations: { <id>: { name, nameTH?, area?, areaTH?, lat, lon (4 ตำแหน่ง), cc, provider, monitor, seen (วันที่ไทยล่าสุด) } } }` เรียงตาม id <!-- src: scripts/stationlist.mjs:8-14 -->

### 6.5.6 ไฟล์หน้าเว็บอื่นใน `data/`

| ไฟล์ | เนื้อหา |
|---|---|
| `verify.json` | `{ updated, window_days: 30, basis: '24h' \| 'legacy-hourly', leads[{lead_h, n, raw, corrected, blend, nA, blendA, blendNoA, nML, blendML, blendNoML}], hourly[...] }` แต่ละคะแนน `{mb, rmse, r, mean_obs}` <!-- src: scripts/verify.mjs:72-81 --> |
| `runlog.json` | `{ at, ok, log[] }` เขียนเสมอแม้ run ล้ม <!-- src: scripts/update.mjs:1231 --> |
| `rk-bias.json`, `rk-bias-A.json` | การแก้ 0.025° (ln, × 1000, ต่างตาม x: `enc: 'int-dx'`) |
| `ml-field.json` | การแก้ ML ln ×1000 บนกริด 0.1° ทุก 3 ชม. ถึง 24 ชม. (crop, จำกัด ±ln 2) <!-- src: scripts/update.mjs:1024-1031 --> |
| `rain-obs.json` | ฝนสังเกต PARDIG/GSMaP 0.1° (`deflate-int16`, 0.1 mm/h, −1 = ไม่มี) + `radar` 0.025° และ nowcast |
| `ecmwf-pr.json` | สำเนาของ `ecpr-<run>.json` ล่าสุด (≤ 36 ชม.) |
| `t2-corr.json`, `wx-ml.json` | การแก้อุณหภูมิจากสถานี; การแก้ weather ML ราย lead (×100 °C, ×1000 ln) |
| `perf.json`, `perf-series.json` | ข้อมูลของ `perf.html` |
| `pm-mean.json`, `pm-days/YYYYMMDD.json`, `pm-days/index.json` | แผนที่ค่าเฉลี่ย (`deflate-int16`, × 10) |
| `_site/data/stamp.json` | `{ generated, build }` (สร้างตอน build) |

### 6.5.7 `data/silam/*`

| ไฟล์ | เนื้อหา |
|---|---|
| `data/silam/latest.json` | `latest.json` ของรอบ SILAM ผ่าน `pageDoc`: path ของ `rk-bias*.json`/`ml-field.json` ชี้ไป `data/silam/`; `t2down`, `rainObs`, `met`, `metTraj`, `dem`, `obsWx`, `iqair` เอาจากรอบ CAMS; ไม่มี `runlog`; `model = { name: 'SILAM', run, runs, source }` <!-- src: scripts/silam_chain.mjs:33-40 --> |
| `data/silam/rk-bias.json`, `rk-bias-A.json`, `ml-field.json` | เหมือนของ CAMS บนกริด SILAM (`rk-bias-A.json` จะไม่มีเพราะ SILAM ไม่มี increment) |

ถ้ารอบ SILAM ล้ม โฟลเดอร์ `data/silam/` ถูกลบ หน้าเว็บจะซ่อนชั้น SILAM <!-- src: scripts/silam_chain.mjs:53 -->

### 6.5.8 คอลัมน์ของ log ใน `data/history/` (branch `history`, เก็บ 35 วัน)

ชื่อไฟล์มีวันที่ 8 หลักเสมอ (ใช้ตัดอายุ 35 วัน) โฟลเดอร์ `YYYY-MM/` รอบ SILAM เขียนชุดเดียวกันใน `data/history/silam/YYYY-MM/`
(รวม `hot-`, `a4t-`, `a4tw-` ที่ซ้ำกับรอบ CAMS) ตัวอย่างจริงตรวจจาก `git show origin/history:…` วันที่ 26–28 พ.ย. 2026

#### `obs-YYYYMMDDTHH.csv` — ค่าวัดที่ Kalman ใช้ในรอบ (หนึ่งไฟล์ต่อชั่วโมง) <!-- src: scripts/update.mjs:852,1192 -->

| คอลัมน์ | หน่วย | ความหมาย |
|---|---|---|
| `time_utc` | ISO | เวลาค่าวัด (Air4Thai = สิ้นสุดชั่วโมง) |
| `station_id` | – | id สถานี |
| `obs_pm25` | µg/m³ | ค่าวัด |
| `cams_raw` | µg/m³ | CAMS ที่เวลาเดียวกัน (Air4Thai: กลางชั่วโมง; สถานี 24 ชม.: ค่าเฉลี่ย 24 ชม. ของ CAMS) |
| `cams_plus_inc` | µg/m³ | CAMS + assimilation increment |

#### `fcst-YYYYMMDDTHH.csv` — forecast log (หนึ่งไฟล์ต่อ issue hour; ไม่เขียนซ้ำในชั่วโมงเดียวกัน) <!-- src: scripts/update.mjs:1204-1212 -->

| คอลัมน์ | หน่วย | ความหมาย |
|---|---|---|
| `issued_utc` | ISO ชั่วโมง | เวลาออกพยากรณ์ |
| `valid_utc` | ISO ชั่วโมง | เวลาที่ใช้ได้ |
| `station_id` | – | |
| `lead_h` | ชม. | `CFG.logLeads` |
| `cams_raw` | µg/m³ | CAMS ดิบ (หรือ SILAM ในรอบ SILAM) |
| `corrected` | µg/m³ | หลัง Kalman (`corr`) |
| `cams24`, `corr24` | µg/m³ | ค่าเฉลี่ย 24 ชม. ของ raw / corr (เมื่อมี `fc24`) |
| `blend24` | µg/m³ | ค่าเฉลี่ย 24 ชม. ที่ blend กับ persistence |
| `obs_basis` | `h` / `24` | ชนิดค่าวัด |
| `correctedA`, `blend24A` | µg/m³ | รวม fire assimilation |
| `correctedML`, `blend24ML` | µg/m³ | ค่าที่เผยแพร่ (v1 หรือ v2 ตามประตู; รวม nowcast เมื่อผ่าน) |
| `inc`, `fire`, `blh`, `ws`, `pr`, `obs_last`, `obs24_last`, `kfAb`, `hloc`, `doy`, `t2`, `rh`, `ws10`, `wd`, `o_ws`, `o_wd`, `o_t2`, `o_rh` | ต่าง ๆ | `FEAT_COLS`: increment (µg/m³), ควันไฟจำลอง (µg/m³), BLH (m), ลม 100 ม. (m/s), ฝน (mm/h), ค่าวัดล่าสุด, ค่าเฉลี่ย 24 ชม. ล่าสุด, bias ของ kfA (ln), ชั่วโมงท้องถิ่น, วันของปี, t2 (°C), RH (%), ลม 10 ม. (m/s), ทิศลม 100 ม. (° ที่ลมพัดมา), `o_*` = วัดที่สถานีตอนออกพยากรณ์ |
| `monitor` | 1 / 0 | reference monitor / เซนเซอร์ราคาประหยัด |
| `correctedML1` | µg/m³ | การแก้ v1 (ที่เผยแพร่ตามปกติ) |
| `correctedML2` | µg/m³ | การแก้ v2 (ผู้สมัคร) |
| `correctedPre` | µg/m³ | series ก่อน nowcast |
| `correctedNC` | µg/m³ | series หลัง nowcast |

#### `map-YYYYMMDDTHH.csv` — leave-one-out ของแผนที่ 0.025° <!-- src: scripts/update.mjs:1196-1199,1105 -->

`run_utc, analysis_utc, version (map | mapA), station_id, monitor (1/0), obs24, cams24, map_loo` (µg/m³; ค่าเฉลี่ย 24 ชม. ที่ชั่วโมงวิเคราะห์)

#### `climfc-YYYYMMDDTHH.csv` — forecast ระยะยาวคู่ climatology (ทุก 3 ชม. UTC, reference monitor รายชั่วโมง) <!-- src: scripts/update.mjs:1215-1222 -->

| คอลัมน์ | ความหมาย |
|---|---|
| `issued_utc`, `valid_utc`, `station_id`, `lead_h` | lead ตาม `CFG.climLogLeads` (24–120 ชม.) |
| `forecast` | ค่าที่เผยแพร่ F (`corrM` → `corrA` → `corr`) |
| `raw` | CAMS/SILAM ดิบ |
| `clim_mean`, `clim_p90` | climatology ของเดือน × ชั่วโมงของ valid time (µg/m³) |

#### `rainfc-YYYYMMDD.csv` — สมาชิกของ rain blend (ทุก 3 ชม. UTC, วันที่ไทย) <!-- src: scripts/update.mjs:629-645 -->

| คอลัมน์ | หน่วย | ความหมาย |
|---|---|---|
| `issued_utc` | ISO นาที | เวลาออก (มีนาที เช่น `18:08Z`) |
| `hour_start_utc` | ISO | ต้นชั่วโมงที่พยากรณ์ |
| `lead_h` | ชม. | `CFG.rainLogLeads` |
| `station_id`, `lat`, `lon` | – | สถานี Air4Thai รายชั่วโมง |
| `ecmwf_mmh` | mm/h | ECMWF (Open-Meteo) |
| `ecmwf_shift_mmh` | mm/h | ECMWF อ่านเลื่อน `shiftH` (จาก met ที่แทนชั่วโมงที่สังเกตแล้ว เหมือนหน้าเว็บ) |
| `ecmwf_amount_mmh` | mm/h | ECMWF × ตัวคูณ radar/ECMWF |
| `persist_mmh` | mm/h | radar ชั่วโมงเดียวกันของวันล่าสุดที่สังเกต |
| `nowcast_mmh` | mm/h | radar nowcast (lead ≤ 3) |
| `chelsa_factor` | – | ตัวคูณ CHELSA |
| `ecmwf_shift_pure_mmh` | mm/h | เหมือน `ecmwf_shift_mmh` แต่อ่านจาก ECMWF บริสุทธิ์ (`met.json`) |

#### `rainobs-YYYYMMDD.csv` — ฝนสังเกต (วันที่ไทย, เขียนครั้งเดียวตั้งแต่ 06:00 น. ต้องมี ≥ 20 ชั่วโมง) <!-- src: scripts/update.mjs:587-599 -->

| คอลัมน์ | ความหมาย |
|---|---|
| `hour_end_utc` | สิ้นสุดชั่วโมง |
| `kind` | `a4t` (สถานี Air4Thai) หรือ `gauge` (ThaiWater) |
| `station_id` | id สถานี (ว่างสำหรับ gauge) |
| `lat`, `lon` | ตำแหน่ง |
| `gauge_mm` | ฝนที่ gauge วัด (mm ในชั่วโมง; เฉพาะ `gauge`) |
| `gsmap_cell`, `gsmap_bil`, `gsmap_fine`, `gsmap_src` | GSMaP เซลล์ 0.1°, bilinear, 0.025° × CHELSA, แหล่ง (NRT/NOW) |
| `radar_mmh` | radar ที่ปรับด้วย gauge (คอลัมน์ที่ 10 นับจาก 0: `rainDetectCheck` อ่านตามตำแหน่ง) |
| `pardig_cell`, `pardig_fine` | PARDIG เซลล์ 0.1° และ 0.025° (เพิ่มท้ายเพื่อไม่ให้ตำแหน่งเดิมเลื่อน) |

#### `ecpr-YYYYMMDDHH.json` — ECMWF open-data rain ต่อ run <!-- src: scripts/ecmwf_pr.py:10-14 -->

`{ run (ms), source, lon0: 92, lat0: 5, step: 0.25, nx: 73, ny: 81, scale: 10, enc: 'deflate-int16', t0[], t1[], d[] }`: หนึ่งบล็อกต่อช่วง (t0, t1] (3 ชม. แล้ว 6 ชม.) ค่าเฉลี่ยอัตราฝน mm/h × 10 (ตัวอย่าง run 2026-11-27 12 UTC มี 52 ช่วง)

#### ไฟล์อื่นใน `data/history/`

| ไฟล์ | คอลัมน์ / โครงสร้าง | ที่มา |
|---|---|---|
| `a4t-YYYYMMDD.csv` | `hour_end_utc, station_id, pm25` (วันไทยของเมื่อวาน, เขียนตั้งแต่ 03:00 น.) | <!-- src: scripts/update.mjs:463-467 --> |
| `a4tw-YYYYMMDD.csv` | `hour_end_utc, station_id, ws_ms, wd_deg, temp_c, rh_pct` | <!-- src: scripts/update.mjs:469-470 --> |
| `wxf-YYYYMMDDTHH.csv` | `issued_utc, valid_utc, station_id, lead_h, elev_m, t2_ecmwf, t2_terrain, t2_down, pr_ecmwf, pr_fine, t2_ml, pr_ml` (°C, mm/h) | <!-- src: scripts/update.mjs:745-755 --> |
| `iqair-YYYYMMDDTHH.csv` | `time_utc, city_id, name, lat, lon, aqius` | <!-- src: scripts/update.mjs:1194-1195 --> |
| `hot-YYYYMMDD.csv` | `time_utc, lat, lon, frp_mw, conf, sat, igbp` (วัน UTC เมื่อวาน, เขียนตั้งแต่ 08:00 UTC) | <!-- src: scripts/update.mjs:801-804 --> |
| `silam-YYYYMMDD.json` | `{ run, source, lon0: 92, lat0: 5.4, step: 0.2, nx: 91, ny: 95, times[120], scale: 10, enc: 'int-dx', values[120][] }` | <!-- src: scripts/silam.py:10-13 --> |
| `pmday-YYYYMMDD.json` | `{ day, lon0, lat0, step: 0.05, nx: 361, ny: 371, hours[], sum[] }` | `pmmean.mjs` |
| `pmmonth-YYYYMM.json` | ค่าเฉลี่ยเดือนที่จบแล้ว (ไม่มีวันที่ 8 หลัก จึงไม่ถูกตัดอายุ) | <!-- src: scripts/pmmean.mjs:6-7 --> |
| `ml-YYYYMMDD.json` | ผลเรียนรู้รายวันของ v1: `day, at, verifiedDays, nTest, loss{expert}, weights{expert}, trained{…}, seasonStore`; `v2{…, check}`; `nowcast` (ผล `pmNowCheck`) | `update.mjs` 4c |
| `mlwx-YYYYMMDD.json` | `{ t2: {...}, pr: {...} }` โครงสร้างเดียวกัน | `mlwx` block |
| `stations.json` | 6.5.5 | `stationlist.mjs` |

ไฟล์เก่า `obs-2026-10.csv`, `fcst-2026-10.csv` ที่ระดับบนสุดเป็นรูปแบบรายเดือนเดิม (`verify.mjs` ยังอ่านได้) <!-- src: scripts/verify.mjs:27 -->

### 6.5.9 `data/static/*` (commit บน `main`)

| ไฟล์ | โครงสร้าง | สร้างโดย |
|---|---|---|
| `elev.json` | `{ lon0: 92, lat0: 5.5, step: 0.05, nx: 361, ny: 371, values[], source: 'AWS Terrain Tiles (Terrarium, zoom 7)', key }` (m) | `buildDEM` (รอบแรก/เมื่อ key เปลี่ยน) |
| `elev025.json` | `{ lon0: 92, lat0: 5.5, step: 0.025, nx: 721, ny: 761, enc: 'int-dx', values[], source, key }` | `packDEM` |
| `pm-clim.json` | `{ version, built, from, to, minN, cell, basis, stations: { id: { n, mean[288], p90[288], basis, src } } }` (µg/m³ × 10, −1 = < minN; ดัชนี (เดือน−1)·24 + ชั่วโมง); ณ วันที่ตรวจมี 107 สถานี | `climatology.mjs` |
| `hc-model.json` | `{ version, names (HC_NAMES), trained: '2026-11-21', rows: 1309587, seasons, source, cv, model{type, f0, edges, trees, n, importance} }` | `hindcast_train.mjs` |
| `prclim/factor_MM.bin` + `meta.json` | ตัวคูณ uint8 ÷ 50 บีบอัด zlib, 720 × 800 ที่ 0.025° (lon0 92.0125, lat0 5.0125) | `prclim.py` |
| `th-adm2.json`, `th-adm3.json` | GeoJSON อำเภอ (ระดับ 2) / ตำบล (ระดับ 3), properties `c, en, th, pen, pth, den, dth`, มี `attribution` | `admin_bounds.mjs` |

# บทที่ 7 คู่มือการปฏิบัติงาน (Operations Guide)

> ภาค C3 (ต่อ): วงรอบรายชั่วโมง งานตามรอบและงานด้วยมือ ประตูตรวจ (gates) การ deploy, Actions cache และการแก้ปัญหา
> ทุกค่าคัดจากโค้ดและ workflow และระบุตำแหน่งไว้ใน `<!-- src: … -->` เวลาไทย = UTC + 7 ชม.
> ไม่มีค่า secret ใด ๆ ในบทนี้ และไม่มีวิธีใดที่ปิดการตรวจ certificate

---

## 7.1 วงรอบรายชั่วโมง (hourly cycle)

### 7.1.1 การเริ่มรอบ

| ตัวเริ่ม | เวลา | หมายเหตุ |
|---|---|---|
| cron ภายนอก (cron-job.org → `workflow_dispatch`) | ทุกชั่วโมง นาทีที่ :07 UTC | ตัวเริ่มหลัก <!-- src: .github/workflows/update.yml:5 --> |
| `schedule: '37 */3 * * *'` | ทุก 3 ชม. นาทีที่ :37 UTC | สำรองเท่านั้น (cron ของ GitHub มาช้าได้) |
| `push` ไป `main` (โค้ด/หน้าเว็บ/แชต/assets/workflow) | เมื่อ merge | rerun และ redeploy |
| กดปุ่ม *Run workflow* | ด้วยมือ | |

รอบที่สองในชั่วโมงเดียวกัน (สำรอง, ด้วยมือ) ไม่เขียน log ซ้ำ: `obs-`, `fcst-`, `map-`, `iqair-`, `climfc-` ตรวจว่ามีไฟล์ของชั่วโมงแล้ว
และ `rainfc-` ตรวจว่ามี issue hour นี้แล้ว <!-- src: scripts/update.mjs:643,1191,1211 --> รอบใหม่รอรอบเก่าจบก่อน (concurrency `hourly-update`)

### 7.1.2 ลำดับเวลาในหนึ่งรอบ

ขีดจำกัดของ job คือ 25 นาที; หลังนาทีที่ 16 ขั้นที่ไม่จำเป็นจะถูกข้ามเพื่อให้ forecast และ state ถูกเขียนทัน <!-- src: scripts/update.mjs:47-49; .github/workflows/update.yml:28 -->

| ลำดับ | ขั้น | เวลาจำกัด / หมายเหตุ |
|---|---|---|
| 1 | restore cache, history, mltrain | ลองซ้ำ 3 ครั้ง |
| 2 | `silam.py` | ≤ 6 นาที (มี run ใหม่ราววันละครั้ง ออกราว 05:00 UTC) <!-- src: scripts/silam.py:8 --> |
| 3 | `ecmwf_pr.py` | ≤ 5 นาที (run ใหม่ 00/12 UTC, อ่าน ≈ 17 วินาที) |
| 4 | `update.mjs` (CAMS) | ภายใน: สถานี → CAMS → ค่าวัด → met → radar (ข้ามหลังนาที 16) → GSMaP/PARDIG/gauge (ข้ามหลังนาที 16; PARDIG ≤ 3 นาที) → t2 + weather ML (ข้ามหลังนาที 16) → FIRMS → assimilation → Kalman → ML → nowcast → RK → output <!-- src: scripts/update.mjs:528,531,542,661 --> |
| 5 | `verify.mjs` | |
| 6 | `silam_chain.mjs` | ≤ 8 นาที, ใช้คำตอบ HTTP ที่รอบ CAMS เก็บไว้ ไม่มี time budget ของตัวเอง (`late()` คืน true เสมอในโหมด SILAM: ข้ามขั้นที่ไม่ขึ้นกับโมเดล) <!-- src: scripts/update.mjs:371 --> |
| 7 | `perf.mjs`, `accuracy.mjs` | ≤ 5 และ ≤ 3 นาที |
| 8 | save cache → push `main` (static), `history`, `mltrain` | |
| 9 | build `_site` → GitHub Pages → Cloudflare Pages | |

### 7.1.3 เหตุการณ์ที่เกิดตามเวลาของวัน

| เวลา | งาน | เงื่อนไขในโค้ด |
|---|---|---|
| ทุกรอบ | ค่าวัด, Kalman, station forecast, ML apply, nowcast, RK, `latest.json`, `obs-`/`fcst-`/`map-` log, `accuracy.json` | – |
| ทุก 3 ชม. (ชั่วโมง UTC หารด้วย 3 ลงตัว) | `rainfc-*.csv`, `climfc-*.csv`; `perf.mjs` คำนวณใหม่เมื่อ `perf.json` อายุ ≥ 3 ชม. | <!-- src: scripts/update.mjs:629,1215; scripts/perf.mjs:16 --> |
| ทุก 12 ชม. | ดึง CAMS ใหม่, ดึง ECMWF (Open-Meteo) ใหม่ | `camsRefreshH`, `met.refreshH` |
| ทุก 24 ชม. | สร้างรายชื่อสถานีใหม่ | `stationRefreshH` |
| 03:00 น. เป็นต้นไป | เขียน `a4t-<เมื่อวาน>.csv`, `a4tw-<เมื่อวาน>.csv` ครั้งเดียว (ต้องมี > 12 แถวต่อสถานีโดยเฉลี่ย) | <!-- src: scripts/update.mjs:466 --> |
| 04:00 น. เป็นต้นไป | การเรียนรู้รายวันของ PM2.5: v1 `dailyLearn`, v2 + `pmHighCheck`, `pmNowCheck`; เขียน `ml-<เมื่อวาน>.json` | `thaiHour >= 4 && state.ml.lastDay !== yday` <!-- src: scripts/update.mjs:933 --> |
| 06:00 น. เป็นต้นไป | เขียน `rainobs-<เมื่อวาน>.csv` ครั้งเดียว (ต้องมี ≥ 20 ชั่วโมงที่มี GSMaP/PARDIG/radar) | <!-- src: scripts/update.mjs:589,598 --> |
| หลังมี `rainobs` ของเมื่อวาน (หรือ 12:00 น.) | `obsRainCheck` วันละครั้ง | <!-- src: scripts/update.mjs:547 --> |
| 07:00 น. เป็นต้นไป (รอ `rainobs` ถึง 12:00 น.) | การเรียนรู้รายวันของอุณหภูมิและฝน + `rainDetectCheck`; เขียน `mlwx-<เมื่อวาน>.json` | <!-- src: scripts/update.mjs:701-718 --> |
| รอบแรกของวัน UTC ใหม่ (≈ 07:07 น.) | branch `history` ถูกแทนด้วย commit เดียว (snapshot 35 วัน) | <!-- src: .github/workflows/update.yml:178-181 --> |
| 08:00 UTC (15:00 น.) เป็นต้นไป | เขียน `hot-<วัน UTC เมื่อวาน>.csv` ครั้งเดียว (ต้องได้คำตอบ FIRMS จริงในรอบนั้น) | <!-- src: scripts/update.mjs:802 --> |
| รอบ 17 UTC (24:00 น.) | forecast lead 24/48 ชม. ของรอบนี้ใช้คำนวณความแม่นยำค่าเฉลี่ยวันปฏิทิน (`m1`, `m2`) | <!-- src: scripts/accuracy.mjs:66-71 --> |
| วันละครั้ง (วันที่ไทยเปลี่ยน) | `data/history/stations.json` ถูกเขียนใหม่ | <!-- src: scripts/stationlist.mjs:6 --> |

---

## 7.2 งานตามรอบและงานด้วยมือ

| งาน | ความถี่ | วิธีรัน | ผล |
|---|---|---|---|
| Station climatology | ครั้งเดียว (สร้างเมื่อ 21 พ.ย. 2026) และเมื่อจำเป็น เช่น มีสถานีใหม่มาก | Actions → *Station climatology* → Run workflow | commit `data/static/pm-clim.json` |
| Rain-blend refit | รายเดือน วันที่ 1 เวลา 08:51 น. (scheduled task ใน Claude Code) | 7.2.2 | PR แก้ `CFG.rainBlend` ถ้าค่าเปลี่ยน |
| Clim-blend fit | ครั้งแรกหลังมี `climfc-*.csv` ราว 2 สัปดาห์ (log เริ่ม 21 พ.ย. 2026 03 UTC ⇒ ราว 5 ธ.ค. 2026) | 7.2.3 | วางน้ำหนักใน `CFG.climBlend` เฉพาะเมื่อ fit ให้ค่าไม่เป็นศูนย์ |
| Hindcast training | ครั้งเดียว (ฝึกแล้ว 21 พ.ย. 2026, 1,309,587 แถว) | 7.2.4 | `data/static/hc-model.json` |
| Chat retraining | อัตโนมัติทุกวันจันทร์ 03:23 น.; ด้วยมือหลังแก้ `scripts/chat_data.mjs` หรือ `chat/data/` | 7.2.5 | `chat/model.json` |
| Rebuild `index_modern.html` | ทุกครั้งที่แก้โค้ดใน `index.html` | 7.2.6 | `index_modern.html` |
| Cloudflare setup | ครั้งเดียว | Actions → *Cloudflare setup* | resource บน Cloudflare + id ใน `wrangler.toml` |
| Rain climatology factors (CHELSA) | ครั้งเดียว | Actions → *Rain climatology factors* | `data/static/prclim/` |

<!-- src: CLAUDE.md "Scheduled work"; data/static/pm-clim.json built; data/static/hc-model.json trained/rows -->

### 7.2.1 Station climatology

1. ไปที่ Actions → *Station climatology* → *Run workflow* (`climatology.yml` รับเฉพาะ `workflow_dispatch`)
2. workflow ใช้รายชื่อสถานีจาก cache ของรอบรายชั่วโมง (restore อย่างเดียว ไม่ save) <!-- src: .github/workflows/climatology.yml:27-50 -->
3. `climatology.mjs` อ่าน 3 ปีล่าสุด สำเนา OpenAQ ของ Air4Thai ให้ `basis: '24h'` (ระดับรายเดือนถูก แต่รายชั่วโมงแบน) <!-- src: scripts/climatology.mjs:7-8 -->
4. ผลถูก commit ไป `main` การเปลี่ยน `pm-clim.json` ไม่ทำให้ v2 เริ่มเรียนรู้ใหม่ (เปลี่ยนเฉพาะค่า ไม่ใช่รายชื่อ input)

### 7.2.2 Rain-blend refit รายเดือน (`fit_rain_blend.py`)

```bash
git fetch --depth=1 origin history
mkdir -p /tmp/hist && git archive FETCH_HEAD data/history | tar -x -C /tmp/hist
python3 scripts/fit_rain_blend.py /tmp/hist/data/history
```

1. สคริปต์อ่าน `rainfc-*.csv` และ `rainobs-*.csv` (radar ที่ปรับด้วย gauge เป็นค่าจริง, **ไม่ใช่ PARDIG**) <!-- src: scripts/fit_rain_blend.py:3-6,26-31 -->
2. ราย lead: NNLS บน ln(R + 0.2) แล้วตรวจ leave-one-week-out; เก็บน้ำหนักเฉพาะเมื่อผ่านทั้งสามข้อ (MSE ต่ำกว่า, จับชั่วโมงฝนได้ไม่น้อยกว่า, false alarm ไม่มากกว่า) lead ที่มี < 300 แถวหรือ < 30 ชั่วโมงเปียกให้น้ำหนัก 0 <!-- src: scripts/fit_rain_blend.py:58-80 -->
3. คัดลอกบรรทัด `rainBlend: { … }` ที่สคริปต์พิมพ์ไปแทนใน `CFG.rainBlend` **ตรงตามที่พิมพ์** ห้ามแก้ตัวเลข
4. ถ้าค่าเปลี่ยน: เปิด PR, merge, แล้วดูรอบรายชั่วโมงถัดไปว่า `latest.json rainObs.corr.w` เป็นค่าใหม่
5. fit ครั้งแรก 8 พ.ย. 2026 (ข้อมูล 15 ต.ค.–8 พ.ย.): เก็บ lead 1–2 ชม., 3–48 ชม. ใช้ ECMWF ล้วน คาดว่าน้ำหนักจะกลับมาเมื่อเข้าฤดูฝน <!-- src: scripts/update.mjs:96-99; CLAUDE.md "Scheduled work" -->

### 7.2.3 Clim-blend fit (`fit_clim_blend.mjs`)

```bash
node scripts/fit_clim_blend.mjs /tmp/hist/data/history /tmp/hist/data/history         # CAMS
node scripts/fit_clim_blend.mjs /tmp/hist/data/history/silam /tmp/hist/data/history   # SILAM
```

- ราย lead ลอง w = 0, 0.05, …, 1; เลือก w > 0 เฉพาะเมื่อ RMSE ต่ำลง จับชั่วโมง ≥ 37.5 ได้ไม่น้อยกว่า และ false alarm ไม่มากกว่า w = 0 บน ≥ 2,000 แถวที่มี ≥ 50 ชั่วโมงสูง <!-- src: scripts/fit_clim_blend.mjs:14,20-27 -->
- วางบรรทัด `weights for CFG.climBlend: […]` ลงใน `CFG.climBlend.cams` / `.silam` ตรงตามที่พิมพ์
- **สำคัญ:** ณ วันที่เขียน `update.mjs` ยังไม่มีโค้ดที่ใช้น้ำหนักนี้ (บันทึกอย่างเดียว) ถ้า fit ได้ค่าไม่เป็นศูนย์ ต้องเพิ่มโค้ดที่นำไปใช้กับ station forecast และแผนที่ด้วย <!-- src: README.md:14 -->
- ระหว่างนี้ climatology blend **ยังไม่ทำงาน** (น้ำหนักทั้งหมด 0)

### 7.2.4 Hindcast training (`hindcast_train.mjs`)

```bash
git fetch origin hindcast && mkdir -p /tmp/hc && git archive FETCH_HEAD data/hindcast | tar -x -C /tmp/hc
node scripts/hindcast_train.mjs /tmp/hc/data/hindcast data/static/hc-model.json
```

<!-- src: scripts/hindcast_train.mjs:2-3 -->

- ทำ leave-one-season-out ก่อน (ฝึก 2 ฤดู ทดสอบฤดูที่ 3 ที่ lead 12, 24, 36, 48, 60 ชม.) แล้วฝึกบนทั้งสามฤดู ผล cv อยู่ใน `hc-model.json`
- ห้ามให้น้ำหนักกับ expert hindcast ด้วยมือ การให้คะแนนรายวันเป็นผู้ตัดสิน (ตัวอย่าง: วันที่ 27 พ.ย. 2026 อยู่นอกฤดู 18 ธ.ค.–30 เม.ย. expert ให้ 0 จึงมี loss เท่ากับ base 0.27055 และน้ำหนัก 0.0165) <!-- src: history:data/history/2026-11/ml-20261127.json -->
- คงประกาศ Copernicus ของข้อมูล hindcast เมื่อคัดลอก (ภาคผนวก 8.3)

### 7.2.5 Chat retraining

- อัตโนมัติ: `chat-train.yml` วันจันทร์ 03:23 น. (`chat_learn.mjs` → `chat_train.mjs --gate` → tests → commit)
- ด้วยมือหลังแก้ `scripts/chat_data.mjs` หรือ `chat/data/`: `node scripts/chat_train.mjs` แล้ว `node --test scripts/chatml.test.mjs scripts/chat_pages.test.mjs`
- ห้ามฝึกบน `chat/test.json` หรือ `chat/test_real.json`; ชนิดโมเดล (linear หรือ MLP) เลือกด้วย development set ไม่ใช่ด้วยมือ (CLAUDE.md)
- ข้อเสนอจาก LLM ในเครื่องของ admin (`chat_llm_label.mjs`) ไม่เป็นป้ายจนกว่า admin จะคลิก

### 7.2.6 Rebuild `index_modern.html`

```bash
node scripts/build_modern.mjs index.html index_modern.html index_modern.html
```

- ต้องรันหลังแก้โค้ดของ `index.html` ทุกครั้ง และ commit ทั้งสองไฟล์ (CLAUDE.md กฎข้อ 2)
- ถ้าพิมพ์ `index_modern.html published as it is: … missing ids: …` ให้เพิ่ม element id ที่ขาดใน markup ของ `index_modern.html` แทนการปล่อยให้สองหน้าแยกกัน <!-- src: scripts/build_modern.mjs:16-19 -->
- ใน workflow ขั้น Build site ใช้คำสั่งเดียวกันเขียน `_site/index.html` เสมอ <!-- src: .github/workflows/update.yml:219 -->

---

## 7.3 ประตูตรวจ (gates) และวิธีอ่าน

หลักร่วมของทุกประตู: เปรียบเทียบ "ผู้สมัคร" กับ "ค่าเดิม" บนแถวเดียวกัน ด้วย **จำนวนชั่วโมงเหตุการณ์ที่จับได้** และ **สัดส่วน false alarm**
(ไม่ใช่ RMSE อย่างเดียว เพราะ RMSE / error บน log ลดได้ด้วยการพยากรณ์ค่าต่ำลงหรือฝนน้อยลงทุกที่) ประตูที่ยังมีข้อมูลไม่พอ (`decided: false`) จะคงค่าเดิมไว้

### 7.3.1 สรุป

| ประตู | ผู้สมัคร vs ค่าเดิม | ข้อมูล | ตัดสินได้เมื่อ (`decided`) | ผ่าน (`ok`) เมื่อ | ผลเมื่อผ่าน |
|---|---|---|---|---|---|
| `pmHighCheck` | `correctedML2` vs `correctedML1` (หรือ `correctedML`/`correctedA` ในแถวเก่า) | `fcst-*.csv` 14 วัน, reference monitor รายชั่วโมง, lead ≤ 24, ตั้งแต่ `state.ml2.since` | n ≥ 20,000 และชั่วโมง ≥ 37.5 ≥ 100 | hit2 ≥ hit1 **และ** fa2 ≤ fa1 **และ** rmse2 ≤ rmse1 | เผยแพร่ v2 แทน v1 (ต้องมี `mlActive` ด้วย) |
| `pmNowCheck` | `correctedNC` vs `correctedPre` (แถวก่อน 28 พ.ย. 2026 สร้างใหม่จาก `correctedML`) | `fcst-*.csv` 14 วัน, reference monitor รายชั่วโมง, lead ≤ 6 | ช่วงข้อมูล ≥ 13 วัน, n ≥ 20,000, ชั่วโมงสูง ≥ 50 | เหมือนข้างบน | nowcast แทน series ที่สถานีรายชั่วโมง (ไม่แตะแผนที่) |
| `obsRainCheck` | PARDIG vs GSMaP ที่ gauge ThaiWater (เซลล์ 0.1°) | `rainobs-*.csv` 14 วัน แถว `gauge` ที่มีทั้ง `gauge_mm`, `gsmap_cell`, `pardig_cell` | ≥ 3 วันที่มีข้อมูล, n ≥ 20,000, ชั่วโมงเปียก ≥ 300 | hit_p ≥ hit_g **และ** fa_p ≤ fa_g | PARDIG เป็นฝนสังเกตของหน้าเว็บ (ยังไม่ตัดสิน = PARDIG) |
| `rainDetectCheck` | `pr_ml` vs `pr_fine` (ฝน weather ML vs ECMWF × CHELSA) | `wxf-*.csv` 14 วัน vs `radar_mmh` ของแถว `a4t` ใน `rainobs` | n ≥ 2,000 และชั่วโมงเปียก ≥ 50 (รวมอยู่ใน `ok`) | hit_m ≥ hit_f **และ** fa_m ≤ fa_f | เผยแพร่การแก้ฝนใน `wx-ml.json` |

<!-- src: scripts/ml2.mjs:98-120; scripts/pmnow.mjs:43-64; scripts/update.mjs:143-175,724,991,1042 -->

เกณฑ์ "ชั่วโมงสูง" = 37.5 µg/m³ (`ML2.thr`); "ชั่วโมงฝน" = ≥ 0.5 mm/h; false alarm share = (จำนวนพยากรณ์ ≥ เกณฑ์ − จำนวนที่ถูก) ÷ จำนวนพยากรณ์ ≥ เกณฑ์

### 7.3.2 `pmHighCheck` (PM2.5 correction v2)

- รันวันละครั้งในบล็อกการเรียนรู้ 04:00 น. ผลเก็บที่ `state.ml2.check`, `latest.json ml.v2.check` และ `ml-YYYYMMDD.json v2.check` <!-- src: scripts/update.mjs:954-957,1172 -->
- บรรทัด log (และ annotation `PM2.5 correction v2`):
  `PM2.5 correction v2 check (14 d, <n> station-hours …, <high> at >= 37.5): caught <hit2> v2 vs <hit1> live, false alarms <fa2> % vs <fa1> %, RMSE <rmse2> vs <rmse1> -> v2 published | live correction kept | too few rows yet, live correction kept` <!-- src: scripts/update.mjs:955 -->
- อ่าน: `decided: false` = ข้อมูลยังไม่พอ; `ok: false` = อย่างน้อยหนึ่งในสามข้อแย่กว่า (ดูว่าข้อไหน)
- ตัวอย่างจริง (วันที่ 27 พ.ย. 2026): n 50,311, ชั่วโมงสูง 3,387; จับได้ 979 (v2) vs 706 (v1), false alarm 50.0 % vs 24.1 %, RMSE 9.304 vs 8.30 ⇒ `decided: true`, `ok: false` ⇒ **คง v1 ไว้** (v2 จับได้มากกว่าแต่ false alarm และ RMSE สูงกว่า) <!-- src: history:data/history/2026-11/ml-20261127.json -->
- ห้ามเปิด v2 ด้วยมือหรือผ่อนเกณฑ์ (CLAUDE.md) v2 จึง**ยังไม่ใช้งาน**บนหน้าเว็บ ณ วันที่เขียน

### 7.3.3 `pmNowCheck` (PM2.5 nowcast 1–6 ชม.)

- รันวันละครั้งต่อจาก v2 ผลเก็บที่ `state.pmNow.check` (แยกตามโมเดล เพราะ `pmNow` อยู่ใน `MODEL_KEYS`) และ `ml-YYYYMMDD.json nowcast` <!-- src: scripts/update.mjs:960-966 -->
- บรรทัด log: `PM2.5 nowcast check (14 d, <n> station-hours at leads 1–6 h, <high> at >= 37.5): <rebuilt> of them rebuilt from older logs; caught <hit2> with vs <hit1> without, false alarms …, RMSE … -> published | logged only | not enough days of rows yet, logged only` <!-- src: scripts/update.mjs:964 -->
- แถวที่สร้างใหม่ (`rebuilt`): ใช้ forecast lead 1 ชม. ของรอบก่อนหน้าเทียบกับชั่วโมงที่วัดล่าสุด แบบเดียวกับที่ pipeline คำนวณ เพื่อให้ตัดสินได้โดยไม่ต้องรอ 14 วัน <!-- src: scripts/pmnow.mjs:38-42,57-61 -->
- สถานะ: เริ่มใช้ 28 พ.ย. 2026 ผลตัดสินครั้งแรก **รอข้อมูล** (ยังไม่มีไฟล์ `ml-*.json` ที่มีส่วน `nowcast` บน branch `history` ณ วันที่เขียน) จนกว่าประตูผ่าน nowcast **บันทึกอย่างเดียว ไม่เผยแพร่**

### 7.3.4 `obsRainCheck` (PARDIG หรือ GSMaP บนหน้าเว็บ)

- รันวันละครั้งเมื่อมี `rainobs` ของเมื่อวาน (หรือหลัง 12:00 น.) ผลเก็บที่ `state.obsRainCheck` <!-- src: scripts/update.mjs:547-549 -->
- annotation `observed rain source`: `observed rain vs ThaiWater gauges (<nDays> of 14 d logged, <n> gauge-hours, <wet> wet >= 0.5 mm): rain hours caught PARDIG <hit_p> vs GSMaP <hit_g>, false alarms … , CSI … -> too few days logged yet, PARDIG kept | PARDIG on the page | GSMaP on the page` <!-- src: scripts/update.mjs:550 -->
- `usePardig = state.obsRainCheck?.pardigOK !== false` ⇒ ยังไม่ตัดสินหรือผ่าน = PARDIG <!-- src: scripts/update.mjs:553 -->
- หมายเหตุ: GSMaP ใช้ไม่ได้ตั้งแต่ 18 พ.ย. 2026 (JAXA ปิดระบบ) <!-- src: README.md:43 --> แถวที่ไม่มี `gsmap_cell` ไม่ถูกนับ ดังนั้นตามโค้ด ประตูนี้จะคงอยู่ที่ `decided: false` ⇒ PARDIG ต่อไปจนกว่า GSMaP กลับมา

### 7.3.5 `rainDetectCheck` (การแก้ฝนของ weather ML)

- รันในบล็อก weather ML วันละครั้ง ผลที่ `state.wxml.pr.detect` <!-- src: scripts/update.mjs:715-716 -->
- log: `weather ML rain correction check (14 d, <n> station-hours, <wet> wet): rain hours caught <hit_m> corrected vs <hit_f> uncorrected, false alarms … -> published | NOT published`
- ค่าจริงคือ radar ที่ปรับด้วย gauge (`radar_mmh`) ไม่ใช่ PARDIG (PARDIG ใช้ ECMWF เป็น input) <!-- src: scripts/update.mjs:138-142 -->
- การแก้อุณหภูมิไม่มีประตูนี้: ใช้เมื่อ expert มีน้ำหนัก (`T2ENG.active`) <!-- src: scripts/update.mjs:724 -->

### 7.3.6 ที่ดูสถานะประตู

| ที่ | สิ่งที่เห็น |
|---|---|
| หน้า run ของ Actions (annotations) | `::notice` ของ v2, nowcast, observed rain source |
| `data/runlog.json` / `latest.json runlog` | บรรทัด log ทั้งหมดของรอบ |
| `latest.json ml.v2` | `{ published, weights, check }` |
| `state.json` (Actions cache) | `ml2.check`, `pmNow.check`, `obsRainCheck`, `wxml.pr.detect`, `silamState.*` |
| `data/history/YYYY-MM/ml-*.json` | ผลรายวันย้อนหลัง 35 วัน |
| หน้า developer `/dev.html` | ตารางตรวจรายวัน (ต้องเข้าสู่ระบบ; ภาค C2) |

---

## 7.4 การ deploy

### 7.4.1 ลำดับ

1. **GitHub Pages ก่อน**: `upload-pages-artifact` → รอ 15 วินาที → `deploy-pages`; ถ้าล้ม รอ 45 วินาทีแล้วลองอีกครั้ง (GitHub บางครั้งยังไม่เห็น artifact: "No artifacts named github-pages were found") <!-- src: .github/workflows/update.yml:257-276 -->
2. **Cloudflare Pages ทีหลัง**: เฉพาะเมื่อมี secrets ทั้งสองและ `wrangler.toml` ไม่มี `SET_BY_CLOUDFLARE_SETUP` <!-- src: .github/workflows/update.yml:282-292 -->
3. Cloudflare ล้มไม่ทำให้ GitHub Pages เสีย (`continue-on-error: true`; GitHub deploy เสร็จไปก่อนแล้ว)

### 7.4.2 กฎของ Cloudflare

- รัน wrangler **ในโฟลเดอร์นอก repository** เสมอ (`$RUNNER_TEMP/cfpages` ใน workflow; `cd "$RUNNER_TEMP"` ใน setup) เพราะถ้ารันใน repo wrangler จะเขียนโปรเจกต์ใหม่เป็น Worker <!-- src: .github/workflows/update.yml:280-281,293-297; .github/workflows/cloudflare-setup.yml:62 -->
- path ของหน้าเว็บต้องเป็น relative ทั้งหมด เพราะเว็บอยู่ที่ root บน pages.dev แต่อยู่ใต้ `/hotspot-smoke-watch/` บน GitHub Pages (CLAUDE.md)
- pin เวอร์ชัน `wrangler@4.160.1`; ลอง 3 ครั้ง (รอ 20 และ 40 วินาที) ล้มทั้งหมด ⇒ warning "the next run tries again"
- Pages Functions (`functions/api/*.js`) และ binding D1 `DB` / KV `KV` ถูกส่งพร้อมกัน

### 7.4.3 ที่อยู่ของเว็บ

| ที่อยู่ | บทบาท |
|---|---|
| https://sea-haf.pages.dev | เว็บหลัก (Cloudflare Pages) |
| GitHub Pages ของ repo (`/hotspot-smoke-watch/`) | สำรอง, `_site` เดียวกัน, deploy ก่อน |
| `/` และ `/index_modern.html` | หน้าสาธารณะ (redesign) |
| `/classic.html` | หน้าเดิมแบบสาธารณะ |
| `/dev.html`, `/perf.html` | หน้า developer และ performance (เข้ารหัส) |

---

## 7.5 Actions cache

### 7.5.1 สิ่งที่อยู่ใน cache

รายการ path (ต้องเหมือนกันใน restore, save และ `climatology.yml`; **ห้ามเพิ่มไฟล์** เพราะ version ของ cache ขึ้นกับรายการ รอบถัดไปจะเริ่มโดยไม่มี state) <!-- src: .github/workflows/update.yml:41-57; CLAUDE.md -->
ดังนั้น state ใหม่จึงซ้อนอยู่ในไฟล์เดิม เช่น cache ของ PARDIG อยู่ใน `gsmap-cache.json` และ state ของ SILAM อยู่ใน `state.json` (`silamState`)

| ไฟล์ | ถ้าหายจะเกิดอะไร | ฟื้นเองเมื่อใด |
|---|---|---|
| `state.json` | หายทั้งหมด: รายชื่อสถานี (สร้างใหม่ทันที), CAMS ที่เก็บไว้ (ดึงใหม่), Kalman ทุกสถานี (เริ่ม b = 0, P0 = 0.5), `kfSlow` (ความจำหลายสัปดาห์), `incFc`, `assimKappa` (กลับเป็น 4), `obsHist` 50 ชม. (ค่าเฉลี่ย 24 ชม. ที่สถานีรายชั่วโมงไม่ valid จนกว่าครบ 18 ชม.; Air4Thai ได้ 48 ชม. คืนจาก history service ทันที), `daily` (QC เซนเซอร์ต้อง ≥ 10 วัน ⇒ เซนเซอร์ราคาประหยัดไม่เข้าแผนที่ราว 10 วัน), น้ำหนักและโมเดล ML v1/v2 และ weather ML (ต้องรอรอบเรียนรู้รายวัน; น้ำหนักเริ่มที่ base ⇒ ไม่มีการแก้ ML อย่างน้อยถึงวันถัดไป), `pmNow`/`pmNowFc`, ผลประตูทั้งหมด, `iqair`, `gaugeRain` 48 ชม., `radarFactor`, `rainDiag`, `t2fc`/`t2score`, `silamState` | Kalman: หลายชั่วโมงถึงวัน; ML: ตั้งแต่ 1 วัน (ข้อมูลฝึก 35 วันยังอยู่ใน `history`/`mltrain`) |
| `met.json` | ดึง ECMWF ใหม่ (ใช้โควตา Open-Meteo) | รอบถัดไป |
| `latest.json` | ไม่มีชุด hotspot สำรองถ้า FIRMS ล่มในรอบนั้น; ขั้น SILAM chain ต้องการไฟล์นี้ | รอบถัดไป |
| `rk-bias.json`, `rk-bias-A.json`, `ml-field.json` | สร้างใหม่ทุกรอบ | ทันที |
| `landcover.bin` | สร้างใหม่จาก NASA GIBS | รอบถัดไป |
| `verify.json` | สร้างใหม่จาก log | ทันที |
| `gsmap-cache.json` | GSMaP 48 ชม. และ PARDIG 48 ชม. หาย (PARDIG ดึงย้อนได้ `firstH = 24` ชม. ต่อรอบภายใน 3 นาที) | ภายในหลายรอบ |
| `radar-cache.json` | frame radar (ดึงย้อนได้เพียง 2 ชม.), ค่ารายชั่วโมง 72 ชม., coverage footprint (นับ echo ≥ 2 ชั่วโมง) ⇒ radar ไม่มี coverage จนกว่าจะเห็นฝนอีก, ECMWF-vs-radar (ต้อง 72 ชม.), persistence member | 1–3 วัน (footprint ขึ้นกับฝน) |
| `met-web.json`, `t2-corr.json`, `rain-obs.json`, `wx-ml.json` | สร้างใหม่ทุกรอบ | ทันที |
| `perf.json`, `perf-series.json` | คำนวณใหม่ | รอบถัดไป |

`met-traj.json` ไม่อยู่ใน cache: ขั้น Build site สร้างใหม่จาก `met.json` ถ้าขาด <!-- src: .github/workflows/update.yml:242-248 -->

### 7.5.2 สิ่งที่ไม่หายเมื่อ cache หาย

- log 35 วันบน branch `history` และคลังฝึก 2 ปีบน `mltrain` (รวม `backfillStore` ที่สร้างวันที่ขาดคืนจาก log) <!-- src: scripts/update.mjs:125-137 -->
- `data/static/*` บน `main` (DEM, climatology, hindcast model, CHELSA, ขอบเขต)
- ไฟล์สกัด SILAM และ ECMWF open data (อยู่ใน `history`)

### 7.5.3 key ของ cache

save ด้วย key ใหม่ทุกรอบ `pipeline-state-<run_id>-<attempt>` และ restore ด้วย prefix `pipeline-state-` (ได้ล่าสุด) cache จึงหายเฉพาะเมื่อ
GitHub ลบตามนโยบาย (ไม่ได้ใช้นาน หรือเกินโควตาของ repo) หรือเมื่อรายการ path เปลี่ยน

---

## 7.6 การแก้ปัญหา (Troubleshooting)

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| log: `Air4Thai station list unavailable (…); using OpenAQ copies of Thai monitors` หรือ `Air4Thai hourly unavailable: …` (มักเป็น error ของ certificate เช่น unable to verify) <!-- src: scripts/update.mjs:401,475 --> | server Air4Thai ไม่ส่ง intermediate certificate; หรือ intermediate ใน `scripts/certs/air4thai-chain.pem` ไม่ตรงกับที่ server ใช้แล้ว; หรือไม่ได้ตั้ง `NODE_EXTRA_CA_CERTS` | ตรวจว่าขั้นนั้นมี `NODE_EXTRA_CA_CERTS: scripts/certs/air4thai-chain.pem`; เพิ่ม intermediate ปัจจุบันของ Let's Encrypt ลงไฟล์ `.pem`; **ห้ามปิดการตรวจ certificate** ระหว่างนั้นระบบใช้สำเนา OpenAQ (ค่าเฉลี่ย 24 ชม.) และลอง Air4Thai ใหม่ทุก 3 ชม. (`a4t.retryH`) <!-- src: scripts/update.mjs:385 --> |
| `only <n> active stations` ของ Air4Thai | Air4Thai ตอบแต่มีสถานี < 20 ที่รายงานใน 7 วัน | รอ ระบบใช้สำเนา OpenAQ ไปก่อน <!-- src: scripts/update.mjs:395 --> |
| run ล้ม: `OPENAQ_API_KEY is not set` | ไม่มี secret | ตั้ง secret `OPENAQ_API_KEY` |
| log: `bulk latest failed` แล้ว `OpenAQ latest (per location): stopped after 6 min` | OpenAQ endpoint รวมล่มหรือจำกัดอัตรา (429) | ระบบถอยไปดึงทีละ location (≤ 1 คำขอ/1.1 วินาที, ≤ 6 นาที) ถ้าได้ < 30 % ของสถานี ค่าที่ขาดไม่ถูกใช้รอบนั้น <!-- src: scripts/update.mjs:249-263 --> |
| log: `station list refresh failed (…); keeping the previous list` | OpenAQ locations ล่ม | ใช้รายชื่อเดิม; ถ้าไม่เคยมีรายชื่อเลย run ล้ม ⇒ รอแล้วรันใหม่ <!-- src: scripts/update.mjs:407-410 --> |
| log: `FIRMS <src> failed` / `FIRMS returned nothing; reusing <n> hotspots from <m> min ago` | NASA FIRMS ล่มหรือตัดการเชื่อมต่อ (ลอง 3 ครั้ง ห่าง 10–20 วินาที) | ใช้ hotspot เดิมที่อายุ < 12 ชม.; เกินนั้นแผนที่ไม่มี hotspot และไม่มี fire assimilation; `hot-*.csv` ไม่ถูกเขียนจากชุดที่ใช้ซ้ำ <!-- src: scripts/update.mjs:314,779-783,797 --> |
| log: `FIRMS_MAP_KEY missing, skipping hotspots` | ไม่มี secret | ตั้ง `FIRMS_MAP_KEY` |
| run ล้ม: `CAMS refresh failed …` แล้ว `CAMS forecast too old (ends …)` | Open-Meteo air-quality ล่ม/จำกัดโควตา และ CAMS เดิมไม่ครอบคลุม 24 ชม. ข้างหน้า | ถ้า CAMS เดิมยังใช้ได้ ระบบใช้ต่อ (และย้อนไปใช้รายชื่อสถานีเดิมที่ตรงกัน); ไม่เช่นนั้นรอโควตาคืนแล้วรันใหม่ <!-- src: scripts/update.mjs:432-443 --> |
| log: `met refresh failed: … (keeping previous)` | Open-Meteo forecast ล่ม | ใช้ met เดิม ถ้าไม่มีเลย ขั้นที่ต้องใช้ met (ฝน, t2, assimilation, RK predictor) ถูกข้าม <!-- src: scripts/update.mjs:518 --> |
| log: `time budget: <ขั้น> skipped, <m> min into the run` | รอบช้า (แหล่งข้อมูลตอบช้า) | ไม่ต้องทำอะไร: forecast หลักและ state ยังถูกเขียน ถ้าเกิดทุกรอบ ให้ดู timing annotation (`::notice title=timing`) ว่าขั้นใดช้า <!-- src: scripts/update.mjs:371-372 --> |
| รอบแรกหลัง cache หาย (log: `stations: … keeping …`, `CAMS refreshed`, ไม่มีการแก้ ML) | Actions cache ถูกลบหรือรายการ path เปลี่ยน | ไม่ต้องทำอะไร ระบบสร้างใหม่ (7.5.1) ตรวจว่าไม่มีใครแก้รายการ path ใน `update.yml`; ถ้าแก้ไปแล้ว ให้ restore/save/climatology ใช้รายการเดียวกัน |
| job ล้มที่ขั้น restore: `cannot fetch branch history (3 tries)` | GitHub ล่มชั่วคราว | ตั้งใจให้ล้ม (กันเขียนทับ branch ด้วย tree ว่าง) รันใหม่ <!-- src: .github/workflows/update.yml:65-74 --> |
| warning `history push failed` | push ไป `history` ล้ม 3 ครั้ง | รอบถัดไป restore `data/history` จาก branch ใหม่ ดังนั้น log ที่เขียนในรอบที่ push ไม่สำเร็จจะหาย (ไม่ทำให้ job ล้ม) ถ้าเป็นช่วงสั้นไม่ต้องทำอะไร; วันที่ขาดในคลังฝึก ML ถูกสร้างคืนด้วย `backfillStore` จาก log ที่เหลือ <!-- src: .github/workflows/update.yml:61-77,183; scripts/update.mjs:125-137 --> |
| ชั้น SILAM หายจากหน้า dev; warning `SILAM chain: the SILAM run failed (exit 1); layer off this hour` | ไม่มีไฟล์สกัด SILAM ใน 4 วันล่าสุด (`no SILAM run extracted`) หรือ `silam.py` ล้ม (bucket FMI, ติดตั้ง netCDF4 ไม่ได้) | ดู warning ของขั้น SILAM forecast; ขั้นทั้งสองไม่ทำให้ job ล้ม รอ run ใหม่ของ FMI <!-- src: scripts/update.mjs:427; scripts/silam_chain.mjs:53; scripts/silam.py:26-30 --> |
| warning `SILAM chain: no state or latest.json from the CAMS run: skipped` | รอบ CAMS ล้มก่อนเขียนไฟล์ | แก้ปัญหาของรอบ CAMS ก่อน <!-- src: scripts/silam_chain.mjs:44 --> |
| warning `GSMaP::server key not as expected, observed rain skipped` | host key ของ `hokusai.eorc.jaxa.jp` เปลี่ยน | **ห้าม**รับ key ใหม่จนกว่าจะยืนยันกับ JAXA (อาจเป็น server ปลอม) แล้วจึงแก้ fingerprint ใน workflow <!-- src: .github/workflows/update.yml:86; README.md:43 --> |
| log: `GSMaP: no credentials, observed rain skipped` หรือ GSMaP ไม่มีข้อมูล | ไม่มี secret หรือ JAXA ปิดระบบ (ตั้งแต่ 18 พ.ย. 2026) | หน้าเว็บใช้ PARDIG; ชั่วโมงใหม่สุดที่ PARDIG ยังไม่มี (ช้า 4–5 ชม.) จะไม่มีฝนสังเกตนอก radar |
| warning `PARDIG rain::…` / log `PARDIG failed` | bucket สาธารณะของ PARDIG ช้า/ล่ม (จำกัด 3 นาทีต่อรอบ) | ระบบใช้ GSMaP ที่มี (`obsRain` ถอยไป GSMaP) ถ้าไม่มีทั้งสอง ใช้ ECMWF ในชั่วโมงที่สังเกต <!-- src: scripts/update.mjs:542-543 --> |
| หน้าเว็บกลับไปใช้ GSMaP เอง (annotation `GSMaP on the page`) | `obsRainCheck` ตัดสินว่า PARDIG แย่กว่า GSMaP เทียบ gauge | ตั้งใจ (ระบบกลับเป็น PARDIG เองเมื่อผ่าน) |
| ฝนพยากรณ์บนหน้าเว็บหยาบ (1°) นอกภาคเหนือ | `data/ecmwf-pr.json` ไม่มีหรือ run อายุ > 36 ชม. ⇒ หน้าเว็บใช้ Open-Meteo | ดู warning `ECMWF open-data rain` ของ `ecmwf_pr.py` <!-- src: scripts/ecmwf_pr.py:13-14,22 --> |
| radar แสดงพื้นที่ว่างกว้าง | coverage = mask ของ API **และ** echo footprint; cache radar หาย footprint เริ่มใหม่ | รอให้มีฝน (footprint โตเมื่อเห็น echo ≥ 2 ชั่วโมง) <!-- src: scripts/radar.mjs:14-20 --> |
| log: `RK skipped: only <n> monitors with fresh data` | สถานีที่มีค่าเฉลี่ย 24 ชม. valid < 15 | หน้าเว็บใช้ CAMS ดิบ (ไม่มีการแก้แผนที่) รอค่าวัดกลับมา <!-- src: scripts/update.mjs:1085 --> |
| log: `DEM unavailable, regression without elevation` | AWS Terrain Tiles ล่มตอนสร้าง DEM | regression ไม่มีตัวแปรความสูงรอบนั้น <!-- src: scripts/update.mjs:1065 --> |
| ประตูไม่เปิด (`live correction kept`, `logged only`) | ผู้สมัครแย่กว่าอย่างน้อยหนึ่งข้อ หรือข้อมูลยังไม่พอ | ไม่ใช่ข้อผิดพลาด ห้ามผ่อนเกณฑ์ ดู 7.3 ว่าข้อใดไม่ผ่าน ใช้ `analysis/highpm_replay.py` วิเคราะห์ v2 |
| warning `redesigned page::index_modern.html published as it is` | `index_modern.html` ขาด element id ของ `index.html` | เพิ่ม id ที่ขาดใน markup แล้วรัน `build_modern.mjs` (7.2.6) |
| ขั้น Build site ล้ม: `developer page not encrypted` | `lockpage.mjs` ไม่ได้เข้ารหัส | ตรวจ secrets `DEV_USER`, `DEV_PASS`; ถ้าไม่มี lockpage เผยแพร่หน้าประกาศแทน (ไม่ล้ม) <!-- src: .github/workflows/update.yml:241; scripts/lockpage.mjs:40 --> |
| GitHub Pages: `No artifacts named github-pages were found` | GitHub ยังไม่ list artifact | workflow รอและลองอีกครั้งเอง ล้มสองครั้ง ⇒ job ล้ม รอรอบถัดไป <!-- src: .github/workflows/update.yml:263-276 --> |
| warning `Cloudflare::deploy to Cloudflare Pages failed 3 times; the next run tries again` | Cloudflare API error ชั่วคราว (เช่น code 10500) | ไม่ต้องทำอะไร GitHub Pages ขึ้นแล้ว รอบถัดไปลองใหม่ <!-- src: .github/workflows/update.yml:295-302 --> |
| warning `Cloudflare::run the 'Cloudflare setup' workflow once first` | `wrangler.toml` ยังไม่มี id ของ D1/KV | รัน `cloudflare-setup.yml` ครั้งเดียว |
| ขั้น Cloudflare ไม่รันเลย | ไม่มี `CLOUDFLARE_API_TOKEN` หรือ `CLOUDFLARE_ACCOUNT_ID` | ตั้ง secrets (สิทธิ์ Pages Edit, D1 Edit, Workers KV Storage Edit) |
| Cloudflare deploy เขียนโปรเจกต์เป็น Worker | รัน wrangler ใน repo | รันในโฟลเดอร์นอก repo เท่านั้น (7.4.2) |
| แชตไม่ได้คำถามใหม่: `chat learn: CHAT_EXPORT_TOKEN secret not set; nothing added` | ไม่มี secret | ตั้ง `CHAT_EXPORT_TOKEN` (และ Pages secret `EXPORT_TOKEN` ผ่าน setup) |
| ค่าที่สถานีพุ่งสูงผิดปกติแล้วหายไป, หน้าเว็บแสดง "ยังไม่ยืนยัน" | spike check พักค่า > 300 µg/m³ ที่ > 5 เท่าของ 3 ชม. ก่อน (`held`) และ reset Kalman ถ้ารับไปแล้ว | ตั้งใจ ดู log `spike check dropped …` และ `Kalman filters reset after a dropped spike` <!-- src: scripts/update.mjs:458,491,840 --> |

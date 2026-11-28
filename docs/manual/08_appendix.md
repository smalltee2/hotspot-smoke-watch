# บทที่ 8 ภาคผนวก (Appendices)

> อภิธานศัพท์ รายการตัวแปรและหน่วย การอ้างอิงและสัญญาอนุญาตของข้อมูล และประวัติการเปลี่ยนแปลงแบบย่อ
> ค่าทั้งหมดคัดจากโค้ดและเอกสารใน repository (`<!-- src: … -->`)

---

## 8.1 อภิธานศัพท์ไทย–อังกฤษ (Thai–English glossary)

| ภาษาไทย | English | ความหมายในระบบ SEA-HAF |
|---|---|---|
| ฝุ่นละอองขนาดไม่เกิน 2.5 ไมครอน | PM2.5 (fine particulate matter) | ตัวแปรหลักที่พยากรณ์ หน่วย µg/m³ |
| หมอกควัน | haze / smoke haze | ควันจากการเผา (PM2.5); ต่างจาก "หมอก" (fog) ที่แชตประเมินจากความชื้นและลม |
| จุดความร้อน | hotspot / active fire detection | จุดไฟจากดาวเทียม VIIRS (NASA FIRMS) |
| กำลังการแผ่รังสีของไฟ | fire radiative power (FRP) | MW ต่อจุด ใช้คำนวณการปล่อย PM2.5 |
| ควันไฟจำลอง | modelled fire smoke | PM2.5 จาก puff model ของ hotspot |
| การผสานข้อมูลการปล่อยจากไฟ | fire-emission data assimilation | ปรับตัวคูณการปล่อยของกลุ่มไฟจากค่าวัด 48 ชม. (`assim.mjs`) |
| ส่วนเพิ่ม | increment | ผลต่างของพยากรณ์ที่เกิดจาก assimilation (`inc`) |
| ตัวกรองคาลมาน | Kalman filter | ประมาณไบแอสรายสถานีบน log-ratio |
| ไบแอส / ความเอนเอียง | bias | ค่าพยากรณ์ − ค่าวัด (หรือ ln-ratio ใน Kalman) |
| ไบแอสช้า | slow bias | `kfSlow` ความจำหลายสัปดาห์ |
| การจางตามระยะพยากรณ์ | lead-time fade (e-folding) | การแก้ไบแอสลดลงแบบ exponential ตาม lead |
| ระยะพยากรณ์ | lead time | ชั่วโมงระหว่างเวลาออกพยากรณ์และเวลาที่ใช้ได้ |
| เวลาออกพยากรณ์ | issue time (`issued_utc`) | |
| เวลาที่ใช้ได้ | valid time (`valid_utc`) | |
| ความคงที่ / ค่าเดิมต่อเนื่อง | persistence | ใช้ค่าวัดล่าสุดเป็นพยากรณ์ |
| การผสมตามระยะพยากรณ์ | blend by lead | w·persistence + (1−w)·forecast (`blendByLead`) |
| เขตไฟภาคเหนือ | northern fire belt | กล่อง 97–105.5 E, 17.5–22.5 N (`blendBelt`) |
| การประมาณค่าเชิงพื้นที่แบบถดถอย | regression kriging (RK) | แผนที่แก้ไบแอส 0.025° (`rk.mjs`) |
| วาริโอแกรม | variogram | ความแปรปรวนตามระยะของ residual |
| การลดน้ำหนักกลุ่มสถานีหนาแน่น | declustering | ไม่ให้เครือข่ายกรุงเทพฯ ครอบงำ regression |
| การตรวจแบบเว้นหนึ่ง | leave-one-out (LOO) cross-validation | คะแนนของแผนที่ที่สถานีที่ถูกเว้น |
| เครื่องวัดอ้างอิง | reference monitor | สถานีมาตรฐาน (Air4Thai, AirNow ฯลฯ) |
| เซนเซอร์ราคาประหยัด | low-cost sensor | เช่น AirGradient; แปลงสเกลและผ่าน QC ก่อนใช้ |
| ค่าเฉลี่ยเคลื่อนที่ 24 ชั่วโมง | 24-h running mean | ค่าของสำเนา Air4Thai บน OpenAQ และ BMA feed |
| ค่าผิดปกติแบบยอดแหลม | spike | ค่าวัดผิดของเครื่องมือ (`obsqc.mjs`) |
| ยังไม่ยืนยัน | unconfirmed (held) | ค่าล่าสุดที่ spike check พักไว้ แสดงบนหน้าเว็บแต่ไม่ใช้แก้ |
| การเรียนรู้ด้วยตนเอง | self-learning correction | ML v1/v2 ที่เรียนรู้รายวัน |
| ผู้เชี่ยวชาญ (ในชุดโมเดล) | expert | base, day, week, month, season, hindcast |
| น้ำหนักแบบแบ่งคงที่ | fixed-share weighting | การรวม expert (Herbster & Warmuth 1998) |
| ต้นไม้ตัดสินใจแบบบูสต์ | gradient-boosted trees (GBM) | expert month / season / hindcast |
| การถดถอยริดจ์ | ridge regression | expert week |
| ผู้สมัคร | candidate | ML v2 ที่รันคู่แต่ยังไม่เผยแพร่ |
| ประตูตรวจ | gate / check | การตรวจรายวันที่ตัดสินว่าจะเผยแพร่หรือไม่ |
| ชั่วโมงสูง | high hour | ชั่วโมงที่วัดได้ ≥ 37.5 µg/m³ |
| จับได้ | hit / caught | พยากรณ์ ≥ เกณฑ์ และวัดได้ ≥ เกณฑ์ |
| เตือนผิด | false alarm | พยากรณ์ ≥ เกณฑ์ แต่วัดได้ต่ำกว่า |
| สัดส่วนเตือนผิด | false-alarm share (ratio) | false alarm ÷ จำนวนพยากรณ์ ≥ เกณฑ์ |
| ค่าเฉลี่ยรากที่สองของความคลาดเคลื่อนกำลังสอง | RMSE | |
| RMSE แบบปรับมาตรฐาน | NRMSE | 100 · RMSE ÷ ค่าวัดเฉลี่ย (%) |
| ความแม่นยำ (บนหน้าเว็บ) | accuracy | 100 − NRMSE ของค่าเฉลี่ยรายวัน 30 วัน |
| ระดับความเข้มข้น (สี) | concentration band (PCD colour band) | ขอบ 15 / 25 / 37.5 / 75 µg/m³ |
| ภูมิอากาศของสถานี | station climatology | ค่าเฉลี่ยและ P90 รายเดือน × ชั่วโมงจาก 3 ปี |
| การดึงเข้าหาภูมิอากาศ | climatology blend | `CFG.climBlend` (ยังเป็นศูนย์) |
| การพยากรณ์ย้อนหลัง | hindcast | CAMS ที่เก็บไว้ของฤดูไฟ 2024–2026 |
| การพยากรณ์ระยะสั้นมาก | nowcast | 1–6 ชม. สำหรับ PM2.5, 1–3 ชม. สำหรับเรดาร์ |
| ฝนสังเกต | observed rain | radar, PARDIG, GSMaP |
| มาตรวัดฝน | rain gauge | ThaiWater (HAII) |
| เรดาร์ตรวจอากาศ | weather radar | ผ่าน RainViewer (กรมอุตุนิยมวิทยา) |
| ร่องรอยสะท้อน | echo footprint | พื้นที่ที่ radar เคยเห็นฝน ≥ 2 ชั่วโมง |
| ตัวคูณรูปแบบฝน | rain-pattern factor (CHELSA) | ลดขนาดฝนเป็น 0.025° |
| อัตราการลดลงของอุณหภูมิตามความสูง | lapse rate | 6.5 °C/กม. |
| การลดขนาด | downscaling | ทำให้ละเอียดขึ้น (0.025°) |
| ความสูงชั้นผสม | boundary-layer height (BLH) | m |
| ดัชนีการระบายอากาศ | ventilation index | BLH × ลม 100 ม. (m²/s) |
| วิถีย้อนกลับ | backward trajectory | "อากาศมาจากไหน" 27 สมาชิก |
| เสถียรภาพบรรยากาศ | atmospheric stability (Pasquill–Gifford class) | `cls` A–F |
| ข้อมูลระดับความกดอากาศ | pressure-level data | 925/850/700 hPa |
| แคชของ Actions | Actions cache | ที่เก็บ state ระหว่างรอบ |
| สาขา (git) | branch | `main`, `history`, `mltrain`, `hindcast` |
| ข้อความลับ | secret | key/token ใน GitHub Secrets (ห้ามเขียนลงไฟล์) |
| หน้าสาธารณะ / หน้านักพัฒนา | public page / developer page | `/` / `/dev.html` |
| ภาค (ของประเทศไทย) | region | ภาคเหนือ อีสาน กลาง ตะวันออก ใต้ |
| จังหวัด / อำเภอ / ตำบล | province (ADM1) / district (amphoe, ADM2) / sub-district (tambon, ADM3) | ขอบเขตจาก OCHA COD-AB |

---

## 8.2 รายการตัวแปรและหน่วย (variables and units)

### 8.2.1 PM2.5 และคุณภาพอากาศ

| ชื่อ (โค้ด/log) | หน่วย | ความหมาย |
|---|---|---|
| `obs_pm25`, `pm25`, `obs` | µg/m³ | ค่าวัด PM2.5 |
| `cams_raw`, `raw` | µg/m³ | CAMS (หรือ SILAM) ดิบ |
| `cams24`, `corr24`, `blend24`, `blend24A`, `blend24ML` | µg/m³ | ค่าเฉลี่ย 24 ชม. |
| `corrected`, `correctedA`, `correctedML`, `correctedML1`, `correctedML2`, `correctedPre`, `correctedNC` | µg/m³ | ขั้นต่าง ๆ ของ chain (6.5.8) |
| `inc` | µg/m³ | assimilation increment |
| `fire` | µg/m³ | ควันไฟจำลอง |
| `b` (Kalman), `bias`, `kfAb` | ln (ไม่มีหน่วย) | b = ln(obs+1) − ln(raw+1) |
| `Q`, `R`, `P`, `P0` | (ln)² | ความแปรปรวนของ Kalman |
| `map_loo`, `obs24` (map log) | µg/m³ | LOO ของแผนที่, ค่าวัด 24 ชม. |
| `clim_mean`, `clim_p90` | µg/m³ | climatology ของสถานี (`pm-clim.json` เก็บ × 10) |
| `aqius` | ดัชนี US AQI | IQAir |
| `frp`, `frp_mw` | MW | FRP ของ hotspot |
| `conf` | `l`/`n`/`h` | ความเชื่อมั่นของ FIRMS |
| `sat` | `SNPP`/`NOAA20`/`NOAA21` | ดาวเทียม |
| `igbp` | รหัส 1–17 | ชนิดสิ่งปกคลุมดิน MODIS IGBP (17 = น้ำ, 254 = ไม่มีข้อมูล) |

### 8.2.2 อุตุนิยมวิทยา

| ชื่อ | หน่วย | ความหมาย |
|---|---|---|
| `u`, `v` | m/s | ลมที่ 100 ม. (ใน met.json) |
| `u10`, `v10`, `ws10` | m/s | ลมที่ 10 ม. |
| `ws` | m/s | ความเร็วลม 100 ม. |
| `wd`, `wd_deg`, `o_wd` | องศา (ทิศที่ลมพัดมา) | ทิศลม |
| `u925`…`v700` | m/s | ลมระดับความกด |
| `z925`, `z850`, `z700` | m | ความสูงของระดับความกดเหนือพื้นดิน |
| `blh` | m | ความสูงชั้นผสม |
| `cls` | class × 2 (1 = A … 6 = F) | Pasquill–Gifford |
| `n2` | s⁻² | Brunt–Väisälä frequency² ระหว่าง 850–700 hPa (ค่าตั้งต้น 1e-4) |
| `t2`, `t2_ecmwf`, `t2_terrain`, `t2_down`, `t2_ml`, `temp_c`, `o_t2` | °C | อุณหภูมิ 2 ม. |
| `rh`, `rh_pct`, `o_rh` | % | ความชื้นสัมพัทธ์ |
| `cc` | % | เมฆปกคลุมรวม |
| `elev`, `elev_m` | m | ความสูงภูมิประเทศ |
| `hloc` | ชั่วโมง (0–23) | ชั่วโมงเวลาไทยของ valid time |
| `doy` | วัน (1–366) | วันของปี |
| ventilation index | m²/s | BLH × ลม 100 ม.: < 2,000 แย่, 2,000–6,000 ปานกลาง, > 6,000 ดี <!-- src: README.md:50 --> |

### 8.2.3 ฝน

| ชื่อ | หน่วย | ความหมาย |
|---|---|---|
| `pr`, `pr_ecmwf`, `pr_fine`, `pr_ml`, `ecmwf_mmh`, `*_mmh` | mm/h | อัตราฝน (ค่าเฉลี่ยของชั่วโมง) |
| `gauge_mm` | mm (ในชั่วโมง) | มาตรวัด ThaiWater `rain_1h` |
| `gsmap_*`, `pardig_*`, `radar_mmh` | mm/h | ฝนสังเกต |
| dBZ | dBZ | reflectivity ของ radar; Z = 200 R^1.6, ต่ำกว่า 10 dBZ ไม่ใช่ฝน, สูงสุด 100 mm/h <!-- src: scripts/radar.mjs:31,54 --> |
| `chelsa_factor` | – | ตัวคูณรูปแบบฝน (0.2–5) |
| `shiftH` | ชม. | ECMWF ช้ากว่า radar กี่ชั่วโมง (−6…+6) |
| ln(R + 0.2) | ln | สเกลของ rain blend และ weather ML (`rainEps = 0.2`) |
| ชั่วโมงฝน | ≥ 0.5 mm/h | เกณฑ์ของ hit / false alarm |

### 8.2.4 เวลาและการเข้ารหัส

| สิ่ง | รูปแบบ |
|---|---|
| เวลาในไฟล์ JSON | ms ตั้งแต่ 1970 UTC |
| เวลาใน CSV | ISO 8601 UTC (`YYYY-MM-DDTHH:00Z`; `obs-*` มีวินาทีและ ms) |
| วันที่ในชื่อไฟล์รายวัน | วันที่ไทย (`a4t-`, `rainobs-`, `rainfc-`, `pmday-`) หรือวัน UTC (`hot-`), ชั่วโมง UTC (`fcst-`, `obs-`, `map-`, `wxf-`, `climfc-`, `iqair-`) |
| `int-dx` | จำนวนเต็ม (× scale) เก็บเป็นผลต่างตามแกน x |
| `int-dt` | จำนวนเต็มเก็บเป็นผลต่างจากชั่วโมงก่อนที่จุดเดียวกัน |
| `deflate-int16` | Int16 บีบอัด zlib แล้ว base64 (−1 = ไม่มีข้อมูล) |

---

## 8.3 การอ้างอิงและสัญญาอนุญาตของข้อมูล (data attributions and licences)

ต้องคงข้อความอ้างอิงเหล่านี้ไว้เมื่อเผยแพร่หรือคัดลอกข้อมูล

| แหล่ง | ข้อมูลที่ใช้ | สัญญาอนุญาต / ข้อความอ้างอิง |
|---|---|---|
| **Copernicus Atmosphere Monitoring Service (CAMS)** | พยากรณ์ PM2.5 global ผ่าน Open-Meteo air-quality API (live) และ ADS `cams-global-atmospheric-composition-forecasts` (`pm2p5`, 0.4°) ใน hindcast | ข้อความใน repo (คัดตามต้นฉบับ): *"Contains modified Copernicus Atmosphere Monitoring Service information 2023–2026 (CAMS global atmospheric composition forecasts, https://doi.org/10.24381/04a0b097). The values were interpolated from the CAMS grid to the stations. Neither the European Commission nor ECMWF is responsible for any use that may be made of the Copernicus information or data it contains."* <!-- src: history branch hindcast:data/hindcast/README.md "Attribution and licences" --> และ `hc-model.json` source: "CAMS global forecasts (Copernicus ADS) and Air4Thai via OpenAQ" <!-- src: scripts/hindcast_train.mjs:66 --> |
| **FMI SILAM** | SILAM global air-quality forecast, PM2.5, 0.2°, AWS S3 `fmi-opendata-silam-surface-netcdf` | CC BY 4.0, Finnish Meteorological Institute; source ในไฟล์: "FMI SILAM global air-quality forecast (CC BY 4.0), PM2.5, 0.2°" <!-- src: scripts/silam.py:2; history:silam-20261127.json --> |
| **ECMWF** | IFS HRES ผ่าน Open-Meteo (`ecmwf_ifs`, `ecmwf_ifs025`) และ ECMWF Open Data (total precipitation 0.25°) | Open data: CC BY 4.0; source: "ECMWF IFS HRES open data (CC BY 4.0), total precipitation at 0.25°" <!-- src: scripts/ecmwf_pr.py:2,130 --> |
| Open-Meteo | API ที่ส่ง CAMS และ ECMWF | อ้างใน README ("Copernicus CAMS via Open-Meteo air-quality API · Open-Meteo forecast API") <!-- src: README.md:77 --> |
| **NASA FIRMS** | VIIRS NRT (S-NPP, NOAA-20, NOAA-21) active fires | อ้าง "NASA FIRMS (VIIRS NRT)"; ต้องใช้ MAP_KEY <!-- src: README.md:77 --> |
| **OpenAQ** | ค่าวัด v3 (live) และ archive บน S3 (climatology, hindcast) | ข้อความใน repo: *"retrieved through OpenAQ (https://openaq.org). The data come from the original providers … Licences are set by each provider; check the provider's terms on OpenAQ before redistributing the observations. Credit OpenAQ and the original provider when using them."* <!-- src: hindcast:data/hindcast/README.md --> |
| **IQAir** | US AQI ปัจจุบันของเมือง (AirVisual API แผน Community) | "Data: IQAir (iqair.com)" แสดงพร้อมเครดิต; เป็นการเทียบกับ IQAir ไม่ใช่ความแม่นยำเทียบค่าวัด <!-- src: scripts/iqair.mjs:8; README.md:12 --> |
| **PCD Air4Thai** | ค่าวัดรายชั่วโมงและอากาศที่สถานี จากกรมควบคุมมลพิษ (Pollution Control Department) | อ้าง "Air4Thai (PCD)" / "กรมควบคุมมลพิษ" บนหน้าเว็บ |
| **ThaiWater (HAII)** | มาตรวัดฝน `rain_24h` (ค่าล่าสุด `rain_1h`) ของสถาบันสารสนเทศทรัพยากรน้ำ | อ้าง "ThaiWater (HAII) rain gauges" <!-- src: README.md:77; scripts/thaiwater.mjs:2 --> |
| **JAXA GSMaP** | Gauge_NRT v6 / Gauge_NOW 0.1° ผ่าน sftp (ต้องมีบัญชี) | อ้าง "JAXA GSMaP"; ใช้ไม่ได้ตั้งแต่ 18 พ.ย. 2026 <!-- src: scripts/gsmap.mjs:1-3; README.md:43 --> |
| **Google DeepMind PARDIG** | ฝนดาวเทียม global 0.1° ทุก 15 นาที bucket สาธารณะ `gs://pardig_1` | CC BY 4.0; "Google DeepMind PARDIG near-real-time (CC BY 4.0), hourly mean of the 15-min rain rate" <!-- src: scripts/pardig.mjs:1,17 --> |
| **OCHA COD-AB Thailand** | ขอบเขตอำเภอและตำบล `tha_admbnda_adm3_rtsd_20220121` (Royal Thai Survey Department, 2022) ผ่าน prasertcbs/thailand_gis | CC BY-IGO; ข้อความ: *"Administrative boundaries: Royal Thai Survey Department (2022) via OCHA HDX COD-AB Thailand, CC BY-IGO; simplified (prasertcbs/thailand_gis, mapshaper)"* <!-- src: scripts/admin_bounds.mjs:3,18 --> |
| **Amazon MASSIVE 1.1** | ข้อมูลฝึกแชต (th-TH, en-US) | *"MASSIVE: J. FitzGerald et al. (2022), "MASSIVE: A 1M-Example Multilingual Natural Language Understanding Dataset with 51 Typologically-Diverse Languages", arXiv:2204.08582. Copyright Amazon.com Inc. or its affiliates. Licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/). Changes: the wake word "olly" removed, intents mapped as above, a sample of the rows."* <!-- src: chat/data/README.md:13-16 --> |

แหล่งอื่นที่ระบบใช้และควรอ้าง: CHELSA V2.1 (Karger et al. 2017, doi:10.1038/sdata.2017.122; data doi:10.16904/envidat.228) <!-- src: .github/workflows/prclim.yml:2-3 -->,
RainViewer (radar ของกรมอุตุนิยมวิทยา) <!-- src: scripts/radar.mjs:2-3 -->, AWS Terrain Tiles (Terrarium) <!-- src: scripts/dem.mjs:1-2 -->,
NASA GIBS / MODIS MCD12Q1 IGBP <!-- src: scripts/landcover.mjs:1-3 -->, World Bank Official Boundaries (จังหวัดของประเทศเพื่อนบ้าน), Natural Earth และ basemap CARTO / OpenTopoMap / Esri <!-- src: README.md:77 -->

---

## 8.4 ประวัติการเปลี่ยนแปลงแบบย่อ (condensed change history)

ที่มา: `git log --oneline origin/main` (269 commits ใน clone นี้, PR ถึง #164) clone เป็นแบบ shallow จึงเห็นย้อนถึง 7 ต.ค. 2026 เท่านั้น
ประวัติที่เก่ากว่าดูได้ด้วย `git fetch --unshallow` ไม่รวม commit อัตโนมัติ (`static:`, `chat: weekly training`, merge commit)

### 8.4.1 Pipeline PM2.5 และการแก้ไบแอส

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 15–16 ต.ค. 2026 | atomic JSON write และไม่เขียน log ซ้ำเมื่อสองรอบในชั่วโมงเดียวกัน; time budget ของรอบรายชั่วโมง |
| 30 ต.ค.–4 พ.ย. 2026 | ลอง restore branch ซ้ำ; สร้างวันที่ขาดของคลังฝึก ML คืนจาก log (`backfillStore`) |
| 16 พ.ย. 2026 | code review แก้ทั่ว pipeline; วิเคราะห์ชั่วโมง PM2.5 สูง (`analysis/highpm_replay.py`); **PM2.5 correction v2** (ผู้สมัคร) และประตูรายวัน |
| 17 พ.ย. 2026 | เก็บ hotspot รายวัน (`hot-*.csv`) และรายงานควันไฟจำลองที่สถานี |
| 20–21 พ.ย. 2026 | **SILAM** เป็นโมเดลที่สอง ผ่าน chain เดียวกัน (`silam_chain.mjs`), ไม่มี fire assimilation สำหรับ SILAM |
| 21 พ.ย. 2026 | **Station climatology** 3 ปี (`pm-clim.json`) เป็น input ของ v2 สร้างครั้งเดียว; เตรียม climatology blend (log + fit, น้ำหนักศูนย์) (#40) |
| 22 พ.ย. 2026 | **Hindcast expert** ใน correction v1 จาก 3 ฤดูไฟ (#48) |
| 23 พ.ย. 2026 | แผนที่แก้ไม่มีรอยต่อ: tapered residual kriging (#65); SILAM ใช้ met และรายชื่อสถานีของรอบ CAMS (#77) |
| 24 พ.ย. 2026 | ดาวน์โหลดที่ขาดกลางทางถูกลองใหม่ (#100) |
| 26 พ.ย. 2026 | **Spike check** ของ Air4Thai (#114) และในการให้คะแนน (#117) |
| 27 พ.ย. 2026 | spike check สำหรับสถานีที่ให้ค่าล่าสุดและ reset Kalman หลัง spike (#151); แสดงค่าที่พักไว้เป็น "ยังไม่ยืนยัน" (#152); `stations.json` (#150) |
| 28 พ.ย. 2026 | **Nowcast 1–6 ชม.** เผยแพร่เมื่อประตู 14 วันผ่าน (#157) และสร้าง nowcast ใน log เก่าเพื่อให้ตัดสินได้เร็ว (#158) |

### 8.4.2 ฝนและอุตุนิยมวิทยา

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 10 ต.ค. 2026 | รอยต่อกริดอุตุนิยมวิทยา 0.25° กับ 1° ไม่มีขั้น |
| 15 ต.ค. 2026 | ดัชนีการระบายอากาศ (และที่ 0.025° ตามภูมิประเทศ); **radar เป็นค่าสังเกตหนาแน่นของฝน** (`radar.mjs`); rain 3–48 ชม. แบบ PM2.5 (timing/amount เทียบ radar, persistence) บันทึกที่น้ำหนักศูนย์ |
| 8 พ.ย. 2026 | **Rain blend fit ครั้งแรก** (เก็บ 1–2 ชม.) และเกณฑ์ยอมรับที่เข้มขึ้น; weather ML เผยแพร่การแก้ฝนเฉพาะเมื่อไม่เสียชั่วโมงฝน (`rainDetectCheck`) |
| 16 พ.ย. 2026 | **PARDIG** เป็นฝนสังเกตของหน้าเว็บ, GSMaP สำหรับชั่วโมงใหม่สุด, ตรวจกับ gauge ทุกวัน (`obsRainCheck`) |
| 25 พ.ย. 2026 | coverage ของ radar จำกัดที่ echo footprint (#103); ตัวกรองสัญญาณรบกวน (#107); **ECMWF open data 0.25°** ทั่วแผนที่ (#106) |
| 26 พ.ย. 2026 | ไม่ส่ง run ECMWF open data ที่อายุ > 36 ชม. ให้หน้าเว็บ (#110) |

### 8.4.3 ความแม่นยำและการตรวจผล

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 7 ต.ค. 2026 | หน้า performance (`perf.html`) ทุกตัวแปร |
| 18–20 พ.ย. 2026 | แสดงความแม่นยำบนหน้าสาธารณะ (ต่อสถานี ภาค ประเทศ); เพิ่ม 48 ชม. |
| 22 พ.ย. 2026 | การ์ดความแม่นยำ: ระดับความเข้มข้นถูกของค่าเฉลี่ย 24 ชม. (#49–#55); ชั้นเทียบ IQAir (#58–#59) |
| 23 พ.ย. 2026 | IQAir ประเทศเพื่อนบ้านและให้คะแนนตรง (#63–#64); ความแม่นยำเทียบเซนเซอร์ราคาประหยัดแยก (#66–#68) |
| 26 พ.ย. 2026 | badge ใช้ค่าเฉลี่ยวันปฏิทิน 30 วัน (#118–#123); **ความแม่นยำเดียวทุกที่ = 100 − NRMSE** (#124); เหลือรายวันอย่างเดียว (#132–#133) |

### 8.4.4 หน้าเว็บ แผนที่ และผลิตภัณฑ์

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 7 ต.ค. 2026 | หน้า developer/performance เข้ารหัส (`lockpage.mjs`); pop-up ทุกตัวแปรที่ตำแหน่งผู้ใช้; เปิดเป็นภาษาไทย; ภาพดาวเทียม NASA GIBS รายวัน; อนุภาคลมตามระดับ Beaufort |
| 10–14 ต.ค. 2026 | **Redesign** (`index_modern.html`) แล้วเป็นหน้าเริ่มต้น; back-trajectory แบบ ensemble; รีเฟรชอัตโนมัติ |
| 15–16 ต.ค. 2026 | สรุปพยากรณ์ภาษาง่าย; ทบทวนการออกแบบหน้าสาธารณะ 4 ขั้น |
| 16 พ.ย. 2026 | glass menu frames และ WebGL2 water |
| 20–21 พ.ย. 2026 | ฟิลด์แผนที่วาดเรียบ; โลโก้ SEA-HAF; time bar ถึงปลายข้อมูล |
| 22 พ.ย. 2026 | สีแบบต่อเนื่อง (PCD, EPA); รายการเทคนิคบางอย่างเหลือเฉพาะหน้า admin (#51, #61) |
| 23 พ.ย. 2026 | **บันทึกภาพ** แผนที่ทุกหน้า (#71–#76) |
| 25–26 พ.ย. 2026 | บันทึกภาพรวมทุกชั้น, ตาราง trajectory; **อำเภอและตำบล COD-AB 2022** (#130–#131); พื้นที่แสดง: ประเทศไทย/ทั้งแผนที่ → จังหวัด (#134); ค่าเฉลี่ยตามวันที่เลือกในปฏิทิน (#135); เมืองที่มีคำเตือนพร้อมกระดิ่ง (#128–#129, #141); การ์ดพยากรณ์รายวัน (#138–#139) |
| 27 พ.ย. 2026 | ขอบเขตจังหวัดไทยตรงกับอำเภอ (#148); แท็บ "จุดของฉัน" (#145–#149); จัดหน้าใหม่ (#142–#144) |
| 28 พ.ย. 2026 | กฎนับคำเตือนพร้อมปุ่ม (i) และนับสถานีด้วย (#153–#154); spotlight ที่จุดที่แตะ (#155); แท็บ hotspot "ใกล้เมือง/รายจังหวัด" (#156); **เครื่องหมายเตือนบนแผนที่** ตามระดับอันตราย (#159–#161); legend รวมในภาพที่บันทึก (#162–#164) |

### 8.4.5 แชต "ถาม SEA-HAF"

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 23 พ.ย. 2026 | ปุ่มแชตตอบจากข้อมูลบนหน้า (#78); ภาษาพูด, ช่วงเวลาของวันและหมอก (#80–#82); **ตัวจำแนกหัวข้อ (ML)** และเรียนรู้จากผู้ใช้ (#83); feedback ผ่าน Cloudflare (#84, #86); ข้อมูลฝึกพื้นฐาน, MLP candidate, คำถามที่ไม่แน่ใจ (#88); ตอบรายภาค (#90); LLM ในเครื่อง admin เสนอหัวข้อ (#91) และเขียนคำถามฝึก (#94); งานรายวันบน Mac (#95–#98) |
| 24 พ.ย. 2026 | กล่องแชตตามปุ่มภาษา (#99) |

### 8.4.6 โครงสร้างพื้นฐานและการ deploy

| วันที่ | การเปลี่ยนแปลง |
|---|---|
| 15 ต.ค. 2026 | เพิ่ม `CLAUDE.md` กฎของโปรเจกต์ |
| 15 พ.ย. 2026 | ลอง deploy Pages ซ้ำเมื่อ GitHub ยังไม่เห็น artifact |
| 23 พ.ย. 2026 | **Cloudflare Pages** พร้อม D1 และ KV (#85); เว็บหลักคือ Cloudflare (#87); ลอง deploy Cloudflare 3 ครั้ง (#92) |
| 25 พ.ย. 2026 | actions บน Node 24 (cache v6, configure-pages v6, upload-pages-artifact v5, deploy-pages v5, setup-python v6) (#101); Pages รอก่อน deploy (#104) |
| 26 พ.ย. 2026 | กฎ commit: ไม่มีชื่อโมเดลหรือ Co-Authored-By ของ Claude (#115) และระบบลงชื่อเป็น SEA-HAF (#116) |

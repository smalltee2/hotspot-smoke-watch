# ภาค A บทที่ 2 ข้อมูลนำเข้าและการควบคุมคุณภาพ

> บทนี้อธิบายแหล่งข้อมูลทุกแหล่งที่ pipeline และหน้าเว็บใช้ พร้อมการควบคุมคุณภาพ (quality control, QC) ของค่าตรวจวัด
> ค่าความละเอียด ความถี่ และความหน่วงที่อ่านจากโค้ดได้ มีหมายเหตุ `src` กำกับไว้
> ค่าที่โค้ดไม่ได้กำหนดหรือไม่ได้บันทึก เช่น ความละเอียดดั้งเดิมของ CAMS ที่ Open-Meteo ให้บริการ เขียนว่า "ไม่ระบุในโค้ด"
> ข้อมูลนี้ไม่ใส่ค่า key, token หรือรหัสผ่าน ระบุเฉพาะชื่อ secret ใน GitHub Secrets

---

## 2.1 ขอบเขตพื้นที่และเวลา

| ค่าตั้ง | ค่า | ความหมาย |
|---|---|---|
| `CFG.bbox` | [92.0, 5.5, 110.0, 24.5] (W, S, E, N) | พื้นที่ของสถานี hotspot และกริด PM2.5 ที่ปรับแก้ |
| `CFG.gridBbox` | [92.0, 5.5, 110.0, 24.0] | กริด CAMS ที่ครอบทุกภูมิภาคในเมนูของหน้าเว็บ |
| `CFG.gridStep` | 0.5° | ระยะกริด CAMS (เพื่อให้อยู่ใน free tier ของ Open-Meteo) |
| กริด SILAM | [92.0, 5.4, 110.0, 24.2], 0.2° | กริดดั้งเดิมของ SILAM |
| `CFG.rk.residStep` | 0.025° | กริดของแผนที่ปรับแก้ (ประมาณ 2.8 กม.) |
| เวลาภายใน | UTC (ms) | วันที่ของคลังข้อมูลและรอบรายวันใช้เวลาไทย (UTC+7) |

<!-- src: scripts/update.mjs:40-42, 63, 114, 269-270 -->

## 2.2 ตารางสรุปแหล่งข้อมูล

**ตารางที่ A2.1** แหล่งข้อมูลนำเข้าของ SEA-HAF

| แหล่ง | ตัวแปรที่ใช้ | ความละเอียดที่ใช้ | ความถี่ในการดึง | ความหน่วง | สคริปต์ที่อ่าน | สัญญาอนุญาต / การอ้างอิง |
|---|---|---|---|---|---|---|
| CAMS global (ผ่าน Open-Meteo air-quality API) | `pm2_5` รายชั่วโมง | สุ่มที่สถานี + กริด 0.5°; ความละเอียดดั้งเดิมไม่ระบุในโค้ด | ทุก 12 ชม. (`camsRefreshH`) หรือเมื่อรายชื่อสถานีเปลี่ยน; ย้อนหลัง 2 วัน ถึง 4 วันข้างหน้า | "ออกวันละสองครั้ง" (ความเห็นในโค้ด); ความหน่วงไม่ระบุในโค้ด | `update.mjs` (`camsSeries`) | Copernicus Atmosphere Monitoring Service (Inness et al., 2019) |
| CAMS hindcast (ฤดูเผาไหม้ 2023/24–2025/26) | PM2.5 ทุก 3 ชม. คู่กับ Air4Thai | ทุก 3 ชม., leads 0–72 ชม. | ฝึกครั้งเดียว | – | `hindcast_train.mjs` | Copernicus ADS; มี "modified Copernicus Atmosphere Monitoring Service information" |
| SILAM v6.1 global (FMI) | PM2.5 รายชั่วโมง | 0.2° | ตรวจทุกรอบ, รอบใหม่วันละครั้ง | เผยแพร่ราว 05:00 UTC | `silam.py`, `silam.mjs` | CC BY 4.0 (Sofiev et al., 2015) |
| ECMWF IFS (ผ่าน Open-Meteo, `ecmwf_ifs`) | ลม 10/100 ม., BLH, รังสีคลื่นสั้น, เมฆ, ฝน, T2, RH | กริด north 0.25° [96.5, 14.5, 102.5, 21.5]; domain 1.0° [92, 5, 110, 25] | ทุก 12 ชม.; ย้อนหลัง 3 วัน ถึง 4 วันข้างหน้า; เก็บจาก −60 ชม. | ไม่ระบุในโค้ด | `met.mjs` (`fetchMet`) | ECMWF (เงื่อนไขของ Open-Meteo ไม่ระบุในโค้ด) |
| ECMWF IFS 0.25° ระดับความกดอากาศ (`ecmwf_ifs025`) | T, Z ที่ 850/700 hPa; ลมที่ 925/850/700 hPa | ตาม node ของกริดข้างบน | พร้อม `fetchMet` | ไม่ระบุในโค้ด | `met.mjs` | ECMWF |
| ECMWF open data (IFS oper 0.25°) | ฝนสะสม `tp` → อัตราเฉลี่ยต่อช่วง | 0.25°, box 92–110°E × 5–25°N, steps 0–144 ชม. ทุก 3 ชม. และ 150–168 ชม. ทุก 6 ชม. | ตรวจทุกรอบ, รอบ 00/12 UTC | ไม่ส่งให้หน้าเว็บถ้ารอบเก่ากว่า 36 ชม. | `ecmwf_pr.py` | CC BY 4.0 |
| NASA FIRMS | VIIRS SNPP / NOAA-20 / NOAA-21 NRT: lat, lon, FRP, เวลา, confidence | จุด hotspot (VIIRS 375 ม.; Schroeder et al., 2014) | ทุกรอบ, ย้อนหลัง 2 วัน (`firmsDays`) | ข้อมูลรอบดึกมาถึงประมาณ 3 ชม. หลังดาวเทียมผ่าน | `update.mjs` (`firmsHotspots`) | NASA FIRMS; key ใน `FIRMS_MAP_KEY` |
| Air4Thai (กรมควบคุมมลพิษ) | PM2.5 รายชั่วโมง + WS, WD, TEMP, RH | สถานีภาคพื้นดิน (GROUND) และเครือข่าย กทม. (BKK) | ทุกรอบ ดึง ~2 วันล่าสุด; รายชื่อสถานีทุก 24 ชม. | ค่าเฉลี่ยของชั่วโมงที่จบที่เวลาประทับ ปรากฏราว 20 นาทีหลังจบชั่วโมง | `update.mjs` (`a4tStations`, `a4tHourly`) | ไม่ระบุในโค้ด (PCD Air4Thai) |
| OpenAQ v3 | PM2.5 ล่าสุดของสถานีอ้างอิงและเซนเซอร์ราคาประหยัด | สถานี | ทุกรอบ; รายชื่อทุก 24 ชม. | ไม่รับค่าที่เก่ากว่า 3 ชม. (`obsMaxAgeH`) | `update.mjs` (`oaqStations`, `oaqLatest`) | ไม่ระบุในโค้ด; key ใน `OPENAQ_API_KEY` |
| OpenAQ archive (S3) + Air4Thai history | PM2.5 รายชั่วโมง 3 ปี | สถานี × (เดือน × ชั่วโมง) | ทำครั้งเดียวด้วยมือ | – | `climatology.mjs` | ไม่ระบุในโค้ด |
| IQAir AirVisual (Community plan) | US AQI ระดับเมือง ณ เวลาจริง | 27 เมือง | 9 เมืองต่อรอบ (ครบทุกเมืองราว 3 ชม.) | ใช้ค่าที่อายุไม่เกิน 6 ชม. | `iqair.mjs` | "Data credited to IQAir"; key ใน `IQAIR_API_KEY` |
| ThaiWater (สสน., HAII) | `rain_1h` ของมาตรวัดฝน | จุดมาตรวัด | ทุกรอบ (บริการให้เฉพาะค่าล่าสุด) | ใช้ชั่วโมงเต็มที่อายุไม่เกิน 6 ชม.; เก็บ 48 ชม. | `thaiwater.mjs` | ไม่ระบุในโค้ด |
| เรดาร์ RainViewer (เรดาร์กรมอุตุนิยมวิทยา) | ค่าสี Universal Blue → dBZ → อัตราฝน | tile zoom 6 ขนาด 512 px (≈1.2 กม.) เฉลี่ยลงเซลล์ 0.025°, box [97, 5.5, 106, 21] | ทุกรอบ, เฟรม 10 นาที ของ 2 ชม. ล่าสุด | เกือบเวลาจริง | `radar.mjs` | ไม่ระบุในโค้ด |
| JAXA GSMaP Gauge_NRT v6 / Gauge_NOW | อัตราฝนรายชั่วโมง | 0.1°, crop 92–110°E × 5–25°N | ทุกรอบผ่าน sftp | NRT ช้ากว่าเวลาจริงราว 4–5 ชม.; NOW ราว 1–2 ชม. | `gsmap.mjs` | JAXA; บัญชีใน `GSMAP_USER` / `GSMAP_PASS`; ตรึง host key |
| Google DeepMind PARDIG | อัตราฝนดาวเทียม ทุก 15 นาที | 0.1°, crop 92–110°E × 5–25°N | ทุกรอบ (ไม่เกิน 3 นาทีต่อรอบ) | ช้ากว่าเวลาจริงราว 4–5 ชม. | `pardig.mjs` | CC BY 4.0; bucket สาธารณะ ไม่ต้องใช้ key |
| CHELSA V2.1 (1981–2010) | ฝนรายเดือนภูมิอากาศ | 30 arc-s → ตัวคูณ 0.025° | สร้างครั้งเดียว (`prclim.py`) | – | หน้าเว็บ (`rainFactorAt`), `thaiwater.mjs` | Karger et al. (2017) ตามที่ระบุในโค้ด |
| AWS Terrain Tiles (Terrarium) | ความสูงภูมิประเทศ | zoom 7 เฉลี่ยลงกริด 0.05° (RK) และ 0.025° (อุณหภูมิ) | สร้างครั้งเดียว (เมื่อ key ของกริดเปลี่ยน) | – | `dem.mjs` | ไม่ระบุในโค้ด |
| MODIS MCD12Q1 IGBP (ผ่าน NASA GIBS) | ชนิดสิ่งปกคลุมดิน ณ จุดไฟ | tile zoom 6, 512 px (≈0.0088°, ≈1 กม.) | ปีละครั้ง (ใช้แผนที่ของปีก่อน) | – | `landcover.mjs` | NASA GIBS (เงื่อนไขไม่ระบุในโค้ด) |
| OCHA COD-AB Thailand 2022 (RTSD) | ขอบเขตอำเภอ/ตำบล | ลดรูปด้วย mapshaper, พิกัด 4 ทศนิยม | สร้างครั้งเดียว | – | `admin_bounds.mjs`, `province_bounds.mjs` | CC BY-IGO |

<!-- src: scripts/update.mjs:40-53, 79-80, 315, 333-343, 427; scripts/met.mjs:11-15, 30, 51; scripts/ecmwf_pr.py:19-22; scripts/silam.py:2-8, 19-21; scripts/hindcast_train.mjs:14, 220; scripts/iqair.mjs:2-9; scripts/thaiwater.mjs:10, 26-32; scripts/radar.mjs:2-7, 23-27; scripts/gsmap.mjs:1-7, 14; scripts/pardig.mjs:1-5, 13-18; scripts/prclim.py:1-6, 13-17; scripts/dem.mjs:44; scripts/landcover.mjs:1-3, 13, 89; scripts/admin_bounds.mjs:1-11; scripts/climatology.mjs:4-11, 21 -->

หมายเหตุประกอบตาราง

- **FIRMS** pipeline ดึงเฉพาะ VIIRS (`CFG.firmsSources`) ส่วน MODIS ใช้ได้เฉพาะเมื่อผู้ใช้นำไฟล์ CSV เข้าที่หน้าเว็บ (`rowsToHotspots` รองรับค่า confidence 0–100 ของ MODIS)
  <!-- src: scripts/update.mjs:52, index.html:1140-1156 -->
- **GSMaP** README บันทึกว่าบริการไม่พร้อมใช้ตั้งแต่ 18 พ.ย. 2026 ตามประกาศของ JAXA เมื่อ 24 พ.ย. 2026 ระหว่างนี้ PARDIG และเรดาร์ทำงานแทน ข้อมูลนี้มาจาก README ไม่ใช่จากโค้ด
  <!-- src: README.md (Observed satellite rain) -->
- **ขอบเขตจังหวัดของประเทศอื่น** ยังใช้ World Bank Official Boundaries และพื้นหลังแผนที่ใช้ Natural Earth / CARTO / OpenTopoMap / Esri ตามที่ README ระบุ
  <!-- src: README.md (Thai province borders; Data sources) -->

## 2.3 รายละเอียดของแต่ละแหล่ง

### 2.3.1 CAMS

`camsSeries` ส่ง `latitude`/`longitude` ครั้งละ 100 จุด เว้น 12 วินาทีระหว่างชุดเพื่อให้ไม่เกิน 500 ตำแหน่งต่อนาที แล้วขอ `hourly=pm2_5`, `past_days=2`, `forecast_days=4`
<!-- src: scripts/update.mjs:333-343 -->
จุดที่ขอคือสถานีทั้งหมดรวมกับ node ของกริด 0.5°
รอบใหม่จะดึงเมื่อพยากรณ์เดิมอายุเกิน `camsRefreshH` = 12 ชม. หรือเมื่อรายชื่อสถานีหรือกริดเปลี่ยน
<!-- src: scripts/update.mjs:43, 422-423 -->
ถ้าดึงไม่สำเร็จ ระบบใช้พยากรณ์เดิมกับรายชื่อสถานีเดิม
ถ้าพยากรณ์ที่มีอยู่ไม่ถึง 24 ชม. ข้างหน้า รอบนั้นจะล้ม
<!-- src: scripts/update.mjs:432-443 -->

### 2.3.2 SILAM

`silam.py` อ่านไฟล์ NetCDF-4 `silam_glob_v6_1_<YYYYMMDD>_PM25_d<k>.nc` จาก bucket S3 สาธารณะของ FMI
- k = 0..4 วันละหนึ่งไฟล์ แต่ละไฟล์มี 24 ค่ารายชั่วโมงตามเวลาประทับ 01:00–24:00 UTC
- ตัดเฉพาะ 92–110°E × 5.4–24.2°N
- เขียน `data/history/<YYYY-MM>/silam-<YYYYMMDD>.json` เป็น integer ×10 เก็บผลต่างตามแกน x ค่าหายไปเก็บเป็น −10

<!-- src: scripts/silam.py:2-15, 19-21 -->
`silam.mjs` รวมรอบใหม่สุดหลายรอบ โดยรอบใหม่ชนะในชั่วโมงที่ทับกัน ส่วนรอบเก่าเติมชั่วโมงก่อนรอบใหม่เริ่ม เพราะค่าเฉลี่ย 24 ชม. ของแผนที่ต้องใช้ชั่วโมงเหล่านั้น
จากนั้นสุ่มค่าที่สถานีด้วย bilinear
รอบ SILAM ใน `update.mjs` เรียก `loadSilam` ด้วย `keep: 3, maxAgeD: 4`
<!-- src: scripts/silam.mjs:1-5, 66-72; scripts/update.mjs:427 -->

### 2.3.3 ECMWF IFS ผ่าน Open-Meteo (อุตุนิยมวิทยาของ pipeline)

`fetchMet` ขอ `models=ecmwf_ifs` สำหรับตัวแปรผิวพื้น 10 ตัว และขอ `models=ecmwf_ifs025` สำหรับระดับความกดอากาศ
แล้วเก็บแต่ละกริดเป็น array แบน [เวลา][iy][ix] ของตัวแปรต่อไปนี้

| ตัวแปร | หน่วย | ที่มา |
|---|---|---|
| `u`, `v` | m/s | ลมที่ 100 ม. (ถ้าไม่มีใช้ลมที่ 10 ม.) |
| `blh` | m | ความสูงชั้นบรรยากาศขอบเขต (boundary-layer height); ถ้าไม่มี ใช้ 1500 ม. เมื่อรังสี > 50 W/m² หรือ 300 ม. ในกรณีอื่น |
| `cls` | – | ชั้นเสถียรภาพ Pasquill–Gifford ×2 จาก `pgClass` |
| `pr` | mm/h | ฝน |
| `n2` | s⁻² | ความถี่ Brunt–Väisälä ยกกำลังสองระหว่าง 850–700 hPa |
| `t2` | °C | อุณหภูมิ 2 ม. |
| `u10`, `v10` | m/s | ลม 10 ม. |
| `rh` | % | ความชื้นสัมพัทธ์ 2 ม. |
| `cc` | % | เมฆรวม |
| `up.u/v925/850/700` | m/s | ลมระดับบน (สำหรับ trajectory) |
| `up.z925/850/700` | m | ความสูงของระดับเหนือพื้น |

<!-- src: scripts/met.mjs:4-15, 30-31, 73-98 -->
รอบใหม่ดึงทุก 12 ชม. (`CFG.met.refreshH`) เพราะ ECMWF HRES รันเต็มรอบที่ 00/12 UTC และเพื่อไม่ให้เกินขีดจำกัดรายวันของ Open-Meteo
ระบบเก็บข้อมูลตั้งแต่ 60 ชม. ย้อนหลัง เพื่อใช้กับ trajectory ย้อนหลัง 48 ชม.
<!-- src: scripts/update.mjs:44-45, 514-516 -->
ฝนของ pipeline (ใช้ในแบบจำลองควัน, rain blend fit และ weather ML) คือฝนชุดนี้ ไม่ใช่ ECMWF open data
<!-- src: CLAUDE.md (Working notes), README.md (ECMWF rain at 0.25°) -->

### 2.3.4 ECMWF open data 0.25° (ฝนบนหน้าเว็บ)

`ecmwf_pr.py` อ่านเฉพาะ byte range ของ `tp` จากไฟล์ `.index` บน mirror สาธารณะ (Google Cloud หรือ AWS) แล้วแปลงค่าสะสมเป็นอัตราเฉลี่ย (mm/h) ต่อช่วง (t0, t1]
ผลเขียนเป็น `ecpr-<run>.json` ใน branch `history` และ `data/ecmwf-pr.json`
<!-- src: scripts/ecmwf_pr.py:2-15, 19-22 -->
หน้าเว็บใช้ฝนนี้ก่อน (`metPrAt` → `ecprAt`) แล้วจึงใช้ฝนจาก `met-web.json` เป็นตัวสำรอง
<!-- src: index.html:1955-1967 -->

### 2.3.5 NASA FIRMS

ระบบดึง CSV ของพื้นที่ `CFG.bbox` ย้อนหลัง `firmsDays` = 2 วัน จากแหล่ง `VIIRS_SNPP_NRT`, `VIIRS_NOAA20_NRT` และ `VIIRS_NOAA21_NRT`
แต่ละแหล่งลอง 3 ครั้ง ห่างกัน 10–20 วินาที ตั้ง timeout 20 วินาที
แต่ละแถวเก็บ [lat, lon, FRP (MW), เวลา, confidence (l/n/h), ดาวเทียม]
<!-- src: scripts/update.mjs:52-53, 308-330 -->
ถ้า FIRMS ไม่ตอบ ระบบใช้ชุด hotspot ล่าสุดที่อายุไม่เกิน 12 ชม.
<!-- src: scripts/update.mjs:779-783 -->
แต่ละจุดได้ชนิดสิ่งปกคลุมดิน IGBP จาก MODIS เพื่อเลือกค่าสัมประสิทธิ์การปล่อยแบบ FINN (หัวข้อ 3.1)
<!-- src: scripts/update.mjs:784-796 -->
คลังรายวัน `hot-YYYYMMDD.csv` เขียนครั้งเดียวหลัง 08:00 UTC ของวันถัดไป
<!-- src: scripts/update.mjs:798-805 -->

### 2.3.6 สถานีตรวจวัด PM2.5

**รายชื่อสถานี** สร้างใหม่ทุก 24 ชม. (`stationRefreshH`)
- รวมสถานี OpenAQ ที่รายงานใน 7 วันล่าสุดกับสถานี Air4Thai ชนิด GROUND และ BKK ที่รายงานใน 7 วันล่าสุด
- ตัดสำเนาของ OpenAQ ที่อยู่ห่างสถานี Air4Thai ไม่เกิน `dedupKm` = 1.0 กม.
- เรียงตามลำดับ: สถานีอ้างอิงก่อน แล้วสถานีรายชั่วโมงก่อน แล้วค่าล่าสุดก่อน
- เก็บไม่เกิน `maxStations` = 700 สถานี

<!-- src: scripts/update.mjs:46, 50, 385-411 -->
ถ้า Air4Thai มีสถานีใช้งานน้อยกว่า 20 แห่ง ระบบใช้สำเนาใน OpenAQ แทน และลองใหม่ทุก `retryH` = 3 ชม.
<!-- src: scripts/update.mjs:80, 385, 395 -->

**ชนิดของค่าวัด** แต่ละสถานีมีชนิด (`kindOf`) แบบหนึ่ง

| ชนิด | สถานี | ความหมาย |
|---|---|---|
| `hm` | Air4Thai ตรง (`hourly`) | ค่าเฉลี่ยของชั่วโมงที่จบที่ t |
| `24` | สำเนา Air4Thai บน OpenAQ และเครือข่าย กทม. (BMA) | ค่าเฉลี่ยเคลื่อนที่ 24 ชม. ที่จบที่ t ตรวจแล้วบนข้อมูล ม.ค.–เม.ย. 2026 ว่าวงจรรายวันแบนและค่าเปลี่ยนเฉลี่ยรายชั่วโมง 0.4 µg/m³ |
| `h` | OpenAQ อื่น | ค่ารายชั่วโมง ณ t |

<!-- src: scripts/update.mjs:72-74, 366, 501 -->

**Air4Thai รายชั่วโมง** ขอ `param=PM25,WS,WD,TEMP,RH&type=hr` ครั้งละ `chunk` = 40 สถานี ครอบช่วงอย่างน้อย 48 ชม. สำหรับหน้าต่างของ assimilation
<!-- src: scripts/update.mjs:79-80, 281-305, 456 -->
เซิร์ฟเวอร์ไม่ส่ง intermediate certificate ให้ครบ workflow จึงเพิ่ม chain ของ Let's Encrypt (`scripts/certs/air4thai-chain.pem`) ผ่าน `NODE_EXTRA_CA_CERTS` และไม่ปิดการตรวจ certificate
<!-- src: scripts/update.mjs:75-78, .github/workflows/update.yml:108 -->
ระบบเขียนคลังรายวัน `a4t-YYYYMMDD.csv` (PM2.5) และ `a4tw-YYYYMMDD.csv` (ลม อุณหภูมิ ความชื้น) ครั้งเดียวหลัง 03:00 น. เวลาไทย
<!-- src: scripts/update.mjs:463-470 -->

**OpenAQ** ใช้ endpoint `parameters/2/latest` ดึงทีเดียว (bulk)
ถ้าได้ค่าน้อยกว่า 30% ของสถานี จะดึงทีละสถานี โดยไม่เกิน 60 ครั้งต่อนาที และหยุดเมื่อเกิน `fallbackMin` = 6 นาที
<!-- src: scripts/update.mjs:232-266, 49 -->

**เซนเซอร์ราคาประหยัด** (เช่น AirGradient) เข้ามาเป็นสถานี OpenAQ ที่ `monitor = false` จัดการแยกตามหัวข้อ 2.4.4

**IQAir** ใช้เป็นข้อมูลอ้างอิงเพื่อเปรียบเทียบเท่านั้น ไม่ใช้ในการปรับแก้
- เรียก `/v2/nearest_city` ให้ 27 เมือง (ไทย 17 เมือง, ประเทศเพื่อนบ้าน 10 เมือง)
- รอบละ 9 เมือง เป็นกลุ่มละ 5 ห่างกันหนึ่งนาที
- ใช้ค่าที่อายุไม่เกิน 6 ชม.
- รันเฉพาะในรอบ CAMS

<!-- src: scripts/iqair.mjs:1-24; scripts/update.mjs:477-479 -->

### 2.3.7 ฝนสังเกต

| แหล่ง | การประมวลผลหลัก | src |
|---|---|---|
| ThaiWater | เก็บเฉพาะชั่วโมงเต็ม (นาที = 00) ที่ 0 ≤ mm ≤ 200 และอายุไม่เกิน 6 ชม.; ไม่เกิน 5,000 จุดต่อชั่วโมง; เก็บ 48 ชม. | `thaiwater.mjs:24-37` |
| เรดาร์ | สี Universal Blue → dBZ → Marshall–Palmer; เฉลี่ยลงเซลล์ 0.025°; ค่าเฉลี่ยรายชั่วโมงต้องมี ≥ 4 จาก 6 เฟรม; เก็บเฟรม 3 ชม. และชั่วโมง 72 ชม. | `radar.mjs:23-37` |
| GSMaP | NRT สำหรับชั่วโมงเก่า, NOW สำหรับชั่วโมงใหม่ (ค่าจาก NOW ถูกแทนด้วย NRT เมื่อมี); ค่าเฉลี่ยของชั่วโมงที่**เริ่ม**ที่ HH:00; เก็บ 48 ชม. | `gsmap.mjs:1-7, 14` |
| PARDIG | 5 เฟรม t, t+15, …, t+60 นาที รวมแบบ trapezoid (สมการ A.6) | `pardig.mjs:9-11, 37-41` |

รายละเอียดการใช้ฝนเหล่านี้อยู่ในหัวข้อ 3.4

**ข้อห้าม** PARDIG ใช้ฟิลด์ ECMWF เป็น input ด้วย จึงห้ามใช้ PARDIG เป็นค่าจริงในการ fit หรือการตัดสินการปรับแก้ฝน ECMWF
ค่าจริงในงานเหล่านี้คือเรดาร์ที่ปรับด้วยมาตรวัดและมาตรวัด ThaiWater
<!-- src: scripts/pardig.mjs:7-8 -->

### 2.3.8 ข้อมูลคงที่

| ไฟล์ | ที่มา | การสร้าง | src |
|---|---|---|---|
| `data/static/elev.json` | DEM 0.05° สำหรับ RK (`CFG.rk.demStep`) | อัตโนมัติเมื่อ key ของกริดเปลี่ยน | `update.mjs:1056-1066` |
| `data/static/elev025.json` | DEM 0.025° สำหรับอุณหภูมิ | อัตโนมัติเมื่อ key ของกริดเปลี่ยน | `update.mjs:662-669` |
| `data/landcover.bin` | IGBP ของปีก่อนหน้า; ถอยไปได้ถึง 4 ปีถ้า GIBS ยังไม่มี | สร้างใหม่ถ้าแผนที่เก่ากว่าปี − 1 และอายุไฟล์เกิน 30 วัน | `landcover.mjs:88-98`, `update.mjs:785-791` |
| `data/static/prclim/` | ตัวคูณรูปแบบฝน CHELSA ต่อเดือน: P_clim / P_clim_smooth ตัดไว้ที่ 0.2–5; ทะเล = 1 | `prclim.yml` | `prclim.py:1-6` |
| `data/static/pm-clim.json` | climatology ของสถานี (หัวข้อ 2.5) | `climatology.yml` | `climatology.mjs:12-15` |
| `data/static/hc-model.json` | โมเดล hindcast | `hindcast_train.mjs` | `hindcast_train.mjs:1-8` |
| `data/static/th-adm2.json`, `th-adm3.json` | ขอบเขตอำเภอ 928 แห่ง และตำบล 7,425 แห่ง | `admin_bounds.mjs` | README (Districts) |

DEM แปลงค่าจาก Terrarium ด้วย elevation = R·256 + G + B/256 − 32768 (ทะเลตัดเป็น 0) แล้วเฉลี่ยพิกเซลลงแต่ละ node
<!-- src: scripts/dem.mjs:3, 57-58 -->

---

## 2.4 การควบคุมคุณภาพค่าตรวจวัด

### 2.4.1 ช่วงค่าที่ยอมรับ

| ข้อมูล | เงื่อนไข | src |
|---|---|---|
| Air4Thai PM2.5 | 0 ≤ v < 1500 µg/m³ และ t ≤ now + 1 ชม. | `update.mjs:293` |
| Air4Thai ลม | 0 < WS < 40 m/s และ 0 ≤ WD ≤ 360 (ค่า 0 / 360 / ว่าง ถือว่าไม่มีเซนเซอร์) | `update.mjs:284-296` |
| Air4Thai อุณหภูมิ | 5 < T < 50 °C | `update.mjs:295` |
| Air4Thai ความชื้น | 5 ≤ RH ≤ 100 % | `update.mjs:295` |
| ค่าล่าสุดของทุกสถานี | 0 ≤ v ≤ 1500 และ now − t ≤ `obsMaxAgeH` = 3 ชม. | `update.mjs:482` |
| ThaiWater | 0 ≤ mm ≤ 200 | `thaiwater.mjs:30` |
| climatology | 0 ≤ v < 1500 | `climatology.mjs:30` |

### 2.4.2 การตรวจค่ากระโดด (spike check, `obsqc.mjs`)

ค่า v ณ เวลา t จะถูกตัดออกเมื่อ

$$
v_t > v_{\min} \quad\text{และ}\quad v_t > r \cdot \max\{\, v_{t'} : t - h_b \le t' < t,\; t' \text{ เป็นค่าที่ผ่านการตรวจแล้ว} \,\}
$$
(A.1)

<!-- src: scripts/obsqc.mjs:8, 12-20, 33-36 -->

| พารามิเตอร์ | ชื่อในโค้ด | ค่า | หน่วย |
|---|---|---|---|
| ค่าต่ำสุดที่ถือว่าอาจเป็น spike | `SPIKE.min` | 300 | µg/m³ |
| อัตราส่วนกับค่าสูงสุดก่อนหน้า | `SPIKE.ratio` | 5 | – |
| หน้าต่างย้อนหลัง | `SPIKE.backH` | 3 | ชม. |

<!-- src: scripts/obsqc.mjs:8 -->

ถ้าไม่มีค่าที่ผ่านการตรวจในหน้าต่าง 3 ชม. ก่อนหน้า ค่านั้นจะไม่ถูกตัด
<!-- src: scripts/obsqc.mjs:17 -->
ที่มาของกฎคือเหตุการณ์ 25 พ.ย. 2026 เวลา 03:00–04:00 น. ที่สถานี a4t:19t รายงาน 904 และ 998 µg/m³ ระหว่างค่า 54 กับ 37
ค่าทั้งสองผ่านการตรวจช่วงค่า (< 1500) และดัน bias ของ Kalman ของสถานีนี้ไปถึง 3.4 ในหน่วย log (ประมาณ ×30)
บน log ต.ค.–พ.ย. 2026 (Air4Thai 126,563 ชั่วโมง) กฎนี้ตัดเพียงสองค่านี้ และเก็บการเพิ่มขึ้นจริงจากควัน เช่น 31 → 221 µg/m³ ที่ a4t:50t เมื่อ 20 พ.ย.
<!-- src: scripts/obsqc.mjs:1-7 -->

กฎเดียวกันใช้ในสามจุด

1. **ขั้นรับข้อมูล Air4Thai รายชั่วโมง** ใช้ `dropSpikes` กับอนุกรมที่เรียงตามเวลา
   <!-- src: scripts/update.mjs:298 -->
2. **สถานีที่ให้เฉพาะค่าล่าสุด** (OpenAQ, เครือข่าย กทม.) ใช้ `isSpike` เทียบกับค่า 3 ชม. ล่าสุดของสถานีเองใน `state.obsHist` เริ่มใช้ 27 พ.ย. 2026
   บน log ต.ค.–พ.ย. 2026 ของ OpenAQ 134,452 สถานี-ชั่วโมง กฎตัด 5 ค่าที่เกิน 300 µg/m³ และไม่ตัดค่าอื่น
   <!-- src: scripts/update.mjs:483-485 -->
3. **ตอนอ่าน log กลับมา** เพื่อตรวจรายวัน ใช้ `dropSpikesHourKeys` ใน `accuracy.mjs`, `verify.mjs`, `perf.mjs` และใช้ `dropSpikes` ใน `loadObsHourly` ของ `ml2.mjs` ที่ ML v2 และ nowcast ใช้ เพราะ log เก็บค่าที่วัดได้ทุกค่ารวม spike ด้วย
   <!-- src: scripts/obsqc.mjs:22-31; scripts/ml2.mjs:59-61; scripts/accuracy.mjs:141 -->

**ค่าที่ถูกพักไว้ (held reading)**
ค่าล่าสุดของสถานีที่ถูกตัดยังคงเผยแพร่เป็น `stations[].held = {t, v}` ใน `latest.json` เมื่อเป็นไปตามเงื่อนไขทั้งหมดนี้
- เป็นค่าใหม่กว่าค่าที่เก็บไว้
- อายุไม่เกิน `obsMaxAgeH`

หน้าเว็บแสดงค่านี้ทันทีบนแผนที่และในรายการสถานี พร้อมป้าย "ยังไม่ยืนยัน" (unconfirmed)
แต่ไม่มีขั้นการปรับแก้ใดใช้ค่านี้ เพราะสถานีนั้นไม่ได้รับ `s.obs` ในรอบนั้น
<!-- src: scripts/update.mjs:448, 460-461, 485-486, 920; README.md (Total PM2.5 forecast) -->

**การเริ่มตัวกรองใหม่หลัง spike (`resetAfterSpikes`)**
บางครั้ง spike ถูกตรวจพบหลังจากที่ตัวกรอง Kalman รับชั่วโมงนั้นไปแล้ว
เมื่อพบ spike เช่นนี้ครั้งแรก ถ้าตัวกรองใดของสถานี (`kf`, `kfA`, `kfSlow`) ถูกปรับที่เวลา ≥ เวลาของ spike ระบบจะลบสถานะของสถานีนั้นในทุกตัวกรอง ทำครั้งเดียวต่อ spike
`state.spikeSeen` จำ spike ที่จัดการแล้วไว้ 96 ชม. ซึ่งยาวกว่าหน้าต่างดึงข้อมูล 48 ชม. ที่ยังรายงาน spike เดิมซ้ำ
ทำในทั้งรอบ CAMS และรอบ SILAM (`spikeSeen` อยู่ใน `MODEL_KEYS`)
<!-- src: scripts/obsqc.mjs:38-49; scripts/update.mjs:839-840; scripts/silam_chain.mjs:19 -->

### 2.4.3 ค่าเฉลี่ย 24 ชั่วโมงของค่าวัด

สำหรับสถานีรายชั่วโมง ค่าเฉลี่ย 24 ชม. ที่จบที่ชั่วโมงล่าสุด $t_e$ คือ

$$
\bar{o}_{24}(t_e) = \frac{1}{|W|}\sum_{t \in W} o_t ,\qquad W = \{\, t : t_e - 24\,\text{h} < t \le t_e \,\}
$$
(A.2)

ค่านี้ใช้ได้ (valid) เมื่อ $|W| \ge 18$ (75%) และ $\text{now} - t_e \le 3$ ชม.
สถานีชนิด `24` รายงานค่าเฉลี่ย 24 ชม. อยู่แล้ว จึงใช้ค่าล่าสุดโดยตรง
<!-- src: scripts/update.mjs:493-499 -->
`state.obsHist` เก็บค่าวัดย้อนหลัง 50 ชม. ต่อสถานี
<!-- src: scripts/update.mjs:487-492 -->
ค่าเฉลี่ย 24 ชม. ของอนุกรมพยากรณ์ใช้กฎ ≥ 18 จาก 24 ชั่วโมงเหมือนกัน (`mean24T`)
<!-- src: scripts/update.mjs:364-365 -->

`scripts/pmmean.mjs` เป็นคนละเรื่องกับค่าเฉลี่ย 24 ชม. ของสถานี ไฟล์นี้สร้าง**แผนที่**ค่าเฉลี่ยรายวัน รายสัปดาห์ และรายเดือนสำหรับปุ่ม "บันทึกภาพ"
- ทุกรอบ CAMS บวก analysis รายชั่วโมง (CAMS × สนามไบแอส RK บนกริด 0.05°) เข้าไฟล์ `pmday-YYYYMMDD.json` ของวันไทยนั้น
- วันที่ใช้ได้ต้องมี ≥ 18 ชั่วโมงที่วิเคราะห์ (`PMM.minHours`)
- ทุกวันที่ครบถูกเผยแพร่เป็น `data/pm-days/YYYYMMDD.json`

<!-- src: scripts/pmmean.mjs:1-11, 16, 23-38, 57-83; scripts/update.mjs:1139-1151, 1160 -->

### 2.4.4 เซนเซอร์ราคาประหยัด (`lowcost.mjs`)

**การแปลงสเกล** ค่าเซนเซอร์ $s$ แปลงเป็นสเกลสถานีอ้างอิงด้วยเส้นตรงที่ fit จากค่าเฉลี่ย 24 ชม. ของ AirGradient เทียบกับสถานี Air4Thai ที่อยู่ห่างไม่เกิน 2 กม. ใน hindcast 2024–26 (154,651 คู่ จาก 90 สถานี)

$$
\hat{o}_{\text{ref}} = \max\left(0,\; a + b\,s\right)
$$
(A.3)

<!-- src: scripts/lowcost.mjs:2-3, 8-9 -->

**การตรวจกับเพื่อนบ้านแบบ rolling** ใช้เฉพาะข้อมูลในอดีต
ค่ารายวันของทุกสถานีคือค่าเฉลี่ย 24 ชม. ที่ valid ล่าสุดของแต่ละวัน UTC บนสเกลอ้างอิง เก็บ 35 วัน
เซนเซอร์ $i$ ผ่านการตรวจเมื่อเป็นไปตามเงื่อนไขทั้งหมดนี้ ในช่วง 30 วันก่อนวันนี้
1. มีค่ารายวัน ≥ 10 วัน
2. มีเพื่อนบ้านตามเกณฑ์ ได้แก่ สถานีชนิดใดก็ได้ภายใน 50 กม. ที่มีวันร่วม ≥ 7 วัน อย่างน้อย 2 แห่ง หรือถ้าไม่ถึง ภายใน 100 กม. อย่างน้อย 1 แห่ง
3. ค่าของเพื่อนบ้านสอดคล้องกับค่ามัธยฐานรายวันของเพื่อนบ้าน $m_d$ ดังนี้

$$
r\!\left(\{x_{i,d}\},\{m_d\}\right) \ge r_{\min}
\quad\text{และ}\quad
\rho_{\min} \le \frac{\sum_d x_{i,d}}{\sum_d m_d} \le \rho_{\max}
$$
(A.4)

<!-- src: scripts/lowcost.mjs:4-7, 15-42 -->

| พารามิเตอร์ | ชื่อ | ค่า |
|---|---|---|
| ค่าตัดแกน | `a` | −3.286 µg/m³ |
| ความชัน | `b` | 0.9245 |
| หน้าต่างตรวจ | `windowD` | 30 วัน |
| เก็บค่ารายวัน | `keepD` | 35 วัน |
| จำนวนวันขั้นต่ำของเซนเซอร์ | `minDays` | 10 |
| วันร่วมขั้นต่ำกับเพื่อนบ้าน | `minCommon` | 7 |
| รัศมีแรก / รัศมีที่สอง | `r1` / `r2` | 50 / 100 กม. |
| สหสัมพันธ์ขั้นต่ำ | `rMin` | 0.6 |
| ช่วงอัตราส่วนค่าเฉลี่ย | `ratio` | [0.5, 2] |
| เปิดใช้ | `use` | true |

<!-- src: scripts/lowcost.mjs:8 -->

ผลการตรวจมี 4 แบบ: `pass`, `isolated` (ไม่มีเพื่อนบ้าน จึงเก็บไว้), `too few days` และ `fail: …`
เซนเซอร์ที่ได้ `pass` หรือ `isolated` เป็นข้อมูลเข้าของ regression kriging (หลังแปลงสเกลตาม A.3) และเป็นข้อมูลฝึก ML v1 แบบสุ่ม 1 ใน 8 ของเซนเซอร์-วัน
<!-- src: scripts/update.mjs:503-507, 1076-1078; scripts/ml.mjs:101-105, 118-119 -->
assimilation ของไฟไม่ใช้เซนเซอร์ราคาประหยัด เพราะความชื้นทำให้ค่า PM แบบ optical สูงขึ้น และจะทำให้ตัวคูณการปล่อยเอนเอียง
<!-- src: scripts/update.mjs:818 -->
การตรวจความแม่นยำก็แยกเซนเซอร์ออกจากสถานีอ้างอิง (หัวข้อ 3.6.5)

### 2.4.5 ความสอดคล้องเชิงเวลา

**Air4Thai รายชั่วโมง** เป็นค่าเฉลี่ยของชั่วโมงที่จบที่ t ส่วน CAMS เป็นค่า ณ เวลา (instantaneous) จึงเทียบกันดังนี้
- Kalman filter เทียบค่าวัดกับ CAMS ที่กลางชั่วโมง $t - 30$ นาที
- อนุกรมพยากรณ์ใช้ค่าเฉลี่ยของ CAMS สองชั่วโมงที่ติดกัน

$$
C^{\text{hm}}_t = \tfrac{1}{2}\left(C_{t-1} + C_t\right)
$$
(A.5)

<!-- src: scripts/update.mjs:856-860, 907-908 -->

**PARDIG** รายงานอัตราฝน ณ เวลา ทุก 15 นาที ระบบรวมเป็นค่าเฉลี่ยของชั่วโมงที่เริ่มที่ t (ชั่วโมงเดียวกับ GSMaP) แบบ trapezoid

$$
\bar{R}_{[t,t+60)} = \tfrac{1}{4}\left(\tfrac12 R_t + R_{t+15} + R_{t+30} + R_{t+45} + \tfrac12 R_{t+60}\right)
$$
(A.6)

เซลล์ที่ไม่มีค่าในเฟรมใดเฟรมหนึ่งถือว่าไม่มีค่า
<!-- src: scripts/pardig.mjs:9-11, 36-41 -->

**อุณหภูมิของ Air4Thai** (TEMP) เป็นค่าเฉลี่ยรายชั่วโมงที่จบที่ t ระบบจึงอ่าน ECMWF ที่ $t - 30$ นาที (`obsOffsetMs`)
<!-- src: scripts/t2down.mjs:11-13 -->

### 2.4.6 รายชื่อสถานีของ log (`stationlist.mjs`)

log รายรอบเก็บเฉพาะ id ของสถานี ทุกรอบ CAMS จึงรวมสถานีปัจจุบันเข้า `data/history/stations.json` ใน branch `history`
แต่ละรายการเก็บข้อมูลต่อไปนี้
- ชื่อและชื่อไทย
- พื้นที่ตามที่ผู้ให้ข้อมูลระบุ (Air4Thai: ตำบล อำเภอ จังหวัด; OpenAQ: locality)
- พิกัดทศนิยม 4 ตำแหน่ง
- ประเทศและผู้ให้ข้อมูล
- เป็นสถานีอ้างอิงหรือไม่
- วันไทยล่าสุดที่อยู่ในรายชื่อ (`seen`)

สถานีที่ออกจากรายชื่อยังคงรายการเดิมไว้
ชื่อไฟล์ไม่มีวันที่ การตัดไฟล์อายุเกิน 35 วันจึงไม่ลบไฟล์นี้ และไฟล์ถูกเขียนใหม่วันละครั้ง (เมื่อ `seen` เปลี่ยน)
<!-- src: scripts/stationlist.mjs:1-14; scripts/update.mjs:1187-1190 -->

---

## 2.5 Climatology ของสถานี (`climatology.mjs`)

`climatology.mjs` สรุปพฤติกรรมปกติของสถานีอ้างอิงแต่ละแห่ง เป็นค่าเฉลี่ยและเปอร์เซ็นไทล์ที่ 90 ในแต่ละเซลล์ของเดือน (เวลาไทย) × ชั่วโมงของวัน รวม 288 เซลล์
ใช้ข้อมูล 3 ปีย้อนหลังนับจากต้นเดือนปัจจุบัน

$$
\mu_{s,c} = \frac{1}{n_{s,c}}\sum_{t\in c} o_{s,t},\qquad
p90_{s,c} = o_{s,(\lfloor 0.9(n_{s,c}-1)+0.5\rfloor)},\qquad
c = 24\,(\text{month}-1) + \text{hour}
$$
(A.7)

เซลล์ที่มี $n_{s,c} <$ `minN` = 10 ค่า ถือว่าไม่มีค่า (−1) ค่าเก็บเป็น µg/m³ × 10 แบบ integer
<!-- src: scripts/climatology.mjs:21-35, 108 -->

แหล่งของแต่ละสถานีเลือกตามลำดับนี้

1. สำเนาใน OpenAQ ของสถานี Air4Thai (ตำแหน่ง OpenAQ ที่ใกล้ที่สุดภายใน 1 กม.) สำเนาเหล่านี้เป็นค่าเฉลี่ยเคลื่อนที่ 24 ชม. ระดับรายเดือนจึงถูก แต่วงจรรายวันแบน (`basis: '24h'`)
2. ถ้าไม่มีสำเนา ใช้บริการประวัติของ Air4Thai ซึ่งเก็บเพียง 2–3 เดือน (`basis: 'h'`)
3. สถานีอ้างอิงอื่นของ OpenAQ ใช้ archive บน S3

<!-- src: scripts/climatology.mjs:4-11, 52-58, 116-119 -->
ผลเขียนลง `data/static/pm-clim.json` สร้างครั้งเดียวด้วยมือผ่าน `.github/workflows/climatology.yml`
ML v2 ใช้เป็น input สองตัว (`lnClimMH`, `lnP90MH`) และ log ของ climatology blend ใช้เป็นค่า C (หัวข้อ 3.3.6)
<!-- src: scripts/ml2.mjs:26-35; scripts/update.mjs:1213-1222 -->

---

## 2.6 Log ที่ใช้เป็นข้อมูลของขั้นเรียนรู้และประตู

ขั้นที่เรียนรู้และประตูทุกตัวอ่านข้อมูลจาก log ใน `data/history/` ต่อไปนี้ (คอลัมน์ทั้งหมดอยู่ในภาค C)

| log | ความถี่ | ใช้โดย | src |
|---|---|---|---|
| `fcst-YYYYMMDDTHH.csv` | ทุกรอบ, leads 1, 3, 6, 12, 24, 48 ชม. | ML v1/v2, `pmHighCheck`, `pmNowCheck`, `accuracy.mjs`, `verify.mjs` | `update.mjs:65, 1200-1211` |
| `obs-YYYYMMDDTHH.csv` | ทุกรอบ | ค่าวัดของ OpenAQ สำหรับการจับคู่ | `update.mjs:1191-1192` |
| `a4t-YYYYMMDD.csv`, `a4tw-…` | วันละครั้ง | ค่าวัด Air4Thai รายชั่วโมง | `update.mjs:463-470` |
| `map-YYYYMMDDTHH.csv` | ทุกรอบ | ค่า leave-one-out ของแผนที่ | `update.mjs:1196-1199` |
| `climfc-YYYYMMDDTHH.csv` | ทุก 3 ชม., leads 24–120 ชม. ทุก 12 ชม. | `fit_clim_blend.mjs` | `update.mjs:71, 1213-1222` |
| `rainfc-YYYYMMDD.csv` | ทุก 3 ชม., leads 1–48 ชม. | `fit_rain_blend.py` | `update.mjs:101, 627-645` |
| `rainobs-YYYYMMDD.csv` | วันละครั้ง (หลัง 06:00 น. เวลาไทย) | `obsRainCheck`, `rainDetectCheck`, `fit_rain_blend.py` | `update.mjs:585-601` |
| `wxf-YYYYMMDDTHH.csv` | ทุกรอบ | weather ML, `rainDetectCheck` | `update.mjs:750-756` |
| `iqair-YYYYMMDDTHH.csv` | ทุกรอบ (CAMS) | `scoreIqair` | `update.mjs:1193-1195` |

ไฟล์ log แต่ละไฟล์เขียนครั้งเดียวต่อชั่วโมงที่ออกพยากรณ์ ถ้ามีรอบที่สองในชั่วโมงเดียวกัน (cron สำรองหรือการรันด้วยมือ) จะไม่เพิ่มแถวซ้ำ
<!-- src: scripts/update.mjs:1191, 1210-1212, 643 -->

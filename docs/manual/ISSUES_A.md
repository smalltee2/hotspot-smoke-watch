# ISSUES_A: ความไม่ตรงกันระหว่างโค้ด เอกสาร และแผนคู่มือ พบระหว่างเขียนภาค A

ไฟล์นี้รวบรวมประเด็นที่ต้องส่งให้ session ที่ดูแลโค้ด คู่มือถือโค้ดเป็นหลักในทุกข้อ
ระดับความสำคัญ
- **[M]** ประเด็นเชิงวิธีการ
- **[D]** เอกสารหรือความเห็นในโค้ดไม่ตรงกับโค้ด
- **[P]** แผนคู่มือไม่ตรงกับโค้ด

## ประเด็นเชิงวิธีการ

1. **[M] น้ำหนักของ rain blend fit บนฐาน ECMWF จาก Open-Meteo แต่หน้าเว็บใช้กับฐาน ECMWF open data**
   - `fit_rain_blend.py` fit บนฐาน `ecmwf_mmh` ใน `rainfc-*.csv` ซึ่งเป็นฝน Open-Meteo จาก `met.json` (`update.mjs:637-641`)
   - หน้าเว็บ (`index.html:2059-2061, 2101-2108`) ใช้น้ำหนักเหล่านี้กับ `metPrAt` ซึ่งใช้ `ecprAt` (ECMWF open data 0.25°) ก่อน (`index.html:1967`)
   - สมาชิก `shift` บนหน้าเว็บก็อ่านจาก `metPrAt` เช่นกัน
   - CLAUDE.md ห้ามเปลี่ยนฝนของ pipeline โดยไม่ fit ใหม่ แต่หน้าเว็บเปลี่ยนฐานไปแล้ว ควรตรวจว่าน้ำหนักที่ lead 1–2 ชม. ยังเหมาะกับฐานใหม่หรือไม่ หรือควรระบุไว้ในเอกสารว่ายอมรับได้

2. **[M] เกณฑ์ "รายชั่วโมงเกิน 75" ของคำเตือนนับรวม 23 ชั่วโมงที่ผ่านมา**
   - `seriesStats` (`index.html:1381-1384`) หาค่า `peak` จาก `max(0, iNow-23)` ถึงท้ายอนุกรม
   - ผลคือเมืองที่มีชั่วโมงเกิน 75 µg/m³ ในอดีต 23 ชม. ยังมีคำเตือน "พยากรณ์" อยู่ แม้พยากรณ์ข้างหน้าจะต่ำกว่า
   - ข้อความของกฎ (`WARN_RULE`, `index.html:4007`) บอกว่าเป็นค่าพยากรณ์ ควรยืนยันว่าตั้งใจให้เป็นแบบนี้หรือไม่

3. **[M] ค่าเฉลี่ย 24 ชม. ที่เผยแพร่ไม่รวมผลของ nowcast**
   - `fc24M` คำนวณในขั้น ML (`update.mjs:1004-1010`) ก่อนที่ nowcast จะแทน `corrM` (`update.mjs:1047`)
   - เมื่อประตู nowcast ผ่าน อนุกรมรายชั่วโมงกับค่าเฉลี่ย 24 ชม. ของสถานีจะไม่สอดคล้องกันในช่วง 1–6 ชม.
   - ผลกระทบน่าจะเล็ก แต่ควรระบุไว้ หรือคำนวณ `fc24M` ใหม่หลัง nowcast

4. **[M] ประตู nowcast ขึ้นกับขั้นเรียนรู้รายวันของ ML v1**
   - `pmNowCheck` อยู่ใน `try` เดียวกับ `dailyLearn` (`update.mjs:933-968`)
   - ถ้า `dailyLearn` throw (เช่น "no verified rows") ประตู nowcast จะไม่ถูกคำนวณในวันนั้น และใช้ผลของวันก่อน

5. **[M] `state.pmNow.since` ถูกตั้งค่าแต่ไม่ได้ใช้**
   - `update.mjs:961, 1041` ตั้งค่า `since` แต่ `pmNowCheck` (`update.mjs:963`) ไม่ได้ส่ง `since`
   - ประตู ML v2 ใช้ `state.ml2.since` (`update.mjs:954`)
   - ปัจจุบันไม่มีผลเพราะ nowcast สร้างแถวเก่าขึ้นใหม่ได้ แต่ถ้าวิธี nowcast เปลี่ยนในภายหลัง ประตูจะนับแถวของวิธีเก่าด้วย

## เอกสารหรือความเห็นในโค้ดที่ไม่ตรงกับโค้ด

6. **[D] รุ่นของ Node** CLAUDE.md บรรทัดแรกระบุ "Node 20 data pipeline" และ `update.mjs:2` ระบุ "Node 20+" แต่ workflow ใช้ Node 22 (`update.yml:36`) และ README ระบุ Node 22

7. **[D] CLAUDE.md กฎข้อ 4 ล้าสมัย**
   - กฎยังบอกว่า `CFG.rainBlend` (shift, amount, persist) "must stay `[[1, 0], [48, 0]]`" และ nowcast คงน้ำหนักชั่วคราว
   - แต่โค้ดมีน้ำหนักจากการ fit ครั้งแรกแล้ว (shift 0.12/0.14, persist 0.12/0.19, nowcast 0.74/0.5 ที่ 1–2 ชม.; `update.mjs:100`) ตามที่ Working notes ใน CLAUDE.md บันทึกไว้
   - ความเห็นใน `update.mjs:93-99` ไม่ได้ระบุชัดว่าน้ำหนัก `nowcast` 0.74/0.5 มาจากการ fit ครั้งเดียวกัน

8. **[D] README บอกว่าแผนที่กระจายการปรับแก้ด้วย inverse-distance weighting**
   - README หัวข้อ "Total PM2.5 forecast" ระบุว่า "spread between stations by inverse-distance weighting"
   - โค้ดใช้ regression kriging (`rk.mjs`, `update.mjs:1052-1157`)

9. **[D] README บอกว่าแบบจำลองควันไฟไม่มี plume rise และ wet removal**
   - README บรรทัดสุดท้ายระบุว่า "no plume rise, chemistry or wet removal in the fire-smoke model"
   - โค้ดมีการยกตัวของกลุ่มควันตาม Sofiev et al. (2012) (`index.html:1213, 1334-1340`) และการชะล้างแบบ HYSPLIT (`index.html:983, 1360`)
   - ที่ไม่มีจริงคือเคมี

10. **[D] ความเห็นบอกว่า SILAM ผ่าน fire assimilation แต่โค้ดปิดไว้**
    - `silam_chain.mjs:1-2` และ `update.mjs:108-110` ระบุว่า SILAM ผ่าน "fire assimilation"
    - `update.mjs:115` ตั้ง `CFG.assimilate = false` ในรอบ SILAM ซึ่งตรงกับ CLAUDE.md

11. **[D] ความเห็นของ `CFG.mlField` บอกว่าถึง 48 ชม. แต่ลูปถึง 24 ชม.**
    - `update.mjs:64` ระบุว่า "every 3 h to 48 h" และบรรทัดเดียวกันมีความเห็นของค่าอื่นปนอยู่ ("cell declustering…", "regression kriging…")
    - ลูปจริง (`update.mjs:1017`) ไปถึง `MLCFG.applyMaxLeadH` = 24 ชม. และความเห็นที่ `update.mjs:1013` ระบุ "out to 48 h"

12. **[D] ความเห็นเรื่องช่วงปล่อย puff ล้าสมัย**
    - `index.html` ใน `simulate` มีความเห็นว่า "a puff every 20 min"
    - โค้ดใช้ `releaseS` = 1800 วินาที (30 นาที) สำหรับโปรไฟล์ diurnal และ 1200 วินาทีสำหรับ const (`index.html:1311`)
    - ความเห็นถัดไปที่บอก 30/90 นาทีตรงกับโค้ด

13. **[D] `rk.mjs` เรียก kriging ว่า "ordinary kriging"**
    - ส่วนหัวของ `rk.mjs` และชื่อฟังก์ชันใช้คำว่า ordinary kriging
    - วิธีที่ใช้จริงคือ simple kriging รอบ local mean ที่ถ่วงด้วย Wendland taper (`rk.mjs:57-93`)
    - ความเห็นที่ `rk.mjs:58-64` อธิบายถูกต้อง แต่ส่วนหัวไม่ตรง

14. **[D] `diagFactorAt` (`radar.mjs:339-342`)** ความเห็นบอก "0 outside" แต่ฟังก์ชันคืนตัวคูณ 1 (ไม่เปลี่ยนค่า) ผลเท่ากัน แต่ข้อความชวนสับสน

15. **[D] ไฟล์ที่ความเห็นอ้างถึงไม่มีใน repository** ทำให้ทำซ้ำค่าบางตัวจาก repo ไม่ได้
    - `replay/fit_blend.py`, `replay/belt_v1.py` เป็นที่มาของ `blendByLead` / `blendBelt`
    - `replay/colocation.py`, `airgradient_colocation.json`, `replay/lowcost_qc.mjs` เป็นที่มาของ `LOWCOST`
    - `replay/ml_lowcost.mjs` เป็นที่มาของ `LC_SAMPLE`
    - `scripts/radar_colors` ปัจจุบันตารางสีฝังอยู่ใน `radar.mjs:41`
    - `data/history/radarnow-*.csv` ที่ความเห็นใน `index.html:2078-2080` อ้างถึงไม่มี ปัจจุบัน nowcast ของเรดาร์ถูก log ในคอลัมน์ `nowcast_mmh` ของ `rainfc-*.csv`

16. **[D] README หัวข้อ Setup** ระบุ secret เพียง `OPENAQ_API_KEY` และ `FIRMS_MAP_KEY` แต่ workflow ใช้ `GSMAP_USER`, `GSMAP_PASS`, `IQAIR_API_KEY`, `DEV_USER`, `DEV_PASS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` ด้วย (`update.yml:103-107, 208-209, 288-290`) ส่วน `CHAT_EXPORT_TOKEN` อยู่ใน `chat-train.yml`

17. **[D] ส่วนหัวของ `accuracy.mjs`** เขียนว่า "in two horizons" แต่รายการมีสามช่วง (next hours, next day, two days ahead; `ACC.horizons` มี `s`, `l`, `d2`)

## แผนคู่มือไม่ตรงกับโค้ด

18. **[P] ช่วงพยากรณ์ "1–120 ชม."**
    - CAMS ผ่าน Open-Meteo ขอ `forecast_days=4` (`update.mjs:338`) จึงยาวไม่ถึง 120 ชม.
    - SILAM ยาวราว 5 วัน
    - `climLogLeads` log ถึง 120 ชม. แต่สำหรับ CAMS แถวที่ lead เกินความยาวของพยากรณ์จะไม่ถูกเขียน (`update.mjs:1218`)

19. **[P] FIRMS "VIIRS/MODIS"** pipeline ดึงเฉพาะ VIIRS (SNPP, NOAA-20, NOAA-21; `update.mjs:52`) ส่วน MODIS ใช้ได้เฉพาะเมื่อนำเข้าไฟล์ด้วยมือบนหน้าเว็บ

20. **[P] "ค่าเฉลี่ย 24 ชม. (`pmmean.mjs`)"**
    - `pmmean.mjs` สร้างแผนที่ค่าเฉลี่ยรายวัน รายสัปดาห์ และรายเดือนสำหรับปุ่มบันทึกภาพ
    - ค่าเฉลี่ย 24 ชม. ของสถานีคำนวณใน `update.mjs` (`obs24`, `mean24T`)
    - คู่มือเขียนตามโค้ด

21. **[P] "CAMS/SILAM blending by lead (`blendByLead`, `blendBelt`)"**
    - โค้ดไม่มีการผสม CAMS กับ SILAM
    - `blendByLead` / `blendBelt` คือการผสมค่าเฉลี่ย 24 ชม. ที่พยากรณ์กับ persistence ของค่าวัด
    - คู่มือเขียนตามโค้ด (หัวข้อ 3.3.0 และ 3.3.2)

22. **[P] ลำดับ "Kalman → RK → ML" ในแผน**
    - ในโค้ดห่วงโซ่ของสถานีคือ assimilation → Kalman → persistence blend → ML v1/v2 → nowcast
    - RK เป็นห่วงโซ่ของแผนที่และรันหลัง ML ในโค้ด แต่ไม่ได้ใช้ผลของ ML
    - คู่มือเขียนตามโค้ด (ตาราง A3.7)

# ภาค A บทที่ 3 วิธีการ

> บทนี้ให้สมการและค่าพารามิเตอร์ของทุกขั้นตอนใน SEA-HAF ตามลำดับต่อไปนี้
> 1. แบบจำลองควันไฟ
> 2. อุตุนิยมวิทยา
> 3. การปรับแก้ PM2.5 หลายขั้น
> 4. ฝน
> 5. weather ML
> 6. กฎการเตือนและผลิตภัณฑ์
> 7. หลักการออกแบบ
>
> สมการมีหมายเลขต่อจากบทที่ 2 คือเริ่มที่ (A.8)
> ค่าทุกค่าอ่านจากโค้ด และมีหมายเหตุ `<!-- src: ... -->` กำกับตำแหน่งต้นทาง
> สัญลักษณ์ที่ใช้ร่วมกันทั้งบท
> - $L$ คือ lead time (ชม.)
> - $C$ คือพยากรณ์ของแบบจำลองต้นทาง (CAMS หรือ SILAM)
> - $o$ คือค่าวัด
> - $F$ คือพยากรณ์หลังผ่านการปรับแก้ถึงขั้นที่กล่าวถึง
> - $\ln_1(x) \equiv \ln(\max(0,x)+1)$

---

## 3.1 แบบจำลองควันไฟ (fire-smoke model)

แบบจำลองควันไฟเป็นแบบจำลอง Gaussian puff แบบ Lagrangian (Lagrangian Gaussian puff model) ที่ติดตามควันจากจุดความร้อน (hotspot) ของ FIRMS (Schroeder et al., 2014)
โค้ดอยู่ใน `index.html` ระหว่าง `/*MODEL-START*/` กับ `/*MODEL-END*/` และใช้ชุดเดียวกันทั้งในเบราว์เซอร์และใน pipeline (`scripts/model.mjs`)
<!-- src: index.html:980-1418, scripts/model.mjs:1-14 -->
แบบจำลองนี้มีสองหน้าที่
1. แสดงชั้น "PM2.5 จากควันไฟ" บนหน้าเว็บ
2. เป็นตัวดำเนินการสังเกต (observation operator) ของ fire-group assimilation ใน pipeline (หัวข้อ 3.1.4)

แบบจำลองไม่มีเคมีของอนุภาคทุติยภูมิ (secondary aerosol chemistry)

### 3.1.1 การจัดกลุ่มแหล่งกำเนิดและชนิดเชื้อเพลิง

จุดความร้อนถูกรวมเป็นแหล่งกำเนิดตามเซลล์ 0.1° × วันสุริยะท้องถิ่น (local solar day) ซึ่งคำนวณจาก $t + \text{lon}/15$ ชม.
- ตำแหน่งของแหล่งกำเนิดคือค่าเฉลี่ยถ่วงน้ำหนักด้วย $\max(\text{FRP}, 0.5)$
- กำลังของแหล่งกำเนิดคือค่าสูงสุดตามรอบโคจร (overpass) ของผลรวม FRP ในรอบนั้น
- ระบบแยก FRP ของรอบกลางวัน (06–18 น. เวลาสุริยะ) ที่มากที่สุด ($\text{FRP}_d$ ณ เวลา $t_d$) ออกจาก FRP สูงสุดของรอบกลางคืน ($\text{FRP}_n$)

<!-- src: index.html:1178-1199 -->

ค่าสัมประสิทธิ์การปล่อย PM2.5 (emission factor, EF) ของแต่ละจุดเลือกจากชนิดสิ่งปกคลุมดิน MODIS IGBP ตามการจับคู่ของ FINN v2.5 (ตามที่โค้ดอ้าง Wiedinmyer et al., 2023)
EF ของกลุ่มคือค่าเฉลี่ยถ่วงน้ำหนักด้วย FRP
จุดบนน้ำ หิมะ/น้ำแข็ง หรือไม่มีชั้นข้อมูล (IGBP 0, 15, 17, 255) ถูกตัดทิ้ง

**ตารางที่ A3.1** EF ตามชนิดเชื้อเพลิง (g PM2.5 ต่อ kg มวลแห้ง)

| รหัส | ชนิด | IGBP | EF |
|---|---|---|---|
| SG | savanna/grassland | 9, 10, 11, 13, 14, 16 | 7.17 |
| WS | woody savanna/shrubs | 6, 7, 8 | 7.1 |
| TROP | tropical forest | 2 (|lat| < 23.5), 5 (|lat| < 23.5) | 9.9 |
| TEMP | temperate forest | 2, 3, 4, 5 ในละติจูดอื่น | 15 |
| BOR | boreal forest | 1, 3, 5 (lat > 50) | 18.4 |
| TEMPEV | temperate evergreen forest | 1 (lat ≤ 50) | 17.9 |
| CROP | crops | 12 | 6.43 |

<!-- src: index.html:1161-1177 -->

### 3.1.2 วงจรรายวันของไฟและการปล่อย

อัตราการปล่อยพลังงานแผ่รังสีของไฟ (fire radiative power, FRP) ตามเวลาสุริยะท้องถิ่น $h$ ใช้รูป Gaussian บนฐานกลางคืน ตามรูปแบบของ Zhang et al. (2020) ที่โค้ดอ้าง

$$
\rho(h) = \text{FRP}_n + A\,G(h),\qquad G(h) = \exp\!\left[-\frac{(h-t_{pk})^2}{2\sigma_d^2}\right]
$$
(A.8)

$$
A = \min\!\left(\frac{\max(0,\,\text{FRP}_d-\text{FRP}_n)}{\max\!\left(e^{-2},\,G(t_d)\right)},\;\frac{8\,\text{FRP}_d}{\sigma_d\sqrt{2\pi}}\right)
$$
(A.9)

<!-- src: index.html:1198-1212 -->

ตัวหารถูกจำกัดล่างที่ $e^{-2}$ (ค่าที่ 2σ) เพื่อไม่ให้การตรวจพบนอกช่วงยอดถูกขยายเกินราว 7 เท่า
ตัวจำกัดที่สองทำให้ยอดกลางวันมีพลังงานไม่เกิน 8 ชั่วโมงของ FRP ที่สังเกตได้
ช่วงเวลาของแหล่งกำเนิดคือวันสุริยะของแหล่งนั้น ($[d_0, d_0+24\,\text{h})$)

มวลของ puff หนึ่งก้อนที่ปล่อยในช่วง $\Delta t_r$ ที่มีกำลัง $\rho$ (MW) คือ

$$
m = \text{EF}\cdot\kappa_{\text{FRE}}\cdot\rho\cdot\Delta t_r\cdot 10^{6}\quad[\mu\text{g}],\qquad \kappa_{\text{FRE}} = 0.368\ \text{kg MJ}^{-1}
$$
(A.10)

ค่า $\kappa_{\text{FRE}}$ ตามที่โค้ดอ้าง Wooster et al. (2005)
<!-- src: index.html:982, 1317-1327 -->

**ตารางที่ A3.2** พารามิเตอร์ของวงจรรายวันและการปล่อย puff

| พารามิเตอร์ | ค่า | หน่วย | src |
|---|---|---|---|
| $t_{pk}$ | 13 | ชม. (เวลาสุริยะ) | `index.html:1201` |
| $\sigma_d$ (เม.ย.–ส.ค. / ก.ย.–มี.ค.) | 2.39 / 1.63 | ชม. | `index.html:1201` |
| ช่วงปล่อย puff ใกล้ยอด (`releaseS`, โปรไฟล์ diurnal) | 1800 | วินาที | `index.html:1311` |
| ช่วงปล่อยเมื่อ $\rho < 0.25\rho_{\max}$ | 3 × 1800 | วินาที | `index.html:1323` |
| ไม่ปล่อยเมื่อ $\rho < 0.01\rho_{\max}$ | – | – | `index.html:1325` |
| EF ตั้งต้นเมื่อไม่มีชนิดเชื้อเพลิง | 7.17 | g/kg | `index.html:1180` |

ค่าคงที่ $t_{pk}$ และ $\sigma_d$ เป็นค่าที่ Zhang et al. fit ไว้สำหรับไฟพื้นที่เกษตรในจีนตะวันออก ความเห็นในโค้ดระบุว่าต้อง fit ใหม่สำหรับภูมิภาคนี้
<!-- src: index.html:1198-1200 -->

### 3.1.3 การยกตัวของกลุ่มควัน การกระจาย และการขนส่ง

**ความสูงที่ปล่อย (injection height)** ใช้สมการที่ 13 ของ Sofiev et al. (2012) ตามที่โค้ดอ้าง

$$
H_p = 0.24\,H_{\text{abl}} + 170\,\text{m}\cdot\left(\frac{\text{FRP}_{\text{pix}}}{1\,\text{MW}}\right)^{0.35}\exp\!\left(-0.6\,\frac{N^2_{FT}}{2.5\times10^{-4}\,\text{s}^{-2}}\right)
$$
(A.11)

- $\text{FRP}_{\text{pix}}$ คือ FRP สูงสุดของพิกเซลในกลุ่ม ปรับตามสัดส่วน $\rho/\text{FRP}$
- $N^2_{FT}$ คือ $N^2$ ระหว่าง 850–700 hPa จาก met.json (สมการ A.25)
- $H_{\text{abl}} = \max(100, \text{BLH})$

มวลถูกกระจายสม่ำเสมอจากพื้นถึง $H_p$ เฉพาะส่วนในชั้นผสมถูกนำลงสู่พื้น ส่วนที่อยู่เหนือชั้นผสมไม่ถูกนำกลับลงมาในแบบจำลองนี้

$$
f_{BL} = \min\!\left(1,\frac{H_{\text{abl}}}{H_p}\right),\qquad
\sigma_{z0} = \max\!\left(40,\;0.8\min(H_p,H_{\text{abl}})\right),\qquad
h_0 = \max(300, H_{\text{abl}})
$$
(A.12)

<!-- src: index.html:1213, 1334-1340 -->

**การขนส่ง** ตำแหน่ง puff เลื่อนด้วยลมที่ 100 ม. ที่สุ่มจาก met.json (bilinear ในพื้นที่ เชิงเส้นในเวลา)

$$
\phi \leftarrow \phi + \frac{v\,\Delta t}{M},\qquad \lambda \leftarrow \lambda + \frac{u\,\Delta t}{M\cos\phi},\qquad M = 111\,320\ \text{m deg}^{-1}
$$
(A.13)

- ช่วงเวลาพื้นฐาน $\Delta t = 600$ วินาที
- puff ที่อายุเกิน 6 ชม. เลื่อนทุก 3 ช่วง (30 นาที) และที่อายุเกิน 24 ชม. เลื่อนทุก 6 ช่วง (60 นาที) โดยสลับเฟสกัน
- puff ถูกลบเมื่ออายุเกิน 72 ชม.

ระยะทางเดินทางสะสมคือ $x \mathrel{+}= \max(|\mathbf{V}|, 0.5)\,\Delta t$
ความสูงผสมของ puff ไม่ลดลง คือ $h \leftarrow \max(h,\text{BLH},100)$
<!-- src: index.html:1349-1366 -->

**การกระจาย** ใช้ชั้นเสถียรภาพ Pasquill–Gifford (PG) ตาม Turner (1970) และเส้นโค้ง open-country ของ Briggs (1973) ตามที่โค้ดอ้าง
ค่า σ ระหว่างชั้นที่ไม่เป็นจำนวนเต็มประมาณแบบเชิงเส้นระหว่างชั้นที่ติดกัน

$$
\sigma_y = \sqrt{\sigma_{y0}^2 + \max\!\left(\sigma_y^{B}(x),\,0.5\,\tau\right)^2},\qquad
\sigma_z = \min\!\left(\sqrt{\sigma_{z0}^2 + \sigma_z^{B}(x)^2},\,5000\right)
$$
(A.14)

- $\tau$ คืออายุของ puff (วินาที) พจน์ $0.5\,\tau$ (m) คือการขยายในแนวราบระยะไกลแบบ Heffter (1965) ตามที่ README อ้าง
- $\sigma_{y0}=150$ ม.
- $\sigma_y$, $\sigma_z$ ไม่ลดลงตามเวลา

<!-- src: index.html:1300-1308, 1312, 1361-1363; README.md (Fire smoke) -->

**ตารางที่ A3.3** เส้นโค้ง Briggs (1973) ที่ใช้ ($x$ เป็นเมตร)

| ชั้น PG | $\sigma_y^B$ | $\sigma_z^B$ |
|---|---|---|
| A | $0.22x/\sqrt{1+10^{-4}x}$ | $0.20x$ |
| B | $0.16x/\sqrt{1+10^{-4}x}$ | $0.12x$ |
| C | $0.11x/\sqrt{1+10^{-4}x}$ | $0.08x/\sqrt{1+2\times10^{-4}x}$ |
| D | $0.08x/\sqrt{1+10^{-4}x}$ | $0.06x/\sqrt{1+1.5\times10^{-3}x}$ |
| E | $0.06x/\sqrt{1+10^{-4}x}$ | $0.03x/(1+3\times10^{-4}x)$ |
| F | $0.04x/\sqrt{1+10^{-4}x}$ | $0.016x/(1+3\times10^{-4}x)$ |

<!-- src: index.html:1300-1303 -->

**ตารางที่ A3.4** ชั้น PG จากลม 10 ม. ($u$, m/s) รังสีคลื่นสั้น (SW, W/m²) และเมฆ (CC, %) (1 = A … 6 = F)

| เงื่อนไข | $u<2$ | $2\le u<3$ | $3\le u<5$ | $5\le u<6$ | $u\ge6$ |
|---|---|---|---|---|---|
| CC ≥ 90 % (ทั้งกลางวันและกลางคืน) | 4 | 4 | 4 | 4 | 4 |
| กลางวัน SW > 600 | 1 | 1.5 | 2 | 3 | 3 |
| กลางวัน 300 < SW ≤ 600 | 1.5 | 2 | 2.5 | 3.5 | 4 |
| กลางวัน 10 < SW ≤ 300 | 2 | 3 | 3 | 4 | 4 |
| กลางคืน CC ≥ 50 % | 6 | 5 | 4 | 4 | 4 |
| กลางคืน CC < 50 % | 6 | 6 | 5 | 4 | 4 |

<!-- src: index.html:1287-1297, scripts/met.mjs:19-28 -->
pipeline เก็บชั้น PG ×2 ไว้ใน met.json (`cls`) จึงเก็บครึ่งชั้นได้
<!-- src: scripts/met.mjs:84 -->

**การชะล้างด้วยฝน (wet removal)** ใช้ค่าตั้งต้นของ HYSPLIT สำหรับอนุภาค ตามที่โค้ดอ้าง โดย $P$ เป็นฝน mm/h

$$
m \leftarrow m\,\exp\!\left(-A_w P^{B_w}\Delta t\right),\qquad A_w = 8\times10^{-5}\ \text{s}^{-1},\; B_w = 0.79
$$
(A.15)

<!-- src: index.html:983, 1360 -->
ในชั่วโมงที่สังเกตแล้ว ฝน $P$ ใน met.json ถูกแทนด้วยฝนสังเกต (เรดาร์ หรือ PARDIG/GSMaP) ในหน่วยความจำ (หัวข้อ 3.4.2)

**ความเข้มข้นที่ผิวพื้น** คำนวณจากภาพรวมรายชั่วโมง (hourly snapshot) ของทุก puff $i$

$$
c(\mathbf{x}) = \sum_i \frac{m_i}{2\pi\sigma_{y,i}^2}\exp\!\left(-\frac{r_i^2}{2\sigma_{y,i}^2}\right) f_{z,i},\qquad
f_{z,i} = \begin{cases} \dfrac{2}{\sqrt{2\pi}\,\sigma_{z,i}} & \sigma_{z,i} < 0.8\,h_i \\[2mm] \dfrac{1}{h_i} & \text{กรณีอื่น} \end{cases}
$$
(A.16)

- ตัดผลรวมที่ $r_i > 3\sigma_{y,i}$
- กรณีแรกคือการกระจายแบบ Gaussian ที่มีการสะท้อนที่พื้น (ground reflection)
- กรณีที่สองคือการผสมเต็มชั้น

<!-- src: index.html:1343-1347, 1370-1376 -->

### 3.1.4 Fire-group assimilation (`assim.mjs`)

CAMS มีควันไฟอยู่แล้วจาก GFAS ดังนั้น assimilation แก้เฉพาะส่วนที่ CAMS ผิด ในรูปแบบ incremental
ถ้าไม่มีข้อมูล ตัวคูณทุกตัวเป็น 1 และพยากรณ์ไม่เปลี่ยน
<!-- src: scripts/assim.mjs:17-20 -->
ขั้นนี้ใช้เฉพาะรอบ CAMS (`CFG.assimilate = true`) และปิดในรอบ SILAM
<!-- src: scripts/update.mjs:59, 115 -->

**กลุ่มไฟ** คือเซลล์ $0.5°$ × วันสุริยะท้องถิ่น มีตัวแปรควบคุมคือ $x_g = \ln s_g$ โดย $s_g$ เป็นตัวคูณการปล่อยของกลุ่ม $g$ (แบบ log-normal จึงไม่ติดลบ)
แหล่งกำเนิดมาจาก `clusterSources` ที่เซลล์ 0.1° ใช้ EF ตามชนิดเชื้อเพลิงและแยกตามวัน และใช้เฉพาะจุดที่ confidence ไม่ต่ำ (`confOK(h,'n')`) ไม่เกิน 800 แหล่ง
การจำลองก่อนปรับ (prior) ใช้โปรไฟล์ diurnal และการยกตัวของกลุ่มควัน ไปจนถึง now + 72 ชม.
<!-- src: scripts/assim.mjs:21-22, 62-71 -->

**ค่าสังเกต** มาจากสถานีอ้างอิงเท่านั้น
- innovation เทียบกับ CAMS ที่หัก**ไบแอสช้า** $b^{\text{slow}}$ ของสถานีออกแล้ว (หัวข้อ 3.3.1)
- สถานีชนิด `24` ใช้สองค่าที่ไม่ทับกัน คือค่าล่าสุดและค่า 24 ชม. ก่อนหน้า เพื่อลดการซ้ำที่สัมพันธ์กัน

<!-- src: scripts/update.mjs:816-825 -->

$$
d_k = y_k - c_k,\qquad c_k = (C_k + 1)\,e^{b^{\text{slow}}} - 1
$$
(A.17)

$$
d_k \approx h_k(\mathbf{x}) = \sum_g \left(e^{x_g}-1\right) F_{gk}
$$
(A.18)

$F_{gk}$ คือควันจากกลุ่ม $g$ ที่ไปถึงค่าสังเกต $k$ ในการจำลอง prior คำนวณตามชนิดค่าวัด
- ชนิด `hm` ใช้ค่าเฉลี่ยของสองภาพชั่วโมงที่ติดกัน
- ชนิด `24` ใช้ค่าเฉลี่ย 24 ภาพ (ชั่วโมงก่อนเริ่มจำลองนับเป็นศูนย์)
- ชนิด `h` ใช้ภาพ ณ ชั่วโมงนั้น

ใช้เฉพาะค่าสังเกตที่ $\sum_g F_{gk} \ge F_{\min}$ และอยู่ในหน้าต่าง $[\max(\text{now}-48\,\text{h},\; t_{\text{start}}+6\,\text{h}),\ \text{now}]$
<!-- src: scripts/assim.mjs:64-85 -->

ความแปรปรวนของความคลาดเคลื่อนของค่าสังเกต (observation error) และฟังก์ชันต้นทุน (cost function) คือ

$$
R_k = \kappa\left[\max(\sigma_{\min},\,\epsilon_r y_k)^2 + \left(\epsilon_m \textstyle\sum_g F_{gk}\right)^2\right]
$$
(A.19)

$$
J(\mathbf{x}) = \tfrac12\sum_k \frac{\left(d_k - h_k(\mathbf{x})\right)^2}{R_k} + \tfrac12\sum_g \frac{x_g^2}{\sigma_b^2}
$$
(A.20)

<!-- src: scripts/assim.mjs:9-15, 86-87, 93-99 -->

การหาค่าต่ำสุดใช้ Gauss–Newton กับ normal equation $(\mathbf{K}^\top\mathbf{R}^{-1}\mathbf{K}+\mathbf{B}^{-1})\,\delta\mathbf{x} = \mathbf{K}^\top\mathbf{R}^{-1}(\mathbf{d}-\mathbf{h}) - \mathbf{B}^{-1}\mathbf{x}$ โดย $K_{kg} = e^{x_g}F_{gk}$ แก้ด้วย Cholesky
- ลดขนาดก้าว (step halving) ได้สูงสุด 8 ครั้ง
- จำกัด $x_g \in [-4, 4]$
- หยุดเมื่อ $\Delta J < 10^{-6}\max(1,J)$ หรือครบ `maxIter`

ณ คำตอบ ระบบคำนวณความแปรปรวนหลังปรับ (posterior covariance) $\mathbf{A} = (\mathbf{K}^\top\mathbf{R}^{-1}\mathbf{K}+\mathbf{B}^{-1})^{-1}$ แล้วคำนวณค่าต่อไปนี้ (Rodgers, 2000 ตามที่โค้ดอ้าง)

$$
\text{DOFS} = \sum_g \left(1 - \frac{A_{gg}}{\sigma_b^2}\right),\qquad
\chi^2/m = \frac{2J}{m}
$$
(A.21)

พารามิเตอร์ $\kappa$ ของรอบถัดไปปรับจากผลทดสอบ $\chi^2$

$$
\kappa_{\text{next}} = \exp\!\left[0.7\ln\kappa + 0.3\ln\left(\operatorname{clip}(\kappa\,\chi^2/m,\ \kappa_{\min},\ \kappa_{\max})\right)\right]
$$
(A.22)

<!-- src: scripts/assim.mjs:91-113 -->

**increment** ได้จากการจำลองอีกหนึ่งรอบ ที่มีเฉพาะแหล่งที่ $|s_g - 1| > 0.01$ โดยแต่ละแหล่งปล่อย $(s_g - 1)$ เท่าของปริมาณ prior
ค่านี้เป็นลบได้เมื่อ $s_g < 1$ เพราะแบบจำลองเป็นเชิงเส้นในการปล่อย
increment นี้เคลื่อนไปตามลมพยากรณ์

$$
\Delta c(\mathbf{x},t) = \sum_g (s_g - 1)\,F_g(\mathbf{x},t),\qquad C^{A} = \max(0,\,C + \Delta c)
$$
(A.23)

<!-- src: scripts/assim.mjs:115-118; scripts/update.mjs:911 -->
เมื่อ assimilation สำเร็จ (`status = 'ok'`) state จะเก็บ $\kappa_{\text{next}}$
ต้องมีค่าสังเกตที่ได้รับอิทธิพลจากไฟอย่างน้อย 5 ค่า มิฉะนั้นจะไม่ assimilate
<!-- src: scripts/assim.mjs:91; scripts/update.mjs:827 -->

**ตารางที่ A3.5** ค่าตั้งของ assimilation (`ASSIM`)

| พารามิเตอร์ | ชื่อ | ค่า | หน่วย |
|---|---|---|---|
| ขนาดกลุ่มไฟ | `groupDeg` | 0.5 | องศา |
| ความไม่แน่นอนของ prior | `sigmaB` | ln 2 ≈ 0.693 | – (ประมาณ ×2 ที่ 1σ) |
| ความคลาดเคลื่อนขั้นต่ำของค่าวัด | `sigmaMin` | 3 | µg/m³ |
| ความคลาดเคลื่อนสัมพัทธ์ | `rel` | 0.3 | – |
| ความคลาดเคลื่อนของแบบจำลองขนส่ง | `epsModel` | 0.5 | – |
| κ เริ่มต้น / ต่ำสุด / สูงสุด | `kappa0` / `kappaMin` / `kappaMax` | 4 / 1 / 20 | – |
| ควันไฟขั้นต่ำต่อค่าสังเกต | `minF` | 1.0 | µg/m³ |
| หน้าต่างค่าสังเกต | `windowH` | 48 | ชม. |
| spin-up | `spinupH` | 6 | ชม. |
| จำนวนแหล่งสูงสุด | `maxSources` | 800 | – |
| จำนวนรอบสูงสุด | `maxIter` | 10 | – |
| ช่วงพยากรณ์ของการจำลอง | `horizonH` | 72 | ชม. |

<!-- src: scripts/assim.mjs:21-22 -->

---

## 3.2 อุตุนิยมวิทยา

### 3.2.1 กริดซ้อนและการสุ่มค่า

met.json มีสองกริด คือ north (0.25°) และ domain (1.0°) (ตารางที่ A2.1)
ค่าที่จุดใด ๆ คำนวณแบบ bilinear ในพื้นที่และเชิงเส้นในเวลา
ภายในระยะ `MET_TAPER` = 0.5° จากขอบของกริดละเอียด ค่าจะผสมกับกริดหยาบด้วยน้ำหนักแบบ smoothstep

$$
w_{\text{fine}} = S\!\left(\frac{d}{0.5^\circ}\right),\quad S(q) = q^2(3-2q),\ 0\le q\le1;\qquad w_{\text{coarse}} = 1-w_{\text{fine}}
$$
(A.24)

$d$ คือระยะ (องศา) จากจุดถึงขอบที่ใกล้ที่สุดของกริดละเอียด หน้าเว็บใช้น้ำหนักเดียวกัน
<!-- src: scripts/met.mjs:107-137, index.html:1260-1270 -->

### 3.2.2 เสถียรภาพของบรรยากาศอิสระและความสูงของระดับ

$$
N^2 = \frac{g}{\bar\theta}\,\frac{\theta_{700}-\theta_{850}}{z_{700}-z_{850}},\qquad \theta_p = (T_p + 273.15)\left(\frac{1000}{p}\right)^{0.2857}
$$
(A.25)

- จำกัดค่าไว้ใน $[0,\ 6\times10^{-4}]$ s⁻²
- ไม่มีค่าเมื่อ $z_{700}-z_{850} < 500$ ม.
- ค่าตั้งต้นเมื่อขอข้อมูลไม่สำเร็จคือ $10^{-4}$ s⁻²

<!-- src: scripts/met.mjs:14, 53-58 -->

ความสูงของระดับ 925 hPa ได้จากสมการ hypsometric (hypsometric equation) จากระดับ 850 hPa โดยบวกอุณหภูมิ 850 hPa ด้วย 3 K แทนชั้นที่อุ่นกว่าด้านล่าง (ความคลาดเคลื่อน ±20 ม. ตามความเห็นในโค้ด)

$$
z_{925} = z_{850} - \frac{R_d}{g}\,(T_{850}+273.15+3)\,\ln\frac{925}{850} - z_g,\qquad R_d = 287.05,\ g = 9.80665
$$
(A.26)

<!-- src: scripts/met.mjs:63-66 -->

### 3.2.3 การลดขนาดอุณหภูมิ 2 ม. (`t2down.mjs`)

**ขั้นที่ 1: ปรับตามภูมิประเทศ** ใช้อัตราการลดลงของอุณหภูมิตามความสูง (lapse rate) $\Gamma$ บรรยากาศมาตรฐาน
$z_p$ คือความสูงที่ Open-Meteo รายงานสำหรับ node $p$ ซึ่ง t2 ของ node อ้างถึงความสูงนี้ ส่วน $z(\mathbf{x})$ คือ DEM 0.025°

$$
T_{\text{ter}}(\mathbf{x},t) = \sum_{p} w_p(\mathbf{x})\left[T_p(t) + \Gamma z_p\right] - \Gamma\,z(\mathbf{x})
$$
(A.27)

<!-- src: scripts/t2down.mjs:1-3, 13, 18-32 -->

**ขั้นที่ 2: ปรับด้วยสถานี**
- คำนวณ residual $r = T_{\text{obs}} - T_{\text{ter}}$ ที่สถานี Air4Thai ในหน้าต่าง 48 ชม. โดยอ่าน ECMWF ที่ $t-30$ นาที
- ตัด $|r| > 12$ °C
- แยกค่าเฉลี่ยของ residual เป็นสองช่วง คือกลางวัน (07–18 น. เวลาไทย) และกลางคืน เพราะการผกผันของอุณหภูมิในหุบเขาทำให้ residual กลางคืนต่างออกไป
- แต่ละช่วงต้องมี ≥ 6 ค่า
- สถานีที่ residual ล่าสุดเก่ากว่า 3 ชม. ไม่ถูกใช้

ระบบสร้างสนามสองชนิดด้วย `krigeField` (K = 16, declustering 0.25°) บนกริด 0.1° แล้วรวมเป็น

$$
T_{\text{down}} = T_{\text{ter}} + \mathbb{1}_{\text{bin}}\,\bar r_{\text{bin}}(\mathbf{x}) + \mathbb{1}_{\text{anom}}\;e^{-|t - t_A|/\tau_T}\;\tilde r(\mathbf{x})
$$
(A.28)

- $\bar r_{\text{bin}}$ คือสนาม residual เฉลี่ยของช่วงนั้น
- $\tilde r$ คือสนามของ residual ล่าสุดลบค่าเฉลี่ยของช่วงนั้น
- $t_A$ คือชั่วโมง analysis
- $\tau_T$ = 6 ชม.

สนามทั้งสองจางเป็นศูนย์เมื่อห่างจากสถานี ต้องมีสถานีอย่างน้อย 10 แห่ง
<!-- src: scripts/t2down.mjs:4-6, 11-15, 38-64, 124-136 -->

ตัวบ่งชี้ $\mathbb{1}$ กำหนดใหม่ทุกรอบด้วยการทดสอบแบบเว้นทีละสถานี (leave-one-out) ที่ถ่วงน้ำหนักด้วย declustering
- สนามเฉลี่ยของแต่ละช่วงจะถูกใช้เมื่อลด RMSE ที่เว้นออกได้เทียบกับ $T_{\text{ter}}$
- สนาม anomaly จะถูกใช้เมื่อลด RMSE ของชั่วโมงล่าสุดได้เพิ่มอีก

<!-- src: scripts/t2down.mjs:66-98 -->

**ตารางที่ A3.6** ค่าตั้ง `T2CFG`

| พารามิเตอร์ | ค่า | หน่วย |
|---|---|---|
| `lapse` ($\Gamma$) | 6.5 × 10⁻³ | °C/m |
| `efoldH` ($\tau_T$) | 6 | ชม. |
| `step` (สนามปรับแก้) | 0.1 | องศา |
| `windowH` | 48 | ชม. |
| `minObs` | 6 | ค่าต่อช่วง |
| `maxAbsResid` | 12 | °C |
| `demStep` | 0.025 | องศา |
| `obsOffsetMs` | 1,800,000 | ms (30 นาที) |

<!-- src: scripts/t2down.mjs:13-14 -->
`.github/workflows/lapse-check.yml` เป็นการตรวจครั้งเดียวว่า Open-Meteo ใช้ lapse rate เท่าใดกับ `temperature_2m` ผลออกเป็น annotation เท่านั้น
<!-- src: .github/workflows/lapse-check.yml:1 -->

### 3.2.4 Trajectory ย้อนหลัง (backward trajectory)

หน้าเว็บคำนวณชุด (ensemble) ของ trajectory ย้อนหลัง 27 เส้นจาก `met-traj.json`
- ความสูงเหนือพื้น 3 ระดับ (100, 500, 1500 ม.)
- ตำแหน่งที่อ่านลม 9 ตำแหน่ง คือ $\Delta\phi, \Delta\lambda \in \{0, \pm0.25°\}$
- ความสูงของแต่ละเส้นคงที่
- ย้อนหลัง 48 หรือ 24 ชม.

การอินทิเกรตใช้แบบ predictor–corrector (Heun) ด้วย $\Delta t = -600$ วินาที

$$
\mathbf{x}^* = \mathbf{x}_n + \mathbf{V}(\mathbf{x}_n,t_n)\Delta t,\qquad
\mathbf{x}_{n+1} = \mathbf{x}_n + \tfrac12\left[\mathbf{V}(\mathbf{x}_n,t_n)+\mathbf{V}(\mathbf{x}^*,t_n+\Delta t)\right]\Delta t
$$
(A.29)

<!-- src: index.html:3681, 3701-3713, 3733-3737 -->

ลมที่ความสูง $h$ ได้จากการประมาณเชิงเส้นระหว่างระดับ [10 ม., 100 ม., $z_{925}$, $z_{850}$, $z_{700}$]
- ระดับความกดอากาศที่ไม่สูงกว่าระดับก่อนหน้าเกิน 50 ม. ถูกข้าม (ระดับที่อยู่ใต้หรือใกล้พื้น)
- เหนือระดับสูงสุดใช้ลมของระดับสูงสุด

<!-- src: index.html:3694-3699 -->
เส้นจะหยุดเมื่อออกนอกกริด domain หรือก่อนเวลาเริ่มต้นของข้อมูล
ไฟที่นับว่าเกี่ยวกับเส้นทาง คือ hotspot ที่ห่างจุดบนเส้นทางไม่เกิน 20 กม. และตรวจพบภายใน 12 ชม. ของเวลาที่อากาศผ่าน
<!-- src: index.html:3681, 3738-3741 -->
README เรียกวิธีนี้ว่าแบบ HYSPLIT-style ส่วนหน้าเว็บระบุว่าเป็นแนวทาง (guide) ไม่ใช่ค่าวัด
<!-- src: README.md (Where the air comes from), index.html:3222 -->

### 3.2.5 ดัชนีการระบายอากาศ (ventilation index)

$$
\text{VI} = \text{BLH}\cdot|\mathbf{V}_{100}|\cdot W,\qquad W = \operatorname{clip}\!\left(1 + 0.5\,\Omega_s + 0.5\,\Omega_c,\ 0.6,\ 1.4\right)
$$
(A.30)

น้ำหนักภูมิประเทศ $W$ ใช้วิธี MicroMet ของ Liston & Elder (2006) ตามที่โค้ดอ้าง บน DEM 0.025°
- $\Omega_s = \operatorname{clip}\left((\nabla z\cdot\mathbf{V}/|\mathbf{V}|)/s_g,\ \pm0.5\right)$ คือความชันตามทิศลม ลมขึ้นเขาเร่งขึ้น ด้านหลังเขาช้าลง
- $\Omega_c = \operatorname{clip}(\kappa_c/s_c,\ \pm0.5)$ คือความโค้งของภูมิประเทศ (สันเขาเปิดรับลม หุบเขากำบังลม)
- $\kappa_c$ คำนวณจากผลต่างของความสูงกับค่าเฉลี่ยของจุดตรงข้ามที่ระยะ 4 เซลล์ (0.1°) ใน 4 ทิศ
- $s_g$ และ $s_c$ คือ 2 เท่าของเปอร์เซ็นไทล์ที่ 95 ของค่าสัมบูรณ์ในโดเมน
- ถ้าลมอ่อนกว่า 0.1 m/s ให้ $\Omega_s = 0$
- ความสูงชั้นผสมใช้ค่า ECMWF ตามที่เป็น

<!-- src: index.html:2582-2604 -->

ระดับของดัชนีตามเกณฑ์ air-pollution potential ของ US NMC (Stackpole 1967 / Gross 1970 ตามที่ README อ้าง)

| ระดับ | VI (m²/s) |
|---|---|
| ไม่ดี (poor) | < 2,000 |
| ปานกลาง (moderate) | 2,000–6,000 |
| ดี (good) | ≥ 6,000 |

<!-- src: index.html:2605; README.md (Ventilation) -->

---

## 3.3 การปรับแก้ PM2.5 หลายขั้น (multi-stage correction)

### 3.3.0 ลำดับขั้นและเหตุผล

**ตารางที่ A3.7** ลำดับขั้นการปรับแก้ใน `update.mjs`

| ลำดับ | ขั้น | ใช้กับ | ผลลัพธ์ใน `latest.json` / log | สถานะ |
|---|---|---|---|---|
| 0 | fire-group assimilation | สถานี + แผนที่ | `inc`, `corrA` | เปิด (CAMS), ปิด (SILAM) |
| 1 | Kalman filter บน log ratio (`kf`, `kfA`, `kfSlow`) | สถานี | `corr`, `corrA` / `corrected`, `correctedA` | เปิด |
| 2 | ผสมค่าเฉลี่ย 24 ชม. กับ persistence ตาม lead (`blendByLead`, `blendBelt`) | สถานี (24 ชม.) | `fc24`, `fc24A`, `fc24M` / `blend24*` | เปิด |
| 3 | ML v1 (ensemble ของผู้เชี่ยวชาญ รวม hindcast) | สถานีรายชั่วโมง, lead ≤ 24 ชม. | `corrM` / `correctedML1`, `correctedML` | เปิดเมื่อมีผู้เชี่ยวชาญที่ได้น้ำหนัก |
| 3′ | ML v2 (candidate) | สถานีรายชั่วโมง, lead ≤ 24 ชม. | `correctedML2` | คำนวณและ log ทุกชั่วโมง; **เผยแพร่เฉพาะเมื่อผ่าน `pmHighCheck`** |
| 4 | ML map field | แผนที่ 0.1° | `ml-field.json` | เปิดพร้อม ML |
| 5 | nowcast 1–6 ชม. | สถานีรายชั่วโมง | `correctedPre`, `correctedNC` | log ทุกชั่วโมง; **เผยแพร่เฉพาะเมื่อผ่าน `pmNowCheck`** |
| 6 | regression kriging (RK) | แผนที่ 0.025° | `rk`, `rkA`, `rk-bias*.json` | เปิด (ต้องมีข้อมูลเข้า ≥ 15 จุด) |
| – | climatology blend | สถานีและแผนที่ (ตั้งใจไว้) | `climfc-*.csv` (log เท่านั้น) | **ปิด: น้ำหนักเป็นศูนย์ และโค้ดยังไม่ได้นำไปใช้** |

<!-- src: scripts/update.mjs:807-1161, 1204-1222 -->

เหตุผลของลำดับ

1. **assimilation ก่อน Kalman** ตัวกรอง `kfA` ถูก fit กับส่วนที่ assimilation เหลือไว้ จึงไม่แก้ความคลาดเคลื่อนเดียวกันซ้ำ (no double counting)
   ค่า increment ที่ `kfA` ใช้คือค่าที่**รอบก่อนหน้าพยากรณ์ไว้**สำหรับชั่วโมงนั้น (`state.incFc`) ไม่ใช่ค่า posterior ของรอบนี้ที่ fit กับค่าสังเกตชุดเดียวกัน
   <!-- src: scripts/update.mjs:834-843 -->
2. **ไบแอสช้า (`kfSlow`)** เรียนเฉพาะชั่วโมงที่แบบจำลองให้ควันไฟน้อยกว่า 1 µg/m³ ไบแอสของสถานีจากฤดูเผาไหม้จึงไม่ถูกนับเป็นไบแอสถาวร และ innovation ของ assimilation เหลือเฉพาะส่วนที่มาจากไฟ
   <!-- src: scripts/update.mjs:56-58, 837, 851 -->
3. **ML เรียนจากความคลาดเคลื่อนที่เหลือหลังผ่านทั้งห่วงโซ่** เป้าหมายคือ $o$ เทียบกับ $F = $ `corrA` จึงแก้เฉพาะส่วนที่ขั้นก่อนหน้าแก้ไม่ได้
   <!-- src: scripts/ml.mjs:4-5 -->
4. **nowcast อยู่หลังสุด** ทำงานบนอนุกรมที่จะเผยแพร่ (`corrM`, ถ้าไม่มีใช้ `corrA`, ถ้าไม่มีใช้ `corr`) และมีผลเฉพาะ 1–6 ชม.
   <!-- src: scripts/update.mjs:1043 -->
5. **RK เป็นห่วงโซ่ของแผนที่** ทำงานบนฐานค่าเฉลี่ย 24 ชม. ณ ชั่วโมง analysis และจางตาม lead บนหน้าเว็บ
   ในโค้ด RK รันหลัง ML แต่ไม่ได้ใช้ผลของ ML ผลของ ML ต่อแผนที่มาทางสนาม `ml-field.json` แยกต่างหาก
   <!-- src: scripts/update.mjs:1051-1161 -->

**การผสม CAMS กับ SILAM ตาม lead ไม่มีในโค้ด**
ค่าตั้ง `blendByLead` และ `blendBelt` ไม่ใช่การผสมระหว่างสองโมเดล แต่เป็นการผสมพยากรณ์ค่าเฉลี่ย 24 ชม. กับ persistence ของค่าวัด (หัวข้อ 3.3.2)
CAMS และ SILAM รันแยกกันทั้งห่วงโซ่ และหน้าเว็บสาธารณะแสดงเฉพาะ CAMS
<!-- src: scripts/update.mjs:83-92, 105-106; scripts/silam_chain.mjs:1-11 -->

### 3.3.1 Kalman filter บน log ratio

ไบแอสของแต่ละสถานีนิยามบนสเกล log ตามแนวทางการปรับแก้ไบแอสด้วย Kalman filter ของ Delle Monache et al. (2006)

$$
y_t = \ln(o_t + 1) - \ln(C_t + 1)
$$
(A.31)

สถานะ $b$ เป็น random walk ในช่วงห่าง $n = \max(1, \operatorname{round}(\Delta t/1\,\text{h}))$ ชั่วโมง

$$
P^- = P + nQ,\qquad K = \frac{P^-}{P^- + R},\qquad b \leftarrow b + K\,(y_t - b),\qquad P \leftarrow (1-K)P^-
$$
(A.32)

ถ้าช่วงห่างจากการปรับครั้งก่อนเกิน `maxGapH` สถานะเริ่มใหม่ที่ $b=0$, $P=P_0$
<!-- src: scripts/update.mjs:346-356 -->

พยากรณ์ที่ปรับแล้วใช้ไบแอสที่จางตาม lead ด้วยค่าคงที่ $\tau_b$ = `biasLeadEfoldH`

$$
F_t = \max\!\left(0,\ (C_t + 1)\exp\!\left[b\,e^{-\max(0,L)/\tau_b}\right] - 1\right),\qquad L = \frac{t - t_k}{1\,\text{h}}
$$
(A.33)

- $t_k$ คือเวลาที่ตัวกรองถูกปรับล่าสุด
- ใช้ไบแอสเฉพาะเมื่อ $\text{now} - t_k < $ `kf.maxGapH` มิฉะนั้น $b=0$

<!-- src: scripts/update.mjs:357, 879-881 -->
สถานีชนิด `24` ใช้ไบแอสเต็ม (ไม่จาง) กับ CAMS ก่อนนำไปเฉลี่ย 24 ชม.
<!-- src: scripts/update.mjs:894-895 -->

**ตารางที่ A3.8** ค่าตั้งของ Kalman filter

| ตัวกรอง | เทียบกับ | $Q$ | $R$ | $P_0$ | `maxGapH` | เงื่อนไขการปรับ |
|---|---|---|---|---|---|---|
| `kf` | CAMS | 0.02 | 0.15 | 0.5 | 48 ชม. | ทุกค่าวัดใหม่ |
| `kfA` | CAMS + increment จากรอบก่อน (A.23) | 0.02 | 0.15 | 0.5 | 48 ชม. | ทุกค่าวัดใหม่ |
| `kfSlow` | CAMS | 0.002 | 0.15 | 0.5 | 168 ชม. | เฉพาะชั่วโมงที่ควันไฟจำลอง < 1 µg/m³ |
| ทุกตัว, สถานีชนิด `24` | ค่าเฉลี่ย 24 ชม. ของ CAMS | ตามข้างบน | $24R$ | ตามข้างบน | ตามข้างบน | ค่าเฉลี่ยเคลื่อนที่ทับกัน 23/24 ชั่วโมงหนึ่งจึงมีข้อมูลเพียง 1/24 |
| $\tau_b$ (`biasLeadEfoldH`) | – | – | – | – | – | 48 ชม. |

<!-- src: scripts/update.mjs:54-60, 845-853 -->

รายละเอียดการปรับ
- สถานี Air4Thai รายชั่วโมง ปรับด้วยทุกชั่วโมงใน 12 ชม. ล่าสุดที่ยังไม่เคยใช้ เรียงตามเวลา และเทียบกับ CAMS ที่กลางชั่วโมง
- สถานีอื่นปรับด้วยค่าล่าสุดเพียงค่าเดียว
- สถานะของตัวกรองของสถานีที่ออกจากรายชื่อและเงียบเกิน 14 วันถูกลบ

<!-- src: scripts/update.mjs:854-872 -->
หลัง spike ที่ตัวกรองรับไปแล้ว ตัวกรองทั้งสามของสถานีนั้นเริ่มใหม่ครั้งเดียว (หัวข้อ 2.4.2)

### 3.3.2 พยากรณ์ค่าเฉลี่ย 24 ชม. ผสมกับ persistence

ดัชนีคุณภาพอากาศของไทยและคำแนะนำสุขภาพใช้ค่าเฉลี่ย 24 ชม. ระบบจึงผสมค่าเฉลี่ย 24 ชม. ของพยากรณ์ $\bar F_{24}$ กับ persistence ของค่าวัด $\bar o_{24}$ ณ ปัจจุบัน
- สำหรับชั่วโมงที่ผ่านมา $\bar F_{24}$ ใช้ค่าวัด
- สำหรับชั่วโมงข้างหน้า $\bar F_{24}$ ใช้พยากรณ์ที่ปรับแล้ว
- ต้องมีอย่างน้อย 18 จาก 24 ค่า

$$
\hat{\bar F}_{24}(L) = w(L)\,\bar o_{24} + \left[1-w(L)\right]\bar F_{24}(L)
$$
(A.34)

$$
w(L) = w_k + \frac{\ln L - \ln L_k}{\ln L_{k+1}-\ln L_k}\,(w_{k+1}-w_k),\qquad L_k \le L \le L_{k+1}
$$
(A.35)

นอกช่วงตารางใช้ค่าที่ปลาย
<!-- src: scripts/update.mjs:83-92, 104-106, 883-902 -->

**ตารางที่ A3.9** น้ำหนัก persistence $w(L)$

| lead (ชม.) | 1 | 3 | 6 | 12 | 24 | 48 |
|---|---|---|---|---|---|---|
| `blendByLead` (ทั่วไป) | 0.97 | 0.94 | 0.89 | 0.78 | 0.68 | 0.5 |
| `blendBelt.byLead` (แถบไฟภาคเหนือ 97–105.5°E, 17.5–22.5°N) | 0.97 | 0.94 | 0.89 | 0.78 | 0.74 | 0.65 |

<!-- src: scripts/update.mjs:87, 92 -->

ความเห็นในโค้ดอธิบายที่มาของน้ำหนักดังนี้
- น้ำหนักทั่วไป fit ด้วย least squares บน hindcast replay 2024–26 และตรวจแบบเว้นทีละฤดู (leave-one-season-out)
- ที่ 48 ชม. ค่าที่ fit ได้คือ 0.59 แต่นอกฤดูไม่ดีกว่า 0.5 จึงใช้ 0.5
- น้ำหนักในแถบไฟ fit ใหม่สำหรับ SEA-HAF v1.0 (6 ต.ค. 2026) และลด MSE ที่ 48 ชม. ได้ 12 %

สคริปต์ที่ใช้ fit (`replay/fit_blend.py`, `replay/belt_v1.py`) ไม่มีใน repository (ดู ISSUES_A.md)
<!-- src: scripts/update.mjs:83-92 -->

### 3.3.3 Regression kriging ของแผนที่ (`rk.mjs`, `CFG.rk`)

แผนที่ PM2.5 ปรับแก้ด้วย regression kriging (RK) ใน log space โครงสร้างเดียวกับวิธี RIMM ที่ใช้ทำแผนที่คุณภาพอากาศยุโรป และ kriging with external drift จากแบบจำลองเคมี-การขนส่ง (ตามที่โค้ดอ้าง Horálek et al.; Real et al., 2022)
<!-- src: scripts/rk.mjs:1-3 -->

**ข้อมูลเข้า** ณ ชั่วโมง analysis ประกอบด้วย
- สถานีอ้างอิง
- เซนเซอร์ราคาประหยัดที่ได้ `pass` หรือ `isolated` แปลงสเกลตาม A.3

แต่ละจุดต้องมีค่าวัดอายุไม่เกิน 3 ชม. และมีค่าเฉลี่ย 24 ชม. ที่ valid
ตัวแปรตามคือ $Y = \ln(\bar o_{24}+1)$
ตัวแปรอธิบาย (predictor) คือ

$$
\mathbf{X} = \left[\ln(\bar C_{24}+1),\ z/1000,\ \ln\!\left(\max(\text{BLH},50)/1000\right),\ |\mathbf{V}_{100}|\right]
$$
(A.36)

ต้องมีข้อมูลเข้าอย่างน้อย `minStations` = 15 จุด
<!-- src: scripts/update.mjs:1074-1085 -->
RK รันสองรุ่น
- `rk` ใช้ $C$ = CAMS
- `rkA` ใช้ $C$ = CAMS + increment ที่รอบก่อนพยากรณ์ไว้ kriging จึงแก้เฉพาะส่วนที่ assimilation เหลือ

<!-- src: scripts/update.mjs:1052-1055, 1080, 1159 -->

**การถดถอย** ใช้ weighted least squares กับน้ำหนัก declustering แบบเซลล์ (Deutsch 1989 ตามที่โค้ดอ้าง)
- สถานีในเซลล์ขนาด 0.25° ได้น้ำหนัก 1/จำนวนสถานีในเซลล์ แล้วปรับให้ผลรวมเท่ากับ $n$
- เครือข่ายหนาแน่น เช่น กรุงเทพฯ จึงไม่ดึงสัมประสิทธิ์ทั้งภูมิภาค
- มี ridge ขนาดเล็ก $10^{-6}n$

<!-- src: scripts/rk.mjs:8-15, 95-104 -->
มีการป้องกัน extrapolation สามข้อ
1. ลดจำนวน predictor จากท้ายรายการเมื่อ $n < 10(p+1)$ โดยเก็บ $\ln(C+1)$ ไว้เสมอ
2. จำกัด predictor เสริมไว้ในช่วงที่สถานีครอบคลุม (`clampAux`)
3. จำกัดค่าปรับแก้ไว้ที่ $\pm\ln 3$

<!-- src: scripts/rk.mjs:106-117 -->

**variogram ของ residual** ใช้รูป exponential (exponential semivariogram)

$$
\gamma(h) = c_0 + c_1\left(1 - e^{-h/a}\right)
$$
(A.37)

- fit ด้วย weighted least squares กับค่า empirical ที่แบ่ง bin 15 กม. ถึง 400 กม.
- แต่ละคู่นับน้ำหนัก $w_iw_j$ และแต่ละ bin ต้องมี ≥ 5 คู่
- หา $a$ แบบ grid จาก 10 ถึง 500 กม. ทีละ 5
- ถ้ามี bin น้อยกว่า 3 ใช้ค่าสำรอง $c_0 = c_1 = \operatorname{Var}/2$, $a = 100$

รัศมีค้นหา $\theta = \min(400, \max(150, 3a))$ กม.
<!-- src: scripts/rk.mjs:30-54, 137 -->

**kriging แบบไม่มีรอยต่อ** การบังคับให้มีสถานีอย่างน้อย 3 แห่งในรัศมีเคยทำให้เกิดวงแหวนบนแผนที่ (พ.ย. 2026) โค้ดจึงใช้ Wendland taper (Furrer et al., 2006 ตามที่โค้ดอ้าง)

$$
T(h) = \left(1-\frac{h}{\theta}\right)^4\left(1+\frac{4h}{\theta}\right)\ (h<\theta),\qquad
\Lambda(\mathbf{x}) = \frac{\sum_i T(d_i)\,r_i}{\sum_i T(d_i) + \kappa_L}
$$
(A.38)

$$
\hat r(\mathbf{x}) = \Lambda(\mathbf{x}) + \sum_{i\in\mathcal N_K} \lambda_i\left[r_i - \Lambda(\mathbf{x}_i)\right],\qquad C(h) = c_1 e^{-h/a}\,T(h)
$$
(A.39)

- $\lambda_i$ มาจาก simple kriging ด้วยความแปรปรวนร่วม $C(h)$ ของสถานีที่ใกล้ที่สุด $K$ = 16 แห่ง (เส้นทแยงมุม $=(c_0+c_1)(1+10^{-6})$)
- $\kappa_L$ = `KRIGE.kappa` = 1 ดึง local mean เข้าหา 0 เมื่อมีสถานีใกล้น้อย
- ค่าที่กริดถูกจางแบบเชิงเส้น จาก 1 ที่ $\theta/2$ ถึง 0 ที่ $\theta$ จากสถานีที่ใกล้ที่สุด พื้นที่ห่างไกลจึงเหลือเฉพาะส่วนถดถอย

<!-- src: scripts/rk.mjs:57-93, 139, 159-164 -->

**สนามไบแอส** บนกริด 0.025° ณ ชั่วโมง analysis $t_{rk}$ ($\tilde{\mathbf x}$ คือ predictor หลังการจำกัดช่วง)

$$
B(\mathbf{x}) = \operatorname{clip}\!\left(\hat\beta_0 + \hat{\boldsymbol\beta}^\top\tilde{\mathbf{x}} - \ln(\bar C_{24}+1) + \hat r(\mathbf{x}),\ \pm\ln 3\right)
$$
(A.40)

หน้าเว็บนำ $B$ ไปใช้กับ CAMS รายชั่วโมง (รวม increment ถ้าเปิด assimilation) โดยจางตามเวลา

$$
c^{RK}(\mathbf{x},t) = \max\!\left(0,\ (c+1)\exp\!\left[e^{-\max(0,\,t-t_{rk})/\tau_b}\,B(\mathbf{x})\right] - 1\right)
$$
(A.41)

<!-- src: scripts/update.mjs:1106-1128; index.html:2165-2169 -->

**ความไม่แน่นอน** ในหน่วย log ของแผนที่คือ

$$
\sigma^2(\mathbf{x}) = \sigma^2_{\text{res}}(\mathbf{x}) + \max\!\left(0,\ \frac{s^2}{n} + (\tilde{\mathbf{x}}-\bar{\mathbf{x}})^\top\,\widehat{\operatorname{Cov}}(\hat{\boldsymbol\beta})\,(\tilde{\mathbf{x}}-\bar{\mathbf{x}})\right)
$$
(A.42)

$\sigma^2_{\text{res}} = \text{sill} - (2f - f^2)(\text{sill}-\sigma^2_{SK})$ คือความแปรปรวนของ residual ที่ถูกจางด้วย $f$
<!-- src: scripts/rk.mjs:124-144; scripts/update.mjs:1126-1127 -->

**การตรวจแบบ leave-one-out** fit การถดถอยและ variogram ใหม่โดยไม่มีจุดที่เว้นออก แล้วทำนายจุดนั้นเหมือนเป็นจุดกริด (จำกัดช่วงแล้ว) รายงานผลดังนี้
- RMSE ทั้งหมด
- RMSE ที่ถ่วงด้วย declustering
- RMSE แยกตามพื้นที่ (กรุงเทพฯ, ภาคเหนือตอนบน, ส่วนอื่นของไทย, นอกไทย)
- RMSE แยกตามชนิดข้อมูลเข้า (อ้างอิง/ราคาประหยัด)
- สัดส่วนที่ตกในช่วง ±1σ

ค่าทุกจุดถูก log ใน `map-*.csv`
<!-- src: scripts/rk.mjs:145-158; scripts/update.mjs:1088-1105, 1196-1199 -->

**ตารางที่ A3.10** ค่าตั้ง `CFG.rk`

| พารามิเตอร์ | ค่า | ความหมาย |
|---|---|---|
| `residStep` | 0.025° | กริดของสนามไบแอส (`rk-bias*.json`) |
| `coarseStep` | 0.1° | สำเนาใน `latest.json` พร้อม σ |
| `demStep` | 0.05° | DEM ที่ใช้เป็น predictor |
| `minStations` | 15 | ข้อมูลเข้าขั้นต่ำ |
| `K` | 16 | จำนวนสถานีใกล้สุดใน kriging |
| `declusterDeg` | 0.25° | ขนาดเซลล์ declustering |
| `lowcost` | `LOWCOST` (หัวข้อ 2.4.4) | เซนเซอร์ราคาประหยัด |
| `maxLogCorr` | ln 3 (ค่าตั้งต้น) | ขอบเขตของ $B$ |
| `minPerPredictor` | 10 | จำนวนจุดต่อสัมประสิทธิ์ |
| `KRIGE.kappa` | 1 | การดึง local mean |

<!-- src: scripts/update.mjs:63; scripts/rk.mjs:65, 115 -->
ความเห็นในโค้ดอ้างผล hindcast 2024–26 ว่า leave-one-out RMSE ที่สถานีอ้างอิงลดจาก 10.9 เป็น 10.6 µg/m³ และที่เซนเซอร์ราคาประหยัดลดจาก 23.5 เป็น 19.3 µg/m³ เมื่อเทียบกับการใช้เฉพาะสถานีอ้างอิงบนกริด 0.1°
ผลนี้ต้องตรวจซ้ำในภาค B
<!-- src: scripts/update.mjs:61-62 -->

**สนามปรับแก้ ML บนแผนที่ (`CFG.mlField`)**
ที่สถานีอ้างอิงที่มีทั้ง $F^{ML}$ และ $F^A$ ระบบคำนวณค่าปรับแก้ log ที่ ML เรียนได้ แล้ว krige ลงกริด 0.1° ด้วย `krigeField` (K = 16, declustering 0.25°)
- ทำทุก 3 ชม. ของ lead ตั้งแต่ 3 ถึง `MLCFG.applyMaxLeadH` = 24 ชม.
- สนามจางเป็น 0 เมื่อห่างจากสถานี
- จำกัดไว้ที่ $\pm\ln 2$
- หน้าเว็บประมาณเชิงเส้นตาม lead และไล่ค่าจาก 0 ณ เวลาปัจจุบันถึงสนามแรก

$$
\hat r^{ML}_{s}(L) = \ln\frac{F^{ML}_s(L)+1}{F^{A}_s(L)+1},\qquad
c^{\text{map}} = \left(c^{RK}+1\right)e^{\hat r^{ML}(\mathbf{x},L)} - 1
$$
(A.43)

<!-- src: scripts/update.mjs:64, 1013-1036; scripts/rk.mjs:170-188; index.html:2152-2158, 2863-2864 -->

### 3.3.4 ML v1: ensemble ของผู้เชี่ยวชาญแบบเรียนรู้ออนไลน์ (`ml.mjs`, `mlcore.mjs`)

**เป้าหมาย** คือความคลาดเคลื่อนที่เหลือหลังห่วงโซ่ (CAMS + assimilation + Kalman) ในหน่วย log ที่สถานีรายชั่วโมง (`obs_basis = 'h'`)

$$
y = \ln(o+1) - \ln(F^{A}+1)
$$
(A.44)

<!-- src: scripts/ml.mjs:4-5, 117, 127 -->

ข้อมูลฝึกคือแถวของ `fcst-*.csv` ย้อนหลัง 36 วันที่จับคู่กับค่าวัด ได้แก่
- สถานีอ้างอิงรายชั่วโมงทั้งหมด
- เซนเซอร์ราคาประหยัดที่ผ่านการตรวจ แบบสุ่ม 1 ใน `LC_SAMPLE` = 8 ของเซนเซอร์-วัน

<!-- src: scripts/update.mjs:938; scripts/ml.mjs:101-128 -->
การเรียนรู้รายวันทำหลัง 04:00 น. เวลาไทย กับวันที่ตรวจได้ล่าสุด (เมื่อวาน)
<!-- src: scripts/update.mjs:931-947 -->

**ตารางที่ A3.11** ตัวแปรของ ML v1 (`NAMES`) ทุกตัวเป็นค่าที่รู้ ณ เวลาออกพยากรณ์

| ตัวแปร | นิยาม |
|---|---|
| `lead` | lead (ชม.) |
| `lnF`, `lnCams` | $\ln_1(F^A)$, $\ln_1(C)$ |
| `lnInc` | $\operatorname{sign}(\Delta c)\,\ln_1|\Delta c|$ (increment ของ assimilation) |
| `lnFire` | $\ln_1$(ควันไฟ prior) |
| `lnBlh` | $\ln(\max(50,\text{BLH})/1000)$ (ค่าตั้งต้น 500 ม.) |
| `ws`, `pr` | ลม 100 ม. (m/s), ฝน (mm/h) |
| `lnObsLast`, `lnObs24` | $\ln_1$(ค่าวัดล่าสุด), $\ln_1$(ค่าเฉลี่ย 24 ชม. ที่ valid) |
| `kfAb` | ไบแอสของ `kfA` |
| `hsin`, `hcos`, `dsin`, `dcos` | วงจรรายวันและรายปี (ชั่วโมงไทย, วันของปี/365.25) |
| `lat`, `lon` | ตำแหน่ง |
| `t2`, `rh`, `ws10`, `wdsin`, `wdcos` | ECMWF ณ ชั่วโมงที่พยากรณ์ (ทิศลม 100 ม.) |
| `oT2`, `oRh`, `oWs`, `oWdsin`, `oWdcos` | ลมฟ้าอากาศที่วัดได้ที่สถานี Air4Thai ณ เวลาออก (อายุ ≤ 6 ชม.) |
| `dT2`, `dRh`, `dWs` | พยากรณ์ − ค่าวัด |

<!-- src: scripts/ml.mjs:77-89; scripts/update.mjs:471-474, 971-980 -->

**ผู้เชี่ยวชาญ (experts)** แต่ละตัวทำนาย $\hat y_e$

| ผู้เชี่ยวชาญ | แบบจำลอง | หน้าต่างข้อมูล | เริ่มใช้เมื่อ |
|---|---|---|---|
| `base` | $\hat y = 0$ (ห่วงโซ่ตามที่เป็น) | – | เสมอ |
| `day` | ค่าเฉลี่ย residual ตาม lead class × ช่วง 6 ชม. ของวัน หดด้วย $n/(n+20)$ (A.45) | 3 วัน | ≥ 1 วันที่ตรวจได้ และ ≥ 300 แถว |
| `week` | ridge regression บนตัวแปรมาตรฐาน (A.46) | 7 วัน | ≥ 7 วัน |
| `month` | gradient-boosted regression trees (A.47) | 30 วัน | ≥ 30 วัน |
| `season` | gradient-boosted trees ของฤดูปัจจุบันจนถึงวันนี้ รวมกับฤดูเดียวกันของปีก่อน จากคลัง `mltrain` | ฤดูของกรมอุตุฯ | ≥ 30 วันในคลัง |
| `hindcast` | gradient-boosted trees ที่ฝึกครั้งเดียวจาก CAMS hindcast (หัวข้อ 3.3.6) ไม่ฝึกใหม่ | ฝึกออฟไลน์ | รอบ CAMS, 18 ธ.ค.–30 เม.ย. |

<!-- src: scripts/ml.mjs:6-16, 31-36, 132-153, 219-228 -->

lead class คือ $\{L\le3,\ L\le6,\ L\le12,\ L\le24,\ L>24\}$ และช่วงของวันคือ $\lfloor h/6\rfloor$

$$
\hat y_{\text{day}}(c) = \bar y_c\,\frac{n_c}{n_c + k_s},\qquad k_s = 20
$$
(A.45)

$$
\hat{\boldsymbol\beta}_{\text{week}} = \left(\mathbf Z^\top\mathbf Z + \lambda\,\mathbf I'\right)^{-1}\mathbf Z^\top\mathbf y,\qquad \lambda = 3n/100
$$
(A.46)

$\mathbf Z$ คือตัวแปรที่ standardize แล้ว และแทนค่าที่ขาดด้วยค่าเฉลี่ย $\mathbf I'$ คือ identity ที่ไม่ลงโทษ intercept
<!-- src: scripts/ml.mjs:132-153 -->

gradient-boosted trees ใช้ squared loss และแบ่งค่าตาม bin ของ quantile
ค่าที่ขาด (NaN) ไปอยู่ bin 0 คือกิ่งซ้าย
สำหรับ node ที่มีผลรวม residual $G$ และจำนวนแถว $n$

$$
v_{\text{leaf}} = \eta_{\text{lr}}\frac{G}{n+\lambda_g},\qquad
\text{gain} = \frac{G_L^2}{n_L+\lambda_g} + \frac{G_R^2}{n_R+\lambda_g} - \frac{G^2}{n+\lambda_g}
$$
(A.47)

<!-- src: scripts/ml.mjs:155-195 -->

**ตารางที่ A3.12** ค่าตั้ง `MLCFG` ของ ML v1

| พารามิเตอร์ | ค่า |
|---|---|
| `applyMaxLeadH` | 24 ชม. (ใช้เฉพาะ lead ≤ 24 ชม. เพราะใน hindcast 2024–26 ช่วยที่ 24 ชม. แต่ไม่ช่วยที่ 48 ชม.) |
| `maxLeadH` | 48 ชม. (lead สูงสุดที่ log และฝึก) |
| `windows` (day/week/month) | 3 / 7 / 30 วัน |
| `minDays` (day/week/month) | 1 / 7 / 30 วัน |
| `shrinkK` | 20 |
| `ridgeLambda` | 3 (ใช้เป็น $3n/100$) |
| `gbm` | nTrees 150, depth 3, lr 0.08, minLeaf 40, bins 32, subsample 0.8, λ 1, maxRows 120,000 |
| `eta` ($\eta$) | 2 |
| `share` ($\alpha$) | 0.05 |
| `clip` | ln 2 |
| `minRowsDay` | 300 |
| `STORE` | ≤ 8,000 แถว/วัน, เก็บ 730 วัน, ฤดูต้องมี ≥ 30 วัน |

<!-- src: scripts/ml.mjs:31-36, 46 -->

**การถ่วงน้ำหนัก** ใช้ exponentially weighted average forecaster with fixed share (Littlestone & Warmuth, 1994; Herbster & Warmuth, 1998 ตามที่โค้ดอ้าง)
ทุกวัน ระบบให้คะแนนผู้เชี่ยวชาญแต่ละตัวบนวันที่ตรวจได้ล่าสุดด้วย**แบบจำลองที่มีอยู่ก่อนวันนั้น** (out of sample)
ต้องมีแถวทดสอบอย่างน้อย 50 แถว

$$
\mathcal L_e = \frac{1}{N}\sum_{k}\left(y_k - \operatorname{clip}(\hat y_{e,k},\pm\ln2)\right)^2,\qquad
\tilde w_e = w_e\exp\!\left(-\frac{\eta\,\mathcal L_e}{\max(\mathcal L_{\text{base}},10^{-3})}\right)
$$
(A.48)

$$
w_e \leftarrow (1-\alpha)\frac{\tilde w_e}{\sum_{e'}\tilde w_{e'}} + \frac{\alpha}{|\mathcal E_{\text{active}}|}
$$
(A.49)

<!-- src: scripts/ml.mjs:17-21, 206-218 -->

- loss ถูกหารด้วย loss ของ `base` ทำให้ $\eta$ ไม่ขึ้นกับระดับความคลาดเคลื่อนของแต่ละวัน
- ผู้เชี่ยวชาญใหม่เข้ามาด้วยน้ำหนัก 0 และได้ส่วนแบ่ง fixed share ในวันถัดไป
- ผู้เชี่ยวชาญที่ฝึกใหม่ไม่ได้ในวันนั้น เช่น หลังข้อมูลขาด ใช้แบบจำลองเดิมต่อ
- มี `base` อยู่เสมอ ensemble จึงกลับไปหาห่วงโซ่เดิมได้เองเมื่อผู้เชี่ยวชาญอื่นหยุดช่วย

<!-- src: scripts/ml.mjs:17-21, 227-230 -->

**การปรับแก้** ใช้เฉพาะสถานีรายชั่วโมง (ไม่ใช่สถานีชนิด `24`) ที่ $1 \le L \le 24$ ชม.
และใช้เฉพาะเมื่อมีผู้เชี่ยวชาญที่ไม่ใช่ `base` ได้น้ำหนัก > 0 (`mlActive`)

$$
\hat r = \operatorname{clip}\!\left(\sum_{e\neq\text{base}} w_e\,\hat y_e,\ \pm\ln 2\right),\qquad
F^{ML} = \max\!\left(0,\ (F^{A}+1)e^{\hat r} - 1\right)
$$
(A.50)

<!-- src: scripts/ml.mjs:237-244; scripts/update.mjs:996-1003 -->
ค่าเฉลี่ย 24 ชม. ของ ML (`fc24M`) คำนวณใหม่ด้วย A.34 บนอนุกรม $F^{ML}$ (หรือ $F^{v2}$ ถ้าเผยแพร่ v2)
<!-- src: scripts/update.mjs:1004-1010 -->

### 3.3.5 ML v2 (`ml2.mjs`) และประตู `pmHighCheck`

**ที่มา** การวิเคราะห์ log วันที่ 1 ต.ค.–16 พ.ย. 2026 (47 วัน, 362,381 คู่ทดสอบ, 106 สถานีอ้างอิงรายชั่วโมง, `analysis/highpm_replay.py`) พบว่าพยากรณ์ชั่วโมงที่ ≥ 37.5 µg/m³ ต่ำเกินมาก ค่าวัด 50 แต่หน้าเว็บให้ 30 ที่ 24 ชม.
<!-- src: scripts/ml2.mjs:4-11 -->
สาเหตุมีสองข้อ
1. เป้าหมายบน $\ln(o+1)$ ให้ค่ามัธยฐาน (median) ไม่ใช่ค่าเฉลี่ย จึงดึงค่าสูงลง
2. ข้อมูลเข้าไม่มีพฤติกรรมเฉพาะของสถานี ยอดเกิดซ้ำที่สถานีเดิมในเวลาเดิม ครึ่งหนึ่งของเหตุการณ์ยาวไม่เกิน 2 ชม. ส่วนใหญ่ 19:00–01:00 น. และ 62 % เกิดที่ 10 สถานี

ตัวเลขของ replay (RMSE 8.29 → 6.98, ชั่วโมงสูงที่จับได้ 432 → 656 จาก 2,239) มาจากความเห็นในโค้ด และต้องตรวจซ้ำในภาค B

**วิธีการ** v2 ใช้ engine เดียวกับ ML v1 (`mlcore.mjs`) แต่ต่างกันดังนี้

$$
y^{(2)} = \operatorname{clip}\left(o - F^{A},\ \pm 60\ \mu\text{g m}^{-3}\right),\qquad
F^{v2} = \max\!\left(0,\ F^{A} + \operatorname{clip}\Big(\sum_{e\ne\text{base}} w_e\hat y^{(2)}_e,\ \pm60\Big)\right)
$$
(A.51)

<!-- src: scripts/ml2.mjs:13-17, 24, 84-95; scripts/mlcore.mjs:83, 111-115 -->

ข้อมูลเข้าของ v2 คือ `NAMES` (30 ตัว) รวมกับ `HIST_NAMES` (7 ตัว) ซึ่งเป็นประวัติของสถานีที่รู้ ณ เวลาออกพยากรณ์
ใช้เฉพาะชั่วโมงที่จบไม่ช้ากว่า $t_{\text{issue}} - 1$ ชม. ($t_{\text{cut}}$)

| ตัวแปร | นิยาม (ทุกตัวเป็น $\ln_1$) |
|---|---|
| `lnOSame` | ค่าที่ชั่วโมงเดียวกันของวันล่าสุดที่รู้, $t_S = t_v - 24k$, $k=\max(1,\lceil (t_v-t_{\text{cut}})/24\,\text{h}\rceil)$ |
| `lnOSame2` | ค่าของวันก่อนหน้านั้น ($t_S - 24$ ชม.) |
| `lnMax24` | ค่าสูงสุดของ 24 ชม. ล่าสุด (≥ 12 ค่า) |
| `lnP90_72` | เปอร์เซ็นไทล์ที่ 90 ของ 72 ชม. ล่าสุด (≥ 36 ค่า) |
| `lnClimH` | ค่าเฉลี่ยของชั่วโมงเดียวกันใน 7 วันก่อนวัน $t_S$ (≥ 3 ค่า) |
| `lnClimMH`, `lnP90MH` | ค่าเฉลี่ยและ p90 หลายปีของสถานีในเดือนและชั่วโมงของ $t_v$ (`pm-clim.json`, A.7) |

<!-- src: scripts/ml2.mjs:25-36, 65-81 -->

**ตารางที่ A3.13** ค่าตั้งของ v2

| พารามิเตอร์ | ค่า |
|---|---|
| `ML2.clip` | 60 µg/m³ |
| `ML2.maxLeadH` | 24 ชม. |
| `ML2.thr` | 37.5 µg/m³ |
| `ML2.checkDays` | 14 วัน |
| `ML2.minRows` / `minHigh` | 20,000 / 100 |
| `ML2.obsDays` | 10 วัน (ประวัติค่าวัดสำหรับ histFeatures) |
| `CFG2.minDays` (day/week/month) | 1 / 7 / 10 วัน |
| `CFG2.gbm` | nTrees 200, depth 5, minLeaf 60 (ค่าอื่นเหมือน `CORECFG`) |
| `CFG2.minRowsDay` | 300 |
| ผู้เชี่ยวชาญ | `base`, `day`, `week`, `month` (ไม่ส่ง season rows ให้ v2) |

<!-- src: scripts/ml2.mjs:24, 37-40; scripts/mlcore.mjs:11-14; scripts/update.mjs:953 -->

ถ้ารายการตัวแปรของ v2 เปลี่ยน (`state.ml2.nFeat` ≠ จำนวนตัวแปร) การเรียนรู้จะเริ่มใหม่ และประตูนับเฉพาะแถวที่ออกหลัง `state.ml2.since`
<!-- src: scripts/update.mjs:382 -->

**ประตู `pmHighCheck`** เปรียบเทียบ $F^{v2}$ (`correctedML2`) กับ ML v1 (`correctedML1`; แถวเก่าใช้ `correctedML` หรือ `correctedA`)
ใช้แถวเดียวกันของ 14 วันล่าสุด ที่สถานีอ้างอิงรายชั่วโมง lead ≤ 24 ชม.
กำหนด $\theta = 37.5$ µg/m³

$$
\text{hit}_j = \#\{o\ge\theta \wedge F_j\ge\theta\},\qquad
\text{FA}_j = \frac{\#\{F_j\ge\theta\} - \text{hit}_j}{\max(1,\#\{F_j\ge\theta\})},\qquad
\text{RMSE}_j = \sqrt{\overline{(F_j-o)^2}}
$$
(A.52)

$$
\text{v2 เผยแพร่} \iff n\ge20\,000 \;\wedge\; \#\{o\ge\theta\}\ge100 \;\wedge\; \text{hit}_2\ge\text{hit}_1 \;\wedge\; \text{FA}_2\le\text{FA}_1 \;\wedge\; \text{RMSE}_2\le\text{RMSE}_1
$$
(A.53)

<!-- src: scripts/ml2.mjs:97-120; scripts/update.mjs:954-956, 991 -->

**สถานะ** v2 คำนวณและบันทึกทุกชั่วโมงที่สถานีรายชั่วโมงเมื่อมีผู้เชี่ยวชาญที่ได้น้ำหนัก
แต่ v2 จะแทน v1 ในอนุกรมที่เผยแพร่ (`correctedML`, `corrM`) **เฉพาะเมื่อ ML เปิดอยู่และ `state.ml2.check.ok === true`**
ถ้าประตูไม่ผ่าน v1 จะกลับมาเอง
ห้ามเปิด v2 ด้วยมือหรือผ่อนเกณฑ์ของประตู
ผลการตัดสินในแต่ละวันอยู่ใน state และใน `ml-YYYYMMDD.json` ไม่ได้กำหนดในโค้ด
<!-- src: scripts/update.mjs:983-993, 1003; CLAUDE.md (Working notes) -->

### 3.3.6 ผู้เชี่ยวชาญ hindcast (`hindcast.mjs`, `hindcast_train.mjs`)

ผู้เชี่ยวชาญ hindcast ทำให้ ensemble รู้จักฤดูเผาไหม้ก่อนที่ระบบจะผ่านฤดูนั้นด้วย log ของตัวเอง
แบบจำลองเป็น gradient-boosted trees ที่ฝึกครั้งเดียวแบบออฟไลน์
- ข้อมูลฝึกคือพยากรณ์ CAMS ที่เก็บถาวร (Copernicus ADS) คู่กับค่าเฉลี่ย 24 ชม. ของ Air4Thai (ผ่าน OpenAQ)
- ช่วงข้อมูลคือ 18 ธ.ค.–30 เม.ย. ของฤดู 2023/24, 2024/25 และ 2025/26 (branch `hindcast`, `data/hindcast/cams_obs_3h_<Y>.csv.gz`)
- ไฟล์โมเดลคือ `data/static/hc-model.json`

<!-- src: scripts/hindcast.mjs:1-12; scripts/hindcast_train.mjs:1-8 -->

ตัวแปรเข้า (`HC_NAMES`) คือ `lead`, `lnCams`, `lnCams24`, `lnObs24`, `hsin`, `hcos`, `dsin`, `dcos`, `lat`, `lon`

$$
\hat y_{hc} = f_{hc}(\mathbf{x}) \approx \ln(\bar o_{24}+1) - \ln(\bar C_{24}+1),\qquad
B = (C+1)e^{\hat y_{hc}} - 1,\qquad
\hat r_{hc} = \ln(B+1) - \ln(F^{A}+1)
$$
(A.54)

$\hat r_{hc}$ อยู่บนเป้าหมายเดียวกับผู้เชี่ยวชาญอื่น (A.44) และคงรูปการขึ้นลงรายชั่วโมงของ CAMS ไว้
ผู้เชี่ยวชาญนี้ให้ 0 ในสองกรณี
- นอกช่วง 18 ธ.ค.–30 เม.ย. (วันที่ไทย, `HC.fromMD` = 1218, `HC.toMD` = 430)
- เมื่อไม่มีค่าเฉลี่ย 24 ชม. ของ CAMS

<!-- src: scripts/hindcast.mjs:13-34 -->

การฝึกจำลองสภาพปฏิบัติการดังนี้
- ใช้ lead $L$ = 21…72 ชม. ทุก 3 ชม. เฉพาะที่มีค่า 3 ชั่วโมงครบ 8 ค่า (ค่าเฉลี่ย 24 ชม. ของ CAMS)
- ถือว่ารอบมาถึงหลังเวลาฐาน 12 ชม. (`delayH`) จึงใช้ lead $L-12$ และใช้ค่าเฉลี่ย 24 ชม. ที่วัดได้ ณ เวลาฐาน + 12 ชม.
- ใช้เฉพาะสถานีอ้างอิงที่เป็นค่าเฉลี่ยเคลื่อนที่ 24 ชม. และไม่ตก site check

ระบบทดสอบแบบเว้นทีละฤดู (leave-one-season-out) ก่อน แล้วฝึกแบบจำลองสุดท้ายบนทั้งสามฤดู
<!-- src: scripts/hindcast_train.mjs:1-8, 14-15, 174-191, 198-222 -->

**ตารางที่ A3.14** ค่าตั้ง `HCFIT` และผลการทดสอบเว้นทีละฤดูที่ lead 48 ชม. ซึ่งบันทึกอยู่ในไฟล์โมเดล (ค่าเฉลี่ย 24 ชม.; caught = จำนวนกรณีที่ ≥ 37.5 µg/m³ ที่จับได้; FA = สัดส่วน false alarm)

| ค่าตั้ง | ค่า |
|---|---|
| seasons | 2024, 2025, 2026 (ปีที่ฤดูสิ้นสุด) |
| gbm | nTrees 300, depth 4, lr 0.06, minLeaf 200, bins 32, subsample 0.8, λ 1, maxRows 400,000 |
| `thr` / `delayH` | 37.5 µg/m³ / 12 ชม. |
| จำนวนแถวที่ใช้ฝึก | 1,309,587 (ฝึกเมื่อ 2026-11-21) |

| ฤดูที่ทดสอบ | CAMS RMSE / caught / FA | persistence RMSE / caught / FA | hindcast RMSE / caught / FA | ชั่วโมงสูงทั้งหมด |
|---|---|---|---|---|
| 2024 | 25.35 / 1,178 / 0.293 | 13.63 / 3,377 / 0.275 | 14.15 / 2,808 / 0.175 | 4,590 |
| 2025 | 17.22 / 4,379 / 0.391 | 15.34 / 5,643 / 0.360 | 13.89 / 5,270 / 0.292 | 8,545 |
| 2026 | 20.05 / 3,033 / 0.418 | 12.70 / 5,040 / 0.412 | 14.25 / 5,567 / 0.341 | 8,338 |

<!-- src: scripts/hindcast_train.mjs:14-15; data/static/hc-model.json (version, trained, rows, cv[*]["48"]) -->

ผู้เชี่ยวชาญนี้โหลดเฉพาะรอบ CAMS และไม่เคยใช้กับ SILAM
แบบจำลองคงที่และไม่ถูกฝึกใหม่ น้ำหนักตัดสินจากคะแนนรายวันเหมือนผู้เชี่ยวชาญอื่น (A.48–A.49) ห้ามให้น้ำหนักด้วยมือ
ต้องคงประกาศลิขสิทธิ์ของ Copernicus สำหรับข้อมูล hindcast ไว้
<!-- src: scripts/update.mjs:380-381; scripts/ml.mjs:26-29, 208; CLAUDE.md (Working notes) -->

### 3.3.7 Climatology blend (`climatology.mjs`, `fit_clim_blend.mjs`) ที่ยังปิดอยู่

ทักษะของพยากรณ์ลดลงตาม lead ระบบจึงเตรียมการดึงพยากรณ์ระยะยาวเข้าหา climatology ของสถานี $\mu_{s,c}$ (A.7)

$$
\ln(B+1) = (1-w_L)\ln(F+1) + w_L\ln(\mu_{s,c}+1)
$$
(A.55)

<!-- src: scripts/update.mjs:66-70; scripts/fit_clim_blend.mjs:1-6, 17 -->

**การ fit** `fit_clim_blend.mjs` ลอง $w \in \{0, 0.05, \dots, 1\}$ ทีละ lead
$w$ จะเป็นบวกได้เฉพาะเมื่อเป็นไปตามเงื่อนไขทั้งหมดนี้ เมื่อเทียบกับ $w=0$
1. ลด RMSE ได้
2. จับชั่วโมง ≥ 37.5 µg/m³ ได้ไม่น้อยกว่า
3. สัดส่วน false alarm ไม่มากกว่า
4. มี ≥ 2,000 แถว และมีชั่วโมงสูง ≥ 50 ชั่วโมง

<!-- src: scripts/fit_clim_blend.mjs:5-7, 14-28 -->

| ค่าตั้ง | ค่า |
|---|---|
| `FIT.thr` | 37.5 µg/m³ |
| `FIT.minRows` | 2,000 |
| `FIT.minHigh` | 50 |
| `FIT.step` | 0.05 |
| `CFG.climBlend.cams` | [[24, 0], [48, 0], [72, 0], [96, 0]] |
| `CFG.climBlend.silam` | [[24, 0], [48, 0], [72, 0], [96, 0], [120, 0]] |
| `CFG.climLogLeads` | 24, 36, 48, 60, 72, 84, 96, 108, 120 ชม. |

<!-- src: scripts/fit_clim_blend.mjs:14; scripts/update.mjs:70-71 -->

**สถานะ: ปิดอยู่**
- น้ำหนักทุก lead เป็นศูนย์ จนกว่าจะรัน fit บน log `climfc-*.csv` ประมาณ 2 สัปดาห์ (CAMS ใน `data/history`, SILAM ใน `data/history/silam`) และนำค่าที่ fit พิมพ์ออกมาใส่โดยไม่แก้
- ปัจจุบัน `update.mjs` **ไม่มีโค้ดที่นำ A.55 ไปใช้** มีเพียงการ log พยากรณ์ที่เผยแพร่ $F$, CAMS ดิบ, $\mu$ และ p90 ทุก 3 ชม. ที่สถานีอ้างอิงรายชั่วโมง
- README ระบุว่าการนำน้ำหนักไปใช้กับสถานีและแผนที่จะเพิ่มเมื่อ fit ได้ค่าที่ไม่เป็นศูนย์

<!-- src: scripts/update.mjs:1213-1222; README.md (Pull of long-lead forecasts); CLAUDE.md rule 5 -->

### 3.3.8 Nowcast ระยะสั้น (`pmnow.mjs`) และประตู 14 วัน

ความคลาดเคลื่อน ณ ปัจจุบัน คือ log ratio ระหว่างชั่วโมงล่าสุดที่วัดได้ของสถานี Air4Thai รายชั่วโมง $(t^*, o^*)$ กับค่าที่**รอบก่อนหน้า**พยากรณ์ไว้สำหรับชั่วโมงนั้น $f^*$ (`state.pmNowFc`)

$$
e = \operatorname{clip}\left(\ln(o^*+1) - \ln(f^*+1),\ \pm e_{\max}\right),\qquad \text{now} - t^* \le 3\ \text{ชม.}
$$
(A.56)

$$
F^{NC}(L) = \begin{cases}\max\!\left(0,\ (F(L)+1)\exp\!\left[e\,e^{-L/\tau}\right]-1\right) & 0 < L \le L_{\max}\\ F(L) & L > L_{\max}\end{cases}
$$
(A.57)

<!-- src: scripts/pmnow.mjs:1-6, 15-31 -->

- $F$ คืออนุกรมที่จะเผยแพร่ (`corrM` ถ้าไม่มีใช้ `corrA` ถ้าไม่มีใช้ `corr`)
- รูปการขึ้นลงของพยากรณ์ เช่น วงจรรายวันและแนวปะทะ ยังคงอยู่ มีเพียงระดับใกล้ปัจจุบันที่เลื่อน
- ทุกรอบเก็บพยากรณ์ของ 6 ชม. ถัดไปไว้ให้รอบต่อไปเปรียบเทียบ และลบค่าที่เก่ากว่า 12 ชม.
- แผนที่ไม่เปลี่ยน
- ค่าเฉลี่ย 24 ชม. (`fc24M`) คำนวณก่อนขั้นนี้ จึงไม่รวมผลของ nowcast

<!-- src: scripts/update.mjs:1038-1049; scripts/pmnow.mjs:32-37 -->

| พารามิเตอร์ | ชื่อ | ค่า | หน่วย |
|---|---|---|---|
| ค่าคงที่การจาง | `tauH` ($\tau$) | 2 | ชม. |
| lead สูงสุด | `maxLeadH` ($L_{\max}$) | 6 | ชม. |
| ขอบเขตของ $e$ | `maxErr` ($e_{\max}$) | 1.5 | log |
| อายุสูงสุดของค่าวัด | `maxAgeH` | 3 | ชม. |
| หน้าต่างของประตู | `checkDays` | 14 | วัน |
| อายุของพยากรณ์ที่เก็บไว้ | `keepH` | 12 | ชม. |

<!-- src: scripts/pmnow.mjs:15 -->

ความเห็นในโค้ดระบุว่าเลือก $\tau$ = 2 ชม. จากการทดสอบกับ Air4Thai รายชั่วโมง (ปรับบน 2–15 พ.ย. 2026 และทดสอบบน 16–27 พ.ย. 2026)
ส่วนการตัดที่ 6 ชม. มาจาก hindcast ฤดู 2026 ที่ 9–12 ชม. แย่ลงเล็กน้อย
ตัวเลขของการทดสอบเหล่านั้นต้องตรวจซ้ำในภาค B
<!-- src: scripts/pmnow.mjs:7-13 -->

**ประตู `pmNowCheck`** ใช้แถวของสถานีอ้างอิงรายชั่วโมงที่ lead ≤ 6 ชม. ใน 14 วันล่าสุด เปรียบเทียบ `correctedPre` (ก่อน nowcast) กับ `correctedNC` (หลัง nowcast) ด้วย A.52
log ที่เขียนก่อน 28 พ.ย. 2026 ไม่มีสองคอลัมน์นี้ ระบบจึงสร้างแถวขึ้นใหม่จากที่ log ไว้
- ค่าก่อน nowcast คือ `correctedML`
- ค่าหลัง nowcast คือค่านั้นเลื่อนด้วยความคลาดเคลื่อนของชั่วโมงที่จบที่ $t_{\text{issue}}-1$ ชม. เทียบกับพยากรณ์ lead 1 ของรอบ $t_{\text{issue}}-2$ ชม.

$$
\text{nowcast เผยแพร่} \iff \text{span}\ge 13\ \text{วัน} \wedge n\ge20\,000 \wedge \#\{o\ge37.5\}\ge50 \wedge \text{hit}_{NC}\ge\text{hit}_{\text{pre}} \wedge \text{FA}_{NC}\le\text{FA}_{\text{pre}} \wedge \text{RMSE}_{NC}\le\text{RMSE}_{\text{pre}}
$$
(A.58)

<!-- src: scripts/pmnow.mjs:38-64; scripts/update.mjs:960-967, 1042, 1047 -->

**สถานะ** nowcast คำนวณและบันทึกทุกชั่วโมง (`correctedPre`, `correctedNC`)
แต่จะแทนอนุกรมที่เผยแพร่**เฉพาะเมื่อ `state.pmNow.check.ok === true`** และสถานีนั้นมีค่า $e$
ประตูนี้คำนวณวันละครั้งภายในขั้นเรียนรู้รายวันของ ML ผลการตัดสินครั้งแรกต้องดูจาก state และ log ไม่ได้กำหนดในโค้ด

### 3.3.9 การประกอบค่าบนหน้าเว็บ

**ที่สถานี** หน้าเว็บใช้อนุกรมที่มีอยู่ตามลำดับ `corrM` → `corrA` → `corr` และค่าเฉลี่ย 24 ชม. ตามลำดับ `fc24M` → `fc24A` → `fc24` (เมื่อเปิด assimilation)

**ที่จุดใด ๆ บนแผนที่**

$$
c^{\text{page}}(\mathbf{x},t) = \left(\max\!\left(0,\ (C^{A}+1)\,e^{w(t)B(\mathbf{x})} - 1\right) + 1\right)e^{\hat r^{ML}(\mathbf{x},L)} - 1
$$
(A.59)

- $C^A$ คือ CAMS bilinear บวก increment ของควันไฟ
- $w(t) = e^{-\max(0,t-t_{rk})/48\,\text{h}}$

<!-- src: index.html:2159, 2165-2169, 2858-2864 -->

---

## 3.4 ฝน

### 3.4.1 ฝนพยากรณ์บนหน้าเว็บ: ECMWF open data 0.25°

`ecmwf_pr.py` อ่านฝนสะสม $P_{\text{acc}}$ ของรอบ 00/12 UTC แล้วแปลงเป็นอัตราเฉลี่ยของแต่ละช่วง $(t_0, t_1]$

$$
R_{(t_0,t_1]} = \frac{P_{\text{acc}}(t_1) - P_{\text{acc}}(t_0)}{t_1 - t_0}
$$
(A.60)

ช่วงละ 3 ชม. ถึง 144 ชม. และ 6 ชม. ถึง 168 ชม.
<!-- src: scripts/ecmwf_pr.py:2-15, 19-22 -->
หน้าเว็บลดขนาดฝนนี้ลงสู่ 0.025° ด้วยตัวคูณรูปแบบฝน CHELSA ของแต่ละเดือน ($\chi$ จาก `prclim.py`, ค่าที่เก็บ/50)
ในชั่วโมงอนาคต ฝนบนหน้าเว็บคือ

$$
R^{\text{page}} = \text{rainBlend}\!\left(\left(R^{E}\chi + 0.2\right)e^{c^{wx}} - 0.2\right)
$$
(A.61)

- $c^{wx}$ คือการปรับแก้ของ weather ML ซึ่งเป็น 0 เมื่อประตูไม่ผ่าน (หัวข้อ 3.5)
- rainBlend คือ A.67

<!-- src: index.html:2042-2061, 2071-2073 -->

ในชั่วโมงที่สังเกตแล้ว หน้าเว็บใช้เรดาร์ (ถ้าเรดาร์เห็นเซลล์นั้น) หรือฝนสังเกต 0.1° interpolate แบบ bilinear × $\chi$
<!-- src: index.html:2060, 2109-2115 -->
**ข้อสำคัญ** pipeline (แบบจำลองควัน, rain blend fit, weather ML) ยังใช้ฝน ECMWF จาก Open-Meteo น้ำหนักที่ fit ไว้จึงยังใช้ได้ ห้ามเปลี่ยนฝนของ pipeline เป็น open data โดยไม่ fit ใหม่
<!-- src: CLAUDE.md (Working notes); README.md (ECMWF rain at 0.25°) -->

### 3.4.2 เรดาร์ (`radar.mjs`)

ค่าสี Universal Blue ถูกแปลงกลับเป็น dBZ ด้วยตารางสีของ RainViewer แล้วแปลงเป็นอัตราฝนด้วยความสัมพันธ์ Marshall–Palmer (1948) ตามที่โค้ดอ้าง

$$
Z = 200\,R^{1.6}\ \Rightarrow\ R = \min\!\left(R_{\max},\ \left(\frac{10^{\text{dBZ}/10}}{200}\right)^{1/1.6}\right),\quad R = 0\ \text{เมื่อ dBZ} < 10
$$
(A.62)

<!-- src: scripts/radar.mjs:53-54 -->

**ตัวกรองสัญญาณรบกวน (despeckle)** เซลล์ที่มี echo ต้องมีเซลล์ echo ≥ 11 เซลล์ในบริเวณ 5 × 5 รอบตัว
วิธีนี้ตัดเส้นรัศมีจากสัญญาณรบกวนและจุดเดี่ยว
**พื้นที่ที่เรดาร์ครอบคลุม** คือ mask จาก API **และ** footprint ของ echo ซึ่งได้แก่เซลล์ที่อยู่ภายใน 4 เซลล์ (0.1°) จากเซลล์ที่เคยมี echo ≥ 0.1 mm/h ใน ≥ 2 ชั่วโมงที่ต่างกัน
เหตุผลคือ mask ของ API เพียงอย่างเดียวระบุว่าเห็น 98 % ของกรอบ (พ.ย. 2026) ทำให้ลาวตอนเหนือ กัมพูชา และทะเลถูกบันทึกว่าแห้ง
<!-- src: scripts/radar.mjs:15-19, 33-36, 115-136 -->

**การปรับด้วยมาตรวัด** แต่ละชั่วโมงต้องมีมาตรวัดอย่างน้อย 30 จุด ใช้เฉพาะคู่ที่เปียก (ทั้งสองค่า ≥ 0.1 mm) ในช่วง 7 วัน

$$
f_{\text{radar}} = \begin{cases}\operatorname{clip}\!\left(\dfrac{\sum G}{\sum R},\ 0.5,\ 2.5\right) & n_{\text{wet}} \ge 200\\ 1 & \text{กรณีอื่น}\end{cases}
$$
(A.63)

<!-- src: scripts/radar.mjs:209-225; scripts/update.mjs:607-613 -->
ฝนเรดาร์ที่ปรับแล้วแทนฝน ECMWF ใน met.json ในหน่วยความจำ ที่ node ที่เรดาร์เห็นอย่างน้อยครึ่งหนึ่งของเซลล์
การแทนทำหลังการแทนด้วย PARDIG/GSMaP เรดาร์จึงชนะภายในพื้นที่ครอบคลุม
<!-- src: scripts/radar.mjs:227-239; scripts/update.mjs:520-522, 604-614 -->

**Nowcast ของเรดาร์** (Lagrangian persistence) ทำดังนี้
1. หาการเคลื่อนที่ของ echo จาก 3 เฟรม 10 นาทีที่ต่อกัน ด้วย block cross-correlation บนบล็อก 40 เซลล์ (1°) ค้นหา ±8 เซลล์ต่อ 10 นาที
2. ใช้คู่เฟรม (1,2), (2,3) และ (1,3) โดยคู่ที่สามหารการเลื่อนด้วย 2
3. บล็อกต้องมีฝนรวม ≥ 5 mm/h·เซลล์ และสหสัมพันธ์ > 0.3
4. เฉลี่ยเวกเตอร์ 3 × 3 บล็อก
5. เลื่อนเฟรมล่าสุดทีละ 10 นาทีเป็นเวลา 3 ชม. (ใช้เซลล์ที่ใกล้ที่สุด) แล้วเฉลี่ยเป็นรายชั่วโมงตามนาฬิกา

<!-- src: scripts/radar.mjs:28, 241-284 -->

**ตารางที่ A3.15** ค่าตั้ง `RVCFG` ที่ใช้ในวิธีการ

| พารามิเตอร์ | ค่า |
|---|---|
| `z`, `size` | 6, 512 px (≈1.2 กม.) |
| `bbox`, `step` | [97, 5.5, 106, 21], 0.025° |
| `keepFramesH` / `keepHoursH` / `webH` | 3 / 72 / 24 ชม. |
| `minFrames` | 4 (จาก 6 ต่อชั่วโมง) |
| `nowLeadH`, `block`, `search` | 3 ชม., 40 เซลล์, ±8 เซลล์ |
| `minDbz`, `maxRate` | 10 dBZ, 100 mm/h |
| `despeckle` | r = 2, min = 11 |
| `echoRadius`, `echoMin`, `echoHours` | 4 เซลล์, 1 (0.1 mm/h), 2 ชม. |

<!-- src: scripts/radar.mjs:23-37 -->

### 3.4.3 การวินิจฉัย ECMWF เทียบกับเรดาร์

การวินิจฉัยนี้คล้าย Kalman filter ของ CAMS แต่ทำกับฝน
ระบบเทียบ ECMWF "ตามที่ออก" (met.json ก่อนผสมค่าสังเกต) กับเรดาร์ที่ปรับแล้ว บนโครงข่าย 0.25° ในช่วง 72 ชม. ล่าสุด ต้องมีอย่างน้อย 24 ชั่วโมงของเรดาร์

**เวลา (timing)** หาการเลื่อน $s^*$ ที่ให้สหสัมพันธ์ Pearson สูงสุด

$$
s^* = \arg\max_{s\in[-6,6]} r\!\left(E(t+s),\,R(t)\right)
$$
(A.64)

ใช้ $s^*$ เฉพาะเมื่อมี node-ชั่วโมงที่เปียก (เรดาร์ ≥ 0.5 mm/h) ≥ 200 และ $r(s^*) - r(0) \ge 0.02$ มิฉะนั้นใช้ 0
<!-- src: scripts/radar.mjs:296-327 -->

**ปริมาณ (amount)** ต่อ node

$$
\ell = \ln\frac{\sum R + 1}{\sum E + 1}\cdot\frac{n_w}{n_w + 10}
$$
(A.65)

- $n_w$ คือชั่วโมงที่ $R$ หรือ $E$ ≥ 0.2 mm
- ต้องมี ≥ 24 คู่
- เฉลี่ย 3 × 3 node
- จำกัดไว้ที่ $\pm\ln 4$

<!-- src: scripts/radar.mjs:303, 328-335 -->

**Persistence รายวัน** ของชั่วโมง $H$ คือเรดาร์ของชั่วโมงเดียวกันในวันล่าสุดที่สังเกตแล้ว

$$
R^{p}(H) = R\!\left(H - 24\,\text{h}\cdot\max\!\left(1,\left\lceil\frac{H-H_{\text{obs}}}{24\,\text{h}}\right\rceil\right)\right)
$$
(A.66)

<!-- src: scripts/radar.mjs:343-345 -->

### 3.4.4 Rain blend (`CFG.rainBlend`, `fit_rain_blend.py`)

บน $\ln(R+0.2)$ พยากรณ์ฐาน $b = \ln(R^E\chi + 0.2)$ ถูกเลื่อนเข้าหาสมาชิก $m$ แต่ละตัวด้วยน้ำหนักตาม lead $w_m(L)$ ที่ประมาณเชิงเส้นในตาราง

$$
\hat y = b + \sum_{m\in\{\text{shift},\text{amount},\text{persist},\text{nowcast}\}} w_m(L)\left(x_m - b\right),\qquad R^{\text{blend}} = \max(0, e^{\hat y} - 0.2)
$$
(A.67)

<!-- src: scripts/fit_rain_blend.py:8-13; index.html:2084-2108 -->

สมาชิก
- `shift` คือ ECMWF อ่านที่ $t + s^*$
- `amount` คือ ECMWF × $e^{\ell}$ ใช้เฉพาะเซลล์ที่เรดาร์ครอบคลุม
- `persist` คือ A.66
- `nowcast` คือ nowcast ของเรดาร์

สมาชิกที่ไม่มีค่าในแถวใดนับว่าเท่ากับ $b$ ในแถวนั้น

**การ fit** ใช้ non-negative least squares (NNLS) ต่อ lead โดยจำกัด $w\le1$
ข้อมูลฝึกคือ log `rainfc-*.csv` ทุก 3 ชม. ที่สถานีรายชั่วโมง เทียบกับเรดาร์ที่ปรับด้วยมาตรวัด (`rainobs-*.csv`, `radar_mmh`)
ตรวจแบบเว้นทีละสัปดาห์ (leave-one-week-out)
lead หนึ่งจะเก็บน้ำหนักได้เฉพาะเมื่อในสัปดาห์ที่เว้นออกเป็นไปตามเงื่อนไขทั้งหมดนี้
1. MSE ต่ำกว่า ECMWF อย่างเดียว
2. จับชั่วโมงฝน (≥ 0.5 mm/h) ได้ไม่น้อยกว่า
3. สัดส่วน false alarm ไม่มากกว่า

ต้องมี ≥ 300 แถว และ ≥ 30 ชั่วโมงเปียกต่อ lead
<!-- src: scripts/fit_rain_blend.py:2-13, 50-82 -->
เงื่อนไขข้อ 2 และ 3 มีไว้กัน blend ที่ลด log error ได้เพียงเพราะพยากรณ์ฝนน้อยลงทุกที่
ในข้อมูล ต.ค.–พ.ย. 2026 การ fit ด้วย MSE อย่างเดียวเก็บ lead 3–48 ชม. ไว้ ทั้งที่จับชั่วโมงฝนได้น้อยกว่า ECMWF ราวหนึ่งในสาม
<!-- src: scripts/fit_rain_blend.py:12-13 -->

**ตารางที่ A3.16** น้ำหนักปัจจุบันใน `CFG.rainBlend`

| lead (ชม.) | shift | amount | persist | nowcast |
|---|---|---|---|---|
| 1 | 0.12 | 0.0 | 0.12 | 0.74 |
| 2 | 0.14 | 0.0 | 0.19 | 0.5 |
| 3 | 0 | 0 | 0 | 0 |
| 6–48 | 0 | 0 | 0 | – |

<!-- src: scripts/update.mjs:93-100 -->
ความเห็นในโค้ดระบุว่าค่าเหล่านี้มาจากการ fit ครั้งแรก
- ช่วงข้อมูล 15 ต.ค.–8 พ.ย. 2026 (206k สถานี-lead, 15.6k ชั่วโมงเปียก)
- เก็บเฉพาะ lead 1–2 ชม.
- lead 3–48 ชม. คงเป็น ECMWF เพราะ blend จับชั่วโมงฝนได้น้อยกว่าราวหนึ่งในสาม

โค้ดไม่ได้ระบุแยกว่าน้ำหนัก `nowcast` ที่ 1–2 ชม. มาจากการ fit ครั้งเดียวกันหรือไม่ (ดู ISSUES_A.md)
ระบบตั้งงานให้ fit ใหม่ทุกเดือนในวันที่ 1 และนำค่าที่ fit พิมพ์ออกมาใส่โดยไม่ปรับด้วยมือ
<!-- src: scripts/update.mjs:93-99; CLAUDE.md (Scheduled work) -->

ถ้าไฟล์หน้าเว็บไม่มีน้ำหนัก nowcast ที่ fit ไว้ หน้าเว็บใช้น้ำหนักชั่วคราว (provisional) ที่ประมาณเชิงเส้นตามเวลาจากเฟรมล่าสุด
- 0.9 ที่ 0.5 ชม.
- 0.55 ที่ 1.5 ชม.
- 0.3 ที่ 2.5 ชม.
- 0.1 ที่ 3.5 ชม.
- 0 ที่ 4.5 ชม. ขึ้นไป

<!-- src: index.html:2078-2083, 2101, 2106 -->

### 3.4.5 ฝนสังเกตจากดาวเทียม: PARDIG กับ GSMaP และ `obsRainCheck`

ชั่วโมงที่ผ่านมานอกพื้นที่เรดาร์ใช้ PARDIG เมื่อมีชั่วโมงนั้น และใช้ GSMaP สำหรับชั่วโมงใหม่ที่ PARDIG ยังไม่เผยแพร่ หรือเป็นตัวสำรอง
<!-- src: scripts/update.mjs:538-558 -->
ทุกวัน `obsRainCheck` ให้คะแนนทั้งสองแหล่งกับมาตรวัด ThaiWater ในแถว `gauge` ของ `rainobs-*.csv` ย้อนหลัง 14 วัน ที่มีทั้ง `gauge_mm`, `gsmap_cell` และ `pardig_cell` (เซลล์ 0.1°)
ชั่วโมงเปียกคือ ≥ 0.5 mm/h

$$
\text{CSI}_j = \frac{\text{hit}_j}{n_{\text{wet}} + \#\{F_j\ge0.5\} - \text{hit}_j}
$$
(A.68)

$$
\text{PARDIG บนหน้าเว็บ} \iff \neg\,\text{decided} \;\vee\; \left(\text{hit}_P \ge \text{hit}_G \wedge \text{FA}_P \le \text{FA}_G\right),\qquad
\text{decided} = n_{\text{days}}\ge3 \wedge n\ge20\,000 \wedge n_{\text{wet}}\ge300
$$
(A.69)

<!-- src: scripts/update.mjs:157-175, 544-553 -->
- ก่อนมีข้อมูลพอ ระบบใช้ PARDIG ตามผลประเมิน 9–15 พ.ย. 2026 ที่บันทึกในโค้ด (675,601 มาตรวัด-ชั่วโมง; PARDIG จับได้ 71 % มี false alarm 52 %, CSI 0.40; GSMaP 44 %, 68 %, CSI 0.23)
- ถ้า PARDIG ตามไม่ทัน หน้าเว็บจะกลับไปใช้ GSMaP เอง
- CSI ใช้เป็นข้อมูลประกอบ ไม่ใช่เกณฑ์ตัดสิน

<!-- src: scripts/pardig.mjs:6-8; scripts/update.mjs:157-160 -->
PARDIG ใช้ฟิลด์ ECMWF เป็นข้อมูลเข้า จึง**ห้าม**ใช้ PARDIG เป็นค่าจริงในการ fit หรือตัดสินการปรับแก้ฝน ECMWF ทั้ง `fit_rain_blend.py` และประตูของ weather ML ใช้เรดาร์และมาตรวัด
<!-- src: scripts/pardig.mjs:7-8 -->

---

## 3.5 Weather ML และประตูฝน (`mlwx.mjs`, `rainDetectCheck`)

weather ML ใช้ engine เดียวกับ PM2.5 (`mlcore.mjs`: `base`, `day`, `week`, `month`, `season`) เพื่อปรับแก้อุณหภูมิ 2 ม. และฝนที่สถานี Air4Thai
ทำงานเฉพาะในรอบ CAMS

$$
y^{T} = T_{\text{obs}} - T_{\text{down}}\ \ (\text{clip}\ \pm5\ ^\circ\text{C}),\qquad
y^{R} = \ln(R_{\text{obs}}+0.2) - \ln(R^{E}\chi+0.2)\ \ (\text{clip}\ \pm\ln4)
$$
(A.70)

<!-- src: scripts/mlwx.mjs:1-8, 15-19 -->
$R_{\text{obs}}$ คือเรดาร์ที่ปรับด้วยมาตรวัดเมื่อเรดาร์เห็นสถานี และคือ GSMaP 0.025° ในกรณีอื่น
ข้อมูลฝึกมาจาก `wxf-*.csv` (leads 1–48 ชม.) ที่จับคู่กับ `a4tw-*.csv` และ `rainobs-*.csv`
การเรียนรู้รายวันเริ่มหลัง 07:00 น. เวลาไทย และรอ `rainobs` ของเมื่อวานถึงเที่ยง
<!-- src: scripts/mlwx.mjs:3-7; scripts/update.mjs:693-720 -->

| ตัวแปร | `T2_NAMES` | `PR_NAMES` |
|---|---|---|
| ร่วม | `lead`, `hsin`, `hcos`, `dsin`, `dcos`, `lat`, `lon`, `elev` | เหมือนกัน |
| เฉพาะ | `t2`, `dDown` (= T_down − T_ECMWF), `lnPr`, `lastErr`, `oT2` | `lnPr`, `t2`, `lnObsLast`, `lnObs6` |

<!-- src: scripts/mlwx.mjs:16-17, 28-29 -->
`WXML.leads` = 3, 6, …, 48 ชม. (ทุก 3 ชม.) ใช้ทำสนามปรับแก้ 0.1° (`wx-ml.json`) ด้วย kriging
<!-- src: scripts/mlwx.mjs:15; scripts/update.mjs:757-770 -->

**ประตูฝน `rainDetectCheck`**
น้ำหนักของผู้เชี่ยวชาญฝนอิงกับ log error ซึ่งการปรับแก้ลดได้เพียงด้วยการพยากรณ์ฝนน้อยลงทุกที่
ตัวอย่างจากความเห็นในโค้ดคือ ต.ค.–พ.ย. 2026 ฝนที่ปรับแล้วจับชั่วโมงฝนได้ 7 % เทียบกับ 31 % ก่อนปรับ และให้ปริมาณรวมเพียง 0.26 เท่าของค่าสังเกต
ประตูจึงใช้ 14 วันล่าสุดของ `wxf` เปรียบเทียบ `pr_ml` (ปรับแล้ว) กับ `pr_fine` (ECMWF × χ) โดยค่าจริงคือ `radar_mmh` ในแถว `a4t` ของ `rainobs`

$$
\text{ฝน ML เผยแพร่} \iff n\ge2000 \wedge n_{\text{wet}}\ge50 \wedge \text{hit}_{ML}\ge\text{hit}_{E} \wedge \text{FA}_{ML}\le\text{FA}_{E}
$$
(A.71)

<!-- src: scripts/update.mjs:138-156, 715-716, 724 -->
- การปรับแก้ฝนคำนวณและ log ทุกชั่วโมง (`pr_ml`)
- การปรับแก้ฝนไปถึงหน้าเว็บ (`active.pr` ใน `wx-ml.json`) เฉพาะเมื่อประตูผ่าน
- การปรับแก้อุณหภูมิเผยแพร่เมื่อมีผู้เชี่ยวชาญที่ได้น้ำหนัก ไม่มีประตูเพิ่ม

<!-- src: scripts/update.mjs:724, 742-747, 759-769 -->

---

## 3.6 กฎการเตือนและผลิตภัณฑ์

### 3.6.1 ระดับสีของประเทศไทย

**ตารางที่ A3.17** ระดับ PM2.5 ของกรมควบคุมมลพิษ ใช้ตั้งแต่ 1 มิ.ย. 2023 กับค่าเฉลี่ย 24 ชม. (µg/m³)

| ระดับ | ช่วง | ชื่อ | สี (ธีมสว่าง) |
|---|---|---|---|
| aq1 | ≤ 15 | ดีมาก (Very good) | `#2b8fd9` |
| aq2 | 15.1–25 | ดี (Good) | `#2f9e44` |
| aq3 | 25.1–37.5 | ปานกลาง (Moderate) | `#d4a10b` |
| aq4 | 37.6–75 | เริ่มมีผลกระทบต่อสุขภาพ (Starting to affect health) | `#e8690c` |
| aq5 | > 75 | มีผลกระทบต่อสุขภาพ (Affects health) | `#c92a2a` |

<!-- src: index.html:21, 994-1001, 745-749 -->

ดัชนีคุณภาพอากาศของไทย (Thai AQI) คำนวณจากค่าเฉลี่ย 24 ชม. $c$ (ตัดลงที่ 0.1) แบบเชิงเส้นเป็นช่วง

$$
I = \frac{I_{hi}-I_{lo}}{C_{hi}-C_{lo}}\,(c - C_{lo}) + I_{lo};\qquad I = 201 + (c - 75.1)\frac{99}{37.4}\ \ (c > 75)
$$
(A.72)

จุดตัดคือ [0–15 → 0–25], [15.1–25 → 26–50], [25.1–37.5 → 51–100], [37.6–75 → 101–200]
<!-- src: index.html:1002-1010 -->
`accuracy.mjs` ใช้ขอบเขตชุดเดียวกัน [15, 25, 37.5, 75] สำหรับคะแนน "ระดับสีถูก" (`sameBand`)
<!-- src: scripts/accuracy.mjs:23, 35 -->

### 3.6.2 กฎการเตือน

**เมือง** มีคำเตือนเมื่อพยากรณ์ PM2.5 รวมที่ตัวเมืองมีลักษณะต่อไปนี้
- **ค่าเฉลี่ย 24 ชม. เคลื่อนที่สูงสุดตั้งแต่ปัจจุบัน** > 37.5 µg/m³ (ต้องมี ≥ 18 จาก 24 ค่า) **หรือ**
- **ค่ารายชั่วโมงสูงสุด** > 75 µg/m³

$$
\text{warn}_{\text{town}} \iff \max_{t\ge t_0}\bar c_{24}(t) > 37.5 \;\vee\; \max_{t \ge t_0-23\,\text{h}} c(t) > 75
$$
(A.73)

<!-- src: index.html:4007, 4014-4015, 1381-1388, 3957 -->
ใน `seriesStats` ช่วงที่หาค่ารายชั่วโมงสูงสุดเริ่มที่ 23 ชั่วโมงก่อนชั่วโมงปัจจุบัน ไม่ได้เริ่มที่ปัจจุบัน (ดู ISSUES_A.md)
ถ้ายังไม่มีข้อมูล PM2.5 รวม ระบบใช้อนุกรมควันไฟจากแบบจำลองควันในเบราว์เซอร์แทน
<!-- src: index.html:1381-1384, 4015 -->

**สถานีตรวจวัด** มีคำเตือนเมื่อเป็นไปตามข้อใดข้อหนึ่ง ใช้เฉพาะสถานีอ้างอิงในพื้นที่ที่เลือก เพราะเซนเซอร์ราคาประหยัดอ่านค่าสูงในอากาศชื้น
1. ค่าเฉลี่ย 24 ชม. ที่วัดได้ตอนนี้ > 37.5 (`obs24.valid` หรือค่าของสถานีชนิด `24` ที่อายุ < 6 ชม.)
2. พยากรณ์ที่ปรับแล้วของสถานีเองผ่านกฎเดียวกับเมือง โดยค่าเฉลี่ย 24 ชม. คือค่าที่มากกว่าระหว่างค่าจาก `seriesStats` กับค่าใน `fc24*` ข้างหน้า

<!-- src: index.html:4016-4024 -->

**การรวมจุด** สถานีที่มีคำเตือนและอยู่ห่างเมืองที่มีคำเตือนไม่เกิน `WARN_MERGE_KM` = 10 กม. นับเป็นสถานที่เดียวกับเมืองนั้น
ถ้าสถานีนั้นวัดได้เกินมาตรฐานแล้ว เมืองจะถูกทำเครื่องหมายว่า "วัดได้เกินมาตรฐานแล้ว"
จำนวน "พื้นที่ที่มีคำเตือน" = เมืองที่มีคำเตือน + สถานีที่ไม่ได้รวมกับเมือง
<!-- src: index.html:4025-4031 -->

### 3.6.3 ระดับของเครื่องหมายเตือน

| ระดับ | เงื่อนไขของค่า $v$ | สี | ความหมาย |
|---|---|---|---|
| `wl1` | 37.5 < v ≤ 55 และกรณีอื่นที่ไม่เข้าเกณฑ์ข้างล่าง | ส้มอ่อน | เริ่มมีผลต่อกลุ่มเสี่ยง |
| `wl2` | 55 < v ≤ 75 | ส้มเข้ม | ไม่ดีต่อสุขภาพ (55 คือขั้น "unhealthy" ของ US EPA) |
| `wl3` | v > 75 | แดง | มีผลกระทบต่อสุขภาพ (ระดับ aq5 ของ PCD) |

<!-- src: index.html:4032-4037 -->
- $v$ คือค่าเฉลี่ย 24 ชม. ที่วัดได้ (สถานีที่วัดเกินแล้ว) หรือค่าเฉลี่ย 24 ชม. พยากรณ์สูงสุดข้างหน้า
- เมืองที่ได้คำเตือนจากเกณฑ์รายชั่วโมงอย่างเดียวจึงแสดงสีส้มอ่อน
- จุดทึบตรงกลางหมายถึงวัดได้เกินมาตรฐานแล้ว วงแหวนหมายถึงพยากรณ์ว่าจะเกิน

<!-- src: index.html:4032-4046 -->
หน้าเว็บยังสรุปรายพื้นที่ (จังหวัด/อำเภอ) จากจุดแลตทิซ 0.1° ของจังหวัด และแสดงกระดิ่งบนจังหวัดหรืออำเภอที่มีเมืองที่มีคำเตือน (`warnedBy`) เพื่อไม่ให้ค่าเฉลี่ยของพื้นที่ซ่อนคำเตือนของเมือง
<!-- src: index.html:4009-4012; README.md (Districts and sub-districts) -->

### 3.6.4 การตรวจรายชั่วโมงตาม lead (`verify.mjs`)

`verify.mjs` จับคู่พยากรณ์ที่ log ไว้กับค่าวัดภายหลัง ในหน้าต่าง 30 วัน
- คำนวณ mean bias, RMSE และ r ตาม lead สำหรับ CAMS ดิบและพยากรณ์ที่ปรับแล้ว
- ต้องมีอย่างน้อย 5 คู่ต่อกลุ่ม
- ตัด spike ด้วย A.1 ก่อน

<!-- src: scripts/verify.mjs:1-25 -->

### 3.6.5 คะแนนความแม่นยำบนหน้าเว็บ (`accuracy.mjs`)

ตั้งแต่ 26 พ.ย. 2026 ทุกส่วนของหน้าเว็บแสดงตัวเลขเดียวกัน คือ

$$
\text{NRMSE} = 100\,\frac{\sqrt{\frac1n\sum (F_d - O_d)^2}}{\frac1n\sum O_d},\qquad
\text{accuracy} = \max\!\left(0,\ \operatorname{round}(100 - \text{NRMSE})\right)\ [\%]
$$
(A.74)

<!-- src: scripts/accuracy.mjs:16, 47-48; index.html:2323-2327 -->

- $F_d$ คือพยากรณ์ค่าเฉลี่ย 24 ชม. ที่เผยแพร่ (`blend24ML`, ถ้าไม่มีใช้ `blend24A`, ถ้าไม่มีใช้ `blend24`) ของวันตามปฏิทิน (00–24 น. เวลาไทย) จากรอบที่ออก ณ 17 UTC lead 24 ชม. (`m1`) หรือ 48 ชม. (`m2`)
- $O_d$ คือค่าเฉลี่ยของชั่วโมงที่วัดได้ในวันไทยนั้น ต้องมี ≥ 18 ชั่วโมง
- ใช้เฉพาะสถานีอ้างอิงรายชั่วโมงในช่วง 30 วันล่าสุด

<!-- src: scripts/accuracy.mjs:23-26, 66-80 -->

| ค่าตั้ง | ค่า | src |
|---|---|---|
| `ACC.month.days` | 30 วัน | `accuracy.mjs:26` |
| `ACC.month.leads` | m1 = 24, m2 = 48 ชม. | `accuracy.mjs:26` |
| `ACC.minHours24` | 18 ชั่วโมง | `accuracy.mjs:23` |
| วันขั้นต่ำต่อป้าย (`ACC_MON_DAYS`) | 15 วัน | `index.html:2335` |
| MAPE ต้องมีวันที่ ≥ 10 µg/m³ | ≥ 8 วัน | `index.html:2335` |
| รัศมี "ที่นี่" (`ACC_NEAR_KM`) | 25 กม. (ถ้าไม่มี ใช้ภูมิภาคของไทย) | `index.html:2287, 2342-2345` |
| คะแนนอื่นที่ยังคำนวณ (7 วัน, รายชั่วโมง) | lead 1/3/6, 12/24, 48 ชม.; ค่าเฉลี่ย 24 ชม. ที่ 24/48 ชม. | `accuracy.mjs:23` |

เซนเซอร์ราคาประหยัดที่ผ่านการตรวจถูกให้คะแนนแยกด้วยวิธีเดียวกัน ไม่รวมกับคะแนนหลัก
เพราะการปรับแก้เรียนจากค่าของเซนเซอร์เอง คะแนนนี้จึงบอกความใกล้กับเซนเซอร์ ไม่ใช่กับค่าจริง
IQAir ใช้วิธีเดียวกันกับค่ารายชั่วโมงใน 7 วัน
- เทียบกับจุดพยากรณ์ของเราที่ใกล้ที่สุดภายใน 15 กม.
- แปลง US AQI กลับเป็น µg/m³ ด้วยค่ากลางของช่วง

คะแนนนี้คือ**ความสอดคล้องกับ IQAir** ไม่ใช่ความแม่นยำเทียบกับค่าวัด
<!-- src: scripts/accuracy.mjs:95-121, 156-161 -->

---

## 3.7 หลักการออกแบบ

### 3.7.1 ประตูตัดสินจากชั่วโมงสูงที่จับได้และ false alarm ไม่ใช่เพียง RMSE

RMSE และ log error ลดได้ด้วยการพยากรณ์ "เข้าหาค่ากลาง" ซึ่งทำให้พลาดเหตุการณ์ที่สำคัญต่อการเตือน
ตัวอย่างที่บันทึกในโค้ด
- ML v1 บน $\ln(o+1)$ ให้ค่าต่ำเกินในชั่วโมงสูง
- rain blend ที่ fit ด้วย MSE จับชั่วโมงฝนได้น้อยลงหนึ่งในสาม
- weather ML ฝนจับชั่วโมงฝนได้ 7 % เทียบกับ 31 %

ดังนั้นทุกขั้นที่เพิ่มเข้ามาภายหลังต้องผ่านประตูแบบ "ไม่แย่ลงในทุกเกณฑ์" ดังนี้

**ตารางที่ A3.18** ประตูของ SEA-HAF

| ขั้น | ประตู | เกณฑ์เหตุการณ์ | เงื่อนไขผ่าน | ข้อมูลขั้นต่ำ | src |
|---|---|---|---|---|---|
| ML v2 | `pmHighCheck` (14 วัน) | PM2.5 ≥ 37.5 | hit ≥, FA ≤, RMSE ≤ เทียบ v1 | n ≥ 20,000; สูง ≥ 100 | `ml2.mjs:97-120` |
| nowcast PM2.5 | `pmNowCheck` (14 วัน) | PM2.5 ≥ 37.5 | hit ≥, FA ≤, RMSE ≤ เทียบไม่มี nowcast | span ≥ 13 วัน; n ≥ 20,000; สูง ≥ 50 | `pmnow.mjs:43-64` |
| climatology blend | `fitLead` | PM2.5 ≥ 37.5 | RMSE <, hit ≥, FA ≤ เทียบ w = 0 | n ≥ 2,000; สูง ≥ 50 | `fit_clim_blend.mjs:20-28` |
| rain blend | `fit_rain_blend.py` (เว้นทีละสัปดาห์) | ฝน ≥ 0.5 mm/h | MSE <, hit ≥, FA ≤ เทียบ ECMWF | ≥ 300 แถว; เปียก ≥ 30 | `fit_rain_blend.py:59-79` |
| weather ML ฝน | `rainDetectCheck` (14 วัน) | ฝน ≥ 0.5 mm/h | hit ≥, FA ≤ เทียบ ECMWF × χ | n ≥ 2,000; เปียก ≥ 50 | `update.mjs:143-156` |
| ฝนสังเกต PARDIG | `obsRainCheck` (14 วัน) | ฝน ≥ 0.5 mm/h | hit ≥, FA ≤ เทียบ GSMaP | ≥ 3 วัน; n ≥ 20,000; เปียก ≥ 300 | `update.mjs:161-175` |
| อุณหภูมิจากสถานี | leave-one-out ทุกรอบ | – | RMSE ที่เว้นออกต่ำกว่า | ≥ 10 สถานี | `t2down.mjs:66-98` |
| ผู้เชี่ยวชาญ ML | ให้คะแนนรายวันแบบ out-of-sample | – | น้ำหนักตาม A.48–A.49 | ≥ 50 แถวทดสอบ | `ml.mjs:206-218` |
| เซนเซอร์ราคาประหยัด | ตรวจกับเพื่อนบ้าน 30 วันในอดีต | – | r ≥ 0.6, อัตราส่วน 0.5–2 | ≥ 10 วัน | `lowcost.mjs:22-42` |
| SILAM เป็นค่าเริ่มต้น | เปรียบเทียบจาก log | – | ดีอย่างน้อยเท่า CAMS | ไม่ระบุในโค้ด | CLAUDE.md |

ประตูทุกตัวมีเงื่อนไข "ข้อมูลยังไม่พอ" (`decided = false`) ซึ่งคงสถานะเดิมที่ปลอดภัยไว้
ในเกือบทุกกรณีสถานะเดิมคือไม่เผยแพร่ขั้นใหม่ ยกเว้น PARDIG ที่ใช้ผลประเมินเริ่มต้น

### 3.7.2 น้ำหนักมาจากสคริปต์ fit เท่านั้น

น้ำหนักและค่าคงที่ที่ได้จากข้อมูลมาจากสคริปต์ fit หรือ replay ที่ระบุในโค้ด และห้ามปรับด้วยมือ
- `CFG.rainBlend` มาจาก `fit_rain_blend.py`
- `CFG.climBlend` มาจาก `fit_clim_blend.mjs` (ยังเป็นศูนย์)
- โมเดล hindcast มาจาก `hindcast_train.mjs`
- `blendByLead` / `blendBelt` มาจาก replay 2024–26
- `LOWCOST.a`, `LOWCOST.b` มาจาก co-location ของ hindcast

ผู้เชี่ยวชาญ ML ได้น้ำหนักจากการให้คะแนนรายวัน ไม่ได้ตั้งด้วยมือ
<!-- src: CLAUDE.md rules 4–5 and Working notes; scripts/update.mjs:66-70, 83-100; scripts/lowcost.mjs:2-3 -->

### 3.7.3 การป้องกัน overfitting

1. **คะแนนนอกตัวอย่าง (out-of-sample)**
   - ผู้เชี่ยวชาญ ML ถูกให้คะแนนบนวันที่ตามหลังข้อมูลฝึก
   - `kfA` ใช้ increment ที่รอบก่อนพยากรณ์ไว้
   - RK, การลดขนาดอุณหภูมิ, rain blend และ hindcast ตรวจแบบเว้นออก (สถานี / สัปดาห์ / ฤดู)
2. **ตัวแปรเข้ามีเฉพาะค่าที่รู้ ณ เวลาออกพยากรณ์** เช่น ประวัติของสถานีใน v2 ใช้ชั่วโมงที่จบไม่ช้ากว่า $t_{\text{issue}}-1$ ชม.
   <!-- src: scripts/ml.mjs:22; scripts/ml2.mjs:65-67 -->
3. **ขอบเขตของการปรับแก้**
   - ML v1 ±ln 2
   - v2 ±60 µg/m³
   - RK ±ln 3
   - สนาม ML ±ln 2
   - nowcast ±1.5
   - weather ML ±5 °C / ±ln 4
4. **จำกัด lead** ML ใช้กับ lead ≤ 24 ชม. และ nowcast ใช้กับ lead ≤ 6 ชม. ตามผล hindcast ที่ lead ยาวกว่านั้นไม่ช่วย
5. **ผู้เชี่ยวชาญ `base` กับ fixed share** ensemble กลับไปหาห่วงโซ่เดิมได้เองเมื่อผู้เชี่ยวชาญอื่นหยุดช่วย
6. **การป้องกัน extrapolation ของ RK**
   - ลด predictor เมื่อสถานีน้อย
   - จำกัด predictor ไว้ในช่วงข้อมูล
   - จางเป็นศูนย์เมื่อห่างสถานี
7. **ตัดค่าผิดปกติก่อนเรียนรู้** spike check (A.1) ใช้ทั้งตอนรับข้อมูลและตอนอ่าน log กลับมา

### 3.7.4 สรุปสถานะการใช้งาน ณ เวลาที่เขียน (ตามโค้ด)

| ขั้น | สถานะ |
|---|---|
| fire-group assimilation | เปิดในรอบ CAMS, ปิดในรอบ SILAM |
| Kalman filter, persistence blend, RK, ML map field | เปิด |
| ML v1 (รวม hindcast ในช่วง 18 ธ.ค.–30 เม.ย.) | เปิดเมื่อผู้เชี่ยวชาญได้น้ำหนัก |
| ML v2 | คำนวณและ log; เผยแพร่เฉพาะเมื่อ `pmHighCheck` ผ่าน (ผลการตัดสินดูใน state) |
| nowcast PM2.5 | คำนวณและ log; เผยแพร่เฉพาะเมื่อ `pmNowCheck` ผ่าน (ผลการตัดสินดูใน state) |
| climatology blend | ปิด: น้ำหนักทุก lead เป็นศูนย์ และยังไม่มีโค้ดที่นำไปใช้ |
| rain blend | shift/persist/nowcast ที่ lead 1–2 ชม.; lead ≥ 3 ชม. = ECMWF |
| weather ML ฝน | เผยแพร่เฉพาะเมื่อ `rainDetectCheck` ผ่าน |
| ฝนสังเกตบนหน้าเว็บ | PARDIG เว้นแต่ `obsRainCheck` ตัดสินให้ GSMaP (GSMaP ไม่พร้อมใช้ตั้งแต่ 18 พ.ย. 2026 ตาม README) |
| SILAM | หน้า developer เท่านั้น; ค่าเริ่มต้นยังเป็น CAMS |

---

## เอกสารอ้างอิง

### เอกสารที่ตรวจรายละเอียดบรรณานุกรมแล้ว

- Delle Monache, L., Nipen, T., Deng, X., Zhou, Y., & Stull, R. (2006). Ozone ensemble forecasts: 2. A Kalman filter predictor bias correction. *Journal of Geophysical Research: Atmospheres*, 111, D05308.
- Inness, A., Ades, M., Agustí-Panareda, A., et al. (2019). The CAMS reanalysis of atmospheric composition. *Atmospheric Chemistry and Physics*, 19, 3515–3556.
- Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product: Algorithm description and initial assessment. *Remote Sensing of Environment*, 143, 85–96.
- Sofiev, M., Vira, J., Kouznetsov, R., Prank, M., Soares, J., & Genikhovich, E. (2015). Construction of the SILAM Eulerian atmospheric dispersion model based on the advection algorithm of Michael Galperin. *Geoscientific Model Development*, 8, 3497–3522.

### เอกสารที่โค้ดหรือ README อ้างถึง (ยังไม่ได้ตรวจบรรณานุกรม ต้องตรวจก่อนรวมเล่ม)

ข้อมูลในวงเล็บคือสิ่งที่โค้ดระบุ

- Akagi et al. (2011) ค่าสัมประสิทธิ์การปล่อย (README)
- Briggs (1973) เส้นโค้ง σ แบบ open-country (`index.html`)
- Deutsch (1989) DECLUS; Isaaks & Srivastava (1989) (`rk.mjs`)
- FitzGerald et al. (2022) ชุดข้อมูล MASSIVE 1.1 (README; ใช้ในแชต)
- Furrer et al. (2006) covariance tapering (`rk.mjs`)
- Gross (1970); Stackpole (1967) เกณฑ์ air-pollution potential (README)
- Heffter (1965) σy ระยะไกล (README)
- Hengl et al. (2007) ความแปรปรวนของ regression kriging (`index.html`)
- Herbster & Warmuth (1998); Littlestone & Warmuth (1994) fixed-share forecaster (`ml.mjs`)
- Horálek et al. วิธี RIMM ของ EEA (`rk.mjs`)
- Karger et al. (2017) CHELSA, doi:10.1038/sdata.2017.122 (`prclim.py`)
- Liston & Elder (2006) MicroMet, *J. Hydrometeor.* 7, 217 (`index.html`)
- Marshall & Palmer (1948) ความสัมพันธ์ Z–R (`radar.mjs`)
- Real et al. (2022) *ESSD* 14, 2419 (`rk.mjs`)
- Rodgers (2000) DOFS (`assim.mjs`)
- Sofiev et al. (2012) ความสูงการยกตัวของควัน *ACP* 12, 1995, สมการ 13 (`index.html`)
- Turner (1970) ชั้นเสถียรภาพ PG (`index.html`, `met.mjs`)
- Wiedinmyer et al. (2023) FINN v2.5 ตาราง 1 และ 4 (`index.html`)
- Wooster et al. (2005) 0.368 kg/MJ (`index.html`)
- Zhang et al. (2020) วงจรรายวันของไฟ *ACP* 20, 10687 (`index.html`)

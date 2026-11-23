// Ask SEA-HAF: training questions for the topic classifier (scripts/chatml.mjs), made from templates with places, days and
// parts of the day filled in, plus light typos; then the questions viewers labelled themselves (chat/learned.json, see
// scripts/chat_learn.mjs). The test questions (chat/test.json) are written apart and never used for training.
const PLACES_TH = ['', '', '', 'ที่นี่', 'แถวนี้', 'ตรงนี้', 'แถวบ้าน', 'เชียงใหม่', 'เชียงราย', 'กทม', 'กรุงเทพ', 'ลำปาง', 'น่าน', 'แม่ฮ่องสอน', 'ขอนแก่น', 'โคราช', 'อุบล', 'ภูเก็ต', 'หาดใหญ่', 'สงขลา', 'พะเยา', 'ตาก', 'อุดรธานี', 'นครสวรรค์', 'พิษณุโลก'];
const PLACES_EN = ['', '', 'here', 'near me', 'Chiang Mai', 'Bangkok', 'Chiang Rai', 'Lampang', 'Khon Kaen', 'Phuket', 'Nan', 'Udon Thani'];
const DAYS_TH = ['', '', 'วันนี้', 'พรุ่งนี้', 'มะรืนนี้', 'ตอนนี้', 'ขณะนี้'];
const DAYS_EN = ['', 'today', 'tomorrow', 'now', 'right now', 'the day after tomorrow'];
const PARTS_TH = ['', '', '', 'เช้า', 'ตอนเช้า', 'บ่าย', 'เย็น', 'ตอนเย็น', 'คืนนี้', 'ช่วงกลางวัน'];
const PARTS_EN = ['', '', 'in the morning', 'this afternoon', 'tonight', 'in the evening'];

const T = {
  pm: { th: ['ฝุ่น{P}{D}เป็นไง', 'ฝุ่น{P}{D}เยอะไหม', '{P}{D}{T}ฝุ่นเท่าไหร่', 'ค่า pm2.5 {P}{D}', 'pm2.5{P}{D}{T}', 'คุณภาพอากาศ{P}{D}เป็นยังไง', 'อากาศ{P}{D}ดีไหม', '{D}{P}ฝุ่นหนาไหม', 'ค่าฝุ่น{P}{D}{T}', '{P}{D}หมอกควันเยอะไหม', 'ระดับฝุ่น{P}{D}', 'ฝุ่นจิ๋ว{P}{D}เป็นไง', 'aqi {P}{D}', '{P}{D}{T}อากาศแย่ไหม', 'ขอดูค่าฝุ่น{P}', 'ฝุ่นจะลดลงไหม{D}', 'ฝุ่น{D}{T}จะหนาไหม', '{P}{D}ค่าฝุ่นสูงไหม', 'ควันไฟ{P}{D}เยอะไหม', 'ฝุ่น{P}ช่วงนี้เป็นยังไงบ้าง', '{P}{D}'],
        en: ['how is the air {P} {D}', 'pm2.5 {P} {D}', 'air quality {P} {D} {T}', 'is the air bad {P} {D}', 'dust level {P} {D}', 'how much pm2.5 {P} {D}', 'smoke {P} {D}', 'is it hazy {P} {D}', 'aqi {P} {D}', 'pollution {P} {D} {T}', '{P} {D}'] },
  adv: { th: ['ต้องใส่หน้ากากไหม{D}', '{D}{T}ออกไปวิ่งได้ไหม', 'ออกกำลังกายกลางแจ้ง{P}{D}ได้ไหม', 'ควรใส่ n95 ไหม{D}', 'เด็ก{D}ไปเล่นข้างนอกได้ไหม', 'ผู้สูงอายุออกนอกบ้าน{D}ได้ไหม', '{D}{T}ปั่นจักรยาน{P}ได้ไหม', 'ฝุ่น{D}อันตรายไหม', 'ควรทำยังไง{D}ฝุ่นเยอะ', '{P}{D}เปิดหน้าต่างได้ไหม', 'ปลอดภัยไหมถ้าออกไปข้างนอก{D}', 'คนเป็นหอบหืด{D}ต้องระวังไหม', 'ใส่หน้ากากอนามัยพอไหม', 'ควรงดกิจกรรมกลางแจ้งไหม{D}', 'พาหมาไปเดินเล่น{D}{T}ได้ไหม', 'ไปตลาด{D}ต้องใส่แมสไหม'],
         en: ['should i wear a mask {D}', 'can i go running {D} {T}', 'is it safe to exercise outside {P} {D}', 'do i need an n95 {D}', 'can kids play outside {D}', 'is it safe to go out {D}', 'should i stay indoors {D}', 'can i open the windows {D}'] },
  rank: { th: ['จังหวัดไหนฝุ่นเยอะสุด{D}', '{D}ที่ไหนฝุ่นหนาที่สุด', 'อันดับจังหวัดฝุ่นสูงสุด{D}', 'จังหวัดไหนอากาศดีสุด{D}', 'ที่ไหนอากาศแย่ที่สุด{D}', '5 อันดับจังหวัดฝุ่นเยอะ', 'ภาคไหนฝุ่นเยอะ{D}', 'จังหวัดที่ค่าฝุ่นสูงที่สุด{D}', '{D}ไปเที่ยวจังหวัดไหนอากาศดี', 'จังหวัดไหนฝุ่นน้อยสุด'],
          en: ['which province has the worst air {D}', 'worst air quality {D}', 'top 5 most polluted provinces {D}', 'where is the air cleanest {D}', 'ranking of provinces by pm2.5 {D}', 'most polluted place {D}'] },
  hot: { th: ['มีจุดความร้อน{P}ไหม', 'ไฟป่า{P}{D}', 'มีการเผา{P}ไหม', 'จุดไฟ{P}{D}', 'hotspot {P}{D}', 'ดาวเทียมเจอไฟ{P}ไหม', 'มีไฟไหม้ป่า{P}ไหม', 'เผาไร่{P}เยอะไหม', 'จุดความร้อนใกล้ฉัน', 'จุดความร้อนวันนี้มีกี่จุด'],
         en: ['any fires {P}', 'hotspots {P} {D}', 'is there burning {P}', 'forest fires near me', 'fire hotspots {D}', 'how many hotspots {D}'] },
  wx: { th: ['{D}{T}ฝนจะตกไหม', 'ฝน{P}{D}{T}', '{P}{D}อากาศร้อนไหม', 'อุณหภูมิ{P}{D}เท่าไหร่', '{D}{T}หนาวไหม', 'พยากรณ์อากาศ{P}{D}', '{D}ต้องพกร่มไหม', 'ลม{P}{D}แรงไหม', '{P}{D}ความชื้นเท่าไหร่', 'อากาศ{D}{T}เย็นไหม', '{D}ร้อนแค่ไหน', 'ฝนตก{P}{D}{T}หรือเปล่า'],
        en: ['will it rain {P} {D} {T}', 'temperature {P} {D}', 'is it hot {D}', 'weather forecast {P} {D}', 'do i need an umbrella {D}', 'how cold {D} {T}', 'is it windy {D}'] },
  fog: { th: ['{D}{T}จะมีหมอกไหม', 'หมอก{P}{D}', 'หมอกลง{P}{D}{T}ไหม', '{D}เช้ามีหมอกหนาไหม', 'ขับรถ{D}{T}หมอกจะหนาไหม', 'หมอกจะลง{D}{T}ไหม', 'ทะเลหมอก{P}{D}', 'มีหมอก{P}ไหม'],
         en: ['will there be fog {D} {T}', 'fog {P} {D}', 'is it foggy {D} {T}', 'misty {D} morning', 'sea of mist {P} {D}'] },
  acc: { th: ['พยากรณ์แม่นไหม', 'ความแม่นยำเท่าไหร่', 'เชื่อถือได้แค่ไหน', 'แม่นยำกี่เปอร์เซ็นต์', 'ทายถูกบ่อยไหม', 'ผิดพลาดเยอะไหม', 'ค่าที่บอกตรงไหม', 'ความคลาดเคลื่อนเท่าไหร่'],
         en: ['how accurate is it', 'is the forecast accurate', 'how reliable', 'accuracy', 'how often is it right', 'error of the forecast'] },
  src: { th: ['ข้อมูลมาจากไหน', 'ใช้ข้อมูลอะไรบ้าง', 'แหล่งข้อมูลคืออะไร', 'เอาข้อมูลจากที่ไหน', 'ข้อมูลอัปเดตบ่อยไหม', 'ใช้สถานีอะไรบ้าง', 'ข้อมูลจากกรมควบคุมมลพิษไหม'],
         en: ['where does the data come from', 'data sources', 'what data do you use', 'how often is it updated', 'which stations do you use'] },
  how: { th: ['ระบบทำงานยังไง', 'คำนวณยังไง', 'ใช้แบบจำลองอะไร', 'พยากรณ์ได้ยังไง', 'ใช้ ai ไหม', 'ใช้ machine learning ไหม', 'sea-haf คืออะไร', 'แบบจำลองนี้ทำงานอย่างไร', 'วิธีพยากรณ์', 'ใครทำเว็บนี้'],
         en: ['how does it work', 'what model do you use', 'how is the forecast made', 'do you use ai', 'what is sea-haf', 'how do you calculate it'] },
  whatpm: { th: ['pm2.5 คืออะไร', 'ฝุ่น pm2.5 คืออะไร', 'ฝุ่นจิ๋วคืออะไร', 'pm2.5 อันตรายยังไง', 'ฝุ่นเข้าปอดได้ไหม', 'pm2.5 เกิดจากอะไร', 'ฝุ่นมาจากไหน'],
            en: ['what is pm2.5', 'what is fine dust', 'why is pm2.5 dangerous', 'where does pm2.5 come from'] },
  aqi: { th: ['aqi คืออะไร', 'ค่า aqi หมายถึงอะไร', 'aqi ต่างจาก pm2.5 ยังไง', 'ดัชนีคุณภาพอากาศคืออะไร', 'สีแต่ละระดับหมายถึงอะไร', 'aqi ไทยกับอเมริกาต่างกันยังไง'],
         en: ['what is aqi', 'what does aqi mean', 'difference between aqi and pm2.5', 'what do the colours mean'] },
  hi: { th: ['สวัสดี', 'หวัดดี', 'ดีจ้า', 'สวัสดีครับ', 'สวัสดีค่ะ', 'ช่วยอะไรได้บ้าง', 'ถามอะไรได้บ้าง', 'ขอบคุณ', 'ขอบคุณมาก', 'เก่งมาก'],
        en: ['hello', 'hi', 'hey there', 'what can you do', 'help', 'thanks', 'thank you'] },
  other: { th: ['ราคาทองวันนี้', 'ใครเป็นนายก', 'หวยออกอะไร', 'ร้านอาหารแถวนี้', 'แปลภาษาให้หน่อย', 'บอลคืนนี้ใครชนะ', 'หุ้นขึ้นไหม', 'เพลงอะไรเพราะ', 'ทำการบ้านให้หน่อย', 'สูตรต้มยำ', 'เบอร์โทรโรงพยาบาล', 'น้ำมันราคาเท่าไหร่', 'รถติดไหม', 'แผ่นดินไหว'],
           en: ['price of gold', 'who is the prime minister', 'tell me a joke', 'restaurants near me', 'football score', 'translate this', 'stock market today', 'traffic now'] },
};
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }
const pick = (r, a) => a[Math.floor(r() * a.length)];
function typo(r, s) { if (s.length < 5 || r() > 0.2) return s; const i = 1 + Math.floor(r() * (s.length - 2)); return r() < 0.5 ? s.slice(0, i) + s.slice(i + 1) : s.slice(0, i) + s[i] + s.slice(i); }
/** template questions: about perTopic per topic (Thai about 3 in 4), deduplicated */
export function templateRows(perTopic = 220, seed = 11) {
  const r = rng(seed), out = [], seen = new Set();
  for (const [y, { th, en }] of Object.entries(T)) {
    for (let i = 0, tries = 0; i < perTopic && tries < perTopic * 6; tries++) {
      const isTh = r() < 0.75, tpl = pick(r, isTh ? th : en);
      let q = tpl.replace('{P}', isTh ? pick(r, PLACES_TH) : pick(r, PLACES_EN)).replace('{D}', isTh ? pick(r, DAYS_TH) : pick(r, DAYS_EN)).replace('{T}', isTh ? pick(r, PARTS_TH) : pick(r, PARTS_EN));
      q = typo(r, q.replace(/\s+/g, ' ').trim()); if (!q || seen.has(y + '|' + q)) continue; seen.add(y + '|' + q); out.push({ q, y }); i++;
    }
  }
  return out;
}

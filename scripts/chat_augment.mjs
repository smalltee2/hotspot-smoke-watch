// Ask SEA-HAF: variants of the training questions, so the topic classifier also knows how people really type: misspellings,
// dropped tone marks, spoken forms (ไหม -> มั้ย, อย่างไร -> ยังไง), sentence-final particles, short names of places (กทม, โคราช,
// cnx), spaces removed or added, repeated letters and letter case. Deterministic
// (seeded), so a training run can be repeated. Used by scripts/chat_train.mjs; never applied to the test questions.

export function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const isThai = s => /[฀-๿]/.test(s);

// spoken and written forms of the same word (either way)
const SPOKEN = [['ไหม', ['มั้ย', 'มั๊ย', 'ไม๊', 'มะ']], ['อย่างไร', ['ยังไง', 'ยังไงบ้าง', 'ไง']], ['เท่าไหร่', ['เท่าไร', 'เท่าไหร', 'เท่าไร่', 'กี่']],
  ['หรือเปล่า', ['รึเปล่า', 'ป่าว', 'ป่ะ', 'หรือป่าว']], ['หรือไม่', ['ไหม', 'มั้ย', 'รึเปล่า']], ['เป็นยังไง', ['เป็นไง', 'เปงไง', 'เป็นไงมั่ง']],
  ['ไหน', ['ไหนอ่ะ']], ['มาก', ['มากๆ', 'มั่ก', 'มากกก']], ['ครับ', ['คับ', 'ครัช', 'ฮะ', 'คร้าบ']], ['ค่ะ', ['คะ', 'ค่า', 'คร่า', 'จ้ะ']],
  ['อะไร', ['อะรัย', 'ไร', 'อาราย']], ['พรุ่งนี้', ['พรุ้งนี้', 'พุ่งนี้', 'พรุ่งนิ']], ['วันนี้', ['วันนิ', 'วันนี้อ่ะ']], ['ตอนนี้', ['ตอนนิ', 'ณ ตอนนี้']],
  ['เยอะ', ['เยอะมาก', 'เยอะๆ', 'เย้อ']], ['ไหมครับ', ['มั้ยคับ', 'ไหมฮะ']], ['ได้ไหม', ['ได้มั้ย', 'ได้ป่าว', 'ได้ปะ', 'ไหวไหม']]];
// places: the same place by its other names (either way)
const PLACES = [['เชียงใหม่', ['ชม.', 'เชียงไหม่', 'cnx', 'chiang mai', 'เชียงใหม่']], ['กรุงเทพ', ['กทม', 'กทม.', 'บางกอก', 'กรุงเทพฯ', 'bkk']],
  ['กรุงเทพมหานคร', ['กทม', 'กรุงเทพ']], ['นครราชสีมา', ['โคราช', 'korat']], ['โคราช', ['นครราชสีมา']], ['อุบลราชธานี', ['อุบล']], ['อุบล', ['อุบลราชธานี']],
  ['อุดรธานี', ['อุดร']], ['อุดร', ['อุดรธานี']], ['ขอนแก่น', ['ขก.', 'ขอนแก่น', 'khon kaen']], ['พิษณุโลก', ['พิดโลก', 'พล.']], ['แม่ฮ่องสอน', ['แม่ฮ่อง', 'มส.']],
  ['เชียงราย', ['ชร.', 'เชียงลาย', 'chiang rai']], ['นครศรีธรรมราช', ['นครศรี', 'คอน']], ['สุราษฎร์ธานี', ['สุราษฎร์', 'สุราษ']], ['ลำปาง', ['เมืองรถม้า', 'lampang']],
  ['พะเยา', ['phayao']], ['หาดใหญ่', ['hatyai']], ['ภูเก็ต', ['phuket']], ['Chiang Mai', ['CM', 'cnx', 'chiangmai', 'Chiengmai']],
  ['Bangkok', ['BKK', 'bangkok', 'krung thep']], ['Chiang Rai', ['chiangrai', 'CR']], ['Khon Kaen', ['khonkaen']]];
const PARTICLES_TH = ['ครับ', 'ค่ะ', 'คะ', 'จ้า', 'จ้ะ', 'นะ', 'อ่ะ', 'ป่ะ', 'เนี่ย', 'หน่อย', 'บ้าง', 'จ๊ะ', 'ฮะ', 'เจ้า', 'เด้อ', 'นะคะ', 'นะครับ'];
const TONES = /[่-๋]/g;   // ่ ้ ๊ ๋
// Thai Kedmanee keys -> the US letter on the same key (unshifted row), for "typed in the wrong layout"
const KED = 'ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฃฟหกดเ้่าสวงผปแอิืทมใฝ', US = '1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./';
const TH2US = new Map([...KED].map((c, i) => [c, US[i]])), US2TH = new Map([...US].map((c, i) => [c, KED[i]]));
// English: letters next to each other on the keyboard
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const near = (c, r) => { for (const row of ROWS) { const i = row.indexOf(c); if (i >= 0) return row[Math.max(0, Math.min(row.length - 1, i + (r() < 0.5 ? -1 : 1)))]; } return c; };

function replaceSome(r, s, table) {
  const hits = table.filter(([a]) => s.includes(a)); if (!hits.length) return s;
  const [a, bs] = pick(r, hits); return s.replace(a, pick(r, bs));
}
const OPS = {
  typo(r, s) { if (s.length < 4) return s; const i = 1 + Math.floor(r() * (s.length - 2)), k = r();
    if (k < 0.35) return s.slice(0, i) + s.slice(i + 1);                                  // a letter missed
    if (k < 0.6) return s.slice(0, i) + s[i] + s.slice(i);                                // a letter twice
    if (k < 0.85 && s[i] !== ' ' && s[i + 1] && s[i + 1] !== ' ') return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);   // two letters swapped
    return /[a-z]/.test(s[i]) ? s.slice(0, i) + near(s[i], r) + s.slice(i + 1) : s; },
  tones(r, s) { return r() < 0.5 ? s.replace(TONES, '') : s.replace(TONES, m => (r() < 0.4 ? '' : m)); },
  spoken: (r, s) => replaceSome(r, s, SPOKEN),
  place: (r, s) => replaceSome(r, s, PLACES),
  particle(r, s) { if (!isThai(s)) return s; const t = s.replace(/(ครับ|ค่ะ|คะ|จ้า|นะ)\s*$/, '').trim(); return r() < 0.25 ? t : t + (r() < 0.3 ? ' ' : '') + pick(r, PARTICLES_TH); },
  spaces(r, s) { if (!isThai(s)) return s; if (r() < 0.6) return s.replace(/\s+/g, ''); return s.replace(/(ฝุ่น|ค่า|วันนี้|พรุ่งนี้|ที่|ตอนนี้|อากาศ|หมอก|ฝน|จุด)/g, m => (r() < 0.5 ? ' ' + m + ' ' : m)).replace(/\s+/g, ' ').trim(); },
  repeat(r, s) { const t = s.replace(/[?!]+$/, ''); return r() < 0.5 ? t + pick(r, ['?', '??', '???', '!!', ' ?', '...']) : t.replace(/(.)$/, (m, c) => c.repeat(2 + Math.floor(r() * 3))); },
  caseEn(r, s) { if (isThai(s)) return s; const k = r(); return k < 0.3 ? s.toUpperCase() : k < 0.7 ? s.replace(/\b\w/g, c => c.toUpperCase()) : s.toLowerCase(); },
  layout(r, s) { return isThai(s) ? [...s].map(c => TH2US.get(c) ?? c).join('') : s; },
};
// how often each change is chosen. 'layout' (a question typed with the keyboard on English) is not used for training: such text
// shares no n-grams with Thai, it only made the model worse; thaiToUs / usToThai are kept for reading such questions instead.
const W = [['typo', 3], ['tones', 1.5], ['spoken', 3], ['place', 2], ['particle', 3], ['spaces', 2], ['repeat', 1.2], ['caseEn', 1]];
const WSUM = W.reduce((a, [, w]) => a + w, 0);
function pickOp(r) { let x = r() * WSUM; for (const [k, w] of W) { if ((x -= w) < 0) return k; } return 'typo'; }

/** one variant of a question: 1-3 changes */
export function variant(q, r) {
  let s = q; const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) s = OPS[pickOp(r)](r, s);
  return s.replace(/\s+/g, ' ').trim();
}
/** [{q, y}] -> the rows plus about `copies` variants of each (deduplicated; empty or unchanged variants dropped) */
export function augment(rows, { copies = 2, seed = 3 } = {}) {
  const r = rng(seed), out = [], seen = new Set(), key = (q, y) => y + '|' + q.toLowerCase();
  for (const x of rows) { const k = key(x.q, x.y); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  for (const x of rows) for (let c = 0; c < copies; c++) {
    const q = variant(x.q, r), k = key(q, x.y); if (q.length < 2 || seen.has(k)) continue; seen.add(k); out.push({ q, y: x.y, aug: 1 });
  }
  return out;
}
/** English letters typed on the Thai layout back to Thai (for a question sent with the keyboard on the wrong language) */
export const usToThai = s => [...s].map(c => US2TH.get(c) ?? c).join('');
export const thaiToUs = s => [...s].map(c => TH2US.get(c) ?? c).join('');

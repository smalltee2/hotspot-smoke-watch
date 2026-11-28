"""Extract the public-page content of the SEA-HAF manual into public/ for a separate plain-language user guide.
Run from docs/manual:  python3 public/make_public.py
Writes public/01_web_guide.md (chapter 5 without developer-only parts), public/02_sources.md (excerpts to rewrite
in plain language), copies the screenshots it uses to public/figs/, and lists remaining developer mentions."""
import re, os, shutil

def sections(text, level):
    """Split markdown into [(heading, body)] at the given heading level (body includes deeper headings)."""
    pat = re.compile(r'^(#{%d} .*)$' % level, re.M)
    idx = [m.start() for m in pat.finditer(text)]
    head = text[:idx[0]] if idx else text
    return head, [text[a:b] for a, b in zip(idx, idx[1:] + [len(text)])]

def pick(text, level, keep):
    _, secs = sections(text, level)
    return ''.join(s for s in secs if any(s.startswith('#' * level + ' ' + k) for k in keep))

def clean(t):
    t = re.sub(r'<!--.*?-->\n?', '', t, flags=re.S)                  # source-line comments
    t = '\n'.join(l for l in t.split('\n')
                  if not re.match(r'^\|.*\|\s*developer\s*\|\s*$', l))  # table rows shown only on the developer page
    return re.sub(r'\n{3,}', '\n\n', t)

ch5 = open('05_user_guide.md').read()
head, secs = sections(ch5, 2)
drop = ('## 5.4 ', '## 5.19 ')                                       # SILAM choice and developer page: developer only
body = ''.join(s for s in secs if not s.startswith(drop))
head = re.sub(r'> ข้อความในบทนี้ยึดโค้ด.*?\n> ความไม่ตรงกัน.*?\n', '', head, flags=re.S)
guide = clean(head + body)
os.makedirs('public/figs', exist_ok=True)
open('public/01_web_guide.md', 'w').write(guide)

src = []
ch1 = open('01_introduction.md').read()
src.append('# ที่มา: บทที่ 1 (ปัญหา เป้าหมาย และผลิตภัณฑ์)\n\n' + pick(ch1, 2, ['1.1', '1.3']) + pick(ch1, 3, ['1.4.6']))
src.append('# ที่มา: บทที่ 2 (แหล่งข้อมูล)\n\n' + pick(open('02_data.md').read(), 2, ['2.2']))
ch3 = open('03_methodology.md').read()
src.append('# ที่มา: บทที่ 3 (สี กฎเตือน และคะแนนความแม่นยำ)\n\n' + pick(ch3, 3, ['3.6.1', '3.6.2', '3.6.3', '3.6.5']))
ch4 = open('04_evaluation.md').read()
src.append('# ที่มา: บทที่ 4 (ความแม่นยำ: ตารางหลักและข้อจำกัด)\n\n' + pick(ch4, 3, ['B.3.1']) + pick(ch4, 2, ['B.10']))
ch8 = open('08_appendix.md').read()
src.append('# ที่มา: บทที่ 8 (ศัพท์และการอ้างอิงข้อมูล)\n\n' + pick(ch8, 2, ['8.1', '8.3']))
open('public/02_sources.md', 'w').write(clean('\n\n'.join(src)))

figs = sorted(set(re.findall(r'figs/([\w.-]+\.png)', guide + open('public/02_sources.md').read())))
for f in figs:
    shutil.copy('figs/' + f, 'public/figs/' + f)
left = [f'{i}: {l[:110]}' for i, l in enumerate(guide.split('\n'), 1) if re.search(r'developer|dev\.html|หน้า dev', l)]
open('public/DEV_MENTIONS.txt', 'w').write('\n'.join(left) + '\n')
print(len(guide.split('\n')), 'lines guide;', len(figs), 'figures;', len(left), 'developer mentions left')

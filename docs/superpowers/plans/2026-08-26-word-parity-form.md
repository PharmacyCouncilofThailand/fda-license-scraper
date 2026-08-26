# Word-Parity Inspection Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `web/public/form.html` — the record an inspector fills in and the page Puppeteer prints — match `templates/inspection-form.docx` in page setup, typeface, type sizes, wording, order, and furniture.

**Architecture:** The Word file stays the source of truth and is read at test time, never at run time. A new `test-form-parity.js` extracts the template's measurements and paragraph model and asserts the rendered page against them; the HTML is then changed until it passes. The blanks change from fixed-width `<input>` boxes to fields that flow with the line, which lets the automatic type-shrinking go.

**Tech Stack:** Node 22 (CommonJS, built-in `fetch`), Puppeteer for rendering and measurement, the repo's own `src/zip.js` for reading the .docx, no new dependencies. Plain HTML/CSS in `web/public/form.html` — no framework, because Puppeteer loads that page for every PDF.

## Global Constraints

- No new npm dependencies. `src/zip.js` already reads .docx parts.
- Half-points to points: `w:szCs` ÷ 2. Twips to millimetres: twips ÷ 1440 × 25.4.
- Type sizes: `szCs 36` = 18pt, `szCs 30` = 15pt, `szCs 28` = 14pt.
- Page: A4, margins top 12mm, bottom 10mm, left 20mm, right 20mm.
- Typeface: TH SarabunPSK only. The TH Sarabun New files added earlier are removed in Task 1.
- Every `name` on a blank keeps its current spelling — `applyData()` and the search page's handoff match on it.
- `templates/inspection-form.docx` is not in the repository. Anything that reads it skips with a message when it is absent, the way the DOCX endpoint already does.
- Thai UI text stays as it is in the template, character for character.
- Commit after each task.

---

### Task 1: Parity harness, page setup and typeface

**Files:**
- Create: `test-form-parity.js`
- Create: `web/public/fonts/THSarabunPSK.ttf`, `web/public/fonts/THSarabunPSK-Bold.ttf`
- Delete: `web/public/fonts/THSarabunNew.woff`, `web/public/fonts/THSarabunNew-Bold.woff`
- Modify: `web/public/form.html` (the `@font-face` block, `@page`, `.sheet`)
- Modify: `package.json` (add `test:parity`)

**Interfaces:**
- Consumes: `src/zip.js` — `zip.read(buffer)` returns `[{ name, data }]`.
- Produces: `readTemplate()` → `{ page: { widthMm, heightMm, marginMm: { top, right, bottom, left } }, blocks: [...] }`, and `renderSheets()` → a Puppeteer page loaded from `public/form.html` in print media with fonts settled. Tasks 2–4 add assertions on the same two functions.

- [ ] **Step 1: Fetch the fonts**

```bash
cd fda-license-scraper
curl -sL -o web/public/fonts/THSarabunPSK.ttf "https://raw.githubusercontent.com/SarabunConsortium/TH-Sarabun-PSK/master/THSarabunPSK%20Regular.ttf"
curl -sL -o web/public/fonts/THSarabunPSK-Bold.ttf "https://raw.githubusercontent.com/SarabunConsortium/TH-Sarabun-PSK/master/THSarabunPSK%20Bold.ttf"
rm web/public/fonts/THSarabunNew.woff web/public/fonts/THSarabunNew-Bold.woff
```

Check both files start with `00010000` and are roughly 490KB and 377KB:

```bash
node -e "for (const f of ['web/public/fonts/THSarabunPSK.ttf','web/public/fonts/THSarabunPSK-Bold.ttf']) { const b = require('fs').readFileSync(f); console.log(f, b.length, b.subarray(0,4).toString('hex')); }"
```

- [ ] **Step 2: Write the failing test**

Create `test-form-parity.js`:

```js
'use strict';

/**
 * The record has to look like the Word original the office issues, so the
 * template is the fixture: this reads the measurements out of it and asserts
 * the rendered page against them.
 *
 *   node test-form-parity.js
 *
 * The template carries the inspecting officers' names and is not in the
 * repository, so this skips when it is not there.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const zip = require('./src/zip');

const TEMPLATE = path.join(__dirname, 'templates', 'inspection-form.docx');
const PAGE = pathToFileURL(path.join(__dirname, 'public', 'form.html')).href;

if (!fs.existsSync(TEMPLATE)) {
  console.log('skip — templates/inspection-form.docx not present');
  process.exit(0);
}

const twipsToMm = (twips) => Number(twips) / 1440 * 25.4;

/** The template's page setup and its blocks, in document order. */
function readTemplate() {
  const parts = zip.read(fs.readFileSync(TEMPLATE));
  const xml = parts.find((p) => p.name === 'word/document.xml').data.toString('utf8');
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)[1];

  const size = body.match(/<w:pgSz w:w="(\d+)" w:h="(\d+)"/);
  const margin = body.match(/<w:pgMar([^>]*)\/>/)[1];
  const attr = (name) => Number(margin.match(new RegExp(`w:${name}="(\\d+)"`))[1]);

  const blocks = (body.match(/<w:p [\s\S]*?<\/w:p>|<w:p\/>|<w:tbl>[\s\S]*?<\/w:tbl>/g) || [])
    .map((block) => {
      if (block.startsWith('<w:tbl')) return { type: 'table', block };
      const text = (block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      const sizeMatch = block.match(/<w:szCs w:val="(\d+)"/);
      return {
        type: 'paragraph',
        text,
        pt: sizeMatch ? Number(sizeMatch[1]) / 2 : null,
        block,
      };
    });

  return {
    page: {
      widthMm: twipsToMm(size[1]),
      heightMm: twipsToMm(size[2]),
      marginMm: {
        top: twipsToMm(attr('top')),
        right: twipsToMm(attr('right')),
        bottom: twipsToMm(attr('bottom')),
        left: twipsToMm(attr('left')),
      },
    },
    blocks,
  };
}

/** The record page, laid out for print with its fonts settled. */
async function renderSheets() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

/** Millimetres, from the CSS pixels the page reports. */
const pxToMm = (px) => px / 96 * 25.4;

(async () => {
  const template = readTemplate();
  const { browser, page } = await renderSheets();
  try {
    // --- page setup -------------------------------------------------------
    const sheet = await page.evaluate(() => {
      const node = document.querySelector('.sheet');
      const style = getComputedStyle(node);
      return {
        width: node.getBoundingClientRect().width,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
          .map(parseFloat),
        family: style.fontFamily,
        fontSize: parseFloat(style.fontSize),
      };
    });

    const close = (actual, expected, what) =>
      assert.ok(
        Math.abs(actual - expected) < 0.6,
        `${what}: ได้ ${actual.toFixed(2)} ควรเป็น ${expected.toFixed(2)}`
      );

    const [top, right, bottom, left] = sheet.padding.map(pxToMm);
    close(top, template.page.marginMm.top, 'ขอบบน');
    close(right, template.page.marginMm.right, 'ขอบขวา');
    close(bottom, template.page.marginMm.bottom, 'ขอบล่าง');
    close(left, template.page.marginMm.left, 'ขอบซ้าย');

    // --- typeface ---------------------------------------------------------
    assert.ok(
      /TH SarabunPSK/.test(sheet.family),
      `ฟอนต์ของแผ่นงานควรเป็น TH SarabunPSK ได้ ${sheet.family}`
    );
    const faces = await page.evaluate(() =>
      [...document.fonts].map((f) => `${f.family}|${f.weight}|${f.status}`)
    );
    assert.ok(
      faces.includes('TH SarabunPSK|400|loaded') && faces.includes('TH SarabunPSK|700|loaded'),
      `ฟอนต์ยังไม่โหลดครบ: ${faces.join(', ')}`
    );
    assert.ok(
      !faces.some((f) => /Sarabun New/.test(f)),
      'ยังมี TH Sarabun New ค้างอยู่ในหน้า'
    );

    // --- base type size ---------------------------------------------------
    // The body of the record is szCs 30 — 15pt.
    close(sheet.fontSize / 96 * 72, 15, 'ขนาดตัวอักษรพื้นฐาน (pt)');

    console.log('ok — หน้ากระดาษ ฟอนต์ และขนาดพื้นฐานตรงกับไฟล์ Word');
  } finally {
    await browser.close();
  }
})();

module.exports = { readTemplate };
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npm --prefix web run build && node test-form-parity.js
```

Expected: `AssertionError` on `ขอบบน: ได้ 15.00 ควรเป็น 12.00`.

- [ ] **Step 4: Point the page at the new font**

In `web/public/form.html`, replace both `@font-face` rules with:

```css
      @font-face {
        font-family: "TH SarabunPSK";
        src: url("./fonts/THSarabunPSK.ttf") format("truetype");
        font-weight: 400;
        font-style: normal;
        font-display: block;
      }
      @font-face {
        font-family: "TH SarabunPSK";
        src: url("./fonts/THSarabunPSK-Bold.ttf") format("truetype");
        font-weight: 700;
        font-style: normal;
        font-display: block;
      }
```

- [ ] **Step 5: Take the page setup from the template**

Replace the `@page` rule and the `.sheet` block's page metrics:

```css
      @page { size: A4; margin: 12mm 20mm 10mm; }
```

```css
      .sheet {
        width: 210mm;
        margin: 16px auto;
        padding: 12mm 20mm 10mm;
        background: #fff;
        color: #000;
        font-family: "TH SarabunPSK", "TH Sarabun New", "Leelawadee UI", sans-serif;
        font-weight: 400;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, .12);
        font-size: 15pt;
        line-height: 1.15;
      }
```

Keep the print rules that follow it, but drop `width: auto` overriding the sheet width in `@media print` only if it is still needed for the padding to come out right — the assertion on padding is what decides.

- [ ] **Step 6: Run the test again**

```bash
npm --prefix web run build && node test-form-parity.js
```

Expected: `ok — หน้ากระดาษ ฟอนต์ และขนาดพื้นฐานตรงกับไฟล์ Word`

- [ ] **Step 7: Add the script**

In `package.json`, beside the other checks:

```json
    "test:parity": "node test-form-parity.js",
```

- [ ] **Step 8: Commit**

```bash
git add web/public/fonts web/public/form.html test-form-parity.js package.json
git commit -m "feat: match the record's page setup and typeface to the Word original"
```

---

### Task 2: Paragraphs — wording, order and type size

**Files:**
- Modify: `test-form-parity.js` (add the paragraph assertions)
- Modify: `web/public/form.html` (the sheet markup)

**Interfaces:**
- Consumes: `readTemplate()` from Task 1 — `blocks[]` with `{ type, text, pt }`.
- Produces: every paragraph in the sheet carries `class="para"`; the two sheets between them hold the template's paragraphs in order. Task 3 relies on `.para` existing to find the blanks inside it.

The template's paragraphs, in order, with the type size and the tokens they carry. `¶` marks an empty paragraph, which is spacing in Word and gets a `.para.blank-line` in the HTML.

| # | pt | align | text |
|---|----|-------|------|
| 0 | — | center | ¶ (holds the seal) |
| 1 | 18 | center | บันทึกการตรวจสอบการประกอบวิชาชีพของผู้ประกอบวิชาชีพเภสัชกรรม |
| 2 | 15 | center | ¶ |
| 3 | 15 | justify | อาศัยอำนาจตามความในมาตรา 47 และมาตรา 49 แห่งพระราชบัญญัติวิชาชีพเภสัชกรรม พ.ศ. 2537 พนักงานเจ้าหน้าที่ประกอบด้วย + `officers1`, `officers2` (14pt) |
| 4 | 15 | justify | ได้ทำการตรวจสถานที่ทำการของผู้ประกอบวิชาชีพเภสัชกรรมชื่อ `{{pharmacistName}}` |
| 5 | 15 | justify | ใบอนุญาตเป็นผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ. `{{pharmacistLicenseNo}}` หมดอายุวันที่ `{{pharmacistLicenseExpiry}}` |
| 6 | 15 | justify | สถานที่ทำการประเภท ขายยาแผนปัจจุบัน ชื่อ `{{placeName}}` |
| 7 | 15 | justify | ตั้งอยู่เลขที่ `{{houseNo}}` หมู่บ้าน/อาคาร `{{village}}` |
| 8 | 15 | justify | หมู่ที่ `{{moo}}` ตรอก/ซอย `{{soi}}` ถนน `{{road}}` |
| 9 | 15 | justify | แขวง/ตำบล `{{subdistrict}}` เขต/อำเภอ `{{district}}` จังหวัด `{{province}}` |
| 10 | 15 | justify | เบอร์โทรศัพท์ติดต่อ `{{phone}}` เขตสถานีตำรวจ `{{policeStation}}` |
| 11 | 15 | justify | เมื่อวันที่ `{{inspectDate}}` เวลา `{{inspectTime}}` น. ปรากฏผลดังนี้ |
| 12 | 14 | justify | 1. ชื่อผู้รับอนุญาตของสถานที่ทำการ `{{licenseeName}}` |
| 13 | 15 | justify | ชื่อผู้ดำเนินการกิจการ `{{operatorName}}` ใบอนุญาตขายยาแผนปัจจุบันเลขที่ `{{licenseNo}}` |
| 14 | 14 | justify | 2. ชื่อผู้มีหน้าที่ปฏิบัติการ `{{dutyPharmacist}}` |
| 15 | 14 | justify | ใบอนุญาตเป็นผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ. `{{dutyLicenseNo}}` หมดอายุวันที่ `{{dutyLicenseExpiry}}` เวลาทำการ `{{dutyHours}}` |
| 16 | 15 | justify | 3. สรุปผลการตรวจสอบพบ ดังนี้ |
| 17–26 | 14 | justify | ข้อ (1)–(8), with their tick boxes and blanks |
| 27 | 14 | justify | ¶ |
| 28 | 14 | left | ลงชื่อ เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต |
| 29 | 14 | left | ( `{{signPage1Name}}` ) |
| 30 | 14 | right | ต่อจากหน้าที่ 1 — the first paragraph of sheet 2 |
| 31 | 14 | justify | 3. สรุปผลการตรวจสอบพบ (ต่อ) |
| 32–36 | 14 | justify | ข้อ (9)–(12) and the closing paragraph, each with 6pt above |
| 37–38 | 15 | justify | ¶ ¶ |
| 39 | — | — | the signature table (Task 4) |
| 40–42 | 15/14/14 | — | ¶ ¶ ¶ |

Read the exact text of paragraphs 17–26 and 32–36 straight out of the template rather than retyping them:

```bash
node -e "
const zip=require('./src/zip'),fs=require('fs');
const parts=zip.read(fs.readFileSync('templates/inspection-form.docx'));
const xml=parts.find(p=>p.name==='word/document.xml').data.toString('utf8');
const body=xml.match(/<w:body>([\s\S]*)<\/w:body>/)[1];
const blocks=body.match(/<w:p [\s\S]*?<\/w:p>|<w:p\/>|<w:tbl>[\s\S]*?<\/w:tbl>/g);
blocks.forEach((b,i)=>{ if(b.startsWith('<w:tbl')) return console.log(i,'TABLE');
  const t=(b.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)||[]).map(x=>x.replace(/<[^>]+>/g,'')).join('').replace(/\s+/g,' ').trim();
  console.log(i, JSON.stringify(t)); });
"
```

- [ ] **Step 1: Write the failing assertions**

Append to `test-form-parity.js`, inside the `try` block, after the type-size check:

```js
    // --- paragraphs -------------------------------------------------------
    // The tokens stand for the blanks, which hold no text until the record is
    // filled in; strip them from the template's text before comparing.
    const expected = template.blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => ({
        text: b.text.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim(),
        pt: b.pt,
      }))
      .filter((b) => b.text !== '');

    const actual = await page.evaluate(() =>
      [...document.querySelectorAll('.sheet .para')].map((node) => ({
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        pt: Math.round(parseFloat(getComputedStyle(node).fontSize) / 96 * 72 * 2) / 2,
      })).filter((p) => p.text !== '')
    );

    assert.strictEqual(
      actual.length,
      expected.length,
      `จำนวนย่อหน้าไม่ตรง: หน้าเว็บ ${actual.length} ไฟล์ Word ${expected.length}`
    );
    expected.forEach((want, i) => {
      assert.strictEqual(
        actual[i].text,
        want.text,
        `ย่อหน้าที่ ${i} ไม่ตรง\n  หน้าเว็บ: ${actual[i].text}\n  Word:     ${want.text}`
      );
      assert.strictEqual(
        actual[i].pt,
        want.pt,
        `ขนาดตัวอักษรย่อหน้าที่ ${i}: หน้าเว็บ ${actual[i].pt}pt Word ${want.pt}pt`
      );
    });

    console.log(`ok — ${expected.length} ย่อหน้าตรงกับไฟล์ Word ทั้งข้อความและขนาด`);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node test-form-parity.js
```

Expected: `จำนวนย่อหน้าไม่ตรง` — the sheet has no `.para` elements yet.

- [ ] **Step 3: Rebuild the sheet markup**

Work through the sheets one paragraph at a time against the table above and the dump from the command at the head of this task. Each paragraph becomes:

```html
<p class="para">ได้ทำการตรวจสถานที่ทำการของผู้ประกอบวิชาชีพเภสัชกรรมชื่อ<input class="blank" name="pharmacistName" /></p>
```

with the size classes:

```css
      .para { margin: 0; text-align: justify; text-justify: inter-word; }
      .para.sm { font-size: 14pt; }
      .para.title { font-size: 18pt; font-weight: 700; text-align: center; }
      .para.centre { text-align: center; }
      .para.right { text-align: right; }
      .para.left { text-align: left; }
      .para.gap { margin-top: 6pt; }   /* Word's spacing w:before="120" */
      .para.blank-line { min-height: 1em; }
```

Keep every existing `name` and every `data-name` on the tick boxes. The blanks stay `<input class="blank">` for now — Task 3 changes how they are laid out.

- [ ] **Step 4: Run the test until it passes**

```bash
npm --prefix web run build && node test-form-parity.js
```

Expected: both `ok` lines. Fix the wording the assertion names until it does — the message prints both strings.

- [ ] **Step 5: Commit**

```bash
git add web/public/form.html test-form-parity.js
git commit -m "feat: rebuild the record's paragraphs against the Word original"
```

---

### Task 3: Blanks that flow with the line

**Files:**
- Modify: `web/public/form.html` (blank styling, `applyData`, `prepareForPrint`, delete `fitSheet` and `shrinkToFit`)
- Modify: `test-form-parity.js` (blank-count assertion)

**Interfaces:**
- Consumes: `.para` from Task 2.
- Produces: `prepareForPrint()` with no fitting pass — Task 5's smoke test relies on the record no longer shrinking.

In the template a blank is not a box: it is a run of text carrying `w:u val="dotted"`, so it sits in the line and the line wraps around it. Consecutive dotted runs are one blank.

- [ ] **Step 1: Write the failing assertion**

Append inside the `try` block:

```js
    // --- blanks -----------------------------------------------------------
    // Word writes one blank as many consecutive dotted runs; count the groups.
    const wantBlanks = template.blocks
      .filter((b) => b.type === 'paragraph')
      .reduce((total, b) => {
        const runs = b.block.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
        let groups = 0;
        let inGroup = false;
        for (const run of runs) {
          const dotted = /<w:u w:val="dotted"/.test(run);
          if (dotted && !inGroup) groups += 1;
          inGroup = dotted;
        }
        return total + groups;
      }, 0);

    const haveBlanks = await page.evaluate(
      () => document.querySelectorAll('.sheet .blank').length
    );
    assert.strictEqual(
      haveBlanks,
      wantBlanks,
      `จำนวนช่องกรอกไม่ตรง: หน้าเว็บ ${haveBlanks} Word ${wantBlanks}`
    );

    console.log(`ok — ช่องกรอก ${haveBlanks} ช่องตรงกับไฟล์ Word`);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node test-form-parity.js
```

Expected: `จำนวนช่องกรอกไม่ตรง` with the two counts.

- [ ] **Step 3: Make the blanks flow**

Replace the blank's styling with one that grows into the line and never overflows it:

```css
      /*
       * A blank in the Word original is dotted-underlined text inside the
       * paragraph, not a box, so it takes the space left on the line and the
       * line grows when the value is long. Laid out per line with flex, since
       * that is what gives the last blank on a line its run to the margin.
       */
      .line { display: flex; align-items: baseline; gap: 0; }
      .blank {
        flex: 1 1 0;
        min-width: 2em;
        border: 0;
        border-bottom: 1px dotted #000;
        background: transparent;
        font: inherit;
        color: inherit;
        padding: 0 2px;
      }
```

Add or remove nothing else about the blanks — their `name` attributes are unchanged.

- [ ] **Step 4: Delete the fitting passes**

Remove `fitSheet()` and `shrinkToFit()` entirely, and reduce `prepareForPrint()` to:

```js
      /** Hides the toolbar and the on-screen fill highlight before page.pdf(). */
      window.prepareForPrint = function prepareForPrint() {
        const toolbar = document.querySelector('.toolbar');
        if (toolbar) toolbar.remove();
        for (const input of document.querySelectorAll('input.blank')) {
          input.classList.remove('filled');
        }
      };
```

Delete the `.overflow` and `.line.wrap` rules that only `shrinkToFit()` used.

- [ ] **Step 5: Run every check**

```bash
npm --prefix web run build && node test-form-parity.js && node smoke-form.js
```

Expected: the parity test prints all four `ok` lines. `smoke-form.js` fails on `3 !== 2` — that assertion is Task 5's; leave it failing and note it.

- [ ] **Step 6: Commit**

```bash
git add web/public/form.html test-form-parity.js
git commit -m "feat: let the record's blanks flow with the line, as Word does"
```

---

### Task 4: Seal, signature table and footer

**Files:**
- Create: `web/public/seal.png` (extracted from the template)
- Modify: `web/public/form.html`
- Modify: `test-form-parity.js`

**Interfaces:**
- Consumes: `.para`, `.blank` from Tasks 2–3.
- Produces: `.seal`, `.signatures`, `.page-no` in the sheet markup.

From the template: the seal is anchored to the top-left of page 1, `cx=668968 cy=972000` EMU — 17.6 × 25.6mm — offset `-201769` EMU (5.6mm) above the top margin. The signature table is two columns of 4814 twips (81.6mm) with every border set to `none`: two `ลงชื่อ` rows in the left column, five in the right. The footer reads `หน้าที่ N จาก 2`, centred.

- [ ] **Step 1: Extract the seal**

```bash
node -e "
const zip=require('./src/zip'),fs=require('fs');
const parts=zip.read(fs.readFileSync('templates/inspection-form.docx'));
fs.writeFileSync('web/public/seal.png', parts.find(p=>p.name==='word/media/image1.png').data);
console.log('seal', fs.statSync('web/public/seal.png').size, 'bytes');
"
```

Expected: about 30399 bytes.

- [ ] **Step 2: Write the failing assertions**

Append inside the `try` block:

```js
    // --- seal, signatures, footer ----------------------------------------
    const furniture = await page.evaluate(() => {
      const seal = document.querySelector('.sheet .seal');
      const rect = seal && seal.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.signatures tr')];
      return {
        seal: rect && { w: rect.width, h: rect.height },
        columns: document.querySelectorAll('.signatures col').length,
        left: rows.filter((r) => r.children[0] && r.children[0].textContent.includes('ลงชื่อ')).length,
        right: rows.filter((r) => r.children[1] && r.children[1].textContent.includes('ลงชื่อ')).length,
        footers: [...document.querySelectorAll('.page-no')].map((n) =>
          n.textContent.replace(/\s+/g, ' ').trim()
        ),
      };
    });

    assert.ok(furniture.seal, 'ไม่พบตราสภาเภสัชกรรมบนแผ่นงาน');
    close(pxToMm(furniture.seal.w), 17.6, 'ความกว้างตราสภาฯ (มม.)');
    close(pxToMm(furniture.seal.h), 25.6, 'ความสูงตราสภาฯ (มม.)');
    assert.strictEqual(furniture.columns, 2, 'ตารางลงชื่อควรมี 2 คอลัมน์');
    assert.strictEqual(furniture.left, 2, 'คอลัมน์ซ้ายควรมี 2 บรรทัดลงชื่อ');
    assert.strictEqual(furniture.right, 5, 'คอลัมน์ขวาควรมี 5 บรรทัดลงชื่อ');
    assert.deepStrictEqual(
      furniture.footers,
      ['หน้าที่ 1 จาก 2', 'หน้าที่ 2 จาก 2'],
      `ท้ายกระดาษไม่ตรง: ${furniture.footers.join(' / ')}`
    );

    console.log('ok — ตราสภาฯ ตารางลงชื่อ และท้ายกระดาษตรงกับไฟล์ Word');
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node test-form-parity.js
```

Expected: `ไม่พบตราสภาเภสัชกรรมบนแผ่นงาน`.

- [ ] **Step 4: Add the furniture**

The seal, in the first paragraph of sheet 1:

```html
<img class="seal" src="./seal.png" alt="ตราสภาเภสัชกรรม" />
```

```css
      /* Anchored top-left of page 1 and riding 5.6mm above the top margin,
         exactly as the template places it. */
      .sheet { position: relative; }
      .seal {
        position: absolute;
        top: calc(12mm - 5.6mm);
        left: 20mm;
        width: 17.6mm;
        height: 25.6mm;
      }
```

The signature table, replacing whatever stands in for it now:

```html
<table class="signatures">
  <colgroup><col /><col /></colgroup>
  <tbody>
    <tr><td>ลงชื่อ<input class="blank" name="signOfficer1" /></td><td>ลงชื่อ<input class="blank" name="signWitness1" /></td></tr>
    <tr><td>ลงชื่อ<input class="blank" name="signOfficer2" /></td><td>ลงชื่อ<input class="blank" name="signWitness2" /></td></tr>
    <tr><td></td><td>ลงชื่อ<input class="blank" name="signWitness3" /></td></tr>
    <tr><td></td><td>ลงชื่อ<input class="blank" name="signWitness4" /></td></tr>
    <tr><td></td><td>ลงชื่อ<input class="blank" name="signWitness5" /></td></tr>
  </tbody>
</table>
```

Take the real `name` for each row from the template's tokens with:

```bash
node -e "
const zip=require('./src/zip'),fs=require('fs');
const parts=zip.read(fs.readFileSync('templates/inspection-form.docx'));
const xml=parts.find(p=>p.name==='word/document.xml').data.toString('utf8');
const tbl=xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)[0];
(tbl.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g)||[]).forEach((r,i)=>{
  const cells=(r.match(/<w:tc>[\s\S]*?<\/w:tc>/g)||[]).map(c=>(c.match(/<w:t[^>]*>([^<]*)<\/w:t>/g)||[]).map(x=>x.replace(/<[^>]+>/g,'')).join('').replace(/\s+/g,' ').trim());
  console.log('row'+i, JSON.stringify(cells));
});
"
```

```css
      .signatures { width: 100%; border-collapse: collapse; }
      .signatures col { width: 81.6mm; }
      .signatures td { border: 0; padding: 0 0 6pt 0; vertical-align: bottom; }
```

The footer, once per sheet:

```html
<div class="page-no">หน้าที่ 1 จาก 2</div>
```

- [ ] **Step 5: Run every check**

```bash
npm --prefix web run build && node test-form-parity.js
```

Expected: all five `ok` lines.

- [ ] **Step 6: Commit**

```bash
git add web/public/seal.png web/public/form.html test-form-parity.js
git commit -m "feat: add the seal, signature table and footer from the Word original"
```

---

### Task 5: Smoke test, docs and a look at the result

**Files:**
- Modify: `smoke-form.js`
- Modify: `README.md`
- Modify: `package.json` (fold `test:parity` into the aggregate check if one exists)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new — this task closes the loop.

- [ ] **Step 1: Loosen the page assertion**

In `smoke-form.js`, replace the two-page assertion with one that says what it now means:

```js
    // The record is two pages for a shop whose details are of ordinary
    // length. It is allowed to run over for a long one, exactly as the Word
    // copy does — the type is no longer shrunk to prevent it.
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.strictEqual(pages, 2, `expected 2 pages for the sample record, got ${pages}`);
```

- [ ] **Step 2: Run it**

```bash
node smoke-form.js
```

Expected: `OK — address parsed, … 2 pages, … DOCX`. If it reports 3, the sample record now overflows: check the fit against `templates/inspection-form.docx` opened in Word before changing any measurement — the number that is wrong is in the HTML, not in the assertion.

- [ ] **Step 3: Look at the two side by side**

Render the record filled with the smoke sample and compare it against the Word file opened in Word, page by page: title, the officers' line, each numbered item, the signature block, the footer. Note any line that breaks at a different word — the spec accepts those, but a line that breaks a whole clause early usually means a margin or size is still off.

```bash
node -e "
const { renderFormPdf } = require('./src/scraper');
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('test/fixtures/form-sample.json', 'utf8'));
renderFormPdf(payload).then(pdf => { fs.writeFileSync('record.pdf', pdf); console.log('record.pdf', pdf.length); process.exit(0); });
"
```

If `test/fixtures/form-sample.json` does not exist, create it from the payload literal in `smoke-form.js` as part of this step and commit it.

- [ ] **Step 4: Update the README**

Replace the **Fonts** paragraph under Deploying with:

```markdown
**Fonts.** The record carries its own typeface: `web/public/fonts/` ships TH
SarabunPSK — the face the office's Word template names — and `form.html`
declares it in an `@font-face`, so a laptop, the container and a Vercel
function all set the sheet identically. The font is SIPA's, under the SIL Open
Font License 1.1. `fonts-thai-tlwg` stays in the image as a fallback.
```

And add, under the checks the README lists:

```markdown
`npm run test:parity` compares the rendered record against
`templates/inspection-form.docx` — page setup, typeface, every paragraph's
wording and size, the number of blanks, the seal, the signature table and the
footer. It skips when the template is not present, so it is a check for a
developer's machine rather than for the deployment.
```

- [ ] **Step 5: Run everything**

```bash
npm --prefix web run build \
  && node test-parse.js \
  && node test-form-parity.js \
  && node smoke-form.js \
  && node smoke-pharmacist.js \
  && node smoke.js
```

Expected: every one prints its `ok` line.

- [ ] **Step 6: Commit**

```bash
git add smoke-form.js README.md package.json test/fixtures/form-sample.json
git commit -m "test: check the record against its Word original, and document it"
```

---

## Self-review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Page margins 12/20/10/20mm | 1 |
| TH SarabunPSK embedded, TH Sarabun New removed | 1 |
| Type sizes 18/15/14pt per paragraph | 1 (base), 2 (per paragraph) |
| 6pt space above the paragraphs Word marks | 2 |
| 42 paragraphs, wording and order | 2 |
| Justified body paragraphs | 2 |
| Blanks flowing in the line, dotted, elastic | 3 |
| `fitSheet()` and `shrinkToFit()` removed | 3 |
| Seal, 17.6 × 25.6mm, top-left, 5.6mm above the margin | 4 |
| Signature table, 2 columns of 81.6mm, no borders, 2 + 5 rows | 4 |
| Footer `หน้าที่ N จาก 2` | 4 |
| `test-form-parity.js`, skipping when the template is absent | 1, extended by 2–4 |
| `smoke-form.js` assertion relaxed to the sample record | 5 |
| Token names unchanged, DOCX path untouched | constraint, verified in 2 and 5 |

**Placeholders:** none — every step carries the code or the command it needs.

**Type consistency:** `readTemplate()` returns `{ page, blocks }` in Task 1 and is read as `template.page` and `template.blocks` in Tasks 2–4; `close()` and `pxToMm()` are defined in Task 1 and used in Task 4; `.para`, `.blank`, `.seal`, `.signatures`, `.page-no` are the only selectors the assertions rely on, and each is introduced in the task that asserts it.

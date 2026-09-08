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
// public/form.html is the build output, and it is what renderFormPdf() opens —
// so it, not the source, is what has to be measured. That cuts both ways: a
// stale build would let this suite pass on a file nobody edited. Compare the
// two and stop rather than report on the wrong one.
const SOURCE = path.join(__dirname, 'web', 'public', 'form.html');
const BUILT = path.join(__dirname, 'public', 'form.html');
const PAGE = pathToFileURL(BUILT).href;

if (!fs.existsSync(TEMPLATE)) {
  console.log('skip — templates/inspection-form.docx not present');
  process.exit(0);
}

if (!fs.existsSync(BUILT) || fs.statSync(BUILT).mtimeMs < fs.statSync(SOURCE).mtimeMs) {
  console.error(
    'public/form.html is older than web/public/form.html — run `npm --prefix web run build` first'
  );
  process.exit(1);
}

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'test', 'fixtures', 'form-sample.json'), 'utf8')
);

const twipsToMm = (twips) => Number(twips) / 1440 * 25.4;
// DrawingML anchors and shape extents are in EMU — 36000 per millimetre,
// same unit the seal's <wp:extent> and <wp:posOffset> are written in.
const emuToMm = (emu) => Number(emu) / 36000;

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
      /*
       * Where the paragraph's first line starts. Word gets there two ways and
       * they compose: <w:ind w:left/w:firstLine> in twips, and leading
       * <w:tab/> runs, which are not an indent at all but land in the same
       * place — a tab advances to the next stop on the 12.7mm default grid
       * (w:defaultTabStop 720), so one at the head of a 992-twip first line
       * indents to 25.4mm, not to 30.2mm.
       */
      const pPr = (block.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
      const num = (re) => Number((pPr.match(re) || [])[1] || 0);
      let lead = 0;
      for (const run of block.matchAll(/<w:tab\/>|<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
        if (run[0] === '<w:tab/>') lead += 1;
        else if (run[1].trim() !== '') break;
      }
      let firstLineMm = twipsToMm(num(/w:firstLine="(\d+)"/));
      for (let i = 0; i < lead; i += 1) {
        firstLineMm = (Math.floor(firstLineMm / 12.7) + 1) * 12.7;
      }
      return {
        type: 'paragraph',
        text,
        pt: sizeMatch ? Number(sizeMatch[1]) / 2 : null,
        indentMm: twipsToMm(num(/<w:ind[^>]*w:left="(\d+)"/)) + firstLineMm,
        block,
      };
    });

  // The seal — the document's one <wp:extent>/<wp:posOffset> anchor.
  const extent = xml.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
  const offset = xml.match(/<wp:posOffset>(-?\d+)<\/wp:posOffset>/);

  // The signature table's own <w:tblGrid> — both columns are the same
  // width in the template, so either <w:gridCol> will do.
  const tableBlock = blocks.find((b) => b.type === 'table');
  const gridCol = tableBlock && tableBlock.block.match(/<w:gridCol w:w="(\d+)"\/>/);

  // How many paragraphs each <w:tc> of the signature table holds — that is
  // how many lines the cell is entitled to, and no more. Word gives a row the
  // height of its tallest cell, so the row's budget is the larger of the two.
  const cellParagraphs = (tableBlock ? tableBlock.block.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || [] : [])
    .map((row) =>
      (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(
        (cell) => (cell.match(/<w:p [\s\S]*?<\/w:p>|<w:p\/>/g) || []).length
      )
    );

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
      // w:footer — the footer band, measured up from the paper's edge.
      footerMm: twipsToMm(attr('footer')),
    },
    blocks,
    seal: extent && {
      widthMm: emuToMm(extent[1]),
      heightMm: emuToMm(extent[2]),
      offsetMm: offset ? emuToMm(offset[1]) : null,
    },
    signaturesColMm: gridCol ? twipsToMm(gridCol[1]) : null,
    cellParagraphs,
  };
}

/**
 * The record page, laid out for print with its fonts settled and *filled in*.
 * An empty record is not the one the office prints: every defect this suite
 * missed — the seal over item 3's first line, the signature labels wrapping,
 * the footer up the page — only has a size once there is text on the sheet.
 * Same fixture the smoke check uses.
 */
async function renderSheets() {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.emulateMediaType('print');
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((filled) => window.applyData(filled), FIXTURE);
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

    // --- paragraphs -------------------------------------------------------
    // The tokens stand for the blanks, which hold no text until the record is
    // filled in; strip them from the template's text before comparing.
    const expected = template.blocks
      .filter((b) => b.type === 'paragraph')
      .map((b) => ({
        text: b.text.replace(/\{\{[^}]*\}\}/g, ' ').replace(/\s+/g, ' ').trim(),
        pt: b.pt,
        indentMm: b.indentMm,
      }))
      .filter((b) => b.text !== '');

    const actual = await page.evaluate(() =>
      [...document.querySelectorAll('.sheet .para')].map((node) => ({
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        pt: Math.round(parseFloat(getComputedStyle(node).fontSize) / 96 * 72 * 2) / 2,
        indentMm:
          (parseFloat(getComputedStyle(node).marginLeft) +
            parseFloat(getComputedStyle(node).textIndent)) /
          96 *
          25.4,
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
      // The indent is what tells the numbered items apart from the running
      // text; without it the record reads as one undifferentiated block.
      assert.ok(
        Math.abs(actual[i].indentMm - want.indentMm) <= 0.5,
        `ย่อหน้าที่ ${i} ย่อหน้าไม่ตรง: หน้าเว็บ ${actual[i].indentMm.toFixed(2)}mm ` +
          `Word ${want.indentMm.toFixed(2)}mm — ${want.text.slice(0, 40)}`
      );
    });

    console.log(`ok — ${expected.length} ย่อหน้าตรงกับไฟล์ Word ทั้งข้อความและขนาด`);

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

    // --- seal, signatures, footer ----------------------------------------
    const furniture = await page.evaluate(() => {
      const seal = document.querySelector('.sheet .seal');
      const rect = seal && seal.getBoundingClientRect();
      const rows = [...document.querySelectorAll('.signatures tr')];
      const firstRowCells = rows[0] ? [...rows[0].children] : [];
      return {
        seal: rect && { w: rect.width, h: rect.height },
        columns: document.querySelectorAll('.signatures col').length,
        colWidths: firstRowCells.map((td) => td.getBoundingClientRect().width),
        left: rows.filter((r) => r.children[0] && r.children[0].textContent.includes('ลงชื่อ')).length,
        right: rows.filter((r) => r.children[1] && r.children[1].textContent.includes('ลงชื่อ')).length,
        footers: [...document.querySelectorAll('.page-no')].map((n) =>
          n.textContent.replace(/\s+/g, ' ').trim()
        ),
      };
    });

    assert.ok(furniture.seal, 'ไม่พบตราสภาเภสัชกรรมบนแผ่นงาน');
    assert.ok(template.seal, 'ไม่พบขนาดตราในไฟล์ Word');
    close(pxToMm(furniture.seal.w), template.seal.widthMm, 'ความกว้างตราสภาฯ (มม.)');
    close(pxToMm(furniture.seal.h), template.seal.heightMm, 'ความสูงตราสภาฯ (มม.)');
    assert.strictEqual(furniture.columns, 2, 'ตารางลงชื่อควรมี 2 คอลัมน์');
    assert.ok(template.signaturesColMm, 'ไม่พบความกว้างคอลัมน์ในตารางลงชื่อของไฟล์ Word');
    furniture.colWidths.forEach((w, i) =>
      close(pxToMm(w), template.signaturesColMm, `ความกว้างคอลัมน์ที่ ${i} ของตารางลงชื่อ (มม.)`)
    );
    assert.strictEqual(furniture.left, 2, 'คอลัมน์ซ้ายควรมี 2 บรรทัดลงชื่อ');
    assert.strictEqual(furniture.right, 5, 'คอลัมน์ขวาควรมี 5 บรรทัดลงชื่อ');
    assert.deepStrictEqual(
      furniture.footers,
      ['หน้าที่ 1 จาก 2', 'หน้าที่ 2 จาก 2'],
      `ท้ายกระดาษไม่ตรง: ${furniture.footers.join(' / ')}`
    );

    console.log('ok — ตราสภาฯ ตารางลงชื่อ และท้ายกระดาษตรงกับไฟล์ Word');

    // --- the seal must not sit on top of the record ----------------------
    // The template floats it with <wp:wrapNone/>, so nothing in the flow is
    // pushed aside and only the layout above it keeps the text clear. When
    // that stopped being true, item 3 opened underneath the seal and
    // "อาศัยอำนาจตาม" could not be read. Ink, not boxes: Range rects are what
    // is actually drawn.
    const overSeal = await page.evaluate(() => {
      const seal = document.querySelector('.seal').getBoundingClientRect();
      const hits = [];
      for (const para of document.querySelectorAll('.sheet .para')) {
        if (para.contains(document.querySelector('.seal'))) continue; // its own anchor
        const range = document.createRange();
        range.selectNodeContents(para);
        for (const line of range.getClientRects()) {
          if (line.width < 1 || line.height < 1) continue;
          if (
            line.right > seal.left && line.left < seal.right &&
            line.bottom > seal.top && line.top < seal.bottom
          ) {
            hits.push(`${para.textContent.trim().slice(0, 24)}… (${(seal.bottom - line.top).toFixed(2)}px ทับ)`);
          }
        }
      }
      return hits;
    });
    assert.deepStrictEqual(overSeal, [], `บรรทัดทับตราสภาฯ: ${overSeal.join(' / ')}`);

    // --- no signature cell may run longer than the template's -------------
    // Each <w:tc> is a fixed number of paragraphs; a cell that needs more
    // lines than that is a label wrapping where the template does not.
    const cellLines = await page.evaluate(() =>
      [...document.querySelectorAll('.signatures tr')].map((row) =>
        [...row.children].map((td) => {
          // The cell's own lines, not the row's: a <td> is stretched to the
          // height of the tallest cell beside it.
          const lh = parseFloat(getComputedStyle(td).lineHeight);
          return {
            lines: [...td.children].reduce(
              (n, line) => n + Math.round(line.getBoundingClientRect().height / lh),
              0
            ),
            text: td.textContent.replace(/\s+/g, ' ').trim().slice(0, 40),
          };
        })
      )
    );
    assert.strictEqual(
      cellLines.length,
      template.cellParagraphs.length,
      `จำนวนแถวตารางลงชื่อไม่ตรง: หน้าเว็บ ${cellLines.length} Word ${template.cellParagraphs.length}`
    );
    /* The office asked for the officers' signature blocks to sit an equal
       distance apart. Word leaves row 1's officer cell a paragraph short of
       the others, which bunches the second and third signatures together, so
       that cell carries one line more than the template — deliberately. */
    const EXTRA_LINE = { '1,1': 1 };
    cellLines.forEach((row, r) =>
      row.forEach((cell, c) =>
        assert.ok(
          cell.lines <= template.cellParagraphs[r][c] + (EXTRA_LINE[`${r},${c}`] || 0),
          `ช่องลงชื่อ แถว ${r} คอลัมน์ ${c} ใช้ ${cell.lines} บรรทัด Word ให้ ${template.cellParagraphs[r][c]}: ${cell.text}`
        )
      )
    );

    // --- the footer sits on the page, not on the content ------------------
    // .sheet has no min-height (see the page-height check below, which needs
    // it not to), so `bottom:` would follow the content up the page. The
    // template puts the line on the bottom margin: 297mm - 10mm = 287mm,
    // inside the footer band w:footer="709" opens 12.5mm above the edge.
    const footerBottoms = await page.evaluate(() =>
      [...document.querySelectorAll('.page-no')].map((node) => {
        const sheet = node.closest('.sheet').getBoundingClientRect();
        return node.getBoundingClientRect().bottom - sheet.top;
      })
    );
    const wantFooterMm = template.page.heightMm - template.page.marginMm.bottom;
    footerBottoms.forEach((px, i) => {
      const got = pxToMm(px);
      assert.ok(
        Math.abs(got - wantFooterMm) <= 1,
        `ท้ายกระดาษแผ่นที่ ${i + 1} อยู่ที่ ${got.toFixed(2)}mm ควรเป็น ${wantFooterMm.toFixed(2)}mm`
      );
      assert.ok(
        got >= template.page.heightMm - template.page.footerMm - 6,
        `ท้ายกระดาษแผ่นที่ ${i + 1} หลุดออกนอกแถบท้ายกระดาษของไฟล์ Word`
      );
    });

    // --- a blank may not swallow what is typed into it --------------------
    // A clipped value still reaches collect() and so still reaches the DOCX:
    // the PDF and the Word copy of one record disagree, and the officer is
    // never told. Every single-line blank clips somewhere — 85-odd Thai
    // characters at 15pt, less on a short one — so the record does not
    // promise to show everything, it promises to *say* when it cannot. Feed
    // every blank far more than it can hold and check that each one either
    // shows the lot or is marked.
    const silent = await page.evaluate(() => {
      const long = 'ก'.repeat(200);
      const quiet = [];
      for (const field of document.querySelectorAll('input.blank, textarea.blank')) {
        const was = field.value;
        field.value = long;
        field.dispatchEvent(new Event('input'));
        const clipped =
          field.scrollWidth > field.clientWidth + 1 ||
          field.scrollHeight > field.clientHeight + 1;
        if (clipped && !field.classList.contains('over')) {
          quiet.push(`${field.name} (${field.scrollWidth}x${field.scrollHeight} ใน ${field.clientWidth}x${field.clientHeight})`);
        }
        field.value = was;
        field.dispatchEvent(new Event('input'));
      }
      return quiet;
    });
    assert.deepStrictEqual(silent, [], `ช่องกรอกที่ตัดข้อความทิ้งเงียบ ๆ: ${silent.join(' / ')}`);

    console.log('ok — ตราไม่ทับข้อความ ช่องลงชื่อไม่ตกบรรทัด ท้ายกระดาษอยู่ขอบล่าง และไม่มีช่องใดตัดข้อความ');

    // --- nothing on the page may move while a blank is typed into ---------
    // The rules are on Word's tab grid, so what is typed on one cannot decide
    // how wide it is. When it did, every keystroke re-measured the grid and
    // the rules after it on the line — and the paragraph's own wrapping —
    // shifted under the cursor. Type into every single-line blank in turn and
    // check that every rule on the sheet is exactly where it was.
    const moved = await page.evaluate(() => {
      const rules = () =>
        Array.from(document.querySelectorAll('.blank, .tab')).map((el) => {
          const box = el.getBoundingClientRect();
          return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
        });
      const before = rules();
      const shifted = [];
      for (const field of document.querySelectorAll('input.blank')) {
        const was = field.value;
        field.value = 'ก'.repeat(120);
        field.dispatchEvent(new Event('input'));
        const after = rules();
        if (after.join('|') !== before.join('|')) shifted.push(field.name);
        field.value = was;
        field.dispatchEvent(new Event('input'));
      }
      return shifted;
    });
    assert.deepStrictEqual(moved, [], `พิมพ์แล้วบรรทัดขยับ: ${moved.join(', ')}`);

    console.log('ok — พิมพ์ลงช่องกรอกแล้วไม่มีบรรทัดใดขยับ');

    // --- signatures and the appendix may not move the record ---------------
    // The wizard draws signatures over the rules and appends a photo sheet.
    // Both are additions to a page whose every line is on Word's own grid, so
    // the test is not that they look right — it is that nothing else moved.
    //
    // layoutBlanks() is NOT idempotent on its first repeat: a second
    // applyData(FIXTURE) call (the harness's setup already made the first, at
    // line ~154) drifts two fields (buyRequest, dutyNote) even with no
    // signatures involved — pre-existing, tracked separately. It DOES settle
    // after that: a third call with the identical payload lands in the same
    // place as the second. So this block first proves that settling — a
    // third applyData(FIXTURE) must reproduce the second call's snapshot
    // exactly — and only then applies the signatures and checks against that
    // settled baseline. If this ever fails, the convergence assertion below
    // tells you whether the drift is the pre-existing layout bug or an
    // actual signature-placement regression, instead of leaving that to be
    // rediscovered by hand.
    const beforeSign = await page.evaluate((filled) => {
      window.applyData(filled);
      return [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
      });
    }, FIXTURE);

    const settled = await page.evaluate((filled) => {
      window.applyData(filled);
      return [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
      });
    }, FIXTURE);

    assert.deepStrictEqual(settled, beforeSign, 'หน้ากระดาษยังไม่นิ่งหลังเรียก applyData ซ้ำ (layoutBlanks ไม่ลู่เข้า)');

    const signature =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const afterSign = await page.evaluate((filled, png) => {
      window.applyData({
        ...filled,
        signatures: {
          page1: png, duty: png, licensee: png,
          officer1: png, officer2: png, officer3: png, officer4: png, officer5: png,
        },
      });
      return [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
      });
    }, FIXTURE, signature);

    assert.deepStrictEqual(afterSign, beforeSign, 'ลายเซ็นทำให้บรรทัดในกระดาษขยับ');

    const drawn = await page.evaluate(() => document.querySelectorAll('.rule > .signature').length);
    assert.strictEqual(drawn, 8, `วางลายเซ็นได้ ${drawn} จุด ควรเป็น 8 จุด`);

    console.log('ok — ลายเซ็นบนจอวางลงกระดาษได้ครบ 8 จุด โดยไม่มีบรรทัดใดขยับ');

    // --- page height ------------------------------------------------------
    // fitSheet()/shrinkToFit() are gone; nothing may silently reintroduce a
    // sheet taller than the page. Height comes from the template's own
    // <w:pgSz w:h="16838"/> (297mm), not a hard-coded number.
    const sheetHeightsPx = await page.evaluate(() =>
      [...document.querySelectorAll('.sheet')].map((node) => node.getBoundingClientRect().height)
    );
    const sheetHeightsMm = sheetHeightsPx.map(pxToMm);

    sheetHeightsMm.forEach((h, i) =>
      assert.ok(
        h <= template.page.heightMm,
        `แผ่นที่ ${i + 1} สูงเกินหน้ากระดาษ: ${h.toFixed(2)}mm > ${template.page.heightMm.toFixed(2)}mm (เกิน ${(h - template.page.heightMm).toFixed(2)}mm)`
      )
    );

    console.log(`ok — ทุกแผ่นสูงไม่เกิน ${template.page.heightMm.toFixed(2)}mm (${sheetHeightsMm.map((h) => h.toFixed(2)).join(', ')})`);
  } finally {
    await browser.close();
  }
})();

module.exports = { readTemplate };

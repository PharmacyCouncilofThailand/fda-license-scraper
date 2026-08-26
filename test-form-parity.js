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
      return {
        type: 'paragraph',
        text,
        pt: sizeMatch ? Number(sizeMatch[1]) / 2 : null,
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
    seal: extent && {
      widthMm: emuToMm(extent[1]),
      heightMm: emuToMm(extent[2]),
      offsetMm: offset ? emuToMm(offset[1]) : null,
    },
    signaturesColMm: gridCol ? twipsToMm(gridCol[1]) : null,
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
  } finally {
    await browser.close();
  }
})();

module.exports = { readTemplate };

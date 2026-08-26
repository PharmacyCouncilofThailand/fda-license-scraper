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

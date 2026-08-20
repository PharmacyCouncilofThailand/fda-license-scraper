/**
 * Checks the inspection-form path without touching the FDA site: the address
 * parser feeds the form's blanks, the form still renders to exactly two A4
 * pages once it is filled in, and the Word copy comes out with every
 * placeholder replaced.
 *
 *   node smoke-form.js
 */
'use strict';

// Its own port, so the check runs while a dev server is up on 3000.
process.env.PORT = process.env.PORT || '3199';

const assert = require('assert');
const config = require('./src/config');
const { parseAddress, renderFormPdf, closeBrowser } = require('./src/scraper');
const { renderFormDocx } = require('./src/docx-form');
const zip = require('./src/zip');

// renderFormPdf loads form.html over HTTP, exactly as the real endpoint
// does, so the app has to be listening. It does not listen on its own any
// more — a serverless deployment imports it instead.
const server = require('./src/server').listen(config.port);

const area = parseAddress(
  'บ้านเลขที่ 269/5 หมู่ที่ - ตรอก/ซอย - ถนน เชียงใหม่-ลำพูน ตำบล วัดเกต ' +
    'อำเภอ เมืองเชียงใหม่ จังหวัด เชียงใหม่ 50000โทร. 0 5326 1150-2'
);

assert.strictEqual(area.houseNo, '269/5');
assert.strictEqual(area.road, 'เชียงใหม่-ลำพูน');
assert.strictEqual(area.subdistrict, 'วัดเกต');
assert.strictEqual(area.district, 'เมืองเชียงใหม่');
assert.strictEqual(area.province, 'เชียงใหม่');
assert.strictEqual(area.postcode, '50000');
assert.strictEqual(area.phone, '0 5326 1150-2');
// "หมู่ที่ -" and "ตรอก/ซอย -" are blanks on the FDA record, not values.
assert.strictEqual(area.moo, null);
assert.strictEqual(area.soi, null);

// The FDA writes the village number both ways. Without the bare form the
// house number swallows it and หมู่ที่ comes out blank on the record.
const bareMoo = parseAddress('บ้านเลขที่ 23 หมู่ 15 ตำบล ศิลา อำเภอ เมืองขอนแก่น จังหวัด ขอนแก่น 40000');
assert.strictEqual(bareMoo.houseNo, '23');
assert.strictEqual(bareMoo.moo, '15');

// …but หมู่บ้าน is a building name, not a village number.
const village = parseAddress('บ้านเลขที่ 99/1 หมู่บ้าน เดอะมอลล์ แขวง คลองตัน เขต คลองเตย จังหวัด กรุงเทพมหานคร 10110');
assert.strictEqual(village.village, 'เดอะมอลล์');
assert.strictEqual(village.moo, null);

const payload = {
  values: {
    placeName: 'ร้านยาฟาสซิโน สาขาศูนย์ยาเชียงใหม่ ชื่อยาวเพื่อทดสอบการย่อขนาด',
    houseNo: area.houseNo,
    road: area.road,
    subdistrict: area.subdistrict,
    district: area.district,
    province: area.province,
    phone: area.phone,
    licenseeName: 'บริษัท โปร ฟาสซิโน จำกัด',
    operatorName: 'นาย ไชยเสน พิศาลวาเลิศ',
    licenseNo: 'ชม 1/2555',
    openHours: '08.00 - 21.00',
  },
  checks: { shopOpen: true, didBuy: true, dutyAbsent: true },
};

(async () => {
  try {
    const pdf = await renderFormPdf(payload, `http://127.0.0.1:${config.port}`);

    const bytes = Buffer.from(pdf);
    assert.strictEqual(bytes.subarray(0, 5).toString('latin1'), '%PDF-');

    // The record is a two-page form; a third page means the fit pass failed.
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.strictEqual(pages, 2, `expected 2 pages, got ${pages}`);


    // The Word copy carries the same values and no leftover placeholders.
    const docx = await renderFormDocx(payload);
    const parts = zip.read(docx);
    const document = parts.find((e) => e.name === 'word/document.xml');
    assert.ok(document, 'docx has no word/document.xml');
    const documentXml = document.data.toString('utf8');
    assert.strictEqual((documentXml.match(/\{\{[^}]*\}\}/g) || []).length, 0, 'unfilled placeholders left in the docx');
    assert.ok(documentXml.includes(payload.values.licenseeName), 'licensee missing from the docx');
    assert.strictEqual((documentXml.match(/☑/g) || []).length, 3, 'wrong number of ticked boxes');

    console.log(`OK — address parsed, ${bytes.length} byte PDF, ${pages} pages, ${docx.length} byte DOCX`);
    process.exit(0);
  } catch (err) {
    console.error('FAIL', err.message);
    process.exit(1);
  } finally {
    await closeBrowser();
    server.close();
  }
})();

/**
 * Checks the live FDA portal still answers the way the app reads it:
 * the search API returns rows that carry every field a result card needs,
 * the province filter narrows them, and one record's detail comes back.
 *
 *   node smoke.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A throwaway directory, so a smoke run never touches the office's own plans.
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-plans-'));

const {
  searchDrugLocations,
  getDetailByNewCode,
  renderPlanPdf,
  closeBrowser,
} = require('./src/scraper');
const plans = require('./src/plans');
const { renderPlanDocx } = require('./src/docx-plan');

(async () => {
  const started = Date.now();
  const found = await searchDrugLocations({
    keyword: 'ฟาสซิโน',
    province: 'เชียงใหม่',
    withDetails: false,
  });

  assert.ok(found.totalFound > 0, 'ค้นหาแล้วไม่ได้ผลลัพธ์เลย');
  assert.ok(found.totalMatched > 0, 'กรองจังหวัดแล้วไม่เหลือรายการ');
  assert.ok(
    found.totalMatched < found.totalFound,
    'กรองจังหวัดแล้วจำนวนไม่ลดลง — น่าจะกรองไม่ทำงาน'
  );

  const row = found.results[0];
  for (const field of ['licenseNo', 'placeName', 'address', 'status', 'newCode']) {
    assert.ok(row[field], `ผลลัพธ์ไม่มีฟิลด์ ${field}`);
  }
  assert.strictEqual(row.area.province, 'เชียงใหม่', 'แยกจังหวัดจากที่อยู่ไม่ถูก');
  assert.ok(found.facets.provinces.length > 1, 'facet จังหวัดว่าง');

  const detail = await getDetailByNewCode(row.newCode);
  assert.ok(detail.licenseeName || detail.operatorName, 'รายละเอียดไม่มีชื่อผู้รับอนุญาต');
  assert.ok(Array.isArray(detail.pharmacists), 'รายละเอียดไม่มีรายชื่อผู้ปฏิบัติการ');

  // --- แผนการตรวจ ---------------------------------------------------------
  // The same real shop goes into a plan, so this exercises the FDA detail and
  // the council's register the way adding a shop does in the office.
  const plan = await plans.createPlan({ date: `${new Date().getFullYear() + 543}-01-01` });
  const added = await plans.addItems(plan.id, [row]);
  assert.strictEqual(added.added.length, 1, 'ใส่ร้านลงแผนไม่สำเร็จ');
  const item = added.plan.items[0];
  assert.strictEqual(item.order, 1);
  assert.strictEqual(item.placeName, row.placeName, 'ชื่อร้านไม่ติดไปกับแผน');
  assert.ok(item.licenseeName, 'แผนไม่ได้ชื่อผู้รับอนุญาตจาก อย.');

  const docx = renderPlanDocx(added.plan);
  assert.ok(docx.length > 1000, 'ไฟล์ Word ของแผนเล็กผิดปกติ');
  assert.ok(
    docx.includes(Buffer.from('PK')),
    'ไฟล์ Word ของแผนไม่ใช่ zip'
  );
  const pdf = Buffer.from(await renderPlanPdf(added.plan));
  assert.ok(pdf.length > 1000, 'ไฟล์ PDF ของแผนเล็กผิดปกติ');
  assert.ok(pdf.subarray(0, 4).toString() === '%PDF', 'ไฟล์ PDF ของแผนไม่ใช่ PDF');
  await closeBrowser();
  fs.rmSync(process.env.PLANS_DIR, { recursive: true, force: true });
  console.log('ok — แผนการตรวจ: สร้าง ใส่ร้านจาก อย. และส่งออก Word/PDF ได้');

  console.log(
    'ok —',
    found.totalFound,
    'รายการ, กรองเหลือ',
    found.totalMatched,
    '| detail:',
    detail.licenseeName || detail.operatorName,
    '|',
    ((Date.now() - started) / 1000).toFixed(1) + 's'
  );
})().catch((err) => {
  console.error('FAIL', err.code || '', err.message);
  process.exit(1);
});

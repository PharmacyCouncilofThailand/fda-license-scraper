/**
 * Checks the live FDA portal still answers the way the app reads it:
 * the search API returns rows that carry every field a result card needs,
 * the province filter narrows them, and one record's detail comes back.
 *
 *   node smoke.js
 */
'use strict';

const assert = require('assert');
const { searchDrugLocations, getDetailByNewCode } = require('./src/scraper');

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

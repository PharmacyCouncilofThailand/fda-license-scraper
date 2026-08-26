/**
 * Checks the live Pharmacy Council site still answers the way the app reads
 * it. This is the tripwire: when they change their page, this goes red.
 *
 *   node smoke-pharmacist.js
 */
'use strict';

const assert = require('assert');
const { searchPharmacists, clearPharmacistCache } = require('./src/pharmacist');

(async () => {
  clearPharmacistCache();

  // --- surname only -------------------------------------------------------
  const bySurname = await searchPharmacists({ lastName: 'ใจดี' });
  assert.ok(bySurname.groups.lastName.length > 0, 'ค้นนามสกุลแล้วไม่ได้ผลเลย');
  assert.strictEqual(bySurname.groups.both.length, 0, 'กรอกช่องเดียวไม่ควรมีกลุ่ม both');
  const one = bySurname.groups.lastName[0];
  for (const field of ['licenseNo', 'fullName', 'firstName', 'lastName', 'status']) {
    assert.ok(one[field], `ผลลัพธ์ไม่มีฟิลด์ ${field}`);
  }
  assert.strictEqual(one.lastName, 'ใจดี', 'นามสกุลที่แยกได้ไม่ตรงกับที่ค้น');

  // --- both fields --------------------------------------------------------
  const both = await searchPharmacists({
    firstName: one.firstName,
    lastName: one.lastName,
  });
  assert.ok(both.groups.both.length > 0, 'ค้นชื่อ+นามสกุลของคนเดียวกันแล้วกลุ่ม both ว่าง');
  assert.ok(
    both.counts.firstName >= both.counts.both,
    'จำนวนคนชื่อเดียวกันต้องไม่น้อยกว่าจำนวนที่ตรงทั้งสองช่อง'
  );
  assert.ok(
    both.groups.both.some((r) => r.licenseNo === one.licenseNo),
    'คนที่ค้นเจอตอนแรกไม่อยู่ในกลุ่ม both'
  );
  // A row may sit in exactly one group.
  const ids = [
    ...both.groups.both,
    ...both.groups.firstName,
    ...both.groups.lastName,
  ].map((r) => r.licenseNo);
  assert.strictEqual(new Set(ids).size, ids.length, 'มีแถวซ้ำข้ามกลุ่ม');

  // --- nothing found ------------------------------------------------------
  const none = await searchPharmacists({ lastName: 'ไม่มีนามสกุลนี้จริง' });
  assert.deepStrictEqual(none.counts, { both: 0, firstName: 0, lastName: 0 });

  // --- cache --------------------------------------------------------------
  const again = await searchPharmacists({ lastName: 'ใจดี' });
  assert.strictEqual(again.cached, true, 'ค้นซ้ำคำเดิมแล้วไม่ได้ผลจากแคช');

  console.log(
    `ok — ${bySurname.counts.lastName} by surname, ` +
      `${both.counts.both} matched both, cache hit on repeat`
  );
})().catch((err) => {
  console.error('FAILED —', err.message);
  process.exit(1);
});

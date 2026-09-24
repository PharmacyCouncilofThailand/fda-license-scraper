/**
 * Checks the live Pharmacy Council site still answers the way the app reads
 * it. This is the tripwire: when they change their page, this goes red.
 *
 *   node smoke-pharmacist.js
 */
'use strict';

const assert = require('assert');
const { searchPharmacists, clearPharmacistCache } = require('./src/pharmacist');

// A real register entry (licence 10000). If it ever leaves the register, pick
// another by searching a licence number on the council's own page.
const KNOWN = { firstName: 'ผันสุ', lastName: 'ชุมวรฐายี', licenseNo: '10000' };

(async () => {
  clearPharmacistCache();

  // --- first name + surname ----------------------------------------------
  const found = await searchPharmacists(KNOWN);
  assert.ok(
    found.groups.both.some((r) => r.licenseNo === KNOWN.licenseNo),
    'ค้นชื่อ+นามสกุลที่มีจริงแล้วไม่พบ'
  );
  const one = found.groups.both[0];
  for (const field of ['licenseNo', 'fullName', 'firstName', 'lastName', 'status']) {
    assert.ok(one[field], `ผลลัพธ์ไม่มีฟิลด์ ${field}`);
  }

  // --- one field alone is refused before reaching upstream ----------------
  await assert.rejects(
    searchPharmacists({ lastName: KNOWN.lastName }),
    (err) => err.code === 'MISSING_QUERY'
  );

  // --- nothing found ------------------------------------------------------
  const none = await searchPharmacists({ firstName: 'ไม่มีชื่อนี้', lastName: 'ไม่มีนามสกุลนี้จริง' });
  assert.deepStrictEqual(none.counts, { both: 0, firstName: 0, lastName: 0 });

  // --- cache --------------------------------------------------------------
  const again = await searchPharmacists(KNOWN);
  assert.strictEqual(again.cached, true, 'ค้นซ้ำคำเดิมแล้วไม่ได้ผลจากแคช');

  console.log(`ok — ${found.counts.both} matched, cache hit on repeat`);
})().catch((err) => {
  console.error('FAILED —', err.message);
  process.exit(1);
});

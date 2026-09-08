/**
 * Offline check of the on-site record: a draft is built from the plan, written
 * back, and refuses a write that has moved on. No network.
 *
 *   node test-records-store.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'records-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = path.join(root, 'plans');
process.env.RECORDS_DIR = path.join(root, 'records');
process.env.PHOTOS_DIR = path.join(root, 'photos');

const plansStore = require('./src/plans-store');
const records = require('./src/records');
const photos = require('./src/photo-store');

const PLAN = {
  id: '2569-08-27',
  title: 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม',
  date: '2569-08-27',
  items: [
    {
      newCode: 'A/1',                       // a slash, because the FDA's keys are not path-safe
      order: 1,
      placeName: 'ร้านเจริญสุขเภสัช',
      licenseType: 'ขย.1',
      licenseNo: 'กท 754/2526',
      address: 'เลขที่ 293 ถ.สาลีรัฐวิภาค แขวงสามเสนใน เขตพญาไท กทม.',
      licenseeName: 'นางกุ้ยจู อัศวเวชมงคล',
      openHours: '09.00 - 18.00 น.',
      pharmacists: [{ name: 'ภญ. รัชดา อัศวรัตน์', licenceNo: '2524', openHours: '09.00 - 13.00 น.' }],
      status: 'planned',
      statusSource: 'auto',
      note: '',
    },
  ],
};

(async () => {
  await plansStore.save({ ...PLAN, createdAt: '2026-09-08T00:00:00.000Z' });

  // An id may never carry a path separator into the filesystem.
  const id = records.recordId('2569-08-27', 'A/1');
  assert.ok(!id.includes('/'), `รหัสบันทึกต้องไม่มีเครื่องหมาย / : ${id}`);

  // Nothing stored yet: a blank draft seeded from the plan item.
  const blank = await records.readRecord('2569-08-27', 'A/1');
  assert.strictEqual(blank.values.placeName, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(blank.values.shopNameAtCheck, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(blank.values.licenseeName, 'นางกุ้ยจู อัศวเวชมงคล');
  assert.strictEqual(blank.values.licenseNo, 'กท 754/2526');
  assert.strictEqual(blank.values.subdistrict, 'สามเสนใน');
  assert.strictEqual(blank.values.district, 'พญาไท');
  // The pharmacist blanks stay empty: the licence says who may be on duty,
  // not who was there. Same rule the hand-off to form.html follows.
  assert.strictEqual(blank.values.dutyPharmacist, '');
  assert.strictEqual(blank.values.openHours, '');
  assert.deepStrictEqual(blank.photos, []);
  assert.strictEqual(blank.updatedAt, null, 'ร่างที่ยังไม่เคยบันทึกต้องไม่มี updatedAt');

  // First write.
  const first = await records.writeRecord('2569-08-27', 'A/1', {
    ...blank,
    officerName: 'นางสาวอชิดา บุญเพียร',
    values: { ...blank.values, inspectTime: '10.30' },
    checks: { shopOpen: true },
    signatures: { page1: 'data:image/png;base64,AAA' },
  });
  assert.ok(first.updatedAt, 'เขียนแล้วต้องมี updatedAt');
  assert.strictEqual(first.values.inspectTime, '10.30');
  assert.strictEqual(first.checks.shopOpen, true);

  // Reading it back gives the stored draft, not a fresh blank.
  const stored = await records.readRecord('2569-08-27', 'A/1');
  assert.strictEqual(stored.values.inspectTime, '10.30');
  assert.strictEqual(stored.signatures.page1, 'data:image/png;base64,AAA');

  // A second write that knows the current version wins.
  const second = await records.writeRecord('2569-08-27', 'A/1', {
    ...stored,
    values: { ...stored.values, endTime: '11.15' },
  });
  assert.strictEqual(second.values.endTime, '11.15');

  // A write built on the version before that is refused, and hands back the
  // current one so the officer can choose.
  await assert.rejects(
    () => records.writeRecord('2569-08-27', 'A/1', { ...first, values: { ...first.values, endTime: 'ทับ' } }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.current.values.endTime, '11.15');
      return true;
    }
  );

  // Photos are listed on the record; the bytes are somewhere else.
  const withPhoto = await records.addPhoto('2569-08-27', 'A/1', { id: 'p1' });
  assert.deepStrictEqual(
    withPhoto.photos.map((p) => [p.id, p.inPdf, p.caption]),
    [['p1', true, '']]
  );
  const withoutPhoto = await records.removePhoto('2569-08-27', 'A/1', 'p1');
  assert.deepStrictEqual(withoutPhoto.photos, []);

  // --- photo bytes --------------------------------------------------------
  const bytes = Buffer.from('\xff\xd8\xff\xe0 not really a jpeg', 'binary');
  const { id: photoId } = await photos.putPhoto('2569-08-27', 'A/1', bytes);
  assert.match(photoId, /^[0-9a-f]{24}$/, 'รหัสรูปควรเป็นเลขฐานสิบหก 24 ตัว');
  assert.deepStrictEqual(await photos.getPhoto('2569-08-27', 'A/1', photoId), bytes);
  assert.strictEqual(await photos.getPhoto('2569-08-27', 'A/1', 'ไม่มีรูปนี้'), null);
  assert.strictEqual(await photos.delPhoto('2569-08-27', 'A/1', photoId), true);
  assert.strictEqual(await photos.getPhoto('2569-08-27', 'A/1', photoId), null);
  assert.strictEqual(await photos.delPhoto('2569-08-27', 'A/1', photoId), false);

  // A `newCode` containing `*` — the character encodeURIComponent leaves
  // unescaped that no Windows filesystem will accept — must still survive a
  // full photo put-then-get round trip on this machine, not just in theory.
  const starPhotoBytes = Buffer.from('star-code photo bytes');
  const { id: starPhotoId } = await photos.putPhoto('2569-08-27', 'C*3', starPhotoBytes);
  assert.deepStrictEqual(await photos.getPhoto('2569-08-27', 'C*3', starPhotoId), starPhotoBytes);
  assert.strictEqual(await photos.delPhoto('2569-08-27', 'C*3', starPhotoId), true);

  // A shop that is not in the plan has no record to build.
  await assert.rejects(() => records.readRecord('2569-08-27', 'NOPE'), /ไม่พบร้าน/);
  await assert.rejects(() => records.readRecord('2569-01-01', 'A/1'), /ไม่พบแผน/);

  // A write that presents a non-null updatedAt against a shop with nothing
  // stored yet is holding a stale version by definition — refused, not
  // silently accepted as the first write.
  await plansStore.save({
    ...PLAN,
    id: '2569-09-01',
    date: '2569-09-01',
    items: [{ ...PLAN.items[0], newCode: 'B/2' }],
    createdAt: '2026-09-08T00:00:00.000Z',
  });
  await assert.rejects(
    () =>
      records.writeRecord('2569-09-01', 'B/2', {
        officerName: 'คนที่สอง',
        values: {},
        checks: {},
        signatures: {},
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    (err) => {
      assert.strictEqual(err.status, 409, 'เขียนทับร้านที่ยังไม่เคยบันทึกด้วย updatedAt เดิมต้องถูกปฏิเสธ');
      assert.strictEqual(err.current.updatedAt, null);
      return true;
    }
  );

  // A newCode containing characters encodeURIComponent leaves unescaped
  // ( ) ' must still round-trip through a real write and read.
  const oddCode = "A(1)'2";
  await plansStore.save({
    ...PLAN,
    id: '2569-09-02',
    date: '2569-09-02',
    items: [{ ...PLAN.items[0], newCode: oddCode }],
    createdAt: '2026-09-08T00:00:00.000Z',
  });
  const oddBlank = await records.readRecord('2569-09-02', oddCode);
  const oddWritten = await records.writeRecord('2569-09-02', oddCode, {
    ...oddBlank,
    officerName: 'ทดสอบรหัสพิเศษ',
    values: { ...oddBlank.values, inspectTime: '09.00' },
  });
  const oddRead = await records.readRecord('2569-09-02', oddCode);
  assert.strictEqual(oddRead.values.inspectTime, '09.00');
  assert.strictEqual(oddRead.updatedAt, oddWritten.updatedAt);

  // `*` is the one character encodeURIComponent leaves unescaped that no
  // Windows filesystem accepts in a filename — recordId must escape it to
  // %2A itself so this round-trips on this machine, not just in theory.
  const starCode = 'C*3';
  await plansStore.save({
    ...PLAN,
    id: '2569-09-03',
    date: '2569-09-03',
    items: [{ ...PLAN.items[0], newCode: starCode }],
    createdAt: '2026-09-08T00:00:00.000Z',
  });
  const starBlank = await records.readRecord('2569-09-03', starCode);
  const starWritten = await records.writeRecord('2569-09-03', starCode, {
    ...starBlank,
    officerName: 'ทดสอบเครื่องหมายดอกจัน',
    values: { ...starBlank.values, inspectTime: '10.00' },
  });
  const starRead = await records.readRecord('2569-09-03', starCode);
  assert.strictEqual(starRead.values.inspectTime, '10.00');
  assert.strictEqual(starRead.updatedAt, starWritten.updatedAt);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok — บันทึกการตรวจหน้างานเก็บ อ่าน และกันเขียนทับได้');
})();

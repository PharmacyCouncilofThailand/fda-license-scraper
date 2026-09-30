/**
 * Offline check of the plan logic. The FDA and the council are injected, so
 * this never touches the network.
 *
 *   node test-plans.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-logic-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = dir;

const plans = require('./src/plans');

const DETAIL = {
  A: {
    licenseeName: 'นางกุ้ยจู อัศวเวชมงคล',
    openHours: '09.00 - 18.00 น.',
    lat: 13.789833,
    lng: 100.549028,
    pharmacists: [
      { name: 'ภญ. รัชดา อัศวรัตน์', openHours: '09.00 - 13.00 น.' },
      { name: 'ภก. ธวัชชัย ทิพย์ทินกร', openHours: '13.00 - 18.00 น.' },
      { name: 'ภญ. สองคน ซ้ำชื่อ', openHours: '09.00 - 18.00 น.' },
      { name: 'ภญ. ไม่มี ในทะเบียน', openHours: '' },
    ],
  },
  B: { licenseeName: 'นายนพดล สงครามรอด', openHours: '00.00 - 24.00 น.', pharmacists: [] },
};

const ROW = {
  A: { placeName: 'ร้านเจริญสุขเภสัช', licenseType: 'ขย.1', licenseNo: 'กท 754/2526', address: 'เลขที่ 293 ถ.สาลีรัฐวิภาค' },
  B: { placeName: 'ร้านยากรุงเทพ', licenseType: 'ขย.1', licenseNo: 'กท 224/2566', address: 'เลขที่ 51 ถ.ลาดพร้าว 101' },
};

const deps = {
  async fetchDetail(newCode) {
    if (newCode === 'BOOM') throw new Error('อย. ไม่ตอบ');
    return { ...ROW[newCode], ...DETAIL[newCode] };
  },
  async searchPharmacists({ firstName, lastName }) {
    if (lastName === 'ทิพย์ทินกร') throw new Error('สภาฯ ไม่ตอบ');
    const table = {
      อัศวรัตน์: [{ licenseNo: '2524', fullName: 'ภญ. รัชดา อัศวรัตน์', status: 'คงอยู่' }],
      ซ้ำชื่อ: [
        { licenseNo: '111', fullName: 'ภญ. สองคน ซ้ำชื่อ', status: 'คงอยู่' },
        { licenseNo: '222', fullName: 'ภญ. สองคน ซ้ำชื่อ', status: 'คงอยู่' },
      ],
    };
    return { counts: {}, groups: { both: table[lastName] || [], firstName: [], lastName: [] } };
  },
};

(async () => {
  const plan = await plans.createPlan();
  assert.strictEqual(plan.id, 'A', 'แผนแรกได้ชื่อ A');
  assert.strictEqual(plan.date, '', 'สร้างแผนได้โดยไม่ต้องมีวันที่');
  assert.strictEqual(plan.title, 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม');
  assert.deepStrictEqual(plan.items, []);

  // The next plan gets the next free letter, not a date.
  const twin = await plans.createPlan({});
  assert.strictEqual(twin.id, 'B');

  // The date is optional and set — or cleared — afterward; a malformed one is
  // refused, at update and at creation alike.
  const dated = await plans.updatePlan(plan.id, { date: '2569-08-27' });
  assert.strictEqual(dated.date, '2569-08-27');
  const cleared = await plans.updatePlan(plan.id, { date: '' });
  assert.strictEqual(cleared.date, '');
  await assert.rejects(() => plans.updatePlan(plan.id, { date: '27 ส.ค. 69' }), /วันที่/);
  await assert.rejects(() => plans.createPlan({ date: 'bad' }), /วันที่/);

  const first = await plans.addItems(plan.id, ['A', 'B', 'BOOM'], deps);
  assert.deepStrictEqual(first.added, ['A', 'B']);
  assert.strictEqual(first.failed.length, 1);
  assert.strictEqual(first.failed[0].newCode, 'BOOM');
  assert.match(first.failed[0].message, /อย\./);

  const [a, b] = first.plan.items;
  assert.strictEqual(a.order, 1);
  assert.strictEqual(b.order, 2);
  assert.strictEqual(a.placeName, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(a.licenseeName, 'นางกุ้ยจู อัศวเวชมงคล');
  assert.strictEqual(a.lat, 13.789833);
  assert.strictEqual(a.status, 'planned');
  assert.strictEqual(a.statusSource, 'auto');

  // A shop handed over as a search row keeps the columns the detail call
  // never answers.
  const rowPlan = await plans.createPlan({ date: '2569-09-01' });
  const carried = await plans.addItems(
    rowPlan.id,
    [{ newCode: 'C', ...ROW.B }],
    { ...deps, fetchDetail: async () => DETAIL.B }
  );
  assert.strictEqual(carried.plan.items[0].placeName, 'ร้านยากรุงเทพ');
  assert.strictEqual(carried.plan.items[0].licenseNo, 'กท 224/2566');

  // One clear match fills the licence; anything less leaves it for a person.
  assert.deepStrictEqual(
    a.pharmacists.map((p) => [p.licenceNo, p.licenceSource]),
    [
      ['2524', 'auto'],
      ['', 'none'],       // the council refused to answer
      ['', 'ambiguous'],  // two people with that name
      ['', 'none'],       // nobody by that name
    ]
  );
  // An ambiguous row keeps the choices so the officer can pick one.
  assert.strictEqual(a.pharmacists[2].candidates.length, 2);

  // Adding a shop twice is reported, not duplicated.
  const again = await plans.addItems(plan.id, ['A'], deps);
  assert.deepStrictEqual(again.added, []);
  assert.match(again.failed[0].message, /มีอยู่แล้ว/);
  assert.strictEqual(again.plan.items.length, 2);

  // Patching one item leaves its neighbour untouched, in either order.
  await plans.patchItem(plan.id, 'B', { note: 'ปิดปรับปรุง' });
  const patched = await plans.patchItem(plan.id, 'A', { status: 'done' });
  assert.strictEqual(patched.items[0].status, 'done');
  assert.strictEqual(patched.items[0].statusSource, 'manual');
  assert.strictEqual(patched.items[1].note, 'ปิดปรับปรุง');

  // The form reports its own status as `auto`, and never overrides a person.
  const auto = await plans.patchItem(plan.id, 'A', { status: 'planned', statusSource: 'auto' });
  assert.strictEqual(auto.items[0].status, 'done', 'auto ต้องไม่ทับสิ่งที่คนกดเอง');

  const summary = plans.summarise(auto);
  assert.deepStrictEqual(
    { total: summary.total, done: summary.done },
    { total: 2, done: 1 }
  );

  // A licence number typed by hand is trusted and marked as such.
  const manual = await plans.patchItem(plan.id, 'A', {
    pharmacists: [{ index: 2, licenceNo: '222' }],
  });
  assert.strictEqual(manual.items[0].pharmacists[2].licenceNo, '222');
  assert.strictEqual(manual.items[0].pharmacists[2].licenceSource, 'manual');
  assert.strictEqual(manual.items[0].pharmacists[0].licenceNo, '2524', 'คนอื่นต้องไม่ถูกแตะ');

  // Reordering rewrites the sequence and renumbers; a code left off the list
  // keeps its place at the end rather than vanishing.
  const reordered = await plans.reorderItems(plan.id, ['B', 'A']);
  assert.deepStrictEqual(reordered.items.map((i) => i.newCode), ['B', 'A']);
  assert.deepStrictEqual(reordered.items.map((i) => i.order), [1, 2]);
  const partial = await plans.reorderItems(plan.id, ['A']);
  assert.deepStrictEqual(partial.items.map((i) => i.newCode), ['A', 'B']);

  const removed = await plans.removeItem(plan.id, 'B');
  assert.strictEqual(removed.items.length, 1);
  assert.strictEqual(removed.items[0].newCode, 'A');

  await assert.rejects(() => plans.patchItem(plan.id, 'NOPE', { status: 'done' }), /ไม่พบร้าน/);
  await assert.rejects(() => plans.addItems('2569-01-01', ['A'], deps), /ไม่พบแผน/);

  // --- officer-edited location ----------------------------------------------
  await assert.rejects(() => plans.patchItem(plan.id, 'A', { lat: 13.8 }), /ทั้งละติจูดและลองจิจูด/);
  await assert.rejects(() => plans.patchItem(plan.id, 'A', { lat: 95, lng: 100 }), /พิกัดไม่ถูกต้อง/);
  await assert.rejects(() => plans.patchItem(plan.id, 'A', { lat: 'x', lng: 100 }), /พิกัดไม่ถูกต้อง/);
  await assert.rejects(() => plans.patchItem(plan.id, 'A', { lat: '', lng: '' }), /พิกัดไม่ถูกต้อง/);
  await assert.rejects(() => plans.patchItem(plan.id, 'A', { lat: null, lng: 100 }), /พิกัดไม่ถูกต้อง/);
  const moved = await plans.patchItem(plan.id, 'A', { address: ' ซอยใหม่ 5 ', lat: '13.81', lng: 100.55 });
  const movedA = moved.items.find((i) => i.newCode === 'A');
  assert.deepStrictEqual([movedA.address, movedA.lat, movedA.lng, movedA.locationEdited], ['ซอยใหม่ 5', 13.81, 100.55, true]);
  // Re-reading from the FDA keeps the officer's fix.
  const resynced = await plans.syncItem(plan.id, 'A', deps);
  const resyncedA = resynced.items.find((i) => i.newCode === 'A');
  assert.deepStrictEqual([resyncedA.address, resyncedA.lat, resyncedA.lng], ['ซอยใหม่ 5', 13.81, 100.55]);
  const unpinned = await plans.patchItem(plan.id, 'A', { lat: null, lng: null });
  assert.strictEqual(unpinned.items.find((i) => i.newCode === 'A').lat, null);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok — ตรรกะแผนการตรวจถูกต้อง');
})();

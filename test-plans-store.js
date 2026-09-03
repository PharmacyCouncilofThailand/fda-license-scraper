/**
 * Offline check of the plan store's file backend. No network.
 *
 *   node test-plans-store.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = dir;

const store = require('./src/plans-store');

(async () => {
  assert.strictEqual(store.backendName(), 'file');
  assert.deepStrictEqual(await store.list(), [], 'ที่เก็บว่างควรได้อาร์เรย์ว่าง');
  assert.strictEqual(await store.get('2569-08-27'), null);

  const plan = {
    id: '2569-08-27',
    title: 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม',
    date: '2569-08-27',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    items: [],
  };
  const saved = await store.save(plan);
  assert.ok(saved.updatedAt >= plan.updatedAt, 'save ต้องอัปเดต updatedAt');

  const back = await store.get('2569-08-27');
  assert.strictEqual(back.title, plan.title);
  assert.deepStrictEqual(back.items, []);

  await store.save({ ...plan, id: '2569-09-01', date: '2569-09-01' });
  const all = await store.list();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].id, '2569-09-01', 'ควรเรียงวันที่ใหม่ก่อน');

  // A traversal id must never escape the plans directory.
  await assert.rejects(() => store.get('../../secret'), /รหัสแผนไม่ถูกต้อง/);
  await assert.rejects(() => store.save({ ...plan, id: 'a/b' }), /รหัสแผนไม่ถูกต้อง/);

  assert.strictEqual(await store.remove('2569-09-01'), true);
  assert.strictEqual(await store.remove('2569-09-01'), false);
  assert.strictEqual((await store.list()).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok — ที่เก็บแผนแบบไฟล์ทำงานครบวงจร');
})();

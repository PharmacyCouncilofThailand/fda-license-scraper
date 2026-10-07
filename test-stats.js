/**
 * Offline check of the dashboard's counting. No network, no store.
 *
 *   node test-stats.js
 */
'use strict';

const assert = require('assert');
const { buildStats } = require('./src/stats');

const BKK = 'เลขที่ 1 ถนนลาดพร้าว แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900';
const NON = 'เลขที่ 5 หมู่ที่ 2 ตำบลบางกระสอ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000';

const plans = [
  { id: 'A', date: '2569-10-02', items: [{ newCode: 'x1', address: BKK }, { newCode: 'x2', address: BKK }] },
  { id: 'B', date: '2569-09-20', items: [{ newCode: 'x1', address: BKK }, { newCode: 'n1', address: NON }] },
  { id: 'C', date: '', items: [{ newCode: 'n2', address: NON }] },
];
const records = [
  { planId: 'A', newCode: 'x1', documents: [{ id: 'd1' }] },
  { planId: 'A', newCode: 'x2', documents: [] }, // a record with nothing filed is not done
  { planId: 'B', newCode: 'x1', documents: [{ id: 'd2' }] }, // same shop, second plan: counts again
  { planId: 'B', newCode: 'n1' }, // no documents key at all
  { planId: 'Z', newCode: 'x9', documents: [{ id: 'd3' }] }, // plan deleted: ignored
];

const stats = buildStats(plans, records);

assert.strictEqual(stats.total, 5);
assert.strictEqual(stats.done, 2);
assert.strictEqual(stats.remaining, 3);

assert.deepStrictEqual(stats.byMonth, [
  { month: '2569-09', total: 2, done: 1 },
  { month: '2569-10', total: 2, done: 1 },
  { month: '', total: 1, done: 0 },
]);

assert.deepStrictEqual(stats.byArea, [
  { province: 'กรุงเทพมหานคร', district: 'จตุจักร', total: 3, done: 2 },
  { province: 'นนทบุรี', district: 'เมืองนนทบุรี', total: 2, done: 0 },
]);

assert.deepStrictEqual(buildStats([], []), { total: 0, done: 0, remaining: 0, byMonth: [], byArea: [] });

console.log('ok — ภาพรวมนับร้านที่ตรวจแล้วจากเอกสารที่แนบ');

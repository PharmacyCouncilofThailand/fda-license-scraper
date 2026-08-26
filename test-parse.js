/**
 * Offline check of the Pharmacy Council result-table parser, against real
 * markup saved under test/fixtures. No network.
 *
 *   node test-parse.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseResultTable } = require('./src/pharmacist');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, 'test', 'fixtures', name), 'utf8');

// --- a surname search with several people on it ---------------------------
const rows = parseResultTable(fixture('pharmacist-surname.html'));
assert.ok(rows.length > 1, 'ควรได้หลายแถวจากการค้นนามสกุล');

for (const row of rows) {
  assert.ok(['ภก.', 'ภญ.'].includes(row.title), `คำนำหน้าผิด: ${row.title}`);
  assert.ok(row.firstName, 'ไม่มีชื่อ');
  assert.ok(row.lastName, 'ไม่มีนามสกุล');
  assert.ok(/^\d+$/.test(row.licenseNo), `เลขใบอนุญาตไม่ใช่ตัวเลข: ${row.licenseNo}`);
  assert.strictEqual(row.fullName, `${row.title} ${row.firstName} ${row.lastName}`);
  assert.ok(!/[<>]/.test(row.fullName), 'ชื่อยังมีแท็ก HTML ติดมา');
  assert.ok(!row.fullName.includes('&nbsp;'), 'ชื่อยังมี entity ติดมา');
  assert.ok(row.status, 'ไม่มีสถานะ');
  assert.notStrictEqual(row.expiry, '-', 'ขีดควรถูกแปลงเป็นค่าว่าง');
  assert.ok(Array.isArray(row.notes), 'notes ต้องเป็นอาร์เรย์');
}

// Rows come back sorted by licence number, whatever order the council used.
assert.deepStrictEqual(
  rows.map((r) => Number(r.licenseNo)),
  [...rows.map((r) => Number(r.licenseNo))].sort((a, b) => a - b),
  'ผลลัพธ์ไม่ได้เรียงตามเลขใบอนุญาต'
);

// Every row of a surname search shares the surname.
assert.strictEqual(
  new Set(rows.map((r) => r.lastName)).size,
  1,
  'ค้นนามสกุลเดียวแต่ได้นามสกุลหลายแบบ'
);

// A leading zero in the licence number is part of it, not a number to trim.
const padded = parseResultTable(fixture('pharmacist-notes.html')).find((r) =>
  r.licenseNo.startsWith('0')
);
assert.ok(padded, 'ไม่เจอเลขใบอนุญาตที่ขึ้นต้นด้วยศูนย์ในไฟล์ตัวอย่าง');

// --- notes ----------------------------------------------------------------
const noted = parseResultTable(fixture('pharmacist-notes.html'));
const warned = noted.find((r) =>
  r.notes.some((n) => n.text.includes('หน่วยกิตการศึกษาต่อเนื่อง'))
);
assert.ok(warned, 'ไม่เจอแถวที่มีหมายเหตุหน่วยกิต');
assert.ok(
  warned.notes.some((n) => n.text.includes('ใบแทน')),
  'หมายเหตุบรรทัดสีน้ำเงินหายไป'
);
for (const note of warned.notes) {
  assert.ok(!/^[-\s]/.test(note.text), `หมายเหตุยังมีขีด/ช่องว่างนำหน้า: ${note.text}`);
  assert.ok(!/[<>]/.test(note.text), 'หมายเหตุยังมีแท็ก HTML ติดมา');
}

// Red is a warning, blue is a plain fact about the licence. Anything else and
// the panel paints a benign line in the alarm colour.
assert.strictEqual(
  warned.notes.find((n) => n.text.includes('หน่วยกิตการศึกษาต่อเนื่อง')).warning,
  true,
  'หมายเหตุหน่วยกิตต้องเป็นคำเตือน'
);
assert.strictEqual(
  warned.notes.find((n) => n.text.includes('ใบแทน')).warning,
  false,
  'บรรทัดเรื่องใบแทนไม่ใช่คำเตือน'
);

// --- nothing found --------------------------------------------------------
assert.deepStrictEqual(
  parseResultTable(fixture('pharmacist-empty.html')),
  [],
  'หน้าไม่พบรายการควรได้อาร์เรย์ว่าง'
);

// --- the council changed their page --------------------------------------
assert.throws(
  () => parseResultTable('<html><body><p>อยู่ระหว่างปรับปรุงระบบ</p></body></html>'),
  (err) => err.code === 'PARSE_ERROR' && err.status === 502,
  'หน้าเว็บที่ไม่มีตารางผลลัพธ์ต้อง throw PARSE_ERROR'
);

console.log(`ok — parse ${rows.length + noted.length} rows from 3 fixtures`);

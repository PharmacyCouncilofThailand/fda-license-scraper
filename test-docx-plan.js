/**
 * Offline check that the plan's Word file is a readable document carrying
 * every row. No network.
 *
 *   node test-docx-plan.js
 */
'use strict';

const assert = require('assert');
const { read } = require('./src/zip');
const { renderPlanDocx } = require('./src/docx-plan');

const plan = require('./test/fixtures/plan-sample.json');

const buffer = renderPlanDocx(plan);
assert.ok(Buffer.isBuffer(buffer) && buffer.length > 1000, 'ควรได้ไฟล์ docx ที่มีเนื้อหา');

const entries = read(buffer);
const names = entries.map((e) => e.name);
for (const required of [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
]) {
  assert.ok(names.includes(required), `ไฟล์ docx ขาด ${required}`);
}

const xml = entries.find((e) => e.name === 'word/document.xml').data.toString('utf8');
assert.ok(xml.startsWith('<?xml'), 'document.xml ต้องขึ้นต้นด้วย xml declaration');
assert.ok(xml.includes('แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม'), 'ไม่มีหัวเรื่อง');
assert.ok(xml.includes('27 สิงหาคม 2569'), 'วันที่ต้องเป็นภาษาไทย');
for (const item of plan.items) {
  assert.ok(xml.includes(item.licenseNo), `ไม่มีเลขที่ใบอนุญาต ${item.licenseNo}`);
  assert.ok(xml.includes(item.licenseeName), `ไม่มีผู้รับอนุญาต ${item.licenseeName}`);
}
assert.ok(xml.includes('ภ. 2524'), 'ไม่มีเลข ภ. ที่ดึงมาได้');
assert.ok(xml.includes('13°47'), 'ไม่มีพิกัดแบบองศา');
assert.ok(xml.includes('&quot;คลังยา&quot; &amp; 29 &lt;ตรงข้าม&gt;'), 'ต้อง escape XML');
// `<w:t` alone would also match <w:tbl>, <w:tr> and <w:tc>, so the text tag
// is matched exactly: nothing may open inside a run's text but its own close.
assert.ok(!/<w:t(?:\s[^>]*)?>[^<]*<(?!\/w:t>)/.test(xml), 'มีแท็กหลุดเข้าไปในข้อความ');

// Header row plus one row per shop.
const rows = (xml.match(/<w:tr[ >]/g) || []).length;
assert.strictEqual(rows, plan.items.length + 1, 'จำนวนแถวไม่ตรงกับจำนวนร้าน');

console.log('ok — ไฟล์ Word ของแผนการตรวจถูกต้อง');

/**
 * Offline check of the Thai name splitter. No network.
 *
 *   node test-thai-name.js
 */
'use strict';

const assert = require('assert');
const { splitThaiName } = require('./src/thai-name');

const cases = [
  ['นางสาวกุลนิดา บูรณ์สิริจรุงรัฐ', 'นางสาว', 'กุลนิดา', 'บูรณ์สิริจรุงรัฐ'],
  ['ภญ.เมวรี สุขคุ้ม', 'ภญ.', 'เมวรี', 'สุขคุ้ม'],
  ['ภก. ธวัชชัย ทิพย์ทินกร', 'ภก.', 'ธวัชชัย', 'ทิพย์ทินกร'],
  ['เภสัชกรหญิง รัชดา อัศวรัตน์', 'เภสัชกรหญิง', 'รัชดา', 'อัศวรัตน์'],
  ['นายศิริพงษ์  เจือโร่ง', 'นาย', 'ศิริพงษ์', 'เจือโร่ง'],
  ['สมชาย ใจดี', '', 'สมชาย', 'ใจดี'],
];

for (const [full, title, firstName, lastName] of cases) {
  const got = splitThaiName(full);
  assert.deepStrictEqual(got, { title, firstName, lastName }, `แยกชื่อผิด: ${full}`);
}

// "นางสาว" must not be read as "นาง" with a stray "สาว" left on the name.
assert.strictEqual(splitThaiName('นางสาวสาวิตรี ก').firstName, 'สาวิตรี');

// Junk in, empty out — never throw, the caller is filling a form.
for (const junk of [null, undefined, '', '   ', 'นางสาว']) {
  const got = splitThaiName(junk);
  assert.strictEqual(got.lastName, '', `ควรได้นามสกุลว่าง: ${junk}`);
}

console.log('ok — แยกชื่อไทยได้ครบทุกกรณี');

/**
 * The touch wizard's field list against the record page's own markup, in both
 * directions. The wizard and the paper are two files on purpose — see the
 * design note — and this is what keeps them one record.
 *
 *   node test-form-fields.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, 'web', 'public', 'form.html');
const MANIFEST = path.join(__dirname, 'web', 'src', 'lib', 'form-fields.js');

const html = fs.readFileSync(PAGE, 'utf8');
const source = fs.readFileSync(MANIFEST, 'utf8');

/* The manifest is an ES module and this is CommonJS. Rather than add a build
   step for one test, read the names out of the source: every entry is written
   as `name: 'thing'` on one line, which is also what keeps the manifest a
   plain list and not a program. */
const manifestNames = (text, key) =>
  [...text.matchAll(new RegExp(`${key}:\\s*'([^']+)'`, 'g'))].map((m) => m[1]);

// `viewport` is the <meta> tag, not a blank on the record.
const pageFields = new Set(
  [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'viewport')
);
const pageChecks = new Set([...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]));

const listedFields = new Set(manifestNames(source, 'name'));
const listedChecks = new Set(
  manifestNames(source.slice(source.indexOf('CHECK_GROUPS')), 'name')
);
// The FIELDS entries and the CHECK_GROUPS options both write `name:`, so the
// field set is what is left once the check names are taken out.
for (const name of listedChecks) listedFields.delete(name);

const missing = (want, have) => [...want].filter((name) => !have.has(name));

assert.deepStrictEqual(
  missing(pageFields, listedFields),
  [],
  'ช่องกรอกในกระดาษที่ยังไม่มีในรายการของหน้ามือถือ'
);
assert.deepStrictEqual(
  missing(listedFields, pageFields),
  [],
  'รายการของหน้ามือถือมีชื่อที่ไม่มีอยู่ในกระดาษ'
);
assert.deepStrictEqual(
  missing(pageChecks, listedChecks),
  [],
  'ช่องติ๊กในกระดาษที่ยังไม่มีในรายการของหน้ามือถือ'
);
assert.deepStrictEqual(
  missing(listedChecks, pageChecks),
  [],
  'รายการของหน้ามือถือมีช่องติ๊กที่ไม่มีอยู่ในกระดาษ'
);

// The two numbers the design records. A change to either is a change to the
// official form and has to be a deliberate edit here, not a surprise.
assert.strictEqual(pageFields.size, 64, `กระดาษมีช่องกรอก ${pageFields.size} ช่อง ไม่ใช่ 64`);
assert.strictEqual(pageChecks.size, 25, `กระดาษมีช่องติ๊ก ${pageChecks.size} จุด ไม่ใช่ 25`);

// Every field belongs to a step that exists.
const steps = new Set([...source.matchAll(/\{\s*n:\s*(\d)/g)].map((m) => Number(m[1])));
const stepped = [...source.matchAll(/name:\s*'([^']+)',\s*step:\s*(\d)/g)];
for (const [, name, step] of stepped) {
  assert.ok(steps.has(Number(step)), `${name} อยู่ในขั้นที่ ${step} ซึ่งไม่มีในรายการขั้นตอน`);
}

console.log(`ok — รายการช่องกรอก ${pageFields.size} ช่อง และช่องติ๊ก ${pageChecks.size} จุด ตรงกับกระดาษ`);

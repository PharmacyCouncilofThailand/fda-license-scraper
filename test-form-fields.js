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
const rawSource = fs.readFileSync(MANIFEST, 'utf8');

/* The manifest is an ES module and this is CommonJS. Rather than add a build
   step for one test, read the entries out of the source text. A `//`-commented
   or `/* *\/`-commented entry is dead code the bundler never ships, so it must
   not count as present here either — strip comments before scanning.

   A regex can't tell a comment `//` from a `//` inside a quoted label (Thai
   labels do contain it), so this walks the text char by char, tracking
   whether it is inside a `'…'`/`"…"` string (backslash-escapes the quote)
   and only treating line and block comments as comments outside of one. */
const stripComments = (text) => {
  let out = '';
  let i = 0;
  let quote = null; // the quote char we're inside, or null
  while (i < text.length) {
    const ch = text[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
};

const source = stripComments(rawSource);

const entriesOf = (text, key) => [...text.matchAll(new RegExp(`${key}:\\s*'([^']+)'`, 'g'))].map((m) => m[1]);

// `viewport` is the <meta> tag, not a blank on the record.
const pageFields = new Set(
  [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'viewport')
);
const pageChecks = new Set([...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]));
const pageTextareas = new Set(
  [...html.matchAll(/<textarea\b[^>]*\bname="([^"]+)"/g)].map((m) => m[1])
);

// FIELDS and CHECK_GROUPS are two separate sections of the file — slice on the
// section boundary rather than trying to tell the two apart by shape, since
// both write `name:` entries.
const checkStart = source.indexOf('CHECK_GROUPS');
const fieldsSection = source.slice(0, checkStart);
const checksSection = source.slice(checkStart);

const fieldEntries = entriesOf(fieldsSection, 'name');
const checkEntries = entriesOf(checksSection, 'name');
const listedFields = new Set(fieldEntries);
const listedChecks = new Set(checkEntries);

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
assert.strictEqual(pageFields.size, 67, `กระดาษมีช่องกรอก ${pageFields.size} ช่อง ไม่ใช่ 67`);
assert.strictEqual(pageChecks.size, 25, `กระดาษมีช่องติ๊ก ${pageChecks.size} จุด ไม่ใช่ 25`);

// The manifest's own entry counts, not just the set of names — a name listed
// twice (a duplicate entry, or the same field under two different steps)
// collapses into one name in a Set and would otherwise slip through silently.
assert.strictEqual(fieldEntries.length, 67, `รายการ FIELDS มี ${fieldEntries.length} รายการ ไม่ใช่ 67 (มีชื่อซ้ำหรือไม่)`);
assert.strictEqual(checkEntries.length, 25, `รายการ CHECK_GROUPS มี ${checkEntries.length} ตัวเลือก ไม่ใช่ 25 (มีชื่อซ้ำหรือไม่)`);

// Every field belongs to a step that actually renders fields. Steps 1-4 and 6
// do; step 5 is the photo screen and renders no <input>/<textarea> at all, so
// a field parked there is unreachable even though `5` is a valid entry in
// STEPS. Do NOT change this back to `steps.has(...)` against STEPS — that is
// exactly the check that let a field get silently stranded on step 5 before.
const RENDERING_STEPS = new Set([1, 2, 3, 4, 6]);
const stepped = [...fieldsSection.matchAll(/name:\s*'([^']+)',\s*step:\s*(\d)/g)];
for (const [, name, step] of stepped) {
  assert.ok(
    RENDERING_STEPS.has(Number(step)),
    `${name} อยู่ในขั้นที่ ${step} ซึ่งไม่ใช่ขั้นที่มีช่องกรอกจริง (ขั้น 5 เป็นหน้าถ่ายภาพ ไม่มีช่องกรอก)`
  );
}

// A field's type must be 'textarea' exactly when the page renders that blank
// as a <textarea> — otherwise the wizard shows a one-line box for a blank the
// paper gives several lines to (or vice versa). 'officers' fields are exempt:
// they render as a <textarea> only as an implementation detail of the officer
// picker widget, not because the paper gives that blank multiple lines.
const typed = [...fieldsSection.matchAll(/name:\s*'([^']+)'[^{}]*?type:\s*'([^']+)'/g)];
for (const [, name, type] of typed) {
  if (type === 'officers') continue;
  assert.strictEqual(
    type === 'textarea',
    pageTextareas.has(name),
    `${name}: manifest ระบุ type: '${type}' แต่หน้ากระดาษเรนเดอร์เป็น ${pageTextareas.has(name) ? '<textarea>' : '<input>'}`
  );
}

console.log(`ok — รายการช่องกรอก ${pageFields.size} ช่อง และช่องติ๊ก ${pageChecks.size} จุด ตรงกับกระดาษ`);

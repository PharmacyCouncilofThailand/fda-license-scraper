'use strict';

/**
 * Where a filled value sits inside its blank in the Word download.
 *
 * The office marked up a record of their own — `templates/inspection-form-filled.docx`,
 * the same shop as `test/fixtures/fixform-values.json` — to show what they
 * want: every value a couple of spaces clear of the label in front of it, a
 * short value sitting in the middle of its rule, and every line still the
 * length it is in their blank form. That file is the expectation here, and the
 * same record rendered from the template is compared against it.
 *
 * The comparison is not character-exact. The office typed their spacing by eye
 * and their own lines disagree with each other by a space or two; what has to
 * match is the structure — the same text in the same order, each value inside
 * its blank rather than against the label, and no blank carrying more tabs
 * than theirs, since a spare tab is what pushes a line onto the next one.
 *
 * Neither Word file is in the repository (both carry the inspecting officers'
 * names), so this skips with a message when they are absent.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zip = require('./src/zip');
const { renderFormDocx } = require('./src/docx-form');

const TEMPLATE = path.join(__dirname, 'templates', 'inspection-form.docx');
const EXPECTED = path.join(__dirname, 'templates', 'inspection-form-filled.docx');

for (const file of [TEMPLATE, EXPECTED]) {
  if (!fs.existsSync(file)) {
    console.log(`ข้าม — ไม่พบ ${file}`);
    process.exit(0);
  }
}

/** How much the office's own spacing varies between two lines of one record. */
const SPACE_SLACK = 5;
/** A blank may come out a rule short of theirs, but never a rule longer. */
const TAB_SLACK = 2;

function documentXml(buffer) {
  return zip
    .read(buffer)
    .find((entry) => entry.name === 'word/document.xml')
    .data.toString('utf8');
}

/** Each paragraph as its runs of text, spaces and tabs, in order. */
function paragraphs(xml) {
  return xml
    .split('<w:p ')
    .slice(1)
    .map((para) => {
      let text = '';
      for (const run of para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>|<w:tab\/>/g)) {
        text += run[1] === undefined ? '\t' : run[1];
      }
      return text;
    });
}

/** Split a paragraph into its words, its runs of spaces and its runs of tabs. */
function segments(text) {
  return (text.match(/\t+| +|[^\t ]+/g) || []).map((part) =>
    part[0] === '\t' || part[0] === ' '
      ? { gap: part[0] === '\t' ? 'tab' : 'space', size: part.length }
      : { word: part }
  );
}

(async () => {
  const expected = paragraphs(documentXml(fs.readFileSync(EXPECTED)));
  const ours = paragraphs(
    documentXml(await renderFormDocx(require('./test/fixtures/fixform-values.json')))
  );

  assert.strictEqual(ours.length, expected.length, 'จำนวนย่อหน้าไม่ตรงกับบันทึกของสำนักงาน');

  const problems = [];
  let filled = 0;

  expected.forEach((want, i) => {
    const theirs = segments(want);
    const mine = segments(ours[i]);
    const at = `ย่อหน้า #${i}`;

    const words = (parts) => parts.filter((p) => p.word).map((p) => p.word);
    if (JSON.stringify(words(theirs)) !== JSON.stringify(words(mine))) {
      problems.push(`${at}: ข้อความไม่ตรงกัน\n  ต้องการ ${want}\n  ได้     ${ours[i]}`);
      return;
    }

    // Same words in the same order, so the gaps line up one for one.
    const theirGaps = theirs.filter((p) => p.gap);
    const myGaps = mine.filter((p) => p.gap);
    if (theirGaps.length !== myGaps.length) {
      problems.push(`${at}: จำนวนช่องว่าง/แท็บไม่ตรงกัน\n  ต้องการ ${want}\n  ได้     ${ours[i]}`);
      return;
    }

    theirGaps.forEach((gap, k) => {
      const got = myGaps[k];
      if (got.gap !== gap.gap) {
        problems.push(`${at}: ช่องที่ ${k + 1} เป็น ${got.gap} แต่ของสำนักงานเป็น ${gap.gap}`);
        return;
      }
      if (gap.gap === 'space') {
        // One space is a space between words; the padding in front of a value
        // is the office's own two or more.
        if (gap.size < 2) return;
        filled += 1;
        if (got.size < 2) problems.push(`${at}: ค่าเว้นจากข้อความหน้าช่องแค่ ${got.size} เคาะ`);
        if (Math.abs(got.size - gap.size) > SPACE_SLACK) {
          problems.push(`${at}: เว้นหน้า ${got.size} เคาะ ของสำนักงาน ${gap.size} เคาะ`);
        }
        return;
      }
      // A tab too many is a line pushed onto the next one, so that side has no
      // slack at all beyond the office's own.
      if (got.size > gap.size + TAB_SLACK) {
        problems.push(`${at}: แท็บ ${got.size} ตัว ของสำนักงาน ${gap.size} ตัว — บรรทัดจะยาวเกิน`);
      }
    });
  });

  assert.deepStrictEqual(problems, [], `\n${problems.join('\n')}\n`);
  assert.ok(filled >= 10, `เทียบช่องที่กรอกได้แค่ ${filled} ช่อง น้อยเกินกว่าจะเชื่อผลได้`);
  console.log(`ok — ${filled} ช่องเว้นจากข้อความหน้าช่องและอยู่ในช่วงเดียวกับบันทึกของสำนักงาน`);
  console.log('ok — ไม่มีช่องใดแท็บเกินบันทึกของสำนักงาน');

  // The same read against the blank form: a value stands in for the tabs it
  // covers, so a paragraph never comes out with more tabs than the template
  // gave it. One tab too many is one line pushed onto the next.
  const blank = paragraphs(documentXml(fs.readFileSync(TEMPLATE)));
  const tabsIn = (text) => (text.match(/\t/g) || []).length;
  const grew = blank
    .map((text, i) => ({ i, was: tabsIn(text), now: tabsIn(ours[i]) }))
    .filter((para) => para.now > para.was);
  assert.deepStrictEqual(
    grew,
    [],
    `ย่อหน้าที่แท็บเพิ่มขึ้นหลังกรอก (บรรทัดจะยาวเกินเดิม): ${grew
      .map((para) => `#${para.i} ${para.was}->${para.now}`)
      .join(', ')}`
  );
  const trimmed = blank.filter((text, i) => tabsIn(ours[i]) < tabsIn(text)).length;
  assert.ok(trimmed >= 5, `มีแค่ ${trimmed} ย่อหน้าที่ตัดแท็บ — ค่าที่กรอกไม่ได้กินแท็บที่มันทับ`);

  console.log(`ok — ไม่มีย่อหน้าใดแท็บเพิ่มขึ้นจากเทมเพลต (${trimmed} ย่อหน้ากินแท็บที่ค่าทับไป)`);
})();

'use strict';

/**
 * Fill the officer's own .docx and hand it back, so the record can still be
 * edited in Word after the search data is in it.
 *
 * `templates/inspection-form.docx` is that same Word file with `{{field}}`
 * runs dropped into its blanks and `{{chk:name}}` in place of each ☐ — so the
 * layout, tab stops, fonts, footer and signature block are the originals, not
 * a rebuild. Filling it is a string replace inside `word/document.xml`, which
 * is why this needs no Word library at all.
 *
 * Regenerating the template after the office revises the form is
 * `scripts/build-docx-template.js`.
 *
 * The template is not in the repository — it carries the inspecting officers'
 * names — so a deployment puts it on the machine and points `FORM_TEMPLATE` at
 * it. Without it the PDF still works and only this endpoint fails, with the
 * message below rather than a stack trace.
 */

const fs = require('fs');
const path = require('path');
const zip = require('./zip');

const TEMPLATE =
  process.env.FORM_TEMPLATE ||
  path.join(__dirname, '..', 'templates', 'inspection-form.docx');

/** Values land inside XML text nodes, so they have to be escaped. */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Word rejects raw control characters in document.xml.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

function renderFormDocx(data) {
  const values = (data && data.values) || {};
  const checks = (data && data.checks) || {};

  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(
      `ไม่พบเทมเพลตฟอร์ม Word ที่ ${TEMPLATE} — ` +
        'วางไฟล์ไว้ที่ templates/inspection-form.docx หรือชี้ FORM_TEMPLATE ไปที่ไฟล์นั้น'
    );
  }

  const entries = zip.read(fs.readFileSync(TEMPLATE));
  const document = entries.find((e) => e.name === 'word/document.xml');
  if (!document) throw new Error('template is missing word/document.xml');

  const xml = document.data
    .toString('utf8')
    .replace(/\{\{chk:([A-Za-z0-9_]+)\}\}/g, (_, name) => (checks[name] ? '☑' : '☐'))
    .replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => escapeXml(values[name]));

  document.data = Buffer.from(xml, 'utf8');
  return zip.write(entries);
}

module.exports = { renderFormDocx };

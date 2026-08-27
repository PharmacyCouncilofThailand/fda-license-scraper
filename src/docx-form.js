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
const config = require('./config');
const layout = require('./docx-layout');

/**
 * Where the template comes from. A deployment has no writable disk and the
 * file is too big for an environment variable (70 KB base64, over Vercel's
 * limit), so `FORM_TEMPLATE_URL` points at a private copy and the bytes are
 * fetched once per instance and kept in memory.
 */
const TEMPLATE =
  config.formTemplate ||
  path.join(__dirname, '..', 'templates', 'inspection-form.docx');

let downloaded = null;

/**
 * A private Vercel Blob is read with the store's token, and that token also
 * grants writes — so it goes to the Blob host and nowhere else, however
 * FORM_TEMPLATE_URL is set.
 */
function blobAuth() {
  if (!config.blobToken) return {};
  let host;
  try {
    host = new URL(config.formTemplateUrl).hostname;
  } catch {
    return {};
  }
  return host.endsWith('.blob.vercel-storage.com')
    ? { Authorization: `Bearer ${config.blobToken}` }
    : {};
}

async function loadTemplate() {
  if (config.formTemplateUrl) {
    if (!downloaded) {
      downloaded = fetch(config.formTemplateUrl, { headers: blobAuth() })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return Buffer.from(await res.arrayBuffer());
        })
        .catch((err) => {
          // A failed download must not poison every later request.
          downloaded = null;
          throw new Error(
            `ดาวน์โหลดเทมเพลตฟอร์ม Word จาก FORM_TEMPLATE_URL ไม่สำเร็จ: ${err.message}`
          );
        });
    }
    return downloaded;
  }

  if (!fs.existsSync(TEMPLATE)) {
    throw new Error(
      `ไม่พบเทมเพลตฟอร์ม Word ที่ ${TEMPLATE} — ` +
        'วางไฟล์ไว้ที่ templates/inspection-form.docx, ชี้ FORM_TEMPLATE ไปที่ไฟล์นั้น ' +
        'หรือตั้ง FORM_TEMPLATE_URL สำหรับการ deploy'
    );
  }
  return fs.readFileSync(TEMPLATE);
}

/** Values land inside XML text nodes, so they have to be escaped. */
function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Word rejects raw control characters in document.xml.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/*
 * On screen (7) and (9) are several blank lines each, because a browser will
 * not wrap one input across lines. In the Word file they are a single
 * wrapping paragraph with one blank in it, so the continuation lines fold
 * back into their first line — otherwise everything typed below the first
 * line is simply dropped from the download.
 */
const CONTINUATIONS = {
  leaveProofNote: ['leaveProofNote2'],
  behaviour1: ['behaviour2', 'behaviour3', 'behaviour4', 'behaviour5', 'behaviour6'],
};

function foldContinuations(values) {
  const folded = { ...values };
  for (const [first, rest] of Object.entries(CONTINUATIONS)) {
    const parts = [folded[first], ...rest.map((name) => folded[name])]
      .map((v) => String(v == null ? '' : v).trim())
      .filter(Boolean);
    folded[first] = parts.join(' ');
  }
  return folded;
}

async function renderFormDocx(data) {
  const values = foldContinuations((data && data.values) || {});
  const checks = (data && data.checks) || {};

  const entries = zip.read(await loadTemplate());
  const document = entries.find((e) => e.name === 'word/document.xml');
  if (!document) throw new Error('template is missing word/document.xml');

  const xml = layout
    .fillDocumentXml(
      document.data
        .toString('utf8')
        .replace(/\{\{chk:([A-Za-z0-9_]+)\}\}/g, (_, name) => (checks[name] ? '☑' : '☐')),
      values
    )
    // Any token the office adds mid-sentence, sharing its run with other text,
    // still gets filled — just without the padding or the tab arithmetic.
    .replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => escapeXml(values[name]));

  document.data = Buffer.from(xml, 'utf8');
  return zip.write(entries);
}

module.exports = { renderFormDocx };

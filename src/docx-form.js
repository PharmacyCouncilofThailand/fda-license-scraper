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

/**
 * Each check's label, read off the record page's own buttons, so the two files
 * agree on the exact wording. Read once; if the page is not on disk the checks
 * simply are not bolded rather than the whole download failing.
 */
const CHECK_LABELS = (() => {
  for (const rel of [['..', 'public', 'form.html'], ['..', 'web', 'public', 'form.html']]) {
    try {
      const html = fs.readFileSync(path.join(__dirname, ...rel), 'utf8');
      const map = {};
      for (const m of html.matchAll(
        /<button\b[^>]*\bclass="check"[^>]*\bdata-name="([^"]+)"[^>]*>([^<]*)<\/button>/g
      )) {
        map[m[1]] = m[2].trim();
      }
      if (Object.keys(map).length) return map;
    } catch {
      // try the next path
    }
  }
  return {};
})();

const runText = (xml) =>
  [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');

/** Add bold to a whole run's formatting. */
function boldRun(xml) {
  if (/<w:b\/>/.test(xml)) return xml;
  if (/<w:rPr>/.test(xml)) return xml.replace('<w:rPr>', '<w:rPr><w:b/><w:bCs/>');
  // An empty, self-closing <w:rPr/> has no '<w:rPr>' to open, so grow it into a
  // real one rather than inserting a second rPr beside it (invalid OOXML).
  if (/<w:rPr\/>/.test(xml)) return xml.replace('<w:rPr/>', '<w:rPr><w:b/><w:bCs/></w:rPr>');
  return xml.replace(/(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr><w:b/><w:bCs/></w:rPr>');
}

/** Bold only chars [from,to) of a single-text run, splitting it around them. */
function boldPart(xml, from, to) {
  const tm = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/.exec(xml);
  if (!tm) return boldRun(xml);
  const text = tm[2];
  const open = xml.slice(0, xml.indexOf('>') + 1); // <w:r ...>
  const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(xml) || [''])[0];
  const boldRPr = rPr
    ? rPr.replace('<w:rPr>', '<w:rPr><w:b/><w:bCs/>')
    : '<w:rPr><w:b/><w:bCs/></w:rPr>';
  // Split runs carry the spaces they were given, so preserve them explicitly.
  const wt = (t) => `<w:t xml:space="preserve">${t}</w:t>`;
  const run = (pr, t) => `${open}${pr}${wt(t)}</w:r>`;
  const pre = text.slice(0, from);
  const mid = text.slice(from, to);
  const post = text.slice(to);
  return (pre ? run(rPr, pre) : '') + run(boldRPr, mid) + (post ? run(rPr, post) : '');
}

/**
 * Bold each check's option label, the way the record page sets every choice in
 * section 3. The box itself is still a `{{chk:name}}` token here; the label is
 * the run(s) that follow it, up to the next check. A label that ends partway
 * through a run (the sentence carries straight on) splits that run so only the
 * option is bold.
 */
function boldCheckLabels(xml, labels) {
  const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  const TOKEN = /\{\{chk:([A-Za-z0-9_]+)\}\}/g;
  let out = '';
  let pos = 0;
  let m;
  while ((m = TOKEN.exec(xml))) {
    const label = labels[m[1]];
    const chkEnd = xml.indexOf('</w:r>', m.index) + 6;
    out += xml.slice(pos, chkEnd);
    pos = chkEnd;
    if (!label) continue;

    // Gather following runs until the label is fully present in their text.
    const runs = [];
    let concat = '';
    let scan = pos;
    RUN.lastIndex = pos;
    let rm;
    let guard = 0;
    while ((rm = RUN.exec(xml)) && guard < 14) {
      if (xml.slice(scan, rm.index).includes('{{chk:')) break; // next check reached
      runs.push({ xml: rm[0], index: rm.index, start: concat.length });
      concat += runText(rm[0]);
      scan = rm.index + rm[0].length;
      guard += 1;
      if (concat.indexOf(label) !== -1) break;
    }

    const li = concat.indexOf(label);
    if (li === -1) continue; // no match — leave these runs to be emitted later
    const labelStart = li;
    const labelEnd = li + label.length;
    let cursor = pos;
    for (const r of runs) {
      out += xml.slice(cursor, r.index); // whitespace/markup between runs
      const rStart = r.start;
      const rEnd = r.start + runText(r.xml).length;
      const from = Math.max(rStart, labelStart);
      const to = Math.min(rEnd, labelEnd);
      if (to <= from) out += r.xml;
      else if (from === rStart && to === rEnd) out += boldRun(r.xml);
      else out += boldPart(r.xml, from - rStart, to - rStart);
      cursor = r.index + r.xml.length;
    }
    pos = cursor;
  }
  out += xml.slice(pos);
  return out;
}

/**
 * Drop the empty paragraph above page 1's ลงชื่อ. Page 1 is full to the last
 * line, so a value that wraps one more line (a long เมื่อวันที่) pushed the
 * signature onto page 2; without the spacer that line has room.
 */
function dropPage1Spacer(xml) {
  const PARA = /<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*<\/w:p>/g;
  const paras = [...xml.matchAll(PARA)];
  const sign = paras.findIndex((m) =>
    runText(m[0]).includes('เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต')
  );
  const spacer = sign > 0 && paras[sign - 1];
  if (!spacer || runText(spacer[0]).trim() || /<w:(?:sectPr|br|drawing)\b/.test(spacer[0])) {
    return xml;
  }
  return xml.slice(0, spacer.index) + xml.slice(spacer.index + spacer[0].length);
}

async function renderFormDocx(data) {
  const values = foldContinuations((data && data.values) || {});
  const checks = (data && data.checks) || {};
  // Values drawn from อย. are set in bold on screen; carry that into the Word
  // file so the download reads the same way.
  const fda = new Set(data && data.fda);

  const entries = zip.read(await loadTemplate());
  const document = entries.find((e) => e.name === 'word/document.xml');
  if (!document) throw new Error('template is missing word/document.xml');

  const xml = layout
    .fillDocumentXml(
      // Bold the option labels while the {{chk:name}} tokens still mark where
      // each one is, then swap the tokens for the ticked/empty box.
      boldCheckLabels(dropPage1Spacer(document.data.toString('utf8')), CHECK_LABELS)
        .replace(/\{\{chk:([A-Za-z0-9_]+)\}\}/g, (_, name) => (checks[name] ? '☑' : '☐')),
      values,
      fda
    )
    // Any token the office adds mid-sentence, sharing its run with other text,
    // still gets filled — just without the padding or the tab arithmetic.
    .replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => escapeXml(values[name]));

  document.data = Buffer.from(xml, 'utf8');
  return zip.write(entries);
}

module.exports = { renderFormDocx };

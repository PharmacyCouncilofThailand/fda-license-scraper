'use strict';

/**
 * Pharmacist licence lookup, over the Pharmacy Council's own search form.
 *
 * The council site has no API: its home page posts to
 * `index.php?option=com_pharmacist_list` and renders a whole HTML page back.
 * So this module posts the same form and reads the one table in that page
 * carrying `bordercolor="#66CC66"`.
 *
 * Two things about the upstream shape the design here. It matches exactly —
 * "สมชา" does not find "สมชาย" — so there is no point searching while the
 * user is still typing. And it searches one field at a time, first name or
 * surname, never both, so a search with both filled is two requests whose
 * results are intersected here.
 */

const { ScrapeError } = require('./scraper');

/** Rows kept per group. "สมชาย" alone is 71; a screen panel is not a phone book. */
const MAX_ROWS_PER_GROUP = 200;

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** Tags out, entities in, whitespace squeezed. */
function text(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The name cell is `ภก. ชื่อ นามสกุล` followed by `<br/>` and coloured
 * `<span>`s carrying the notes — the licence-replacement line in blue, and
 * warnings such as the continuing-education one in red. The council's markup
 * closes those spans with another `<span>`, so match on the opening tag and
 * take everything up to the next tag rather than trusting a closing tag.
 */
function splitNameCell(cellHtml) {
  const notes = [];
  const spans = cellHtml.matchAll(/<span[^>]*>([^<]*)/gi);
  for (const [, inner] of spans) {
    const note = text(inner).replace(/^[-–\s]+/, '').trim();
    if (note) notes.push(note);
  }

  const nameHtml = cellHtml.split(/<br\s*\/?>|<span/i)[0];
  const name = text(nameHtml);
  const titleMatch = name.match(/^(ภก\.|ภญ\.)\s*/);
  const title = titleMatch ? titleMatch[1] : '';
  const rest = titleMatch ? name.slice(titleMatch[0].length) : name;
  const space = rest.indexOf(' ');

  // Thai surnames carry no space, so the first one separates the two parts.
  const firstName = space === -1 ? rest : rest.slice(0, space);
  const lastName = space === -1 ? '' : rest.slice(space + 1).trim();

  return {
    title,
    firstName,
    lastName,
    fullName: [title, firstName, lastName].filter(Boolean).join(' '),
    notes,
  };
}

/**
 * The result table out of a whole council page, as rows.
 * Throws PARSE_ERROR when the table is not there at all — the council having
 * changed their page must not read as "this pharmacist does not exist".
 */
function parseResultTable(html) {
  const marker = String(html || '').search(/bordercolor="#66CC66"/i);
  if (marker === -1) {
    throw new ScrapeError(
      'โครงสร้างหน้าเว็บสภาเภสัชกรรมเปลี่ยน กรุณาแจ้งผู้ดูแลระบบ',
      502,
      'PARSE_ERROR'
    );
  }
  const start = html.lastIndexOf('<table', marker);
  const end = html.indexOf('</table>', marker);
  const table = html.slice(start, end === -1 ? undefined : end);

  const rows = [];
  for (const [, rowHtml] of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    if (/<th[\s>]/i.test(rowHtml)) continue; // header
    if (/colspan/i.test(rowHtml)) continue; // the "ไม่พบรายการ" row
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (cells.length < 5) continue;

    // ลำดับ | ชื่อ | เลขที่ใบอนุญาต | สถานะ | ใบอนุญาตหมดอายุ
    const [, nameCell, licenseCell, statusCell, expiryCell] = cells;
    const licenseNo = text(licenseCell);
    if (!/^\d+$/.test(licenseNo)) continue;

    const expiry = text(expiryCell);
    rows.push({
      ...splitNameCell(nameCell),
      licenseNo,
      status: text(statusCell),
      expiry: expiry === '-' ? '' : expiry,
    });
  }
  return rows;
}

module.exports = {
  parseResultTable,
  MAX_ROWS_PER_GROUP,
};

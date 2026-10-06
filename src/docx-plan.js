'use strict';

const { write } = require('./zip');

/**
 * The plan as the office's own Word table, built from nothing.
 *
 * The example the office sent is a finished plan, not a template with blanks,
 * so cloning rows out of it would be guesswork about which run holds what.
 * Six columns and a heading is little enough OOXML to write outright, and the
 * result is a plain document the office can go on editing.
 */

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** `2569-08-27` as the office writes it. */
function thaiDate(date) {
  const [year, month, day] = String(date || '').split('-');
  const name = THAI_MONTHS[Number(month) - 1];
  if (!name) return String(date || '');
  return `${Number(day)} ${name} ${year}`;
}

/** 13.789833 -> 13°47'23.4"N — the notation the office's own plans use. */
function degrees(value, positive, negative) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const abs = Math.abs(Number(value));
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  // Round to the displayed precision before checking for a rollover — .toFixed(1)
  // rounding "60.0" into view after the fact is what let 47'60.0" out the door.
  let s = Math.round(((abs - d) * 60 - m) * 60 * 10) / 10;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${value >= 0 ? positive : negative}`;
}

function coordinates(item) {
  if (item.lat == null || item.lng == null) return '';
  return `${degrees(item.lat, 'N', 'S')} ${degrees(item.lng, 'E', 'W')}`;
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/*
 * Every size, alignment and width below is read off the office's own plan
 * (แผนการตรวจ 27 สค 69.docx): TH SarabunPSK throughout, a 16pt title and date
 * over a short rule, a 15pt bold heading row, 14pt cells, and every cell
 * centred vertically. Sizes are half-points, widths twips.
 */
const FONT = 'TH SarabunPSK';
const SIZE = { title: 32, head: 30, body: 28 };

/** A run: plain text, or { text, bold, underline } — `tab` for a rule. */
function run(part, size) {
  const { text = '', bold = false, underline = false, tab = false } =
    typeof part === 'string' ? { text: part } : part;
  const rPr =
    `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
    (bold ? '<w:b/><w:bCs/>' : '') +
    (underline ? '<w:u w:val="single"/>' : '') +
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  return tab
    ? `<w:r>${rPr}<w:tab/></w:r>`
    : `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

/** One paragraph per line, so a cell can hold several. A line is a string
    or an array of runs. */
function paragraphs(lines, { bold = false, align = 'left', size = SIZE.body } = {}) {
  return (lines.length ? lines : [''])
    .map((line) => {
      const parts = (Array.isArray(line) ? line : [line]).map((part) =>
        typeof part === 'string' ? { text: part, bold } : part
      );
      return (
        `<w:p><w:pPr><w:jc w:val="${align}"/><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
        `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>` +
        parts.map((part) => run(part, size)).join('') +
        '</w:p>'
      );
    })
    .join('');
}

// Column widths of the office's plan, 15304 twips in all.
const WIDTHS = [807, 3583, 1559, 3402, 2268, 3685];

function cell(lines, index, options) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[index]}" w:type="dxa"/>` +
    `<w:vAlign w:val="center"/></w:tcPr>${paragraphs(lines, options)}</w:tc>`
  );
}

function headerRow() {
  const heads = [
    'ลำดับที่',
    'ชื่อสถานที่',
    'ประเภทใบอนุญาต',
    'สถานที่ตั้ง',
    'ผู้รับอนุญาต',
    'ผู้มีหน้าที่ปฏิบัติการ',
  ];
  return (
    '<w:tr><w:trPr><w:trHeight w:val="567"/><w:tblHeader/><w:jc w:val="center"/></w:trPr>' +
    heads
      .map((text, i) =>
        // The office sets the narrow licence-type heading a point smaller so
        // it fits its column.
        cell([text], i, { bold: true, align: 'center', size: i === 2 ? SIZE.body : SIZE.head })
      )
      .join('') +
    '</w:tr>'
  );
}

function pharmacistLines(item) {
  const people = item.pharmacists || [];
  const lines = [];
  people.forEach((person, i) => {
    // One pharmacist needs no numbering; several do, as the office writes
    // them — "คนที่ 1" in bold, then the name.
    lines.push(
      people.length > 1
        ? [{ text: `คนที่ ${i + 1}`, bold: true }, ` : ${person.name}`]
        : person.name
    );
    lines.push(person.licenceNo ? `ภ. ${person.licenceNo}` : 'ภ. ');
  });
  return lines;
}

function itemRow(item) {
  const place = [item.placeName];
  if (item.openHours) place.push(`เวลาทำการ ${item.openHours}`);
  const coords = coordinates(item);
  if (coords) place.push(coords);

  return (
    '<w:tr><w:trPr><w:jc w:val="center"/></w:trPr>' +
    cell([String(item.order)], 0, { align: 'center', bold: true }) +
    cell(place, 1) +
    cell([item.licenseType, item.licenseNo].filter(Boolean), 2, { align: 'center' }) +
    cell([item.address], 3) +
    cell([item.licenseeName], 4, { align: 'center' }) +
    cell(pharmacistLines(item), 5, { align: 'center' }) +
    '</w:tr>'
  );
}

function documentXml(plan) {
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>' +
    `<w:tblW w:w="${WIDTHS.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/>` +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join('') +
    '</w:tblBorders>' +
    // Word's own Table Grid inset, which the original inherits.
    '<w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>' +
    '</w:tblPr>' +
    '<w:tblGrid>' +
    WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    '</w:tblGrid>' +
    headerRow() +
    (plan.items || []).map(itemRow).join('') +
    '</w:tbl>';

  // The short rule under the date is four underlined tabs, as in the original.
  const rule = Array.from({ length: 4 }, () => ({ tab: true, underline: true }));

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    paragraphs([plan.title], { bold: true, align: 'center', size: SIZE.title }) +
    paragraphs([`วันที่ ${thaiDate(plan.date)}`], { align: 'center', size: SIZE.title }) +
    paragraphs([rule], { align: 'center', size: SIZE.title }) +
    paragraphs([''], { size: SIZE.title }) +
    table +
    paragraphs([''], {}) +
    // Landscape A4 with the original's 2cm top/bottom and 1.6cm side margins.
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' +
    '<w:pgMar w:top="1134" w:right="907" w:bottom="1134" w:left="907" ' +
    'w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOCUMENT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

/* TableGrid is what the table above asks for, and Word will not draw the
   borders without the style existing. The defaults pin TH SarabunPSK with
   single spacing and no space after a paragraph, as the original has —
   without them Word falls back to its own (Aptos, spaced paragraphs). */
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  `<w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>` +
  `<w:sz w:val="${SIZE.body}"/><w:szCs w:val="${SIZE.body}"/><w:lang w:val="en-US" w:bidi="th-TH"/>` +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr></w:style>' +
  '</w:styles>';

function renderPlanDocx(plan) {
  return write([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml(plan), 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES, 'utf8') },
  ]);
}

module.exports = { renderPlanDocx, thaiDate, coordinates, escapeXml };

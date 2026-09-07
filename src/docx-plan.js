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
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
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

/** One paragraph per line, so a cell can hold several. */
function paragraphs(lines, { bold = false, align = 'left' } = {}) {
  return (lines.length ? lines : [''])
    .map(
      (line) =>
        `<w:p><w:pPr><w:jc w:val="${align}"/><w:rPr>${bold ? '<w:b/>' : ''}` +
        `<w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>` +
        `<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>` +
        `<w:r><w:rPr>${bold ? '<w:b/>' : ''}` +
        `<w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>` +
        `<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>` +
        `<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    )
    .join('');
}

const WIDTHS = [700, 3200, 1500, 3600, 2400, 3200]; // twips, 14600 total ≈ landscape A4 text width

function cell(lines, index, options) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[index]}" w:type="dxa"/>` +
    `<w:vAlign w:val="top"/></w:tcPr>${paragraphs(lines, options)}</w:tc>`
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
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    heads.map((text, i) => cell([text], i, { bold: true, align: 'center' })).join('') +
    '</w:tr>'
  );
}

function pharmacistLines(item) {
  const people = item.pharmacists || [];
  const lines = [];
  people.forEach((person, i) => {
    // One pharmacist needs no numbering; several do, as the office writes them.
    lines.push(people.length > 1 ? `คนที่ ${i + 1} : ${person.name}` : person.name);
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
    '<w:tr>' +
    cell([String(item.order)], 0, { align: 'center' }) +
    cell(place, 1) +
    cell([item.licenseType, item.licenseNo].filter(Boolean), 2) +
    cell([item.address], 3) +
    cell([item.licenseeName], 4) +
    cell(pharmacistLines(item), 5) +
    '</w:tr>'
  );
}

function documentXml(plan) {
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>' +
    '<w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr>' +
    '<w:tblGrid>' +
    WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    '</w:tblGrid>' +
    headerRow() +
    (plan.items || []).map(itemRow).join('') +
    '</w:tbl>';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    paragraphs([plan.title], { bold: true, align: 'center' }) +
    paragraphs([`วันที่ ${thaiDate(plan.date)}`], { align: 'center' }) +
    paragraphs([''], {}) +
    table +
    // Landscape A4 with 1.5cm margins, in twips.
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' +
    '<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" ' +
    'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
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
   borders without the style existing. Nothing else is defined here. */
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
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

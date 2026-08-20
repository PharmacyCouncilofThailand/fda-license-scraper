/*
 * One-off: turn the officer's .docx into a template by dropping {{token}}
 * runs into the blanks and marking each ☐ with the field it belongs to.
 * Output: fda-license-scraper/templates/inspection-form.docx
 */
const fs = require('fs');
const path = require('path');
const zip = require('../src/zip');

// The office's own Word file, as handed over.
const SRC = process.argv[2] || path.join(__dirname, '..', '..', 'บันทึกการตรวจสถานที่ แบบขอซื้อยา.docx');
const OUT = path.join(__dirname, '..', 'templates', 'inspection-form.docx');

/* Which tab-run (counted across the document) starts each blank. */
const FIELD_AT_TAB = {
  10: 'pharmacistName',
  17: 'pharmacistLicenseNo',
  20: 'pharmacistLicenseExpiry',
  26: 'placeName',
  33: 'houseNo',
  38: 'village',
  44: 'moo',
  47: 'soi',
  51: 'road',
  56: 'subdistrict',
  60: 'district',
  63: 'province',
  67: 'phone',
  72: 'policeStation',
  77: 'inspectDate',
  83: 'inspectTime',
  88: 'licenseeName',
  97: 'operatorName',
  102: 'licenseNo',
  106: 'dutyPharmacist',
  116: 'dutyLicenseNo',
  118: 'dutyLicenseExpiry',
  120: 'openHours',
  124: 'checkTime',
  126: 'shopNameAtCheck',
  130: 'personFound',
  135: 'personIdCard',
  143: 'buyRequest',
  145: 'drugDispensed',
  148: 'drugQuantity',
  152: 'drugPrice',
  154: 'regNo',
  157: 'lot',
  159: 'mfgDate',
  161: 'expDate',
  165: 'notDispensedReason',
  174: 'admitPerson',
  180: 'complaintDetail',
  184: 'acknowledgedBy',
  190: 'dutyNote',
  203: 'leaveProofNote',
  233: 'curtainNote',
  249: 'signPage1Name',
  252: 'behaviour1',
  338: 'endTime',
};

/* The ☐ glyphs, in document order. */
const CHECKS = [
  'shopClosed', 'shopOpen',
  'rolePharmacist', 'roleLicensee', 'roleAgent',
  'noBuy', 'didBuy',
  'notDispensed',
  'admitSold',
  'sourceTip', 'sourcePlan', 'sourceComplaint',
  'licenceShown', 'licenceNotShown', 'licenceOriginal', 'licenceCopy',
  'dutyPresent', 'dutyAbsent',
  'leaveProofYes', 'leaveProofNo',
  'curtainNotFound', 'curtainFound',
  'informPharmacist', 'informLicensee', 'informAgent',
];

const entries = zip.read(fs.readFileSync(SRC));
let xml = entries.find((e) => e.name === 'word/document.xml').data.toString('utf8');

/* ---- 1. value runs before the blanks ---- */
const runRe = /<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g;
let tabIndex = 0;
let inserted = 0;
xml = xml.replace(runRe, (run) => {
  if (!/<w:tab\/>/.test(run)) return run;
  const field = FIELD_AT_TAB[tabIndex++];
  if (!field) return run;
  const rPr = (run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
  inserted += 1;
  return `<w:r>${rPr}<w:t xml:space="preserve">{{${field}}}</w:t></w:r>${run}`;
});

const missing = Object.keys(FIELD_AT_TAB).length - inserted;
if (missing !== 0) throw new Error(`expected ${Object.keys(FIELD_AT_TAB).length} blanks, filled ${inserted}`);

/* ---- 2. name every checkbox ---- */
let checkIndex = 0;
xml = xml.replace(/☐/g, () => {
  const name = CHECKS[checkIndex++];
  return name ? `{{chk:${name}}}` : '☐';
});
if (checkIndex !== CHECKS.length) {
  throw new Error(`expected ${CHECKS.length} checkboxes, found ${checkIndex}`);
}

for (const e of entries) {
  if (e.name === 'word/document.xml') e.data = Buffer.from(xml, 'utf8');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, zip.write(entries));
console.log(`ok — ${inserted} blanks, ${checkIndex} checkboxes, ${fs.statSync(OUT).size} bytes`);

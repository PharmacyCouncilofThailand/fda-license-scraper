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
  220: 'curtainNote',
  236: 'signPage1Name',
  238: 'behaviour1',
  259: 'endTime',
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

/* ----1b. the blanks that are not tab runs ---- */

/*
 * Item (10) is written with a literal "-" in each of its four blanks rather
 * than a tab leader, and the two page-2 signature lines are an empty "(   )"
 * with nothing to hang a tab off. Both are edited on screen, so both have to
 * reach the Word file — one paragraph at a time, so a "-" elsewhere in the
 * document cannot be caught by mistake.
 */
function inParagraph(match, replace) {
  let hits = 0;
  xml = xml.replace(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g, (para) => {
    const text = para.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!match(text)) return para;
    hits += 1;
    return replace(para);
  });
  return hits;
}

/* ยึด … จำนวน … อายัด … จำนวน …, in that order. */
const SEIZED = ['seizedItems', 'seizedCount', 'heldItems', 'heldCount'];
let dashes = 0;
let seizedParagraphs = inParagraph(
  (text) => text.includes('บัญชียึด อายัด และภาพถ่าย'),
  (para) =>
    para.replace(/<w:t([^>]*)>-<\/w:t>/g, (run, attrs) => {
      const field = SEIZED[dashes++];
      return field ? `<w:t${attrs}>{{${field}}}</w:t>` : run;
    })
);
if (seizedParagraphs !== 1 || dashes !== SEIZED.length) {
  throw new Error(`item (10): ${seizedParagraphs} paragraphs, ${dashes} blanks`);
}

/*
 * The inspecting officers' names in the opening paragraph. The original has
 * them as twenty-odd dotted runs, because Word split every name where it was
 * edited, so the record could not fill them and whoever the file named was
 * who the record said went. Collapsed into one {{officers1}} run with the
 * same formatting: no <w:tab/> moves, so FIELD_AT_TAB above still counts
 * true, and the dotted run stays one group to the parity test.
 */
{
  let done = 0;
  const hits = inParagraph(
    (text) => text.includes('อาศัยอำนาจตามความในมาตรา 47'),
    (para) => {
      const runs = para.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
      const textOf = (run) => (run.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/) || [])[1] || '';
      const from = runs.findIndex((r) => textOf(r).includes('ประกอบด้วย')) + 1;
      const to = runs.findIndex((r) => textOf(r).includes('นทรประเสริฐ'));
      if (from < 1 || to < from) return para;
      // By offset rather than by joining the runs back up: Word leaves
      // proofing marks and bookmarks between them, so they are not one
      // contiguous string in the file and a join matches nothing at all.
      const start = para.indexOf(runs[from]);
      const end = para.indexOf(runs[to]) + runs[to].length;
      const rPr = (runs[to].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      done = to - from + 1;
      return (
        para.slice(0, start) +
        `<w:r>${rPr}<w:t xml:space="preserve">{{officers1}}</w:t></w:r>` +
        para.slice(end)
      );
    }
  );
  if (hits !== 1 || done < 10 || !xml.includes('{{officers1}}')) {
    throw new Error(`officers: ${hits} paragraphs, ${done} runs replaced`);
  }
}

/* The two page-2 signature names: put the token just inside the "(". */
for (const [label, field] of [
  ['( ) เภสัชกร', 'signDutyName'],
  ['( ) ผู้แทนผู้รับอนุญาต', 'signLicenseeName'],
]) {
  const hits = inParagraph(
    (text) => text === label,
    (para) =>
      para.replace(
        /(<w:r(?: [^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>[^<]*\(<\/w:t>[\s\S]*?<\/w:r>)/,
        `$1<w:r><w:t xml:space="preserve">{{${field}}}</w:t></w:r>`
      )
  );
  if (hits !== 1) throw new Error(`signature "${label}": ${hits} paragraphs`);
}

/*
 * The five officers who sign page 2. Their names are literal text in the
 * signature table, one "( name )" paragraph each, split into three or four
 * runs apiece. Each becomes a {{signOfficerN}} between that paragraph's own
 * "(" and ")" runs, in document order, so the picker on the record can put
 * whoever actually went here. These runs carry no tab and no dotted
 * underline, so neither the tab grid above nor the blank count sees a change.
 */
{
  let n = 0;
  inParagraph(
    // Page 1's own '( {{signPage1Name}} )' matches this shape too, and is
    // already a blank by the time this runs — a paragraph with a token in
    // it has been dealt with.
    (text) => /^\(\s*\S[\s\S]*\)$/.test(text) && !text.includes('{{'),
    (para) => {
      const runs = para.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
      if (runs.length < 3) return para;
      const start = para.indexOf(runs[1]);
      const end = para.indexOf(runs[runs.length - 1]);
      const rPr = (runs[1].match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      n += 1;
      return (
        para.slice(0, start) +
        `<w:r>${rPr}<w:t xml:space="preserve">{{signOfficer${n}}}</w:t></w:r>` +
        para.slice(end)
      );
    }
  );
  if (n !== 5) throw new Error(`signature officers: ${n} paragraphs`);
}

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
const tokens = (xml.match(/\{\{(?!chk:)/g) || []).length;
console.log(
  `ok — ${tokens} blanks (${inserted} tab, ${dashes + 8} literal), ` +
    `${checkIndex} checkboxes, ${fs.statSync(OUT).size} bytes`
);

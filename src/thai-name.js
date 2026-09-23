'use strict';

/**
 * The FDA writes a pharmacist as one string with the title run into the first
 * name — "นางสาวกุลนิดา บูรณ์สิริจรุงรัฐ" — while the Pharmacy Council's
 * register searches first name and surname separately.
 *
 * `web/public/pharmacist-search.js` carries the same list for the browser.
 * That file is served straight off disk with no bundler, so it cannot require
 * this one; the two copies are deliberate and must be changed together.
 */
const TITLES = [
  'เภสัชกรหญิง',
  'เภสัชกร',
  'ว่าที่ร้อยตรีหญิง',
  'ว่าที่ร้อยตรี',
  'นางสาว',
  'นาง',
  'นาย',
  'ภญ.',
  'ภก.',
  'ดร.',
  'ผศ.',
  'รศ.',
  'ศ.',
].sort((a, b) => b.length - a.length); // Longest first, so นางสาว wins over นาง.

function splitThaiName(full) {
  let rest = String(full || '')
    .trim()
    .replace(/\s+/g, ' ');
  let title = '';
  for (const candidate of TITLES) {
    if (rest.startsWith(candidate)) {
      title = candidate;
      rest = rest.slice(candidate.length).trim();
      break;
    }
  }
  const parts = rest.split(' ').filter(Boolean);
  return { title, firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

module.exports = { splitThaiName, TITLES };

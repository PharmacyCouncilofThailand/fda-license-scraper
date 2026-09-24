'use strict';

/**
 * Pharmacist licence lookup, over the Pharmacy Council's own search form.
 *
 * The council site has no API: its home page posts to
 * `index.php?option=com_pharmacist_list` and renders a whole HTML page back.
 * So this module posts the same form and reads the one table in that page
 * carrying `bordercolor="#66CC66"`.
 *
 * The upstream matches exactly — "สมชา" does not find "สมชาย" — so there is
 * no point searching while the user is still typing. Since 2026-09 the form
 * also only searches first name and surname together (mode 5, both required);
 * the old one-field modes 2 and 3 now answer an empty table.
 */

const config = require('./config');
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
  const spans = cellHtml.matchAll(/<span([^>]*)>([^<]*)/gi);
  for (const [, attributes, inner] of spans) {
    const note = text(inner).replace(/^[-–\s]+/, '').trim();
    // The council colours a real warning — lapsed CE credits, a suspension —
    // red, and plain facts about the licence blue. That is the only thing
    // separating the two, so carry it through instead of guessing from wording.
    if (note) notes.push({ text: note, warning: /red/i.test(attributes) });
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
  // The council returns rows in its own order; the panel reads better sorted by
  // licence number, which is also roughly the order they were registered in.
  return rows.sort((a, b) => Number(a.licenseNo) - Number(b.licenseNo));
}

/** Search mode for first name + surname. 1 is by licence no, unused here. */
const BY_FULL_NAME = '5';

/**
 * One upstream search: both names, exact, rows back.
 *
 * Reading the body is inside the same guard as the request itself: the council
 * site can answer its headers and then stall, and the timeout that fires then
 * lands on `text()`, not on `fetch()`. Left outside, it escaped as a bare
 * TimeoutError and the API reported the council's outage as our own 500.
 */
async function fetchByName(firstName, lastName) {
  const body = new URLSearchParams({
    txtfind_type: BY_FULL_NAME,
    txtfind_name: firstName,
    txtfind_surname: lastName,
  });
  let html;
  try {
    const response = await fetch(config.pharmacistSearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': config.userAgent,
      },
      body,
      signal: AbortSignal.timeout(config.navTimeoutMs),
    });
    if (!response.ok) {
      throw new ScrapeError(
        `เว็บสภาเภสัชกรรมตอบกลับผิดปกติ (HTTP ${response.status})`,
        502,
        'UPSTREAM_ERROR'
      );
    }
    html = await response.text();
  } catch (err) {
    // The status check above already says it better than this would.
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError(
      `ติดต่อเว็บสภาเภสัชกรรมไม่ได้: ${err.message}`,
      502,
      'UPSTREAM_ERROR'
    );
  }
  // Outside the guard on purpose: a page we cannot read is PARSE_ERROR, and
  // that is a different thing to tell the user than an upstream outage.
  return parseResultTable(html);
}

/* Cached by the pair of terms, least recently used evicted first — the same
 * shape as the scrape cache in src/scraper.js. */
const searchCache = new Map(); // "first|last" -> { result, at }

function cacheKey(firstName, lastName) {
  return `${firstName}|${lastName}`;
}

function getCached(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > config.cacheTtlMs) {
    searchCache.delete(key);
    return null;
  }
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit.result;
}

function setCached(key, result) {
  searchCache.set(key, { result, at: Date.now() });
  while (searchCache.size > config.cacheMaxKeywords) {
    searchCache.delete(searchCache.keys().next().value);
  }
}

function clearPharmacistCache() {
  searchCache.clear();
}

function pharmacistCacheStats() {
  return { queries: searchCache.size, ttlMs: config.cacheTtlMs };
}

/**
 * Search by first name and surname — the council's form requires both.
 * The `firstName`/`lastName` groups stay in the response, always empty, so it
 * keeps the shape the UI reads.
 */
async function searchPharmacists({ firstName, lastName } = {}) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first || !last) {
    throw new ScrapeError('กรุณาระบุทั้งชื่อและนามสกุล', 400, 'MISSING_QUERY');
  }

  const key = cacheKey(first, last);
  const hit = getCached(key);
  if (hit) return { ...hit, cached: true };

  const rows = await fetchByName(first, last);
  const result = {
    query: { firstName: first, lastName: last },
    counts: { both: rows.length, firstName: 0, lastName: 0 },
    groups: { both: rows.slice(0, MAX_ROWS_PER_GROUP), firstName: [], lastName: [] },
  };
  setCached(key, result);
  return { ...result, cached: false };
}

module.exports = {
  parseResultTable,
  searchPharmacists,
  clearPharmacistCache,
  pharmacistCacheStats,
  MAX_ROWS_PER_GROUP,
};

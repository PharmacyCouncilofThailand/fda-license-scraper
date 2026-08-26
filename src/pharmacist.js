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
  return rows;
}

/** Search modes the council's form understands. We never use 1 (licence no). */
const BY_FIRST_NAME = '2';
const BY_LAST_NAME = '3';

/** One upstream search: one field, one exact term, rows back. */
async function fetchByField(type, term) {
  const body = new URLSearchParams({ txtfind_type: type, txtfind_id: term });
  let response;
  try {
    response = await fetch(config.pharmacistSearchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': config.userAgent,
      },
      body,
      signal: AbortSignal.timeout(config.navTimeoutMs),
    });
  } catch (err) {
    throw new ScrapeError(
      `ติดต่อเว็บสภาเภสัชกรรมไม่ได้: ${err.message}`,
      502,
      'UPSTREAM_ERROR'
    );
  }
  if (!response.ok) {
    throw new ScrapeError(
      `เว็บสภาเภสัชกรรมตอบกลับผิดปกติ (HTTP ${response.status})`,
      502,
      'UPSTREAM_ERROR'
    );
  }
  return parseResultTable(await response.text());
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
 * Search by first name, surname, or both.
 *
 * With both filled the two searches are intersected: a row found by both is
 * the person being looked for, and the two leftover groups are what saves a
 * search when one of the two fields is misspelt — which is easy to do against
 * an upstream that matches exactly.
 */
async function searchPharmacists({ firstName, lastName } = {}) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!first && !last) {
    throw new ScrapeError('กรุณาระบุชื่อหรือนามสกุล', 400, 'MISSING_QUERY');
  }

  const key = cacheKey(first, last);
  const hit = getCached(key);
  if (hit) return { ...hit, cached: true };

  const [firstRows, lastRows] = await Promise.all([
    first ? fetchByField(BY_FIRST_NAME, first) : Promise.resolve([]),
    last ? fetchByField(BY_LAST_NAME, last) : Promise.resolve([]),
  ]);

  const lastByLicence = new Set(lastRows.map((r) => r.licenseNo));
  const bothRows = first && last ? firstRows.filter((r) => lastByLicence.has(r.licenseNo)) : [];
  const bothByLicence = new Set(bothRows.map((r) => r.licenseNo));

  const groups = {
    both: bothRows,
    firstName: firstRows.filter((r) => !bothByLicence.has(r.licenseNo)),
    lastName: lastRows.filter((r) => !bothByLicence.has(r.licenseNo)),
  };
  const counts = {
    both: groups.both.length,
    firstName: groups.firstName.length,
    lastName: groups.lastName.length,
  };

  const result = {
    query: { firstName: first, lastName: last },
    counts,
    groups: {
      both: groups.both.slice(0, MAX_ROWS_PER_GROUP),
      firstName: groups.firstName.slice(0, MAX_ROWS_PER_GROUP),
      lastName: groups.lastName.slice(0, MAX_ROWS_PER_GROUP),
    },
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

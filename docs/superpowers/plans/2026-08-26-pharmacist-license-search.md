# Pharmacist ภ. Licence Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an inspector type a pharmacist's first name and/or surname and get their ภ. licence number, from the sidebar of the search page and from the inspection-record page, without leaving either page.

**Architecture:** A new backend module (`src/pharmacist.js`) posts to the Pharmacy Council's own search form, parses the result table out of the returned HTML, groups the rows and caches them; `src/server.js` exposes it as `GET /api/pharmacist`. The UI is one vanilla custom element (`web/public/pharmacist-search.js`) used by both the React sidebar and the static `form.html`, because `form.html` has no build step and is loaded by Puppeteer on every PDF render.

**Tech Stack:** Node 22 (built-in `fetch`, `AbortSignal.timeout`), Express 4, CommonJS backend, React 19 + Vite for the search page, plain HTML/CSS/JS for the record page, `node:assert` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-pharmacist-license-search-design.md`

## Global Constraints

- No new npm dependencies. Node's built-in `fetch` and `AbortSignal.timeout` only.
- Backend is CommonJS (`require` / `module.exports`), `'use strict';` at the top of every file — match `src/scraper.js`.
- Never edit `public/` — it is Vite build output. Sources live in `web/`.
- All user-facing strings are Thai. Code, comments, and commit messages are English.
- Errors thrown from the backend module must be `ScrapeError` instances (`require('./scraper')`) so the existing error handler in `src/server.js` maps them to a status and code.
- Upstream endpoint: `POST https://www.pharmacycouncil.org/index.php?option=com_pharmacist_list`, body `application/x-www-form-urlencoded` UTF-8, fields `txtfind_type` (`2` = first name, `3` = surname) and `txtfind_id`.
- Upstream matches **exactly** — no prefix, no partial. Never build UI that searches while typing.
- The result table is the one carrying `bordercolor="#66CC66"`.
- Max 200 rows kept per group; `counts` still reports the untruncated total.
- Tests use `node:assert` only. No test framework.
- Commit after every task.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `test/fixtures/pharmacist-*.html` | create | Saved slices of real upstream result tables |
| `src/pharmacist.js` | create | Upstream call, HTML → JSON parsing, grouping, cache |
| `test-parse.js` | create | Offline unit test of the parser against fixtures |
| `src/config.js` | modify | One new setting: `pharmacistSearchUrl` |
| `src/server.js` | modify | `GET /api/pharmacist` route; clear the new cache in `DELETE /api/cache` |
| `smoke-pharmacist.js` | create | Live check against the real council site |
| `package.json` | modify | `test:parse` and `smoke:pharmacist` scripts |
| `web/public/pharmacist-search.js` | create | `<pharmacist-search>` custom element |
| `web/public/theme.css` | modify | ~40 lines of styles for the element |
| `web/public/form.html` | modify | Load the script, place the element, hide it on print |
| `web/index.html` | modify | Load the script |
| `web/src/components/Sidebar.jsx` | modify | Place the element |
| `.env.example`, `README.md` | modify | Document the new setting |

---

### Task 1: Parser — HTML result table to JSON rows

**Files:**
- Create: `test/fixtures/pharmacist-surname.html`, `test/fixtures/pharmacist-notes.html`, `test/fixtures/pharmacist-empty.html`
- Create: `src/pharmacist.js`
- Create: `test-parse.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ScrapeError` from `src/scraper.js` — `new ScrapeError(message, status, code)`
- Produces:
  - `parseResultTable(html)` → `Array<Row>`, throws `ScrapeError(…, 502, 'PARSE_ERROR')` when no result table is present
  - `Row` = `{ title: string, firstName: string, lastName: string, fullName: string, licenseNo: string, status: string, expiry: string, notes: string[] }`

- [ ] **Step 1: Capture the fixtures from the live site**

The parser is tested against real markup, so capture it once and commit it. Run from the repo root:

```bash
mkdir -p test/fixtures && node -e "
const save = async (file, type, q) => {
  const r = await fetch('https://www.pharmacycouncil.org/index.php?option=com_pharmacist_list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'txtfind_type=' + type + '&txtfind_id=' + encodeURIComponent(q),
  });
  const html = await r.text();
  const i = html.indexOf('bordercolor=\"#66CC66\"');
  if (i < 0) throw new Error('no result table for ' + q);
  const start = html.lastIndexOf('<table', i);
  const end = html.indexOf('</table>', i) + 8;
  require('fs').writeFileSync('test/fixtures/' + file, html.slice(start, end));
  console.log(file, end - start, 'bytes');
};
(async () => {
  await save('pharmacist-surname.html', 3, 'ใจดี');
  await save('pharmacist-notes.html', 2, 'สมชาย');
  await save('pharmacist-empty.html', 3, 'zzzz');
})();
"
```

Expected: three files written. `pharmacist-surname.html` has several rows, `pharmacist-notes.html` has rows carrying a red `หน่วยกิตการศึกษาต่อเนื่องไม่เป็นไปตามหลักเกณฑ์` note, `pharmacist-empty.html` is the single `ไม่พบรายการ` row.

- [ ] **Step 2: Read one fixture to confirm the shape before writing the test**

```bash
node -e "console.log(require('fs').readFileSync('test/fixtures/pharmacist-surname.html','utf8').replace(/\s+/g,' ').slice(0,1200))"
```

Expected: a `<table … bordercolor="#66CC66">` with a header `<tr>` of `<th>` cells (ลำดับ / ชื่อผู้ประกอบวิชาชีพเภสัชกรรม / เลขที่ใบอนุญาต / สถานะ / ใบอนุญาตหมดอายุ), then data `<tr>`s of five `<td>`s each. The name cell looks like `ภก. สมชาย กีรติบูรณะ <br/><span style='color:blue'>(…)<span> &nbsp;`.

Note the malformed `<span>` opening tags used as closers in that markup — the parser must not assume well-formed HTML.

- [ ] **Step 3: Write the failing test**

Create `test-parse.js`:

```js
/**
 * Offline check of the Pharmacy Council result-table parser, against real
 * markup saved under test/fixtures. No network.
 *
 *   node test-parse.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseResultTable } = require('./src/pharmacist');

const fixture = (name) =>
  fs.readFileSync(path.join(__dirname, 'test', 'fixtures', name), 'utf8');

// --- a surname search with several people on it ---------------------------
const rows = parseResultTable(fixture('pharmacist-surname.html'));
assert.ok(rows.length > 1, 'ควรได้หลายแถวจากการค้นนามสกุล');

for (const row of rows) {
  assert.ok(['ภก.', 'ภญ.'].includes(row.title), `คำนำหน้าผิด: ${row.title}`);
  assert.ok(row.firstName, 'ไม่มีชื่อ');
  assert.ok(row.lastName, 'ไม่มีนามสกุล');
  assert.ok(/^\d+$/.test(row.licenseNo), `เลขใบอนุญาตไม่ใช่ตัวเลข: ${row.licenseNo}`);
  assert.strictEqual(row.fullName, `${row.title} ${row.firstName} ${row.lastName}`);
  assert.ok(!/[<>]/.test(row.fullName), 'ชื่อยังมีแท็ก HTML ติดมา');
  assert.ok(!row.fullName.includes('&nbsp;'), 'ชื่อยังมี entity ติดมา');
  assert.ok(row.status, 'ไม่มีสถานะ');
  assert.notStrictEqual(row.expiry, '-', 'ขีดควรถูกแปลงเป็นค่าว่าง');
  assert.ok(Array.isArray(row.notes), 'notes ต้องเป็นอาร์เรย์');
}

// Every row of a surname search shares the surname.
assert.strictEqual(
  new Set(rows.map((r) => r.lastName)).size,
  1,
  'ค้นนามสกุลเดียวแต่ได้นามสกุลหลายแบบ'
);

// A leading zero in the licence number is part of it, not a number to trim.
const padded = parseResultTable(fixture('pharmacist-notes.html')).find((r) =>
  r.licenseNo.startsWith('0')
);
assert.ok(padded, 'ไม่เจอเลขใบอนุญาตที่ขึ้นต้นด้วยศูนย์ในไฟล์ตัวอย่าง');

// --- notes ----------------------------------------------------------------
const noted = parseResultTable(fixture('pharmacist-notes.html'));
const warned = noted.find((r) =>
  r.notes.some((n) => n.includes('หน่วยกิตการศึกษาต่อเนื่อง'))
);
assert.ok(warned, 'ไม่เจอแถวที่มีหมายเหตุหน่วยกิต');
assert.ok(
  warned.notes.some((n) => n.includes('ใบแทน')),
  'หมายเหตุบรรทัดสีน้ำเงินหายไป'
);
for (const note of warned.notes) {
  assert.ok(!/^[-\s]/.test(note), `หมายเหตุยังมีขีด/ช่องว่างนำหน้า: ${note}`);
  assert.ok(!/[<>]/.test(note), 'หมายเหตุยังมีแท็ก HTML ติดมา');
}

// --- nothing found --------------------------------------------------------
assert.deepStrictEqual(
  parseResultTable(fixture('pharmacist-empty.html')),
  [],
  'หน้าไม่พบรายการควรได้อาร์เรย์ว่าง'
);

// --- the council changed their page --------------------------------------
assert.throws(
  () => parseResultTable('<html><body><p>อยู่ระหว่างปรับปรุงระบบ</p></body></html>'),
  (err) => err.code === 'PARSE_ERROR' && err.status === 502,
  'หน้าเว็บที่ไม่มีตารางผลลัพธ์ต้อง throw PARSE_ERROR'
);

console.log(`ok — parse ${rows.length + noted.length} rows from 3 fixtures`);
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
node test-parse.js
```

Expected: FAIL — `Cannot find module './src/pharmacist'`.

- [ ] **Step 5: Write the parser**

Create `src/pharmacist.js`:

```js
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
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node test-parse.js
```

Expected: PASS — `ok — parse N rows from 3 fixtures`.

If the leading-zero assertion fails, the `สมชาย` fixture happens to hold no such row. Pick another common first name for that fixture (e.g. `สมศักดิ์`), re-capture with the Step 1 command, and re-run — do not weaken the assertion.

- [ ] **Step 7: Add the test script**

In `package.json`, inside `"scripts"`, after `"smoke:api"`:

```json
    "test:parse": "node test-parse.js"
```

- [ ] **Step 8: Commit**

```bash
git add src/pharmacist.js test-parse.js test/fixtures package.json
git commit -m "Read the pharmacy council's result table into rows"
```

---

### Task 2: Upstream call, grouping, cache, and the API route

**Files:**
- Modify: `src/pharmacist.js`
- Modify: `src/config.js:52-109` (the `module.exports` object)
- Modify: `src/server.js`
- Create: `smoke-pharmacist.js`
- Modify: `package.json`, `.env.example`, `README.md`

**Interfaces:**
- Consumes: `parseResultTable(html)`, `MAX_ROWS_PER_GROUP` from Task 1; `config.pharmacistSearchUrl`, `config.navTimeoutMs`, `config.cacheTtlMs`, `config.cacheMaxKeywords`
- Produces:
  - `searchPharmacists({ firstName, lastName })` → `Promise<{ query, counts, groups, cached }>` where `counts` is `{ both, firstName, lastName }` of untruncated totals and `groups` is `{ both: Row[], firstName: Row[], lastName: Row[] }`
  - `clearPharmacistCache()`, `pharmacistCacheStats()` → `{ queries, ttlMs }`
  - Route `GET /api/pharmacist?firstName=&lastName=`

- [ ] **Step 1: Add the setting**

In `src/config.js`, inside `module.exports`, after the `detailPageUrl` entry:

```js
  // The Pharmacy Council's own search form. It is a page POST, not an API —
  // see src/pharmacist.js. In the environment so a move needs no code change.
  pharmacistSearchUrl:
    process.env.PHARMACIST_SEARCH_URL ||
    'https://www.pharmacycouncil.org/index.php?option=com_pharmacist_list',
```

In `.env.example`, alongside the other URL settings:

```
# ค้นรายชื่อผู้ประกอบวิชาชีพเภสัชกรรม (สภาเภสัชกรรม)
PHARMACIST_SEARCH_URL=https://www.pharmacycouncil.org/index.php?option=com_pharmacist_list
```

In `README.md`, add a row to the settings table:

```
| `PHARMACIST_SEARCH_URL` | the council's search form | pharmacist name → licence number lookup |
```

- [ ] **Step 2: Write the failing smoke test**

Create `smoke-pharmacist.js`:

```js
/**
 * Checks the live Pharmacy Council site still answers the way the app reads
 * it. This is the tripwire: when they change their page, this goes red.
 *
 *   node smoke-pharmacist.js
 */
'use strict';

const assert = require('assert');
const { searchPharmacists, clearPharmacistCache } = require('./src/pharmacist');

(async () => {
  clearPharmacistCache();

  // --- surname only -------------------------------------------------------
  const bySurname = await searchPharmacists({ lastName: 'ใจดี' });
  assert.ok(bySurname.groups.lastName.length > 0, 'ค้นนามสกุลแล้วไม่ได้ผลเลย');
  assert.strictEqual(bySurname.groups.both.length, 0, 'กรอกช่องเดียวไม่ควรมีกลุ่ม both');
  const one = bySurname.groups.lastName[0];
  for (const field of ['licenseNo', 'fullName', 'firstName', 'lastName', 'status']) {
    assert.ok(one[field], `ผลลัพธ์ไม่มีฟิลด์ ${field}`);
  }
  assert.strictEqual(one.lastName, 'ใจดี', 'นามสกุลที่แยกได้ไม่ตรงกับที่ค้น');

  // --- both fields --------------------------------------------------------
  const both = await searchPharmacists({
    firstName: one.firstName,
    lastName: one.lastName,
  });
  assert.ok(both.groups.both.length > 0, 'ค้นชื่อ+นามสกุลของคนเดียวกันแล้วกลุ่ม both ว่าง');
  assert.ok(
    both.counts.firstName >= both.counts.both,
    'จำนวนคนชื่อเดียวกันต้องไม่น้อยกว่าจำนวนที่ตรงทั้งสองช่อง'
  );
  assert.ok(
    both.groups.both.some((r) => r.licenseNo === one.licenseNo),
    'คนที่ค้นเจอตอนแรกไม่อยู่ในกลุ่ม both'
  );
  // A row may sit in exactly one group.
  const ids = [
    ...both.groups.both,
    ...both.groups.firstName,
    ...both.groups.lastName,
  ].map((r) => r.licenseNo);
  assert.strictEqual(new Set(ids).size, ids.length, 'มีแถวซ้ำข้ามกลุ่ม');

  // --- nothing found ------------------------------------------------------
  const none = await searchPharmacists({ lastName: 'ไม่มีนามสกุลนี้จริง' });
  assert.deepStrictEqual(none.counts, { both: 0, firstName: 0, lastName: 0 });

  // --- cache --------------------------------------------------------------
  const again = await searchPharmacists({ lastName: 'ใจดี' });
  assert.strictEqual(again.cached, true, 'ค้นซ้ำคำเดิมแล้วไม่ได้ผลจากแคช');

  console.log(
    `ok — ${bySurname.counts.lastName} by surname, ` +
      `${both.counts.both} matched both, cache hit on repeat`
  );
})().catch((err) => {
  console.error('FAILED —', err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node smoke-pharmacist.js
```

Expected: FAIL — `searchPharmacists is not a function`.

- [ ] **Step 4: Implement the search, grouping and cache**

In `src/pharmacist.js`, add `const config = require('./config');` under the existing require, and append before `module.exports`:

```js
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
```

Then extend the exports:

```js
module.exports = {
  parseResultTable,
  searchPharmacists,
  clearPharmacistCache,
  pharmacistCacheStats,
  MAX_ROWS_PER_GROUP,
};
```

- [ ] **Step 5: Run the smoke test to verify it passes**

```bash
node smoke-pharmacist.js
```

Expected: PASS — `ok — N by surname, M matched both, cache hit on repeat`.

If `ใจดี` no longer returns anyone, pick another surname that does (check by hand at pharmacycouncil.org) and update the fixture-independent constant in the smoke test.

- [ ] **Step 6: Add the route**

In `src/server.js`, extend the top requires:

```js
const {
  searchPharmacists,
  clearPharmacistCache,
  pharmacistCacheStats,
} = require('./pharmacist');
```

Add the route next to the other `/api/fda/*` routes:

```js
/**
 * GET /api/pharmacist?firstName=สมชาย&lastName=ใจดี
 * The pharmacist's ภ. licence number, from the Pharmacy Council register.
 * At least one of the two is required.
 */
app.get('/api/pharmacist', async (req, res, next) => {
  try {
    const data = await searchPharmacists({
      firstName: req.query.firstName,
      lastName: req.query.lastName,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
});
```

Fold the new cache into the two cache endpoints that already exist:

```js
app.get('/api/cache', (req, res) =>
  res.json({ success: true, ...cacheStats(), pharmacist: pharmacistCacheStats() })
);

app.delete('/api/cache', (req, res) => {
  clearCache();
  clearPharmacistCache();
  res.json({ success: true, message: 'ล้างแคชแล้ว' });
});
```

- [ ] **Step 7: Verify the route end to end**

Start the API in one shell:

```bash
npm start
```

In another:

```bash
curl -s "http://localhost:3000/api/pharmacist?lastName=%E0%B9%83%E0%B8%88%E0%B8%94%E0%B8%B5" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.success, j.counts, j.groups.lastName[0]);})"
```

Expected: `true`, a `counts` object, and one row with `licenseNo`, `fullName`, `status`.

Then check the guard and the cache endpoint:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/pharmacist"
curl -s "http://localhost:3000/api/cache" | head -c 200
```

Expected: `400`, then JSON containing a `pharmacist` block. Stop the server.

- [ ] **Step 8: Add the smoke script**

In `package.json`, inside `"scripts"`:

```json
    "smoke:pharmacist": "node smoke-pharmacist.js"
```

- [ ] **Step 9: Commit**

```bash
git add src/pharmacist.js src/config.js src/server.js smoke-pharmacist.js package.json .env.example README.md
git commit -m "Serve a pharmacist's licence number over /api/pharmacist"
```

---

### Task 3: The `<pharmacist-search>` element

**Files:**
- Create: `web/public/pharmacist-search.js`
- Modify: `web/public/theme.css` (append)

**Interfaces:**
- Consumes: `GET /api/pharmacist?firstName=&lastName=` from Task 2
- Produces: custom element `<pharmacist-search>`, registered on script load; no attributes, no public methods

- [ ] **Step 1: Write the element**

Create `web/public/pharmacist-search.js`:

```js
/**
 * <pharmacist-search> — look a pharmacist's ภ. licence number up by name.
 *
 * Plain custom element on purpose: it is used by the React search page and by
 * form.html, which has no build step and is loaded by Puppeteer on every PDF
 * render. One implementation, no framework in the print path.
 *
 * No shadow DOM either, so it inherits the design tokens and control styles
 * from theme.css, which both pages already load.
 */
(() => {
  'use strict';

  // Same rule as web/src/api.js: same origin in production and through Vite's
  // proxy in development; the fallback is only for opening the file off disk.
  const BASE = location.protocol.startsWith('http') ? '' : 'http://localhost:3000';

  const GROUP_LABELS = {
    both: 'ตรงทั้งชื่อและนามสกุล',
    firstName: 'ตรงเฉพาะชื่อ',
    lastName: 'ตรงเฉพาะนามสกุล',
  };

  const el = (tag, className, textContent) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };

  class PharmacistSearch extends HTMLElement {
    connectedCallback() {
      if (this.dataset.ready) return; // React may re-attach the same node
      this.dataset.ready = '1';
      this.controller = null;
      this.render();
    }

    disconnectedCallback() {
      if (this.controller) this.controller.abort();
    }

    render() {
      this.innerHTML = '';
      const form = el('form', 'ps-form');
      form.noValidate = true;

      this.first = el('input', 'ps-input');
      this.first.placeholder = 'ชื่อ';
      this.first.autocomplete = 'off';
      this.last = el('input', 'ps-input');
      this.last.placeholder = 'นามสกุล';
      this.last.autocomplete = 'off';

      const submit = el('button', 'ps-submit', 'ค้นหา');
      submit.type = 'submit';

      const row = el('div', 'ps-row');
      row.append(this.last, submit);
      form.append(el('span', 'ps-title', 'ค้นเลข ภ.'), this.first, row);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.search();
      });

      this.output = el('div', 'ps-output');
      this.append(form, this.output);
    }

    /** One line of status text, replacing whatever is in the panel. */
    say(message, className) {
      this.output.innerHTML = '';
      this.output.append(el('p', `ps-note ${className || ''}`.trim(), message));
    }

    async search() {
      const firstName = this.first.value.trim();
      const lastName = this.last.value.trim();
      if (!firstName && !lastName) {
        this.say('กรุณากรอกชื่อหรือนามสกุลอย่างน้อยหนึ่งช่อง', 'ps-error');
        return;
      }

      if (this.controller) this.controller.abort();
      this.controller = new AbortController();
      this.say('กำลังค้นหา…');

      const query = new URLSearchParams({ firstName, lastName });
      try {
        const response = await fetch(`${BASE}/api/pharmacist?${query}`, {
          signal: this.controller.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'ค้นหาไม่สำเร็จ');
        }
        this.show(data);
      } catch (err) {
        if (err.name === 'AbortError') return;
        this.say(err.message, 'ps-error');
      }
    }

    show(data) {
      const order = ['both', 'firstName', 'lastName'];
      const filled = order.filter((name) => data.groups[name].length > 0);
      if (filled.length === 0) {
        this.say('ไม่พบรายชื่อ — ต้องสะกดชื่อและนามสกุลให้ตรงทุกตัวอักษร');
        return;
      }

      this.output.innerHTML = '';
      // One filled group means one search term: no point labelling it.
      const single = filled.length === 1 && !(data.query.firstName && data.query.lastName);
      for (const name of filled) {
        this.output.append(
          this.group(name, data.groups[name], data.counts[name], single, name === 'both')
        );
      }
    }

    /** A `<details>` block, open when it holds the row the user is after. */
    group(name, rows, total, single, open) {
      const box = el('details', 'ps-group');
      box.open = single || open;
      if (!single) {
        box.append(el('summary', 'ps-summary', `${GROUP_LABELS[name]} (${total})`));
      }
      for (const row of rows) box.append(this.card(row));
      if (total > rows.length) {
        box.append(
          el(
            'p',
            'ps-note',
            `แสดง ${rows.length} จาก ${total} รายการ — ระบุอีกช่องเพื่อจำกัดผล`
          )
        );
      }
      return box;
    }

    card(row) {
      const card = el('div', 'ps-card');
      card.append(el('div', 'ps-name', row.fullName));

      const licence = el('div', 'ps-licence');
      licence.append(el('b', null, `ภ. ${row.licenseNo}`));

      const copy = el('button', 'ps-copy', 'คัดลอก');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(row.licenseNo);
          copy.textContent = 'คัดลอกแล้ว';
        } catch {
          copy.textContent = 'คัดลอกไม่ได้';
        }
        setTimeout(() => {
          copy.textContent = 'คัดลอก';
        }, 1500);
      });
      licence.append(copy);
      card.append(licence);

      const meta = [row.status, row.expiry && `หมดอายุ ${row.expiry}`]
        .filter(Boolean)
        .join(' · ');
      if (meta) card.append(el('div', 'ps-meta', meta));
      // The council writes the licence-replacement line in brackets and the
      // real warnings — lapsed CE credits and the like — without them.
      for (const note of row.notes) {
        const warning = !note.startsWith('(');
        card.append(el('div', warning ? 'ps-note-row' : 'ps-note-plain', note));
      }
      return card;
    }
  }

  if (!customElements.get('pharmacist-search')) {
    customElements.define('pharmacist-search', PharmacistSearch);
  }
})();
```

- [ ] **Step 2: Add the styles**

Append to `web/public/theme.css`:

```css
/* ---------- <pharmacist-search> ----------
   Shared by the sidebar of the search page and the record page. Uses the
   tokens above so it looks the same in both.
   ------------------------------------------------------------------ */
pharmacist-search { display: block; font-size: 0.92rem; }
.ps-title { display: block; font-weight: 500; margin-bottom: 6px; }
.ps-form { display: flex; flex-direction: column; gap: 6px; }
.ps-row { display: flex; gap: 6px; }
.ps-input {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--card);
  color: var(--foreground);
  font: inherit;
}
.ps-input:focus { outline: 2px solid var(--ring); outline-offset: 1px; }
.ps-submit {
  padding: 6px 14px;
  border: 0;
  border-radius: calc(var(--radius) - 2px);
  background: var(--primary);
  color: var(--primary-foreground);
  font: inherit;
  cursor: pointer;
}
.ps-output { margin-top: 8px; max-height: 46vh; overflow-y: auto; }
.ps-group + .ps-group { margin-top: 6px; }
.ps-summary { cursor: pointer; color: var(--muted-foreground); padding: 4px 0; }
.ps-card {
  padding: 8px 10px;
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: calc(var(--radius) - 2px);
  background: var(--card);
}
.ps-name { font-weight: 500; }
.ps-licence { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ps-copy {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}
.ps-meta { color: var(--muted-foreground); font-size: 0.85rem; }
.ps-note { color: var(--muted-foreground); font-size: 0.85rem; margin: 6px 0 0; }
.ps-note-row {
  margin-top: 4px;
  padding: 2px 6px;
  border-radius: calc(var(--radius) - 6px);
  background: var(--danger-bg);
  color: var(--danger-fg);
  font-size: 0.8rem;
}
.ps-note-plain { margin-top: 4px; color: var(--muted-foreground); font-size: 0.8rem; }
.ps-error { color: var(--destructive); }
```

- [ ] **Step 3: Check it in isolation**

With `npm start` running, create a throwaway page:

```bash
cat > web/public/ps-check.html <<'HTML'
<!doctype html><html lang="th"><head><meta charset="utf-8" />
<link rel="stylesheet" href="./theme.css" /></head>
<body style="padding:24px;max-width:420px">
<pharmacist-search></pharmacist-search>
<script src="./pharmacist-search.js"></script>
</body></html>
HTML
```

Serve it through Vite, which hands out `web/public/` at the root and proxies
`/api` to the running API:

```bash
npm run dev:web
```

Open `http://localhost:5173/ps-check.html`.

Check by hand, in the browser:
1. surname `ใจดี` alone → a flat list of cards, no group headings
2. a first name and surname of one person from that list → `ตรงทั้งชื่อและนามสกุล` open, the other two groups collapsed with counts
3. a pharmacist with a lapsed-credit note shows it in the warning colour, while the bracketed licence-replacement line stays plain
4. the copy button puts the number on the clipboard and reads `คัดลอกแล้ว` for about a second
5. nonsense in either field → `ไม่พบรายชื่อ …`
6. both fields empty, press ค้นหา → the Thai prompt, no request sent

Then delete the throwaway page — it is not part of the app:

```bash
rm web/public/ps-check.html
```

- [ ] **Step 4: Commit**

```bash
git add web/public/pharmacist-search.js web/public/theme.css
git commit -m "Add the pharmacist search element the two pages share"
```

---

### Task 4: Place it on both pages

**Files:**
- Modify: `web/public/form.html:180-201` (toolbar) and `:165-175` (print rules)
- Modify: `web/index.html`
- Modify: `web/src/components/Sidebar.jsx`

**Interfaces:**
- Consumes: `<pharmacist-search>` from Task 3
- Produces: the element on the search page sidebar and on the record page

- [ ] **Step 1: Put it on the record page**

In `web/public/form.html`, immediately after the closing `</div>` of `.toolbar`:

```html
    <!-- Licence lookup — screen only, see the print rules below. -->
    <div class="lookup glass-panel">
      <pharmacist-search></pharmacist-search>
    </div>
```

In the page's `<style>` block, next to the other screen-chrome rules:

```css
      .lookup {
        max-width: 420px;
        margin: 12px auto 0;
        padding: 12px 14px;
      }
```

In the `@media print` block, beside `.toolbar { display: none; }`:

```css
        .lookup { display: none; }
```

Before `</body>`, next to the page's existing script:

```html
    <script src="./pharmacist-search.js"></script>
```

- [ ] **Step 2: Put it in the sidebar**

In `web/index.html`, before `<script type="module" src="/src/main.jsx"></script>`:

```html
    <script src="/pharmacist-search.js"></script>
```

In `web/src/components/Sidebar.jsx`, between the `</nav>` and the `<hr />` that precedes `.foot`:

```jsx
      <hr />
      <span className="group-label">ค้นเลข ภ.</span>
      {/* Defined in web/public/pharmacist-search.js — the same element the
          record page uses, so there is one implementation of this search. */}
      <pharmacist-search />
```

- [ ] **Step 3: Verify both pages**

```bash
npm run build
npm start
```

Check by hand:
1. `http://localhost:3000/` — the sidebar shows the two fields; a surname search returns cards; copying works; the results panel scrolls inside the sidebar instead of stretching it
2. `http://localhost:3000/form.html` — the lookup sits under the toolbar and behaves the same
3. On `form.html`, press ดาวน์โหลด PDF — the PDF is unchanged and carries no lookup box
4. On `form.html`, press พิมพ์ / บันทึกเอง — the print preview carries no lookup box
5. Press ดาวน์โหลด Word — the file still opens and is unchanged

- [ ] **Step 4: Re-run the automated checks**

```bash
npm run test:parse
npm run smoke:pharmacist
npm run smoke:api
```

Expected: all three pass.

- [ ] **Step 5: Commit**

```bash
git add web/public/form.html web/index.html web/src/components/Sidebar.jsx
git commit -m "Offer the licence lookup on the sidebar and the record page"
```

---

## Self-Review Notes

Checked against the spec:

- Backend contract, grouping table, response shape, cache keys, 200-row cap, and all four error cases — Task 2
- HTML parsing rules including title split, notes, `-` expiry, and `ไม่พบรายการ` — Task 1
- Element behaviour: submit-only search, `AbortController`, collapsed groups, copy button, truncation line, three status states, scrolling panel — Task 3
- Placement on both pages plus the print rule and the PDF/DOCX check — Task 4
- Config, `.env.example`, README row — Task 2 Step 1
- Both test levels and the manual UI checklist — Tasks 1, 2, 4

Names used consistently across tasks: `parseResultTable`, `searchPharmacists`, `clearPharmacistCache`, `pharmacistCacheStats`, `MAX_ROWS_PER_GROUP`, `config.pharmacistSearchUrl`, and the `both` / `firstName` / `lastName` group keys.

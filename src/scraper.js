'use strict';

const config = require('./config');

/*
 * Locally, puppeteer brings its own Chromium. On Vercel there is no browser
 * and no writable disk to download one into, so puppeteer-core drives the
 * @sparticuz/chromium build instead — a Chromium packed small enough to fit
 * inside a function bundle.
 *
 * Loaded with import() rather than require(): puppeteer is ESM-only from v25,
 * and while Node 22.12 and later will require() an ES module, the runtime a
 * deployment gets may not. Both specifiers are literal so the bundler can
 * still see which files to ship. Resolved once, on the first launch.
 */
let puppeteerPromise = null;
function loadPuppeteer() {
  if (!puppeteerPromise) {
    puppeteerPromise = (config.serverless
      ? import('puppeteer-core')
      : import('puppeteer')
    ).then((m) => m.default || m);
  }
  return puppeteerPromise;
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

/** The record's own page, as built into public/ by the Vite build. */
const FORM_PAGE = pathToFileURL(
  path.join(__dirname, '..', 'public', 'form.html')
).href;

/** The plan's print sheet, built into public/ alongside the record's. */
const PLAN_PAGE = pathToFileURL(
  path.join(__dirname, '..', 'public', 'plan-print.html')
).href;

let browserPromise = null;

/**
 * A browsing context to work in. Locally every job gets its own, so one
 * scrape's session cannot leak into another's. The Chromium a function runs
 * is single-process — that flag is what lets it start at all in there — and a
 * single-process browser cannot open a second context, so jobs share the
 * default one and close their own pages afterwards instead.
 */
async function createContext(browser) {
  if (!config.serverless) return browser.createBrowserContext();

  const context = browser.defaultBrowserContext();
  return {
    newPage: () => context.newPage(),
    close: async () => {
      const pages = await context.pages();
      // The first page is the browser's own; closing it closes the browser.
      await Promise.all(pages.slice(1).map((page) => page.close().catch(() => {})));
    },
  };
}

/**
 * Launch (once) and reuse a single Chromium instance for all requests.
 *
 * A failed launch must not be remembered. Holding on to the rejected promise
 * made every later request fail instantly with the first request's error —
 * a cold start that timed out once looked like a portal that was down for
 * the life of the instance.
 */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = launchBrowser();
    try {
      const browser = await browserPromise;
      browser.on('disconnected', () => {
        browserPromise = null;
      });
    } catch (err) {
      browserPromise = null;
      throw err;
    }
  }
  return browserPromise;
}

async function launchBrowser() {
  const puppeteer = await loadPuppeteer();

  if (config.serverless) {
    // Imported here, not at the top, so a local run never loads it — and with
    // import() because this one is ESM-only too.
    const chromium = await import('@sparticuz/chromium').then((m) => m.default || m);

    // Unpacks Chromium and points FONTCONFIG_PATH at its font directory.
    const executablePath = await chromium.executablePath();

    /*
     * The Lambda image ships no Thai font: the record came out of it set in
     * Open Sans with every Thai glyph missing. Sarabun goes in beside the
     * fonts it did unpack, where fontconfig will find it. It is under the
     * Open Font License — which the office's own TH Sarabun New is not — and
     * form.html already names it as a fallback.
     */
    const fontDir = process.env.FONTCONFIG_PATH || path.join(os.tmpdir(), 'fonts');
    await fs.promises.mkdir(fontDir, { recursive: true });
    await Promise.all(
      ['Sarabun-Regular.ttf', 'Sarabun-Bold.ttf'].map((file) =>
        fs.promises.copyFile(
          path.join(__dirname, '..', 'assets', 'fonts', file),
          path.join(fontDir, file)
        )
      )
    );
    return puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        // Its own flags, unedited. Dropping --single-process to get separate
        // browser contexts looked reasonable and cost the whole budget: the
        // multi-process build never finished starting inside the 60 s a
        // function gets. createContext() gives way instead.
        ...chromium.args,
        `--user-agent=${config.userAgent}`,
        '--lang=th-TH,th',
      ],
      defaultViewport: chromium.defaultViewport,
      // Puppeteer gives a launch 30 s by default. A cold function has to
      // unpack the Chromium archive into /tmp first, and that alone can spend
      // most of it.
      timeout: config.navTimeoutMs,
    });
  }
  return puppeteer.launch({
    headless: config.headless,
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
    args: [
      // Applies to every tab, including the detail pop-up. The GDCC WAF in
      // front of the FDA sites rejects the default HeadlessChrome UA.
      `--user-agent=${config.userAgent}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=th-TH,th',
    ],
  });
}

async function closeBrowser() {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close().catch(() => {});
}

class ScrapeError extends Error {
  constructor(message, status = 502, code = 'SCRAPE_FAILED') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Scrape cache. A scrape is keyed by keyword alone — the province filter is
 * applied locally afterwards — so changing only the province costs nothing.
 * Detail pop-ups are cached separately by their Newcode.
 */
const rowCache = new Map(); // keyword -> { rows, capped, at }
const detailCache = new Map(); // newCode -> { licenseeName, operatorName, openHours, pharmacists }

function cacheKey(keyword) {
  return String(keyword || '').trim().toLowerCase();
}

function getCachedRows(keyword) {
  const key = cacheKey(keyword);
  const hit = rowCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > config.cacheTtlMs) {
    rowCache.delete(key);
    return null;
  }
  // Re-insert so the eviction loop below drops the least recently used entry.
  rowCache.delete(key);
  rowCache.set(key, hit);
  return hit;
}

function setCachedRows(keyword, snapshot) {
  rowCache.set(cacheKey(keyword), { ...snapshot, at: Date.now() });
  while (rowCache.size > config.cacheMaxKeywords) {
    rowCache.delete(rowCache.keys().next().value);
  }
}

function clearCache() {
  rowCache.clear();
  detailCache.clear();
}

function cacheStats() {
  return {
    keywords: rowCache.size,
    details: detailCache.size,
    ttlMs: config.cacheTtlMs,
    entries: Array.from(rowCache.entries()).map(([keyword, v]) => ({
      keyword,
      rows: v.rows.length,
      ageSeconds: Math.round((Date.now() - v.at) / 1000),
    })),
  };
}

/** Normalise Thai text for comparison: drop the word "จังหวัด" and all whitespace. */
function normalise(text) {
  return String(text || '')
    .replace(/ /g, ' ')
    .replace(/จังหวัด/g, '')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * Split an address into its parts. The site formats addresses as
 * "บ้านเลขที่ A หมู่ที่ B ซอย C ถนน D ตำบล E อำเภอ F จังหวัด G 50000โทร. H" —
 * Bangkok uses แขวง / เขต for the first two, and any field the FDA left blank
 * comes through as "-". Anything missing comes back as null.
 *
 * The house number / ซอย / ถนน / โทร parts exist for the inspection form
 * (public/form.html), which has a separate blank for each one.
 */
const ADDRESS_MARKERS =
  '(?:หมู่บ้าน|อาคาร|หมู่ที่|หมู่|ตรอก|ซอย|ถนน|ตำบล|แขวง|อำเภอ|เขต|จังหวัด)';

function parseAddress(address) {
  const text = String(address || '').replace(/ /g, ' ');
  const grab = (pattern) => {
    const match = text.match(pattern);
    if (!match) return null;
    const value = match[1].split(/โทร/)[0].trim();
    // The FDA writes "-" for a field that does not apply.
    return !value || /^[-–—/\s]+$/.test(value) ? null : value;
  };
  const upTo = (marker) =>
    new RegExp(marker + '\\s*(.+?)\\s*(?:' + ADDRESS_MARKERS + '|\\d{5}|โทร|$)');

  return {
    houseNo: grab(upTo('(?:บ้านเลขที่|เลขที่)')),
    village: grab(upTo('(?:หมู่บ้าน\\s*/\\s*อาคาร|หมู่บ้าน|อาคาร)')),
    moo: grab(upTo('(?:หมู่ที่|หมู่(?!บ้าน))')),
    soi: grab(upTo('(?:ตรอก\\s*/\\s*ซอย|ตรอก|ซอย)')),
    road: grab(upTo('ถนน')),
    subdistrict: grab(/(?:ตำบล|แขวง)\s*(.+?)\s*(?:อำเภอ|เขต|จังหวัด|\d|$)/),
    district: grab(/(?:อำเภอ|เขต)\s*(.+?)\s*(?:จังหวัด|\d|$)/),
    province: grab(/จังหวัด\s*([^\d]*)/),
    postcode: grab(/(\d{5})/),
    phone: grab(/โทร\.?\s*(.+)$/),
  };
}

/** Kept for callers that only care about the province. */
function extractProvince(address) {
  return parseAddress(address).province;
}

/**
 * True when `value` matches what the user asked for. Falls back to testing the
 * whole address when the address has no such part, so odd records with a
 * missing marker are not silently dropped.
 */
function areaMatches(value, address, needle) {
  if (!needle) return true;
  if (value) return normalise(value).includes(needle);
  return normalise(address).includes(needle);
}

/** Backwards-compatible province-only test. */
function matchesProvince(address, needle) {
  return areaMatches(parseAddress(address).province, address, needle);
}

/**
 * Distinct values of one address part across `rows`, with a count each, so the
 * UI can offer only options that actually have shops behind them.
 */
function buildFacet(rows, part) {
  const counts = new Map();
  for (const row of rows) {
    const value = row.area ? row.area[part] : parseAddress(row.address)[part];
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'th')
  );
}

/**
 * Pull coordinates out of the detail page's Google Maps link. The FDA writes
 * 0,0 for records it never geocoded, and a few links carry no href at all, so
 * anything outside Thailand's bounding box is treated as "no location".
 */
function parseCoordinates(mapHref) {
  const match = String(mapHref || '').match(/query=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  const insideThailand =
    lat >= 5.5 && lat <= 20.6 && lng >= 97 && lng <= 105.7;
  return insideThailand ? { lat, lng } : null;
}

/** Collapse the portal's non-breaking spaces and padding; blank becomes null. */
function clean(text) {
  const value = String(text == null ? '' : text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value || null;
}

/** Ask an upstream endpoint, with the desktop UA the WAF insists on. */
async function callApi(url, options) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        'User-Agent': config.userAgent,
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8',
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(config.navTimeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new ScrapeError(
        'เว็บไซต์ อย. ไม่ตอบสนองภายในเวลาที่กำหนด',
        504,
        'UPSTREAM_TIMEOUT'
      );
    }
    throw new ScrapeError(`ติดต่อเว็บไซต์ อย. ไม่สำเร็จ: ${err.message}`);
  }
  if (!response.ok) {
    throw new ScrapeError(`เว็บไซต์ อย. ตอบกลับ HTTP ${response.status}`);
  }
  return response.text();
}

/**
 * Every row for one keyword, from the portal's own search API.
 *
 * The search page is an Angular app: it posts the search model to GET_SEARCH
 * and renders the JSON that comes back — the whole result set in one answer,
 * with no pager to walk. So this asks the same question the same way, which
 * is why no browser is involved in a search any more.
 */
async function fetchRows(keyword) {
  const body = new FormData();
  body.append(
    'MODEL',
    JSON.stringify({
      SEARCH_VALUE: keyword,
      RADIO_TYPE: null,
      RADIO_TYPE_ETC_FOOD: null,
      RADIO_TYPE_ETC_DRUG: null,
      RADIO_TYPE_ETC_HERB: null,
      RADIO_TYPE_ETC_TXC: null,
      RADIO_TYPE_ETC_CMT: null,
      RADIO_TYPE_ETC_NCT: null,
      RADIO_TYPE_ETC_MDC: null,
      RADIO_TYPE_ETC_ADVER: null,
      // What picks "สืบค้นสถานที่ยา" over the product searches.
      RADIO_TYPE_LOCATION: config.searchLocationType,
    })
  );
  body.append('search_input', keyword);

  const text = await callApi(config.searchApiUrl, { method: 'POST', body });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ScrapeError('เว็บไซต์ อย. ตอบกลับด้วยข้อมูลที่อ่านไม่ได้');
  }
  if (!Array.isArray(data)) {
    throw new ScrapeError('รูปแบบข้อมูลของเว็บไซต์ อย. เปลี่ยนไป');
  }

  // The licence number arrives split: "ขจ" (type) and "กจ 4/2538" (number).
  // The FDA sometimes answers the same establishment twice; one Newcode is one
  // shop, so later copies are dropped (they also collide as list keys).
  const seen = new Set();
  const rows = data.slice(0, config.maxRows).filter((r) => {
    const code = clean(r.Newcode);
    if (!code) return true;
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  }).map((r) => ({
    licenseNo: clean(r.lcnno_no),
    licenseType: clean(r.lcntpcd),
    placeName: clean(r.thanm),
    address: clean(r.thanm_addr),
    status: clean(r.cncnm),
    newCode: clean(r.Newcode),
    detailUrl:
      r.URLs ||
      (r.Newcode ? `${config.detailPageUrl}?Newcode_not=${encodeURIComponent(r.Newcode)}` : null),
  }));
  for (const row of rows) row.area = parseAddress(row.address);

  // Only ever true for a keyword so broad it passed MAX_ROWS.
  // Compared with the limit, not rows.length — dropped duplicates are not a cap.
  return { rows, capped: data.length > config.maxRows };
}

/**
 * One establishment's own record: licensee, operator, hours, the
 * ผู้มีหน้าที่ปฏิบัติการ list and the map coordinates. The detail page is an
 * AngularJS view over this same call, so it is asked directly.
 *
 * An unknown Newcode is answered with an empty body, not an error.
 */
async function fetchDetail(newCode) {
  const url = `${config.detailApiUrl}?Newcode_not=${encodeURIComponent(newCode)}`;
  // The IIS in front of it answers 411 to a POST with no body at all.
  const text = await callApi(url, { method: 'POST', body: new URLSearchParams() });
  if (!text.trim()) return null;

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ScrapeError('เว็บไซต์ อย. ตอบกลับด้วยข้อมูลที่อ่านไม่ได้');
  }

  const coordinates = parseCoordinates(data.URLGoogleMap);
  return {
    licenseeName: clean(data.ENTREPRENEUR_NAME),
    operatorName: clean(data.OPERATOR_NAME),
    openHours: clean(data.LOCATION_JOB_TIME),
    // Empty for a lapsed licence — the FDA drops the whole block.
    pharmacists: (data.PHAR_LIST || [])
      .map((entry, i) => ({
        index: String(i + 1),
        name: clean(entry.PERSON_FULLNAME),
        openHours: clean(entry.LOCATION_JOB_TIME),
      }))
      .filter((p) => p.name),
    lat: coordinates ? coordinates.lat : null,
    lng: coordinates ? coordinates.lng : null,
  };
}

/**
 * Fetch one establishment's record by its Newcode, for the in-page preview.
 * Shares the same cache the search path fills, so previewing a shop that was
 * already detailed costs nothing.
 */
async function getDetailByNewCode(newCode) {
  const code = String(newCode || '').trim();
  if (!code) {
    throw new ScrapeError('newCode is required', 400, 'INVALID_INPUT');
  }

  const hit = detailCache.get(code);
  if (hit) return { ...hit, cached: true };

  const detail = await fetchDetail(code);
  if (!detail) {
    throw new ScrapeError('ไม่พบรายละเอียดของรายการนี้', 404, 'NOT_FOUND');
  }
  detailCache.set(code, detail);
  return { ...detail, cached: false };
}

/**
 * Main entry point.
 * @param {object} params
 * @param {string} params.keyword ชื่อร้านยาที่ต้องการค้นหา
 * @param {string} [params.province] จังหวัดที่ใช้กรองจากคอลัมน์ "ที่อยู่"
 * @param {boolean} [params.withDetails=true] ดึงรายละเอียดของแต่ละแถวเพิ่ม
 * @param {number} [params.limit] จำกัดจำนวนแถวที่ดึงรายละเอียด
 * @param {boolean} [params.refresh=false] ข้ามแคช บังคับดึงข้อมูลใหม่
 */
async function searchDrugLocations({
  keyword,
  province = '',
  district = '',
  subdistrict = '',
  withDetails = true,
  limit,
  refresh = false,
} = {}) {
  if (!keyword || !String(keyword).trim()) {
    throw new ScrapeError('keyword is required', 400, 'INVALID_INPUT');
  }
  const term = String(keyword).trim();

  const cached = refresh ? null : getCachedRows(term);

  try {
    let snapshot = cached;

    if (!snapshot) {
      const fetched = await fetchRows(term);
      snapshot = {
        rows: fetched.rows,
        capped: fetched.capped,
        at: Date.now(),
      };
      setCachedRows(term, snapshot);
    }

    const { rows, capped } = snapshot;
    for (const row of rows) {
      if (!row.area) row.area = parseAddress(row.address);
    }

    // 7. กรองด้วยจังหวัด / อำเภอ / ตำบล ทีละชั้น
    const wanted = {
      province: normalise(province),
      district: normalise(district),
      subdistrict: normalise(subdistrict),
    };
    const keep = (part) => (row) =>
      areaMatches(row.area ? row.area[part] : null, row.address, wanted[part]);

    const byProvince = wanted.province ? rows.filter(keep('province')) : rows;
    const byDistrict = wanted.district
      ? byProvince.filter(keep('district'))
      : byProvince;
    const matched = wanted.subdistrict
      ? byDistrict.filter(keep('subdistrict'))
      : byDistrict;

    // Each facet lists what is still selectable given the levels above it.
    const facets = {
      provinces: buildFacet(rows, 'province'),
      districts: buildFacet(byProvince, 'district'),
      subdistricts: buildFacet(byDistrict, 'subdistrict'),
    };

    const detailCap = Math.min(
      Number(limit) > 0 ? Number(limit) : config.maxDetails,
      config.maxDetails
    );

    const results = matched.map((r) => ({
      licenseNo: r.licenseNo,
      licenseType: r.licenseType,
      placeName: r.placeName,
      address: r.address,
      // เลขที่ / หมู่ / ซอย / ถนน / ตำบล / อำเภอ / จังหวัด / โทร — public/form.html
      // has one blank per part, so send the parsed form, not just the string.
      area: r.area || null,
      status: r.status,
      newCode: r.newCode,
      detailUrl: r.detailUrl,
      licenseeName: null,
      operatorName: null,
      openHours: null,
      pharmacists: [],
      detailError: null,
    }));

    // 8. ดึงรายละเอียดของแต่ละแถว (ชื่อผู้รับอนุญาต / เภสัชกร / พิกัด)
    let detailsFetched = 0;
    if (withDetails) {
      for (let i = 0; i < Math.min(results.length, detailCap); i += 1) {
        const key = matched[i].newCode;
        if (!key) continue;
        try {
          let detail = detailCache.get(key);
          if (!detail) {
            detail = await fetchDetail(key);
            if (detail) detailCache.set(key, detail);
          }
          // A record the FDA never filled in answers empty; the row keeps
          // its nulls and is not counted as fetched.
          if (detail) {
            Object.assign(results[i], detail);
            detailsFetched += 1;
          }
        } catch (err) {
          results[i].detailError = err.message;
        }
      }
    }

    return {
      keyword: term,
      province: province || null,
      district: district || null,
      subdistrict: subdistrict || null,
      facets,
      totalFound: rows.length,
      totalMatched: matched.length,
      detailsFetched,
      // The keyword brought back more rows than MAX_ROWS allows, so `results`
      // is a partial view of what the FDA site holds.
      incomplete: capped,
      truncated: withDetails && matched.length > detailCap,
      cached: Boolean(cached),
      cachedAgeSeconds: Math.round((Date.now() - snapshot.at) / 1000),
      results,
    };
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    if (err.name === 'TimeoutError') {
      throw new ScrapeError(
        `เว็บไซต์ อย. ตอบสนองช้า หรือโครงสร้างหน้าเปลี่ยนไป: ${err.message}`,
        504,
        'UPSTREAM_TIMEOUT'
      );
    }
    throw new ScrapeError(`ดึงข้อมูลไม่สำเร็จ: ${err.message}`);
  }
}

/**
 * Render public/form.html to a PDF with `data` already filled in.
 *
 * The page is loaded from this same server so there is exactly one copy of the
 * form: what the officer edits on screen is what Chromium prints. Reuses the
 * scraper's browser rather than adding a PDF library — Chromium already draws
 * Thai text with the system fonts.
 */
async function renderFormPdf(data) {
  const browser = await getBrowser();
  const context = await createContext(browser);
  try {
    const page = await context.newPage();
    // Lay the page out at a full A4 sheet in CSS pixels (210mm x 297mm at
    // 96dpi) under print rules — the sheet carries the template's own
    // 12/20/10mm margins as its own padding (see .sheet, box-sizing:
    // border-box), so the viewport has to match the page.pdf() geometry
    // below rather than some pre-inset printable area.
    await page.setViewport({ width: 794, height: 1123 });
    await page.emulateMediaType('print');
    // Straight off disk. Fetching it over HTTP meant knowing this process's
    // own address, which is a different answer on a laptop, inside a
    // container and behind a deployment's access control — where what came
    // back was the login page, not the form.
    await page.goto(FORM_PAGE, {
      waitUntil: 'domcontentloaded',
      timeout: config.navTimeoutMs,
    });
    // domcontentloaded fires before the embedded font is decoded, and every
    // line of the record is laid out against that face — waiting for it is
    // what keeps the printed sheet the same shape as the measured one.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((filled) => {
      window.applyData(filled);
      window.prepareForPrint();
    }, data || {});
    // No margin here: the .sheet element is already a full A4-width box
    // (210mm, border-box) whose own padding *is* the template's 12/20/10mm
    // margin. This JS option turns out not to be what Chromium actually
    // consults for content margin in this pipeline — form.html's own
    // `@page { margin: 0 }` is (see that rule) — but it's left at 0 here
    // too so intent and behaviour agree if that ever changes upstream.
    return await page.pdf({
      // A4 in millimetres. It used to be the viewport in pixels — 794 x 1123,
      // which is 210.08 x 297.13mm — because rules were measured against the
      // sheet and half a pixel of drift in where the sheet sat accumulated
      // down the page: the last rules on page 1 came out 3.4px off, one of
      // them through the wording of item (6). Each rule is now pinned to its
      // own paragraph inside a 210mm box, so nothing inside a paragraph moves
      // with the page width at all — checked at 793 and 794px, where all 69
      // blanks land in the same place to a twentieth of a pixel.
      //
      // Chromium quantises the page box it writes, so what comes out is
      // 210.23 x 297.01mm whatever is asked for here (A4, 210mm and 794px all
      // give the same box). A quarter of a millimetre is below what a printer
      // notices; asking for the paper we mean is still the honest thing.
      width: '210mm',
      height: '297mm',
      // The blanks' rules are drawn as SVG (see form.html), which is content
      // and prints without this. Nothing else on the sheet has a background
      // worth printing but the paper itself.
      printBackground: false,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });
  } finally {
    await context.close();
  }
}

/**
 * The plan as a landscape A4 sheet. Same pipeline as the record: the page is
 * opened off disk, filled by its own script, then printed. Height is left to
 * the paper size here because a plan is a table that may run to several pages,
 * unlike the record's fixed two.
 */
async function renderPlanPdf(plan) {
  const browser = await getBrowser();
  const context = await createContext(browser);
  try {
    const page = await context.newPage();
    await page.setViewport({ width: 1123, height: 794 });
    await page.emulateMediaType('print');
    await page.goto(PLAN_PAGE, {
      waitUntil: 'domcontentloaded',
      timeout: config.navTimeoutMs,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((data) => window.applyPlan(data), plan || {});
    return await page.pdf({
      width: '297mm',
      height: '210mm',
      printBackground: false,
      // plan-print.html's own @page rule carries the margins.
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    });
  } finally {
    await context.close();
  }
}

module.exports = {
  searchDrugLocations,
  getDetailByNewCode,
  clearCache,
  cacheStats,
  closeBrowser,
  renderFormPdf,
  renderPlanPdf,
  ScrapeError,
  normalise,
  parseAddress,
  parseCoordinates,
  extractProvince,
  matchesProvince,
  buildFacet,
};

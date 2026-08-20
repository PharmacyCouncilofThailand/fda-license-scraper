'use strict';

const { selectors, detailSelectors, ...config } = require('./config');

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
const rowCache = new Map(); // keyword -> { rows, capped, pagesRead, at }
const detailCache = new Map(); // newCode -> { licenseeName, operatorName, openHours }

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

/** Used by the server to skip the scrape queue when an answer is already held. */
function hasFreshRows(keyword) {
  return Boolean(getCachedRows(keyword));
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
 * The landing page shows a Bootstrap announcement modal whose backdrop swallows
 * real mouse events. Close it (and any leftover backdrop) before interacting.
 */
async function dismissModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.modal.show, .modal.fade.show').forEach((modal) => {
      const closer = Array.from(
        modal.querySelectorAll('button, .close, [data-dismiss="modal"]')
      )[0];
      if (closer) closer.click();
      modal.classList.remove('show');
      modal.style.display = 'none';
    });
    document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
  });
}

/**
 * Click an element, falling back to a DOM click when something (a modal
 * backdrop, a sticky header) covers it at its centre point.
 */
async function robustClick(page, selector) {
  await page.waitForSelector(selector, { timeout: config.navTimeoutMs });
  await dismissModals(page);
  const clickable = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const top = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    return Boolean(top && (top === el || el.contains(top) || top.contains(el)));
  }, selector);

  if (clickable) {
    await page.click(selector);
  } else {
    await page.evaluate((sel) => document.querySelector(sel).click(), selector);
  }
}

/**
 * The page uses Telerik RadAjax, so a control can answer with either a full
 * postback (navigation) or a partial async postback (no navigation at all).
 * This clicks and settles on whichever happens, then waits for `readySelector`.
 */
async function clickAndSettle(page, selector, readySelector) {
  await page.waitForSelector(selector, { timeout: config.navTimeoutMs });

  // Flag set by the MS AJAX page request manager when a partial postback ends.
  await page.evaluate(() => {
    window.__postbackDone = false;
    const prm =
      window.Sys &&
      window.Sys.WebForms &&
      window.Sys.WebForms.PageRequestManager &&
      window.Sys.WebForms.PageRequestManager.getInstance();
    if (prm) prm.add_endRequest(() => {
      window.__postbackDone = true;
    });
  });

  /*
   * Not every click posts back. Selecting the radio does on the portal as
   * served to a desktop and does not in a Lambda, where the search box is
   * simply already there — and waiting the full navigation timeout for a
   * postback that will never start cost 45 seconds of a 60-second budget.
   * Five seconds is longer than any partial postback measured here; what the
   * click was meant to achieve is checked after this, by the caller and by
   * readySelector, so giving up early costs nothing.
   */
  const settleMs = Math.min(config.navTimeoutMs, 5000);
  const navigation = page
    .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: settleMs })
    .catch(() => null);
  const asyncDone = page
    .waitForFunction(() => window.__postbackDone === true, { timeout: settleMs })
    .catch(() => null);

  await robustClick(page, selector);
  await Promise.race([navigation, asyncDone]);

  if (readySelector) {
    await page.waitForSelector(readySelector, { timeout: config.navTimeoutMs });
  }
}

/** Read every data row of the result grid currently rendered. */
async function readGridRows(page) {
  return page.$$eval(
    `${selectors.resultGrid} tr.rgRow, ${selectors.resultGrid} tr.rgAltRow`,
    (rows) =>
      rows
        .map((row) => {
          const cells = Array.from(row.cells).map((c) =>
            c.innerText.replace(/ /g, ' ').trim()
          );
          if (cells.length < 6) return null;
          const link = row.querySelector('a[href]');
          return {
            licenseNo: cells[0],
            licenseType: cells[1],
            placeName: cells[2],
            address: cells[3],
            status: cells[4],
            newCode: cells[5],
            detailUrl: link ? link.href : null,
            detailLinkId: link ? link.id : null,
          };
        })
        .filter(Boolean)
  );
}

/** True when the grid rendered the Telerik "no records" placeholder. */
async function hasNoRecords(page) {
  return page.$eval(selectors.resultGrid, (grid) =>
    /No records to display/i.test(grid.innerText)
  );
}

/** Raise the grid page size to 50 rows so fewer postbacks are needed. */
async function tryEnlargePageSize(page) {
  try {
    await page.waitForSelector(selectors.pageSizeArrow, { timeout: 5000 });
    await page.click(selectors.pageSizeArrow);
    await page.waitForSelector(`${selectors.pageSizeDropDown} li`, {
      timeout: 5000,
    });
    const rowsBefore = (await readGridRows(page)).length;
    const clicked = await page.evaluate((dropDown) => {
      const item = Array.from(
        document.querySelectorAll(`${dropDown} li`)
      ).find((li) => li.innerText.trim() === '50');
      if (!item) return false;
      item.click();
      return true;
    }, selectors.pageSizeDropDown);
    if (!clicked) return;
    await page.waitForSelector(selectors.resultGrid, {
      timeout: config.navTimeoutMs,
    });
    await page.waitForFunction(
      (gridSelector, before) => {
        const grid = document.querySelector(gridSelector);
        if (!grid) return false;
        return (
          grid.querySelectorAll('tr.rgRow, tr.rgAltRow').length !== before
        );
      },
      { timeout: 15000 },
      selectors.resultGrid,
      rowsBefore
    );
  } catch {
    // Page size is a nice-to-have; fall back to the default 10 rows per page.
  }
}

/**
 * Walk every pager page of the grid.
 * Stops at config.maxPages so a very broad keyword cannot loop forever; when
 * that cap is what ended the walk, `capped` says the result set is incomplete.
 */
/**
 * How many rows a full page holds, according to the grid's own page-size box.
 * Counting the rows on screen is not the same question: the grid renders them
 * a few at a time, so an early look says nine.
 */
async function readPageSize(page) {
  try {
    const value = await page.$eval(selectors.pageSizeInput, (el) => el.value);
    const size = Number(String(value).replace(/\D/g, ''));
    return size > 0 ? size : null;
  } catch {
    return null;
  }
}

/**
 * Wait until the grid has finished drawing.
 *
 * A page number changes the moment the postback lands, and the rows arrive
 * after it. Reading in that gap is what returned short pages. When the page
 * size is known, a full page is the signal; otherwise settle for the row
 * count holding still between two polls, which is what the last page needs
 * since it is legitimately short.
 */
async function waitForGridSettled(page, expected) {
  await page.evaluate(() => {
    window.__gridRows = -1;
  });
  await page
    .waitForFunction(
      (gridSelector, want) => {
        const grid = document.querySelector(gridSelector);
        if (!grid) return false;
        const rows = grid.querySelectorAll('tr.rgRow, tr.rgAltRow').length;
        if (want && rows >= want) return true;
        const settled = rows > 0 && rows === window.__gridRows;
        window.__gridRows = rows;
        return settled;
      },
      { timeout: 15000, polling: 300 },
      selectors.resultGrid,
      expected || 0
    )
    .catch(() => {
      // Read whatever is there rather than abandon the search.
    });
}

/**
 * How many pages the grid says it has.
 *
 * The pager prints "2536 items in 51 pages", and knowing the number matters:
 * on the last page Telerik leaves the "next" button enabled, so clicking it
 * changes nothing and the wait for a new page number burns the full
 * navigation timeout — 45 seconds added to every search that reads to the
 * end. Stopping on the count avoids the click entirely.
 */
async function readTotalPages(page) {
  try {
    const text = await page.$eval(selectors.resultGrid, (grid) => {
      const pager = grid.querySelector('.rgPager') || grid.querySelector('tfoot');
      return pager ? pager.innerText : '';
    });
    const match = /in\s+([\d,]+)\s+pages?/i.exec(text);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  } catch {
    return null;
  }
}

async function readAllPages(page) {
  const all = [];
  let visited = 0;
  const totalPages = await readTotalPages(page);
  const pageSize = await readPageSize(page);

  for (;;) {
    // Including the first page: the grid is still filling when the search
    // postback returns.
    const lastPage = Boolean(totalPages) && visited + 1 >= totalPages;
    await waitForGridSettled(page, lastPage ? null : pageSize);

    all.push(...(await readGridRows(page)));
    visited += 1;
    if (process.env.DEBUG_STEPS && visited % 5 === 0) {
      console.log('[step] read page', visited, 'rows so far', all.length);
    }

    if (totalPages && visited >= totalPages) {
      return { rows: all, capped: false, pagesRead: visited };
    }

    if (visited >= config.maxPages) {
      const more = await page.$(selectors.nextPage);
      const hasMore = more
        ? await page.evaluate(
            (el) => !el.disabled && !/rgPageDisabled|Disabled/.test(el.className),
            more
          )
        : false;
      return { rows: all, capped: hasMore, pagesRead: visited };
    }

    const nextButton = await page.$(selectors.nextPage);
    if (!nextButton) break;

    const disabled = await page.evaluate(
      (el) => el.disabled || /rgPageDisabled|Disabled/.test(el.className),
      nextButton
    );
    if (disabled) break;

    const currentLabel = await page
      .$eval(selectors.currentPage, (el) => el.innerText.trim())
      .catch(() => null);

    await robustClick(page, selectors.nextPage);

    // The pager posts back; wait until the highlighted page number changes.
    try {
      await page.waitForFunction(
        (sel, previous) => {
          const el = document.querySelector(sel);
          return el && el.innerText.trim() !== previous;
        },
        { timeout: config.navTimeoutMs },
        selectors.currentPage,
        currentLabel
      );
    } catch {
      break; // Last page, or the pager stopped responding.
    }

    await page.waitForSelector(selectors.resultGrid, {
      timeout: config.navTimeoutMs,
    });
  }

  return { rows: all, capped: false, pagesRead: visited };
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

/** Read the licensee fields off an open detail pop-up page. */
async function readDetailFields(popup) {
  popup.setDefaultTimeout(config.navTimeoutMs);
  // Wait on the shop name, which every record has. The licensee field is blank
  // for owner-operated shops (the person shows up as ผู้ดำเนินกิจการ instead),
  // so waiting on it would burn the timeout on perfectly normal records.
  await popup
    .waitForSelector(detailSelectors.storeName, { timeout: 15000 })
    .catch(() => null);

  return popup.evaluate((sel) => {
    const clean = (t) =>
      t ? t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim() : null;
    const read = (s) => {
      const el = document.querySelector(s);
      return el ? clean(el.innerText) : null;
    };
    // Fallback: the licensee DataList id is index-suffixed and can shift, so
    // read it off the label when the primary selector misses.
    const fromLabel = (label, next) => {
      const text = document.body ? document.body.innerText : '';
      const start = text.indexOf(label);
      if (start === -1) return null;
      const rest = text.slice(start + label.length);
      const end = next ? rest.indexOf(next) : -1;
      return clean((end === -1 ? rest : rest.slice(0, end)).replace(/^\s*:/, ''));
    };
    const blankToNull = (v) => (v ? v : null);
    return {
      licenseeName: blankToNull(
        read(sel.licenseeName) ||
          fromLabel('ชื่อผู้รับอนุญาต [Licensee Name]', 'ชื่อผู้ดำเนินกิจการ')
      ),
      operatorName: blankToNull(
        read(sel.operatorName) ||
          fromLabel(
            'ชื่อผู้ดำเนินกิจการ [Name of authorization person]',
            'ชื่อสถานที่'
          )
      ),
      openHours: blankToNull(read(sel.openHours)),
      mapHref: (() => {
        const link = document.querySelector(sel.mapLink);
        return link && link.getAttribute('href') ? link.href : null;
      })(),
    };
  }, detailSelectors);
}

/**
 * Open the row's detail pop-up in a new tab, read it, close it.
 *
 * The link is opened by its href rather than clicked in the grid on purpose:
 * Telerik ids the links by position within the current pager page
 * (`..._ctl04_HyperLink1`), so after walking every page only the last page's
 * rows are in the DOM and clicking a remembered id would hit the wrong record.
 * The href carries the row's own Newcode, so it is always right — and it works
 * the same whether the rows came from a fresh scrape or from the cache.
 */
async function fetchDetailByUrl(context, row) {
  if (!row.detailUrl) return null;
  const popup = await context.newPage();
  try {
    await popup.goto(row.detailUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.navTimeoutMs,
    });
    const fields = await readDetailFields(popup);
    const coordinates = parseCoordinates(fields.mapHref);
    delete fields.mapHref;
    return {
      ...fields,
      lat: coordinates ? coordinates.lat : null,
      lng: coordinates ? coordinates.lng : null,
    };
  } finally {
    await popup.close().catch(() => {});
  }
}

/**
 * Fetch one establishment's detail pop-up by its Newcode, for the in-page
 * preview. Shares the same cache the search path fills, so previewing a shop
 * that was already detailed costs nothing.
 */
async function getDetailByNewCode(newCode) {
  const code = String(newCode || '').trim();
  if (!code) {
    throw new ScrapeError('newCode is required', 400, 'INVALID_INPUT');
  }

  const hit = detailCache.get(code);
  if (hit) return { ...hit, cached: true };

  const browser = await getBrowser();
  const context = await createContext(browser);
  try {
    const detail = await fetchDetailByUrl(context, {
      detailUrl: `${config.detailUrlBase}?Newcode_not=${encodeURIComponent(code)}`,
    });
    if (!detail) {
      throw new ScrapeError('ไม่พบรายละเอียดของรายการนี้', 404, 'NOT_FOUND');
    }
    detailCache.set(code, detail);
    return { ...detail, cached: false };
  } catch (err) {
    if (err instanceof ScrapeError) throw err;
    throw new ScrapeError(`ดึงรายละเอียดไม่สำเร็จ: ${err.message}`);
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Steps 1–6: drive the search form and read every grid page for one keyword.
 * Returns the raw rows; the caller owns closing `context`.
 */
/**
 * Make sure the search really is in "สืบค้นสถานที่ยา" mode.
 *
 * The click leaves the radio checked on a desktop browser. Inside a
 * serverless function it did not, and waiting for a checked state that never
 * arrived spent the whole request budget. So: give it a few seconds, and if
 * it is still unset, tick it directly and fire the handler the page has bound
 * to it. Searching in the wrong mode would return the wrong records, so this
 * asks rather than assumes, and says so plainly when it cannot.
 */
async function selectDrugLocationMode(page) {
  const isChecked = () =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && el.checked);
    }, selectors.radioDrugLocation);

  const waitChecked = (ms) =>
    page
      .waitForFunction(
        (sel) => {
          const el = document.querySelector(sel);
          return Boolean(el && el.checked);
        },
        { timeout: ms },
        selectors.radioDrugLocation
      )
      .then(() => true)
      .catch(() => false);

  /*
   * Two seconds, not the eight this started with. Where the click works the
   * radio is checked almost at once, and where it does not — inside a
   * function — no amount of waiting helps, so the wait is pure cost: it was
   * eighteen seconds of a sixty-second budget.
   */
  if (await waitChecked(2000)) return;

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.click();
  }, selectors.radioDrugLocation);

  await waitChecked(8000);
  if (!(await isChecked())) {
    throw new ScrapeError(
      'เลือกโหมด "สืบค้นสถานที่ยา" บนเว็บ อย. ไม่สำเร็จ',
      502,
      'SCRAPE_FAILED'
    );
  }
}

/**
 * Step timings, for when the scraper is somewhere you cannot attach to it.
 * Silent unless DEBUG_STEPS is set; the portal behaves differently inside a
 * serverless function than it does on a desk, and this is how that gets seen.
 */
function steps() {
  if (!process.env.DEBUG_STEPS) return () => {};
  let last = Date.now();
  return (what) => {
    console.log('[step]', what, ((Date.now() - last) / 1000).toFixed(1) + 's');
    last = Date.now();
  };
}

async function scrapeKeyword(keyword, context) {
  const step = steps();
  const page = await context.newPage();
  await page.setUserAgent(config.userAgent);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8' });
  page.setDefaultTimeout(config.navTimeoutMs);
  page.setDefaultNavigationTimeout(config.navTimeoutMs);

  // 1. ไปที่เว็บไซต์เป้าหมาย
  await page.goto(config.targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: config.navTimeoutMs,
  });
  step('goto portal');
  await dismissModals(page);

  // 2. เลือก radio "สืบค้นสถานที่ยา" (ทำให้เกิด ASP.NET postback)
  await clickAndSettle(page, selectors.radioDrugLocation, selectors.searchInput);
  await selectDrugLocationMode(page);


  step('radio checked');

  // 3. กรอก keyword ในช่องสืบค้น
  await page.waitForSelector(selectors.searchInput);
  await dismissModals(page);
  await page.evaluate((sel) => {
    document.querySelector(sel).value = '';
  }, selectors.searchInput);
  await page.focus(selectors.searchInput);
  await page.type(selectors.searchInput, keyword, { delay: 20 });

  // 4. กดปุ่ม "ค้นหา"  5. รอจนตารางผลลัพธ์โหลดเสร็จ
  await clickAndSettle(page, selectors.searchButton, selectors.resultGrid);


  step('grid after search');

  if (await hasNoRecords(page)) {
    return { rows: [], capped: false, pagesRead: 0 };
  }

  await tryEnlargePageSize(page);
  step('page size');

  // 6. กวาดข้อมูลทุกแถว ทุกหน้า
  const walked = await readAllPages(page);
  step('paging');
  // Parse each address once here: the result is cached with the rows, so the
  // filters and facets below never re-parse.
  for (const row of walked.rows) row.area = parseAddress(row.address);
  return walked;
}

/**
 * Main entry point.
 * @param {object} params
 * @param {string} params.keyword ชื่อร้านยาที่ต้องการค้นหา
 * @param {string} [params.province] จังหวัดที่ใช้กรองจากคอลัมน์ "ที่อยู่"
 * @param {boolean} [params.withDetails=true] เปิดแท็บใหม่เพื่อดึงชื่อผู้รับอนุญาต
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

  // Chromium is only started when there is real browser work: a cache hit with
  // `withDetails=false` answers without touching it at all.
  let context = null;
  const openContext = async () => {
    if (!context) {
      const browser = await getBrowser();
      context = await createContext(browser);
    }
    return context;
  };

  try {
    let snapshot = cached;

    if (!snapshot) {
      const scraped = await scrapeKeyword(term, await openContext());
      snapshot = {
        rows: scraped.rows,
        capped: scraped.capped,
        pagesRead: scraped.pagesRead,
        at: Date.now(),
      };
      setCachedRows(term, snapshot);
    }

    const { rows, capped, pagesRead } = snapshot;
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
      detailError: null,
    }));

    // 8. เปิดแท็บใหม่ดึงชื่อผู้รับอนุญาต แล้วปิดแท็บกลับหน้าเดิม
    let detailsFetched = 0;
    if (withDetails) {
      for (let i = 0; i < Math.min(results.length, detailCap); i += 1) {
        const row = matched[i];
        const key = row.newCode;
        try {
          let detail = key ? detailCache.get(key) : null;
          if (!detail) {
            detail = await fetchDetailByUrl(await openContext(), row);
            if (detail && key) detailCache.set(key, detail);
          }
          if (detail) Object.assign(results[i], detail);
          detailsFetched += 1;
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
      pagesRead,
      // The keyword produced more grid pages than MAX_PAGES allows, so
      // `results` is a partial view of what the FDA site holds.
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
  } finally {
    if (context) await context.close().catch(() => {});
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
    // Lay the page out at the printable area of an A4 page (210mm - 2x18mm,
    // 297mm - 2x15mm) under print rules, so the form's own fit-to-one-page
    // pass measures what the PDF will actually contain.
    await page.setViewport({ width: 658, height: 1009 });
    await page.emulateMediaType('print');
    // Straight off disk. Fetching it over HTTP meant knowing this process's
    // own address, which is a different answer on a laptop, inside a
    // container and behind a deployment's access control — where what came
    // back was the login page, not the form.
    await page.goto(FORM_PAGE, {
      waitUntil: 'domcontentloaded',
      timeout: config.navTimeoutMs,
    });
    await page.evaluate((filled) => {
      window.applyData(filled);
      window.prepareForPrint();
    }, data || {});
    return await page.pdf({
      format: 'A4',
      printBackground: false,
      margin: { top: '15mm', bottom: '15mm', left: '18mm', right: '18mm' },
    });
  } finally {
    await context.close();
  }
}

module.exports = {
  searchDrugLocations,
  getDetailByNewCode,
  hasFreshRows,
  clearCache,
  cacheStats,
  closeBrowser,
  renderFormPdf,
  ScrapeError,
  normalise,
  parseAddress,
  parseCoordinates,
  extractProvince,
  matchesProvince,
  buildFacet,
};

'use strict';

const express = require('express');
const config = require('./config');
const areas = require('../data/areas.json');
const {
  searchDrugLocations,
  getDetailByNewCode,
  hasFreshRows,
  clearCache,
  cacheStats,
  closeBrowser,
  renderFormPdf,
  ScrapeError,
} = require('./scraper');

const path = require('path');
const { renderFormDocx } = require('./docx-form');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * Only one Puppeteer scrape runs at a time. The target site is a slow
 * ASP.NET WebForms app; parallel scrapes make it time out.
 */
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * A cached keyword needs no browser, so it must not wait behind a scrape that
 * may take a minute and a half.
 */
function run(params) {
  const cacheable = !params.refresh && hasFreshRows(params.keyword);
  return cacheable
    ? searchDrugLocations(params)
    : enqueue(() => searchDrugLocations(params));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no'].includes(String(value).toLowerCase());
}

// Allows the page to be opened straight from disk during development.
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/provinces', (req, res) =>
  res.json({ success: true, provinces: Object.keys(areas) })
);

/**
 * จังหวัด → อำเภอ → ตำบล for the dropdowns. Static administrative data, so it is
 * cached hard by the browser.
 */
app.get('/api/areas', (req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.json({ success: true, areas });
});

/** One establishment's detail, for the in-page preview. */
app.get('/api/fda/detail', async (req, res, next) => {
  try {
    const data = await getDetailByNewCode(req.query.newCode);
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
});

/**
 * The shop name makes the download easy to find in a folder of them. The plain
 * `filename` is the ASCII fallback for clients that cannot read RFC 5987.
 */
function disposition(req, extension) {
  const name = String(
    (req.body && req.body.values && req.body.values.placeName) || 'inspection'
  ).replace(/[\\/:*?"<>|]/g, ' ');
  return (
    `attachment; filename="inspection.${extension}"; filename*=UTF-8''` +
    encodeURIComponent(`บันทึกการตรวจ ${name}.${extension}`)
  );
}

/**
 * POST /api/form/pdf  { values: {...}, checks: {...} }
 * Returns the inspection record as a ready-to-save PDF.
 */
app.post('/api/form/pdf', async (req, res, next) => {
  try {
    const pdf = await renderFormPdf(
      req.body || {},
      `http://127.0.0.1:${config.port}`
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition(req, 'pdf'),
    });
    // Puppeteer v23 returns a Uint8Array; Express would JSON-encode it.
    res.send(Buffer.from(pdf));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/form/docx  { values: {...}, checks: {...} }
 * The same record as the PDF, but as the office's own Word file so it can
 * still be edited after the search data is in it.
 */
app.post('/api/form/docx', (req, res, next) => {
  try {
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition(req, 'docx'),
    });
    res.send(renderFormDocx(req.body || {}));
  } catch (err) {
    next(err);
  }
});

app.get('/api/cache', (req, res) => res.json({ success: true, ...cacheStats() }));

app.delete('/api/cache', (req, res) => {
  clearCache();
  res.json({ success: true, message: 'ล้างแคชแล้ว' });
});

/**
 * GET /api/fda/drug-locations?keyword=ฟาสซิโน&province=เชียงใหม่
 * Optional: withDetails=false (skip the pop-up tab), limit=10
 */
app.get('/api/fda/drug-locations', async (req, res, next) => {
  try {
    const { keyword, province, district, subdistrict, withDetails, limit, refresh } =
      req.query;
    const data = await run({
      keyword,
      province,
      district,
      subdistrict,
      withDetails: parseBoolean(withDetails, true),
      limit,
      refresh: parseBoolean(refresh, false),
    });
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
});

/** POST variant — same payload in the JSON body. */
app.post('/api/fda/drug-locations', async (req, res, next) => {
  try {
    const { keyword, province, district, subdistrict, withDetails, limit, refresh } =
      req.body || {};
    const data = await run({
      keyword,
      province,
      district,
      subdistrict,
      withDetails: withDetails !== false,
      limit,
      refresh: refresh === true,
    });
    res.json({ success: true, ...data });
  } catch (err) {
    next(err);
  }
});

app.use((req, res) =>
  res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'ไม่พบ endpoint นี้' })
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err instanceof ScrapeError ? err.status : 500;
  const code = err instanceof ScrapeError ? err.code : 'INTERNAL_ERROR';
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ success: false, code, message: err.message });
});

// A stray rejection (a Puppeteer wait that outlives its request) must not take
// the whole API down.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.message ? err.message : err);
});

const server = app.listen(config.port, () => {
  console.log(`FDA scraper API listening on http://localhost:${config.port}`);
});

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;

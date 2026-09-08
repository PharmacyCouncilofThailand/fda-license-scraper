'use strict';

const express = require('express');
const config = require('./config');
const areas = require('../data/areas.json');
const {
  searchDrugLocations,
  getDetailByNewCode,
  clearCache,
  cacheStats,
  closeBrowser,
  renderFormPdf,
  renderPlanPdf,
  ScrapeError,
} = require('./scraper');

const {
  searchPharmacists,
  clearPharmacistCache,
  pharmacistCacheStats,
} = require('./pharmacist');

const path = require('path');
const { renderFormDocx } = require('./docx-form');
const plansStore = require('./plans-store');
const plans = require('./plans');
const records = require('./records');
const photoStore = require('./photo-store');
const { renderPlanDocx } = require('./docx-plan');

const app = express();
// Signatures ride inside the record as data URLs — eight of them at a few tens
// of kilobytes each is past express's 100kb default.
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

/*
 * Searches used to be queued: each one drove a headless browser through the
 * portal's old WebForms grid, and two at once made it time out. The portal
 * answers a search over its own JSON API now, so they simply run.
 */
const run = searchDrugLocations;

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return !['false', '0', 'no'].includes(String(value).toLowerCase());
}

// Allows the page to be opened straight from disk during development.
app.use('/api', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.get('/health', (req, res) =>
  res.json({ ok: true, plansStore: plansStore.backendName(), photoStore: photoStore.backendName() })
);

/*
 * The site is public, so the list of shops an officer is about to walk into
 * would be public too. One office passcode is the least that keeps it shut;
 * it becomes real accounts when the system moves to the Pharmacy Council.
 * With no passcode set, nothing is asked — that is the local development case.
 */
app.use('/api/plans', (req, res, next) => {
  if (!config.plansPasscode) return next();
  if (req.get('x-plans-passcode') === config.plansPasscode) return next();
  res.status(401).json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
});

app.get('/api/plans', async (req, res, next) => {
  try {
    const all = await plansStore.list();
    res.json({ success: true, plans: all.map(plans.summarise) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plans/:id', async (req, res, next) => {
  try {
    const plan = await plansStore.get(req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'ไม่พบแผนการตรวจนี้' });
    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans', async (req, res, next) => {
  try {
    const plan = await plans.createPlan(req.body || {});
    res.status(201).json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/plans/:id', async (req, res, next) => {
  try {
    const gone = await plansStore.remove(req.params.id);
    if (!gone) return res.status(404).json({ success: false, error: 'ไม่พบแผนการตรวจนี้' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans/:id/items', async (req, res, next) => {
  try {
    const codes = req.body && Array.isArray(req.body.newCodes) ? req.body.newCodes : [];
    if (!codes.length) {
      return res.status(400).json({ success: false, error: 'ต้องระบุร้านอย่างน้อยหนึ่งร้าน' });
    }
    const result = await plans.addItems(req.params.id, codes);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.patch('/api/plans/:id/items/:newCode', async (req, res, next) => {
  try {
    const plan = await plans.patchItem(req.params.id, req.params.newCode, req.body || {});
    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/plans/:id/items/:newCode', async (req, res, next) => {
  try {
    const plan = await plans.removeItem(req.params.id, req.params.newCode);
    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans/:id/items/:newCode/sync', async (req, res, next) => {
  try {
    const plan = await plans.syncItem(req.params.id, req.params.newCode);
    res.json({ success: true, plan });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plans/:id/items/:newCode/record', async (req, res, next) => {
  try {
    const record = await records.readRecord(req.params.id, req.params.newCode);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

app.put('/api/plans/:id/items/:newCode/record', async (req, res, next) => {
  try {
    const record = await records.writeRecord(req.params.id, req.params.newCode, req.body || {});
    res.json({ success: true, record });
  } catch (err) {
    // A stale write is answered with the version that won, so the page can
    // show the officer both and let them choose.
    if (err.status === 409) {
      return res.status(409).json({ success: false, error: err.message, current: err.current });
    }
    next(err);
  }
});

/* The camera's own bytes, posted raw. `express.raw` is mounted on this one
   route rather than globally: every other route on this server speaks JSON,
   and a body parser that accepts images everywhere is a body parser waiting
   to swallow something it should have rejected. */
app.post(
  '/api/plans/:id/items/:newCode/record/photos',
  express.raw({ type: 'image/jpeg', limit: '5mb' }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลรูปภาพ' });
      }
      const { id } = await photoStore.putPhoto(req.params.id, req.params.newCode, req.body);
      const record = await records.addPhoto(req.params.id, req.params.newCode, { id });
      res.status(201).json({ success: true, id, record });
    } catch (err) {
      next(err);
    }
  }
);

app.get('/api/plans/:id/items/:newCode/record/photos/:photoId', async (req, res, next) => {
  try {
    const bytes = await photoStore.getPhoto(req.params.id, req.params.newCode, req.params.photoId);
    if (!bytes) return res.status(404).json({ success: false, error: 'ไม่พบรูปนี้' });
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' });
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/plans/:id/items/:newCode/record/photos/:photoId', async (req, res, next) => {
  try {
    // Record first, bytes second: if delPhoto fails after this, the record
    // no longer references the id and we're left with an orphaned blob
    // nobody points at — not a record pointing at bytes that are gone.
    const record = await records.removePhoto(req.params.id, req.params.newCode, req.params.photoId);
    await photoStore.delPhoto(req.params.id, req.params.newCode, req.params.photoId);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans/:id/docx', async (req, res, next) => {
  try {
    const plan = await plansStore.get(req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'ไม่พบแผนการตรวจนี้' });
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="plan-${plan.id}.docx"`,
    });
    res.send(renderPlanDocx(plan));
  } catch (err) {
    next(err);
  }
});

app.post('/api/plans/:id/pdf', async (req, res, next) => {
  try {
    const plan = await plansStore.get(req.params.id);
    if (!plan) return res.status(404).json({ success: false, error: 'ไม่พบแผนการตรวจนี้' });
    const pdf = await renderPlanPdf(plan);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="plan-${plan.id}.pdf"`,
    });
    res.send(Buffer.from(pdf));
  } catch (err) {
    next(err);
  }
});

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
    const pdf = await renderFormPdf(req.body || {});
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
app.post('/api/form/docx', async (req, res, next) => {
  try {
    const docx = await renderFormDocx(req.body || {});
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition(req, 'docx'),
    });
    res.send(docx);
  } catch (err) {
    next(err);
  }
});

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
    // The page offers "open this record at the council" per row, and their
    // search only answers a POST — so the UI needs the address to post to.
    res.json({ success: true, sourceUrl: config.pharmacistSearchUrl, ...data });
  } catch (err) {
    next(err);
  }
});

app.get('/api/cache', (req, res) =>
  res.json({ success: true, ...cacheStats(), pharmacist: pharmacistCacheStats() })
);

app.delete('/api/cache', (req, res) => {
  clearCache();
  clearPharmacistCache();
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
  // body-parser rejects an oversized body before any route handler runs, so
  // the route's own Thai branch never gets a chance — answer it here instead,
  // in Thai, since it's the one body-parser error reachable from user input.
  // Both the JSON routes (2mb) and the photo route (5mb) raise this same
  // err.type, so the limit must come from err.limit (bytes), not a literal,
  // or the wrong number gets reported on whichever route doesn't match it.
  if (err.type === 'entity.too.large') {
    const limitText = Number.isFinite(err.limit) ? `${Math.floor(err.limit / (1024 * 1024))}MB` : '';
    const message = limitText ? `ไฟล์ใหญ่เกินไป (จำกัดไม่เกิน ${limitText})` : 'ไฟล์ใหญ่เกินไป';
    return res.status(413).json({ success: false, code: 'PAYLOAD_TOO_LARGE', message });
  }
  const status = err instanceof ScrapeError ? err.status : err.status || err.statusCode || 500;
  const code = err instanceof ScrapeError ? err.code : 'INTERNAL_ERROR';
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ success: false, code, message: err.message });
});

// A stray rejection (a Puppeteer wait that outlives its request) must not take
// the whole API down.
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.message ? err.message : err);
});

/*
 * Only when run directly. A serverless deployment imports the app and
 * calls it per request — there is no port to bind and no signal to catch.
 */
if (require.main === module) {
  const server = app.listen(config.port, () => {
    console.log(`FDA scraper API listening on http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close();
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = app;

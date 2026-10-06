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
const drive = require('./drive-store');
const recordsStore = require('./records-store');
const { buildStats } = require('./stats');
const { renderPlanDocx } = require('./docx-plan');
const { rateLimit } = require('./rate-limit');

const app = express();
// Behind Vercel's proxy, so trust one hop — otherwise req.ip is the proxy and
// every client shares one rate-limit bucket.
app.set('trust proxy', 1);
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

/*
 * Rate limits on the endpoints that cost something to serve. `render` guards
 * the PDF/DOCX routes, each of which launches headless Chromium in a 2 GB
 * function; `search` guards the ones that hit the FDA / council sites. Both
 * key off the client IP (see `trust proxy` above). The whole office reaches
 * the site through one public IP, so a bucket is shared by every officer at
 * once, and each preview and area change is a search call of its own — the
 * numbers are sized for an office, not a person. Tune to real traffic.
 */
const renderLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'สร้างเอกสารถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});
const searchLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: 'ค้นหาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
});

// The standalone public pages (public/form.html, pharmacist-search.js) call
// these with no passcode, so a limit is the only thing between them and abuse.
// /api/form launches Chromium (render); /api/fda and /api/pharmacist are
// cached lookups against the FDA / council sites (search).
app.use('/api/form', renderLimit);
app.use(['/api/fda', '/api/pharmacist'], searchLimit);
// Record/plan exports live under /api/plans (passcode-gated) but still spin up
// Chromium, so they get the render limit too.
app.use(/^\/api\/plans\/.*\/(pdf|docx)$/, renderLimit);

/*
 * One office passcode guards the plan data — and the cache-clear below, which
 * is a mutation no page needs. With no passcode set, nothing is asked (the
 * local development case). It becomes real accounts at the Pharmacy Council.
 */
function requirePasscode(req, res, next) {
  if (!config.plansPasscode) return next();
  if (req.get('x-plans-passcode') === config.plansPasscode) return next();
  res.status(401).json({ success: false, error: 'รหัสผ่านไม่ถูกต้อง' });
}

app.get('/health', (req, res) =>
  res.json({
    ok: true,
    plansStore: plansStore.backendName(),
    photoStore: photoStore.backendName(),
    driveStore: drive.backendName(),
  })
);

// The list of shops an officer is about to walk into is not public, and
// neither are the office drive or the dashboard over it. (requirePasscode is
// defined once, above.)
app.use('/api/plans', requirePasscode);
app.use('/api/drive', requirePasscode);
app.use('/api/stats', requirePasscode);

// The dashboard. Reads every plan and every record — ponytail: fine for an
// office's few hundred inspections a year; cache it if that ever grows slow.
app.get('/api/stats', async (req, res, next) => {
  try {
    const [allPlans, allRecords] = await Promise.all([plansStore.list(), recordsStore.list()]);
    res.json({ success: true, ...buildStats(allPlans, allRecords) });
  } catch (err) {
    next(err);
  }
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

app.patch('/api/plans/:id', async (req, res, next) => {
  try {
    const plan = await plans.updatePlan(req.params.id, req.body || {});
    res.json({ success: true, plan });
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

app.put('/api/plans/:id/order', async (req, res, next) => {
  try {
    const codes = req.body && Array.isArray(req.body.newCodes) ? req.body.newCodes : [];
    const plan = await plans.reorderItems(req.params.id, codes);
    res.json({ success: true, plan });
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

app.patch('/api/plans/:id/items/:newCode/record/photos/:photoId', async (req, res, next) => {
  try {
    const record = await records.patchPhoto(req.params.id, req.params.newCode, req.params.photoId, req.body || {});
    res.json({ success: true, record });
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

/* Scanned / photographed paper forms. Raw body like photos; the type is the
   request's own Content-Type (JPEG or PDF only) and is remembered on the
   record so the GET can answer with it. 4mb: Vercel refuses bodies over 4.5MB
   before this code ever runs. */
const docPath = '/api/plans/:id/items/:newCode/record/documents';
const docName = (value) => String(value ?? '').slice(0, 200);

app.post(
  docPath,
  express.raw({ type: Object.keys(photoStore.DOC_TYPES), limit: '4mb' }),
  async (req, res, next) => {
    try {
      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!photoStore.DOC_TYPES[type]) {
        return res.status(415).json({ success: false, error: 'รองรับเฉพาะไฟล์รูป JPEG หรือ PDF' });
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลไฟล์' });
      }
      const { id } = await photoStore.putDoc(req.params.id, req.params.newCode, req.body, type);
      let record;
      try {
        record = await records.addDocument(req.params.id, req.params.newCode, { id, type, name: docName(req.query.name) });
      } catch (err) {
        // Nothing points at the bytes yet — take them back out rather than
        // leave an orphan in the store.
        await photoStore.delDoc(req.params.id, req.params.newCode, id, type).catch(() => {});
        throw err;
      }
      res.status(201).json({ success: true, id, record });
    } catch (err) {
      next(err);
    }
  }
);

async function findDoc(req) {
  const record = await records.readRecord(req.params.id, req.params.newCode);
  return (record.documents || []).find((doc) => doc.id === req.params.docId);
}

app.get(`${docPath}/:docId`, async (req, res, next) => {
  try {
    const doc = await findDoc(req);
    const bytes = doc && (await photoStore.getDoc(req.params.id, req.params.newCode, doc.id, doc.type));
    if (!bytes) return res.status(404).json({ success: false, error: 'ไม่พบเอกสารนี้' });
    // nosniff: the browser must take the stored type at its word, never
    // guess its way from "image/jpeg" into running something as HTML.
    res.set({
      'Content-Type': doc.type,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

app.patch(`${docPath}/:docId`, async (req, res, next) => {
  try {
    const patch = req.body || {};
    const record = await records.patchDocument(
      req.params.id,
      req.params.newCode,
      req.params.docId,
      patch.name === undefined ? {} : { name: docName(patch.name) }
    );
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

app.delete(`${docPath}/:docId`, async (req, res, next) => {
  try {
    // Record first, bytes second — same reasoning as the photo delete.
    const doc = await findDoc(req);
    const record = await records.removeDocument(req.params.id, req.params.newCode, req.params.docId);
    if (doc) await photoStore.delDoc(req.params.id, req.params.newCode, doc.id, doc.type);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});

/* The office drive (ไดรฟ์). Every route names its item by `?path=`, the
   segments joined by `/`; drive-store validates each one. */
const drivePath = (req) => String(req.query.path ?? '');

app.get('/api/drive/list', async (req, res, next) => {
  try {
    res.json({ success: true, ...(await drive.list(drivePath(req))) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/drive/folder', async (req, res, next) => {
  try {
    await drive.mkdir(drivePath(req), req.query.name);
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Any type, so the raw parser takes every body. 4mb: Vercel refuses bodies
// over 4.5MB before this code ever runs.
app.post('/api/drive/file', express.raw({ type: () => true, limit: '4mb' }), async (req, res, next) => {
  try {
    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ success: false, error: 'ไม่พบข้อมูลไฟล์' });
    }
    const name = await drive.put(drivePath(req), req.query.name, req.body);
    res.status(201).json({ success: true, name });
  } catch (err) {
    next(err);
  }
});

// Only these open in the browser. Anything else — an uploaded .html or .svg
// above all — is handed over as an attachment, so it never runs on our origin.
const DRIVE_INLINE = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

app.get('/api/drive/file', async (req, res, next) => {
  try {
    const bytes = await drive.get(drivePath(req));
    if (!bytes) return res.status(404).json({ success: false, error: 'ไม่พบไฟล์นี้' });
    const name = drivePath(req).split('/').pop();
    const type = DRIVE_INLINE[name.split('.').pop().toLowerCase()];
    res.set({
      'Content-Type': type || 'application/octet-stream',
      'Content-Disposition': `${type ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

app.patch('/api/drive/rename', async (req, res, next) => {
  try {
    const name = await drive.rename(drivePath(req), (req.body || {}).name);
    res.json({ success: true, name });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/drive', async (req, res, next) => {
  try {
    const gone = await drive.remove(drivePath(req));
    if (!gone) return res.status(404).json({ success: false, error: 'ไม่พบรายการนี้' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// Appendix photos are inlined as base64 data URLs into the page puppeteer
// renders; past this many the page gets large and slow to print.
const MAX_APPENDIX_PHOTOS = 20;

/*
 * The record's own PDF, made from the stored draft rather than from a body
 * the page posts. The photo bytes are read here and passed in as data URLs:
 * the page puppeteer opens is a file:// page with no passcode and no session,
 * so it could not fetch them itself even if we wanted it to.
 *
 * Refuses to export (409) rather than silently drop a photo: one marked for
 * the appendix whose bytes are gone names itself so the officer can remove it
 * or re-photograph it, and more than MAX_APPENDIX_PHOTOS marked at once is
 * refused with the count and the limit.
 */
async function recordForExport(planId, newCode) {
  const record = await records.readRecord(planId, newCode);
  const marked = (record.photos || []).filter((photo) => photo.inPdf);
  if (marked.length > MAX_APPENDIX_PHOTOS) {
    const err = new Error(
      `มีรูปภาพผนวกท้ายทั้งหมด ${marked.length} รูป เกินจำนวนที่ส่งออกได้สูงสุด ${MAX_APPENDIX_PHOTOS} รูป`
    );
    err.status = 409;
    throw err;
  }
  const photos = [];
  for (const [index, photo] of (record.photos || []).entries()) {
    if (!photo.inPdf) continue;
    const bytes = await photoStore.getPhoto(planId, newCode, photo.id);
    if (!bytes) {
      const label = photo.caption ? `"${photo.caption}"` : `ภาพที่ ${index + 1}`;
      const err = new Error(
        `ไม่พบไฟล์รูป ${label} กรุณานำออกจากบันทึกหรือถ่ายใหม่ก่อนออกเอกสาร`
      );
      err.status = 409;
      throw err;
    }
    photos.push({
      src: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      caption: photo.caption || '',
    });
  }
  return {
    values: record.values || {},
    checks: record.checks || {},
    signatures: record.signatures || {},
    photos,
  };
}

app.post('/api/plans/:id/items/:newCode/record/pdf', async (req, res, next) => {
  try {
    const data = await recordForExport(req.params.id, req.params.newCode);
    const pdf = await renderFormPdf(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': disposition(data.values, 'pdf'),
    });
    res.send(Buffer.from(pdf));
  } catch (err) {
    next(err);
  }
});

/* The Word file carries the text and nothing else: no photographs and no
   signatures. It exists to be edited afterwards, and embedding media in a
   .docx means writing relationships and drawing XML for a file that is not
   the one the office sends. */
app.post('/api/plans/:id/items/:newCode/record/docx', async (req, res, next) => {
  try {
    const { values, checks } = await recordForExport(req.params.id, req.params.newCode);
    const docx = await renderFormDocx({ values, checks });
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': disposition(values, 'docx'),
    });
    res.send(Buffer.from(docx));
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
 * `values` is the record's `{ placeName, ... }` object, wherever it came from.
 */
function disposition(values, extension) {
  const name = String((values && values.placeName) || 'inspection').replace(
    /[\\/:*?"<>|]/g,
    ' '
  );
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
      'Content-Disposition': disposition(req.body && req.body.values, 'pdf'),
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
      'Content-Disposition': disposition(req.body && req.body.values, 'docx'),
    });
    res.send(docx);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pharmacist?firstName=สมชาย&lastName=ใจดี
 * The pharmacist's ภ. licence number, from the Pharmacy Council register.
 * Both are required — the council's form no longer searches one alone.
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

app.delete('/api/cache', requirePasscode, (req, res) => {
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

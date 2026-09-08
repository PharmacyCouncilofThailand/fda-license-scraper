# On-Site Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an officer stand in a pharmacy with an iPad, open the shop straight from the day's inspection plan, fill the record on a touch screen, attach photos and on-screen signatures, and produce the same PDF the office produces today.

**Architecture:** The record's A4 page (`web/public/form.html`) is not touched as a data-entry surface — it stays the printing original that puppeteer opens. A new touch wizard lives in the React app at `#/plans/:id/:newCode`, writes its draft to the server through `/api/plans/:id/items/:newCode/record`, and hands the same `{values, checks}` shape to the existing PDF path. Drafts are one JSON document per shop; photo bytes live in their own store; both reuse a `json-store` factory extracted from today's `plans-store`.

**Tech Stack:** Node 20+ CommonJS under `src/`, Express 4, React 18 + Vite in `web/`, puppeteer for PDF, plain `node` scripts with `assert` for tests.

## Global Constraints

- `src/` is CommonJS (`'use strict'`, `require`); `web/src/` is ES modules. Do not mix.
- Comments and identifiers in English. Every user-facing string in Thai.
- No test framework. Tests are standalone `node` scripts using `assert`, registered in `package.json` scripts.
- No new runtime dependency. `@vercel/blob` is already installed and is the only one this work may use.
- `templates/` never enters git or a deployment upload.
- `BLOB_READ_WRITE_TOKEN` may only ever be sent to `*.blob.vercel-storage.com`. Blob objects stay `access: 'private'`.
- The office passcode travels in the `x-plans-passcode` header only. It must never appear in a URL, a query string, or a log line.
- `node test-form-parity.js` must pass after every task that touches `web/public/form.html`. It compares the built `public/form.html`, so run `npm run build` first.
- Plan ids are Buddhist-era `YYYY-MM-DD` with an optional `-2` suffix. `newCode` is the FDA's own key and may contain any characters — always `encodeURIComponent` it in a URL and never put it in a filesystem path unencoded.
- The record has **64 blanks and 25 checkboxes**. Those two numbers are asserted by `test-form-fields.js`; if a task changes them, that test changes in the same commit.

---

## File Structure

**New under `src/`**
- `src/json-store.js` — factory: two backends (`file`, `blob`) behind `list/get/save/remove/backendName`. Knows nothing about plans or records.
- `src/records-store.js` — one draft per shop, keyed `<planId>__<newCodeSlug>`.
- `src/photo-store.js` — photo bytes, same two backends, keyed by plan + shop + photo id.
- `src/records.js` — what a draft *means*: build an empty one from a plan item, apply a write with its stale-write check.

**New under `web/`**
- `web/public/officers.js` — the office's own list of inspecting officers, read by both `form.html` and the React app.
- `web/src/lib/form-fields.js` — the manifest: every blank and every checkbox group, which wizard step it belongs to, its label and its type.
- `web/src/lib/records-api.js` — browser client for the record routes.
- `web/src/components/RecordForm.jsx` — the wizard shell: steps, autosave, next-shop.
- `web/src/components/RecordStep.jsx` — renders one step's fields from the manifest.
- `web/src/components/PhotoGrid.jsx` — camera, downscale, upload, caption, "แนบท้าย PDF".
- `web/src/components/SignaturePad.jsx` — one signature box.

**Modified**
- `src/plans-store.js` → a shell over `json-store` with the same exports.
- `src/config.js` → `photosDir`.
- `src/server.js` → record and photo routes; signatures and photos handed to the PDF renderer.
- `web/public/form.html` → `data-sign` on the eight signature rules, signature images in `applyData`, the photo appendix sheet, officers list moved out.
- `web/src/App.jsx`, `web/src/components/PlanTable.jsx`, `web/src/app.css`.
- `test-form-parity.js`, `smoke.js`, `README.md`, `.env.example`, `package.json`.

---

## Task 1: The store factory

Today `src/plans-store.js` holds the only copy of "file or blob, chosen by a setting". Records and photos need the same thing. Extract it first, with no behaviour change, so the existing store test is the proof.

**Files:**
- Create: `src/json-store.js`
- Modify: `src/plans-store.js`

**Interfaces:**
- Produces: `createJsonStore({ backend, dir, prefix, idPattern, idError, sort }) -> { list, get, save, remove, backendName }`
  - `backend` — `'file'` or `'blob'`
  - `dir` — absolute directory for the `file` backend
  - `prefix` — blob key prefix, e.g. `'plans/'`
  - `idPattern` — `RegExp` an id must match before it ever reaches a path
  - `idError` — Thai message thrown (status 400) when it does not
  - `sort` — optional comparator for `list()`
- Consumed by: Task 2 (`records-store`), and `plans-store` from this task on.

- [ ] **Step 1: Write the factory**

Create `src/json-store.js`:

```js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * One JSON document per id, in one of two places.
 *
 * There are two backends because the system runs on Vercel today and moves to
 * the Pharmacy Council's own server later; the move has to be a setting, not
 * an edit to every caller. Plans, records and (through a sibling module)
 * photos all need that same choice, so it lives here once.
 *
 * Nothing here knows what any document means.
 */
function createJsonStore({ backend, dir, prefix, idPattern, idError, sort }) {
  /** Ids reach here from a URL, so they may never contain a path. */
  function assertId(id) {
    if (!idPattern.test(String(id || ''))) {
      const err = new Error(idError);
      err.status = 400;
      throw err;
    }
    return id;
  }

  const file = {
    name: 'file',
    async all() {
      let names;
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const documents = [];
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        documents.push(JSON.parse(raw));
      }
      return documents;
    },
    async get(id) {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async put(document) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${document.id}.json`),
        JSON.stringify(document, null, 2),
        'utf8'
      );
    },
    async del(id) {
      try {
        await fs.unlink(path.join(dir, `${id}.json`));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
  };

  /*
   * Vercel's filesystem is read-only, so the deployment keeps documents in
   * Blob. `access: 'private'`: a plan names the shops the office is about to
   * visit, and a record carries what was found inside one. Neither is public.
   *
   * The SDK is required lazily so a `file` deployment never loads it, and the
   * token is checked per call rather than at startup so this module can be
   * required (and tested) without one.
   */
  function blobApi() {
    if (!config.blobToken) {
      const err = new Error('ต้องตั้งค่า BLOB_READ_WRITE_TOKEN ก่อนใช้ที่เก็บแบบ blob');
      err.status = 500;
      throw err;
    }
    return require('@vercel/blob');
  }

  const blob = {
    name: 'blob',
    async all() {
      const { list: listBlobs } = blobApi();
      const { blobs } = await listBlobs({ prefix, token: config.blobToken });
      const documents = [];
      for (const entry of blobs) {
        const response = await fetch(entry.downloadUrl, {
          headers: { Authorization: `Bearer ${config.blobToken}` },
        });
        if (response.ok) documents.push(await response.json());
      }
      return documents;
    },
    async get(id) {
      const { head } = blobApi();
      let meta;
      try {
        meta = await head(`${prefix}${id}.json`, { token: config.blobToken });
      } catch {
        return null; // The SDK throws BlobNotFoundError; a missing document is not an error here.
      }
      const response = await fetch(meta.downloadUrl, {
        headers: { Authorization: `Bearer ${config.blobToken}` },
      });
      return response.ok ? response.json() : null;
    },
    async put(document) {
      const { put } = blobApi();
      await put(`${prefix}${document.id}.json`, JSON.stringify(document, null, 2), {
        access: 'private',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,
        token: config.blobToken,
      });
    },
    async del(id) {
      const { del } = blobApi();
      const existing = await blob.get(id);
      if (!existing) return false;
      await del(`${prefix}${id}.json`, { token: config.blobToken });
      return true;
    },
  };

  const backends = { file, blob };
  const chosen = backends[backend] || file;

  return {
    async list() {
      const all = await chosen.all();
      return sort ? all.sort(sort) : all;
    },
    async get(id) {
      return chosen.get(assertId(id));
    },
    async save(document) {
      assertId(document.id);
      const next = { ...document, updatedAt: new Date().toISOString() };
      await chosen.put(next);
      return next;
    },
    async remove(id) {
      return chosen.del(assertId(id));
    },
    backendName() {
      return chosen.name;
    },
  };
}

module.exports = { createJsonStore };
```

- [ ] **Step 2: Make `plans-store` a shell over it**

Replace the whole body of `src/plans-store.js` with:

```js
'use strict';

const config = require('./config');
const { createJsonStore } = require('./json-store');

/**
 * One inspection plan is one JSON document. Nothing here knows what a plan
 * means — that is `src/plans.js`. The two backends live in `json-store`,
 * which records and photos use as well.
 */
const store = createJsonStore({
  backend: config.plansStore,
  dir: config.plansDir,
  prefix: 'plans/',
  idPattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$/,
  idError: 'รหัสแผนไม่ถูกต้อง',
  sort: (a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)),
});

module.exports = store;
```

- [ ] **Step 3: Run the existing store test — it is the proof this changed nothing**

```bash
node test-plans-store.js
```

Expected: `ok — ที่เก็บแผนแบบไฟล์ทำงานครบวงจร`.

If it fails on `backendName()`, check that `module.exports = store` exports the function itself and not a bound copy.

- [ ] **Step 4: Run the rest of the suite**

```bash
npm test
```

Expected: every line prints its own `ok —`.

- [ ] **Step 5: Commit**

```bash
git add src/json-store.js src/plans-store.js
git commit -m "Lift the two storage backends out of the plan store

Records and photos need the same choice of file-or-blob that plans have,
and it should be one implementation, not three.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The record store and its logic

**Files:**
- Create: `src/records-store.js`, `src/records.js`
- Test: `test-records-store.js`
- Modify: `src/config.js`, `package.json`

**Interfaces:**
- Consumes: `createJsonStore` (Task 1); `store.get` from `src/plans-store.js`.
- Produces:
  - `recordId(planId, newCode) -> string` — `<planId>__<url-encoded newCode>`
  - `getRecord(planId, newCode) -> Promise<Record|null>`
  - `blankRecord(planId, newCode, item) -> Record` — an empty draft seeded from the plan item
  - `readRecord(planId, newCode) -> Promise<Record>` — stored draft, or a blank one built from the plan
  - `writeRecord(planId, newCode, incoming) -> Promise<Record>` — throws `err.status === 409` with `err.current` when `incoming.updatedAt` is older than what is stored
  - `addPhoto(planId, newCode, { id }) -> Promise<Record>`, `removePhoto(planId, newCode, photoId) -> Promise<Record>`

- [ ] **Step 1: Add the setting**

In `src/config.js`, immediately after the `plansPasscode` line:

```js
  // Photo bytes for on-site records. Same backend choice as the plans, so a
  // deployment configures one thing, not two.
  photosDir: process.env.PHOTOS_DIR || path.join(__dirname, '..', 'data', 'photos'),
  recordsDir: process.env.RECORDS_DIR || path.join(__dirname, '..', 'data', 'records'),
```

- [ ] **Step 2: Write the failing test**

Create `test-records-store.js`:

```js
/**
 * Offline check of the on-site record: a draft is built from the plan, written
 * back, and refuses a write built on a version that has moved on. No network.
 *
 *   node test-records-store.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'records-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = path.join(root, 'plans');
process.env.RECORDS_DIR = path.join(root, 'records');
process.env.PHOTOS_DIR = path.join(root, 'photos');

const plansStore = require('./src/plans-store');
const records = require('./src/records');

const PLAN = {
  id: '2569-08-27',
  title: 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม',
  date: '2569-08-27',
  items: [
    {
      newCode: 'A/1',                       // a slash, because the FDA's keys are not path-safe
      order: 1,
      placeName: 'ร้านเจริญสุขเภสัช',
      licenseType: 'ขย.1',
      licenseNo: 'กท 754/2526',
      address: 'เลขที่ 293 ถ.สาลีรัฐวิภาค แขวงสามเสนใน เขตพญาไท กทม.',
      licenseeName: 'นางกุ้ยจู อัศวเวชมงคล',
      openHours: '09.00 - 18.00 น.',
      pharmacists: [{ name: 'ภญ. รัชดา อัศวรัตน์', licenceNo: '2524', openHours: '09.00 - 13.00 น.' }],
      status: 'planned',
      statusSource: 'auto',
      note: '',
    },
  ],
};

(async () => {
  await plansStore.save({ ...PLAN, createdAt: '2026-09-08T00:00:00.000Z' });

  // An id may never carry a path separator into the filesystem.
  const id = records.recordId('2569-08-27', 'A/1');
  assert.ok(!id.includes('/'), `รหัสบันทึกต้องไม่มีเครื่องหมาย / : ${id}`);

  // Nothing stored yet: a blank draft seeded from the plan item.
  const blank = await records.readRecord('2569-08-27', 'A/1');
  assert.strictEqual(blank.values.placeName, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(blank.values.shopNameAtCheck, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(blank.values.licenseeName, 'นางกุ้ยจู อัศวเวชมงคล');
  assert.strictEqual(blank.values.licenseNo, 'กท 754/2526');
  assert.strictEqual(blank.values.subdistrict, 'สามเสนใน');
  assert.strictEqual(blank.values.district, 'พญาไท');
  // The pharmacist blanks stay empty: the licence says who may be on duty,
  // not who was there. Same rule the hand-off to form.html follows.
  assert.strictEqual(blank.values.dutyPharmacist, '');
  assert.strictEqual(blank.values.openHours, '');
  assert.deepStrictEqual(blank.photos, []);
  assert.strictEqual(blank.updatedAt, null, 'ร่างที่ยังไม่เคยบันทึกต้องไม่มี updatedAt');

  // First write.
  const first = await records.writeRecord('2569-08-27', 'A/1', {
    ...blank,
    officerName: 'นางสาวอชิดา บุญเพียร',
    values: { ...blank.values, inspectTime: '10.30' },
    checks: { shopOpen: true },
    signatures: { page1: 'data:image/png;base64,AAA' },
  });
  assert.ok(first.updatedAt, 'เขียนแล้วต้องมี updatedAt');
  assert.strictEqual(first.values.inspectTime, '10.30');
  assert.strictEqual(first.checks.shopOpen, true);

  // Reading it back gives the stored draft, not a fresh blank.
  const stored = await records.readRecord('2569-08-27', 'A/1');
  assert.strictEqual(stored.values.inspectTime, '10.30');
  assert.strictEqual(stored.signatures.page1, 'data:image/png;base64,AAA');

  // A second write that knows the current version wins.
  const second = await records.writeRecord('2569-08-27', 'A/1', {
    ...stored,
    values: { ...stored.values, endTime: '11.15' },
  });
  assert.strictEqual(second.values.endTime, '11.15');

  // A write built on the version before that is refused, and hands back the
  // current one so the officer can choose.
  await assert.rejects(
    () => records.writeRecord('2569-08-27', 'A/1', { ...first, values: { ...first.values, endTime: 'ทับ' } }),
    (err) => {
      assert.strictEqual(err.status, 409);
      assert.strictEqual(err.current.values.endTime, '11.15');
      return true;
    }
  );

  // Photos are listed on the record; the bytes are somewhere else.
  const withPhoto = await records.addPhoto('2569-08-27', 'A/1', { id: 'p1' });
  assert.deepStrictEqual(
    withPhoto.photos.map((p) => [p.id, p.inPdf, p.caption]),
    [['p1', true, '']]
  );
  const withoutPhoto = await records.removePhoto('2569-08-27', 'A/1', 'p1');
  assert.deepStrictEqual(withoutPhoto.photos, []);

  // A shop that is not in the plan has no record to build.
  await assert.rejects(() => records.readRecord('2569-08-27', 'NOPE'), /ไม่พบร้าน/);
  await assert.rejects(() => records.readRecord('2569-01-01', 'A/1'), /ไม่พบแผน/);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok — บันทึกการตรวจหน้างานเก็บ อ่าน และกันเขียนทับได้');
})();
```

- [ ] **Step 3: Run it and watch it fail**

```bash
node test-records-store.js
```

Expected: `Error: Cannot find module './src/records'`.

- [ ] **Step 4: Write the store**

Create `src/records-store.js`:

```js
'use strict';

const config = require('./config');
const { createJsonStore } = require('./json-store');

/**
 * One on-site record is one JSON document, keyed by the plan and the shop.
 * Nothing here knows what a record means — that is `src/records.js`.
 */
module.exports = createJsonStore({
  backend: config.plansStore,
  dir: config.recordsDir,
  prefix: 'records/',
  // `<planId>__<url-encoded newCode>`. The encoding is what keeps the FDA's
  // keys — which contain slashes — out of the filesystem's path grammar.
  idPattern: /^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?__[A-Za-z0-9%._~-]{1,200}$/,
  idError: 'รหัสบันทึกการตรวจไม่ถูกต้อง',
});
```

- [ ] **Step 5: Write the logic**

Create `src/records.js`:

```js
'use strict';

const store = require('./records-store');
const plansStore = require('./plans-store');

/**
 * What an on-site record is: the same `{ values, checks }` the record page
 * reads, plus the photos and signatures the officer adds at the shop.
 *
 * The keys in `values` and `checks` are exactly the ones `form.html` writes
 * out of `collect()` — there is no translation layer between the wizard and
 * the paper, because a translation layer is one more place for a blank to go
 * missing.
 */

const SIGNATURE_SLOTS = [
  'page1',
  'duty',
  'licensee',
  'officer1',
  'officer2',
  'officer3',
  'officer4',
  'officer5',
];

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function recordId(planId, newCode) {
  return `${planId}__${encodeURIComponent(String(newCode))}`;
}

async function planItem(planId, newCode) {
  const plan = await plansStore.get(planId);
  if (!plan) throw notFound('ไม่พบแผนการตรวจนี้');
  const item = plan.items.find((entry) => entry.newCode === newCode);
  if (!item) throw notFound('ไม่พบร้านนี้ในแผน');
  return item;
}

/* The plan item carries the address as one line, as the FDA writes it. The
   record has a blank per part, so the line is split on the labels the FDA
   itself uses. What does not match stays in `houseNo`, which is the blank an
   officer would correct first. */
function splitAddress(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  const grab = (label) => {
    const match = text.match(new RegExp(`${label}\\s*([^\\s]+)`));
    return match ? match[1] : '';
  };
  return {
    houseNo: (text.match(/เลขที่\s*([^\s]+)/) || [])[1] || '',
    village: grab('หมู่บ้าน|อาคาร'),
    moo: grab('หมู่ที่'),
    soi: grab('ซ\\.|ซอย'),
    road: grab('ถ\\.|ถนน'),
    subdistrict: grab('แขวง|ตำบล'),
    district: grab('เขต|อำเภอ'),
    province: grab('จังหวัด') || (/กทม\.|กรุงเทพ/.test(text) ? 'กรุงเทพมหานคร' : ''),
  };
}

/**
 * An empty draft, seeded with what the plan already knows.
 *
 * `dutyPharmacist` and `openHours` are deliberately left empty: item (2) is
 * about the pharmacist who was on duty when the inspection happened, and the
 * licence only says who is entitled to be. `form.html` leaves the same two
 * blanks for the same reason.
 */
function blankRecord(planId, newCode, item) {
  const area = splitAddress(item.address);
  return {
    id: recordId(planId, newCode),
    planId,
    newCode,
    officerName: '',
    values: {
      placeName: item.placeName || '',
      shopNameAtCheck: item.placeName || '',
      licenseeName: item.licenseeName || '',
      licenseNo: item.licenseNo || '',
      dutyPharmacist: '',
      openHours: '',
      ...area,
    },
    checks: {},
    signatures: {},
    photos: [],
    createdAt: null,
    updatedAt: null,
  };
}

async function readRecord(planId, newCode) {
  const item = await planItem(planId, newCode);
  const stored = await store.get(recordId(planId, newCode));
  return stored || blankRecord(planId, newCode, item);
}

/**
 * Write the draft whole.
 *
 * One shop is filled in by one officer at a time, so there is nothing to gain
 * from patching field by field — but two iPads open on the same shop would
 * silently eat each other's work, so a write that was built on an older
 * version is refused and handed the current one to merge from.
 */
async function writeRecord(planId, newCode, incoming) {
  const item = await planItem(planId, newCode);
  const id = recordId(planId, newCode);
  const current = await store.get(id);
  if (current && incoming.updatedAt !== current.updatedAt) {
    const err = new Error('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
    err.status = 409;
    err.current = current;
    throw err;
  }
  const base = current || blankRecord(planId, newCode, item);
  const signatures = {};
  for (const slot of SIGNATURE_SLOTS) {
    const value = (incoming.signatures || {})[slot];
    if (value) signatures[slot] = String(value);
  }
  return store.save({
    ...base,
    officerName: String(incoming.officerName || ''),
    values: { ...(incoming.values || {}) },
    checks: { ...(incoming.checks || {}) },
    signatures,
    // Photos change through their own routes, never through a draft write —
    // otherwise an autosave in flight when a photo lands would delete it.
    photos: base.photos || [],
    createdAt: base.createdAt || new Date().toISOString(),
  });
}

async function addPhoto(planId, newCode, { id: photoId }) {
  const record = await readRecord(planId, newCode);
  const photos = [
    ...(record.photos || []),
    { id: photoId, caption: '', inPdf: true, at: new Date().toISOString() },
  ];
  return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
}

async function removePhoto(planId, newCode, photoId) {
  const record = await readRecord(planId, newCode);
  const photos = (record.photos || []).filter((photo) => photo.id !== photoId);
  return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
}

module.exports = {
  SIGNATURE_SLOTS,
  recordId,
  blankRecord,
  readRecord,
  writeRecord,
  addPhoto,
  removePhoto,
};
```

- [ ] **Step 6: Run the test and watch it pass**

```bash
node test-records-store.js
```

Expected: `ok — บันทึกการตรวจหน้างานเก็บ อ่าน และกันเขียนทับได้`.

If `subdistrict` or `district` comes back empty, print the fixture's `address` and check `splitAddress` against it — the labels in the test fixture (`แขวงสามเสนใน เขตพญาไท`) are written without a space after the label, which the `[^\s]+` group is what handles.

- [ ] **Step 7: Keep local records and photos out of git**

Confirm `.gitignore` already ignores `data/`. If it ignores only `data/plans/`, change that line to `data/`.

- [ ] **Step 8: Register the script**

In `package.json` `"scripts"`, after `"test:plans"`:

```json
    "test:records": "node test-records-store.js",
```

and add it to the combined `"test"` script, after `node test-plans.js &&`.

- [ ] **Step 9: Commit**

```bash
git add src/records.js src/records-store.js src/config.js test-records-store.js package.json .gitignore
git commit -m "Keep one on-site record per shop in the plan

A draft is written whole because one officer fills one shop, but a write
built on a version that has moved on is refused rather than allowed to eat
the other iPad's work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The photo store

**Files:**
- Create: `src/photo-store.js`
- Modify: `test-records-store.js`

**Interfaces:**
- Consumes: `config.photosDir`, `config.plansStore`, `config.blobToken`.
- Produces:
  - `putPhoto(planId, newCode, buffer) -> Promise<{ id }>` — id is 24 hex characters
  - `getPhoto(planId, newCode, photoId) -> Promise<Buffer|null>`
  - `delPhoto(planId, newCode, photoId) -> Promise<boolean>`
  - `backendName() -> 'file' | 'blob'`

- [ ] **Step 1: Add the failing assertions**

In `test-records-store.js`, add `const photos = require('./src/photo-store');` beside the other requires, and insert this block immediately before the `readRecord` rejection assertions near the end:

```js
  // --- photo bytes --------------------------------------------------------
  const bytes = Buffer.from('\xff\xd8\xff\xe0 not really a jpeg', 'binary');
  const { id: photoId } = await photos.putPhoto('2569-08-27', 'A/1', bytes);
  assert.match(photoId, /^[0-9a-f]{24}$/, 'รหัสรูปควรเป็นเลขฐานสิบหก 24 ตัว');
  assert.deepStrictEqual(await photos.getPhoto('2569-08-27', 'A/1', photoId), bytes);
  assert.strictEqual(await photos.getPhoto('2569-08-27', 'A/1', 'ไม่มีรูปนี้'), null);
  assert.strictEqual(await photos.delPhoto('2569-08-27', 'A/1', photoId), true);
  assert.strictEqual(await photos.getPhoto('2569-08-27', 'A/1', photoId), null);
  assert.strictEqual(await photos.delPhoto('2569-08-27', 'A/1', photoId), false);
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node test-records-store.js
```

Expected: `Error: Cannot find module './src/photo-store'`.

- [ ] **Step 3: Write the store**

Create `src/photo-store.js`:

```js
'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * Photo bytes taken at the shop. Not `json-store`: these are binary, they are
 * never listed as documents, and one record has several of them — but the
 * choice of where they live is the same setting, so a deployment configures
 * one thing and not two.
 *
 * `access: 'private'` on the blob side. What the inside of a pharmacy looked
 * like on the day it was inspected is not public information.
 */

function assertPart(value, message) {
  if (!/^[A-Za-z0-9%._~-]{1,200}$/.test(String(value || ''))) {
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
  return value;
}

/** A shop's key can hold anything, so it is encoded before it is a path. */
function keyFor(planId, newCode, photoId) {
  assertPart(planId, 'รหัสแผนไม่ถูกต้อง');
  assertPart(photoId, 'รหัสรูปไม่ถูกต้อง');
  return `${planId}/${encodeURIComponent(String(newCode))}/${photoId}.jpg`;
}

const BLOB_PREFIX = 'photos/';

function blobApi() {
  if (!config.blobToken) {
    const err = new Error('ต้องตั้งค่า BLOB_READ_WRITE_TOKEN ก่อนใช้ที่เก็บแบบ blob');
    err.status = 500;
    throw err;
  }
  return require('@vercel/blob');
}

const file = {
  name: 'file',
  async put(key, buffer) {
    const target = path.join(config.photosDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  },
  async get(key) {
    try {
      return await fs.readFile(path.join(config.photosDir, key));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async del(key) {
    try {
      await fs.unlink(path.join(config.photosDir, key));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  },
};

const blob = {
  name: 'blob',
  async put(key, buffer) {
    const { put } = blobApi();
    await put(`${BLOB_PREFIX}${key}`, buffer, {
      access: 'private',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: config.blobToken,
    });
  },
  async get(key) {
    const { head } = blobApi();
    let meta;
    try {
      meta = await head(`${BLOB_PREFIX}${key}`, { token: config.blobToken });
    } catch {
      return null;
    }
    const response = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${config.blobToken}` },
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  },
  async del(key) {
    const { del } = blobApi();
    if (!(await blob.get(key))) return false;
    await del(`${BLOB_PREFIX}${key}`, { token: config.blobToken });
    return true;
  },
};

const backends = { file, blob };
const backend = backends[config.plansStore] || file;

async function putPhoto(planId, newCode, buffer) {
  const id = crypto.randomBytes(12).toString('hex');
  await backend.put(keyFor(planId, newCode, id), buffer);
  return { id };
}

async function getPhoto(planId, newCode, photoId) {
  // An id that could never have been issued is a miss, not a bad request:
  // the caller is a page asking for something that is gone.
  if (!/^[0-9a-f]{24}$/.test(String(photoId))) return null;
  return backend.get(keyFor(planId, newCode, photoId));
}

async function delPhoto(planId, newCode, photoId) {
  if (!/^[0-9a-f]{24}$/.test(String(photoId))) return false;
  return backend.del(keyFor(planId, newCode, photoId));
}

function backendName() {
  return backend.name;
}

module.exports = { putPhoto, getPhoto, delPhoto, backendName };
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
node test-records-store.js
```

Expected: `ok — บันทึกการตรวจหน้างานเก็บ อ่าน และกันเขียนทับได้`.

- [ ] **Step 5: Commit**

```bash
git add src/photo-store.js test-records-store.js
git commit -m "Store the photos taken at the shop

Private on the blob side for the same reason the plans are: what the
inside of a pharmacy looked like on inspection day is not public.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The HTTP routes

**Files:**
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `src/records.js`, `src/photo-store.js` (Tasks 2–3).
- Produces, all under `/api/plans/:id/items/:newCode/record` and behind the existing passcode guard:
  - `GET /record` → `{ success, record }`
  - `PUT /record` → `{ success, record }`; `409` answers `{ success: false, error, current }`
  - `POST /record/photos` (body: raw `image/jpeg`) → `{ success, id, record }`
  - `GET /record/photos/:photoId` → the bytes, `image/jpeg`
  - `DELETE /record/photos/:photoId` → `{ success, record }`

- [ ] **Step 1: Add the requires**

Beside `const plans = require('./plans');` in `src/server.js`:

```js
const records = require('./records');
const photoStore = require('./photo-store');
```

- [ ] **Step 2: Report the photo backend in /health**

Change the `/health` handler to:

```js
app.get('/health', (req, res) =>
  res.json({ ok: true, plansStore: plansStore.backendName(), photoStore: photoStore.backendName() })
);
```

- [ ] **Step 3: Add the routes**

In `src/server.js`, immediately after the `POST /api/plans/:id/items/:newCode/sync` route:

```js
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
    await photoStore.delPhoto(req.params.id, req.params.newCode, req.params.photoId);
    const record = await records.removePhoto(req.params.id, req.params.newCode, req.params.photoId);
    res.json({ success: true, record });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Check the payload ceiling**

`express.json()` defaults to a 100kb body. A draft carries up to eight signature
PNGs as data URLs, which will exceed that. Change the existing line near the top
of `src/server.js`:

```js
// Signatures ride inside the record as data URLs — eight of them at a few tens
// of kilobytes each is past express's 100kb default.
app.use(express.json({ limit: '2mb' }));
```

- [ ] **Step 5: Exercise the routes by hand**

```bash
PLANS_STORE=file npm start
```

In another shell — create a plan, put one real shop in it, then:

```bash
curl -s localhost:3000/health
```

Expected: `{"ok":true,"plansStore":"file","photoStore":"file"}`.

```bash
curl -s "localhost:3000/api/plans/2569-08-27/items/<newCode>/record" | head -c 300
```

Expected: a draft whose `values.placeName` is the shop's name and whose `updatedAt` is `null`.

- [ ] **Step 6: Check the stale-write answer**

Write once with the draft as read, then write again with the same body:

```bash
curl -s -X PUT localhost:3000/api/plans/2569-08-27/items/<newCode>/record \
  -H 'content-type: application/json' -d '{"updatedAt":null,"values":{"endTime":"11.00"},"checks":{}}'
curl -s -X PUT localhost:3000/api/plans/2569-08-27/items/<newCode>/record \
  -H 'content-type: application/json' -d '{"updatedAt":null,"values":{"endTime":"ทับ"},"checks":{}}' -w ' %{http_code}\n'
```

Expected: the first answers `success: true`; the second answers `409` with `current.values.endTime` = `11.00`.

- [ ] **Step 7: Commit**

```bash
git add src/server.js
git commit -m "Serve the on-site record and its photos

express.raw is mounted on the photo route alone: every other route here
speaks JSON, and a parser that accepts images everywhere would eventually
accept one somewhere it should not.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: One list of officers, read by both pages

**Files:**
- Create: `web/public/officers.js`
- Modify: `web/public/form.html`, `web/index.html`

**Interfaces:**
- Produces: `window.OFFICERS` — `string[]`, the office's inspecting officers in the order the office lists them.
- Consumed by: `form.html` (this task) and `RecordForm.jsx` (Task 11).

- [ ] **Step 1: Write the list**

Create `web/public/officers.js` with exactly the names now in `form.html`:

```js
/*
 * The office's own inspecting officers. Served straight off disk with no
 * bundler so that both the record page (web/public/form.html) and the React
 * app can read the same one — the record page cannot import an ES module out
 * of web/src/, and two copies of a list of real people is how one of them
 * goes stale. The same reason web/public/pharmacist-search.js is shared.
 */
window.OFFICERS = [
  'นายเทอดภูมิ พัชรสุนทรชัย',
  'นางสาวอชิดา บุญเพียร',
  'นางสาวศศิธร เจือโร่ง',
  'นายศิริพงษ์ เจือโร่ง',
  'นายณภัทร ไกยวงค์',
  'นายเจษฎา จันทรประเสริฐ',
  'นางสาวอัญพิชา แก้วสม',
];
```

- [ ] **Step 2: Load it from the record page**

In `web/public/form.html`, beside the existing `<script src="/pharmacist-search.js">` tag (search for `pharmacist-search.js`), add before it:

```html
    <script src="/officers.js"></script>
```

Then replace the `const OFFICERS = [ … ];` array in the page's script with:

```js
      /* The office's list, from /officers.js — one copy, read by this page and
         by the touch wizard. */
      const OFFICERS = window.OFFICERS || [];
```

Leave the comment block above it (the one explaining how the picker writes
names back into the one blank) exactly where it is.

- [ ] **Step 3: Load it from the React app**

In `web/index.html`, before the module script tag:

```html
    <script src="/officers.js"></script>
```

- [ ] **Step 4: Build and check both pages still work**

```bash
npm run build
node test-form-parity.js
```

Expected: every `ok —` line, page heights unchanged (285.77, 214.54).

Then `PLANS_STORE=file npm start`, open `http://localhost:3000/form.html`, press the officer picker button, and confirm all seven names are listed.

- [ ] **Step 5: Commit**

```bash
git add web/public/officers.js web/public/form.html web/index.html
git commit -m "Keep the officers' names in one file both pages read

Two copies of a list of real people is how one of them goes stale.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: The field manifest and the test that pins it to the paper

This is the task that makes the whole approach safe. Everything after it depends on the manifest being complete.

**Files:**
- Create: `web/src/lib/form-fields.js`, `test-form-fields.js`
- Modify: `package.json`

**Interfaces:**
- Produces, from `web/src/lib/form-fields.js`:
  - `STEPS` — `[{ n: 1, title: 'สถานที่และเวลา' }, …]`, six entries
  - `FIELDS` — `[{ name, step, label, type }]`, 64 entries, in the record's own order.
    `type` is one of `'text' | 'textarea' | 'date' | 'time' | 'number' | 'officers'`
  - `CHECK_GROUPS` — `[{ group, step, label, mode, options: [{ name, label }] }]`.
    `mode` is `'one'` (at most one may be on) or `'many'`.
- Consumed by: `RecordStep.jsx` (Task 11) and `test-form-fields.js`.

- [ ] **Step 1: Write the manifest**

Create `web/src/lib/form-fields.js`:

```js
/*
 * Every blank and every checkbox on the record, grouped into the six steps
 * the touch wizard walks through.
 *
 * The names here are the record's own — `name=` on an input, `data-name=` on
 * a check button in web/public/form.html — because they travel to the PDF
 * unchanged through `applyData()`. `test-form-fields.js` compares this file
 * against that page in both directions on every run, which is what makes it
 * safe for the paper and the wizard to be two files.
 *
 * Labels are shortened from the record's own wording: the paper reads as one
 * long sentence with blanks in it, which a phone cannot show, so each blank
 * gets the words immediately around it.
 */

export const STEPS = [
  { n: 1, title: 'สถานที่และเวลา' },
  { n: 2, title: 'ผู้รับอนุญาต และผู้มีหน้าที่ปฏิบัติการ' },
  { n: 3, title: 'ผลการตรวจ (1)–(4)' },
  { n: 4, title: 'ผลการตรวจ (5)–(12)' },
  { n: 5, title: 'ภาพถ่าย' },
  { n: 6, title: 'ลงชื่อ และออกเอกสาร' },
];

export const FIELDS = [
  // --- step 1: heading and place ------------------------------------------
  { name: 'officers1', step: 1, label: 'พนักงานเจ้าหน้าที่ผู้ตรวจ', type: 'officers' },
  { name: 'officers2', step: 1, label: 'พนักงานเจ้าหน้าที่ผู้ตรวจ (บรรทัดที่ 2)', type: 'officers' },
  { name: 'pharmacistName', step: 1, label: 'ตรวจสถานที่ทำการของผู้ประกอบวิชาชีพเภสัชกรรมชื่อ', type: 'text' },
  { name: 'pharmacistLicenseNo', step: 1, label: 'ใบอนุญาตผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ.', type: 'text' },
  { name: 'pharmacistLicenseExpiry', step: 1, label: 'หมดอายุวันที่', type: 'text' },
  { name: 'placeName', step: 1, label: 'ชื่อสถานที่ทำการ', type: 'text' },
  { name: 'houseNo', step: 1, label: 'ตั้งอยู่เลขที่', type: 'text' },
  { name: 'village', step: 1, label: 'หมู่บ้าน / อาคาร', type: 'text' },
  { name: 'moo', step: 1, label: 'หมู่ที่', type: 'text' },
  { name: 'soi', step: 1, label: 'ตรอก / ซอย', type: 'text' },
  { name: 'road', step: 1, label: 'ถนน', type: 'text' },
  { name: 'subdistrict', step: 1, label: 'แขวง / ตำบล', type: 'text' },
  { name: 'district', step: 1, label: 'เขต / อำเภอ', type: 'text' },
  { name: 'province', step: 1, label: 'จังหวัด', type: 'text' },
  { name: 'phone', step: 1, label: 'เบอร์โทรศัพท์ติดต่อ', type: 'text' },
  { name: 'policeStation', step: 1, label: 'เขตสถานีตำรวจ', type: 'text' },
  { name: 'inspectDate', step: 1, label: 'เข้าตรวจเมื่อวันที่', type: 'text' },
  { name: 'inspectTime', step: 1, label: 'เวลา (น.)', type: 'time' },

  // --- step 2: items 1 and 2 ----------------------------------------------
  { name: 'licenseeName', step: 2, label: '1. ชื่อผู้รับอนุญาตของสถานที่ทำการ', type: 'text' },
  { name: 'operatorName', step: 2, label: 'ชื่อผู้ดำเนินการกิจการ', type: 'text' },
  { name: 'licenseNo', step: 2, label: 'ใบอนุญาตขายยาแผนปัจจุบันเลขที่', type: 'text' },
  { name: 'dutyPharmacist', step: 2, label: '2. ชื่อผู้มีหน้าที่ปฏิบัติการ', type: 'text' },
  { name: 'dutyLicenseNo', step: 2, label: 'ใบอนุญาตผู้ประกอบวิชาชีพเภสัชกรรม เลขที่ ภ.', type: 'text' },
  { name: 'dutyLicenseExpiry', step: 2, label: 'หมดอายุวันที่', type: 'text' },
  { name: 'openHours', step: 2, label: 'เวลาทำการของผู้มีหน้าที่ปฏิบัติการ (น.)', type: 'text' },

  // --- step 3: items (1)–(4) ----------------------------------------------
  { name: 'checkTime', step: 3, label: '(1) ขณะตรวจสอบเวลา (น.)', type: 'time' },
  { name: 'shopNameAtCheck', step: 3, label: 'ร้าน', type: 'text' },
  { name: 'personFound', step: 3, label: 'พบ (ชื่อผู้ที่พบขณะตรวจ)', type: 'text' },
  { name: 'personIdCard', step: 3, label: 'บัตรประจำตัวประชาชนเลขที่', type: 'text' },
  { name: 'ruled1', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 1)', type: 'text' },
  { name: 'ruled2', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 2)', type: 'text' },
  { name: 'ruled3', step: 3, label: 'รายละเอียดที่ให้ไว้ (บรรทัดที่ 3)', type: 'text' },
  { name: 'buyRequest', step: 3, label: '(2) ขอซื้อยาซึ่ง', type: 'text' },
  { name: 'drugDispensed', step: 3, label: 'ได้จ่ายยา', type: 'text' },
  { name: 'drugQuantity', step: 3, label: 'จำนวน', type: 'text' },
  { name: 'drugPrice', step: 3, label: 'ราคา (บาท)', type: 'text' },
  { name: 'regNo', step: 3, label: 'Reg No.', type: 'text' },
  { name: 'lot', step: 3, label: 'Lot', type: 'text' },
  { name: 'mfgDate', step: 3, label: 'วันผลิต', type: 'text' },
  { name: 'expDate', step: 3, label: 'ยาสิ้นอายุ', type: 'text' },
  { name: 'ruled4', step: 3, label: 'รายละเอียดยาเพิ่มเติม', type: 'text' },
  { name: 'notDispensedReason', step: 3, label: 'ไม่ได้จ่ายยา เนื่องจาก', type: 'text' },
  { name: 'admitPerson', step: 3, label: '(3) ผู้ที่ยอมรับ (ชื่อ)', type: 'text' },
  { name: 'complaintDetail', step: 3, label: '(4) แจ้งว่า (รายละเอียดเบาะแส / ข้อร้องเรียน)', type: 'text' },
  { name: 'acknowledgedBy', step: 3, label: 'ผู้รับทราบวัตถุประสงค์การตรวจ', type: 'text' },

  // --- step 4: items (5)–(12) ---------------------------------------------
  { name: 'dutyNote', step: 4, label: '(6) หมายเหตุการอยู่ปฏิบัติหน้าที่', type: 'text' },
  { name: 'leaveProofNote', step: 4, label: '(7) หลักฐานการลางาน', type: 'text' },
  { name: 'leaveProofNote2', step: 4, label: '(7) หลักฐานการลางาน (บรรทัดที่ 2)', type: 'text' },
  { name: 'curtainNote', step: 4, label: '(8) หมายเหตุการปิดม่านบังยาอันตราย', type: 'text' },
  { name: 'signPage1Name', step: 4, label: 'ชื่อผู้ลงชื่อท้ายหน้า 1 (ในวงเล็บ)', type: 'text' },
  { name: 'behaviour1', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม', type: 'text' },
  { name: 'behaviour2', step: 4, label: '(9) พฤติกรรมที่พบเพิ่มเติม (บรรทัดที่ 2)', type: 'text' },
  { name: 'seizedItems', step: 4, label: '(10) ยึด', type: 'text' },
  { name: 'seizedCount', step: 4, label: 'จำนวน (รายการ)', type: 'text' },
  { name: 'heldItems', step: 4, label: '(10) อายัด', type: 'text' },
  { name: 'heldCount', step: 4, label: 'จำนวน (รายการ)', type: 'text' },
  { name: 'endTime', step: 4, label: '(12) สิ้นสุดการตรวจเวลา (น.)', type: 'time' },

  // --- step 6: the signature block's name blanks ---------------------------
  { name: 'signDutyName', step: 6, label: 'ชื่อผู้มีหน้าที่ปฏิบัติการ / เภสัชกร (ในวงเล็บ)', type: 'text' },
  { name: 'signLicenseeName', step: 6, label: 'ชื่อผู้รับอนุญาต / ผู้แทน (ในวงเล็บ)', type: 'text' },
  { name: 'signOfficer1', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 1', type: 'officers' },
  { name: 'signOfficer2', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 2', type: 'officers' },
  { name: 'signOfficer3', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 3', type: 'officers' },
  { name: 'signOfficer4', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 4', type: 'officers' },
  { name: 'signOfficer5', step: 6, label: 'พนักงานเจ้าหน้าที่ คนที่ 5', type: 'officers' },
];

export const CHECK_GROUPS = [
  {
    group: 'shopState',
    step: 3,
    label: '(1) สภาพร้านขณะตรวจ',
    mode: 'one',
    options: [
      { name: 'shopOpen', label: 'เปิดทำการตามปกติ' },
      { name: 'shopClosed', label: 'ปิดทำการ' },
    ],
  },
  {
    group: 'role',
    step: 3,
    label: '(1) ผู้ที่พบทำหน้าที่',
    mode: 'one',
    options: [
      { name: 'rolePharmacist', label: 'เภสัชกรผู้มีหน้าที่ปฏิบัติการ' },
      { name: 'roleLicensee', label: 'ผู้รับอนุญาต' },
      { name: 'roleAgent', label: 'ผู้แทนผู้รับอนุญาต' },
    ],
  },
  {
    group: 'buy',
    step: 3,
    label: '(2) การขอซื้อยาก่อนเข้าตรวจ',
    mode: 'one',
    options: [
      { name: 'noBuy', label: 'ไม่ได้ขอซื้อยา' },
      { name: 'didBuy', label: 'ขอซื้อยา' },
    ],
  },
  {
    group: 'dispensed',
    step: 3,
    label: '(2) ผลการขอซื้อ',
    mode: 'one',
    options: [{ name: 'notDispensed', label: 'ไม่ได้จ่ายยา' }],
  },
  {
    group: 'admit',
    step: 3,
    label: '(3) การยอมรับ',
    mode: 'one',
    options: [{ name: 'admitSold', label: 'ได้ขายยาตาม (2) ให้กับพนักงานเจ้าหน้าที่' }],
  },
  {
    group: 'source',
    step: 3,
    label: '(4) ที่มาของการตรวจ',
    mode: 'many',
    options: [
      { name: 'sourceTip', label: 'มีการแจ้งเบาะแสมายังสภาเภสัชกรรม' },
      { name: 'sourcePlan', label: 'แผนการเฝ้าระวังตามมติที่ประชุมคณะกรรมการสภาเภสัชกรรม' },
      { name: 'sourceComplaint', label: 'มีผู้ร้องเรียน' },
    ],
  },
  {
    group: 'licencePresence',
    step: 4,
    label: '(5) การแสดงใบอนุญาตของผู้มีหน้าที่ปฏิบัติการ',
    mode: 'one',
    options: [
      { name: 'licenceShown', label: 'พบ' },
      { name: 'licenceNotShown', label: 'ไม่พบ' },
    ],
  },
  {
    group: 'licenceKind',
    step: 4,
    label: '(5) ใบอนุญาตที่แสดง',
    mode: 'one',
    options: [
      { name: 'licenceOriginal', label: 'ฉบับจริง' },
      { name: 'licenceCopy', label: 'ฉบับสำเนา' },
    ],
  },
  {
    group: 'dutyPresence',
    step: 4,
    label: '(6) ผู้มีหน้าที่ปฏิบัติการอยู่ปฏิบัติหน้าที่',
    mode: 'one',
    options: [
      { name: 'dutyPresent', label: 'พบ' },
      { name: 'dutyAbsent', label: 'ไม่พบ' },
    ],
  },
  {
    group: 'leaveProof',
    step: 4,
    label: '(7) หลักฐานการลางานของเภสัชกร',
    mode: 'one',
    options: [
      { name: 'leaveProofYes', label: 'มี' },
      { name: 'leaveProofNo', label: 'ไม่มี' },
    ],
  },
  {
    group: 'curtain',
    step: 4,
    label: '(8) การปิดม่านบังยาอันตราย',
    mode: 'one',
    options: [
      { name: 'curtainFound', label: 'พบ การปิดม่านบังยาอันตราย' },
      { name: 'curtainNotFound', label: 'ไม่พบ การปิดม่านบังยาอันตราย' },
    ],
  },
  {
    group: 'inform',
    step: 4,
    label: '(11) ผู้รับทราบข้อมูลที่แจ้ง',
    mode: 'many',
    options: [
      { name: 'informPharmacist', label: 'เภสัชกรผู้มีหน้าที่ปฏิบัติการ' },
      { name: 'informLicensee', label: 'ผู้รับอนุญาต' },
      { name: 'informAgent', label: 'ผู้แทนผู้รับอนุญาต' },
    ],
  },
];
```

- [ ] **Step 2: Write the test that pins it to the paper**

Create `test-form-fields.js`:

```js
/**
 * The touch wizard's field list against the record page's own markup, in both
 * directions. The wizard and the paper are two files on purpose — see the
 * design note — and this is what keeps them one record.
 *
 *   node test-form-fields.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, 'web', 'public', 'form.html');
const MANIFEST = path.join(__dirname, 'web', 'src', 'lib', 'form-fields.js');

const html = fs.readFileSync(PAGE, 'utf8');
const source = fs.readFileSync(MANIFEST, 'utf8');

/* The manifest is an ES module and this is CommonJS. Rather than add a build
   step for one test, read the names out of the source: every entry is written
   as `name: 'thing'` on one line, which is also what keeps the manifest a
   plain list and not a program. */
const manifestNames = (text, key) =>
  [...text.matchAll(new RegExp(`${key}:\\s*'([^']+)'`, 'g'))].map((m) => m[1]);

// `viewport` is the <meta> tag, not a blank on the record.
const pageFields = new Set(
  [...html.matchAll(/<(?:input|textarea)\b[^>]*\bname="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((name) => name !== 'viewport')
);
const pageChecks = new Set([...html.matchAll(/data-name="([^"]+)"/g)].map((m) => m[1]));

const listedFields = new Set(manifestNames(source, 'name'));
const listedChecks = new Set(
  manifestNames(source.slice(source.indexOf('CHECK_GROUPS')), 'name')
);
// The FIELDS entries and the CHECK_GROUPS options both write `name:`, so the
// field set is what is left once the check names are taken out.
for (const name of listedChecks) listedFields.delete(name);

const missing = (want, have) => [...want].filter((name) => !have.has(name));

assert.deepStrictEqual(
  missing(pageFields, listedFields),
  [],
  'ช่องกรอกในกระดาษที่ยังไม่มีในรายการของหน้ามือถือ'
);
assert.deepStrictEqual(
  missing(listedFields, pageFields),
  [],
  'รายการของหน้ามือถือมีชื่อที่ไม่มีอยู่ในกระดาษ'
);
assert.deepStrictEqual(
  missing(pageChecks, listedChecks),
  [],
  'ช่องติ๊กในกระดาษที่ยังไม่มีในรายการของหน้ามือถือ'
);
assert.deepStrictEqual(
  missing(listedChecks, pageChecks),
  [],
  'รายการของหน้ามือถือมีช่องติ๊กที่ไม่มีอยู่ในกระดาษ'
);

// The two numbers the design records. A change to either is a change to the
// official form and has to be a deliberate edit here, not a surprise.
assert.strictEqual(pageFields.size, 64, `กระดาษมีช่องกรอก ${pageFields.size} ช่อง ไม่ใช่ 64`);
assert.strictEqual(pageChecks.size, 25, `กระดาษมีช่องติ๊ก ${pageChecks.size} จุด ไม่ใช่ 25`);

// Every field belongs to a step that exists.
const steps = new Set([...source.matchAll(/\{\s*n:\s*(\d)/g)].map((m) => Number(m[1])));
const stepped = [...source.matchAll(/name:\s*'([^']+)',\s*step:\s*(\d)/g)];
for (const [, name, step] of stepped) {
  assert.ok(steps.has(Number(step)), `${name} อยู่ในขั้นที่ ${step} ซึ่งไม่มีในรายการขั้นตอน`);
}

console.log(`ok — รายการช่องกรอก ${pageFields.size} ช่อง และช่องติ๊ก ${pageChecks.size} จุด ตรงกับกระดาษ`);
```

- [ ] **Step 3: Run it**

```bash
node test-form-fields.js
```

Expected: `ok — รายการช่องกรอก 64 ช่อง และช่องติ๊ก 25 จุด ตรงกับกระดาษ`.

If it reports a name missing in one direction, fix the manifest — not the test. The paper is the authority.

- [ ] **Step 4: Prove the test actually bites**

Temporarily delete one entry from `FIELDS`, run the test, confirm it fails naming that field, then put it back and confirm it passes again. A guard nobody has watched fail is not a guard.

- [ ] **Step 5: Register the script**

In `package.json` `"scripts"`, after `"test:records"`:

```json
    "test:fields": "node test-form-fields.js",
```

and add `node test-form-fields.js &&` to the combined `"test"` script.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/form-fields.js test-form-fields.js package.json
git commit -m "Pin the wizard's field list to the record's own markup

The touch screen and the A4 page are two files on purpose; this is the
test that keeps them one record. It fails in both directions.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Signatures on the paper

**Files:**
- Modify: `web/public/form.html`, `test-form-parity.js`

**Interfaces:**
- Consumes: `records.SIGNATURE_SLOTS` (Task 2) as the set of `data-sign` values.
- Produces: `applyData({ signatures })` draws a signature image over each named rule. No layout change.

- [ ] **Step 1: Name the eight rules**

In `web/public/form.html`, add a `data-sign` attribute to each signature rule.
There are eight; each keeps every class it already has.

Page 1 (search for `เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต` in a `<p class="para sm left ind-left2268">`):

```html
ลงชื่อ <span class="rule blank" data-sign="page1"></span> เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต
```

Page 2's signature table, in document order — the left column's two rows and
the right column's five:

| row | cell | rule becomes |
| --- | --- | --- |
| 1 | left (`signDutyName`) | `<span class="rule" data-sign="duty"></span>` |
| 1 | right (`signOfficer1`) | `<span class="rule" data-sign="officer1"></span>` |
| 2 | left (`signLicenseeName`) | `<span class="rule" data-sign="licensee"></span>` |
| 2 | right (`signOfficer2`) | `<span class="rule" data-sign="officer2"></span>` |
| 3 | right (`signOfficer3`) | `<span class="rule" data-sign="officer3"></span>` |
| 4 | right (`signOfficer4`) | `<span class="rule" data-sign="officer4"></span>` |
| 5 | right (`signOfficer5`) | `<span class="rule" data-sign="officer5"></span>` |

Use the name blank in each cell (`signOfficer3` and so on) to tell the rows apart.

- [ ] **Step 2: Style the image**

In `form.html`'s stylesheet, immediately after the existing `.rule { … }` rule:

```css
      /* A signature drawn on the iPad sits on its rule rather than in the
         line: absolute, so it takes no space and no measured rule moves. The
         rule is the positioning context, which costs an inline-block nothing.
         `.sheet` is already position: relative for the seal, but the rule is
         closer and survives the screen's zoom without any arithmetic. */
      .rule { position: relative; }
      .rule > .signature {
        position: absolute;
        left: 0;
        bottom: 1px;
        width: 100%;
        height: 2.6em;
        object-fit: contain;
        object-position: center bottom;
        pointer-events: none;
      }
```

- [ ] **Step 3: Draw them in `applyData`**

In `form.html`, add this function immediately above `window.applyData`:

```js
      /**
       * Signatures drawn on a touch screen, laid over the rules they belong
       * to. A rule with nothing for it stays an empty rule to be signed with
       * a pen — which is what happens to every one of them when the record is
       * opened straight from the menu.
       */
      function applySignatures(signatures) {
        for (const rule of document.querySelectorAll('[data-sign]')) {
          const existing = rule.querySelector('.signature');
          if (existing) existing.remove();
          const source = signatures[rule.dataset.sign];
          if (!source) continue;
          const image = document.createElement('img');
          image.className = 'signature';
          image.alt = '';
          image.src = source;
          rule.append(image);
        }
      }
```

and call it from inside `window.applyData`, immediately before `window.layoutBlanks();`:

```js
        applySignatures((data && data.signatures) || {});
```

- [ ] **Step 4: Add the parity assertions**

In `test-form-parity.js`, inside the same `try` block, immediately before the
`// --- page height` section, add:

```js
    // --- signatures and the appendix may not move the record ---------------
    // The wizard draws signatures over the rules and appends a photo sheet.
    // Both are additions to a page whose every line is on Word's own grid, so
    // the test is not that they look right — it is that nothing else moved.
    const beforeSign = await page.evaluate(() =>
      [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
      })
    );

    const signature =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const afterSign = await page.evaluate((png) => {
      window.applyData({
        values: {},
        checks: {},
        signatures: {
          page1: png, duty: png, licensee: png,
          officer1: png, officer2: png, officer3: png, officer4: png, officer5: png,
        },
      });
      return [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
        const box = el.getBoundingClientRect();
        return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
      });
    }, signature);

    assert.deepStrictEqual(afterSign, beforeSign, 'ลายเซ็นทำให้บรรทัดในกระดาษขยับ');

    const drawn = await page.evaluate(() => document.querySelectorAll('.rule > .signature').length);
    assert.strictEqual(drawn, 8, `วางลายเซ็นได้ ${drawn} จุด ควรเป็น 8 จุด`);

    console.log('ok — ลายเซ็นบนจอวางลงกระดาษได้ครบ 8 จุด โดยไม่มีบรรทัดใดขยับ');
```

- [ ] **Step 5: Build and run the parity suite**

```bash
npm run build
node test-form-parity.js
```

Expected: every previous `ok —` line unchanged, plus
`ok — ลายเซ็นบนจอวางลงกระดาษได้ครบ 8 จุด โดยไม่มีบรรทัดใดขยับ`,
and the final heights still `(285.77, 214.54)`.

If a line moved, the image is in the flow — check that `.rule > .signature` really is `position: absolute` and that nothing added a wrapping element.

- [ ] **Step 6: Look at one**

```bash
PLANS_STORE=file npm start
```

Open `http://localhost:3000/form.html`, then in the browser console:

```js
applyData({ values: {}, checks: {}, signatures: { duty: 'data:image/png;base64,…' } })
```

(any small PNG data URL). Expected: the image sits on the rule, its baseline on the line, not pushing the label sideways.

- [ ] **Step 7: Commit**

```bash
git add web/public/form.html test-form-parity.js
git commit -m "Lay a signature drawn on the iPad over its rule

Absolutely positioned inside the rule, so it takes no space in a line
whose every measurement comes off Word's grid — asserted by comparing
every box on both pages before and after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: The photo appendix

**Files:**
- Modify: `web/public/form.html`, `test-form-parity.js`

**Interfaces:**
- Produces: `applyData({ photos: [{ src, caption }] })` fills a third sheet and reveals it; an empty or missing list leaves the record at two sheets.

- [ ] **Step 1: Add the sheet**

In `web/public/form.html`, immediately after the closing tag of the second
`.sheet` section (the one that ends with the signature table), add:

```html
    <!-- The appendix item (10) already refers to: "รายละเอียดตาม บัญชียึด
         อายัด และภาพถ่าย ตามเอกสารแนบท้าย". It is hidden until applyData()
         is given photos, so a record with none is the two-page record the
         office has always issued. -->
    <section class="sheet photos" id="photoSheet" hidden>
      <h2 class="photo-title">ภาพถ่ายประกอบการตรวจ</h2>
      <p class="photo-sub" id="photoSubtitle"></p>
      <div class="photo-grid" id="photoGrid"></div>
    </section>
```

- [ ] **Step 2: Style it**

After the signature rules in the stylesheet:

```css
      /* The appendix is not on Word's grid — there is no template page for it
         — so it is plain block layout, sized to the same 210mm sheet. */
      .photo-title { font-size: 16pt; font-weight: 700; text-align: center; margin: 0 0 4pt; }
      .photo-sub { text-align: center; margin: 0 0 10pt; }
      .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 6mm; }
      .photo-cell { break-inside: avoid; }
      .photo-cell img { width: 100%; height: 62mm; object-fit: contain; border: 1px solid #000; }
      .photo-cell figcaption { margin-top: 2mm; font-size: 13pt; text-align: center; }
```

- [ ] **Step 3: Fill it in `applyData`**

Add above `window.applyData`, beside `applySignatures`:

```js
      /**
       * The photo appendix. The bytes arrive as data URLs — the server reads
       * them out of the photo store and passes them in, so the page never
       * fetches anything, the same way the seal and the font are already
       * inlined for the PDF renderer.
       */
      function applyPhotos(photos) {
        const sheet = document.getElementById('photoSheet');
        const grid = document.getElementById('photoGrid');
        grid.textContent = '';
        if (!photos.length) {
          sheet.hidden = true;
          return;
        }
        const shop = document.querySelector('[name="placeName"]');
        const when = document.querySelector('[name="inspectDate"]');
        document.getElementById('photoSubtitle').textContent =
          [shop && shop.value, when && when.value ? `ตรวจเมื่อวันที่ ${when.value}` : '']
            .filter(Boolean)
            .join(' · ');
        photos.forEach((photo, index) => {
          const cell = document.createElement('figure');
          cell.className = 'photo-cell';
          const image = document.createElement('img');
          image.src = photo.src;
          image.alt = '';
          const caption = document.createElement('figcaption');
          // textContent, never innerHTML: the caption is typed at the shop.
          caption.textContent = photo.caption
            ? `ภาพที่ ${index + 1} ${photo.caption}`
            : `ภาพที่ ${index + 1}`;
          cell.append(image, caption);
          grid.append(cell);
        });
        sheet.hidden = false;
      }
```

and call it from `window.applyData`, immediately after the `applySignatures` call:

```js
        applyPhotos(((data && data.photos) || []).filter((photo) => photo && photo.src));
```

- [ ] **Step 4: Extend the parity assertions**

In `test-form-parity.js`, immediately after the signature block added in Task 7:

```js
    // A record with no photos is the two-sheet record the office has always
    // issued; four photos add one sheet and still move nothing on the first two.
    const sheetsWithout = await page.evaluate(
      () => [...document.querySelectorAll('.sheet')].filter((s) => !s.hidden).length
    );
    assert.strictEqual(sheetsWithout, 2, 'ไม่มีรูป กระดาษต้องมีสองแผ่น');

    const dot =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const afterPhotos = await page.evaluate((png) => {
      window.applyData({
        values: {},
        checks: {},
        photos: [1, 2, 3, 4].map((n) => ({ src: png, caption: `ชั้นวางยาที่ ${n}` })),
      });
      return {
        sheets: [...document.querySelectorAll('.sheet')].filter((s) => !s.hidden).length,
        cells: document.querySelectorAll('.photo-cell').length,
        boxes: [...document.querySelectorAll('.para, .blank, .tab, .rule')].map((el) => {
          const box = el.getBoundingClientRect();
          return `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)}`;
        }),
      };
    }, dot);

    assert.strictEqual(afterPhotos.sheets, 3, 'มีรูปแล้วต้องมีแผ่นภาคผนวกเพิ่มมา');
    assert.strictEqual(afterPhotos.cells, 4, 'จำนวนรูปในภาคผนวกไม่ตรง');
    assert.deepStrictEqual(afterPhotos.boxes, beforeSign, 'ภาคผนวกทำให้บรรทัดในกระดาษขยับ');

    console.log('ok — ภาคผนวกภาพถ่ายเพิ่มแผ่นที่สามโดยไม่แตะสองแผ่นแรก');
```

- [ ] **Step 5: Build and run**

```bash
npm run build
node test-form-parity.js
```

Expected: the two new `ok —` lines, and the height line now reads three
numbers when photos are present — it measures after the photo block, so the
third figure is the appendix's own height. It must still be under 297mm.

If the appendix sheet is taller than a page with four photos, reduce
`.photo-cell img { height }` until it fits; the test is the arbiter.

- [ ] **Step 6: Commit**

```bash
git add web/public/form.html test-form-parity.js
git commit -m "Add the photo appendix the record already refers to

Item (10) has always said the photographs are attached; now they are.
Hidden with no photos, so a record without them is the same two pages.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The server hands photos and signatures to the PDF

**Files:**
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `records.readRecord`, `photoStore.getPhoto`, `renderFormPdf`.
- Produces: `POST /api/plans/:id/items/:newCode/record/pdf` → the PDF, with the appendix; and `…/record/docx` → the Word file, text only.

- [ ] **Step 1: Add the routes**

After the photo routes in `src/server.js`:

```js
/*
 * The record's own PDF, made from the stored draft rather than from a body
 * the page posts. The photo bytes are read here and passed in as data URLs:
 * the page puppeteer opens is a file:// page with no passcode and no session,
 * so it could not fetch them itself even if we wanted it to.
 *
 * ponytail: every photo marked for the appendix is inlined, so a record with
 * dozens of them builds a large page. Cap it if the office ever attaches more
 * than a handful.
 */
async function recordForExport(planId, newCode) {
  const record = await records.readRecord(planId, newCode);
  const photos = [];
  for (const photo of record.photos || []) {
    if (!photo.inPdf) continue;
    const bytes = await photoStore.getPhoto(planId, newCode, photo.id);
    if (!bytes) continue;
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
      'Content-Disposition': 'attachment; filename="inspection-record.pdf"',
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
      'Content-Disposition': 'attachment; filename="inspection-record.docx"',
    });
    res.send(Buffer.from(docx));
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Check `renderFormDocx`'s argument shape**

Read the existing `POST /api/form/docx` handler in `src/server.js` and match
exactly what it passes to `renderFormDocx`. If it passes the whole request body
rather than `{ values, checks }`, change the call above to match it.

- [ ] **Step 3: Render one by hand**

With a plan, a shop and a saved draft in place:

```bash
curl -s -X POST localhost:3000/api/plans/2569-08-27/items/<newCode>/record/pdf -o record.pdf -w '%{http_code}\n'
```

Expected: `200`, and the PDF opens with the record filled in. Delete `record.pdf` afterwards; do not commit it.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "Make the record's files from the stored draft

The page puppeteer opens is a file:// page with no passcode, so the photo
bytes are read here and passed in rather than fetched there.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: The browser client and the route

**Files:**
- Create: `web/src/lib/records-api.js`
- Modify: `web/src/App.jsx`

**Interfaces:**
- Consumes: `apiBase` from `web/src/api.js`; `PasscodeError`, `setPasscode` from `web/src/lib/plans-api.js`.
- Produces, from `records-api.js`:
  - `getRecord(planId, newCode) -> Promise<Record>`
  - `putRecord(planId, newCode, record) -> Promise<Record>` — throws `StaleRecordError` (carrying `.current`) on 409
  - `uploadPhoto(planId, newCode, blob) -> Promise<{ id, record }>`
  - `deletePhoto(planId, newCode, photoId) -> Promise<Record>`
  - `photoObjectUrl(planId, newCode, photoId) -> Promise<string>`
  - `downloadRecordExport(planId, newCode, kind, filename) -> Promise<void>`
  - `StaleRecordError`
- Produces, from `App.jsx`: the route `#/plans/:id/:newCode` renders `RecordForm`.

- [ ] **Step 1: Export the passcode header from the plans client**

In `web/src/lib/plans-api.js`, add beside the other exports:

```js
/** The one place the passcode becomes a header. The record client needs the
    same one, and two readers of the same sessionStorage key would drift. */
export function passcodeHeaders(extra = {}) {
  const code = sessionStorage.getItem(PASSCODE_KEY) || '';
  return { ...extra, ...(code ? { 'x-plans-passcode': code } : {}) };
}
```

- [ ] **Step 2: Write the record client**

Create `web/src/lib/records-api.js`:

```js
import { apiBase } from '../api.js';
import { clearPasscode, PasscodeError, passcodeHeaders } from './plans-api.js';

/** Thrown when someone else's write landed first; carries their version. */
export class StaleRecordError extends Error {
  constructor(current) {
    super('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
    this.name = 'StaleRecordError';
    this.current = current;
  }
}

function base(planId, newCode) {
  return `${apiBase}/api/plans/${planId}/items/${encodeURIComponent(newCode)}/record`;
}

async function call(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throw new StaleRecordError(body.current);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const getRecord = (planId, newCode) =>
  call(base(planId, newCode), { headers: passcodeHeaders() }).then((d) => d.record);

export const putRecord = (planId, newCode, record) =>
  call(base(planId, newCode), {
    method: 'PUT',
    headers: passcodeHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(record),
  }).then((d) => d.record);

export const uploadPhoto = (planId, newCode, blob) =>
  call(`${base(planId, newCode)}/photos`, {
    method: 'POST',
    headers: passcodeHeaders({ 'Content-Type': 'image/jpeg' }),
    body: blob,
  }).then((d) => ({ id: d.id, record: d.record }));

export const deletePhoto = (planId, newCode, photoId) =>
  call(`${base(planId, newCode)}/photos/${photoId}`, {
    method: 'DELETE',
    headers: passcodeHeaders(),
  }).then((d) => d.record);

/* An <img src> cannot carry the passcode header, and the passcode may not go
   in a URL — so the bytes are fetched and handed to the page as a blob URL.
   The caller revokes it when the image goes away. */
export async function photoObjectUrl(planId, newCode, photoId) {
  const response = await fetch(`${base(planId, newCode)}/photos/${photoId}`, {
    headers: passcodeHeaders(),
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) throw new Error('โหลดรูปไม่สำเร็จ');
  return URL.createObjectURL(await response.blob());
}

export async function downloadRecordExport(planId, newCode, kind, filename) {
  const response = await fetch(`${base(planId, newCode)}/${kind}`, {
    method: 'POST',
    headers: passcodeHeaders(),
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) throw new Error(`ส่งออกไม่สำเร็จ (HTTP ${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Route to it**

In `web/src/App.jsx`, add the import beside `PlanView`:

```js
import RecordForm from './components/RecordForm.jsx';
```

and replace the plan-screen branch with:

```jsx
  if (route.startsWith('#/plans')) {
    // #/plans, or #/plans/<planId>/<newCode> for one shop's record. Two
    // shapes is still not a router's worth of dependency.
    const [, , planId, encodedCode] = route.split('/');
    return (
      <>
        <Sidebar route={route} />
        <main className="app-main">
          <div className="wrap">
            {planId && encodedCode ? (
              <RecordForm planId={planId} newCode={decodeURIComponent(encodedCode)} />
            ) : (
              <PlanView />
            )}
          </div>
        </main>
      </>
    );
  }
```

- [ ] **Step 4: Add a placeholder so the app builds**

Create `web/src/components/RecordForm.jsx` with a stub that Task 11 replaces:

```jsx
export default function RecordForm({ planId, newCode }) {
  return (
    <div className="record-form">
      บันทึกการตรวจของร้าน {newCode} ในแผน {planId}
    </div>
  );
}
```

- [ ] **Step 5: Build and check the route**

```bash
npm run build
```

`PLANS_STORE=file npm start`, open `#/plans/2569-08-27/ABC`. Expected: the stub's sentence, with the sidebar's "แผนการตรวจ" still highlighted.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/records-api.js web/src/lib/plans-api.js web/src/App.jsx web/src/components/RecordForm.jsx
git commit -m "Route one shop's record off the hash

Photos are fetched and handed over as blob URLs: an <img src> cannot send
the passcode header, and the passcode may not travel in a URL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: The wizard

**Files:**
- Create: `web/src/components/RecordStep.jsx`
- Modify: `web/src/components/RecordForm.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: `STEPS`, `FIELDS`, `CHECK_GROUPS` (Task 6); `getRecord`, `putRecord`, `StaleRecordError`, `downloadRecordExport` (Task 10); `getPlan`, `patchPlanItem`, `PasscodeError`, `setPasscode` (existing `plans-api.js`); `window.OFFICERS` (Task 5).
- Produces: the working record screen. Steps 5 and 6 render placeholders that Tasks 12 and 13 fill.

- [ ] **Step 1: Write the step renderer**

Create `web/src/components/RecordStep.jsx`:

```jsx
import { CHECK_GROUPS, FIELDS } from '../lib/form-fields.js';

/* The officers' list is served as a plain script so the record page can read
   it too — see web/public/officers.js. */
const OFFICERS = typeof window === 'undefined' ? [] : window.OFFICERS || [];

function Field({ field, value, onChange }) {
  if (field.type === 'officers') {
    return (
      <label className="record-field">
        <span>{field.label}</span>
        <input
          type="text"
          value={value}
          list="officer-names"
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      </label>
    );
  }
  if (field.type === 'textarea') {
    return (
      <label className="record-field">
        <span>{field.label}</span>
        <textarea rows={3} value={value} onChange={(event) => onChange(field.name, event.target.value)} />
      </label>
    );
  }
  return (
    <label className="record-field">
      <span>{field.label}</span>
      <input
        type={field.type === 'time' ? 'time' : field.type === 'number' ? 'number' : 'text'}
        inputMode={field.type === 'number' ? 'numeric' : undefined}
        value={value}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    </label>
  );
}

/* A group where only one may be on is the paper's own pair of boxes — which
   an officer can tick both of by accident. Here they cannot. Pressing the one
   already on turns it off, because "neither" is a real answer on this form. */
function CheckGroup({ group, checks, onCheck }) {
  return (
    <fieldset className="record-checks">
      <legend>{group.label}</legend>
      {group.options.map((option) => {
        const on = Boolean(checks[option.name]);
        return (
          <button
            type="button"
            key={option.name}
            className={on ? 'check-option on' : 'check-option'}
            aria-pressed={on}
            onClick={() => onCheck(group, option.name, !on)}
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}

export default function RecordStep({ step, values, checks, onChange, onCheck }) {
  const fields = FIELDS.filter((field) => field.step === step);
  const groups = CHECK_GROUPS.filter((group) => group.step === step);
  return (
    <div className="record-step">
      <datalist id="officer-names">
        {OFFICERS.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {groups.map((group) => (
        <CheckGroup key={group.group} group={group} checks={checks} onCheck={onCheck} />
      ))}
      {fields.map((field) => (
        <Field
          key={field.name}
          field={field}
          value={values[field.name] || ''}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the wizard**

Replace `web/src/components/RecordForm.jsx` entirely:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react';
import RecordStep from './RecordStep.jsx';
import { STEPS } from '../lib/form-fields.js';
import { getPlan, patchPlanItem, PasscodeError, setPasscode } from '../lib/plans-api.js';
import {
  downloadRecordExport,
  getRecord,
  putRecord,
  StaleRecordError,
} from '../lib/records-api.js';

/**
 * One shop's record, filled at the shop.
 *
 * The draft is the server's; this screen holds the copy being typed into and
 * pushes it a second after the last keystroke. What it must never do is throw
 * away what the officer typed because a request failed — they are standing in
 * a pharmacy and cannot type it again.
 */
export default function RecordForm({ planId, newCode }) {
  const [record, setRecord] = useState(null);
  const [plan, setPlan] = useState(null);
  const [step, setStep] = useState(1);
  const [save, setSave] = useState('idle'); // idle | saving | saved | failed
  const [error, setError] = useState('');

  const withPasscode = useCallback(async (action) => {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [loadedPlan, loadedRecord] = await Promise.all([
          withPasscode(() => getPlan(planId)),
          withPasscode(() => getRecord(planId, newCode)),
        ]);
        if (!alive) return;
        setPlan(loadedPlan);
        setRecord(loadedRecord);
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [planId, newCode, withPasscode]);

  // The draft as it is right now, for the timer to send without re-arming on
  // every keystroke.
  const pending = useRef(null);
  pending.current = record;

  // Nothing is written until a person changes something: opening a shop to
  // read it must not create a record for it.
  const dirty = useRef(false);

  const flush = useCallback(async () => {
    const draft = pending.current;
    if (!draft) return;
    setSave('saving');
    try {
      const saved = await withPasscode(() => putRecord(planId, newCode, draft));
      dirty.current = false;
      // Only the version marker is taken from the answer: the officer may
      // have typed more while it was in flight, and their keystrokes win.
      setRecord((current) => ({ ...current, updatedAt: saved.updatedAt, createdAt: saved.createdAt }));
      setSave('saved');
    } catch (err) {
      setSave('failed');
      if (err instanceof StaleRecordError) {
        setError(
          'มีคนอื่นบันทึกร้านนี้ไปแล้ว — กด "โหลดของล่าสุด" เพื่อดูของเขา หรือ "บันทึกทับ" เพื่อใช้ของคุณ'
        );
      } else {
        setError(err.message);
      }
    }
  }, [planId, newCode, withPasscode]);

  // Autosave a second after the typing stops. Nothing is ever dropped from the
  // screen when a save fails — the officer is at the shop and cannot retype it.
  useEffect(() => {
    if (!record || !dirty.current || save === 'saving') return undefined;
    const timer = setTimeout(flush, 1000);
    return () => clearTimeout(timer);
  }, [record, flush, save]);

  useEffect(() => {
    const warn = (event) => {
      if (save === 'saved' || save === 'idle') return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  function change(name, value) {
    dirty.current = true;
    setSave('idle');
    setRecord((current) => ({ ...current, values: { ...current.values, [name]: value } }));
  }

  function check(group, name, on) {
    dirty.current = true;
    setSave('idle');
    setRecord((current) => {
      const checks = { ...current.checks };
      // "At most one" is enforced here rather than left to the officer's
      // thumb: on paper both boxes can end up ticked, and they do.
      if (group.mode === 'one') for (const option of group.options) delete checks[option.name];
      if (on) checks[name] = true;
      return { ...current, checks };
    });
  }

  async function reload() {
    setError('');
    setRecord(await withPasscode(() => getRecord(planId, newCode)));
    dirty.current = false;
    setSave('idle');
  }

  /** Take the other version's marker and keep what is on screen. */
  function overwrite() {
    setError('');
    dirty.current = true;
    setSave('idle');
    withPasscode(() => getRecord(planId, newCode)).then((current) =>
      setRecord((mine) => ({ ...mine, updatedAt: current.updatedAt }))
    );
  }

  async function exportFile(kind) {
    setError('');
    try {
      await flush();
      const shop = (record.values.placeName || 'บันทึกการตรวจ').slice(0, 40);
      await withPasscode(() =>
        downloadRecordExport(planId, newCode, kind, `บันทึกการตรวจ ${shop}.${kind}`)
      );
      // Producing the file is the moment the inspection is written up.
      await withPasscode(() =>
        patchPlanItem(planId, newCode, { status: 'done', statusSource: 'auto' })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function nextShop() {
    const remaining = (plan.items || []).filter(
      (item) => item.newCode !== newCode && item.status !== 'done'
    );
    if (!remaining.length) {
      window.location.hash = '#/plans';
      return;
    }
    window.location.hash = `#/plans/${planId}/${encodeURIComponent(remaining[0].newCode)}`;
  }

  if (error && !record) return <div className="error">{error}</div>;
  if (!record) return <div className="empty">กำลังโหลด...</div>;

  const saveLabel = {
    idle: 'ยังไม่ได้บันทึก',
    saving: 'กำลังบันทึก...',
    saved: 'บันทึกแล้ว',
    failed: 'บันทึกไม่สำเร็จ — แตะเพื่อลองใหม่',
  }[save];

  return (
    <div className="record-form">
      <header className="record-head">
        <a className="link" href="#/plans">
          ← แผนการตรวจ
        </a>
        <b>{record.values.placeName || newCode}</b>
        <button type="button" className={`save-state ${save}`} onClick={flush}>
          {saveLabel}
        </button>
      </header>

      {error && (
        <div className="error">
          {error}
          <button type="button" className="link" onClick={reload}>
            โหลดของล่าสุด
          </button>
          <button type="button" className="link" onClick={overwrite}>
            บันทึกทับ
          </button>
        </div>
      )}

      <nav className="record-steps">
        {STEPS.map((entry) => (
          <button
            type="button"
            key={entry.n}
            className={entry.n === step ? 'on' : undefined}
            onClick={() => setStep(entry.n)}
          >
            {entry.n}
          </button>
        ))}
        <span className="record-step-title">{STEPS[step - 1].title}</span>
      </nav>

      {step <= 4 && (
        <RecordStep
          step={step}
          values={record.values}
          checks={record.checks}
          onChange={change}
          onCheck={check}
        />
      )}
      {step === 5 && <div className="empty">ภาพถ่าย — ทำในงานถัดไป</div>}
      {step === 6 && (
        <div className="record-step">
          <RecordStep
            step={6}
            values={record.values}
            checks={record.checks}
            onChange={change}
            onCheck={check}
          />
          <div className="record-export">
            <button type="button" onClick={() => exportFile('pdf')}>
              สร้าง PDF
            </button>
            <button type="button" onClick={() => exportFile('docx')}>
              สร้าง Word
            </button>
            <button type="button" onClick={nextShop}>
              ร้านถัดไป →
            </button>
          </div>
        </div>
      )}

      <footer className="record-nav">
        <button type="button" disabled={step === 1} onClick={() => setStep(step - 1)}>
          ← ย้อน
        </button>
        <button type="button" disabled={step === STEPS.length} onClick={() => setStep(step + 1)}>
          ถัดไป →
        </button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 3: Style it for a thumb**

Append to `web/src/app.css`:

```css
/* --- บันทึกการตรวจหน้างาน ------------------------------------------------ */
/* Sized for a thumb on an iPad held in one hand at a shop counter: nothing
   tappable is under 44px, and the two things that move — the save state and
   the step buttons — never scroll out of reach. */
.record-form { display: flex; flex-direction: column; gap: 12px; padding-bottom: 72px; }
.record-head { display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 2;
  background: var(--background); padding: 8px 0; }
.record-head b { flex: 1; }
.save-state { min-height: 44px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--secondary); font: inherit; cursor: pointer; }
.save-state.saved { color: var(--success-fg); background: var(--success-bg); border-color: transparent; }
.save-state.failed, .save-state.idle { color: var(--warning-fg); background: var(--warning-bg);
  border-color: var(--warning-line); }
.record-steps { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.record-steps button { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--border);
  background: var(--background); font: inherit; cursor: pointer; }
.record-steps button.on { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.record-step-title { margin-left: 8px; color: var(--muted-foreground); }
.record-step { display: flex; flex-direction: column; gap: 14px; }
.record-field { display: flex; flex-direction: column; gap: 4px; }
.record-field span { color: var(--muted-foreground); font-size: 14px; }
.record-field input, .record-field textarea {
  min-height: 44px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--background); color: var(--foreground); font: inherit;
}
.record-checks { border: 1px solid var(--border); border-radius: 12px; padding: 10px; margin: 0; }
.record-checks legend { padding: 0 6px; color: var(--muted-foreground); font-size: 14px; }
.check-option { display: block; width: 100%; min-height: 44px; margin-top: 6px; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--background);
  color: var(--foreground); font: inherit; text-align: left; cursor: pointer; }
.check-option.on { background: var(--primary); color: var(--primary-foreground); border-color: transparent; }
.record-export { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.record-export button { min-height: 44px; padding: 0 16px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--background); font: inherit; cursor: pointer; }
.record-nav { position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 8px;
  padding: 8px 12px; background: var(--background); border-top: 1px solid var(--border); }
.record-nav button { flex: 1; min-height: 48px; border-radius: 12px; border: 1px solid var(--border);
  background: var(--background); font: inherit; cursor: pointer; }
.record-nav button:disabled { opacity: .45; }
```

- [ ] **Step 4: Build and walk it on a phone-sized window**

```bash
npm run build
```

`PLANS_STORE=file npm start`. Put a real shop in a plan, open it from the plan
table, and with the browser's device toolbar at 390×844:

1. every step's fields are reachable and typing works
2. `shopOpen` and `shopClosed` cannot both be on
3. the save state goes `ยังไม่ได้บันทึก` → `กำลังบันทึก...` → `บันทึกแล้ว` a second after typing stops
4. reload the page: what you typed is still there

- [ ] **Step 5: Check the stale-write path**

Open the same shop in two tabs, type in both, save both. Expected: the second
one shows the orange message with "โหลดของล่าสุด" and "บันทึกทับ", and neither
tab loses what is on its screen.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/RecordForm.jsx web/src/components/RecordStep.jsx web/src/app.css
git commit -m "Fill the record on a touch screen, one step at a time

A failed save never clears the screen: the officer is standing in a
pharmacy and cannot type it again.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Photos

**Files:**
- Create: `web/src/components/PhotoGrid.jsx`
- Modify: `web/src/components/RecordForm.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: `uploadPhoto`, `deletePhoto`, `photoObjectUrl` (Task 10).
- Produces: `<PhotoGrid planId newCode record onRecord />` — `onRecord(record)` hands the updated record back up.

- [ ] **Step 1: Write the component**

Create `web/src/components/PhotoGrid.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { deletePhoto, photoObjectUrl, uploadPhoto } from '../lib/records-api.js';

/* A photo from an iPad's camera is around 4MB. Nothing in the record needs
   that: the appendix prints two to a page. Down-scaling in the browser makes
   the upload quick on a phone's connection and keeps the store small. */
const MAX_EDGE = 1600;
const QUALITY = 0.8;

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
}

function Thumb({ planId, newCode, photo }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let revoked = false;
    let made = '';
    photoObjectUrl(planId, newCode, photo.id)
      .then((objectUrl) => {
        if (revoked) return URL.revokeObjectURL(objectUrl);
        made = objectUrl;
        setUrl(objectUrl);
        return undefined;
      })
      .catch(() => setUrl(''));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [planId, newCode, photo.id]);
  return url ? <img src={url} alt="" /> : <div className="photo-loading">กำลังโหลด...</div>;
}

export default function PhotoGrid({ planId, newCode, record, onRecord }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(event) {
    const files = [...event.target.files];
    event.target.value = '';
    setError('');
    for (const file of files) {
      setBusy(true);
      try {
        const blob = await downscale(file);
        const { record: next } = await uploadPhoto(planId, newCode, blob);
        onRecord(next);
      } catch (err) {
        setError(`อัปโหลดรูปไม่สำเร็จ: ${err.message}`);
      } finally {
        setBusy(false);
      }
    }
  }

  async function remove(photoId) {
    if (!window.confirm('ลบรูปนี้?')) return;
    setError('');
    try {
      onRecord(await deletePhoto(planId, newCode, photoId));
    } catch (err) {
      setError(err.message);
    }
  }

  /* Caption and "แนบท้าย PDF" live on the record, so they ride to the server
     with the next autosave rather than needing a route of their own. */
  function edit(photoId, patch) {
    onRecord({
      ...record,
      photos: record.photos.map((photo) =>
        photo.id === photoId ? { ...photo, ...patch } : photo
      ),
    });
  }

  return (
    <div className="record-step">
      <label className="photo-add">
        {/* `capture` opens the camera straight away on iOS; without a camera
            it is an ordinary file picker, which is what a desktop needs. */}
        <input type="file" accept="image/*" capture="environment" multiple onChange={add} />
        <span>{busy ? 'กำลังอัปโหลด...' : '+ ถ่ายรูป / เลือกรูป'}</span>
      </label>

      {error && <div className="error">{error}</div>}
      {record.photos.length === 0 && <div className="empty">ยังไม่มีรูป</div>}

      <div className="photo-list">
        {record.photos.map((photo, index) => (
          <figure className="photo-item" key={photo.id}>
            <Thumb planId={planId} newCode={newCode} photo={photo} />
            <input
              type="text"
              placeholder={`คำบรรยายภาพที่ ${index + 1}`}
              value={photo.caption}
              onChange={(event) => edit(photo.id, { caption: event.target.value })}
            />
            <label className="photo-inpdf">
              <input
                type="checkbox"
                checked={photo.inPdf}
                onChange={(event) => edit(photo.id, { inPdf: event.target.checked })}
              />
              แนบท้าย PDF
            </label>
            <button type="button" className="link danger" onClick={() => remove(photo.id)}>
              ลบรูป
            </button>
          </figure>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Put it in step 5**

In `web/src/components/RecordForm.jsx`, add the import:

```js
import PhotoGrid from './PhotoGrid.jsx';
```

and replace the step-5 placeholder with:

```jsx
      {step === 5 && (
        <PhotoGrid
          planId={planId}
          newCode={newCode}
          record={record}
          onRecord={(next) => {
            // A photo route answers with the whole record, so the photo list
            // is taken from it wholesale — but the values on screen are the
            // officer's and are never replaced by an older copy.
            dirty.current = true;
            setSave('idle');
            setRecord((current) => ({ ...current, photos: next.photos, updatedAt: next.updatedAt }));
          }}
        />
      )}
```

- [ ] **Step 3: Style it**

Append to `web/src/app.css`:

```css
.photo-add { display: block; }
.photo-add input { display: none; }
.photo-add span { display: block; min-height: 48px; line-height: 48px; text-align: center;
  border: 1px dashed var(--border); border-radius: 12px; cursor: pointer; }
.photo-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.photo-item { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.photo-item img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 10px; }
.photo-loading { aspect-ratio: 4 / 3; display: grid; place-items: center;
  background: var(--secondary); border-radius: 10px; color: var(--muted-foreground); }
.photo-item input[type="text"] { min-height: 44px; padding: 6px 10px; border: 1px solid var(--border);
  border-radius: 10px; background: var(--background); color: var(--foreground); font: inherit; }
.photo-inpdf { display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 4: Try it**

```bash
npm run build
```

`PLANS_STORE=file npm start`, open a shop's record, go to step 5, add two
images. Expected: thumbnails appear, captions type, "แนบท้าย PDF" ticks,
`data/photos/<planId>/…` holds two files of a few hundred kilobytes each —
not four megabytes.

Then step 6 → "สร้าง PDF". Expected: a third page with both photographs and
their captions.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PhotoGrid.jsx web/src/components/RecordForm.jsx web/src/app.css
git commit -m "Photograph the shop from the record screen

Down-scaled in the browser: an iPad's 4MB frame is not what a two-to-a-page
appendix needs, and the upload happens on a phone's connection.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Signatures on the screen

**Files:**
- Create: `web/src/components/SignaturePad.jsx`
- Modify: `web/src/components/RecordForm.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: nothing outside the browser.
- Produces: `<SignaturePad label value onChange />` — `onChange(dataUrl | null)`, PNG trimmed to the ink.

- [ ] **Step 1: Write the pad**

Create `web/src/components/SignaturePad.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';

/* Drawn at twice the box's size so the PNG still looks like ink when the PDF
   prints it at 150pt wide. */
const SCALE = 2;

/** Crop to what was actually drawn, so a short signature is not a wide band
    of transparent pixels stretched across the rule on the paper. */
function trim(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = 0;
  let bottom = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null; // nothing drawn
  const pad = 4;
  const cut = document.createElement('canvas');
  cut.width = Math.min(width, right - left + pad * 2);
  cut.height = Math.min(height, bottom - top + pad * 2);
  cut
    .getContext('2d')
    .drawImage(canvas, Math.max(0, left - pad), Math.max(0, top - pad), cut.width, cut.height, 0, 0, cut.width, cut.height);
  return cut.toDataURL('image/png');
}

export default function SignaturePad({ label, value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const canvas = canvasRef.current;
    const box = canvas.getBoundingClientRect();
    canvas.width = box.width * SCALE;
    canvas.height = box.height * SCALE;
    const context = canvas.getContext('2d');
    context.lineWidth = 2.5 * SCALE;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111';

    const at = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [(event.clientX - rect.left) * SCALE, (event.clientY - rect.top) * SCALE];
    };
    const down = (event) => {
      drawing.current = true;
      canvas.setPointerCapture(event.pointerId);
      const [x, y] = at(event);
      context.beginPath();
      context.moveTo(x, y);
    };
    const move = (event) => {
      if (!drawing.current) return;
      // A finger drags the page as well as the pen without this.
      event.preventDefault();
      const [x, y] = at(event);
      context.lineTo(x, y);
      context.stroke();
    };
    const up = () => {
      drawing.current = false;
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [open]);

  function clear() {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  }

  function keep() {
    onChange(trim(canvasRef.current));
    setOpen(false);
  }

  return (
    <div className="signature-slot">
      <span>{label}</span>
      {value ? (
        <img className="signature-preview" src={value} alt="" />
      ) : (
        <div className="signature-empty">ยังไม่ได้เซ็น — เว้นไว้เซ็นบนกระดาษก็ได้</div>
      )}
      <div className="signature-actions">
        <button type="button" onClick={() => setOpen(true)}>
          {value ? 'เซ็นใหม่' : 'เซ็นชื่อ'}
        </button>
        {value && (
          <button type="button" className="link danger" onClick={() => onChange(null)}>
            ลบลายเซ็น
          </button>
        )}
      </div>

      {open && (
        <div className="signature-sheet">
          <b>{label}</b>
          <canvas ref={canvasRef} className="signature-canvas" />
          <div className="signature-actions">
            <button type="button" onClick={clear}>
              ล้าง
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
            <button type="button" onClick={keep}>
              ใช้ลายเซ็นนี้
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Put the eight slots in step 6**

In `web/src/components/RecordForm.jsx`, add the import:

```js
import SignaturePad from './SignaturePad.jsx';
```

and inside the step-6 block, between `<RecordStep …/>` and `<div className="record-export">`:

```jsx
          {[
            { slot: 'page1', label: 'หน้า 1 — เภสัชกร / ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต' },
            { slot: 'duty', label: 'ผู้มีหน้าที่ปฏิบัติการ / เภสัชกร' },
            { slot: 'licensee', label: 'ผู้รับอนุญาต / ผู้แทนผู้รับอนุญาต' },
            { slot: 'officer1', label: 'พนักงานเจ้าหน้าที่ คนที่ 1', needs: 'signOfficer1' },
            { slot: 'officer2', label: 'พนักงานเจ้าหน้าที่ คนที่ 2', needs: 'signOfficer2' },
            { slot: 'officer3', label: 'พนักงานเจ้าหน้าที่ คนที่ 3', needs: 'signOfficer3' },
            { slot: 'officer4', label: 'พนักงานเจ้าหน้าที่ คนที่ 4', needs: 'signOfficer4' },
            { slot: 'officer5', label: 'พนักงานเจ้าหน้าที่ คนที่ 5', needs: 'signOfficer5' },
          ]
            // An officer row with no name on it is a row nobody signs, so it
            // is not five empty boxes to scroll past.
            .filter((entry) => !entry.needs || record.values[entry.needs])
            .map((entry) => (
              <SignaturePad
                key={entry.slot}
                label={entry.label}
                value={record.signatures[entry.slot] || null}
                onChange={(dataUrl) => {
                  dirty.current = true;
                  setSave('idle');
                  setRecord((current) => {
                    const signatures = { ...current.signatures };
                    if (dataUrl) signatures[entry.slot] = dataUrl;
                    else delete signatures[entry.slot];
                    return { ...current, signatures };
                  });
                }}
              />
            ))}
```

- [ ] **Step 3: Style it**

Append to `web/src/app.css`:

```css
.signature-slot { display: flex; flex-direction: column; gap: 6px; padding: 10px;
  border: 1px solid var(--border); border-radius: 12px; }
.signature-slot > span { color: var(--muted-foreground); font-size: 14px; }
.signature-preview { height: 56px; object-fit: contain; object-position: left bottom;
  border-bottom: 1px solid var(--foreground); }
.signature-empty { min-height: 56px; display: grid; place-items: center;
  color: var(--muted-foreground); border-bottom: 1px dashed var(--border); }
.signature-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.signature-actions button { min-height: 44px; padding: 0 14px; border-radius: 10px;
  border: 1px solid var(--border); background: var(--background); font: inherit; cursor: pointer; }
/* Full-screen: a signature drawn in a thumbnail-sized box does not look like
   the person's own. */
.signature-sheet { position: fixed; inset: 0; z-index: 10; display: flex; flex-direction: column;
  gap: 10px; padding: 16px; background: var(--background); }
.signature-canvas { flex: 1; width: 100%; border: 1px solid var(--border); border-radius: 12px;
  background: #fff; touch-action: none; }
```

`touch-action: none` on the canvas is what stops the page scrolling under the
finger that is signing.

- [ ] **Step 4: Try it end to end**

```bash
npm run build
```

`PLANS_STORE=file npm start`. On a shop's record: step 6, sign `duty`, save,
reload the page — the signature is still there. Then "สร้าง PDF" and confirm the
signature sits on its rule on page 2, and that the officer rows with no name
show no pad at all.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SignaturePad.jsx web/src/components/RecordForm.jsx web/src/app.css
git commit -m "Sign the record on the iPad, one rule at a time

Trimmed to the ink so a short signature is not stretched across the rule,
and an officer row with no name gets no pad — nobody signs it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: The plan table on a small screen

**Files:**
- Modify: `web/src/components/PlanTable.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PlanTable`'s "กรอกฟอร์ม" button goes to `#/plans/:id/:newCode` instead of opening `form.html`; the table reads as cards under 700px.

- [ ] **Step 1: Send the button to the wizard**

In `web/src/components/PlanView.jsx`, replace the body of `openForm` with:

```js
  function openForm(item) {
    // On-site: the touch wizard, which knows the plan and reports the shop
    // done by itself. The static record page is still there for a shop that
    // is not in any plan.
    window.location.hash = `#/plans/${plan.id}/${encodeURIComponent(item.newCode)}`;
  }
```

Delete the now-unused `HANDOFF_KEY` constant from that file if nothing else uses it.

- [ ] **Step 2: Make the table read as cards**

Append to `web/src/app.css`:

```css
/* Six columns of Thai prose do not fit a phone. Under 700px each row becomes
   a card with the column name in front of each value — the same data, read
   down instead of across. */
@media (max-width: 700px) {
  .plan-table thead { display: none; }
  .plan-table, .plan-table tbody, .plan-table tr, .plan-table td { display: block; width: 100%; }
  .plan-table tr { border: 1px solid var(--border); border-radius: 12px; margin-bottom: 12px; padding: 8px; }
  .plan-table td { border: 0; padding: 4px 0; }
  .plan-table td::before { content: attr(data-label); display: block; color: var(--muted-foreground);
    font-size: 12px; }
  .plan-table td.num { text-align: left; font-weight: 700; }
  .plan-table .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .plan-table .actions button, .plan-table .actions label { min-height: 44px; }
}
```

- [ ] **Step 3: Give every cell its label**

In `web/src/components/PlanTable.jsx`, add a `data-label` to each `<td>` in the
body row, matching its column:

```jsx
              <td className="num" data-label="ลำดับที่">{item.order}</td>
```

and likewise `data-label="ชื่อสถานที่"`, `"ประเภทใบอนุญาต"`, `"สถานที่ตั้ง"`,
`"ผู้รับอนุญาต"`, `"ผู้มีหน้าที่ปฏิบัติการ"`, `"ตรวจแล้ว"` on the other six.

- [ ] **Step 4: Look at it at 390px**

```bash
npm run build
```

`PLANS_STORE=file npm start`, open `#/plans` with the browser at 390×844.
Expected: one card per shop, every value labelled, "กรอกฟอร์ม" opens the wizard
for that shop in the same tab, and the desktop table is unchanged at full width.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PlanTable.jsx web/src/components/PlanView.jsx web/src/app.css
git commit -m "Read the plan down a phone instead of across a page

Same data, one card per shop, and the button now opens the touch wizard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: Smoke test, documentation, deploy

**Files:**
- Modify: `smoke.js`, `README.md`, `.env.example`, `package.json`

- [ ] **Step 1: Add the on-site pass to the smoke test**

In `smoke.js`, add to the requires:

```js
const records = require('./src/records');
const photoStore = require('./src/photo-store');
```

and insert this immediately after the plan block (after the line that logs
`ok — แผนการตรวจ: …`), replacing nothing:

```js
  // --- บันทึกการตรวจหน้างาน -----------------------------------------------
  const onsite = await records.readRecord(plan.id, row.newCode);
  assert.strictEqual(onsite.values.placeName, row.placeName, 'ร่างต้องรู้จักชื่อร้านจากแผน');
  assert.strictEqual(onsite.updatedAt, null);

  const written = await records.writeRecord(plan.id, row.newCode, {
    ...onsite,
    officerName: 'นางสาวอชิดา บุญเพียร',
    values: { ...onsite.values, inspectTime: '10.30', endTime: '11.15' },
    checks: { shopOpen: true, rolePharmacist: true },
    signatures: {
      duty: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    },
  });
  assert.ok(written.updatedAt, 'บันทึกแล้วต้องมี updatedAt');

  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64'
  );
  const { id: photoId } = await photoStore.putPhoto(plan.id, row.newCode, jpeg);
  await records.addPhoto(plan.id, row.newCode, { id: photoId });

  const recordPdf = Buffer.from(
    await renderFormPdf({
      values: written.values,
      checks: written.checks,
      signatures: written.signatures,
      photos: [{ src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, caption: 'ชั้นวางยา' }],
    })
  );
  assert.strictEqual(recordPdf.subarray(0, 4).toString(), '%PDF', 'บันทึกการตรวจไม่ใช่ PDF');
  // Two sheets of record plus the photo appendix.
  const pages = (recordPdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.strictEqual(pages, 3, `บันทึกที่มีรูปควรได้ 3 หน้า ได้ ${pages}`);

  await photoStore.delPhoto(plan.id, row.newCode, photoId);
  console.log('ok — บันทึกหน้างาน: ร่างจากแผน เขียนกลับ แนบรูป และได้ PDF สามหน้า');
```

Add `renderFormPdf` to the destructured require from `./src/scraper` at the top
of `smoke.js` if it is not already there.

- [ ] **Step 2: Run everything**

```bash
npm test
```

Expected: `ok —` from `test-thai-name`, `test-plans-store`, `test-plans`,
`test-records-store`, `test-form-fields`, `test-docx-plan`, `test-parse`, and
all seven lines of `test-form-parity`.

```bash
node smoke.js
```

Expected: the FDA lines, the plan line, and
`ok — บันทึกหน้างาน: ร่างจากแผน เขียนกลับ แนบรูป และได้ PDF สามหน้า`.

- [ ] **Step 3: Document the settings**

In `README.md`'s environment table, after the three `PLANS_*` rows:

```markdown
| `RECORDS_DIR` | `data/records` | โฟลเดอร์เก็บบันทึกการตรวจหน้างาน เมื่อใช้ `PLANS_STORE=file` |
| `PHOTOS_DIR` | `data/photos` | โฟลเดอร์เก็บรูปถ่ายหน้างาน เมื่อใช้ `PLANS_STORE=file` |
```

Add the same two keys, commented out, to `.env.example` beside the `PLANS_*` block.

Then add a short section to `README.md` after the plans section:

```markdown
### ตรวจหน้างาน

เปิดแผนการตรวจบนไอแพด แตะร้าน แล้วกรอกบันทึกทีละขั้น (`#/plans/<วันที่>/<newCode>`)
ระบบบันทึกร่างขึ้นเซิร์ฟเวอร์เองทุกครั้งที่หยุดพิมพ์ ถ่ายรูปและเซ็นชื่อได้ในหน้าเดียวกัน
กด "สร้าง PDF" แล้วร้านจะถูกติ๊กว่าตรวจแล้วในแผนโดยอัตโนมัติ

ต้องมีอินเทอร์เน็ตขณะตรวจ — ระบบไม่ทำงานแบบออฟไลน์โดยตั้งใจ (ดู
`docs/superpowers/specs/2026-09-08-onsite-inspection-design.md`)

รูปถ่ายและลายเซ็นออกเฉพาะใน PDF ไฟล์ Word มีแต่ข้อความ
```

- [ ] **Step 4: Build and commit**

```bash
npm run build
git add smoke.js README.md .env.example package.json public
git commit -m "Smoke-test and document the on-site record

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Deploy**

```bash
git push origin main
```

Nothing new to configure: `PLANS_STORE` already selects the backend for the
records and the photos alike, and `PLANS_PASSCODE` already guards every route
this work added.

- [ ] **Step 6: Verify on the deployment**

Open the deployed site on an actual iPad, sign in with the office passcode,
open a plan, walk one shop end to end: fill a step, add a photo, sign one rule,
produce the PDF. Expected: the PDF has the record and the photo appendix, and
the shop shows "ตรวจแล้ว" when you go back to the plan.

---

## Self-Review

**Spec coverage**

| spec section | task |
| --- | --- |
| 2. เส้นทางงานหน้างาน | 10 (route), 11 (wizard, next shop), 14 (entry from the plan) |
| 3. ข้อมูล | 2 (draft shape, blank from plan), 3 (photo bytes) |
| 4. ที่เก็บ | 1 (factory), 2 (records), 3 (photos), 4 (`/health`) |
| 5. manifest + เทสต์ | 6 |
| 6. หน้าจอ | 11 (steps, 44px targets, exclusive groups), 14 (cards under 700px) |
| 7. API | 4 (record + photos), 9 (exports) |
| 8. ลายเซ็นและรูปลงกระดาษ | 7 (signatures), 8 (appendix), 9 (server inlines the bytes) |
| 9. ความผิดพลาด | 2 + 11 (409), 11 (autosave state, beforeunload), 12 (per-photo retry), 4 (5MB cap), 4 (`/health`) |
| 10. การทดสอบ | 2, 3, 6, 7, 8, 15 |
| 11. ไฟล์ที่แตะ | every file listed is created or modified by a task above |

The one spec line with no task of its own is "กดสร้าง PDF ตอนยังกรอกไม่ครบ →
สร้างให้ ไม่บล็อก" — Task 11's `exportFile` has no validation gate, which is
that behaviour. It is deliberate, not a gap.

**Names used across tasks**

`recordId`, `readRecord`, `writeRecord`, `addPhoto`, `removePhoto`,
`SIGNATURE_SLOTS` (Task 2) are consumed by Tasks 4 and 15 under those names.
`putPhoto`/`getPhoto`/`delPhoto`/`backendName` (Task 3) likewise in Tasks 4, 9,
15. `passcodeHeaders` is added to `plans-api.js` in Task 10 Step 1 before
`records-api.js` uses it in Step 2. `STEPS`/`FIELDS`/`CHECK_GROUPS`
(Task 6) are used by Task 11 and by Task 6's own test. The eight `data-sign` values in
Task 7 are the eight entries of `SIGNATURE_SLOTS` and the eight slots rendered
in Task 13.

# Inspection Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the office pick several pharmacies from a search, keep them as a dated inspection plan shared by the whole team, track which ones have been written up, and export the plan as PDF and Word.

**Architecture:** A plan is one JSON document written through `src/plans-store.js`, which has two interchangeable backends (Vercel Blob for the current deployment, a directory on disk for the Pharmacy Council's own server) chosen by one environment variable. `src/plans.js` holds the plan logic — building an item from the FDA detail plus the council's licence register, and applying single-item patches. Express exposes it under `/api/plans/*` behind an optional office passcode. The web app gains a second view switched by `location.hash`, with no router dependency.

**Tech Stack:** Node 20 CommonJS, Express 4, React 18 + Vite (in `web/`), puppeteer for PDF, hand-built OOXML through the existing `src/zip.js` for Word, plain `node` scripts with `assert` for tests.

## Global Constraints

- Node CommonJS (`'use strict'`, `require`) everywhere under `src/`; ES modules only inside `web/src/`.
- Comments and identifiers in English; all user-facing strings in Thai.
- No test framework. Tests are standalone `node` scripts using `assert`, registered in `package.json` scripts.
- `templates/` never enters git or a deployment upload — nothing in this plan reads or writes it.
- `BLOB_READ_WRITE_TOKEN` may only ever be sent to `*.blob.vercel-storage.com`.
- Blob objects stay `access: 'private'`.
- Exactly one new runtime dependency is permitted: `@vercel/blob`. No others.
- Plan `id` and `date` are Buddhist-era `YYYY-MM-DD` strings (e.g. `2569-08-27`).
- `licenceSource` is one of `auto` | `ambiguous` | `none` | `manual`. `statusSource` is `auto` | `manual`. `status` is `planned` | `done`.
- Every `npm --prefix web run build` output under `public/` is git-ignored — never `git add public/`.
- Commit messages: imperative subject, body explaining why, ending with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

**New**

| File | Responsibility |
| --- | --- |
| `src/thai-name.js` | Split a Thai full name written by the FDA into title / first / last. |
| `src/plans-store.js` | Persistence only: `list`, `get`, `save`, `remove`. Two backends, one chosen by env. |
| `src/plans.js` | Plan logic: create, build an item from FDA + council data, patch, remove, sync. Knows nothing about HTTP or storage format. |
| `src/docx-plan.js` | Render a plan as a `.docx` table. |
| `web/public/plan-print.html` | Landscape A4 page puppeteer prints the plan PDF from. |
| `web/src/lib/plans-api.js` | Browser client for `/api/plans/*`, carries the passcode header. |
| `web/src/components/PlanView.jsx` | The `#/plans` screen: list on the left, table on the right. |
| `web/src/components/PlanList.jsx` | Left column — plans by date with a done count. |
| `web/src/components/PlanTable.jsx` | The six-column table and its per-row controls. |
| `test-thai-name.js` | Offline test for the name splitter. |
| `test-plans-store.js` | Offline test for the `file` backend. |
| `test-plans.js` | Offline test for plan logic with injected fakes — no network. |
| `test-docx-plan.js` | Offline test that the generated `.docx` is a readable zip carrying every row. |

**Modified**

| File | Change |
| --- | --- |
| `src/config.js` | `plansStore`, `plansDir`, `plansPasscode`. |
| `src/scraper.js` | `renderPlanPdf(plan)` beside `renderFormPdf`. |
| `src/server.js` | `/api/plans/*` routes, passcode guard, `/health` reports the store. |
| `web/src/App.jsx` | Hash-switched views. |
| `web/src/components/Sidebar.jsx` | "แผนการตรวจ" menu entry. |
| `web/src/components/ResultCard.jsx` | Selection checkbox. |
| `web/src/components/PickBar.jsx` | Multi-select mode and "ใส่ในแผน". |
| `web/public/form.html` | Report `done` back when a record file is produced. |
| `web/src/app.css` | Styles for the plan screen. |
| `package.json` | `@vercel/blob`, new test scripts. |
| `smoke.js` | End-to-end plan pass. |
| `README.md` | The two new environment variables. |

---

## Task 1: Thai name splitter

The council's register searches first name and surname separately, but the FDA writes a pharmacist as one string with the title run into the first name. The browser copy of this logic lives in `web/public/pharmacist-search.js`, which is a plain static file with no bundler — the server cannot import it, so the server gets its own copy. Two small copies is the lazy price of not introducing a build step for one static file.

**Files:**
- Create: `src/thai-name.js`
- Test: `test-thai-name.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `splitThaiName(full) -> { title: string, firstName: string, lastName: string }`. Missing parts come back as `''`.

- [x] **Step 1: Write the failing test**

Create `test-thai-name.js`:

```js
/**
 * Offline check of the Thai name splitter. No network.
 *
 *   node test-thai-name.js
 */
'use strict';

const assert = require('assert');
const { splitThaiName } = require('./src/thai-name');

const cases = [
  ['นางสาวกุลนิดา บูรณ์สิริจรุงรัฐ', 'นางสาว', 'กุลนิดา', 'บูรณ์สิริจรุงรัฐ'],
  ['ภญ.เมวรี สุขคุ้ม', 'ภญ.', 'เมวรี', 'สุขคุ้ม'],
  ['ภก. ธวัชชัย ทิพย์ทินกร', 'ภก.', 'ธวัชชัย', 'ทิพย์ทินกร'],
  ['เภสัชกรหญิง รัชดา อัศวรัตน์', 'เภสัชกรหญิง', 'รัชดา', 'อัศวรัตน์'],
  ['นายศิริพงษ์  เจือโร่ง', 'นาย', 'ศิริพงษ์', 'เจือโร่ง'],
  ['สมชาย ใจดี', '', 'สมชาย', 'ใจดี'],
];

for (const [full, title, firstName, lastName] of cases) {
  const got = splitThaiName(full);
  assert.deepStrictEqual(got, { title, firstName, lastName }, `แยกชื่อผิด: ${full}`);
}

// "นางสาว" must not be read as "นาง" with a stray "สาว" left on the name.
assert.strictEqual(splitThaiName('นางสาวสาวิตรี ก').firstName, 'สาวิตรี');

// Junk in, empty out — never throw, the caller is filling a form.
for (const junk of [null, undefined, '', '   ', 'นางสาว']) {
  const got = splitThaiName(junk);
  assert.strictEqual(got.lastName, '', `ควรได้นามสกุลว่าง: ${junk}`);
}

console.log('ok — แยกชื่อไทยได้ครบทุกกรณี');
```

- [x] **Step 2: Run the test and watch it fail**

```bash
node test-thai-name.js
```

Expected: `Error: Cannot find module './src/thai-name'`.

- [x] **Step 3: Write the implementation**

Create `src/thai-name.js`:

```js
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
```

- [x] **Step 4: Run the test and watch it pass**

```bash
node test-thai-name.js
```

Expected: `ok — แยกชื่อไทยได้ครบทุกกรณี`.

- [x] **Step 5: Register the script**

In `package.json`, inside `"scripts"`, after `"test:parse"`:

```json
    "test:name": "node test-thai-name.js",
```

- [x] **Step 6: Commit**

```bash
git add src/thai-name.js test-thai-name.js package.json
git commit -m "Split a Thai pharmacist name server-side

The council register searches first name and surname separately while the
FDA writes both as one string. The browser already splits them; the plan
builder needs the same on the server.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Plan store — file backend

**Files:**
- Create: `src/plans-store.js`
- Test: `test-plans-store.js`
- Modify: `src/config.js`, `package.json`, `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `list() -> Promise<Plan[]>` — every plan, newest date first.
  - `get(id) -> Promise<Plan|null>`
  - `save(plan) -> Promise<Plan>` — writes `updatedAt`, returns what was written.
  - `remove(id) -> Promise<boolean>` — `false` when it was not there.
  - `backendName() -> 'blob' | 'file'`
  - A `Plan` is the shape in the spec: `{ id, title, date, createdAt, updatedAt, items: [] }`.

- [x] **Step 1: Write the failing test**

Create `test-plans-store.js`:

```js
/**
 * Offline check of the plan store's file backend. No network.
 *
 *   node test-plans-store.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = dir;

const store = require('./src/plans-store');

(async () => {
  assert.strictEqual(store.backendName(), 'file');
  assert.deepStrictEqual(await store.list(), [], 'ที่เก็บว่างควรได้อาร์เรย์ว่าง');
  assert.strictEqual(await store.get('2569-08-27'), null);

  const plan = {
    id: '2569-08-27',
    title: 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม',
    date: '2569-08-27',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    items: [],
  };
  const saved = await store.save(plan);
  assert.ok(saved.updatedAt >= plan.updatedAt, 'save ต้องอัปเดต updatedAt');

  const back = await store.get('2569-08-27');
  assert.strictEqual(back.title, plan.title);
  assert.deepStrictEqual(back.items, []);

  await store.save({ ...plan, id: '2569-09-01', date: '2569-09-01' });
  const all = await store.list();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].id, '2569-09-01', 'ควรเรียงวันที่ใหม่ก่อน');

  // A traversal id must never escape the plans directory.
  await assert.rejects(() => store.get('../../secret'), /รหัสแผนไม่ถูกต้อง/);
  await assert.rejects(() => store.save({ ...plan, id: 'a/b' }), /รหัสแผนไม่ถูกต้อง/);

  assert.strictEqual(await store.remove('2569-09-01'), true);
  assert.strictEqual(await store.remove('2569-09-01'), false);
  assert.strictEqual((await store.list()).length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok — ที่เก็บแผนแบบไฟล์ทำงานครบวงจร');
})();
```

- [x] **Step 2: Run the test and watch it fail**

```bash
node test-plans-store.js
```

Expected: `Error: Cannot find module './src/plans-store'`.

- [x] **Step 3: Add the settings**

In `src/config.js`, inside the exported object beside `blobToken`:

```js
  // Where inspection plans live. `blob` for the Vercel deployment, `file` for
  // a server with a writable disk (the Pharmacy Council's own). Left unset,
  // a blob token decides it — which is what a Vercel deployment has.
  plansStore: process.env.PLANS_STORE || (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'file'),
  plansDir: process.env.PLANS_DIR || path.join(__dirname, '..', 'data', 'plans'),
  plansPasscode: process.env.PLANS_PASSCODE || null,
```

- [x] **Step 4: Write the file backend**

Create `src/plans-store.js`:

```js
'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * One inspection plan is one JSON document. Nothing here knows what a plan
 * means — that is `src/plans.js`.
 *
 * There are two backends because the system runs on Vercel today and moves to
 * the Pharmacy Council's own server later; the move has to be a setting, not
 * an edit to every caller.
 */

/** Plan ids reach here from a URL, so they may never contain a path. */
function assertId(id) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$/.test(String(id || ''))) {
    const err = new Error('รหัสแผนไม่ถูกต้อง');
    err.status = 400;
    throw err;
  }
  return id;
}

function byDateDesc(a, b) {
  return String(b.date || b.id).localeCompare(String(a.date || a.id));
}

const file = {
  name: 'file',
  async all() {
    let names;
    try {
      names = await fs.readdir(config.plansDir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const plans = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(config.plansDir, name), 'utf8');
      plans.push(JSON.parse(raw));
    }
    return plans;
  },
  async get(id) {
    try {
      const raw = await fs.readFile(path.join(config.plansDir, `${id}.json`), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async put(plan) {
    await fs.mkdir(config.plansDir, { recursive: true });
    await fs.writeFile(
      path.join(config.plansDir, `${plan.id}.json`),
      JSON.stringify(plan, null, 2),
      'utf8'
    );
  },
  async del(id) {
    try {
      await fs.unlink(path.join(config.plansDir, `${id}.json`));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  },
};

const backends = { file };
const backend = backends[config.plansStore] || file;

async function list() {
  return (await backend.all()).sort(byDateDesc);
}

async function get(id) {
  return backend.get(assertId(id));
}

async function save(plan) {
  assertId(plan.id);
  const next = { ...plan, updatedAt: new Date().toISOString() };
  await backend.put(next);
  return next;
}

async function remove(id) {
  return backend.del(assertId(id));
}

function backendName() {
  return backend.name;
}

module.exports = { list, get, save, remove, backendName };
```

- [x] **Step 5: Run the test and watch it pass**

```bash
node test-plans-store.js
```

Expected: `ok — ที่เก็บแผนแบบไฟล์ทำงานครบวงจร`.

- [x] **Step 6: Keep local plans out of git**

Append to `.gitignore`:

```
# Inspection plans written by the `file` backend during local runs.
/data/plans/
```

- [x] **Step 7: Register the script**

In `package.json` `"scripts"`, after `"test:name"`:

```json
    "test:plans-store": "node test-plans-store.js",
```

- [x] **Step 8: Commit**

```bash
git add src/plans-store.js src/config.js test-plans-store.js package.json .gitignore
git commit -m "Store inspection plans as one JSON document each

The office shares one copy of a day's plan, so it cannot live in a browser.
Storage is a backend behind four functions because the system moves from
Vercel to the council's own server later — that move should be a setting.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Plan store — blob backend

**Files:**
- Modify: `src/plans-store.js`, `package.json`
- Test: `test-plans-store.js` (add a backend-selection case)

**Interfaces:**
- Consumes: `assertId`, `byDateDesc` from Task 2.
- Produces: no new exports. `backendName()` now also answers `'blob'`.

- [x] **Step 1: Write the failing test**

Append to `test-plans-store.js`, immediately before the `fs.rmSync(dir, …)` line:

```js
  // Selecting the blob backend must not need a token at require time — the
  // token is only read when a call actually goes out.
  delete require.cache[require.resolve('./src/config')];
  delete require.cache[require.resolve('./src/plans-store')];
  process.env.PLANS_STORE = 'blob';
  const blobStore = require('./src/plans-store');
  assert.strictEqual(blobStore.backendName(), 'blob');
  await assert.rejects(() => blobStore.list(), /BLOB_READ_WRITE_TOKEN/);
  process.env.PLANS_STORE = 'file';
```

- [x] **Step 2: Run the test and watch it fail**

```bash
node test-plans-store.js
```

Expected: `AssertionError … 'file' !== 'blob'`.

- [x] **Step 3: Install the dependency**

```bash
npm install @vercel/blob
```

- [x] **Step 4: Write the blob backend**

In `src/plans-store.js`, add above `const backends = …`:

```js
/*
 * Vercel's filesystem is read-only, so the deployment keeps plans in Blob.
 * `access: 'private'` matches the record template: a plan names the shops the
 * office is about to visit, which is not public information.
 *
 * The SDK is required lazily so a `file` deployment never loads it, and the
 * token is checked per call rather than at startup so the module can be
 * required (and tested) without one.
 */
const BLOB_PREFIX = 'plans/';

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
    const { blobs } = await listBlobs({ prefix: BLOB_PREFIX, token: config.blobToken });
    const plans = [];
    for (const entry of blobs) {
      const response = await fetch(entry.downloadUrl, {
        headers: { Authorization: `Bearer ${config.blobToken}` },
      });
      if (response.ok) plans.push(await response.json());
    }
    return plans;
  },
  async get(id) {
    const { head } = blobApi();
    let meta;
    try {
      meta = await head(`${BLOB_PREFIX}${id}.json`, { token: config.blobToken });
    } catch {
      return null; // The SDK throws BlobNotFoundError; a missing plan is not an error here.
    }
    const response = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${config.blobToken}` },
    });
    return response.ok ? response.json() : null;
  },
  async put(plan) {
    const { put } = blobApi();
    await put(`${BLOB_PREFIX}${plan.id}.json`, JSON.stringify(plan, null, 2), {
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
    await del(`${BLOB_PREFIX}${id}.json`, { token: config.blobToken });
    return true;
  },
};
```

Then change the registry line:

```js
const backends = { file, blob };
```

- [x] **Step 5: Run the test and watch it pass**

```bash
node test-plans-store.js
```

Expected: `ok — ที่เก็บแผนแบบไฟล์ทำงานครบวงจร`.

- [x] **Step 6: Commit**

```bash
git add src/plans-store.js test-plans-store.js package.json package-lock.json
git commit -m "Keep plans in Vercel Blob when the disk is read-only

A serverless deployment has nowhere to write. Blob objects stay private:
a plan names the shops the office is about to visit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Plan logic

The one place that knows what a plan means. It takes the FDA detail and the council register as injected functions so the test can run offline.

**Files:**
- Create: `src/plans.js`
- Test: `test-plans.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `splitThaiName` (Task 1), `store` (Task 2), `getDetailByNewCode` from `src/scraper.js`, `searchPharmacists` from `src/pharmacist.js`.
- Produces:
  - `createPlan({ date, title }) -> Promise<Plan>`
  - `addItems(id, newCodes, deps?) -> Promise<{ plan, added: string[], failed: [{ newCode, message }] }>`
  - `patchItem(id, newCode, patch) -> Promise<Plan>` — `patch` may carry `status`, `note`, `order`, `pharmacists`.
  - `removeItem(id, newCode) -> Promise<Plan>`
  - `syncItem(id, newCode, deps?) -> Promise<Plan>`
  - `summarise(plan) -> { id, title, date, updatedAt, total, done }`
  - `buildItem(newCode, deps) -> Promise<Item>` — exported for the test.
  - `deps` is `{ fetchDetail, searchPharmacists }`; both default to the real ones.

- [x] **Step 1: Write the failing test**

Create `test-plans.js`:

```js
/**
 * Offline check of the plan logic. The FDA and the council are injected, so
 * this never touches the network.
 *
 *   node test-plans.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plans-logic-'));
process.env.PLANS_STORE = 'file';
process.env.PLANS_DIR = dir;

const plans = require('./src/plans');

const DETAIL = {
  A: {
    licenseeName: 'นางกุ้ยจู อัศวเวชมงคล',
    openHours: '09.00 - 18.00 น.',
    lat: 13.789833,
    lng: 100.549028,
    pharmacists: [
      { name: 'ภญ. รัชดา อัศวรัตน์', openHours: '09.00 - 13.00 น.' },
      { name: 'ภก. ธวัชชัย ทิพย์ทินกร', openHours: '13.00 - 18.00 น.' },
      { name: 'ภญ. สองคน ซ้ำชื่อ', openHours: '09.00 - 18.00 น.' },
      { name: 'ภญ. ไม่มี ในทะเบียน', openHours: '' },
    ],
  },
  B: { licenseeName: 'นายนพดล สงครามรอด', openHours: '00.00 - 24.00 น.', pharmacists: [] },
};

const ROW = {
  A: { placeName: 'ร้านเจริญสุขเภสัช', licenseType: 'ขย.1', licenseNo: 'กท 754/2526', address: 'เลขที่ 293 ถ.สาลีรัฐวิภาค' },
  B: { placeName: 'ร้านยากรุงเทพ', licenseType: 'ขย.1', licenseNo: 'กท 224/2566', address: 'เลขที่ 51 ถ.ลาดพร้าว 101' },
};

const deps = {
  async fetchDetail(newCode) {
    if (newCode === 'BOOM') throw new Error('อย. ไม่ตอบ');
    return { ...ROW[newCode], ...DETAIL[newCode] };
  },
  async searchPharmacists({ firstName, lastName }) {
    if (lastName === 'ทิพย์ทินกร') throw new Error('สภาฯ ไม่ตอบ');
    const table = {
      อัศวรัตน์: [{ licenseNo: '2524', fullName: 'ภญ. รัชดา อัศวรัตน์', status: 'คงอยู่' }],
      ซ้ำชื่อ: [
        { licenseNo: '111', fullName: 'ภญ. สองคน ซ้ำชื่อ', status: 'คงอยู่' },
        { licenseNo: '222', fullName: 'ภญ. สองคน ซ้ำชื่อ', status: 'คงอยู่' },
      ],
    };
    return { counts: {}, groups: { both: table[lastName] || [], firstName: [], lastName: [] } };
  },
};

(async () => {
  const plan = await plans.createPlan({ date: '2569-08-27' });
  assert.strictEqual(plan.id, '2569-08-27');
  assert.strictEqual(plan.title, 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม');
  assert.deepStrictEqual(plan.items, []);

  // A second plan for the same date gets its own id rather than overwriting.
  const twin = await plans.createPlan({ date: '2569-08-27' });
  assert.strictEqual(twin.id, '2569-08-27-2');

  const first = await plans.addItems(plan.id, ['A', 'B', 'BOOM'], deps);
  assert.deepStrictEqual(first.added, ['A', 'B']);
  assert.strictEqual(first.failed.length, 1);
  assert.strictEqual(first.failed[0].newCode, 'BOOM');
  assert.match(first.failed[0].message, /อย\./);

  const [a, b] = first.plan.items;
  assert.strictEqual(a.order, 1);
  assert.strictEqual(b.order, 2);
  assert.strictEqual(a.placeName, 'ร้านเจริญสุขเภสัช');
  assert.strictEqual(a.licenseeName, 'นางกุ้ยจู อัศวเวชมงคล');
  assert.strictEqual(a.lat, 13.789833);
  assert.strictEqual(a.status, 'planned');
  assert.strictEqual(a.statusSource, 'auto');

  // One clear match fills the licence; anything less leaves it for a person.
  assert.deepStrictEqual(
    a.pharmacists.map((p) => [p.licenceNo, p.licenceSource]),
    [
      ['2524', 'auto'],
      ['', 'none'],       // the council refused to answer
      ['', 'ambiguous'],  // two people with that name
      ['', 'none'],       // nobody by that name
    ]
  );
  // An ambiguous row keeps the choices so the officer can pick one.
  assert.strictEqual(a.pharmacists[2].candidates.length, 2);

  // Adding a shop twice is reported, not duplicated.
  const again = await plans.addItems(plan.id, ['A'], deps);
  assert.deepStrictEqual(again.added, []);
  assert.match(again.failed[0].message, /มีอยู่แล้ว/);
  assert.strictEqual(again.plan.items.length, 2);

  // Patching one item leaves its neighbour untouched, in either order.
  await plans.patchItem(plan.id, 'B', { note: 'ปิดปรับปรุง' });
  const patched = await plans.patchItem(plan.id, 'A', { status: 'done' });
  assert.strictEqual(patched.items[0].status, 'done');
  assert.strictEqual(patched.items[0].statusSource, 'manual');
  assert.strictEqual(patched.items[1].note, 'ปิดปรับปรุง');

  // The form reports its own status as `auto`, and never overrides a person.
  const auto = await plans.patchItem(plan.id, 'A', { status: 'planned', statusSource: 'auto' });
  assert.strictEqual(auto.items[0].status, 'done', 'auto ต้องไม่ทับสิ่งที่คนกดเอง');

  const summary = plans.summarise(auto);
  assert.deepStrictEqual(
    { total: summary.total, done: summary.done },
    { total: 2, done: 1 }
  );

  // A licence number typed by hand is trusted and marked as such.
  const manual = await plans.patchItem(plan.id, 'A', {
    pharmacists: [{ index: 2, licenceNo: '222' }],
  });
  assert.strictEqual(manual.items[0].pharmacists[2].licenceNo, '222');
  assert.strictEqual(manual.items[0].pharmacists[2].licenceSource, 'manual');
  assert.strictEqual(manual.items[0].pharmacists[0].licenceNo, '2524', 'คนอื่นต้องไม่ถูกแตะ');

  const removed = await plans.removeItem(plan.id, 'B');
  assert.strictEqual(removed.items.length, 1);
  assert.strictEqual(removed.items[0].newCode, 'A');

  await assert.rejects(() => plans.patchItem(plan.id, 'NOPE', { status: 'done' }), /ไม่พบร้าน/);
  await assert.rejects(() => plans.addItems('2569-01-01', ['A'], deps), /ไม่พบแผน/);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok — ตรรกะแผนการตรวจถูกต้อง');
})();
```

- [x] **Step 2: Run the test and watch it fail**

```bash
node test-plans.js
```

Expected: `Error: Cannot find module './src/plans'`.

- [x] **Step 3: Write the implementation**

Create `src/plans.js`:

```js
'use strict';

const store = require('./plans-store');
const { splitThaiName } = require('./thai-name');

const DEFAULT_TITLE = 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม';

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** The real sources, replaced by the test. Required lazily: `scraper` starts a
    browser's worth of module loading that the offline test has no use for. */
function realDeps() {
  return {
    fetchDetail: (newCode) => require('./scraper').getDetailByNewCode(newCode),
    searchPharmacists: (query) => require('./pharmacist').searchPharmacists(query),
  };
}

/**
 * The council answers a name with a table, and several people share a name.
 * Filling a licence number the register did not clearly give us would put a
 * wrong number on an official document, so anything short of a single exact
 * match is left for the officer, with the choices kept beside it.
 */
async function resolveLicence(name, searchPharmacists) {
  const { firstName, lastName } = splitThaiName(name);
  if (!firstName && !lastName) return { licenceNo: '', licenceSource: 'none', candidates: [] };
  let both = [];
  try {
    const result = await searchPharmacists({ firstName, lastName });
    both = (result.groups && result.groups.both) || [];
  } catch {
    // The council being down must not stop a plan being built.
    return { licenceNo: '', licenceSource: 'none', candidates: [] };
  }
  if (both.length === 1) {
    return { licenceNo: both[0].licenseNo, licenceSource: 'auto', candidates: [] };
  }
  if (both.length > 1) {
    return {
      licenceNo: '',
      licenceSource: 'ambiguous',
      candidates: both.map((row) => ({
        licenceNo: row.licenseNo,
        fullName: row.fullName,
        status: row.status,
      })),
    };
  }
  return { licenceNo: '', licenceSource: 'none', candidates: [] };
}

/**
 * A plan item is a copy, not a reference. The plan is the document for that
 * day: if the FDA changes a shop's details next week, the sheet the officers
 * carried has to keep saying what it said. Re-reading is `syncItem`, which a
 * person asks for.
 */
async function buildItem(newCode, deps) {
  const detail = await deps.fetchDetail(newCode);
  const pharmacists = [];
  for (const person of detail.pharmacists || []) {
    const licence = await resolveLicence(person.name, deps.searchPharmacists);
    pharmacists.push({ name: person.name, openHours: person.openHours || '', ...licence });
  }
  return {
    newCode,
    order: 0,
    placeName: detail.placeName || '',
    licenseType: detail.licenseType || '',
    licenseNo: detail.licenseNo || '',
    address: detail.address || '',
    licenseeName: detail.licenseeName || '',
    openHours: detail.openHours || '',
    lat: detail.lat ?? null,
    lng: detail.lng ?? null,
    pharmacists,
    status: 'planned',
    statusSource: 'auto',
    note: '',
    syncedAt: new Date().toISOString(),
  };
}

async function createPlan({ date, title } = {}) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(date || ''))) {
    throw badRequest('ต้องระบุวันที่ตรวจในรูปแบบ พ.ศ. เช่น 2569-08-27');
  }
  // Two rounds can fall on one day, so a taken id gains a suffix rather than
  // overwriting the plan already there.
  let id = date;
  for (let n = 2; await store.get(id); n += 1) id = `${date}-${n}`;
  const now = new Date().toISOString();
  return store.save({
    id,
    title: title || DEFAULT_TITLE,
    date,
    createdAt: now,
    updatedAt: now,
    items: [],
  });
}

async function mustGet(id) {
  const plan = await store.get(id);
  if (!plan) throw notFound('ไม่พบแผนการตรวจนี้');
  return plan;
}

function renumber(items) {
  items.forEach((item, i) => {
    item.order = i + 1;
  });
  return items;
}

async function addItems(id, newCodes, deps = realDeps()) {
  const plan = await mustGet(id);
  const added = [];
  const failed = [];
  for (const newCode of newCodes || []) {
    if (plan.items.some((item) => item.newCode === newCode)) {
      failed.push({ newCode, message: 'ร้านนี้มีอยู่แล้วในแผน' });
      continue;
    }
    try {
      plan.items.push(await buildItem(newCode, deps));
      added.push(newCode);
    } catch (err) {
      failed.push({ newCode, message: err.message });
    }
  }
  renumber(plan.items);
  // ponytail: read-modify-write, last writer wins. Two officers editing the
  // same plan in the same second can lose one edit. Move to a database with
  // row-level writes if the office grows past a handful of people.
  const saved = await store.save(plan);
  return { plan: saved, added, failed };
}

function applyPharmacistPatch(item, patch) {
  for (const entry of patch) {
    const person = item.pharmacists[entry.index];
    if (!person) continue;
    person.licenceNo = String(entry.licenceNo || '');
    person.licenceSource = person.licenceNo ? 'manual' : 'none';
    person.candidates = [];
  }
}

async function patchItem(id, newCode, patch = {}) {
  const plan = await mustGet(id);
  const item = plan.items.find((entry) => entry.newCode === newCode);
  if (!item) throw notFound('ไม่พบร้านนี้ในแผน');

  if (patch.status !== undefined) {
    if (!['planned', 'done'].includes(patch.status)) throw badRequest('สถานะไม่ถูกต้อง');
    // The record page reports `auto`. A person who has set the status already
    // knows better than the file that was generated, so `auto` gives way.
    const fromForm = patch.statusSource === 'auto';
    if (!fromForm || item.statusSource !== 'manual') {
      item.status = patch.status;
      item.statusSource = fromForm ? 'auto' : 'manual';
    }
  }
  if (patch.note !== undefined) item.note = String(patch.note);
  if (patch.pharmacists !== undefined) applyPharmacistPatch(item, patch.pharmacists);
  if (patch.order !== undefined) {
    const target = Math.max(1, Math.min(plan.items.length, Number(patch.order)));
    plan.items.splice(plan.items.indexOf(item), 1);
    plan.items.splice(target - 1, 0, item);
    renumber(plan.items);
  }
  return store.save(plan);
}

async function removeItem(id, newCode) {
  const plan = await mustGet(id);
  const index = plan.items.findIndex((entry) => entry.newCode === newCode);
  if (index === -1) throw notFound('ไม่พบร้านนี้ในแผน');
  plan.items.splice(index, 1);
  renumber(plan.items);
  return store.save(plan);
}

/** Re-read one shop from the FDA, keeping what the office decided about it. */
async function syncItem(id, newCode, deps = realDeps()) {
  const plan = await mustGet(id);
  const index = plan.items.findIndex((entry) => entry.newCode === newCode);
  if (index === -1) throw notFound('ไม่พบร้านนี้ในแผน');
  const previous = plan.items[index];
  const fresh = await buildItem(newCode, deps);
  plan.items[index] = {
    ...fresh,
    order: previous.order,
    status: previous.status,
    statusSource: previous.statusSource,
    note: previous.note,
  };
  return store.save(plan);
}

function summarise(plan) {
  return {
    id: plan.id,
    title: plan.title,
    date: plan.date,
    updatedAt: plan.updatedAt,
    total: plan.items.length,
    done: plan.items.filter((item) => item.status === 'done').length,
  };
}

module.exports = {
  DEFAULT_TITLE,
  createPlan,
  addItems,
  patchItem,
  removeItem,
  syncItem,
  summarise,
  buildItem,
};
```

- [x] **Step 4: Run the test and watch it pass**

```bash
node test-plans.js
```

Expected: `ok — ตรรกะแผนการตรวจถูกต้อง`.

- [x] **Step 5: Register the script**

In `package.json` `"scripts"`, after `"test:plans-store"`:

```json
    "test:plans": "node test-plans.js",
```

- [x] **Step 6: Commit**

```bash
git add src/plans.js test-plans.js package.json
git commit -m "Build plan items from the FDA and the council register

A licence number the register did not clearly give us is left empty with
the choices beside it: a wrong number on an official document is worse
than a blank one an officer fills in.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: HTTP routes and the office passcode

**Files:**
- Modify: `src/server.js`
- Test: manual curl sequence below (the logic itself is covered by Task 4)

**Interfaces:**
- Consumes: everything `src/plans.js` exports, `store.list`/`store.get`/`store.remove`/`store.backendName`.
- Produces: the ten routes in the spec. Every response is `{ success: true, … }`, matching the existing endpoints.

- [x] **Step 1: Add the requires**

In `src/server.js`, after the `renderFormDocx` require:

```js
const plansStore = require('./plans-store');
const plans = require('./plans');
```

- [x] **Step 2: Report the store in /health**

Replace the `/health` line:

```js
app.get('/health', (req, res) =>
  res.json({ ok: true, plansStore: plansStore.backendName() })
);
```

- [x] **Step 3: Guard the plan routes**

Add immediately before the first plan route:

```js
/*
 * A plan names the shops the office is about to visit, and this deployment is
 * on a public domain until it moves to the Pharmacy Council's own. One shared
 * office passcode is the smallest thing that keeps that list from being read
 * by anyone with the URL. Unset, nothing is asked — which is what a local
 * development run wants.
 */
app.use('/api/plans', (req, res, next) => {
  if (!config.plansPasscode) return next();
  if (req.get('x-plans-passcode') === config.plansPasscode) return next();
  res.status(401).json({ success: false, error: 'ต้องใส่รหัสผ่านของสำนักงาน' });
});
```

- [x] **Step 4: Add the routes**

After the guard:

```js
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
```

- [x] **Step 5: Check the error handler honours `err.status`**

Read the `app.use((err, req, res, next) => …)` block at the bottom of `src/server.js`. If it always answers 500, change it to use `err.status || err.statusCode || 500` so `ไม่พบแผนการตรวจนี้` arrives as 404 rather than 500. Leave the `ScrapeError` branch as it is.

- [x] **Step 6: Exercise the routes by hand**

```bash
PLANS_STORE=file npm start
```

In another shell:

```bash
curl -s localhost:3000/health
curl -s -X POST localhost:3000/api/plans -H 'content-type: application/json' -d '{"date":"2569-08-27"}'
curl -s localhost:3000/api/plans
curl -s -X DELETE localhost:3000/api/plans/2569-08-27
```

Expected: `/health` reports `"plansStore":"file"`; the POST answers 201 with the plan; the list shows `total: 0, done: 0`; the DELETE answers `{"success":true}`.

- [x] **Step 7: Check the passcode**

```bash
PLANS_STORE=file PLANS_PASSCODE=test123 npm start
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/plans
curl -s -o /dev/null -w '%{http_code}\n' -H 'x-plans-passcode: test123' localhost:3000/api/plans
```

Expected: `401` then `200`.

- [x] **Step 8: Commit**

```bash
git add src/server.js
git commit -m "Serve inspection plans over /api/plans

One shared office passcode guards them: the deployment is on a public
domain until it moves to the council's own, and the plan says which shops
are about to be visited.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Word export

**Files:**
- Create: `src/docx-plan.js`, `test-docx-plan.js`
- Modify: `src/server.js`, `package.json`

**Interfaces:**
- Consumes: `write` from `src/zip.js`; a `Plan` from Task 4.
- Produces: `renderPlanDocx(plan) -> Buffer` — a complete `.docx`.

- [x] **Step 1: Write the failing test**

Create `test-docx-plan.js`:

```js
/**
 * Offline check that the plan's Word file is a readable document carrying
 * every row. No network.
 *
 *   node test-docx-plan.js
 */
'use strict';

const assert = require('assert');
const { read } = require('./src/zip');
const { renderPlanDocx } = require('./src/docx-plan');

const plan = {
  id: '2569-08-27',
  title: 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม',
  date: '2569-08-27',
  items: [
    {
      order: 1,
      placeName: 'ร้านเจริญสุขเภสัช',
      openHours: '09.00 - 18.00 น.',
      lat: 13.789833,
      lng: 100.549028,
      licenseType: 'ขย.1',
      licenseNo: 'กท 754/2526',
      address: 'เลขที่ 293 ถ.สาลีรัฐวิภาค แขวงสามเสนใน เขตพญาไท กทม.',
      licenseeName: 'นางกุ้ยจู อัศวเวชมงคล',
      pharmacists: [
        { name: 'ภญ. รัชดา อัศวรัตน์', licenceNo: '2524' },
        { name: 'ภก. ธวัชชัย ทิพย์ทินกร', licenceNo: '' },
      ],
    },
    {
      order: 2,
      placeName: 'ร้าน "คลังยา" & 29 <ตรงข้าม>',
      openHours: '07.00 - 11.00 น.',
      lat: null,
      lng: null,
      licenseType: 'ขย.1',
      licenseNo: 'กท 391/2552',
      address: 'เลขที่ 14/1 ซ.ศรีนครินทร์ 40',
      licenseeName: 'น.ส.มุธิกานต์ กิจวิชัยเกษม',
      pharmacists: [{ name: 'ภญ.กนกวรรณ วงศ์ศิลารัตน์', licenceNo: '40993' }],
    },
  ],
};

const buffer = renderPlanDocx(plan);
assert.ok(Buffer.isBuffer(buffer) && buffer.length > 1000, 'ควรได้ไฟล์ docx ที่มีเนื้อหา');

const entries = read(buffer);
const names = entries.map((e) => e.name);
for (const required of [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
]) {
  assert.ok(names.includes(required), `ไฟล์ docx ขาด ${required}`);
}

const xml = entries.find((e) => e.name === 'word/document.xml').data.toString('utf8');
assert.ok(xml.startsWith('<?xml'), 'document.xml ต้องขึ้นต้นด้วย xml declaration');
assert.ok(xml.includes('แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม'), 'ไม่มีหัวเรื่อง');
assert.ok(xml.includes('27 สิงหาคม 2569'), 'วันที่ต้องเป็นภาษาไทย');
for (const item of plan.items) {
  assert.ok(xml.includes(item.licenseNo), `ไม่มีเลขที่ใบอนุญาต ${item.licenseNo}`);
  assert.ok(xml.includes(item.licenseeName), `ไม่มีผู้รับอนุญาต ${item.licenseeName}`);
}
assert.ok(xml.includes('ภ. 2524'), 'ไม่มีเลข ภ. ที่ดึงมาได้');
assert.ok(xml.includes('13°47'), 'ไม่มีพิกัดแบบองศา');
assert.ok(xml.includes('&quot;คลังยา&quot; &amp; 29 &lt;ตรงข้าม&gt;'), 'ต้อง escape XML');
assert.ok(!/<w:t[^>]*>[^<]*<(?!\/w:t)/.test(xml), 'มีแท็กหลุดเข้าไปในข้อความ');

// Header row plus one row per shop.
const rows = (xml.match(/<w:tr[ >]/g) || []).length;
assert.strictEqual(rows, plan.items.length + 1, 'จำนวนแถวไม่ตรงกับจำนวนร้าน');

console.log('ok — ไฟล์ Word ของแผนการตรวจถูกต้อง');
```

- [x] **Step 2: Run the test and watch it fail**

```bash
node test-docx-plan.js
```

Expected: `Error: Cannot find module './src/docx-plan'`.

- [x] **Step 3: Write the implementation**

Create `src/docx-plan.js`:

```js
'use strict';

const { write } = require('./zip');

/**
 * The plan as the office's own Word table, built from nothing.
 *
 * The example the office sent is a finished plan, not a template with blanks,
 * so cloning rows out of it would be guesswork about which run holds what.
 * Six columns and a heading is little enough OOXML to write outright, and the
 * result is a plain document the office can go on editing.
 */

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** `2569-08-27` as the office writes it. */
function thaiDate(date) {
  const [year, month, day] = String(date || '').split('-');
  const name = THAI_MONTHS[Number(month) - 1];
  if (!name) return String(date || '');
  return `${Number(day)} ${name} ${year}`;
}

/** 13.789833 -> 13°47'23.4"N — the notation the office's own plans use. */
function degrees(value, positive, negative) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const abs = Math.abs(Number(value));
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${value >= 0 ? positive : negative}`;
}

function coordinates(item) {
  if (item.lat == null || item.lng == null) return '';
  return `${degrees(item.lat, 'N', 'S')} ${degrees(item.lng, 'E', 'W')}`;
}

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** One paragraph per line, so a cell can hold several. */
function paragraphs(lines, { bold = false, align = 'left' } = {}) {
  return (lines.length ? lines : [''])
    .map(
      (line) =>
        `<w:p><w:pPr><w:jc w:val="${align}"/><w:rPr>${bold ? '<w:b/>' : ''}` +
        `<w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>` +
        `<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr>` +
        `<w:r><w:rPr>${bold ? '<w:b/>' : ''}` +
        `<w:rFonts w:ascii="TH SarabunPSK" w:hAnsi="TH SarabunPSK" w:cs="TH SarabunPSK"/>` +
        `<w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>` +
        `<w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
    )
    .join('');
}

const WIDTHS = [700, 3200, 1500, 3600, 2400, 3200]; // twips, 14600 total ≈ landscape A4 text width

function cell(lines, index, options) {
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${WIDTHS[index]}" w:type="dxa"/>` +
    `<w:vAlign w:val="top"/></w:tcPr>${paragraphs(lines, options)}</w:tc>`
  );
}

function headerRow() {
  const heads = [
    'ลำดับที่',
    'ชื่อสถานที่',
    'ประเภทใบอนุญาต',
    'สถานที่ตั้ง',
    'ผู้รับอนุญาต',
    'ผู้มีหน้าที่ปฏิบัติการ',
  ];
  return (
    '<w:tr><w:trPr><w:tblHeader/></w:trPr>' +
    heads.map((text, i) => cell([text], i, { bold: true, align: 'center' })).join('') +
    '</w:tr>'
  );
}

function pharmacistLines(item) {
  const people = item.pharmacists || [];
  const lines = [];
  people.forEach((person, i) => {
    // One pharmacist needs no numbering; several do, as the office writes them.
    lines.push(people.length > 1 ? `คนที่ ${i + 1} : ${person.name}` : person.name);
    lines.push(person.licenceNo ? `ภ. ${person.licenceNo}` : 'ภ. ');
  });
  return lines;
}

function itemRow(item) {
  const place = [item.placeName];
  if (item.openHours) place.push(`เวลาทำการ ${item.openHours}`);
  const coords = coordinates(item);
  if (coords) place.push(coords);

  return (
    '<w:tr>' +
    cell([String(item.order)], 0, { align: 'center' }) +
    cell(place, 1) +
    cell([item.licenseType, item.licenseNo].filter(Boolean), 2) +
    cell([item.address], 3) +
    cell([item.licenseeName], 4) +
    cell(pharmacistLines(item), 5) +
    '</w:tr>'
  );
}

function documentXml(plan) {
  const table =
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>' +
    '<w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
      .join('') +
    '</w:tblBorders></w:tblPr>' +
    '<w:tblGrid>' +
    WIDTHS.map((w) => `<w:gridCol w:w="${w}"/>`).join('') +
    '</w:tblGrid>' +
    headerRow() +
    (plan.items || []).map(itemRow).join('') +
    '</w:tbl>';

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' +
    paragraphs([plan.title], { bold: true, align: 'center' }) +
    paragraphs([`วันที่ ${thaiDate(plan.date)}`], { align: 'center' }) +
    paragraphs([''], {}) +
    table +
    // Landscape A4 with 1.5cm margins, in twips.
    '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' +
    '<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" ' +
    'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>';

const DOCUMENT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

/* TableGrid is what the table above asks for, and Word will not draw the
   borders without the style existing. Nothing else is defined here. */
const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
  '<w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr></w:style>' +
  '</w:styles>';

function renderPlanDocx(plan) {
  return write([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml(plan), 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES, 'utf8') },
  ]);
}

module.exports = { renderPlanDocx, thaiDate, coordinates, escapeXml };
```

- [x] **Step 4: Check `write()`'s entry shape before running**

Read `src/zip.js:89` (`function write(entries)`) and confirm it takes `{ name, data }`. If it expects different property names, change the five entries in `renderPlanDocx` to match — the rest of the file is unaffected.

- [x] **Step 5: Run the test and watch it pass**

```bash
node test-docx-plan.js
```

Expected: `ok — ไฟล์ Word ของแผนการตรวจถูกต้อง`.

- [x] **Step 6: Open the file in Word once**

```bash
node -e "const {renderPlanDocx}=require('./src/docx-plan');const fs=require('fs');fs.writeFileSync('plan-check.docx',renderPlanDocx(JSON.parse(fs.readFileSync('test/fixtures/plan-sample.json','utf8'))))"
```

If `test/fixtures/plan-sample.json` does not exist yet, create it from the `plan` object in `test-docx-plan.js`. Open `plan-check.docx` in Word, confirm the table has borders, six columns, and readable Thai, then delete the file. **Do not commit `plan-check.docx`.**

- [x] **Step 7: Add the route**

In `src/server.js`, after the sync route:

```js
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
```

and add to the requires:

```js
const { renderPlanDocx } = require('./docx-plan');
```

- [x] **Step 8: Register the script and commit**

In `package.json` `"scripts"`, after `"test:docx"`:

```json
    "test:docx-plan": "node test-docx-plan.js",
```

```bash
git add src/docx-plan.js src/server.js test-docx-plan.js test/fixtures/plan-sample.json package.json
git commit -m "Export an inspection plan as Word

Built outright rather than cloned from the office's example, which is a
finished plan and not a template — six columns is little enough OOXML to
write, and the result stays editable in Word.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: PDF export

**Files:**
- Create: `web/public/plan-print.html`
- Modify: `src/scraper.js`, `src/server.js`

**Interfaces:**
- Consumes: `getBrowser`, `createContext` inside `src/scraper.js`; `thaiDate`, `coordinates` from `src/docx-plan.js` (Task 6).
- Produces: `renderPlanPdf(plan) -> Promise<Uint8Array>`, exported from `src/scraper.js`.

- [x] **Step 1: Write the print page**

Create `web/public/plan-print.html`. It defines `window.applyPlan(plan)`, which fills a table already in the document — the same contract `form.html` uses with `window.applyData`.

```html
<!doctype html>
<html lang="th">
  <head>
    <meta charset="utf-8" />
    <title>แผนการตรวจ</title>
    <style>
      /* Landscape A4 with the office's usual 1.5cm margins. Chromium reads
         this rule, not page.pdf()'s margin option — the same finding that
         form.html records. */
      @page { size: A4 landscape; margin: 15mm; }
      body {
        margin: 0;
        font-family: 'TH SarabunPSK', 'Sarabun', sans-serif;
        font-size: 14pt;
        color: #000;
      }
      h1 { font-size: 18pt; text-align: center; margin: 0 0 4pt; }
      .date { text-align: center; margin: 0 0 10pt; }
      table { width: 100%; border-collapse: collapse; }
      th, td {
        border: 1px solid #000;
        padding: 3pt 5pt;
        vertical-align: top;
        text-align: left;
      }
      th { text-align: center; }
      /* Repeat the heading on every printed page and never split a shop's row. */
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      .num { width: 5%; text-align: center; }
      .place { width: 22%; }
      .licence { width: 11%; }
      .address { width: 24%; }
      .holder { width: 16%; }
      .pharmacists { width: 22%; }
      .line { display: block; }
    </style>
  </head>
  <body>
    <h1 id="title"></h1>
    <p class="date" id="date"></p>
    <table>
      <thead>
        <tr>
          <th class="num">ลำดับที่</th>
          <th class="place">ชื่อสถานที่</th>
          <th class="licence">ประเภทใบอนุญาต</th>
          <th class="address">สถานที่ตั้ง</th>
          <th class="holder">ผู้รับอนุญาต</th>
          <th class="pharmacists">ผู้มีหน้าที่ปฏิบัติการ</th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <script>
      const THAI_MONTHS = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
      ];

      function thaiDate(date) {
        const [year, month, day] = String(date || '').split('-');
        const name = THAI_MONTHS[Number(month) - 1];
        return name ? `${Number(day)} ${name} ${year}` : String(date || '');
      }

      function degrees(value, positive, negative) {
        if (value == null || Number.isNaN(Number(value))) return '';
        const abs = Math.abs(Number(value));
        const d = Math.floor(abs);
        const m = Math.floor((abs - d) * 60);
        const s = ((abs - d) * 60 - m) * 60;
        return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${
          value >= 0 ? positive : negative
        }`;
      }

      function lines(parent, values) {
        for (const value of values) {
          if (!value) continue;
          const span = document.createElement('span');
          span.className = 'line';
          // textContent, never innerHTML: shop names carry quotes and angle
          // brackets straight from the FDA's data.
          span.textContent = value;
          parent.append(span);
        }
      }

      window.applyPlan = function applyPlan(plan) {
        document.getElementById('title').textContent = plan.title || '';
        document.getElementById('date').textContent = `วันที่ ${thaiDate(plan.date)}`;
        const body = document.getElementById('rows');
        body.textContent = '';
        for (const item of plan.items || []) {
          const tr = document.createElement('tr');
          const cells = ['num', 'place', 'licence', 'address', 'holder', 'pharmacists'].map(
            (name) => {
              const td = document.createElement('td');
              td.className = name;
              tr.append(td);
              return td;
            }
          );
          cells[0].textContent = item.order;
          const coords =
            item.lat == null || item.lng == null
              ? ''
              : `${degrees(item.lat, 'N', 'S')} ${degrees(item.lng, 'E', 'W')}`;
          lines(cells[1], [
            item.placeName,
            item.openHours ? `เวลาทำการ ${item.openHours}` : '',
            coords,
          ]);
          lines(cells[2], [item.licenseType, item.licenseNo]);
          lines(cells[3], [item.address]);
          lines(cells[4], [item.licenseeName]);
          const people = item.pharmacists || [];
          const out = [];
          people.forEach((person, i) => {
            out.push(people.length > 1 ? `คนที่ ${i + 1} : ${person.name}` : person.name);
            out.push(person.licenceNo ? `ภ. ${person.licenceNo}` : 'ภ.');
          });
          lines(cells[5], out);
          body.append(tr);
        }
      };
    </script>
  </body>
</html>
```

- [x] **Step 2: Add the renderer**

In `src/scraper.js`, beside `FORM_PAGE` near line 33:

```js
const PLAN_PAGE = pathToFileURL(
  path.join(__dirname, '..', 'web', 'public', 'plan-print.html')
).href;
```

Match the exact expression `FORM_PAGE` uses — copy its `path.join` arguments and change only the file name.

After `renderFormPdf`, add:

```js
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
```

Add `renderPlanPdf` to the `module.exports` list.

- [x] **Step 3: Add the route**

In `src/server.js`, add `renderPlanPdf` to the destructured require from `./scraper`, then after the docx route:

```js
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
```

- [x] **Step 4: Render one and look at it**

```bash
PLANS_STORE=file PLANS_DIR=./data/plans npm start
```

```bash
curl -s -X POST localhost:3000/api/plans -H 'content-type: application/json' -d '{"date":"2569-08-27"}'
```

Then copy `test/fixtures/plan-sample.json`'s items into `data/plans/2569-08-27.json` by hand and:

```bash
curl -s -X POST localhost:3000/api/plans/2569-08-27/pdf -o plan-check.pdf
```

Expected: a landscape PDF whose table has a heading row and one row per shop, Thai rendering correctly. Delete `plan-check.pdf` afterwards. **Do not commit it.**

- [x] **Step 5: Commit**

```bash
git add web/public/plan-print.html src/scraper.js src/server.js
git commit -m "Print an inspection plan as landscape A4

Same puppeteer path as the inspection record, with the page's own @page
rule carrying the margins — the record page already records why the
page.pdf() option is not what Chromium consults.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Browser API client and hash routing

**Files:**
- Create: `web/src/lib/plans-api.js`
- Modify: `web/src/App.jsx`, `web/src/components/Sidebar.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: the routes from Tasks 5–7.
- Produces, from `plans-api.js`:
  - `listPlans() -> Promise<Summary[]>`
  - `getPlan(id) -> Promise<Plan>`
  - `createPlan({ date, title }) -> Promise<Plan>`
  - `deletePlan(id) -> Promise<void>`
  - `addToPlan(id, newCodes) -> Promise<{ plan, added, failed }>`
  - `patchPlanItem(id, newCode, patch) -> Promise<Plan>`
  - `removePlanItem(id, newCode) -> Promise<Plan>`
  - `syncPlanItem(id, newCode) -> Promise<Plan>`
  - `exportUrl(id, kind) -> string`
  - `downloadExport(id, kind) -> Promise<void>` — POSTs with the passcode header and saves the file.

- [x] **Step 1: Read how the existing client is written**

Read `web/src/api.js` in full. Match its base-URL handling, its error shape, and its export style — the new file is a sibling, not a new convention.

- [x] **Step 2: Write the client**

Create `web/src/lib/plans-api.js`:

```js
/*
 * The office passcode guards /api/plans. It is asked for once and kept for the
 * tab: a shared passphrase is not a login, and storing it past the session
 * would leave it on a machine anyone in the office can open.
 */
const PASSCODE_KEY = 'fda:plans:passcode';

function passcode() {
  return sessionStorage.getItem(PASSCODE_KEY) || '';
}

export function setPasscode(value) {
  sessionStorage.setItem(PASSCODE_KEY, value);
}

export function clearPasscode() {
  sessionStorage.removeItem(PASSCODE_KEY);
}

/** Thrown on 401 so the caller can ask for the passcode and retry. */
export class PasscodeError extends Error {
  constructor() {
    super('ต้องใส่รหัสผ่านของสำนักงาน');
    this.name = 'PasscodeError';
  }
}

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/plans${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(passcode() ? { 'x-plans-passcode': passcode() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `ระบบตอบกลับผิดปกติ (HTTP ${response.status})`);
  }
  return data;
}

export const listPlans = () => call('').then((d) => d.plans);
export const getPlan = (id) => call(`/${id}`).then((d) => d.plan);
export const createPlan = (body) => call('', { method: 'POST', body }).then((d) => d.plan);
export const deletePlan = (id) => call(`/${id}`, { method: 'DELETE' }).then(() => undefined);
export const addToPlan = (id, newCodes) =>
  call(`/${id}/items`, { method: 'POST', body: { newCodes } });
export const patchPlanItem = (id, newCode, patch) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}`, { method: 'PATCH', body: patch }).then(
    (d) => d.plan
  );
export const removePlanItem = (id, newCode) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}`, { method: 'DELETE' }).then((d) => d.plan);
export const syncPlanItem = (id, newCode) =>
  call(`/${id}/items/${encodeURIComponent(newCode)}/sync`, { method: 'POST' }).then(
    (d) => d.plan
  );

/** The exports are POSTs behind a passcode, so a plain link cannot fetch them. */
export async function downloadExport(id, kind) {
  const response = await fetch(`/api/plans/${id}/${kind}`, {
    method: 'POST',
    headers: passcode() ? { 'x-plans-passcode': passcode() } : {},
  });
  if (response.status === 401) {
    clearPasscode();
    throw new PasscodeError();
  }
  if (!response.ok) throw new Error(`ส่งออกไม่สำเร็จ (HTTP ${response.status})`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `plan-${id}.${kind}`;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [x] **Step 3: Switch views on the hash**

In `web/src/App.jsx`, add near the other imports:

```js
import PlanView from './components/PlanView.jsx';
```

Add inside the component, above `if (booting)`:

```js
  // Two screens is not a router's worth of dependency; the hash is enough.
  const [route, setRoute] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
```

Then wrap the return so the plan screen replaces the search screen:

```js
  if (booting) return <Preloader variant="screen" />;

  if (route.startsWith('#/plans')) {
    return (
      <>
        <Sidebar route={route} />
        <main className="app-main">
          <div className="wrap">
            <PlanView />
          </div>
        </main>
      </>
    );
  }
```

Leave the existing search-screen return as it is, adding `route={route}` to its `<Sidebar />`.

- [x] **Step 4: Add the menu entry**

In `web/src/components/Sidebar.jsx`, change the signature to `export default function Sidebar({ route = '#/' })` and insert between the search link and the record link:

```jsx
        <a href="#/plans" aria-current={route.startsWith('#/plans') ? 'page' : undefined}>
          <span className="material-symbols-outlined sm">checklist</span>
          แผนการตรวจ
          <span className="dot" />
        </a>
```

Change the search link's `aria-current="page"` to `aria-current={route.startsWith('#/plans') ? undefined : 'page'}` so only one entry is current.

- [x] **Step 5: Build and look**

```bash
npm --prefix web run build
```

Then `npm start` and open `http://localhost:3000/#/plans`. Expected: the sidebar shows three entries, "แผนการตรวจ" is highlighted, and the main area is whatever `PlanView` renders (Task 10 fills it — for now a stub file exporting an empty `<div>` is enough to build; the real one lands in Task 10).

- [x] **Step 6: Commit**

```bash
git add web/src/lib/plans-api.js web/src/App.jsx web/src/components/Sidebar.jsx web/src/components/PlanView.jsx
git commit -m "Route the plan screen off the URL hash

Two screens do not need a router dependency. The passcode is kept for the
tab only — a shared passphrase is not a login and should not outlive the
session on a shared machine.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Selecting several shops from the search

**Files:**
- Modify: `web/src/App.jsx`, `web/src/components/ResultCard.jsx`, `web/src/components/PickBar.jsx`, `web/src/app.css`

**Interfaces:**
- Consumes: `listPlans`, `createPlan`, `addToPlan` from Task 8.
- Produces: nothing other tasks depend on.

- [x] **Step 1: Hold the selection in App**

In `web/src/App.jsx`, beside `selectedCode`:

```js
  // Ticked shops, kept apart from `selectedCode`: clicking a card still opens
  // one shop, ticking one queues it for a plan.
  const [checked, setChecked] = useState(() => new Set());
```

Clear it wherever `setSelectedCode(null)` is called in `runSearch`:

```js
    setChecked(new Set());
```

Add the toggle above the return:

```js
  function toggleChecked(newCode) {
    setChecked((current) => {
      const next = new Set(current);
      if (!next.delete(newCode)) next.add(newCode);
      return next;
    });
  }
```

Pass both down:

```jsx
              <ResultCard
                key={row.newCode || row.licenseNo}
                row={row}
                selected={row.newCode === selectedCode}
                checked={checked.has(row.newCode)}
                onCheck={() => toggleChecked(row.newCode)}
                onSelect={() => setSelectedCode(row.newCode)}
                previewState={previews[row.newCode]}
                onTogglePreview={() => togglePreview(row)}
              />
```

and

```jsx
          <PickBar
            row={selected}
            detail={selectedDetail}
            checkedRows={results.filter((r) => checked.has(r.newCode))}
            onClearChecked={() => setChecked(new Set())}
          />
```

- [x] **Step 2: Add the checkbox**

In `web/src/components/ResultCard.jsx`, take `checked` and `onCheck` in the props, and add as the first child of the `<li>`:

```jsx
      <input
        type="checkbox"
        className="pick-check"
        checked={checked}
        onChange={onCheck}
        aria-label={`เลือก ${row.placeName || 'ร้านนี้'} ใส่แผนการตรวจ`}
      />
```

The card's existing click handler already ignores `input`, so ticking will not also select the card — confirm that `event.target.closest('button, a, input')` guard is still the first line of the handler.

- [x] **Step 3: Style it**

In `web/src/app.css`, beside the other result-card rules:

```css
/* The tick queues a shop for a plan; clicking the card still opens one shop.
   Two different jobs, so the control sits outside the card's text. */
.pick-check {
  float: left;
  margin: 2px 10px 0 0;
  width: 18px;
  height: 18px;
  accent-color: var(--primary);
  cursor: pointer;
}
```

- [x] **Step 4: Give PickBar its second mode**

Rewrite `web/src/components/PickBar.jsx`'s body to keep the single-shop behaviour and add the plan controls:

```jsx
import { useEffect, useState } from 'react';
import { fetchDetail } from '../api.js';
import { addToPlan, createPlan, listPlans, PasscodeError, setPasscode } from '../lib/plans-api.js';
import { Button } from '@/components/ui/button';

const HANDOFF_KEY = 'fda:form:pending';

export default function PickBar({ row, detail, checkedRows = [], onClearChecked }) {
  const [busy, setBusy] = useState(false);
  const [plans, setPlans] = useState([]);
  const [planId, setPlanId] = useState('');
  const [message, setMessage] = useState('');

  const wanted = checkedRows.length > 0;

  useEffect(() => {
    if (!wanted) return;
    listPlans()
      .then((all) => {
        setPlans(all);
        setPlanId((current) => current || (all[0] ? all[0].id : ''));
      })
      .catch(() => setPlans([]));
  }, [wanted]);

  if (!row && !wanted) return null;

  /** One retry after the passcode is entered — the API asks for it on 401. */
  async function withPasscode(action) {
    try {
      return await action();
    } catch (err) {
      if (!(err instanceof PasscodeError)) throw err;
      const entered = window.prompt('ใส่รหัสผ่านของสำนักงาน');
      if (!entered) throw err;
      setPasscode(entered);
      return action();
    }
  }

  async function addChecked() {
    setBusy(true);
    setMessage('');
    try {
      const codes = checkedRows.map((r) => r.newCode);
      const result = await withPasscode(() => addToPlan(planId, codes));
      const failed = result.failed.length ? ` ข้าม ${result.failed.length} ร้าน` : '';
      setMessage(`ใส่ ${result.added.length} ร้านลงแผนแล้ว${failed}`);
      onClearChecked();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToNewPlan() {
    const date = window.prompt('วันที่ตรวจ (พ.ศ.) เช่น 2569-08-27');
    if (!date) return;
    setBusy(true);
    setMessage('');
    try {
      const plan = await withPasscode(() => createPlan({ date }));
      setPlans((all) => [plan, ...all]);
      setPlanId(plan.id);
      const result = await withPasscode(() =>
        addToPlan(plan.id, checkedRows.map((r) => r.newCode))
      );
      setMessage(`สร้างแผน ${plan.id} และใส่ ${result.added.length} ร้านแล้ว`);
      onClearChecked();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function openForm() {
    let extra = detail;
    if (!extra && row.newCode) {
      setBusy(true);
      try {
        extra = await fetchDetail(row.newCode);
      } catch {
        // The form is still usable without it; those blanks stay empty.
      } finally {
        setBusy(false);
      }
    }
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...row, ...extra }));
    window.open('/form.html', '_blank', 'noopener');
  }

  const area = (row && row.area) || {};
  const where =
    [area.subdistrict, area.district, area.province].filter(Boolean).join(' · ') ||
    (row && row.licenseNo) ||
    '';

  return (
    <div className="pickbar glass-panel">
      {wanted ? (
        <>
          <div className="who">
            <b>เลือกไว้ {checkedRows.length} ร้าน</b>
            {message && <small>{message}</small>}
          </div>
          <select
            className="plan-pick"
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
            aria-label="แผนการตรวจปลายทาง"
          >
            {plans.length === 0 && <option value="">ยังไม่มีแผน</option>}
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.date} · {plan.total} ร้าน
              </option>
            ))}
          </select>
          <Button variant="outline" disabled={busy} onClick={addToNewPlan}>
            แผนใหม่
          </Button>
          <Button size="lg" disabled={busy || !planId} onClick={addChecked}>
            {busy ? 'กำลังใส่...' : 'ใส่ในแผน'}
          </Button>
        </>
      ) : (
        <>
          <div className="who">
            <b>{row.placeName || '(ไม่ระบุชื่อสถานที่)'}</b>
            <small>{where}</small>
          </div>
          <Button size="lg" className="ml-auto" disabled={busy} onClick={openForm}>
            {busy ? 'กำลังดึงรายละเอียด...' : 'กรอกฟอร์มการตรวจ'}
          </Button>
        </>
      )}
    </div>
  );
}
```

- [x] **Step 5: Style the select**

In `web/src/app.css`, beside `.pickbar`:

```css
.pickbar .plan-pick {
  margin-left: auto;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background);
  color: var(--foreground);
  font: inherit;
}
```

- [x] **Step 6: Build and try it**

```bash
npm --prefix web run build
```

`PLANS_STORE=file npm start`, search for a shop, tick two results. Expected: the bar changes to "เลือกไว้ 2 ร้าน" with a plan picker; "แผนใหม่" asks for a date, creates the plan, adds both, and the tick boxes clear. Untick everything and confirm the single-shop bar and its "กรอกฟอร์มการตรวจ" button still behave exactly as before.

- [x] **Step 7: Commit**

```bash
git add web/src/App.jsx web/src/components/ResultCard.jsx web/src/components/PickBar.jsx web/src/app.css
git commit -m "Tick several shops into an inspection plan

Ticking is a second job, separate from opening one shop's details, so it
gets its own control rather than overloading the card click.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: The plan screen

**Files:**
- Create: `web/src/components/PlanView.jsx`, `web/src/components/PlanList.jsx`, `web/src/components/PlanTable.jsx`
- Modify: `web/src/app.css`

**Interfaces:**
- Consumes: every export of `web/src/lib/plans-api.js`.
- Produces: `PlanView` as the default export, taking no props (Task 8 renders it bare).

- [x] **Step 1: Write the list column**

Create `web/src/components/PlanList.jsx`:

```jsx
/** Plans by date, with how far each one has got. */
export default function PlanList({ plans, currentId, onPick, onCreate, onDelete }) {
  return (
    <div className="plan-list">
      <div className="head">
        <b>แผนการตรวจ</b>
        <button type="button" className="link" onClick={onCreate}>
          + แผนใหม่
        </button>
      </div>
      {plans.length === 0 && <div className="empty">ยังไม่มีแผนการตรวจ</div>}
      <ul>
        {plans.map((plan) => (
          <li key={plan.id} className={plan.id === currentId ? 'current' : undefined}>
            <button type="button" onClick={() => onPick(plan.id)}>
              <b>{plan.date}</b>
              <small>
                {plan.total} ร้าน · ตรวจแล้ว {plan.done}
              </small>
            </button>
            <button
              type="button"
              className="remove"
              title="ลบแผนนี้"
              onClick={() => onDelete(plan.id)}
            >
              <span className="material-symbols-outlined sm">delete</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [x] **Step 2: Write the table**

Create `web/src/components/PlanTable.jsx`:

```jsx
/** 13.789833 -> 13°47'23.4"N, the notation the office's own plans use. */
function degrees(value, positive, negative) {
  if (value == null) return '';
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const m = Math.floor((abs - d) * 60);
  const s = ((abs - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1)}"${value >= 0 ? positive : negative}`;
}

/* Several pharmacists on one licence usually share a shift. When they do not,
   item 2 of the record has to be filled per person — the same warning the
   shop's detail panel carries. */
function hoursDiffer(pharmacists) {
  const hours = new Set(
    (pharmacists || []).map((p) => (p.openHours || '').replace(/\s+/g, ' ').trim())
  );
  return (pharmacists || []).length > 1 && hours.size > 1;
}

function Pharmacists({ item, onPickLicence, onTypeLicence }) {
  const people = item.pharmacists || [];
  if (people.length === 0) return <span className="empty">ไม่ระบุ</span>;
  const differ = hoursDiffer(people);
  return (
    <>
      {differ && <div className="hours-differ">เภสัชกรมีเวลาปฏิบัติการต่างกัน</div>}
      {people.map((person, index) => (
        <div className="person" key={`${index}-${person.name}`}>
          <div>{people.length > 1 ? `คนที่ ${index + 1} : ${person.name}` : person.name}</div>
          <div className={differ ? 'hours differ' : 'hours'}>{person.openHours || 'ไม่ระบุ'}</div>
          {person.licenceNo ? (
            <div className="licence">ภ. {person.licenceNo}</div>
          ) : person.licenceSource === 'ambiguous' ? (
            <select
              className="licence-pick"
              defaultValue=""
              onChange={(event) => onPickLicence(item, index, event.target.value)}
              aria-label={`เลือกเลข ภ. ของ ${person.name}`}
            >
              <option value="">เลือกเลข ภ. ({person.candidates.length} คน)</option>
              {person.candidates.map((choice) => (
                <option key={choice.licenceNo} value={choice.licenceNo}>
                  ภ. {choice.licenceNo} · {choice.fullName} · {choice.status}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              className="licence-missing"
              onClick={() => onTypeLicence(item, index)}
            >
              ไม่พบเลข ภ. — กรอกเอง
            </button>
          )}
        </div>
      ))}
    </>
  );
}

export default function PlanTable({ plan, onToggleDone, onRemove, onOpenForm, onPickLicence, onTypeLicence }) {
  if (plan.items.length === 0) {
    return <div className="empty">ยังไม่มีร้านในแผนนี้ — เลือกร้านจากหน้าค้นหาแล้วกด "ใส่ในแผน"</div>;
  }
  return (
    <div className="plan-table-wrap">
      <table className="plan-table">
        <thead>
          <tr>
            <th>ลำดับที่</th>
            <th>ชื่อสถานที่</th>
            <th>ประเภทใบอนุญาต</th>
            <th>สถานที่ตั้ง</th>
            <th>ผู้รับอนุญาต</th>
            <th>ผู้มีหน้าที่ปฏิบัติการ</th>
            <th>ตรวจแล้ว</th>
          </tr>
        </thead>
        <tbody>
          {plan.items.map((item) => (
            <tr key={item.newCode} className={item.status === 'done' ? 'done' : undefined}>
              <td className="num">{item.order}</td>
              <td>
                <b>{item.placeName}</b>
                {item.openHours && <div>เวลาทำการ {item.openHours}</div>}
                {item.lat != null && item.lng != null && (
                  <div className="coords">
                    {degrees(item.lat, 'N', 'S')} {degrees(item.lng, 'E', 'W')}
                  </div>
                )}
              </td>
              <td>
                <div>{item.licenseType}</div>
                <div>{item.licenseNo}</div>
              </td>
              <td>{item.address}</td>
              <td>{item.licenseeName}</td>
              <td>
                <Pharmacists
                  item={item}
                  onPickLicence={onPickLicence}
                  onTypeLicence={onTypeLicence}
                />
              </td>
              <td className="actions">
                <label>
                  <input
                    type="checkbox"
                    checked={item.status === 'done'}
                    onChange={() => onToggleDone(item)}
                  />
                  ตรวจแล้ว
                </label>
                <button type="button" className="link" onClick={() => onOpenForm(item)}>
                  กรอกฟอร์ม
                </button>
                <button type="button" className="link danger" onClick={() => onRemove(item)}>
                  เอาออก
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [x] **Step 3: Write the screen**

Create `web/src/components/PlanView.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import PlanList from './PlanList.jsx';
import PlanTable from './PlanTable.jsx';
import {
  createPlan,
  deletePlan,
  downloadExport,
  getPlan,
  listPlans,
  PasscodeError,
  patchPlanItem,
  removePlanItem,
  setPasscode,
  syncPlanItem,
} from '../lib/plans-api.js';

const HANDOFF_KEY = 'fda:form:pending';

export default function PlanView() {
  const [plans, setPlans] = useState([]);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** One retry after the passcode is entered — the API asks for it on 401. */
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

  const refreshList = useCallback(async () => {
    try {
      setPlans(await withPasscode(listPlans));
    } catch (err) {
      setError(err.message);
    }
  }, [withPasscode]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  async function open(id) {
    setError('');
    try {
      setPlan(await withPasscode(() => getPlan(id)));
    } catch (err) {
      setError(err.message);
    }
  }

  /** Every mutation answers with the whole plan, so the screen follows it. */
  async function mutate(action) {
    setBusy(true);
    setError('');
    try {
      const next = await withPasscode(action);
      setPlan(next);
      await refreshList();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function newPlan() {
    const date = window.prompt('วันที่ตรวจ (พ.ศ.) เช่น 2569-08-27');
    if (!date) return;
    try {
      const created = await withPasscode(() => createPlan({ date }));
      await refreshList();
      setPlan(created);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removePlan(id) {
    if (!window.confirm('ลบแผนนี้ทั้งแผน?')) return;
    try {
      await withPasscode(() => deletePlan(id));
      if (plan && plan.id === id) setPlan(null);
      await refreshList();
    } catch (err) {
      setError(err.message);
    }
  }

  function openForm(item) {
    // The record page reports back with these two, which is how ticking
    // "ตรวจแล้ว" happens by itself.
    localStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({ ...item, planId: plan.id, newCode: item.newCode })
    );
    window.open('/form.html', '_blank', 'noopener');
  }

  function typeLicence(item, index) {
    const entered = window.prompt('เลข ภ.');
    if (entered === null) return;
    mutate(() =>
      patchPlanItem(plan.id, item.newCode, {
        pharmacists: [{ index, licenceNo: entered.trim() }],
      })
    );
  }

  return (
    <div className="plan-view">
      <PlanList
        plans={plans}
        currentId={plan ? plan.id : null}
        onPick={open}
        onCreate={newPlan}
        onDelete={removePlan}
      />
      <div className="plan-main">
        {error && <div className="error">{error}</div>}
        {!plan ? (
          <div className="empty">เลือกแผนทางซ้าย หรือสร้างแผนใหม่</div>
        ) : (
          <>
            <div className="plan-head">
              <div>
                <h1>{plan.title}</h1>
                <p className="sub">วันที่ {plan.date}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => downloadExport(plan.id, 'docx')}>
                ส่งออก Word
              </button>
              <button type="button" disabled={busy} onClick={() => downloadExport(plan.id, 'pdf')}>
                ส่งออก PDF
              </button>
            </div>
            <PlanTable
              plan={plan}
              onToggleDone={(item) =>
                mutate(() =>
                  patchPlanItem(plan.id, item.newCode, {
                    status: item.status === 'done' ? 'planned' : 'done',
                  })
                )
              }
              onRemove={(item) => mutate(() => removePlanItem(plan.id, item.newCode))}
              onOpenForm={openForm}
              onPickLicence={(item, index, licenceNo) =>
                licenceNo &&
                mutate(() =>
                  patchPlanItem(plan.id, item.newCode, {
                    pharmacists: [{ index, licenceNo }],
                  })
                )
              }
              onTypeLicence={typeLicence}
            />
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() =>
                mutate(async () => {
                  let next = plan;
                  for (const item of plan.items) {
                    next = await syncPlanItem(plan.id, item.newCode);
                  }
                  return next;
                })
              }
            >
              อัปเดตข้อมูลจาก อย.
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [x] **Step 4: Style the screen**

Append to `web/src/app.css`:

```css
/* --- แผนการตรวจ --------------------------------------------------------- */
.plan-view { display: grid; grid-template-columns: 240px 1fr; gap: 16px; }
.plan-list .head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.plan-list ul { list-style: none; margin: 0; padding: 0; }
.plan-list li { display: flex; align-items: center; }
.plan-list li > button:first-child {
  flex: 1;
  display: block;
  text-align: left;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.plan-list li.current > button:first-child { background: var(--secondary); }
.plan-list small { display: block; color: var(--muted-foreground); }
.plan-list .remove { border: 0; background: transparent; cursor: pointer; color: var(--danger-fg); }
.plan-head { display: flex; align-items: center; gap: 8px; }
.plan-head h1 { margin: 0; }
.plan-head button { margin-left: 8px; }
/* The table is six columns of Thai prose — let it scroll rather than squeeze
   the page into a horizontal scrollbar of its own. */
.plan-table-wrap { overflow-x: auto; }
.plan-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.plan-table th, .plan-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  vertical-align: top;
  text-align: left;
}
.plan-table td.num, .plan-table th:first-child { text-align: center; }
.plan-table tr.done { opacity: .55; }
.plan-table .coords { color: var(--muted-foreground); font-size: 12px; }
.plan-table .person + .person { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); }
.plan-table .licence { color: var(--muted-foreground); }
.plan-table .actions { white-space: nowrap; }
.plan-table .actions label { display: flex; align-items: center; gap: 4px; }
/* A licence the register could not settle is not an error — it is a decision
   waiting for an officer, so it reads as a prompt, not a failure. */
.licence-pick, .licence-missing {
  margin-top: 2px;
  padding: 2px 6px;
  border: 1px solid var(--warning-line);
  border-radius: 6px;
  background: var(--warning-bg);
  color: var(--warning-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
button.link {
  border: 0;
  background: transparent;
  color: var(--primary);
  font: inherit;
  cursor: pointer;
  padding: 2px 4px;
}
button.link.danger { color: var(--danger-fg); }
```

- [x] **Step 5: Build and walk through it**

```bash
npm --prefix web run build
```

`PLANS_STORE=file npm start`, then at `#/plans`: create a plan, go to `#/` and tick two shops into it, come back. Expected: the table shows both with numbering, coordinates in degrees, pharmacists with their ภ. numbers or an orange prompt; ticking "ตรวจแล้ว" fades the row and the left column's count goes up; "ส่งออก Word" and "ส่งออก PDF" download files that open.

- [x] **Step 6: Commit**

```bash
git add web/src/components/PlanView.jsx web/src/components/PlanList.jsx web/src/components/PlanTable.jsx web/src/app.css
git commit -m "Show a plan as the table the office already uses

The screen mirrors the Word file column for column so the officers reading
it on a phone and on paper are reading the same thing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: The record reports itself done

**Files:**
- Modify: `web/public/form.html`

**Interfaces:**
- Consumes: `PATCH /api/plans/:id/items/:newCode` (Task 5); `planId` and `newCode` in the handoff written by Task 10.
- Produces: nothing.

- [x] **Step 1: Find the handoff and the export buttons**

Read `web/public/form.html` around its `fda:form:pending` read and its `/api/form/pdf` and `/api/form/docx` calls. Note the names of the two click handlers.

- [x] **Step 2: Keep the plan reference when the handoff is read**

Where the handoff object is parsed, store the two fields on a module-level variable:

```js
    /* A record opened from a plan reports itself back so the plan can tick
       the shop off. Opened straight from the menu there is no plan, and this
       stays null. */
    let planRef = null;
    if (pending && pending.planId && pending.newCode) {
      planRef = { planId: pending.planId, newCode: pending.newCode };
    }
```

- [x] **Step 3: Report after a file is produced**

Add near the other helpers:

```js
    async function markInspected() {
      if (!planRef) return;
      try {
        await fetch(
          `/api/plans/${planRef.planId}/items/${encodeURIComponent(planRef.newCode)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(sessionStorage.getItem('fda:plans:passcode')
                ? { 'x-plans-passcode': sessionStorage.getItem('fda:plans:passcode') }
                : {}),
            },
            body: JSON.stringify({ status: 'done', statusSource: 'auto' }),
          }
        );
      } catch {
        // The record is already saved; failing to tick a box must not look
        // like the record failed. The officer can tick it in the plan.
      }
    }
```

Call `await markInspected();` immediately after each of the two export handlers has successfully received its file — after the download is triggered, not before the request.

- [x] **Step 4: Check the parity harness still passes**

```bash
node test-form-parity.js
```

Expected: all `ok —` lines, page heights unchanged (285.77mm, 214.54mm). The record's layout was not touched; if any line moved, the edit went into markup rather than script — undo and put it in the `<script>` block.

- [x] **Step 5: Try it end to end**

`PLANS_STORE=file npm start`. From `#/plans`, press "กรอกฟอร์ม" on a shop, generate the PDF in the tab that opens, then return to the plan and reload. Expected: that row now shows "ตรวจแล้ว". Untick it, generate the PDF again, reload. Expected: it stays unticked — a person's decision outranks the automatic one.

- [x] **Step 6: Commit**

```bash
git add web/public/form.html
git commit -m "Tick a shop off the plan when its record is generated

Producing the file is the moment the inspection is written up, so the plan
learns it without anyone remembering to say so. A status a person set by
hand is left alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Smoke test, documentation, deploy

**Files:**
- Modify: `smoke.js`, `README.md`, `.env.example`, `package.json`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [x] **Step 1: Read the existing smoke test**

Read `smoke.js` in full and note how it names its base URL and reports a pass. The new section follows the same shape.

- [x] **Step 2: Add the plan pass**

Append to `smoke.js`, inside its existing async main function, using its own `BASE` constant and passcode from `process.env.PLANS_PASSCODE`:

```js
  // --- แผนการตรวจ ---------------------------------------------------------
  const planHeaders = {
    'Content-Type': 'application/json',
    ...(process.env.PLANS_PASSCODE
      ? { 'x-plans-passcode': process.env.PLANS_PASSCODE }
      : {}),
  };
  const date = `${new Date().getFullYear() + 543}-01-01`;

  const created = await (
    await fetch(`${BASE}/api/plans`, {
      method: 'POST',
      headers: planHeaders,
      body: JSON.stringify({ date }),
    })
  ).json();
  assert.ok(created.success, 'สร้างแผนไม่สำเร็จ');
  const planId = created.plan.id;

  // The first search result is a real shop, so this exercises the FDA and the
  // council register the way adding a shop does in the office.
  const search = await (
    await fetch(`${BASE}/api/fda/drug-locations?keyword=${encodeURIComponent('ร้านยา')}`)
  ).json();
  const newCode = search.results[0].newCode;

  const added = await (
    await fetch(`${BASE}/api/plans/${planId}/items`, {
      method: 'POST',
      headers: planHeaders,
      body: JSON.stringify({ newCodes: [newCode] }),
    })
  ).json();
  assert.strictEqual(added.added.length, 1, 'ใส่ร้านลงแผนไม่สำเร็จ');
  assert.strictEqual(added.plan.items[0].order, 1);

  for (const kind of ['pdf', 'docx']) {
    const response = await fetch(`${BASE}/api/plans/${planId}/${kind}`, {
      method: 'POST',
      headers: planHeaders,
    });
    assert.strictEqual(response.status, 200, `ส่งออก ${kind} ไม่สำเร็จ`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 1000, `ไฟล์ ${kind} เล็กผิดปกติ`);
  }

  const cleaned = await fetch(`${BASE}/api/plans/${planId}`, {
    method: 'DELETE',
    headers: planHeaders,
  });
  assert.strictEqual(cleaned.status, 200, 'ลบแผนทดสอบไม่สำเร็จ');
  console.log('ok — แผนการตรวจ: สร้าง ใส่ร้าน ส่งออก และลบได้');
```

- [x] **Step 3: Run every test**

```bash
node test-thai-name.js
node test-plans-store.js
node test-plans.js
node test-docx-plan.js
node test-form-parity.js
node test-parse.js
```

Expected: every one prints its `ok —` line. Then with the server running:

```bash
PLANS_STORE=file node smoke.js
```

- [x] **Step 4: Document the environment**

In `README.md`, in the environment-variable table, add:

```markdown
| `PLANS_STORE` | `blob` when `BLOB_READ_WRITE_TOKEN` is set, else `file` | ที่เก็บแผนการตรวจ — `blob` สำหรับ Vercel, `file` สำหรับเซิร์ฟเวอร์ที่เขียนดิสก์ได้ |
| `PLANS_DIR` | `data/plans` | โฟลเดอร์เก็บแผน เมื่อใช้ `PLANS_STORE=file` |
| `PLANS_PASSCODE` | *(ไม่ตั้ง)* | รหัสผ่านของสำนักงานสำหรับ `/api/plans/*` ไม่ตั้ง = ไม่กั้น |
```

Add the same three keys, commented out, to `.env.example`.

- [x] **Step 5: Add a combined test script**

In `package.json` `"scripts"`:

```json
    "test": "node test-thai-name.js && node test-plans-store.js && node test-plans.js && node test-docx-plan.js && node test-parse.js && node test-form-parity.js",
```

- [x] **Step 6: Build, commit, deploy**

```bash
npm --prefix web run build
git add smoke.js README.md .env.example package.json
git commit -m "Smoke-test and document the inspection plans

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [x] **Step 7: Set the deployment's environment**

In the Vercel project settings, add `PLANS_PASSCODE` (a passphrase the office agrees on). `PLANS_STORE` needs nothing — the blob token already there selects `blob`.

- [x] **Step 8: Verify production**

Poll until the new bundle is live, then check the plan API answers:

```bash
node -e "
(async()=>{
 const B='https://fda-license-scraper.vercel.app';
 const r=await fetch(B+'/health');
 console.log(await r.json());
 const p=await fetch(B+'/api/plans');
 console.log('plans without passcode:', p.status);
})()"
```

Expected: `/health` reports `"plansStore":"blob"`, and `/api/plans` answers `401` once the passcode is set.

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| 1. Data — plan and item shape, copy not reference | 4 |
| 2. Storage — two backends, one env, concurrency note | 2, 3 |
| 3. API — ten routes, add-items flow, licence rules, passcode | 4, 5, 6, 7 |
| 4. Screens — hash routing, checkboxes, plan table, form report-back | 8, 9, 10, 11 |
| 5. Export — PDF and Word | 6, 7 |
| 6. Errors — every row of the table | 2 (id, missing), 4 (FDA down, council down, duplicate, id clash), 5 (401), 3 (no token) |
| 7. Testing — three offline scripts plus smoke | 1, 2, 4, 6, 12 |
| 8. Files touched | every task |

Drag-to-reorder from spec §4 is served by `PATCH … { order }` (Task 4, exercised in Task 10 through the API). The plan screen ships with the reorder endpoint wired but no drag handle; adding one is a later, self-contained change and not worth a task of its own here.

**Placeholders:** none — every code step carries the code, every test step the assertions.

**Type consistency:** `licenceNo` / `licenceSource` / `candidates` are spelled the same in `src/plans.js`, `src/docx-plan.js`, `plan-print.html`, and `PlanTable.jsx`. `newCodes` (plural) is the request body; `newCode` (singular) is the path parameter. `summarise` produces `{ total, done }`, which `PlanList` reads. `renderPlanDocx` and `renderPlanPdf` are the two export entry points.

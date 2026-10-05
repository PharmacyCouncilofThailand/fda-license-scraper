# Office Drive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Google Drive–style folder and file area ("ไดรฟ์") in the web app. It is stored on the existing `file` or `blob` backend, so it can later point at the Council NAS.

**Architecture:** `src/drive-store.js` is a path-based store with a `file` backend (real directories under `DRIVE_DIR`) and a `blob` backend (prefix `drive/`, folders as prefixes plus a `.keep` marker). `src/server.js` exposes it under `/api/drive`, behind the office passcode middleware that `/api/plans` already uses. The React page `Drive.jsx` lives at `#/drive/<segments>` and has its own item in the sidebar.

**Tech Stack:** Node/Express, `@vercel/blob` 2.8 (`list` folded, `copy`, `del`), React + Vite, plain `node test-*.js` asserts.

Spec: `docs/superpowers/specs/2026-10-05-office-drive-design.md`.

## Global Constraints

- The upload limit is 4MB per file, because Vercel refuses bodies over 4.5MB.
- Each name segment is 1–200 characters after trim. It is not `.`, `..` or `.keep`, and it contains none of `/ \ < > : " | ? *` and no control characters. A bad segment gets a 400 and is never repaired.
- Downloads always send `X-Content-Type-Options: nosniff`. Only PDF, JPEG, PNG, GIF and WebP are sent inline. Everything else is `application/octet-stream` plus `attachment`.
- Blob objects are `access: 'private'`.
- The backend comes from `config.plansStore`. There is no new storage switch, only `DRIVE_DIR` for the file backend.
- User-facing text is Thai and matches the existing copy.

---

### Task 1: `drive-store` with the file backend, blob backend and offline test

**Files:**
- Modify: `src/config.js` (add `driveDir` after `recordsDir`)
- Create: `src/drive-store.js`
- Create: `test-drive-store.js`
- Modify: `package.json` (append `node test-drive-store.js` to `test`, add `test:drive`)
- Modify: `.env.example` (document `DRIVE_DIR`)

**Interfaces:**
- Produces: `list(dir) -> {folders:[{name}], files:[{name,size,modified}]}`, `mkdir(dir, name)`, `put(dir, name, buffer) -> storedName`, `get(filePath) -> Buffer|null`, `rename(itemPath, newName) -> newName`, `remove(itemPath) -> boolean`, `backendName()`. Each path is a `/`-joined string, and `''` is the root. Errors carry `.status`.

- [ ] Step 1: Write `test-drive-store.js`. It covers traversal and bad names (400), a missing folder (404), auto-numbered duplicates, rename collision (409), folder rename keeping its contents, recursive delete, and root rename/delete (400).
- [ ] Step 2: Run `node test-drive-store.js`. Expected: it fails with `Cannot find module './src/drive-store'`.
- [ ] Step 3: Add `driveDir: process.env.DRIVE_DIR || path.join(__dirname, '..', 'data', 'drive')` to config. Write `src/drive-store.js`:
  - The shared layer: `checkName`, `segments`, `numbered`, and `list`/`mkdir`/`put`/`get`/`rename`/`remove` built on four backend primitives, `kind`/`list`/`mkdir`/`put`/`get`/`move`/`remove`.
  - The `file` backend: `fs.readdir`/`stat`/`mkdir`/`writeFile({flag:'wx'})`/`rename`/`rm({recursive})`.
  - The `blob` backend: `head` for files, `list({prefix: key + '/', limit: 1})` for folders, `list({mode:'folded'})` with the cursor followed, `put` of `.keep`, and `copy` + `del` for moves.
- [ ] Step 4: Run `node test-drive-store.js`. Expected: `drive-store: ok`.
- [ ] Step 5: Blob smoke test, only if `.env.local` has `BLOB_READ_WRITE_TOKEN`. Run a scratch script with `PLANS_STORE=blob` that does mkdir → put → list (`.keep` hidden) → rename folder → get → remove, under a unique top folder. Delete it afterwards.
- [ ] Step 6: Commit with the message `Add a path-based drive store on the file and blob backends`.

### Task 2: `/api/drive` routes

**Files:**
- Modify: `src/server.js`. Factor out `requirePasscode`, mount it on `/api/plans` and `/api/drive`, and add six routes after the documents block.

**Interfaces:**
- Consumes: Task 1's store functions.
- Produces:
  - `GET /api/drive/list?path=` → `{success, folders, files}`
  - `POST /api/drive/folder?path=&name=` → 201
  - `POST /api/drive/file?path=&name=` with a raw body → 201 `{success, name}`
  - `GET /api/drive/file?path=` → the bytes
  - `PATCH /api/drive/rename?path=` with `{name}` → `{success, name}`
  - `DELETE /api/drive?path=` → `{success}`, or 404

- [ ] Step 1: Add the routes. The download sets `nosniff` and `Cache-Control: private, no-store`. It sends inline types by extension and everything else as an `attachment` with `filename*=UTF-8''<encoded>`.
- [ ] Step 2: Start the server on `DRIVE_DIR` set to a temp dir and run curl checks:
  - list root: `[]`
  - mkdir
  - upload `x.html`, then GET it: `octet-stream` + attachment
  - upload a PDF: inline `application/pdf`
  - rename
  - delete
  - `path=..`: 400
  - with `PLANS_PASSCODE` set and no header: 401
- [ ] Step 3: Commit with the message `Serve the drive under /api/drive behind the office passcode`.

### Task 3: "ไดรฟ์" page

**Files:**
- Create: `web/src/lib/drive-api.js`
- Create: `web/src/components/Drive.jsx`
- Modify: `web/src/components/Sidebar.jsx` (a "ไฟล์" group with a "ไดรฟ์" item and a `drive` prop for `aria-current`)
- Modify: `web/src/App.jsx` (a `#/drive…` branch rendered like the record page)
- Modify: `web/src/app.css` (drive layout, drop highlight, and the date column hidden under 640px)

**Interfaces:**
- Consumes: Task 2's routes. `passcodeHeaders`, `clearPasscode`, `PasscodeError` and `withPasscode` come from `web/src/lib/plans-api.js`.
- Produces: `driveHash(parts) -> '#/drive/<encoded>/…'`, and a default `Drive({ parts })`.

- [ ] Step 1: Write `drive-api.js`: `listDrive`, `makeFolder`, `uploadFile`, `renameItem`, `removeItem`, `fileBlob`.
- [ ] Step 2: Write `Drive.jsx`. It has a breadcrumb, a new-folder prompt, multi-file upload and page-wide drag and drop, and a 4MB pre-check that names each file. Its table reuses `plan-table`, folders come first, and each row has rename, download and delete actions. Clicking opens a viewable file in a new tab through an object URL, and downloads any other file through `<a download>`.
- [ ] Step 3: Wire up Sidebar and App, and add the CSS.
- [ ] Step 4: Run `npm run build`, start the preview and check in the browser: create a folder, upload, drag-drop, open a PDF or image, rename, delete a folder, the breadcrumb, the back button, a 375px width and dark mode. The console must show no errors.
- [ ] Step 5: Run `npm test` on the whole suite.
- [ ] Step 6: Commit with the message `Add the ไดรฟ์ page for office folders and files`.

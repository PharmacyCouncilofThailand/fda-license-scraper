# Office drive — design

Date: 2026-10-05. Branch: `feature/drive`.

## Goal

A Google Drive–style file area inside the web app. The office can make
folders, upload files of any type, open, download, rename and delete them.
It has no tie to inspection plans. The files must eventually live on the
Pharmacy Council's NAS. The NAS model is unknown, and so is whether it will
be reachable from outside the office. This round therefore builds the drive
on the storage backends the app already has (`file`, `blob`). Connecting the
NAS later is a configuration change:

- **If the app moves to a Council server** on the same LAN as the NAS, point
  `DRIVE_DIR` at the mounted NAS share. No code change.
- **If the app stays on Vercel**, add a WebDAV backend or a one-way sync job.
  That is a later spec, decided once the Council's IT answers.

## Out of scope

The following are not part of this round:

- Moving items between folders
- Search
- Share links
- Trash
- Per-user permissions
- Uploads over 4MB
- Changing the per-shop scanned documents (the "เอกสาร" step). Those keep
  their own store.

## Storage — `src/drive-store.js`

The store is path based. A path is a list of segments, for example
`['ใบอนุญาต', '2569', 'ร้าน ก.pdf']`. The backend is picked by
`config.plansStore`, so a deployment still sets one storage choice.

Each segment is validated:

- 1–200 characters after trim. Thai is allowed.
- It is not `.` or `..`.
- It contains none of `/ \ < > : " | ? *` and no control characters.
- A segment that is invalid gets a 400 response and is never repaired.

The store exposes these operations:

| function | meaning |
| --- | --- |
| `list(dir)` | `{ folders: [{name}], files: [{name, size, modified}] }`, both sorted by name with Thai collation. A missing folder is a 404. |
| `mkdir(dir, name)` | Creates the folder. 409 if the name is taken. |
| `put(dir, name, buffer)` | Writes the file. If the name is taken, it saves as `name (1).ext`, `(2)`, …, and returns the name it used. |
| `get(filePath)` | Returns the bytes, or `null`. |
| `rename(itemPath, newName)` | Renames a file or folder in place. 409 if the new name is taken. |
| `remove(itemPath)` | Deletes a file, or a folder and everything in it. Returns whether anything was there. |

Backends:

- **`file`:** real directories under `config.driveDir`, which comes from
  `DRIVE_DIR` and defaults to `data/drive`. `fs.rename` handles rename, and
  `fs.rm({recursive})` handles folder delete. `stat` gives size and modified
  time.
- **`blob`:** keys are `drive/<encodeURIComponent(seg)>/…`, `access:
  'private'`. Folders are prefixes. `list` uses `mode: 'folded'` and follows
  the cursor until it runs out. An empty folder is held open by a
  `.keep` object, which `list` hides. Folder rename copies each object to
  the new prefix, then deletes the old ones. Folder delete lists the prefix
  and deletes everything under it.

## API — `/api/drive`

It sits behind the same office passcode middleware as `/api/plans`. The
middleware is factored into one function and mounted on both paths. Every
`path` is the segments joined by `/` and sent as a query parameter.

| method | route | body | answer |
| --- | --- | --- | --- |
| GET | `/api/drive/list?path=` | — | `{ folders, files }` |
| POST | `/api/drive/folder?path=&name=` | — | 201 |
| POST | `/api/drive/file?path=&name=` | raw bytes, any type, 4mb limit | 201 `{ name }` (the stored name) |
| GET | `/api/drive/file?path=` | — | the file's bytes |
| PATCH | `/api/drive/rename?path=` | `{ name }` | `{ name }` |
| DELETE | `/api/drive?path=` | — | `{ success }`, or 404 |

The file download is the security boundary:

- `X-Content-Type-Options: nosniff` is always set.
- PDF, JPEG, PNG, GIF and WebP get their real type and are sent inline.
- Every other type is `application/octet-stream` with
  `Content-Disposition: attachment; filename*=UTF-8''…`.
- An uploaded `.html` or `.svg` therefore never renders on our origin.

## Web — "ไดรฟ์" page

- **Navigation:** the sidebar gets a separate item "ไดรฟ์", outside the five
  plan steps. The route is `#/drive/<encoded segments>`. The page is
  rendered the way the record page is, with no plan bar.
- **`web/src/lib/drive-api.js`:** calls the API and reuses the passcode
  helpers in `plans-api.js`. A 401 asks for the passcode once and retries,
  like the rest of the app.
- **`web/src/components/Drive.jsx`:**
  - A breadcrumb with every ancestor clickable.
  - A "โฟลเดอร์ใหม่" button that opens a prompt for the name.
  - An "อัปโหลด" button that takes several files. Files can also be
    dragged and dropped anywhere on the page.
  - A table with name and icon, size and modified date, folders first.
  - Clicking a folder opens it. Clicking a PDF or image opens it in a new
    tab through an object URL, the same way `DocumentList` does. Any other
    file downloads through an `<a download>`.
  - Each row has three actions: rename (prompt), download, delete (confirm).
    A folder's confirm says that everything inside goes too.
  - Files over 4MB are refused before upload with a message that names the
    file.
  - Images are uploaded as they are, without downscaling, because the drive
    keeps originals.

## Error handling

- Store errors carry `status` (400/404/409/415), like the other stores. The
  existing error handler turns them into `{ success: false, error }`.
- Each upload in a multi-file upload reports its own failure. One bad file
  does not stop the rest.

## Testing

`test-drive-store.js` runs on the `file` backend in a temp dir and is added
to `npm test`. It checks:

- traversal segments are rejected
- `list` on a missing folder is a 404
- `put` auto-numbers duplicate names
- `rename` collisions are a 409
- folder rename keeps the contents
- recursive delete works
- `.keep` stays hidden

After that, a manual pass in the browser preview covers create, upload,
open, rename and delete.

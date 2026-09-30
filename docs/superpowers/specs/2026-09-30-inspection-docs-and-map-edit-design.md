# Scanned inspection documents + editable map stops — design

Date: 2026-09-30 · Branch: `feature/docs-and-map-edit`

## Goal

1. Officers can keep the paper inspection form (signed at the shop) with the
   shop's record, as a photo/scan or a PDF.
2. The map step (แผนที่) lets the officer fix a shop's address/coordinates and
   change the visiting order.

## 1. Scanned documents per shop

**Where:** a new section "เอกสารที่สแกน/ถ่าย" in `RecordForm`, next to the
existing photo section, component `web/src/components/DocumentList.jsx`.

**Accepted files**
- Image (camera or picker): downscaled in the browser to a 2400px long edge,
  JPEG quality 0.85 — larger than site photos (1600px) so handwriting stays
  legible.
- PDF: stored as-is, max 4MB (Vercel's request body cap is 4.5MB). Larger
  files are refused in the browser with a message before upload.

**Per document:** name (free text, e.g. "บันทึกการตรวจ หน้า 1", saved on a
600ms debounce like photo captions), open/download, delete (with confirm).

**Data:** record gains `documents: [{ id, name, type: 'image/jpeg' |
'application/pdf', at }]`. Like `photos`, documents change only through their
own routes; the draft `PUT` keeps `base.documents` so an autosave never drops
one.

**Storage:** `src/photo-store.js` is generalised rather than copied: `putPhoto`
etc. keep working; new `putDoc/getDoc/delDoc(planId, newCode, id, type)` use
the same file/blob backends under prefix `docs/`, key
`<planId>/<code>/<id>.jpg|.pdf`, blob `access: 'private'`, correct
`contentType`.

**Routes** (under `/api/plans/:id/items/:newCode/record/documents`):
- `POST` raw body, `Content-Type` `image/jpeg` or `application/pdf`, limit
  4mb → `201 { id, record }`
- `GET /:docId` → bytes with stored content type
- `PATCH /:docId` `{ name }` → `{ record }`
- `DELETE /:docId` → `{ record }`

**Not included:** documents are not embedded into generated Word/PDF exports
(they are the original evidence, kept alongside). No OCR. No per-shop
"has documents" badge in the plan table (records live in a separate store;
add when officers ask for it).

## 2. Map step: edit address / coordinates

In `PlanRoute`, each stop has a "แก้ไข" button that opens an inline editor:
- ที่อยู่ (textarea)
- พิกัด (one text box): accepts `13.84,100.52`, or a Google Maps URL containing
  `@lat,lng`, `q=lat,lng`, `ll=lat,lng` or `!3dlat!4dlng`. Empty clears the
  coordinates. A short link (`maps.app.goo.gl`) cannot be parsed client-side:
  show "ลิงก์ย่อใช้ไม่ได้ — เปิดลิงก์แล้วคัดลอกพิกัดมาวาง".
- Parsing lives in `web/src/lib/route.js` as `parseLatLng(text)` →
  `{ lat, lng } | null | undefined` (undefined = unparseable).

**Backend:** `plans.patchItem` accepts `address` (string), `lat`/`lng` (number
or null, both-or-neither, lat ∈ [-90,90], lng ∈ [-180,180], else 400). Any of
these sets `item.locationEdited = true`. `syncItem` keeps `address`, `lat`,
`lng` from the previous item when `locationEdited` is true.

After save the route, embed map and per-leg km recompute from the returned plan.

## 3. Map step: reorder

- **Bug fix:** `PlanRoute` currently re-sorts with `orderForTrip` on every
  render, ignoring the order saved in the plan. It will show `plan.items` in
  stored order (`item.order`), same as the plan table and exports.
- Each stop row: drag handle (pointer events, no library; works with mouse and
  touch) + ↑ / ↓ buttons.
- Every move applies optimistically and persists via existing
  `PUT /api/plans/:id/order`; on failure the previous order is restored and an
  error shown.
- A "เรียงอัตโนมัติ" button on the map step runs the existing `orderForTrip`
  and saves it (same as the button on จัดแผน).

## Testing

- `test-plans.js`: patch address/lat/lng (valid, out of range, lat without
  lng), `syncItem` keeps edited location.
- `test-records-store.js`: add/rename/remove document; draft write keeps
  documents.
- New `web/src/lib/route.test.js`-style assertions in `test-route.js` for
  `parseLatLng` (plain pair, `@` URL, `q=` URL, `!3d!4d`, short link, garbage).
- Browser check: upload image + PDF, rename, open, delete; edit coordinates and
  see km change; drag + arrow reorder, reload keeps order, จัดแผน matches.

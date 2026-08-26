# FDA License Scraper API

Backend API (Express) over the Thai FDA licence-check portal
(`porta.fda.moph.go.th/fda_search_center_new`): it calls the portal's own JSON
API, filters drug-establishment results by province, and returns JSON.

The portal used to be an ASP.NET WebForms page with a Telerik grid, and this
app drove it with Puppeteer. It is an Angular app over a JSON API now, so a
search is two HTTP calls and no browser — about a second where the old walk of
the pager took a minute. Chromium is still here for one job: printing the
inspection record to PDF.

## Install & run

```bash
npm install
npm run install:web
npm run build
npm start
```

`npm run build` compiles the search page into `public/`, which is what
Express serves — **`public/` is build output, do not edit it**. The sources are
in `web/`.

While working on the UI, run the API and Vite side by side and use
`http://localhost:5173`, which proxies `/api` to port 3000:

```bash
npm start
npm run dev:web
```

Settings come from the environment, and `.env` fills them in for a local run.
Copy the sample and edit:

```bash
cp .env.example .env
```

`src/config.js` loads it with Node's own `process.loadEnvFile` — no dotenv
dependency — and a real environment variable always wins, which is how a
deployment overrides one. `.env` is not committed.

There are no secrets in here: the FDA portal is public and needs no key. What
`.env` holds is the things that change per machine or per deployment — the two
upstream URLs, the browser settings, the safety caps, and where the Word
template lives.


| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HEADLESS` | `true` | set `false` to watch the browser |
| `NAV_TIMEOUT_MS` | `45000` | upstream request timeout, and PDF navigation timeout |
| `MAX_ROWS` | `20000` | max rows kept from one search |
| `MAX_DETAILS` | `25` | max detail records fetched per search |
| `CACHE_TTL_MS` | `1800000` | how long a search stays cached (30 min) |
| `CACHE_MAX` | `50` | max cached keywords (least recently used is evicted) |
| `FDA_SEARCH_URL` | the live portal | search API (`GET_SEARCH`) |
| `FDA_DETAIL_URL` | the live portal | detail API (`GET_DATA_LOCATION_DRUG`), asked by Newcode |
| `FDA_DETAIL_PAGE_URL` | the live portal | the human-readable detail page, linked from each result |
| `FDA_SEARCH_TYPE` | `สืบค้นสถานที่ยา` | which of the portal's search modes to ask for |
| `PHARMACIST_SEARCH_URL` | the council's search form | pharmacist name → licence number lookup |
| `FORM_TEMPLATE` | `templates/inspection-form.docx` | the tokenised Word file — see "Deploying" |
| `CHROME_PATH` | auto | Chrome/Edge binary, when Puppeteer's own download is unavailable |
| `USER_AGENT` | desktop Chrome | see "WAF" below |

`npm install` normally downloads its own Chromium. If a proxy blocks that, the
app falls back to an installed Chrome or Edge (`src/config.js` → `findChrome()`),
or set `CHROME_PATH` explicitly.

## Design

Both pages use the สภาเภสัชกรรม design system — tokens, Kanit, the glass
surfaces, the gradient ground, the floating sidebar and the rounded controls —
as plain CSS in `web/public/theme.css`, shared by the React app and
`form.html`.
There is no Tailwind/shadcn layer here: this app has no build step and two
static pages, and `@theme inline` only renames the same variables for
Tailwind. Changing the org colour is the `--primary` / `--ring` / `--sidebar*`
/ `--chart-1` lines at the top of that file.

One deliberate exception: the form sheet is always black on white in the
government TH Sarabun stack, in both themes. It is an official record, so what
is on screen has to be what comes out of the printer — the design system stops
at the toolbar.

## Deploying

Two files are deliberately **not** in this repository, because the Word
template carries the inspecting officers' names:

| File | What it is | Without it |
| --- | --- | --- |
| `templates/inspection-form.docx` | the tokenised Word template | `POST /api/form/docx` fails with a clear message; PDF still works |
| `scripts/logo-source.jpg` | the raw seal artwork | nothing — `web/public/logo.png` is already built and committed |

Put the template on the machine at `templates/inspection-form.docx`, or
anywhere and point `FORM_TEMPLATE` at it:

```bash
FORM_TEMPLATE=/srv/secrets/inspection-form.docx npm start
```

To rebuild it from a revised Word file, see `scripts/build-docx-template.js`
under "Inspection form" below.

### Google Cloud Run

The same image, on a host that scales to zero between inspections. Since the search moved to the portal's JSON API, a request is about a second
and needs no browser at all; what still wants room is the PDF, which runs
Chromium.

```bash
gcloud run deploy fda-license-scraper --source . --region asia-southeast1 --memory 2Gi --cpu 2 --timeout 900 --concurrency 4 --execution-environment gen2 --allow-unauthenticated
```

Why those numbers:

| Flag | Why |
| --- | --- |
| `--memory 2Gi` | the PDF's Chromium is the memory-hungry part; 1 Gi holds it, 2 Gi leaves headroom for a second request |
| `--cpu 2` | one vCPU roughly doubles the PDF's wall clock |
| `--timeout 900` | far more than any request needs; the portal's pace varies by a factor of two |
| `--concurrency 4` | PDFs share one browser, so a high number only piles requests onto the same instance |
| `--execution-environment gen2` | gen1's sandbox is missing syscalls Chromium expects |
| `--allow-unauthenticated` | drop this to put the service behind IAM, which is worth considering — see below |

`asia-southeast1` is Singapore, the nearest region to the FDA's own servers.

Set the template URL after the first deploy:

```bash
gcloud run services update fda-license-scraper --region asia-southeast1 --set-env-vars FORM_TEMPLATE_URL=https://...
```

**Two things to decide before this is really live.** The service is public as
written, and it drives the FDA portal on behalf of whoever calls it — put it
behind IAM, or at least behind the council's own network, before the URL is
shared. And with `min-instances` at zero the first search of the morning pays
a cold start: the image is 1.69 GB, so expect ten to twenty seconds before the
first request is answered. `--min-instances 1` removes that at the cost of an
always-billed instance.

### Railway, or any container host

`Dockerfile` is the one to reach for. A search is an API call now — "ฟาสซิโน"
(233 rows) comes back in about a second — so the sizing question is only the
PDF's Chromium, which a 512 MB tier is tight for. A container is still the
better home: one browser and one warm cache serving everyone.

```bash
railway up
```

The image is deliberately plain — Debian's own Chromium, no puppeteer
download (`PUPPETEER_SKIP_DOWNLOAD=1`, `CHROME_PATH=/usr/bin/chromium`), and
the Vite build carried in from a first stage so `web/node_modules` never
ships. It runs as a non-root user and reads nothing but its own files.

Set `FORM_TEMPLATE_URL` in the service's variables; `PORT` is provided by the
platform. Everything else in `.env.example` has a working default.

**Fonts.** The record carries its own typeface: `web/public/fonts/` ships TH
SarabunPSK — the face the office's Word template names — and `form.html`
declares it in an `@font-face`, so a laptop, the container and a Vercel
function all set the sheet identically. The font is SIPA's, released under the
GNU GPL v2 or later with the font embedding exception — read straight out of
the binaries' own name ID 13, not the SIL OFL. The exception is what lets a
PDF made with it stay the office's own document. `web/public/fonts/LICENSE.txt`
carries that text so the redistribution carries it too. `fonts-thai-tlwg`
stays in the image as a fallback.

**Chromium 123 or newer.** Every blank on the record sizes itself with CSS
`field-sizing: content`, which is what makes it take the room its value needs
instead of a box of its own — the layout is built on it, not decorated with
it. On an older engine the property is ignored, every blank silently reverts
to the UA default width and the sheet stops matching the Word original. The
image below pins Debian's Chromium, which is well past that; check it if you
swap the base image or point `CHROME_PATH` at something else.

The same image runs on Fly, Render, or a machine inside the council — which
is the better answer if their IT will give you one, since the Word template
and the seal never leave the building.

### Vercel

`vercel.json` is set up for it: the build runs the Vite build into `public/`,
which is served from the CDN, and everything under `/api` goes to one
function — `api/index.js`, which is the same Express app.

```bash
vercel link
vercel --prod
```

Set these in the project's environment variables:

| Variable | Value | Why |
| --- | --- | --- |
| `PUPPETEER_SKIP_DOWNLOAD` | `1` | the deployment drives `@sparticuz/chromium`, so the 170 MB download at install time is wasted |
| `FORM_TEMPLATE_URL` | a private URL for the .docx | the template is not in the repository and, at 70 KB base64, does not fit in an environment variable |

A private Vercel Blob is the place to put the template: the file carries the
officers' names, and a private blob answers 403 to anyone without the store's
token, unlike a shared Drive link.

```bash
vercel blob create-store inspection-form --access private
vercel blob put templates/inspection-form.docx --access private --pathname inspection-form.docx
```

Point `FORM_TEMPLATE_URL` at the URL it prints. `BLOB_READ_WRITE_TOKEN` comes
with the store and needs no setting up; the template fetch sends it as a
bearer token, but only to `*.blob.vercel-storage.com` — it grants writes too,
so it must not follow `FORM_TEMPLATE_URL` to any other host.

`VERCEL` is set by the platform, and it is what switches the PDF's browser
from puppeteer's bundled Chromium to `@sparticuz/chromium`. Nothing else
changes: the same code runs locally against a real Chrome.

**The ceiling that used to be here is gone.** A function has a wall-clock
limit — 60 s on Hobby, 300 s on Pro — and a search used to be as long as the
keyword was broad: 92 s for "บ้านยา", almost all of it spent walking the
portal's pager, which meant Hobby returned broad keywords half-read behind an
"ผลลัพธ์ไม่ครบ" banner. The portal answers the whole set in one JSON response
now, so every keyword fits comfortably inside 60 s, and `MAX_PAGES`, the
browser-side slice assembly and the single-scrape queue are all gone with it.

What remains true: the keyword cache lives in the instance's memory, so it
survives only as long as that instance does, and a PDF still starts Chromium
inside the function — that is the one call that can approach the limit on a
cold start.

## Web UI

The search page is a React app (Vite, no router — it is one screen). Its state
is what the officer is doing: the keyword, the three area filters, the results,
which shop is picked, and which previews are open.

```
web/
  index.html            the page shell — fonts, theme.css, #root
  src/App.jsx           search state, and the one fetch that drives it
  src/api.js            every call to the Express API
  src/components/       Sidebar · SearchForm · Toolbar · ResultCard · Preview · PickBar · Preloader
  src/app.css           search-page styles
  public/               copied out verbatim: form.html, theme.css, logo.png
```

Tailwind v4 and shadcn/ui are wired in (`@tailwindcss/vite`, `components.json`
with `style: radix-rhea`, `baseColor: neutral`). The palette is **not**
duplicated into Tailwind: `src/index.css` only maps the variables that
`public/theme.css` already defines, through `@theme inline`, so `bg-primary`
and `--primary` are the same value and form.html keeps the same colours.
Changing the org colour is still the four lines at the top of `theme.css`.

Generated components land in `src/components/ui/`; the pick bar's action is a
shadcn `Button` and the result tags are `Badge`s. The status badge overrides
the variant colour on purpose — across a list of hundreds it has to read as
right or wrong, not as brand.

The preloader has two variants because the app has two waits: a sub-second
cover while the area tree loads, and the search itself — about a second now
that the portal answers over its API, where the old scrape took 7 to 92
seconds. The second one still counts the seconds; it simply rarely gets past
one.

The inspection form stays a plain static page. It is a print document, it has
to render identically in the officer's browser and in the headless Chromium
that makes the PDF, and React would only add a build step between those two.


`GET /` serves a one-page search UI from `public/index.html`:

- **ช่องชื่อร้านยา** — the only thing that reaches the FDA site.
- **จังหวัด → อำเภอ/เขต → ตำบล/แขวง** — three cascading dropdowns, fully
  selectable *before* the first search. They are backed by `data/areas.json`
  (77 provinces / 927 districts / 7,420 subdistricts, 210 KB), generated once
  from the `thai-address-database` package — the package is not a runtime
  dependency. After a search, options that have shops get a count appended,
  e.g. `เมืองเชียงใหม่ (9)`.
- **พรีวิว** per row — fetches that one establishment's detail pop-up through
  `/api/fda/detail` and shows ชื่อผู้รับอนุญาต / ผู้ดำเนินกิจการ / เวลาเปิด-ปิด
  inline in the card, plus a **map**. Loaded once per row, then toggled.

  The coordinates come from the FDA detail page itself: its "map :" link is a
  Google Maps URL carrying `query=<lat>,<lng>`. Records the FDA never geocoded
  carry `0,0` or no link at all, so anything outside Thailand's bounding box is
  treated as "no location" and the card offers a Google Maps search on the
  address text instead. When coordinates exist the map is an OpenStreetMap
  embed — no API key, no geocoding service, nothing to sign up for — with
  "เปิดใน Google Maps" and "เปิดใน OpenStreetMap" links beside it.
- **คัดลอก** per row (plain text) and **คัดลอกทั้งหมด** in the toolbar
  (tab-separated, pastes straight into Excel or Google Sheets).
- **เปิดแท็บใหม่ ↗** per row — the original FDA detail page.

Changing any dropdown re-filters immediately: results are cached by keyword,
so narrowing the area costs nothing.

Opening `public/index.html` straight from disk works too (the API sends
`Access-Control-Allow-Origin: *` and the page falls back to
`http://localhost:3000`), but serving it from the app is the normal path.

## Inspection form

`GET /form.html` is the record ที่ต้องกรอกหลังตรวจร้าน —
*บันทึกการตรวจสอบการประกอบวิชาชีพของผู้ประกอบวิชาชีพเภสัชกรรม*, the same two A4
pages as the paper original, as editable blanks and ☐/☑ boxes.

After a search, picking a shop — the radio, or a click anywhere on its card —
selects it, and a bar at the bottom of the results names the choice and offers
**กรอกฟอร์มการตรวจ**. One shop at a time: a record covers one establishment.
The form opens with everything the FDA already knows filled in: ชื่อสถานที่, เลขที่ / หมู่ / ซอย / ถนน / ตำบล / อำเภอ / จังหวัด,
เบอร์โทรศัพท์, ชื่อผู้รับอนุญาต, ผู้ดำเนินกิจการ, เลขที่ใบอนุญาต, เวลาทำการ, plus
today's date and time. The address parts come from `parseAddress()` — the row's
`area` object, which the search response now carries — so each one lands in its
own blank instead of one long string. Everything the officer observes on site
(เภสัชกร, บัตรประชาชน, ยาที่ขอซื้อ, the checkboxes) stays empty.

That button fetches the detail pop-up first when the preview has not already
loaded it: ชื่อผู้รับอนุญาต is the one blank that cannot be filled from memory.

Two downloads, same trip — post what is on screen, save what comes back:

- **ดาวน์โหลด PDF** renders this same page through the app's own Chromium. No PDF
  library, no font bundle, no print dialog.
- **ดาวน์โหลด Word** fills the office's own .docx and returns it, so the record
  can still be edited in Word afterwards. `templates/inspection-form.docx` is
  that file with `{{field}}` runs dropped into its blanks and `{{chk:name}}` in
  place of each ☐ — the layout, tab stops, fonts, footer and signature block
  are the originals, not a rebuild, and filling it is a string replace inside
  `word/document.xml` (`src/docx-form.js`, on the small zip reader/writer in
  `src/zip.js` — zlib does the work, so no Word library either).
  When the office revises the form, drop the new .docx in and re-run
  `node scripts/build-docx-template.js <path-to.docx>`. It fails loudly if the
  blank count or the checkbox count moved, which is the signal to re-map
  `FIELD_AT_TAB` in that script.

**พิมพ์ / บันทึกเอง** falls back to the browser's own print dialog if the API is
unreachable.

Each blank sits inline in its line, dotted-underlined and elastic — it grows
with what is typed into it, the same as a blank filled by hand. A long shop
name or address is free to run the record onto a third page, exactly as it
would in the Word original; the sheet no longer shrinks its type to force
everything onto two.

```
GET  /form.html         → the form
POST /api/form/pdf      { values: {...}, checks: {...} } → application/pdf
POST /api/form/docx     { values: {...}, checks: {...} } → .docx
```

`node smoke-form.js` checks both halves without touching the FDA site: the
address parser, that a filled form still renders to exactly two pages, and
that the Word copy comes out with every placeholder replaced.

`npm run test:parity` compares the rendered record against
`templates/inspection-form.docx` — page setup, typeface, every paragraph's
wording and size, the number of blanks, the seal, the signature table and the
footer. It skips when the template is not present, so it is a check for a
developer's machine rather than for the deployment.

## Endpoint

```
GET  /api/fda/drug-locations?keyword=<ชื่อร้านยา>&province=<จังหวัด>
POST /api/fda/drug-locations    { "keyword": "...", "province": "..." }
```

| Param | Required | Notes |
| --- | --- | --- |
| `keyword` | yes | text typed into "สืบค้นข้อมูลผลิตภัณฑ์" |
| `province` | no | matched against the จังหวัด part of the "ที่อยู่" column; the word `จังหวัด` and whitespace are ignored |
| `district` | no | matched against the อำเภอ / เขต part |
| `subdistrict` | no | matched against the ตำบล / แขวง part |
| `withDetails` | no | `false` skips the per-row detail call (much faster) |
| `limit` | no | max rows for which the detail record is fetched |
| `refresh` | no | `true` bypasses the cache and asks the portal again |

Example:

```bash
curl "http://localhost:3000/api/fda/drug-locations?keyword=%E0%B8%9F%E0%B8%B2%E0%B8%AA%E0%B8%8B%E0%B8%B4%E0%B9%82%E0%B8%99&province=%E0%B9%80%E0%B8%8A%E0%B8%B5%E0%B8%A2%E0%B8%87%E0%B9%83%E0%B8%AB%E0%B8%A1%E0%B9%88"
```

Response:

```json
{
  "success": true,
  "keyword": "ฟาสซิโน",
  "province": "เชียงใหม่",
  "totalFound": 232,
  "totalMatched": 7,
  "detailsFetched": 7,
  "incomplete": false,
  "truncated": false,
  "results": [
    {
      "licenseNo": "ชม 1/2555",
      "licenseType": "ขจ",
      "placeName": "ร้านยาฟาสซิโน สาขาศูนย์ยาเชียงใหม่",
      "address": "บ้านเลขที่ 269/5 ... จังหวัด เชียงใหม่ 50000โทร. 0 5326 1150-2",
      "status": "ยกเลิก",
      "newCode": "U1D03505500001C",
      "detailUrl": "https://pertento.fda.moph.go.th/FDA_INFORMATION_DRUG/Home/Public_Inform_Location_Drug?Newcode_not=U1D03505500001C",
      "licenseeName": "บริษัท โปร ฟาสซิโน จำกัด",
      "operatorName": "นาย ไชยเสน พิศาลวาเลิศ",
      "openHours": "08.00 - 21.00 น.",
      "detailError": null
    }
  ]
}
```

## Cache

A search is cached **by keyword only** — the province filter is applied locally
afterwards — so a second search on the same shop name answers instantly, and
switching province costs nothing. Detail records are cached separately by
Newcode. Responses carry `cached` and `cachedAgeSeconds`; the UI shows a
"จากแคช" badge with a "ดึงข้อมูลใหม่" button that re-runs with `refresh=true`.

Measured: `keyword=ฟาสซิโน` (233 rows) takes ~1 s cold and **0.0 s** warm;
switching that same cached search to another province is also 0.0 s.

```
GET    /api/cache      → what is cached, with ages
DELETE /api/cache      → drop everything
GET    /api/areas      → จังหวัด → อำเภอ → ตำบล tree for the dropdowns
GET    /api/provinces  → just the 77 province names
GET    /api/fda/detail?newCode=…  → one establishment's detail, for the preview
```

## Errors

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `INVALID_INPUT` | `keyword` missing |
| 504 | `UPSTREAM_TIMEOUT` | FDA site slow, or a selector no longer exists |
| 502 | `SCRAPE_FAILED` | any other upstream failure |

A search with zero hits is **not** an error — it returns `200` with
`totalFound: 0` and an empty `results` array.

## How it works

1. POST the portal's search API (`GET_SEARCH`) with its own search model —
   a multipart body of `MODEL` (JSON) and `search_input`, with
   `RADIO_TYPE_LOCATION` set to `สืบค้นสถานที่ยา`. The whole result set comes
   back in one JSON response; there is no pager to walk.
2. Map each record onto the row shape the UI reads: `lcnno_no` → `licenseNo`,
   `lcntpcd` → `licenseType` (the portal splits "ขจ กจ 4/2538" into the two),
   `thanm` → `placeName`, `thanm_addr` → `address`, `cncnm` → `status`,
   `Newcode` → `newCode`, `URLs` → `detailUrl`.
3. Parse each address into ตำบล/แขวง, อำเภอ/เขต and จังหวัด (`parseAddress()`,
   run once per fetch and cached with the rows), then filter by whichever
   of the three the caller asked for. Matching is per part, not a raw substring
   over the whole address — otherwise a Chiang Mai shop on `ถนน ลำพูน` would be
   returned for `province=ลำพูน`. The response also carries `facets`, the
   distinct districts and subdistricts still available with counts.
4. For each match (up to `MAX_DETAILS`), POST the detail API with the row's
   Newcode for the licensee, the ผู้มีหน้าที่ปฏิบัติการ list, the opening hours
   and the map coordinates. That endpoint answers 411 to a POST with no body
   at all, so an empty form body goes with it; an unknown Newcode comes back
   as an empty response, which is the 404.

Nothing above needs a browser, so searches are not queued and Chromium is only
started when a PDF is asked for.

## Site quirks handled

- **WAF**: the FDA sites sit behind GDCC Security Center, which answers HTTP 500
  to the default `HeadlessChrome` user agent. Every upstream call sends a normal
  desktop `User-Agent`, and Chromium is launched with the same one.
- **Split licence number**: the search API returns the type (`ขจ`) and the
  number (`กจ 4/2538`) separately — `lcnno_noo` is the two joined.
- **411 on the detail API**: the IIS in front of it rejects a POST without a
  content length, hence the empty body.

## Notes / caveats

- Verified against the live site on 2026-08-26: `keyword=ฟาสซิโน` returns 233
  rows, `province=เชียงใหม่` → 11 matches, and the search plus one detail
  record takes ~1 s (`node smoke.js`).
- The API returns *all* provinces, so `province` filtering happens locally.
- `incomplete: true` now only means the keyword brought back more than
  `MAX_ROWS` rows. The web UI shows a yellow banner in this case.
- Step 4 is the slow part (one request per row). Pass `withDetails=false` when
  only the list columns are needed; the web UI does exactly that.
- The portal redacts pharmacist names: `PERSON_FULLNAME` arrives as the title
  alone ("นางสาว"), so `pharmacists[].name` is the title. Nothing on this side
  can recover the rest.
- `licenseeName` is legitimately `null` for owner-operated shops — the FDA record
  leaves ชื่อผู้รับอนุญาต blank and names the person under ผู้ดำเนินกิจการ.
- `/api/fda/drug-locations/pages` is gone with the pager it existed for, and
  so is the browser-side assembly that called it (`web/src/lib/area.js`).

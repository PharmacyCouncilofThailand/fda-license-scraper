# FDA License Scraper API

Backend API (Express + Puppeteer) that scrapes the Thai FDA licence-check portal
`SEARCH_CENTER_MAIN.aspx`, filters drug-establishment results by province, and
returns JSON.

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
| `NAV_TIMEOUT_MS` | `45000` | navigation / selector timeout |
| `MAX_PAGES` | `60` | max grid pages walked per search |
| `MAX_DETAILS` | `25` | max pop-up detail pages opened per search |
| `CACHE_TTL_MS` | `1800000` | how long a scrape stays cached (30 min) |
| `CACHE_MAX` | `50` | max cached keywords (least recently used is evicted) |
| `FDA_SEARCH_URL` | the live portal | the search page the scraper drives |
| `FDA_DETAIL_URL` | the live portal | the detail pop-up, built from a row's Newcode |
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

The same image, on a host that scales to zero between inspections. Cloud Run
allows a 60-minute request and several gigabytes of memory, which is what this
app needs and what the serverless platforms do not give: the measured worst
case is 511 MB and 92 seconds — both measured inside the container, not
guessed from the host.

```bash
gcloud run deploy fda-license-scraper --source . --region asia-southeast1 --memory 2Gi --cpu 2 --timeout 900 --concurrency 4 --execution-environment gen2 --allow-unauthenticated
```

Why those numbers:

| Flag | Why |
| --- | --- |
| `--memory 2Gi` | "บ้านยา" runs out of room at 512 MB; 1 Gi holds it, 2 Gi leaves headroom for a second request |
| `--cpu 2` | Chromium parses 51 pages of Telerik markup — one vCPU roughly doubles the wall clock |
| `--timeout 900` | the broadest keyword takes 92 s at best and the portal's pace varies by a factor of two |
| `--concurrency 4` | scrapes are serialised behind one browser anyway, so a high number only piles requests onto the same instance |
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
scrape even begins. `--min-instances 1` removes that at the cost of an
always-billed instance.

### Railway, or any container host

`Dockerfile` is the one to reach for. Measured on a real search, a scrape
for "ฟาสซิโน" (232 rows) peaks at **394 MB** and takes **52 s**, and "บ้านยา"
(2,536 rows over 51 pages) takes **92 s** and **runs out of memory at a 512 MB
cap**. That rules out anything with a short request timeout or a 512 MB tier,
and it is why the container is the home
this app actually wants: one browser, one queue and one cache serving
everyone, warm between requests.

```bash
railway up
```

The image is deliberately plain — Debian's own Chromium, no puppeteer
download (`PUPPETEER_SKIP_DOWNLOAD=1`, `CHROME_PATH=/usr/bin/chromium`), and
the Vite build carried in from a first stage so `web/node_modules` never
ships. It runs as a non-root user and reads nothing but its own files.

Set `FORM_TEMPLATE_URL` in the service's variables; `PORT` is provided by the
platform. Everything else in `.env.example` has a working default.

**Fonts.** `fonts-thai-tlwg` is installed, so the record renders as Thai text
rather than boxes — but TH Sarabun New is not in any Debian repository and is
not redistributed here, so the PDF falls back to a TLWG face and the line
breaks will not match the office's Word copy exactly. To get the original,
put the .ttf files in `fonts/` before building; the Dockerfile picks the
directory up if it exists and ignores it if it does not. Keep them out of the
repository for the same reason the Word template is out of it.

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
| `MAX_PAGES` | `25` on Hobby | see the ceiling below |

`VERCEL` is set by the platform, and it is what switches the scraper from
puppeteer's bundled Chromium to `@sparticuz/chromium`. Nothing else changes:
the same code runs locally against a real Chrome.

**The ceiling worth knowing before you deploy.** A function has a wall-clock
limit — 60 s on Hobby, 300 s on Pro — and a scrape is as long as the keyword
is broad. Measured: 7 s for a rare name, **92 s for "บ้านยา"** (2,536 rows over
51 pages). Almost all of that is paging — setup is 3 s and each pager click
costs between 0.9 s and 1.7 s, depending on the portal's mood. So:

- On **Hobby**, 60 s is the ceiling, and at the portal's slow pace that is
  about 27 pages. `MAX_PAGES=25` is the setting that fits: measured at 24 s
  for "บ้านยา", returning its first 1,250 rows with the "ผลลัพธ์ไม่ครบ" banner
  already in the UI. Officers searching a shop name never reach it —
  "ฟาสซิโน" is five pages — so the cap only bites on terms broad enough that
  the honest answer is "type more of the name".
- On **Pro**, 300 s covers every keyword measured, including the full 51-page
  "บ้านยา" at 92 s.
- The keyword cache lives in the instance's memory, so it survives only as
  long as that instance does — a second officer usually pays the full scrape
  again. The single-scrape queue is likewise per-instance and no longer
  protects the FDA site from parallel scrapes.

Note what the profile rules out. Splitting a scrape across several
invocations sounds like the fix for the 60 s ceiling, and the setup cost is
low enough — 3 s — that it would pay for itself. But filtering and the
province facets need the whole result set, so partial chunks would have to be
stitched somewhere, and on Vercel there is no somewhere: each invocation may
land on a different instance. It would mean moving filtering into the browser
or renting a store to hold half-finished scrapes. Capping the pages is one
line and tells the officer the truth.

If the searches get heavier than that, this app wants a container that stays
warm — one browser, one queue and one cache serving everyone, and a
92-second scrape is just a slow request. The same `npm start` runs there
unchanged.

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
cover while the area tree loads, and the search itself, which measured between
7 and 92 seconds depending on how common the name is. The second one counts
the seconds, since a bare spinner says nothing across that spread.

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

Changing any dropdown re-filters immediately: the scrape is cached by keyword,
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

- **ดาวน์โหลด PDF** renders this same page through the scraper's Chromium. No PDF
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

Long shop names and long addresses would push the form onto a third page, so
before printing each sheet steps its type down until it fits one A4 page, and
each blank steps down until its own value fits.

```
GET  /form.html         → the form
POST /api/form/pdf      { values: {...}, checks: {...} } → application/pdf
POST /api/form/docx     { values: {...}, checks: {...} } → .docx
```

`node smoke-form.js` checks both halves without touching the FDA site: the
address parser, that a filled form still renders to exactly two pages, and
that the Word copy comes out with every placeholder replaced.

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
| `withDetails` | no | `false` skips step 8 (much faster) |
| `limit` | no | max rows for which the detail tab is opened |
| `refresh` | no | `true` bypasses the cache and re-scrapes |

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
  "pagesRead": 5,
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
      "detailUrl": "http://pertento.fda.moph.go.th/.../pop-up_drug_location_operator.aspx?Newcode_not=U1D03505500001C",
      "licenseeName": "บริษัท โปร ฟาสซิโน จำกัด",
      "operatorName": "นาย ไชยเสน พิศาลวาเลิศ",
      "openHours": "08.00 - 21.00 น.",
      "detailError": null
    }
  ]
}
```

## Cache

A scrape is cached **by keyword only** — the province filter is applied locally
afterwards — so a second search on the same shop name answers instantly, and
switching province costs nothing. Detail pop-ups are cached separately by
Newcode. Responses carry `cached` and `cachedAgeSeconds`; the UI shows a
"จากแคช" badge with a "ดึงข้อมูลใหม่" button that re-runs with `refresh=true`.

Measured: `keyword=บ้านยา` (2,415 rows / 51 pages) takes ~96 s cold and **0.0 s**
warm; switching that same cached search to another province is also 0.0 s.

A cached request skips the single-scrape queue, so it never waits behind a
running scrape, and it does not start Chromium at all unless details are asked
for.

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
| 502 | `SCRAPE_FAILED` | any other scrape failure |

A search with zero hits is **not** an error — it returns `200` with
`totalFound: 0` and an empty `results` array.

## How it works

1. `page.goto` the search page.
2. Click radio `#ContentPlaceHolder1_R_LCN_DRUG` ("สืบค้นสถานที่ยา") — this fires
   an ASP.NET `__doPostBack`, handled by `clickAndSettle()` (see below).
3. Type `keyword` into `#ContentPlaceHolder1_txt_search`.
4. Click `#ContentPlaceHolder1_btn_search` (another postback).
5. `waitForSelector('#ContentPlaceHolder1_RAD_LCN_ctl00')` — the Telerik RadGrid.
6. Raise the page size to 50, then walk the pager (`input.rgPageNext`), reading
   `tr.rgRow, tr.rgAltRow` on each page. Paging is confirmed by waiting for
   `.rgCurrentPage` to change, not by a fixed sleep.
7. Parse each address into ตำบล/แขวง, อำเภอ/เขต and จังหวัด (`parseAddress()`,
   run once at scrape time and cached with the rows), then filter by whichever
   of the three the caller asked for. Matching is per part, not a raw substring
   over the whole address — otherwise a Chiang Mai shop on `ถนน ลำพูน` would be
   returned for `province=ลำพูน`. The response also carries `facets`, the
   distinct districts and subdistricts still available with counts.
8. For each match, open the last-column link's URL in a new tab, read the
   licensee fields, close the tab.

   The link is **not** clicked in the grid, even though it is a `target="_blank"`
   anchor: Telerik ids the links by position inside the current pager page
   (`..._ctl04_HyperLink1`), so after step 6 only the last page's rows are in the
   DOM, and clicking a remembered id silently returns another shop's record.
   The href carries the row's own Newcode, so it is always the right record —
   and it works identically for cached rows, where no grid is open at all.

Each request runs in its own `BrowserContext` (isolated cookies / ViewState) on a
single shared Chromium instance, and requests are serialised in a queue because
the upstream site is slow under parallel load.

## Site quirks handled

- **WAF**: the FDA sites sit behind GDCC Security Center, which answers HTTP 500
  to the default `HeadlessChrome` user agent. Chromium is launched with a normal
  desktop `--user-agent` so the detail pop-up tab inherits it too.
- **Announcement modal**: the landing page opens a Bootstrap modal whose
  backdrop swallows real mouse clicks. `dismissModals()` closes it, and
  `robustClick()` falls back to a DOM click when an element is still covered.
- **RadAjax**: controls answer with partial async postbacks, not navigations.
  `clickAndSettle()` races `waitForNavigation` against the MS AJAX
  `PageRequestManager` `endRequest` event, then waits for the ready selector —
  no fixed sleeps anywhere.

## Notes / caveats

- Verified against the live site on 2026-08-19: `keyword=ฟาสซิโน` returns 232 rows
  over 24 pager pages; `province=เชียงใหม่` → 11 matches, `province=ลำพูน` → 1,
  `province=กรุงเทพมหานคร` → 64. A full run with 2 detail tabs took ~52 s.
- Selectors were captured from the live site; if the FDA rebuilds the page they
  are all in one place, `src/config.js`.
- The grid returns *all* provinces, so `province` filtering happens locally after
  every page has been read — a broad keyword means many postbacks.
- `incomplete: true` means the walk stopped at `MAX_PAGES` while the pager still
  had more pages, so the result set is partial — narrow the keyword or raise
  `MAX_PAGES`. The web UI shows a yellow banner in this case.
- Cost of a broad keyword: `keyword=บ้านยา` is 2,536 rows over 51 pages and takes
  ~92 s. `MAX_PAGES=60` covers it; at the old default of 30 it stopped at 1,500
  rows with `incomplete: true`.
- Step 8 is the slow part (one page load per row). Pass `withDetails=false` when
  only the grid columns are needed; the web UI does exactly that.
- `licenseeName` is legitimately `null` for owner-operated shops — the FDA record
  leaves ชื่อผู้รับอนุญาต blank and names the person under ผู้ดำเนินกิจการ.
- `totalFound` for a broad keyword drifts a little between runs (2,415–2,536 for
  `บ้านยา`). The upstream grid re-queries per pager page, so rows shift while the
  walk is in progress. Nothing to fix on this side.

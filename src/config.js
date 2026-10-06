'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Every setting is read from the environment, and `.env` fills it in for a
 * local run. Node loads it itself, so there is no dotenv dependency; a real
 * environment variable always wins, which is how a deployment overrides one.
 *
 * `.env` is not in the repository — copy `.env.example` and edit.
 */
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * Puppeteer's bundled Chromium is preferred. When it was not downloaded
 * (offline install, corporate proxy), fall back to CHROME_PATH or a locally
 * installed Chrome/Edge.
 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA &&
      `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
}

/*
 * Vercel gives a read-only filesystem and no browser, so Chromium comes from
 * @sparticuz/chromium — a build small enough for a function bundle — and
 * puppeteer-core drives it. Everything else is identical.
 */
const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

module.exports = {
  serverless,
  executablePath: findChrome(),
  port: Number(process.env.PORT || 3000),
  headless: process.env.HEADLESS !== 'false',
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS || 45000),
  // Scrapes are cached per keyword (province filtering happens locally), so
  // changing only the province is instant.
  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 30 * 60 * 1000),
  cacheMaxKeywords: Number(process.env.CACHE_MAX || 50),

  // Where the tokenised Word template sits — kept out of the repository.
  formTemplate: process.env.FORM_TEMPLATE || null,

  // A deployment has no repository copy of it, so it is fetched from here.
  formTemplateUrl: process.env.FORM_TEMPLATE_URL || null,

  // A private Vercel Blob answers 403 without it. Set by the platform when a
  // Blob store is linked to the project, so nothing to configure by hand —
  // and only ever sent to the Blob host, since it is a read *and write*
  // token. A public template URL needs none of this.
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || null,

  // Where inspection plans live. `blob` for the Vercel deployment, `file` for
  // a server with a writable disk (the Pharmacy Council's own). Left unset,
  // a blob token decides it — which is what a Vercel deployment has.
  plansStore: process.env.PLANS_STORE || (process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'file'),
  plansDir: process.env.PLANS_DIR || path.join(__dirname, '..', 'data', 'plans'),
  plansPasscode: process.env.PLANS_PASSCODE || null,

  // How many proxies sit in front of the app, for reading the client's IP
  // (the rate limits key on it). Vercel has one; a Council machine serving
  // the LAN directly has none, and trusting X-Forwarded-For there would let
  // any client pick its own IP. Set TRUST_PROXY=1 behind a reverse proxy.
  trustProxy: Number(process.env.TRUST_PROXY ?? (process.env.VERCEL ? 1 : 0)),

  // Photo bytes for on-site records. Same backend choice as the plans, so a
  // deployment configures one thing, not two.
  photosDir: process.env.PHOTOS_DIR || path.join(__dirname, '..', 'data', 'photos'),
  recordsDir: process.env.RECORDS_DIR || path.join(__dirname, '..', 'data', 'records'),

  // The office drive (ไดรฟ์) on the `file` backend. On a Council server this
  // is where the NAS share is mounted, which is the whole NAS integration.
  driveDir: process.env.DRIVE_DIR || path.join(__dirname, '..', 'data', 'drive'),

  // How many rows one keyword may bring back, and how many of them get their
  // detail record fetched. The portal answers a search in one JSON response,
  // so there are no pages to walk any more — this is only a memory guard.
  // Measured: "ยา", the broadest term there is, is 18,414 rows / 13 MB, and
  // "ฟาร์มาซี" is 7,836 — so 20,000 truncates nothing an officer would type.
  maxRows: Number(process.env.MAX_ROWS || 20000),
  maxDetails: Number(process.env.MAX_DETAILS || 25),

  // The site sits behind a GDCC WAF that returns HTTP 500 for the default
  // HeadlessChrome user agent, so a normal desktop UA is required.
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',

  // The two upstream endpoints. The portal is an Angular app talking to a
  // JSON API, so these are the API calls its own page makes — no browser and
  // no HTML parsing involved. They live in the environment so a move — or a
  // staging mirror — does not need a code change.
  searchApiUrl:
    process.env.FDA_SEARCH_URL ||
    'https://porta.fda.moph.go.th/FDA_SEARCH_CENTER_BACKEND/SEACH_ALL/GET_SEARCH',

  detailApiUrl:
    process.env.FDA_DETAIL_URL ||
    'https://pertento.fda.moph.go.th/FDA_INFORMATION_DRUG/SV_CENTER/GET_DATA_LOCATION_DRUG',

  // The search page's own radio value for "สืบค้นสถานที่ยา"; the API keys the
  // whole query off this string.
  searchLocationType: process.env.FDA_SEARCH_TYPE || 'สืบค้นสถานที่ยา',

  // Where a human reads the same record. Sent to the UI as `detailUrl`.
  detailPageUrl:
    process.env.FDA_DETAIL_PAGE_URL ||
    'https://pertento.fda.moph.go.th/FDA_INFORMATION_DRUG/Home/Public_Inform_Location_Drug',

  // The Pharmacy Council's own search form. It is a page POST, not an API —
  // see src/pharmacist.js. In the environment so a move needs no code change.
  pharmacistSearchUrl:
    process.env.PHARMACIST_SEARCH_URL ||
    'https://www.pharmacycouncil.org/index.php?option=com_pharmacist_list',
};

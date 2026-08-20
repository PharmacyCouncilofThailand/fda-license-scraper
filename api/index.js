'use strict';

/**
 * Vercel's entry point. The whole API is one function: the Express app is
 * already a request handler, and splitting it into a file per route would
 * mean a cold start — and a fresh Chromium — for each of them.
 *
 * Static files are not served from here; `vercel.json` sends everything
 * except /api and /health to the CDN copy of `public/`.
 */
module.exports = require('../src/server');

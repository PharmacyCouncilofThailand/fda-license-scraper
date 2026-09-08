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

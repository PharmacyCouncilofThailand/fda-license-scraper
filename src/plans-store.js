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

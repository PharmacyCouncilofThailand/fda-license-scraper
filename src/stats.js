'use strict';

const { splitAddress } = require('./records');

/**
 * The dashboard's numbers. The web app is used to prepare inspections, not at
 * the shop, so nothing marks a shop inspected any more — the signed form being
 * scanned into the "เอกสาร" step is what says it happened. The unit is a plan
 * item: the same shop in two plans is two inspections.
 *
 * Pure: the caller reads the stores, so this is testable on fixtures.
 */
function buildStats(plans, records) {
  const filed = new Set(
    records
      .filter((record) => (record.documents || []).length > 0)
      .map((record) => `${record.planId}\u0000${record.newCode}`)
  );

  const months = new Map();
  const areas = new Map();
  const bump = (map, key, seed, done) => {
    const row = map.get(key) || { ...seed, total: 0, done: 0 };
    row.total += 1;
    if (done) row.done += 1;
    map.set(key, row);
  };

  let total = 0;
  let done = 0;
  for (const plan of plans) {
    // Buddhist-era YYYY-MM-DD, or '' while the date is not yet set.
    const month = String(plan.date || '').slice(0, 7);
    for (const item of plan.items || []) {
      const isDone = filed.has(`${plan.id}\u0000${item.newCode}`);
      total += 1;
      if (isDone) done += 1;
      bump(months, month, { month }, isDone);
      const { province, district } = splitAddress(item.address);
      bump(areas, `${province}\u0000${district}`, { province, district }, isDone);
    }
  }

  const byMonth = [...months.values()].sort((a, b) =>
    !a.month ? 1 : !b.month ? -1 : a.month.localeCompare(b.month)
  );
  const byArea = [...areas.values()].sort(
    (a, b) => b.total - a.total || a.province.localeCompare(b.province, 'th') || a.district.localeCompare(b.district, 'th')
  );
  return { total, done, remaining: total - done, byMonth, byArea };
}

module.exports = { buildStats };

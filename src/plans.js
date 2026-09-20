'use strict';

const store = require('./plans-store');
const { splitThaiName } = require('./thai-name');

const DEFAULT_TITLE = 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม';
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Spreadsheet-column label for a positive integer: 1→A, 26→Z, 27→AA, … */
function columnLabel(n) {
  let label = '';
  for (let value = n; value > 0; value = Math.floor((value - 1) / 26)) {
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  }
  return label;
}

/** The lowest column label no existing plan holds, so a deleted plan's letter
    is reused and ids stay stable under plans that already carry records. */
function nextPlanId(existingIds) {
  const taken = new Set(existingIds);
  for (let n = 1; ; n += 1) {
    const label = columnLabel(n);
    if (!taken.has(label)) return label;
  }
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/** The real sources, replaced by the test. Required lazily: `scraper` starts a
    browser's worth of module loading that the offline test has no use for. */
function realDeps() {
  return {
    fetchDetail: (newCode) => require('./scraper').getDetailByNewCode(newCode),
    searchPharmacists: (query) => require('./pharmacist').searchPharmacists(query),
  };
}

/**
 * The council answers a name with a table, and several people share a name.
 * Filling a licence number the register did not clearly give us would put a
 * wrong number on an official document, so anything short of a single exact
 * match is left for the officer, with the choices kept beside it.
 */
async function resolveLicence(name, searchPharmacists) {
  const { firstName, lastName } = splitThaiName(name);
  if (!firstName && !lastName) return { licenceNo: '', licenceSource: 'none', candidates: [] };
  let both = [];
  try {
    const result = await searchPharmacists({ firstName, lastName });
    both = (result.groups && result.groups.both) || [];
  } catch {
    // The council being down must not stop a plan being built.
    return { licenceNo: '', licenceSource: 'none', candidates: [] };
  }
  if (both.length === 1) {
    return { licenceNo: both[0].licenseNo, licenceSource: 'auto', candidates: [] };
  }
  if (both.length > 1) {
    return {
      licenceNo: '',
      licenceSource: 'ambiguous',
      candidates: both.map((row) => ({
        licenceNo: row.licenseNo,
        fullName: row.fullName,
        status: row.status,
      })),
    };
  }
  return { licenceNo: '', licenceSource: 'none', candidates: [] };
}

/**
 * A shop reaches here either as a bare Newcode or as the search row the
 * browser is already holding. The FDA's detail call answers the licensee,
 * hours, coordinates and pharmacists but not the shop's name, licence number
 * or address — those live only on the search row — so the row travels with
 * the code rather than being looked up again.
 */
function asEntry(entry) {
  return typeof entry === 'string' ? { newCode: entry } : { ...entry };
}

/**
 * A plan item is a copy, not a reference. The plan is the document for that
 * day: if the FDA changes a shop's details next week, the sheet the officers
 * carried has to keep saying what it said. Re-reading is `syncItem`, which a
 * person asks for.
 */
async function buildItem(entry, deps) {
  const row = asEntry(entry);
  const detail = (await deps.fetchDetail(row.newCode)) || {};
  const pharmacists = [];
  for (const person of detail.pharmacists || []) {
    const licence = await resolveLicence(person.name, deps.searchPharmacists);
    pharmacists.push({ name: person.name, openHours: person.openHours || '', ...licence });
  }
  const pick = (key) => detail[key] || row[key] || '';
  return {
    newCode: row.newCode,
    order: 0,
    placeName: pick('placeName'),
    licenseType: pick('licenseType'),
    licenseNo: pick('licenseNo'),
    address: pick('address'),
    licenseeName: detail.licenseeName || '',
    openHours: detail.openHours || '',
    lat: detail.lat ?? null,
    lng: detail.lng ?? null,
    pharmacists,
    status: 'planned',
    statusSource: 'auto',
    note: '',
    syncedAt: new Date().toISOString(),
  };
}

// The date is no longer the plan's name: a plan is created before its date is
// known and gets the next free letter (A, B, C, … AA), with the date an
// optional field set later through `updatePlan`.
async function createPlan({ date = '', title } = {}) {
  const value = String(date || '');
  if (value && !DATE_RE.test(value)) {
    throw badRequest('วันที่ต้องเป็นรูปแบบ พ.ศ. เช่น 2569-08-27');
  }
  const existing = await store.list();
  const id = nextPlanId(existing.map((plan) => plan.id));
  const now = new Date().toISOString();
  return store.save({
    id,
    title: title || DEFAULT_TITLE,
    date: value,
    createdAt: now,
    updatedAt: now,
    items: [],
  });
}

/** The date is the one plan-level field a person edits; items have their own
    routes. Accepts an empty date (not yet set) or a Buddhist-era YYYY-MM-DD. */
async function updatePlan(id, { date } = {}) {
  const plan = await mustGet(id);
  if (date !== undefined) {
    const value = String(date || '');
    if (value && !DATE_RE.test(value)) {
      throw badRequest('วันที่ต้องเป็นรูปแบบ พ.ศ. เช่น 2569-08-27');
    }
    plan.date = value;
  }
  return store.save(plan);
}

async function mustGet(id) {
  const plan = await store.get(id);
  if (!plan) throw notFound('ไม่พบแผนการตรวจนี้');
  return plan;
}

function renumber(items) {
  items.forEach((item, i) => {
    item.order = i + 1;
  });
  return items;
}

async function addItems(id, entries, deps = realDeps()) {
  const plan = await mustGet(id);
  const added = [];
  const failed = [];
  for (const entry of entries || []) {
    const row = asEntry(entry);
    if (plan.items.some((item) => item.newCode === row.newCode)) {
      failed.push({ newCode: row.newCode, message: 'ร้านนี้มีอยู่แล้วในแผน' });
      continue;
    }
    try {
      plan.items.push(await buildItem(row, deps));
      added.push(row.newCode);
    } catch (err) {
      failed.push({ newCode: row.newCode, message: err.message });
    }
  }
  renumber(plan.items);
  // ponytail: read-modify-write, last writer wins. Two officers editing the
  // same plan in the same second can lose one edit. Move to a database with
  // row-level writes if the office grows past a handful of people.
  const saved = await store.save(plan);
  return { plan: saved, added, failed };
}

function applyPharmacistPatch(item, patch) {
  for (const entry of patch) {
    const person = item.pharmacists[entry.index];
    if (!person) continue;
    person.licenceNo = String(entry.licenceNo || '');
    person.licenceSource = person.licenceNo ? 'manual' : 'none';
    person.candidates = [];
  }
}

async function patchItem(id, newCode, patch = {}) {
  const plan = await mustGet(id);
  const item = plan.items.find((entry) => entry.newCode === newCode);
  if (!item) throw notFound('ไม่พบร้านนี้ในแผน');

  if (patch.status !== undefined) {
    if (!['planned', 'done'].includes(patch.status)) throw badRequest('สถานะไม่ถูกต้อง');
    // The record page reports `auto`. A person who has set the status already
    // knows better than the file that was generated, so `auto` gives way.
    const fromForm = patch.statusSource === 'auto';
    if (!fromForm || item.statusSource !== 'manual') {
      item.status = patch.status;
      item.statusSource = fromForm ? 'auto' : 'manual';
    }
  }
  if (patch.note !== undefined) item.note = String(patch.note);
  if (patch.pharmacists !== undefined) applyPharmacistPatch(item, patch.pharmacists);
  if (patch.order !== undefined) {
    const target = Math.max(1, Math.min(plan.items.length, Number(patch.order)));
    plan.items.splice(plan.items.indexOf(item), 1);
    plan.items.splice(target - 1, 0, item);
    renumber(plan.items);
  }
  return store.save(plan);
}

/** Reorder the whole plan to match a sequence of newCodes (the client works
    out the order). Codes not in the sequence keep their relative order at the
    end, so a partial or stale list can never drop a shop. */
async function reorderItems(id, orderedNewCodes) {
  const plan = await mustGet(id);
  const order = Array.isArray(orderedNewCodes) ? orderedNewCodes : [];
  const rank = new Map(order.map((code, index) => [code, index]));
  const at = (item) => (rank.has(item.newCode) ? rank.get(item.newCode) : Infinity);
  // Array.prototype.sort is stable, so ties (both unranked) keep their order.
  plan.items.sort((a, b) => at(a) - at(b));
  renumber(plan.items);
  return store.save(plan);
}

async function removeItem(id, newCode) {
  const plan = await mustGet(id);
  const index = plan.items.findIndex((entry) => entry.newCode === newCode);
  if (index === -1) throw notFound('ไม่พบร้านนี้ในแผน');
  plan.items.splice(index, 1);
  renumber(plan.items);
  return store.save(plan);
}

/** Re-read one shop from the FDA, keeping what the office decided about it. */
async function syncItem(id, newCode, deps = realDeps()) {
  const plan = await mustGet(id);
  const index = plan.items.findIndex((entry) => entry.newCode === newCode);
  if (index === -1) throw notFound('ไม่พบร้านนี้ในแผน');
  const previous = plan.items[index];
  const fresh = await buildItem(previous, deps);
  plan.items[index] = {
    ...fresh,
    order: previous.order,
    status: previous.status,
    statusSource: previous.statusSource,
    note: previous.note,
  };
  return store.save(plan);
}

function summarise(plan) {
  return {
    id: plan.id,
    title: plan.title,
    date: plan.date,
    updatedAt: plan.updatedAt,
    total: plan.items.length,
    done: plan.items.filter((item) => item.status === 'done').length,
  };
}

module.exports = {
  DEFAULT_TITLE,
  createPlan,
  updatePlan,
  addItems,
  patchItem,
  reorderItems,
  removeItem,
  syncItem,
  summarise,
  buildItem,
};

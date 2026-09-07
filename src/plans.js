'use strict';

const store = require('./plans-store');
const { splitThaiName } = require('./thai-name');

const DEFAULT_TITLE = 'แผนการตรวจสถานที่ประกอบวิชาชีพเภสัชกรรม';

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

async function createPlan({ date, title } = {}) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(date || ''))) {
    throw badRequest('ต้องระบุวันที่ตรวจในรูปแบบ พ.ศ. เช่น 2569-08-27');
  }
  // Two rounds can fall on one day, so a taken id gains a suffix rather than
  // overwriting the plan already there.
  let id = date;
  for (let n = 2; await store.get(id); n += 1) id = `${date}-${n}`;
  const now = new Date().toISOString();
  return store.save({
    id,
    title: title || DEFAULT_TITLE,
    date,
    createdAt: now,
    updatedAt: now,
    items: [],
  });
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
  addItems,
  patchItem,
  removeItem,
  syncItem,
  summarise,
  buildItem,
};

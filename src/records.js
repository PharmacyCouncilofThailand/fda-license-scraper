'use strict';

const store = require('./records-store');
const plansStore = require('./plans-store');

/**
 * What an on-site record is: the same `{ values, checks }` the record page
 * reads, plus the photos and signatures the officer adds at the shop.
 *
 * The keys in `values` and `checks` are exactly the ones `form.html` writes
 * out of `collect()` — there is no translation layer between the wizard and
 * the paper, because a translation layer is one more place for a blank to go
 * missing.
 */

const SIGNATURE_SLOTS = [
  'page1',
  'duty',
  'licensee',
  'officer1',
  'officer2',
  'officer3',
  'officer4',
  'officer5',
];

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function recordId(planId, newCode) {
  return `${planId}__${encodeURIComponent(String(newCode))}`;
}

async function planItem(planId, newCode) {
  const plan = await plansStore.get(planId);
  if (!plan) throw notFound('ไม่พบแผนการตรวจนี้');
  const item = plan.items.find((entry) => entry.newCode === newCode);
  if (!item) throw notFound('ไม่พบร้านนี้ในแผน');
  return item;
}

/* The plan item carries the address as one line, as the FDA writes it. The
   record has a blank per part, so the line is split on the labels the FDA
   itself uses. What does not match stays in `houseNo`, which is the blank an
   officer would correct first. */
function splitAddress(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  // The alternatives are wrapped: `แขวง|ตำบล\\s*(…)` would bind the capture to
  // the second alternative alone, and half these labels would capture nothing.
  const grab = (label) => {
    const match = text.match(new RegExp(`(?:${label})\\s*([^\\s]+)`));
    return match ? match[1] : '';
  };
  return {
    houseNo: (text.match(/เลขที่\s*([^\s]+)/) || [])[1] || '',
    village: grab('หมู่บ้าน|อาคาร'),
    moo: grab('หมู่ที่'),
    soi: grab('ซ\\.|ซอย'),
    road: grab('ถ\\.|ถนน'),
    subdistrict: grab('แขวง|ตำบล'),
    district: grab('เขต|อำเภอ'),
    province: grab('จังหวัด') || (/กทม\.|กรุงเทพ/.test(text) ? 'กรุงเทพมหานคร' : ''),
  };
}

/**
 * An empty draft, seeded with what the plan already knows.
 *
 * `dutyPharmacist` and `openHours` are deliberately left empty: item (2) is
 * about the pharmacist who was on duty when the inspection happened, and the
 * licence only says who is entitled to be. `form.html` leaves the same two
 * blanks for the same reason.
 */
function blankRecord(planId, newCode, item) {
  const area = splitAddress(item.address);
  return {
    id: recordId(planId, newCode),
    planId,
    newCode,
    officerName: '',
    values: {
      placeName: item.placeName || '',
      shopNameAtCheck: item.placeName || '',
      licenseeName: item.licenseeName || '',
      licenseNo: item.licenseNo || '',
      dutyPharmacist: '',
      openHours: '',
      ...area,
    },
    checks: {},
    signatures: {},
    photos: [],
    createdAt: null,
    updatedAt: null,
  };
}

async function readRecord(planId, newCode) {
  const item = await planItem(planId, newCode);
  const stored = await store.get(recordId(planId, newCode));
  return stored || blankRecord(planId, newCode, item);
}

/**
 * Write the draft whole.
 *
 * One shop is filled in by one officer at a time, so there is nothing to gain
 * from patching field by field — but two iPads open on the same shop would
 * silently eat each other's work, so a write that was built on an older
 * version is refused and handed the current one to merge from.
 */
async function writeRecord(planId, newCode, incoming) {
  const item = await planItem(planId, newCode);
  const id = recordId(planId, newCode);
  const current = await store.get(id);
  if (current && incoming.updatedAt !== current.updatedAt) {
    const err = new Error('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
    err.status = 409;
    err.current = current;
    throw err;
  }
  const base = current || blankRecord(planId, newCode, item);
  const signatures = {};
  for (const slot of SIGNATURE_SLOTS) {
    const value = (incoming.signatures || {})[slot];
    if (value) signatures[slot] = String(value);
  }
  return store.save({
    ...base,
    officerName: String(incoming.officerName || ''),
    values: { ...(incoming.values || {}) },
    checks: { ...(incoming.checks || {}) },
    signatures,
    // Photos change through their own routes, never through a draft write —
    // otherwise an autosave in flight when a photo lands would delete it.
    photos: base.photos || [],
    createdAt: base.createdAt || new Date().toISOString(),
  });
}

async function addPhoto(planId, newCode, { id: photoId }) {
  const record = await readRecord(planId, newCode);
  const photos = [
    ...(record.photos || []),
    { id: photoId, caption: '', inPdf: true, at: new Date().toISOString() },
  ];
  return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
}

async function removePhoto(planId, newCode, photoId) {
  const record = await readRecord(planId, newCode);
  const photos = (record.photos || []).filter((photo) => photo.id !== photoId);
  return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
}

module.exports = {
  SIGNATURE_SLOTS,
  recordId,
  blankRecord,
  readRecord,
  writeRecord,
  addPhoto,
  removePhoto,
};

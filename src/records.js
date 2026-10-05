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

/**
 * addPhoto/removePhoto/patchPhoto/writeRecord all do read-modify-write on the
 * same record id. Two of them landing back to back (an officer tapping the
 * shutter twice, or a caption edit racing an autosave) would otherwise read
 * the same base and the second `store.save()` would silently discard the
 * first's effect. Serializing same-id writes through one promise chain closes
 * that.
 *
 * ponytail: process-local queue — closes the race for one server instance
 * (what this office runs). A multi-instance deployment would need a real
 * lock service; add one if that ever changes.
 */
const locks = new Map();
function withLock(id, fn) {
  const wait = locks.get(id) || Promise.resolve();
  const run = wait.then(fn, fn);
  const settled = run.then(
    () => {},
    () => {}
  );
  locks.set(id, settled);
  settled.then(() => {
    if (locks.get(id) === settled) locks.delete(id);
  });
  return run;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function safeEncodeCode(code) {
  // `encodeURIComponent` leaves `*` bare, and a bare `*` in a filename is a
  // Windows error: it surfaces as ENOENT on write and as a silent miss on
  // read (the caller reads `null` and gets handed a blank draft over their
  // own saved work). Escape it ourselves so the id can never contain one.
  return encodeURIComponent(String(code)).replace(/\*/g, '%2A');
}

function recordId(planId, newCode) {
  return `${planId}__${safeEncodeCode(newCode)}`;
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

// อย. writes the unit into the value itself — "07.00-21.00 น." — and the form
// prints its own "น." after the blank, so drop the bare unit rather than double
// it. A "น." that is part of a word is left alone. Mirrors form.html's dropUnit.
function dropDutyUnit(text) {
  return String(text || '')
    .replace(/(^|[\s\d])\s*น\.(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Blanks whose value comes from อย.; the renderer sets these in bold. */
const FDA_FIELDS = [
  'placeName', 'shopNameAtCheck', 'licenseeName', 'licenseNo',
  'houseNo', 'village', 'moo', 'soi', 'road', 'subdistrict', 'district', 'province',
];

/**
 * An empty draft, seeded with what the plan already knows.
 *
 * Item (2) is about the pharmacist who was on duty when the inspection
 * happened. When the licence names exactly one, that is unambiguous, so
 * `dutyPharmacist` and `openHours` are filled; when it names several, the
 * officer picks at the shop, so they are left empty. `form.html` seeds the
 * same block the same way.
 */
function blankRecord(planId, newCode, item) {
  const area = splitAddress(item.address);
  const people = (item.pharmacists || []).filter((p) => p && p.name);
  const single = people.length === 1;
  const fda = [...FDA_FIELDS];
  if (single) fda.push('dutyPharmacist', 'openHours');
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
      dutyPharmacist: single ? people[0].name : '',
      openHours: single ? dropDutyUnit(people[0].openHours) : '',
      ...area,
    },
    checks: {},
    signatures: {},
    photos: [],
    documents: [],
    fda,
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
  return withLock(id, async () => {
    const current = await store.get(id);
    if (current) {
      if (incoming.updatedAt !== current.updatedAt) {
        const err = new Error('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
        err.status = 409;
        err.current = current;
        throw err;
      }
    } else if (incoming.updatedAt != null) {
      // A caller holding a non-null updatedAt for a shop with nothing stored is
      // holding a stale version by definition (deleted, or another store) — refuse
      // it the same way as any other conflict.
      // ponytail: this only closes the stale-caller half of the race. Two
      // officers who both open a never-yet-saved shop both hold updatedAt: null
      // and this check lets both through — closing that needs a create-only
      // write primitive in the store, out of scope here. Add one if the office
      // outgrows it.
      const err = new Error('มีคนอื่นบันทึกร้านนี้ไปแล้ว');
      err.status = 409;
      err.current = blankRecord(planId, newCode, item);
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
  });
}

async function addPhoto(planId, newCode, { id: photoId }) {
  const id = recordId(planId, newCode);
  return withLock(id, async () => {
    const record = await readRecord(planId, newCode);
    const photos = [
      ...(record.photos || []),
      { id: photoId, caption: '', inPdf: true, at: new Date().toISOString() },
    ];
    return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
  });
}

async function removePhoto(planId, newCode, photoId) {
  const id = recordId(planId, newCode);
  return withLock(id, async () => {
    const record = await readRecord(planId, newCode);
    const photos = (record.photos || []).filter((photo) => photo.id !== photoId);
    return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
  });
}

/** Caption and the appendix flag are the only things about a photo an
    officer edits after it is taken. Routed here, never through the whole
    draft PUT, for the same reason addPhoto/removePhoto are: an autosave in
    flight when this lands must not resurrect or drop a photo. */
async function patchPhoto(planId, newCode, photoId, patch) {
  const id = recordId(planId, newCode);
  return withLock(id, async () => {
    const record = await readRecord(planId, newCode);
    const photos = (record.photos || []).map((photo) =>
      photo.id === photoId
        ? {
            ...photo,
            ...(patch.caption !== undefined ? { caption: String(patch.caption) } : {}),
            ...(patch.inPdf !== undefined ? { inPdf: Boolean(patch.inPdf) } : {}),
          }
        : photo
    );
    return store.save({ ...record, photos, createdAt: record.createdAt || new Date().toISOString() });
  });
}

/* Scanned/photographed paper forms. Same lock and same own-route rule as
   photos; the draft PUT never touches them because it spreads `base`. */
function saveDocuments(planId, newCode, change) {
  const id = recordId(planId, newCode);
  return withLock(id, async () => {
    const record = await readRecord(planId, newCode);
    const documents = change(record.documents || []);
    return store.save({ ...record, documents, createdAt: record.createdAt || new Date().toISOString() });
  });
}

const addDocument = (planId, newCode, { id, type, name = '' }) =>
  saveDocuments(planId, newCode, (docs) => [
    ...docs,
    { id, type, name: String(name), at: new Date().toISOString() },
  ]);

const removeDocument = (planId, newCode, docId) =>
  saveDocuments(planId, newCode, (docs) => docs.filter((doc) => doc.id !== docId));

const patchDocument = (planId, newCode, docId, patch) =>
  saveDocuments(planId, newCode, (docs) =>
    docs.map((doc) =>
      doc.id === docId && patch.name !== undefined ? { ...doc, name: String(patch.name) } : doc
    )
  );

module.exports = {
  SIGNATURE_SLOTS,
  safeEncodeCode,
  recordId,
  blankRecord,
  readRecord,
  writeRecord,
  addPhoto,
  removePhoto,
  patchPhoto,
  addDocument,
  removeDocument,
  patchDocument,
  splitAddress,
};

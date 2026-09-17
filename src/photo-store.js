'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const { safeEncodeCode } = require('./records');

/**
 * Photo bytes taken at the shop. Not `json-store`: these are binary, they are
 * never listed as documents, and one record has several of them — but the
 * choice of where they live is the same setting, so a deployment configures
 * one thing and not two.
 *
 * `access: 'private'` on the blob side. What the inside of a pharmacy looked
 * like on the day it was inspected is not public information.
 */

function assertPart(value, message) {
  if (!/^[A-Za-z0-9%._~-]{1,200}$/.test(String(value || ''))) {
    const err = new Error(message);
    err.status = 400;
    throw err;
  }
  return value;
}

// The real shape a plan id has — same pattern `records-store.js`'s
// `idPattern` anchors its plan half to. Unlike `assertPart`'s open charset,
// `..` cannot match this, so `planId` can never be a traversal segment.
const PLAN_ID_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$/;

function assertPlanId(value) {
  if (!PLAN_ID_PATTERN.test(String(value || ''))) {
    const err = new Error('รหัสแผนไม่ถูกต้อง');
    err.status = 400;
    throw err;
  }
  return value;
}

/**
 * A shop's key can hold anything, so it is encoded before it is a path.
 *
 * `safeEncodeCode` escapes `*` to `%2A` so the key can never contain one —
 * same fix as `recordId` in `src/records.js`.
 *
 * `encodeURIComponent` leaves `.` bare (it is unreserved), so a
 * `newCode` of `..` survives whole and becomes its own path segment —
 * `keyFor(planId, '..', id)` would climb back out of the shop's directory.
 * `planId` gets the same treatment via `assertPlanId` above: an open
 * charset like `assertPart`'s would accept `..` too. Both are rejected
 * outright rather than sanitised — a value that is not a real plan id or
 * shop code is a bad request, not something to quietly repair.
 */
function keyFor(planId, newCode, photoId) {
  assertPlanId(planId);
  assertPart(photoId, 'รหัสรูปไม่ถูกต้อง');
  const safeCode = safeEncodeCode(newCode);
  if (safeCode === '.' || safeCode === '..') {
    const err = new Error('รหัสร้านไม่ถูกต้อง');
    err.status = 400;
    throw err;
  }
  return `${planId}/${safeCode}/${photoId}.jpg`;
}

const BLOB_PREFIX = 'photos/';

function blobApi() {
  if (!config.blobToken) {
    const err = new Error('ต้องตั้งค่า BLOB_READ_WRITE_TOKEN ก่อนใช้ที่เก็บแบบ blob');
    err.status = 500;
    throw err;
  }
  return require('@vercel/blob');
}

const file = {
  name: 'file',
  async put(key, buffer) {
    const target = path.join(config.photosDir, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buffer);
  },
  async get(key) {
    try {
      return await fs.readFile(path.join(config.photosDir, key));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async del(key) {
    try {
      await fs.unlink(path.join(config.photosDir, key));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  },
};

const blob = {
  name: 'blob',
  async put(key, buffer) {
    const { put } = blobApi();
    await put(`${BLOB_PREFIX}${key}`, buffer, {
      access: 'private',
      contentType: 'image/jpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: config.blobToken,
    });
  },
  async get(key) {
    const { head } = blobApi();
    let meta;
    try {
      meta = await head(`${BLOB_PREFIX}${key}`, { token: config.blobToken });
    } catch {
      return null;
    }
    const response = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${config.blobToken}` },
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  },
  async del(key) {
    const { head, del } = blobApi();
    try {
      await head(`${BLOB_PREFIX}${key}`, { token: config.blobToken });
    } catch {
      return false;
    }
    await del(`${BLOB_PREFIX}${key}`, { token: config.blobToken });
    return true;
  },
};

const backends = { file, blob };
const backend = backends[config.plansStore] || file;

async function putPhoto(planId, newCode, buffer) {
  const id = crypto.randomBytes(12).toString('hex');
  await backend.put(keyFor(planId, newCode, id), buffer);
  return { id };
}

async function getPhoto(planId, newCode, photoId) {
  // An id that could never have been issued is a miss, not a bad request:
  // the caller is a page asking for something that is gone.
  if (!/^[0-9a-f]{24}$/.test(String(photoId))) return null;
  return backend.get(keyFor(planId, newCode, photoId));
}

async function delPhoto(planId, newCode, photoId) {
  if (!/^[0-9a-f]{24}$/.test(String(photoId))) return false;
  return backend.del(keyFor(planId, newCode, photoId));
}

function backendName() {
  return backend.name;
}

module.exports = { putPhoto, getPhoto, delPhoto, backendName };

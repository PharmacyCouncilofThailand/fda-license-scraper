'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * One inspection plan is one JSON document. Nothing here knows what a plan
 * means — that is `src/plans.js`.
 *
 * There are two backends because the system runs on Vercel today and moves to
 * the Pharmacy Council's own server later; the move has to be a setting, not
 * an edit to every caller.
 */

/** Plan ids reach here from a URL, so they may never contain a path. */
function assertId(id) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}(-[0-9]+)?$/.test(String(id || ''))) {
    const err = new Error('รหัสแผนไม่ถูกต้อง');
    err.status = 400;
    throw err;
  }
  return id;
}

function byDateDesc(a, b) {
  return String(b.date || b.id).localeCompare(String(a.date || a.id));
}

const file = {
  name: 'file',
  async all() {
    let names;
    try {
      names = await fs.readdir(config.plansDir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const plans = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const raw = await fs.readFile(path.join(config.plansDir, name), 'utf8');
      plans.push(JSON.parse(raw));
    }
    return plans;
  },
  async get(id) {
    try {
      const raw = await fs.readFile(path.join(config.plansDir, `${id}.json`), 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  },
  async put(plan) {
    await fs.mkdir(config.plansDir, { recursive: true });
    await fs.writeFile(
      path.join(config.plansDir, `${plan.id}.json`),
      JSON.stringify(plan, null, 2),
      'utf8'
    );
  },
  async del(id) {
    try {
      await fs.unlink(path.join(config.plansDir, `${id}.json`));
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  },
};

/*
 * Vercel's filesystem is read-only, so the deployment keeps plans in Blob.
 * `access: 'private'` matches the record template: a plan names the shops the
 * office is about to visit, which is not public information.
 *
 * The SDK is required lazily so a `file` deployment never loads it, and the
 * token is checked per call rather than at startup so the module can be
 * required (and tested) without one.
 */
const BLOB_PREFIX = 'plans/';

function blobApi() {
  if (!config.blobToken) {
    const err = new Error('ต้องตั้งค่า BLOB_READ_WRITE_TOKEN ก่อนใช้ที่เก็บแบบ blob');
    err.status = 500;
    throw err;
  }
  return require('@vercel/blob');
}

const blob = {
  name: 'blob',
  async all() {
    const { list: listBlobs } = blobApi();
    const { blobs } = await listBlobs({ prefix: BLOB_PREFIX, token: config.blobToken });
    const plans = [];
    for (const entry of blobs) {
      const response = await fetch(entry.downloadUrl, {
        headers: { Authorization: `Bearer ${config.blobToken}` },
      });
      if (response.ok) plans.push(await response.json());
    }
    return plans;
  },
  async get(id) {
    const { head } = blobApi();
    let meta;
    try {
      meta = await head(`${BLOB_PREFIX}${id}.json`, { token: config.blobToken });
    } catch {
      return null; // The SDK throws BlobNotFoundError; a missing plan is not an error here.
    }
    const response = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${config.blobToken}` },
    });
    return response.ok ? response.json() : null;
  },
  async put(plan) {
    const { put } = blobApi();
    await put(`${BLOB_PREFIX}${plan.id}.json`, JSON.stringify(plan, null, 2), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: config.blobToken,
    });
  },
  async del(id) {
    const { del } = blobApi();
    const existing = await blob.get(id);
    if (!existing) return false;
    await del(`${BLOB_PREFIX}${id}.json`, { token: config.blobToken });
    return true;
  },
};

const backends = { file, blob };
const backend = backends[config.plansStore] || file;

async function list() {
  return (await backend.all()).sort(byDateDesc);
}

async function get(id) {
  return backend.get(assertId(id));
}

async function save(plan) {
  assertId(plan.id);
  const next = { ...plan, updatedAt: new Date().toISOString() };
  await backend.put(next);
  return next;
}

async function remove(id) {
  return backend.del(assertId(id));
}

function backendName() {
  return backend.name;
}

module.exports = { list, get, save, remove, backendName };

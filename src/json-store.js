'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * One JSON document per id, in one of two places.
 *
 * There are two backends because the system runs on Vercel today and moves to
 * the Pharmacy Council's own server later; the move has to be a setting, not
 * an edit to every caller. Plans, records and (through a sibling module)
 * photos all need that same choice, so it lives here once.
 *
 * Nothing here knows what any document means.
 */
function createJsonStore({ backend, dir, prefix, idPattern, idError, sort }) {
  /** Ids reach here from a URL, so they may never contain a path. */
  function assertId(id) {
    if (!idPattern.test(String(id || ''))) {
      const err = new Error(idError);
      err.status = 400;
      throw err;
    }
    return id;
  }

  const file = {
    name: 'file',
    async all() {
      let names;
      try {
        names = await fs.readdir(dir);
      } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
      }
      const documents = [];
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        documents.push(JSON.parse(raw));
      }
      return documents;
    },
    async get(id) {
      try {
        return JSON.parse(await fs.readFile(path.join(dir, `${id}.json`), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async put(document) {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${document.id}.json`),
        JSON.stringify(document, null, 2),
        'utf8'
      );
    },
    async del(id) {
      try {
        await fs.unlink(path.join(dir, `${id}.json`));
        return true;
      } catch (err) {
        if (err.code === 'ENOENT') return false;
        throw err;
      }
    },
  };

  /*
   * Vercel's filesystem is read-only, so the deployment keeps documents in
   * Blob. `access: 'private'`: a plan names the shops the office is about to
   * visit, and a record carries what was found inside one. Neither is public.
   *
   * The SDK is required lazily so a `file` deployment never loads it, and the
   * token is checked per call rather than at startup so this module can be
   * required (and tested) without one.
   */
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
      const { blobs } = await listBlobs({ prefix, token: config.blobToken });
      const documents = [];
      for (const entry of blobs) {
        const response = await fetch(entry.downloadUrl, {
          headers: { Authorization: `Bearer ${config.blobToken}` },
        });
        if (response.ok) documents.push(await response.json());
      }
      return documents;
    },
    async get(id) {
      const { head } = blobApi();
      let meta;
      try {
        meta = await head(`${prefix}${id}.json`, { token: config.blobToken });
      } catch {
        return null; // The SDK throws BlobNotFoundError; a missing document is not an error here.
      }
      const response = await fetch(meta.downloadUrl, {
        headers: { Authorization: `Bearer ${config.blobToken}` },
      });
      return response.ok ? response.json() : null;
    },
    async put(document) {
      const { put } = blobApi();
      await put(`${prefix}${document.id}.json`, JSON.stringify(document, null, 2), {
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
      await del(`${prefix}${id}.json`, { token: config.blobToken });
      return true;
    },
  };

  const backends = { file, blob };
  const chosen = backends[backend] || file;

  return {
    async list() {
      const all = await chosen.all();
      return sort ? all.sort(sort) : all;
    },
    async get(id) {
      return chosen.get(assertId(id));
    },
    async save(document) {
      assertId(document.id);
      const next = { ...document, updatedAt: new Date().toISOString() };
      await chosen.put(next);
      return next;
    },
    async remove(id) {
      return chosen.del(assertId(id));
    },
    backendName() {
      return chosen.name;
    },
  };
}

module.exports = { createJsonStore };

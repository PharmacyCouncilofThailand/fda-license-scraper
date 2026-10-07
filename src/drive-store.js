'use strict';

const fs = require('fs/promises');
const path = require('path');
const config = require('./config');

/**
 * The office drive (ไดรฟ์): folders and files of any kind, with no tie to a
 * plan. Paths are `/`-joined segments and `''` is the root. Same backend
 * choice as the plans and photos, so a deployment still configures one thing.
 *
 * On a Pharmacy Council server, `DRIVE_DIR` pointed at the mounted NAS share
 * puts the files on the NAS with no code here knowing about it.
 */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// What no segment may hold: separators, what Windows (and so an SMB share on
// the NAS) refuses in a name, and control characters.
const BAD_CHARS = /[/\\<>:"|?*\u0000-\u001f\u007f]/;
// Holds an empty folder open on the blob side; never a user's name.
const KEEP = '.keep';

/** One segment, rejected rather than repaired — same rule as photo-store. */
function checkName(value) {
  const name = String(value ?? '').trim();
  if (!name || name.length > 200 || name === '.' || name === '..' || name === KEEP || BAD_CHARS.test(name)) {
    throw fail(400, 'ชื่อไฟล์หรือโฟลเดอร์ไม่ถูกต้อง');
  }
  return name;
}

function segments(value) {
  return String(value ?? '').split('/').filter((part) => part !== '').map(checkName);
}

/** 'ร้าน ก.pdf', 2 -> 'ร้าน ก (2).pdf' */
function numbered(name, n) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

/* --- file backend ------------------------------------------------------- */

const onDisk = (parts) => path.join(config.driveDir, ...parts);
const missing = (err) => err.code === 'ENOENT' || err.code === 'ENOTDIR';

const file = {
  name: 'file',
  async kind(parts) {
    try {
      return (await fs.stat(onDisk(parts))).isDirectory() ? 'folder' : 'file';
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
  },
  async list(parts) {
    const dir = onDisk(parts);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (missing(err)) return null;
      throw err;
    }
    const folders = [];
    const files = [];
    for (const entry of entries) {
      if (entry.isDirectory()) folders.push({ name: entry.name });
      else if (entry.isFile()) {
        const stat = await fs.stat(path.join(dir, entry.name));
        files.push({ name: entry.name, size: stat.size, modified: stat.mtime.toISOString() });
      }
    }
    return { folders, files };
  },
  async mkdir(parts) {
    await fs.mkdir(config.driveDir, { recursive: true });
    await fs.mkdir(onDisk(parts));
  },
  async put(parts, buffer) {
    await fs.mkdir(config.driveDir, { recursive: true });
    // `wx`: two uploads racing for one name fail rather than overwrite.
    await fs.writeFile(onDisk(parts), buffer, { flag: 'wx' });
  },
  async get(parts) {
    try {
      return await fs.readFile(onDisk(parts));
    } catch (err) {
      if (missing(err) || err.code === 'EISDIR') return null;
      throw err;
    }
  },
  async move(from, to) {
    await fs.rename(onDisk(from), onDisk(to));
  },
  async remove(parts) {
    await fs.rm(onDisk(parts), { recursive: true, force: true });
  },
};

/* --- blob backend ------------------------------------------------------- */

/*
 * Blob has no folders, only pathnames, so a folder is a prefix and an empty
 * one is held open by a `.keep` object. Segments are percent-encoded so a
 * pathname is plain ASCII whatever language the name is in.
 */
const PREFIX = 'drive/';
const keyOf = (parts) => PREFIX + parts.map(encodeURIComponent).join('/');

function blobApi() {
  if (!config.blobToken) throw fail(500, 'ต้องตั้งค่า BLOB_READ_WRITE_TOKEN ก่อนใช้ที่เก็บแบบ blob');
  return require('@vercel/blob');
}

async function everything(prefix) {
  const { list } = blobApi();
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, token: config.blobToken });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const blob = {
  name: 'blob',
  async kind(parts) {
    const { head, list } = blobApi();
    try {
      await head(keyOf(parts), { token: config.blobToken });
      return 'file';
    } catch {
      // Not a file; a folder if anything sits under it.
    }
    const page = await list({ prefix: `${keyOf(parts)}/`, limit: 1, token: config.blobToken });
    return page.blobs.length ? 'folder' : null;
  },
  async list(parts) {
    const { list } = blobApi();
    const prefix = parts.length ? `${keyOf(parts)}/` : PREFIX;
    const folders = [];
    const files = [];
    let found = false;
    let cursor;
    do {
      const page = await list({ prefix, mode: 'folded', cursor, token: config.blobToken });
      for (const folder of page.folders) {
        found = true;
        folders.push({ name: decodeURIComponent(folder.slice(prefix.length).replace(/\/$/, '')) });
      }
      for (const entry of page.blobs) {
        found = true;
        const name = decodeURIComponent(entry.pathname.slice(prefix.length));
        if (name === KEEP) continue;
        files.push({ name, size: entry.size, modified: new Date(entry.uploadedAt).toISOString() });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return found ? { folders, files } : null;
  },
  async mkdir(parts) {
    await blob.put([...parts, KEEP], Buffer.from('.'));
  },
  async put(parts, buffer) {
    const { put } = blobApi();
    await put(keyOf(parts), buffer, {
      access: 'private',
      contentType: 'application/octet-stream',
      addRandomSuffix: false,
      token: config.blobToken,
    });
  },
  async get(parts) {
    const { head } = blobApi();
    let meta;
    try {
      meta = await head(keyOf(parts), { token: config.blobToken });
    } catch {
      return null;
    }
    const response = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${config.blobToken}` },
    });
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  },
  // ponytail: a folder move copies object by object; fine for an office's
  // folders, a background job if one ever holds thousands of files.
  async move(from, to, kind) {
    const { copy, del } = blobApi();
    const pairs =
      kind === 'file'
        ? [[keyOf(from), keyOf(to)]]
        : (await everything(`${keyOf(from)}/`)).map((entry) => [
            entry.pathname,
            `${keyOf(to)}/${entry.pathname.slice(keyOf(from).length + 1)}`,
          ]);
    for (const [source, target] of pairs) {
      await copy(source, target, { access: 'private', addRandomSuffix: false, token: config.blobToken });
    }
    await del(pairs.map(([source]) => source), { token: config.blobToken });
  },
  async remove(parts, kind) {
    const { del } = blobApi();
    const keys =
      kind === 'file' ? [keyOf(parts)] : (await everything(`${keyOf(parts)}/`)).map((entry) => entry.pathname);
    if (keys.length) await del(keys, { token: config.blobToken });
  },
};

const backend = { file, blob }[config.plansStore] || file;

/* --- the drive ---------------------------------------------------------- */

const byName = (a, b) => a.name.localeCompare(b.name, 'th');

async function requireFolder(parts) {
  if (parts.length && (await backend.kind(parts)) !== 'folder') throw fail(404, 'ไม่พบโฟลเดอร์นี้');
}

async function list(dir) {
  const parts = segments(dir);
  const found = await backend.list(parts);
  if (!found) {
    if (parts.length) throw fail(404, 'ไม่พบโฟลเดอร์นี้');
    return { folders: [], files: [] };
  }
  return { folders: found.folders.sort(byName), files: found.files.sort(byName) };
}

async function mkdir(dir, name) {
  const parts = segments(dir);
  const target = [...parts, checkName(name)];
  await requireFolder(parts);
  if (await backend.kind(target)) throw fail(409, 'มีชื่อนี้อยู่แล้ว');
  await backend.mkdir(target);
}

/** Stores the file; a taken name becomes `name (1).ext`, `(2)`, … Returns the name used. */
async function put(dir, name, buffer) {
  const parts = segments(dir);
  const wanted = checkName(name);
  await requireFolder(parts);
  for (let n = 0; n < 1000; n += 1) {
    const candidate = n ? numbered(wanted, n) : wanted;
    if (await backend.kind([...parts, candidate])) continue;
    await backend.put([...parts, candidate], buffer);
    return candidate;
  }
  throw fail(409, 'มีไฟล์ชื่อนี้มากเกินไป');
}

async function get(filePath) {
  const parts = segments(filePath);
  return parts.length ? backend.get(parts) : null;
}

async function rename(itemPath, newName) {
  const parts = segments(itemPath);
  if (!parts.length) throw fail(400, 'เปลี่ยนชื่อโฟลเดอร์หลักไม่ได้');
  const name = checkName(newName);
  const kind = await backend.kind(parts);
  if (!kind) throw fail(404, 'ไม่พบรายการนี้');
  if (name === parts[parts.length - 1]) return name;
  const target = [...parts.slice(0, -1), name];
  if (await backend.kind(target)) throw fail(409, 'มีชื่อนี้อยู่แล้ว');
  await backend.move(parts, target, kind);
  return name;
}

/** Deletes a file, or a folder and everything in it. */
async function remove(itemPath) {
  const parts = segments(itemPath);
  if (!parts.length) throw fail(400, 'ลบโฟลเดอร์หลักไม่ได้');
  const kind = await backend.kind(parts);
  if (!kind) return false;
  await backend.remove(parts, kind);
  return true;
}

function backendName() {
  return backend.name;
}

module.exports = { list, mkdir, put, get, rename, remove, backendName };

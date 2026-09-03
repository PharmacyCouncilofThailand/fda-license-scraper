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

const backends = { file };
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

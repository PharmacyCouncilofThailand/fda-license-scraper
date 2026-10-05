/**
 * Offline check of the drive store's file backend. No network.
 *
 *   node test-drive-store.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-'));
process.env.PLANS_STORE = 'file';
process.env.DRIVE_DIR = dir;

const drive = require('./src/drive-store');

const rejects = (promise, status) => assert.rejects(promise, (err) => err.status === status);
const names = (entries) => entries.map((entry) => entry.name).sort();

(async () => {
  assert.strictEqual(drive.backendName(), 'file');
  assert.deepStrictEqual(await drive.list(''), { folders: [], files: [] }, 'ไดรฟ์ว่างต้องได้รายการว่าง');
  await rejects(drive.list('ไม่มี'), 404);

  // Names that could climb out of the drive, or that a disk cannot hold.
  for (const bad of ['..', 'a/../..', 'a\\b', 'x:y', 'a*b', '.keep', ' ', 'ก'.repeat(201)]) {
    await rejects(drive.list(bad), 400);
    await rejects(drive.mkdir('', bad), 400);
  }

  await drive.mkdir('', 'ใบอนุญาต');
  await rejects(drive.mkdir('', 'ใบอนุญาต'), 409);
  await rejects(drive.mkdir('ไม่มี', 'ย่อย'), 404);
  await rejects(drive.put('ไม่มี', 'a.pdf', Buffer.from('x')), 404);

  // A taken name is numbered, never overwritten.
  assert.strictEqual(await drive.put('ใบอนุญาต', 'ร้าน ก.pdf', Buffer.from('one')), 'ร้าน ก.pdf');
  assert.strictEqual(await drive.put('ใบอนุญาต', 'ร้าน ก.pdf', Buffer.from('two')), 'ร้าน ก (1).pdf');
  assert.strictEqual(await drive.put('ใบอนุญาต', 'README', Buffer.from('r')), 'README');
  assert.strictEqual(await drive.put('ใบอนุญาต', 'README', Buffer.from('r')), 'README (1)');
  assert.strictEqual(String(await drive.get('ใบอนุญาต/ร้าน ก.pdf')), 'one');
  assert.strictEqual(String(await drive.get('ใบอนุญาต/ร้าน ก (1).pdf')), 'two');
  assert.strictEqual(await drive.get('ใบอนุญาต/ไม่มี.pdf'), null);
  assert.strictEqual(await drive.get('ใบอนุญาต'), null, 'โฟลเดอร์ไม่ใช่ไฟล์');
  assert.strictEqual(await drive.get(''), null);

  const listing = await drive.list('ใบอนุญาต');
  assert.deepStrictEqual(names(listing.files), names([
    { name: 'README' }, { name: 'README (1)' }, { name: 'ร้าน ก (1).pdf' }, { name: 'ร้าน ก.pdf' },
  ]));
  const first = listing.files.find((entry) => entry.name === 'ร้าน ก.pdf');
  assert.strictEqual(first.size, 3);
  assert.ok(!Number.isNaN(Date.parse(first.modified)));

  // Rename: in place, never over something else.
  await rejects(drive.rename('ใบอนุญาต/README', 'README (1)'), 409);
  await rejects(drive.rename('ใบอนุญาต/ไม่มี', 'x'), 404);
  await rejects(drive.rename('', 'x'), 400);
  await rejects(drive.rename('ใบอนุญาต/README', '../x'), 400);
  assert.strictEqual(await drive.rename('ใบอนุญาต/README', 'อ่านก่อน.txt'), 'อ่านก่อน.txt');
  assert.strictEqual(await drive.get('ใบอนุญาต/README'), null);

  // A renamed folder keeps what is inside it.
  await drive.mkdir('ใบอนุญาต', '2569');
  await drive.put('ใบอนุญาต/2569', 'a.jpg', Buffer.from('a'));
  assert.deepStrictEqual(names((await drive.list('ใบอนุญาต')).folders), ['2569']);
  await drive.rename('ใบอนุญาต', 'ใบอนุญาตร้านยา');
  assert.strictEqual(String(await drive.get('ใบอนุญาตร้านยา/2569/a.jpg')), 'a');
  await rejects(drive.list('ใบอนุญาต'), 404);

  // Delete: a file, then a folder with everything in it.
  assert.strictEqual(await drive.remove('ใบอนุญาตร้านยา/อ่านก่อน.txt'), true);
  assert.strictEqual(await drive.remove('ใบอนุญาตร้านยา/อ่านก่อน.txt'), false);
  assert.strictEqual(await drive.remove('ใบอนุญาตร้านยา'), true);
  assert.deepStrictEqual(await drive.list(''), { folders: [], files: [] });
  await rejects(drive.remove(''), 400);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('drive-store: ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

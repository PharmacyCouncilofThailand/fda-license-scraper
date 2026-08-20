'use strict';

/**
 * The smallest zip reader/writer that can round-trip a .docx.
 *
 * A .docx is a zip of XML parts; filling the inspection form means swapping
 * the bytes of one part, `word/document.xml`, and writing the archive back.
 * That is stored/deflated entries and a central directory — zlib does the
 * compression, so a zip library would be a dependency for about eighty lines.
 *
 * Only what a .docx actually uses is handled: no zip64, no encryption, no
 * data descriptors (Word writes sizes into the local header).
 */

const zlib = require('zlib');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const END_SIG = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ -1) >>> 0;
}

/**
 * Read every entry, in the order the archive stores them. Order is preserved
 * on write because Word expects `[Content_Types].xml` to come first.
 */
function read(buf) {
  // The central directory is authoritative — local headers can carry zeroed
  // sizes when a writer used a data descriptor.
  const end = findEndRecord(buf);
  let offset = buf.readUInt32LE(end + 16);
  const count = buf.readUInt16LE(end + 10);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(offset) !== CENTRAL_SIG) {
      throw new Error('zip: central directory entry not found');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.slice(offset + 46, offset + 46 + nameLen).toString('utf8');

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`zip: bad local header for ${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.slice(start, start + compSize);

    entries.push({
      name,
      data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw),
    });

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findEndRecord(buf) {
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === END_SIG) return i;
  }
  throw new Error('zip: end of central directory not found');
}

/** Write entries back out, deflated. */
function write(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date — 1980-01-01, no clock needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + deflated.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIG, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, end]);
}

module.exports = { read, write, crc32 };

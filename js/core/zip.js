/* Language Surface — minimal ZIP writer (stored, no compression). Enough to bundle a few text files. */
(function (LS) {
  "use strict";

  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const day = (Math.max(1980, d.getFullYear()) - 1980) << 9 | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: day & 0xffff };
  }

  /**
   * Build a ZIP archive.
   * @param {{name: string, content: string|Uint8Array}[]} files
   * @param {Date} [date] timestamp stored for every entry
   * @returns {Uint8Array}
   */
  function create(files, date) {
    const enc = new TextEncoder();
    const stamp = dosDateTime(date);
    const parts = [];
    const central = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = enc.encode(file.name);
      const data = typeof file.content === "string" ? enc.encode(file.content) : file.content;
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); // local file header signature
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // flags: UTF-8 names
      local.setUint16(8, 0, true); // method: stored
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, data);

      const dir = new DataView(new ArrayBuffer(46));
      dir.setUint32(0, 0x02014b50, true); // central directory signature
      dir.setUint16(4, 20, true); // version made by
      dir.setUint16(6, 20, true); // version needed
      dir.setUint16(8, 0x0800, true);
      dir.setUint16(10, 0, true);
      dir.setUint16(12, stamp.time, true);
      dir.setUint16(14, stamp.date, true);
      dir.setUint32(16, crc, true);
      dir.setUint32(20, data.length, true);
      dir.setUint32(24, data.length, true);
      dir.setUint16(28, nameBytes.length, true);
      dir.setUint16(30, 0, true); // extra length
      dir.setUint16(32, 0, true); // comment length
      dir.setUint16(34, 0, true); // disk number
      dir.setUint16(36, 0, true); // internal attributes
      dir.setUint32(38, 0, true); // external attributes
      dir.setUint32(42, offset, true); // local header offset
      central.push(new Uint8Array(dir.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    }

    const centralSize = central.reduce((n, p) => n + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); // end of central directory
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    end.setUint16(20, 0, true);

    const all = parts.concat(central, [new Uint8Array(end.buffer)]);
    const total = all.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of all) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  LS.zip = { create, crc32 };
})(globalThis.LS || (globalThis.LS = {}));

// Builds upload-ready zips for itch.io and CrazyGames into dist/.
// Usage: node tools/build.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const SLUG = 'chain-riders';
const FILES = ['index.html', 'game.js'];
const CRAZYGAMES_SDK = '<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>';

const TARGETS = {
  itch: (html) => html.replace('<!-- PLATFORM_SDK -->', ''),
  crazygames: (html) => html.replace('<!-- PLATFORM_SDK -->', CRAZYGAMES_SDK),
};

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Minimal zip writer (deflate), so the build has no npm dependencies.
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

fs.rmSync(dist, { recursive: true, force: true });
for (const [target, transformHtml] of Object.entries(TARGETS)) {
  const outDir = path.join(dist, target);
  fs.mkdirSync(outDir, { recursive: true });
  const entries = FILES.map((name) => {
    let data = fs.readFileSync(path.join(root, name));
    if (name === 'index.html') data = Buffer.from(transformHtml(data.toString('utf8')));
    fs.writeFileSync(path.join(outDir, name), data);
    return { name, data };
  });
  const zipPath = path.join(dist, `${SLUG}-${target}.zip`);
  fs.writeFileSync(zipPath, zip(entries));
  console.log(`${path.relative(root, zipPath)}  (${(fs.statSync(zipPath).size / 1024).toFixed(1)} KB)`);
}

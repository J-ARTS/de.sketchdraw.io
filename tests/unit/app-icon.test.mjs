import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// App icon (#171): the installers take these committed files; a broken or missing one would only show up in a release run.
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = (path) => readFileSync(resolve(root, path));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width, height and colour type from the IHDR chunk of a PNG. */
function pngInfo(data) {
  assert.deepEqual(data.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(data.toString('latin1', 12, 16), 'IHDR');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
}

test('electron-builder takes the app icon of every platform from build/', () => {
  const config = JSON.parse(file('electron-builder.json').toString('utf8'));
  assert.equal(config.directories.buildResources, 'build');
  assert.equal(config.mac.icon, 'build/icon.icns');
  assert.equal(config.win.icon, 'build/icon.ico');
  assert.equal(config.linux.icon, 'build/icons');
});

test('the macOS icon is an icns container with PNG entries up to 1024 px', () => {
  const data = file('build/icon.icns');
  assert.equal(data.toString('latin1', 0, 4), 'icns');
  assert.equal(data.readUInt32BE(4), data.length);
  const sizes = new Map();
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset + 4);
    assert.ok(length > 8 && offset + length <= data.length);
    const info = pngInfo(data.subarray(offset + 8, offset + length));
    assert.equal(info.width, info.height);
    assert.equal(info.colorType, 6);
    sizes.set(data.toString('latin1', offset, offset + 4), info.width);
    offset += length;
  }
  assert.deepEqual(Object.fromEntries(sizes), { ic07: 128, ic08: 256, ic09: 512, ic10: 1024, ic11: 32, ic12: 64, ic13: 256, ic14: 512 });
});

test('the Windows icon holds every size from 16 to 256 px', () => {
  const data = file('build/icon.ico');
  assert.deepEqual([data.readUInt16LE(0), data.readUInt16LE(2)], [0, 1]);
  const count = data.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    const declared = data[entry] || 256;
    const length = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    assert.ok(offset + length <= data.length);
    const info = pngInfo(data.subarray(offset, offset + length));
    assert.deepEqual([info.width, info.height, info.colorType], [declared, declared, 6]);
    sizes.push(declared);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
});

test('the Linux icon set and the window icon are square RGBA PNGs named after their size', () => {
  const names = readdirSync(resolve(root, 'build/icons')).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  assert.deepEqual(names, [16, 24, 32, 48, 64, 128, 256, 512, 1024].map((size) => `${size}x${size}.png`));
  for (const name of names) {
    const size = parseInt(name, 10);
    assert.deepEqual(pngInfo(file(`build/icons/${name}`)), { width: size, height: size, colorType: 6 });
  }
  assert.deepEqual(pngInfo(file('public/app-icon.png')), { width: 256, height: 256, colorType: 6 });
});

test('the cut-out icon has transparent corners and an opaque centre', async () => {
  // Decoded with zlib only: filter bytes are undone for the first and the middle scanline of the 64 px icon.
  const { inflateSync } = await import('node:zlib');
  const data = file('build/icons/64x64.png');
  const chunks = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    if (data.toString('latin1', offset + 4, offset + 8) === 'IDAT') chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = 64 * 4 + 1;
  const rows = [];
  for (let y = 0; y < 64; y++) {
    const line = Buffer.from(raw.subarray(y * stride + 1, (y + 1) * stride));
    const filter = raw[y * stride];
    const previous = rows[y - 1];
    for (let x = 0; x < line.length; x++) {
      const left = x >= 4 ? line[x - 4] : 0;
      const up = previous ? previous[x] : 0;
      const upLeft = previous && x >= 4 ? previous[x - 4] : 0;
      const paeth = () => { const p = left + up - upLeft; const pa = Math.abs(p - left); const pb = Math.abs(p - up); const pc = Math.abs(p - upLeft); return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft; };
      line[x] = (line[x] + [0, left, up, (left + up) >> 1, paeth()][filter]) & 0xff;
    }
    rows.push(line);
  }
  const alpha = (x, y) => rows[y][x * 4 + 3];
  assert.deepEqual([alpha(0, 0), alpha(63, 0), alpha(0, 63), alpha(63, 63)], [0, 0, 0, 0]);
  // Resampling leaves the body a step or two below full opacity near its edge.
  assert.ok(alpha(32, 32) >= 250);
  assert.ok(alpha(32, 6) >= 250);
});

test('the browser tab and the window use the shipped icon', () => {
  assert.match(file('index.html').toString('utf8'), /<link rel="icon" type="image\/png" href="\.\/app-icon\.png" \/>/);
  assert.match(file('electron/main.ts').toString('utf8'), /app-icon\.png/);
});

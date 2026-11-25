// Generates icons/icon-192.png and icons/icon-512.png with no dependencies.
// Design: a scorebook foul box with a pencil slash in team blue, on ink with ledger rules.
// Run: node tools/make-icons.js
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var INK = [0x10, 0x18, 0x20], LEDGER = [0x1D, 0x5C, 0x55], PAPER = [0xFF, 0xFF, 0xFF], BLUE = [0x23, 0x40, 0xC8];

function pixel(x, y, s) {
  var u = s / 192, b = 96 * u, o = (s - b) / 2;
  var inBox = x >= o && x < o + b && y >= o && y < o + b;
  if (inBox) {
    // Diagonal slash from bottom-left to top-right: distance to the line x + y = 2o + b.
    var d = Math.abs((x - o) + (y - o) - b) / Math.SQRT2;
    return d < 8 * u ? BLUE : PAPER;
  }
  if (Math.abs(y % (32 * u)) < 2 * u && y > 1) return LEDGER;
  return INK;
}

var CRC = [];
for (var n = 0; n < 256; n++) {
  var c = n;
  for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  var td = Buffer.concat([Buffer.from(type), data]);
  var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  var raw = Buffer.alloc(size * (size * 3 + 1));
  for (var y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (var x = 0; x < size; x++) {
      var p = pixel(x + 0.5, y + 0.5, size), i = y * (size * 3 + 1) + 1 + x * 3;
      raw[i] = p[0]; raw[i + 1] = p[1]; raw[i + 2] = p[2];
    }
  }
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

var dir = path.resolve(__dirname, '..', 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir);
[192, 512].forEach(function (s) {
  fs.writeFileSync(path.join(dir, 'icon-' + s + '.png'), png(s));
  console.log('wrote icons/icon-' + s + '.png');
});

// Draws build/icon.png (512×512): the avatar's face in its idle pose. electron-builder turns it
// into the Windows .ico. Run with `node scripts/make-icon.mjs` after changing the character.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 512;
const px = new Float32Array(S * S * 4); // straight RGBA, 0..1

/** Signed distance to a rounded rectangle centred at (cx, cy). Negative inside. */
function roundRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function blend(i, [r, g, b], a) {
  if (a <= 0) return;
  const k = 1 - a;
  px[i] = r * a + px[i] * k;
  px[i + 1] = g * a + px[i + 1] * k;
  px[i + 2] = b * a + px[i + 2] * k;
  px[i + 3] = a + px[i + 3] * k;
}

const hex = (h) => [1, 3, 5].map((o) => parseInt(h.slice(o, o + 2), 16) / 255);
const VIOLET = hex('#a78bfa');
const GLOW = hex('#8b5cf6');
const BODY_TOP = hex('#272036');
const BODY_BOTTOM = hex('#14111c');
const SCREEN = hex('#0e0c14');
const EYE = hex('#c4b5fd');
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1 px anti-aliasing

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    const body = roundRect(x, y, 256, 262, 200, 190, 64);
    // Soft violet glow around the body.
    blend(i, GLOW, Math.max(0, 0.45 * Math.exp(-Math.max(0, body) / 22)) * (body > 0 ? 1 : 0));
    // Body with a vertical gradient, violet rim.
    const t = (y - 72) / 380;
    const fill = BODY_TOP.map((c, k) => c + (BODY_BOTTOM[k] - c) * Math.min(1, Math.max(0, t)));
    blend(i, VIOLET, cover(body));
    blend(i, fill, cover(body + 9));
    // The dark "screen" panel.
    blend(i, SCREEN, 0.7 * cover(roundRect(x, y, 256, 268, 150, 120, 36)));
    // Two pill eyes.
    for (const ex of [196, 316]) blend(i, EYE, cover(roundRect(x, y, ex, 238, 22, 46, 22)));
    // Smile: a thick arc.
    const d = Math.hypot(x - 256, y - 250);
    const onArc = Math.abs(d - 74) - 8;
    const below = y > 300 && Math.abs(x - 256) < 60;
    if (below) blend(i, EYE, cover(onArc));
  }
}

// --- minimal PNG encoder ---------------------------------------------------------------------
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < S * 4; x++)
    raw[y * (S * 4 + 1) + 1 + x] = Math.round(Math.min(1, px[y * S * 4 + x]) * 255);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', png);
console.log(`build/icon.png written (${png.length} bytes)`);

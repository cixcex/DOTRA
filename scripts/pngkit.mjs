// ---------------------------------------------------------------------------
// DOTRA procedural image kit — dependency-free PNG writer + pixel utilities
// used to generate the bundled sample gallery, favicons and OG artwork.
// ---------------------------------------------------------------------------

import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// --- PNG encoding ------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return out;
}

export function encodePNG(width, height, rgba) {
  const src = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    src.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ];
  return Buffer.concat(parts);
}

export function savePNG(path, width, height, rgba) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePNG(width, height, rgba));
}

// --- image model ---------------------------------------------------------------

export function makeImage(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

export function setPx(img, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const i = (y * img.w + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}

export function getPx(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function fillRect(img, x0, y0, w, h, color, alpha = 1) {
  const xs = Math.max(0, Math.floor(x0));
  const ys = Math.max(0, Math.floor(y0));
  const xe = Math.min(img.w, Math.ceil(x0 + w));
  const ye = Math.min(img.h, Math.ceil(y0 + h));
  for (let y = ys; y < ye; y++) {
    for (let x = xs; x < xe; x++) {
      const i = (y * img.w + x) * 4;
      if (alpha < 1) {
        const a = img.data[i + 3] / 255;
        img.data[i] = img.data[i] * (1 - alpha) + color[0] * alpha;
        img.data[i + 1] = img.data[i + 1] * (1 - alpha) + color[1] * alpha;
        img.data[i + 2] = img.data[i + 2] * (1 - alpha) + color[2] * alpha;
        img.data[i + 3] = 255 * Math.max(a, alpha);
      } else {
        img.data[i] = color[0];
        img.data[i + 1] = color[1];
        img.data[i + 2] = color[2];
        img.data[i + 3] = 255;
      }
    }
  }
}

export function fillCircle(img, cx, cy, r, color, alpha = 1) {
  const r2 = r * r;
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(img.h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(img.w - 1, Math.ceil(cx + r)); x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const i = (y * img.w + x) * 4;
        if (alpha < 1) {
          img.data[i] = img.data[i] * (1 - alpha) + color[0] * alpha;
          img.data[i + 1] = img.data[i + 1] * (1 - alpha) + color[1] * alpha;
          img.data[i + 2] = img.data[i + 2] * (1 - alpha) + color[2] * alpha;
          img.data[i + 3] = 255;
        } else {
          img.data[i] = color[0];
          img.data[i + 1] = color[1];
          img.data[i + 2] = color[2];
          img.data[i + 3] = 255;
        }
      }
    }
  }
}

export function forEachPixel(img, fn) {
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const out = fn(x, y);
      if (out) {
        const i = (y * img.w + x) * 4;
        img.data[i] = out[0];
        img.data[i + 1] = out[1];
        img.data[i + 2] = out[2];
        img.data[i + 3] = out[3];
      }
    }
  }
}

// --- colour helpers --------------------------------------------------------------

export const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function mixc(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

/** Multi-stop gradient: stops = [[pos, [r,g,b]], ...] */
export function gradient(stops) {
  return (t) => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [p0, c0] = stops[i];
      const [p1, c1] = stops[i + 1];
      if (t >= p0 && t <= p1) {
        const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
        return mixc(c0, c1, k);
      }
    }
    return stops[stops.length - 1][1];
  };
}

// --- deterministic randomness ----------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 2D value noise with fbm. */
export function makeNoise2D(seed = 1) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const base = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const val = (ix, iy) => perm[(perm[ix & 255] + iy) & 255] / 255;
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const a = val(ix, iy), b = val(ix + 1, iy), c = val(ix, iy + 1), d = val(ix + 1, iy + 1);
    const u = smooth(fx), v = smooth(fy);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  return (x, y, octaves = 4) => {
    let sum = 0, amp = 0.5, freq = 1;
    for (let o = 0; o < octaves; o++) {
      sum += noise(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  };
}

/** Bilinear sample of an image onto another coordinate space. */
export function sampleImage(img, u, v) {
  const x = Math.max(0, Math.min(img.w - 1.001, u * (img.w - 1)));
  const y = Math.max(0, Math.min(img.h - 1.001, v * (img.h - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const c00 = getPx(img, x0, y0), c10 = getPx(img, x1, y0), c01 = getPx(img, x0, y1), c11 = getPx(img, x1, y1);
  const ch = (i) =>
    lerp(lerp(c00[i], c10[i], fx), lerp(c01[i], c11[i], fx), fy);
  return [ch(0), ch(1), ch(2), 255];
}

/** Draw `src` image onto `dst` with cover-fit into a square region. */
export function drawCover(dst, src, dx, dy, size) {
  const scale = Math.max(size / src.w, size / src.h);
  const dw = src.w * scale, dh = src.h * scale;
  const offX = (size - dw) / 2, offY = (size - dh) / 2;
  // integer destination origin — setPx is a typed-array write and silently
  // no-ops on float coordinates
  const ix = Math.floor(dx), iy = Math.floor(dy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5 - offX) / dw;
      const v = (y + 0.5 - offY) / dh;
      const [r, g, b] = sampleImage(src, u, v);
      setPx(dst, ix + x, iy + y, r, g, b);
    }
  }
}

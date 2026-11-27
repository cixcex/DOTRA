// ---------------------------------------------------------------------------
// DOTRA Engine Lab — pure raster core
//
// A tiny deterministic raster painter over Uint8ClampedArray RGBA. The browser
// engines AND the Node test harness render through these exact same functions,
// so there is zero mirror drift between what the app shows and what the tests
// verify. No DOM / canvas dependencies in this file.
// ---------------------------------------------------------------------------

import Delaunator from 'delaunator';

export type RGBA = [number, number, number, number];

export const WHITE: RGBA = [255, 255, 255, 255];
export const BLACK: RGBA = [0, 0, 0, 255];

/** Deterministic PRNG (mulberry32) — seeded renders are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parse #rgb / #rrggbb into an RGBA tuple (alpha forced opaque). */
export function hexToRgba(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [...WHITE];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function lumaOf(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number, data?: Uint8ClampedArray) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8ClampedArray(w * h * 4).fill(255);
  }

  idx(x: number, y: number): number {
    return (y * this.w + x) * 4;
  }

  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = this.idx(x, y);
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = c[3];
  }

  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [...WHITE];
    const i = this.idx(x, y);
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** Rectangle with floor/ceil edges — matches canvas fillRect semantics. */
  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.set(px, py, c);
    }
  }

  fillCircle(cx: number, cy: number, rad: number, c: RGBA): void {
    const r2 = rad * rad;
    const x0 = Math.max(0, Math.floor(cx - rad));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rad));
    const y0 = Math.max(0, Math.floor(cy - rad));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rad));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(px, py, c);
      }
    }
  }

  /** Rounded rectangle via the standard SDF corner test. */
  fillRoundRect(x: number, y: number, w: number, h: number, rad: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w));
    const y1 = Math.min(this.h, Math.ceil(y + h));
    const r = Math.min(rad, w / 2, h / 2);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const nx = px + 0.5 < x + r ? x + r : px + 0.5 > x + w - r ? x + w - r : px + 0.5;
        const ny = py + 0.5 < y + r ? y + r : py + 0.5 > y + h - r ? y + h - r : py + 0.5;
        const dx = px + 0.5 - nx;
        const dy = py + 0.5 - ny;
        if (dx * dx + dy * dy <= r * r) this.set(px, py, c);
      }
    }
  }

  /** Even-odd point-in-polygon fill. */
  fillPoly(points: [number, number][], c: RGBA): void {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const x0 = Math.max(0, Math.floor(minX));
    const x1 = Math.min(this.w - 1, Math.ceil(maxX));
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        if (pointInPoly(px + 0.5, py + 0.5, points)) this.set(px, py, c);
      }
    }
  }

  /**
   * Cover-fit a source raster into a destination rectangle (nearest sampling).
   * Destination origin is floored — float origins silently no-op on typed
   * arrays, so every caller goes through this integer-safe path.
   */
  drawCover(src: Raster, dx: number, dy: number, dw: number, dh: number): void {
    if (dw <= 0 || dh <= 0 || src.w === 0 || src.h === 0) return;
    const scale = Math.max(dw / src.w, dh / src.h);
    const sw = dw / scale;
    const sh = dh / scale;
    const offX = (src.w - sw) / 2;
    const offY = (src.h - sh) / 2;
    const ix = Math.floor(dx);
    const iy = Math.floor(dy);
    const iw = Math.ceil(dw);
    const ih = Math.ceil(dh);
    for (let y = 0; y < ih; y++) {
      const sy = offY + ((y + 0.5) / ih) * sh;
      const syi = Math.min(src.h - 1, Math.max(0, Math.floor(sy)));
      for (let x = 0; x < iw; x++) {
        const sx = offX + ((x + 0.5) / iw) * sw;
        const sxi = Math.min(src.w - 1, Math.max(0, Math.floor(sx)));
        const i = src.idx(sxi, syi);
        this.set(ix + x, iy + y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
    }
  }

  /**
   * Nearest-sample a sub-region of `src` (source rect rsx,rsy,rsw,rsh) into
   * the dest rect — per-module photographic tiles for the Engine Lab engines.
   */
  drawCoverRegion(src: Raster, rsx: number, rsy: number, rsw: number, rsh: number, dx: number, dy: number, dw: number, dh: number): void {
    if (dw <= 0 || dh <= 0 || rsw <= 0 || rsh <= 0) return;
    const ix = Math.floor(dx), iy = Math.floor(dy);
    const iw = Math.ceil(dw), ih = Math.ceil(dh);
    for (let y = 0; y < ih; y++) {
      const py = rsy + ((y + 0.5) / ih) * rsh;
      const syi = Math.min(src.h - 1, Math.max(0, Math.floor(py)));
      for (let x = 0; x < iw; x++) {
        const px = rsx + ((x + 0.5) / iw) * rsw;
        const sxi = Math.min(src.w - 1, Math.max(0, Math.floor(px)));
        const i = src.idx(sxi, syi);
        this.set(ix + x, iy + y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
    }
  }

  /** Blend a rect toward a solid colour by alpha (0..1) — tone-pinning for photo tiles. */
  blendRect(x: number, y: number, w: number, h: number, c: RGBA, alpha: number): void {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.w, Math.ceil(x + w)), y1 = Math.min(this.h, Math.ceil(y + h));
    const a = Math.min(1, Math.max(0, alpha));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const i = this.idx(px, py);
        this.data[i] += (c[0] - this.data[i]) * a;
        this.data[i + 1] += (c[1] - this.data[i + 1]) * a;
        this.data[i + 2] += (c[2] - this.data[i + 2]) * a;
        this.data[i + 3] += (c[3] - this.data[i + 3]) * a;
      }
    }
  }

  luma(x: number, y: number): number {
    const [r, g, b] = this.get(x, y);
    return lumaOf(r, g, b);
  }

  clone(): Raster {
    return new Raster(this.w, this.h, new Uint8ClampedArray(this.data));
  }
}

function pointInPoly(x: number, y: number, pts: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Post effects (shared browser/Node)
// ---------------------------------------------------------------------------

/** Separable box blur with edge-replicate window — matches canvas blur look. */
/** Cover-fit source window of `src` inside a destW×destH rect — shared by the
 *  photographic module tiles to map a module rect back to photo pixels. */
export function coverWindow(srcW: number, srcH: number, destW: number, destH: number): { sx: number; sy: number; sw: number; sh: number } {
  const scale = Math.max(destW / srcW, destH / srcH);
  const sw = destW / scale;
  const sh = destH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

/** Average luma over the 3×3 module centre — the polarity guard samples here. */
export function centreLuma(out: Raster, cx: number, cy: number): number {
  const ix = Math.round(cx), iy = Math.round(cy);
  let s = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      s += out.luma(ix + dx, iy + dy); n++;
    }
  }
  return s / n;
}

export function boxBlur(src: Raster, radius: number): Raster {
  const r = Math.max(1, Math.round(radius));
  const out = new Raster(src.w, src.h);
  const tmp = new Float32Array(src.w * src.h * 3);
  const n = 2 * r + 1;
  // horizontal pass
  for (let y = 0; y < src.h; y++) {
    let sr = 0, sg = 0, sb = 0;
    for (let x = -r; x <= r; x++) {
      const xx = Math.min(src.w - 1, Math.max(0, x));
      const i = src.idx(xx, y);
      sr += src.data[i]; sg += src.data[i + 1]; sb += src.data[i + 2];
    }
    for (let x = 0; x < src.w; x++) {
      tmp[(y * src.w + x) * 3] = sr / n;
      tmp[(y * src.w + x) * 3 + 1] = sg / n;
      tmp[(y * src.w + x) * 3 + 2] = sb / n;
      const ia = src.idx(Math.min(src.w - 1, Math.max(0, x - r)), y);
      const ib = src.idx(Math.min(src.w - 1, Math.max(0, x + r + 1)), y);
      sr += src.data[ib] - src.data[ia];
      sg += src.data[ib + 1] - src.data[ia + 1];
      sb += src.data[ib + 2] - src.data[ia + 2];
    }
  }
  // vertical pass
  for (let x = 0; x < src.w; x++) {
    let sr = 0, sg = 0, sb = 0;
    for (let y = -r; y <= r; y++) {
      const yy = Math.min(src.h - 1, Math.max(0, y));
      const t = (yy * src.w + x) * 3;
      sr += tmp[t]; sg += tmp[t + 1]; sb += tmp[t + 2];
    }
    for (let y = 0; y < src.h; y++) {
      const i = src.idx(x, y);
      out.data[i] = sr / n;
      out.data[i + 1] = sg / n;
      out.data[i + 2] = sb / n;
      out.data[i + 3] = src.data[i + 3];
      const ta = (Math.min(src.h - 1, Math.max(0, y - r)) * src.w + x) * 3;
      const tb = (Math.min(src.h - 1, Math.max(0, y + r + 1)) * src.w + x) * 3;
      sr += tmp[tb] - tmp[ta];
      sg += tmp[tb + 1] - tmp[ta + 1];
      sb += tmp[tb + 2] - tmp[ta + 2];
    }
  }
  return out;
}

/**
 * Crystalize — jittered-grid Delaunay triangulation, each triangle filled with
 * its average colour (the qrcode-toolkit "crystalize" effect, ported from
 * duanxianpi/artistic-qrcode-generator, MIT).
 */
export function crystalize(src: Raster, radius: number, seed: number): Raster {
  const r = Math.max(4, radius);
  const rng = mulberry32(seed);
  const triH = (r * Math.sqrt(3)) / 2;
  const xCount = Math.ceil(src.w / r + 1);
  const yCount = Math.ceil(src.h / triH + 1);
  const DISTORT = 1.2;
  const pts: [number, number][] = [];
  for (let yi = 0; yi < yCount; yi++) {
    for (let xi = 0; xi < xCount; xi++) {
      let x = xi * r + (yi % 2 ? r / 2 : 0);
      let y = yi * triH;
      x += (rng() - 0.5) * r * DISTORT;
      y += (rng() - 0.5) * triH * DISTORT;
      pts.push([x, y]);
    }
  }
  const delaunay = Delaunator.from(pts, (p) => p[0], (p) => p[1]);
  const out = new Raster(src.w, src.h);
  const triangles = delaunay.triangles;
  for (let t = 0; t < triangles.length; t += 3) {
    const p1 = pts[triangles[t]];
    const p2 = pts[triangles[t + 1]];
    const p3 = pts[triangles[t + 2]];
    const minX = Math.max(0, Math.floor(Math.min(p1[0], p2[0], p3[0])));
    const maxX = Math.min(src.w - 1, Math.ceil(Math.max(p1[0], p2[0], p3[0])));
    const minY = Math.max(0, Math.floor(Math.min(p1[1], p2[1], p3[1])));
    const maxY = Math.min(src.h - 1, Math.ceil(Math.max(p1[1], p2[1], p3[1])));
    let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInTriangle(x + 0.5, y + 0.5, p1, p2, p3)) {
          const i = src.idx(x, y);
          sr += src.data[i]; sg += src.data[i + 1]; sb += src.data[i + 2]; sa += src.data[i + 3];
          n++;
        }
      }
    }
    if (n === 0) continue;
    const c: RGBA = [sr / n, sg / n, sb / n, sa / n];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInTriangle(x + 0.5, y + 0.5, p1, p2, p3)) out.set(x, y, c);
      }
    }
  }
  return out;
}

function pointInTriangle(x: number, y: number, p1: number[], p2: number[], p3: number[]): boolean {
  const denominator = (p2[1] - p3[1]) * (p1[0] - p3[0]) + (p3[0] - p2[0]) * (p1[1] - p3[1]);
  if (denominator === 0) return false;
  const a = ((p2[1] - p3[1]) * (x - p3[0]) + (p3[0] - p2[0]) * (y - p3[1])) / denominator;
  const b = ((p3[1] - p1[1]) * (x - p3[0]) + (p1[0] - p3[0]) * (y - p3[1])) / denominator;
  const c = 1 - a - b;
  return a >= 0 && a <= 1 && b >= 0 && b <= 1 && c >= 0 && c <= 1;
}

/**
 * Liquidify — box blur then hard two-tone threshold (the qrcode-toolkit
 * "liquidify" effect, ported from duanxianpi/artistic-qrcode-generator, MIT).
 */
export function liquidify(src: Raster, radius: number, light: RGBA, dark: RGBA, threshold = 128): Raster {
  const blurred = boxBlur(src, radius);
  for (let i = 0; i < blurred.data.length; i += 4) {
    const avg = (blurred.data[i] + blurred.data[i + 1] + blurred.data[i + 2]) / 3;
    const c = avg > threshold ? light : dark;
    blurred.data[i] = c[0];
    blurred.data[i + 1] = c[1];
    blurred.data[i + 2] = c[2];
    blurred.data[i + 3] = 255;
  }
  return blurred;
}

/** Solve an 8x8 linear system (Gaussian elimination with partial pivoting). */
function solve8(A: number[][], b: number[]): number[] | null {
  const n = 8;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / m[i][i]);
}

/**
 * Perspective warp — bilinear resample through a homography fitted from four
 * corner correspondences (a keystone tilt of `amount`). amount 0 returns a
 * clone; areas mapping outside the source are filled white (the frame).
 */
export function perspectiveWarp(src: Raster, amount: number): Raster {
  const out = new Raster(src.w, src.h);
  if (amount <= 0) {
    out.data.set(src.data);
    return out;
  }
  const w = src.w, h = src.h;
  const k = amount * Math.min(w, h) * 0.12;
  // dst corners -> src corners (keystone: top edge shifts right, bottom left)
  const dst: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  const srcc: [number, number][] = [[k, 0], [w + k * 0.4, 0], [w - k * 0.4, h], [-k, h]];
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i];
    const [u, v] = srcc[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  const H = solve8(A, B);
  if (!H) {
    out.data.set(src.data);
    return out;
  }
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const d = H[6] * dx + H[7] * dy + 1;
      const sx = (H[0] * dx + H[1] * dy + H[2]) / d;
      const sy = (H[3] * dx + H[4] * dy + H[5]) / d;
      if (sx < 0 || sy < 0 || sx > w - 1 || sy > h - 1) continue; // white frame
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const fx = sx - x0, fy = sy - y0;
      const i00 = src.idx(x0, y0), i10 = src.idx(x1, y0), i01 = src.idx(x0, y1), i11 = src.idx(x1, y1);
      const o = out.idx(dx, dy);
      for (let ch = 0; ch < 3; ch++) {
        const top = src.data[i00 + ch] * (1 - fx) + src.data[i10 + ch] * fx;
        const bot = src.data[i01 + ch] * (1 - fx) + src.data[i11 + ch] * fx;
        out.data[o + ch] = top * (1 - fy) + bot * fy;
      }
      out.data[o + 3] = 255;
    }
  }
  return out;
}

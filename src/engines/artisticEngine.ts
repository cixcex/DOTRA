// ---------------------------------------------------------------------------
// DOTRA Engine Lab — Artistic engine
//
// Port of the deterministic styling pipeline of antfu's qrcode-toolkit, as
// implemented in duanxianpi/artistic-qrcode-generator's node-qrcode-toolkit
// (TypeScript, MIT): pixel styles, marker shapes, seeded margin noise, and
// the crystalize / liquidify post effects. (The repo's headline Stable
// Diffusion + ControlNet stage is GPU-bound and deliberately NOT ported —
// DOTRA is 100% client-side; see docs/engines.md.)
//
// The matrix itself is never altered: data and function modules keep their
// encoded values; only the rendering shape changes. Margin noise lives
// strictly in the quiet zone, exactly like the toolkit.
// ---------------------------------------------------------------------------

import type { MatrixInfo } from '../engine/types';
import {
  Raster, WHITE, hexToRgba, mulberry32, crystalize, liquidify, perspectiveWarp, coverWindow, centreLuma, type RGBA,
} from './raster';

export type ArtisticPixelStyle = 'square' | 'rounded' | 'dot' | 'squircle' | 'row' | 'column';
export type ArtisticMarkerShape = 'square' | 'circle' | 'plus' | 'box' | 'octagon' | 'tiny-plus';
export type ArtisticMarkerInner = 'square' | 'circle' | 'plus' | 'diamond';
export type NoiseSpace = 'full' | 'minimal' | 'marker';

export interface ArtisticOptions {
  pixelStyle: ArtisticPixelStyle;
  markerShape: ArtisticMarkerShape;
  markerInner: ArtisticMarkerInner;
  marginNoise: boolean;
  marginNoiseRate: number; // 0..0.6
  marginNoiseSpace: NoiseSpace;
  seed: number;
  lightColor: string;
  darkColor: string;
  photoBackground: boolean; // photograph as full-canvas background
  photoModules: boolean; // tone-pinned photograph tiles inside data modules
  crystalizeRadius: number; // 0 = off
  liquidifyRadius: number; // 0 = off
  perspective: number; // 0..1 keystone tilt
}

export const ARTISTIC_DEFAULTS: ArtisticOptions = {
  pixelStyle: 'dot',
  markerShape: 'box',
  markerInner: 'square',
  marginNoise: true,
  marginNoiseRate: 0.25,
  marginNoiseSpace: 'minimal',
  seed: 7,
  lightColor: '#ffffff',
  darkColor: '#0a0a0a',
  photoBackground: true,
  photoModules: true,
  crystalizeRadius: 0,
  liquidifyRadius: 0,
  perspective: 0,
};

export interface ArtisticInput {
  matrix: MatrixInfo;
  photo: Raster | null;
  size: number;
  quietZone: number;
}

const DOT = 0.92; // module fill fraction for shaped styles

export function renderArtistic(input: ArtisticInput, opts: ArtisticOptions): Raster {
  const { matrix, photo, size, quietZone } = input;
  const N = matrix.size;
  const mp = size / (N + 2 * quietZone);
  const ox = quietZone * mp;
  const oy = quietZone * mp;

  const light = hexToRgba(opts.lightColor);
  const dark = hexToRgba(opts.darkColor);

  const out = new Raster(size, size);
  if (opts.photoBackground && photo) {
    out.drawCover(photo, 0, 0, size, size);
  }

  const inFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= N - 7) || (r >= N - 7 && c < 7);

  // ——— Finder markers (whole 7×7 blocks, toolkit marker semantics) ———
  const finderOrigins: [number, number][] = [[0, 0], [0, N - 7], [N - 7, 0]];
  for (const [fr, fc] of finderOrigins) {
    drawMarker(out, ox + fc * mp, oy + fr * mp, 7 * mp, opts.markerShape, opts.markerInner, dark, light);
  }

  // ——— Modules ———
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (inFinder(r, c)) continue; // drawn as markers above
      const darkModule = matrix.isDark(r, c);
      const bx = ox + c * mp;
      const by = oy + r * mp;
      const color = darkModule ? dark : light;

      if (matrix.isFunctionModule(r, c)) {
        // timing / alignment / format / version: solid, safe
        out.fillRect(bx, by, mp, mp, color);
        continue;
      }

      if (opts.photoModules && photo) {
        // photographic tile in BOTH polarities, tone-pinned toward the module's
        // ink; a tile whose 3×3 centre lands on the wrong side of the decoder
        // threshold falls back to solid ink — scan-safety by construction.
        const win = coverWindow(photo.w, photo.h, size, size);
        out.drawCoverRegion(photo, win.sx + (bx / size) * win.sw, win.sy + (by / size) * win.sh, (mp / size) * win.sw, (mp / size) * win.sh, bx, by, mp, mp);
        out.blendRect(bx, by, mp, mp, darkModule ? dark : light, darkModule ? 0.6 : 0.5);
        const L = centreLuma(out, bx + mp / 2, by + mp / 2);
        if ((darkModule && L > 96) || (!darkModule && L < 160)) out.fillRect(bx, by, mp, mp, color);
        continue;
      }

      if (!darkModule) {
        out.fillRect(bx, by, mp, mp, light);
        continue;
      }

      const cx = bx + mp / 2;
      const cy = by + mp / 2;
      switch (opts.pixelStyle) {
        case 'square':
          out.fillRect(cx - (DOT * mp) / 2, cy - (DOT * mp) / 2, DOT * mp, DOT * mp, dark);
          break;
        case 'rounded':
          out.fillRoundRect(cx - (DOT * mp) / 2, cy - (DOT * mp) / 2, DOT * mp, DOT * mp, mp * 0.28, dark);
          break;
        case 'dot':
          out.fillCircle(cx, cy, (DOT * mp) / 2, dark);
          break;
        case 'squircle':
          out.fillRoundRect(cx - (DOT * mp) / 2, cy - (DOT * mp) / 2, DOT * mp, DOT * mp, mp * 0.45, dark);
          break;
        case 'row':
          out.fillRect(bx, cy - (mp * 0.28) / 1, mp, mp * 0.28, dark);
          break;
        case 'column':
          out.fillRect(cx - (mp * 0.28) / 1, by, mp * 0.28, mp, dark);
          break;
      }
    }
  }

  // ——— Seeded margin noise (quiet zone only — the toolkit's hiding trick) ———
  if (opts.marginNoise && opts.marginNoiseRate > 0 && quietZone >= 1) {
    const rng = mulberry32(opts.seed);
    for (let r = -quietZone; r < N + quietZone; r++) {
      for (let c = -quietZone; c < N + quietZone; c++) {
        if (r >= 0 && r < N && c >= 0 && c < N) continue;
        if (!noiseAt(r, c, N, quietZone, opts.marginNoiseSpace)) continue;
        if (rng() < opts.marginNoiseRate) {
          blendRect(out, ox + c * mp, oy + r * mp, mp, mp, dark, 0.9);
        }
      }
    }
  }

  // ——— Post effects (after noise, matching effectTiming 'after') ———
  let result = out;
  if (opts.crystalizeRadius > 0) {
    result = crystalize(result, opts.crystalizeRadius, opts.seed + 1);
  }
  if (opts.liquidifyRadius > 0) {
    result = liquidify(result, opts.liquidifyRadius, light, dark, 128);
  }
  if (opts.perspective > 0) {
    result = perspectiveWarp(result, Math.min(1, opts.perspective));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Marker shapes
// ---------------------------------------------------------------------------

type Shape = ArtisticMarkerShape | ArtisticMarkerInner;

/** Draw a shape centred in rect (x, y, s). `hollow` renders a ring (box). */
function drawShape(out: Raster, x: number, y: number, s: number, shape: Shape, color: RGBA, hollow = false): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  switch (shape) {
    case 'square':
      if (hollow) {
        const t = s / 7;
        out.fillRect(x, y, s, t, color);
        out.fillRect(x, y + s - t, s, t, color);
        out.fillRect(x, y, t, s, color);
        out.fillRect(x + s - t, y, t, s, color);
      } else {
        out.fillRect(x, y, s, s, color);
      }
      break;
    case 'circle':
      out.fillCircle(cx, cy, s / 2, color);
      break;
    case 'plus':
      out.fillPoly(plusPoly(x, y, s, 0.3, 0.7), color);
      break;
    case 'box':
      drawShape(out, x, y, s, 'square', color, true);
      break;
    case 'octagon':
      out.fillPoly(octagonPoly(cx, cy, s / 2), color);
      break;
    case 'tiny-plus':
      out.fillPoly(plusPoly(x + s * 0.15, y + s * 0.15, s * 0.7, 0.28, 0.72), color);
      break;
    case 'diamond':
      out.fillPoly(diamondPoly(x, y, s), color);
      break;
  }
}

function drawMarker(
  out: Raster, x: number, y: number, s: number,
  shape: ArtisticMarkerShape, inner: ArtisticMarkerInner,
  dark: RGBA, light: RGBA,
): void {
  // outer dark ring shape, light middle, dark core — the finder structure
  drawShape(out, x, y, s, shape, dark);
  drawShape(out, x + (s * 1) / 7, y + (s * 1) / 7, (s * 5) / 7, shape === 'box' ? 'square' : shape, light);
  drawShape(out, x + (s * 2) / 7, y + (s * 2) / 7, (s * 3) / 7, inner, dark);
}

function plusPoly(x: number, y: number, s: number, a: number, b: number): [number, number][] {
  return [
    [x + a * s, y], [x + b * s, y], [x + b * s, y + a * s], [x + s, y + a * s],
    [x + s, y + b * s], [x + b * s, y + b * s], [x + b * s, y + s], [x + a * s, y + s],
    [x + a * s, y + b * s], [x, y + b * s], [x, y + a * s], [x + a * s, y + a * s],
  ];
}

/** Inscribed diamond — keeps the finder core dark across the centre cross-scanlines. */
function diamondPoly(x: number, y: number, s: number): [number, number][] {
  return [[x + s / 2, y], [x + s, y + s / 2], [x + s / 2, y + s], [x, y + s / 2]];
}

function octagonPoly(cx: number, cy: number, rad: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i + Math.PI / 8;
    pts.push([cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Alpha-blend a rect over the existing raster (margin noise). */
function blendRect(out: Raster, x: number, y: number, w: number, h: number, color: RGBA, alpha: number): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(out.w, Math.ceil(x + w));
  const y1 = Math.min(out.h, Math.ceil(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = out.idx(px, py);
      const d = out.data;
      d[i] = Math.round(d[i] * (1 - alpha) + color[0] * alpha);
      d[i + 1] = Math.round(d[i + 1] * (1 - alpha) + color[1] * alpha);
      d[i + 2] = Math.round(d[i + 2] * (1 - alpha) + color[2] * alpha);
      d[i + 3] = 255;
    }
  }
}

function noiseAt(r: number, c: number, N: number, q: number, space: NoiseSpace): boolean {
  switch (space) {
    case 'full':
      return true;
    case 'minimal':
      return r === -q || r === N + q - 1 || c === -q || c === N + q - 1;
    case 'marker': {
      // Chebyshev distance to the nearest 7×7 finder block (module coords)
      const finders: [number, number][] = [[0, 0], [0, N - 7], [N - 7, 0]];
      let best = Infinity;
      for (const [fr, fc] of finders) {
        const dr = r < fr ? fr - r : r > fr + 6 ? r - (fr + 6) : 0;
        const dc = c < fc ? fc - c : c > fc + 6 ? c - (fc + 6) : 0;
        best = Math.min(best, Math.max(dr, dc));
      }
      return best <= 2;
    }
  }
}

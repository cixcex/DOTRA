// ---------------------------------------------------------------------------
// DOTRA Engine Lab — Halftone engine
//
// Faithful TypeScript port of JeSuisUnCaillou/visual-qrcode (Ruby, MIT),
// itself based on the halftone-QR research from
// cgv.cs.nthu.edu.tw/Projects/Recreational_Graphics/Halftone_QRCodes/.
//
// Each QR module becomes a k×k block of sub-pixels. The CENTRAL sub-pixel
// block carries the encoded data (pure black / pure white); the surrounding
// sub-pixels display the photograph. Function modules (finders, timing,
// alignment, format/version info) are always solid B&W. Error correction is
// forced to level H, exactly like the original gem.
// ---------------------------------------------------------------------------

import type { MatrixInfo } from '../engine/types';
import { Raster, WHITE, BLACK, type RGBA } from './raster';

export interface HalftoneOptions {
  /** k×k sub-pixels per module. 3 = original visual-qrcode look. */
  subpixels: 3 | 4;
  /** Clean B&W modules between the photograph and the grid edge. */
  photoPadding: number;
  /** 'centre' = halftone dot (photo rings) · 'block' = full solid module (clean B/W). */
  moduleFill: 'centre' | 'block';
}

export const HALFTONE_DEFAULTS: HalftoneOptions = {
  subpixels: 3,
  photoPadding: 2,
  moduleFill: 'centre',
};

export interface HalftoneInput {
  matrix: MatrixInfo;
  photo: Raster | null;
  size: number; // output raster side in px
  quietZone: number;
}

const DATA_DARK: RGBA = [0, 0, 0, 255];
const DATA_LIGHT: RGBA = [255, 255, 255, 255];

export function renderHalftone(input: HalftoneInput, opts: HalftoneOptions): Raster {
  const { matrix, photo, size, quietZone } = input;
  const N = matrix.size;
  const mp = size / (N + 2 * quietZone);
  const ox = quietZone * mp;
  const oy = quietZone * mp;

  const out = new Raster(size, size); // white frame

  // Photograph lives inside the grid, inset by photoPadding modules.
  const pad = Math.max(0, Math.min(Math.floor(opts.photoPadding), Math.floor(N / 2) - 5));
  const photoRect = {
    x: ox + pad * mp,
    y: oy + pad * mp,
    w: (N - 2 * pad) * mp,
    h: (N - 2 * pad) * mp,
  };
  const photoActive = opts.moduleFill !== 'block' && photo !== null && pad * 2 < N - 6 && photoRect.w > 0;
  if (photoActive && photo) {
    out.drawCover(photo, photoRect.x, photoRect.y, photoRect.w, photoRect.h);
  }

  const k = opts.subpixels;
  const cs = 1; // central block = indices [1, k-1) → 1×1 (k=3) or 2×2 (k=4)

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const dark = matrix.isDark(r, c);
      const dataColor: RGBA = dark ? DATA_DARK : DATA_LIGHT;
      const bx = ox + c * mp;
      const by = oy + r * mp;

      if (matrix.isFunctionModule(r, c)) {
        out.fillRect(bx, by, mp, mp, dataColor);
        continue;
      }

      if (opts.moduleFill === 'block') {
        out.fillRect(bx, by, mp, mp, dataColor);
        continue;
      }

      const sub = mp / k;
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          const sx = bx + i * sub;
          const sy = by + j * sub;
          const isCenter = i >= cs && i < k - cs && j >= cs && j < k - cs;
          if (isCenter) {
            out.fillRect(sx, sy, sub, sub, dataColor);
            continue;
          }
          // Ring sub-pixel: photograph, falling back to the data colour
          // wherever the photo is missing or transparent (original gem rule).
          let ringColor: RGBA | null = null;
          if (photoActive && photo) {
            ringColor = samplePhoto(photo, photoRect, sx + sub / 2, sy + sub / 2);
          }
          out.fillRect(sx, sy, sub, sub, ringColor ?? dataColor);
        }
      }
    }
  }
  return out;
}

/** Nearest-sample the photo raster at a canvas-space point inside photoRect. */
function samplePhoto(photo: Raster, rect: { x: number; y: number; w: number; h: number }, px: number, py: number): RGBA | null {
  const u = (px - rect.x) / rect.w;
  const v = (py - rect.y) / rect.h;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return null;
  const sx = Math.min(photo.w - 1, Math.max(0, Math.round(u * (photo.w - 1))));
  const sy = Math.min(photo.h - 1, Math.max(0, Math.round(v * (photo.h - 1))));
  const p = photo.get(sx, sy);
  return p[3] < 128 ? null : p;
}

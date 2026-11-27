// ---------------------------------------------------------------------------
// DOTRA Engine Lab — comparison metrics
//
// Fair, engine-agnostic measurements over a rendered raster:
//  · fidelity   — how much of the photograph survives into the render.
//                 Computed PER POLARITY BAND (dark / light data modules),
//                 because module polarity comes from the QR data, not the
//                 photo: a global correlation would be dominated by the binary
//                 pattern. Per band it is Pearson r × gain, where gain is the
//                 rendered luma std-dev over the photo luma std-dev — a render
//                 that maps the photo monotonically but compresses it to a
//                 narrow band (opaque modules, pole-locked colours) scores
//                 honestly low.
//  · separation — dark vs light data-module luminance gap (scan margin).
//  · hueDev     — mean hue deviation over saturated photo modules.
//  · score      — weighted composite, gated on jsQR verification.
// ---------------------------------------------------------------------------

import type { MatrixInfo } from '../engine/types';
import { Raster, lumaOf } from './raster';

export interface EngineMetrics {
  fidelity: number | null; // 0..1 (null = no photo)
  separation: number; // 0..255 luma gap
  hueDev: number | null; // degrees (null = too few saturated samples)
  score: number; // 0..1, 0 when unverified
}

export interface MetricsInput {
  raster: Raster;
  photo: Raster | null;
  /** Where the photograph was placed in canvas space (engines differ). */
  photoRect: { x: number; y: number; w: number; h: number } | null;
  matrix: MatrixInfo;
  quietZone: number;
  size: number;
  verified: boolean;
}

export function computeMetrics(input: MetricsInput): EngineMetrics {
  const { raster, photo, photoRect, matrix, quietZone, size, verified } = input;
  const N = matrix.size;
  const mp = size / (N + 2 * quietZone);
  const ox = quietZone * mp;
  const oy = quietZone * mp;

  const darkR: number[] = [];
  const darkP: number[] = [];
  const lightR: number[] = [];
  const lightP: number[] = [];
  const darkLuma: number[] = [];
  const lightLuma: number[] = [];
  const hueDevs: number[] = [];

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix.isFunctionModule(r, c)) continue;
      const bx = ox + c * mp;
      const by = oy + r * mp;

      // cell-average rendered luminance (fair across engine designs)
      let sum = 0;
      let n = 0;
      const step = Math.max(1, Math.floor(mp / 4));
      for (let py = Math.floor(by); py < Math.min(size, Math.ceil(by + mp)); py += step) {
        for (let px = Math.floor(bx); px < Math.min(size, Math.ceil(bx + mp)); px += step) {
          sum += raster.luma(px, py);
          n++;
        }
      }
      const cellLuma = n > 0 ? sum / n : 0;

      // photo luminance at the module centre (cover-mapped into photoRect)
      let pLuma: number | null = null;
      let pRgb: [number, number, number] | null = null;
      if (photo && photoRect) {
        const u = (bx + mp / 2 - photoRect.x) / photoRect.w;
        const v = (by + mp / 2 - photoRect.y) / photoRect.h;
        if (u >= 0 && v >= 0 && u < 1 && v < 1) {
          const sx = Math.min(photo.w - 1, Math.max(0, Math.round(u * (photo.w - 1))));
          const sy = Math.min(photo.h - 1, Math.max(0, Math.round(v * (photo.h - 1))));
          const p = photo.get(sx, sy);
          pLuma = lumaOf(p[0], p[1], p[2]);
          pRgb = [p[0], p[1], p[2]];
        }
      }

      if (pLuma !== null) {
        if (matrix.isDark(r, c)) { darkR.push(cellLuma); darkP.push(pLuma); }
        else { lightR.push(cellLuma); lightP.push(pLuma); }
      }

      // module-centre sample for separation (centre = data colour in every engine)
      const centre = raster.luma(
        Math.min(size - 1, Math.max(0, Math.round(bx + mp / 2))),
        Math.min(size - 1, Math.max(0, Math.round(by + mp / 2))),
      );
      if (matrix.isDark(r, c)) darkLuma.push(centre);
      else lightLuma.push(centre);

      // hue deviation over saturated photo modules
      if (pRgb && saturation(pRgb) > 40) {
        const rend = averageCellRGB(raster, bx, by, mp, size);
        if (rend && saturation(rend) > 25) {
          const dh = hueDelta(pRgb, rend);
          if (dh !== null) hueDevs.push(dh);
        }
      }
    }
  }

  const fidelity = bandFidelity(darkR, darkP, lightR, lightP);
  const darkMean = mean(darkLuma);
  const lightMean = mean(lightLuma);
  const separation = darkLuma.length > 0 && lightLuma.length > 0 ? Math.max(0, lightMean - darkMean) : 0;
  const hueDev = hueDevs.length >= 20 ? mean(hueDevs) : null;

  const score = verified
    ? 0.45 * Math.min(1, separation / 180)
      + 0.35 * (fidelity === null ? 0.5 : Math.max(0, fidelity))
      + 0.20 * (hueDev === null ? 0.6 : Math.max(0, 1 - hueDev / 45))
    : 0;

  return { fidelity, separation, hueDev, score };
}

/** Per-band Pearson × gain, averaged over the bands that have samples. */
function bandFidelity(darkR: number[], darkP: number[], lightR: number[], lightP: number[]): number | null {
  const bands: number[] = [];
  if (darkR.length > 10) bands.push(pearson(darkR, darkP) * gain(darkR, darkP));
  if (lightR.length > 10) bands.push(pearson(lightR, lightP) * gain(lightR, lightP));
  return bands.length === 0 ? null : mean(bands);
}

/** Rendered luma spread ÷ photo luma spread — 1 = full tonal range preserved. */
function gain(rendered: number[], photo: number[]): number {
  const sp = std(photo);
  if (sp <= 0) return 0;
  return Math.min(1, std(rendered) / sp);
}

// ---------------------------------------------------------------------------
// math helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) * (x - m))));
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

function averageCellRGB(raster: Raster, bx: number, by: number, mp: number, size: number): [number, number, number] | null {
  let r = 0, g = 0, b = 0, n = 0;
  const step = Math.max(1, Math.floor(mp / 4));
  for (let py = Math.floor(by); py < Math.min(size, Math.ceil(by + mp)); py += step) {
    for (let px = Math.floor(bx); px < Math.min(size, Math.ceil(bx + mp)); px += step) {
      const p = raster.get(px, py);
      r += p[0]; g += p[1]; b += p[2];
      n++;
    }
  }
  return n === 0 ? null : [r / n, g / n, b / n];
}

function saturation(rgb: [number, number, number]): number {
  return Math.max(rgb[0], rgb[1], rgb[2]) - Math.min(rgb[0], rgb[1], rgb[2]);
}

function hueDelta(a: [number, number, number], b: [number, number, number]): number | null {
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (ha === null || hb === null) return null;
  let d = Math.abs(ha - hb);
  if (d > 180) d = 360 - d;
  return d;
}

function hueOf([r, g, b]: [number, number, number]): number | null {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 12) return null; // too desaturated to define a hue
  const d = mx - mn;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

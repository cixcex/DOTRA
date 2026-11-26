// ---------------------------------------------------------------------------
// DOTRA image processor — photographic preprocessing pipeline
//
// Turns an uploaded photograph into the canvases the dot engine needs:
//   * `sample` — exactly N×N px (one pixel per QR module) for colour sampling
//   * `detail` — high-resolution copy for "image fragment" dot shapes
//
// Pipeline (in order):
//   1. smart crop   — saliency-centred cover fit when the user hasn't framed
//                     manually (faces / subjects drift into the square)
//   2. user adjustments (brightness / contrast / saturation LUTs)
//   3. auto contrast — percentile luminance stretch (0.5%..99.5%)
//   4. CLAHE         — local contrast enhancement on tile histograms
//   5. unsharp mask  — edge-aware luminance sharpening (no chroma noise)
//
// All heavy passes are typed-array loops; CLAHE works on a capped resolution
// so large photographs never freeze the UI thread for long.
// ---------------------------------------------------------------------------

import type { CropTransform, ImageAdjustments, RGB } from './types';
import { clamp, luminance } from '@/utils/colorUtils';

export interface ImageStats {
  mean: number;
  stdDev: number;
  pLow: number; // 0.5th percentile luminance
  pHigh: number; // 99.5th percentile luminance
}

export interface ProcessedImage {
  sample: HTMLCanvasElement; // N×N
  detail: HTMLCanvasElement; // high-res, aspect-cropped square
  meanLuminance: number;
  stats: ImageStats;
  /** Saliency pan that was applied (null when the user framed manually). */
  smartCrop: { x: number; y: number } | null;
}

export interface ProcessImageOptions {
  crop: CropTransform;
  matrixSize: number;
  adjustments: ImageAdjustments;
  enhance?: { smartCrop?: boolean; autoContrast?: boolean; clahe?: boolean; sharpen?: boolean };
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

// --- user adjustments ---------------------------------------------------------

function buildLuts(adj: ImageAdjustments): Uint8ClampedArray[] {
  const b = (adj.brightness / 100) * 64; // ±64 levels at full swing
  const cRaw = (adj.contrast / 100) * 2.2; // contrast factor
  const factor = (259 * (cRaw + 255)) / (255 * (259 - cRaw));
  const brightLut = new Uint8ClampedArray(256);
  const contrastLut = new Uint8ClampedArray(256);
  const combined = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    brightLut[i] = i + b;
    contrastLut[i] = factor * (i - 128) + 128;
    combined[i] = contrastLut[brightLut[i]];
  }
  return [combined];
}

function applyAdjustments(ctx: CanvasRenderingContext2D, size: number, adj: ImageAdjustments) {
  if (adj.brightness === 0 && adj.contrast === 0 && adj.saturation === 0) return;
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const [lut] = buildLuts(adj);
  const satK = 1 + adj.saturation / 100;
  const useSat = adj.saturation !== 0;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    if (useSat) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = y + (r - y) * satK;
      g = y + (g - y) * satK;
      b = y + (b - y) * satK;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
}

// --- geometry -----------------------------------------------------------------

/**
 * Draw the source image into a square canvas honouring the crop transform
 * (cover-fit × zoom, centred, then panned).
 */
function drawCroppedSquare(
  target: CanvasRenderingContext2D,
  src: CanvasImageSource,
  srcW: number,
  srcH: number,
  size: number,
  crop: CropTransform,
) {
  const cover = Math.max(size / srcW, size / srcH);
  const scale = cover * clamp(crop.zoom, 1, 6);
  const dw = srcW * scale;
  const dh = srcH * scale;
  let ox = (size - dw) / 2 + crop.x * size;
  let oy = (size - dh) / 2 + crop.y * size;
  ox = clamp(ox, size - dw, 0);
  oy = clamp(oy, size - dh, 0);
  target.imageSmoothingQuality = 'high';
  target.drawImage(src, ox, oy, dw, dh);
  return { dw, dh, ox, oy };
}

// --- smart crop (saliency centering) ------------------------------------------

/**
 * When the source is non-square, the cover-fit hides an overflow strip.
 * This finds the pan offset that keeps the most visually energetic region
 * (edges = faces, subjects, horizons) inside the square, and returns the
 * equivalent crop transform. Returns null for square sources or when the
 * user has already framed manually.
 */
function smartCropPan(src: CanvasImageSource, srcW: number, srcH: number): { x: number; y: number } | null {
  if (srcW === srcH) return null;
  const probe = 192;
  const cv = makeCanvas(probe);
  const ctx = cv.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const { dw, dh } = drawCroppedSquare(ctx, src, srcW, srcH, probe, { zoom: 1, x: 0, y: 0 });

  // Gradient-energy grid (coarse Sobel on luminance).
  const img = ctx.getImageData(0, 0, probe, probe).data;
  const G = 48, cell = probe / G;
  const energy = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++) {
    for (let gx = 0; gx < G; gx++) {
      let sum = 0;
      const x0 = Math.floor(gx * cell), y0 = Math.floor(gy * cell);
      const x1 = Math.min(probe - 1, x0 + 1), y1 = Math.min(probe - 1, y0 + 1);
      const lum = (x: number, y: number) => {
        const i = (y * probe + x) * 4;
        return 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2];
      };
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = Math.abs(lum(Math.min(probe - 1, x + 1), y) - lum(Math.max(0, x - 1), y));
        const dy = Math.abs(lum(x, Math.min(probe - 1, y + 1)) - lum(x, Math.max(0, y - 1)));
        sum += dx + dy;
      }
      energy[gy * G + gx] = sum;
    }
  }

  // Window = the visible square; slide it over the overflow axis.
  const overX = Math.max(0, dw - probe), overY = Math.max(0, dh - probe);
  if (overX < 4 && overY < 4) return null; // nothing to choose

  let best = -1, bestPx = 0, bestPy = 0;
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const px = overX === 0 ? 0 : (i / steps - 0.5) * overX;
    for (let j = 0; j <= steps; j++) {
      const py = overY === 0 ? 0 : (j / steps - 0.5) * overY;
      // visible window in probe px (inner 80% to avoid edge effects)
      const winX = (probe - dw) / 2 + px;
      const winY = (probe - dh) / 2 + py;
      const gx0 = clamp(Math.floor((winX + dw * 0.1) / cell), 0, G - 1);
      const gy0 = clamp(Math.floor((winY + dh * 0.1) / cell), 0, G - 1);
      const gx1 = clamp(Math.floor((winX + dw * 0.9) / cell), 0, G - 1);
      const gy1 = clamp(Math.floor((winY + dh * 0.9) / cell), 0, G - 1);
      let score = 0, count = 0;
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) { score += energy[gy * G + gx]; count++; }
      // Slight centre bias so we don't chase a corner sparkle.
      const centerBias = 1 - 0.15 * (Math.abs(px) / Math.max(overX, 1) + Math.abs(py) / Math.max(overY, 1));
      const s = (count ? score / count : 0) * centerBias;
      if (s > best) { best = s; bestPx = px; bestPy = py; }
    }
  }
  return { x: clamp(bestPx / probe, -0.5, 0.5), y: clamp(bestPy / probe, -0.5, 0.5) };
}

// --- auto contrast (percentile stretch) ----------------------------------------

function lumaHistogram(data: Uint8ClampedArray): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    hist[y]++;
  }
  return hist;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = total * p;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

function applyAutoContrast(ctx: CanvasRenderingContext2D, size: number): { pLow: number; pHigh: number } {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const hist = lumaHistogram(d);
  const total = size * size;
  const pLow = percentile(hist, total, 0.005);
  const pHigh = percentile(hist, total, 0.995);
  const range = pHigh - pLow;
  if (range < 96) return { pLow, pHigh }; // flat image — don't amplify noise
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = ((i - pLow) * 255) / range;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]];
  }
  ctx.putImageData(img, 0, 0);
  return { pLow, pHigh };
}

// --- CLAHE (local contrast) -----------------------------------------------------

/**
 * Contrast Limited Adaptive Histogram Equalization on luminance, chroma kept.
 * Works on a capped resolution copy (enhancement is low-frequency) and
 * composites the result back — fast enough for interactive use.
 */
function applyCLAHE(ctx: CanvasRenderingContext2D, size: number) {
  const work = Math.min(size, 1024);
  const src = makeCanvas(work);
  const sctx = src.getContext('2d')!;
  sctx.drawImage(ctx.canvas, 0, 0, work, work);
  const img = sctx.getImageData(0, 0, work, work);
  const d = img.data;

  const T = 8; // 8×8 tiles
  const tileW = work / T, tileH = work / T;
  const luts: Uint8ClampedArray[] = [];
  const clip = 2.0;
  for (let ty = 0; ty < T; ty++) {
    for (let tx = 0; tx < T; tx++) {
      const hist = new Uint32Array(256);
      const x0 = Math.floor(tx * tileW), x1 = Math.min(work, Math.floor((tx + 1) * tileW));
      const y0 = Math.floor(ty * tileH), y1 = Math.min(work, Math.floor((ty + 1) * tileH));
      const n = (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * work + x) * 4;
        hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
      }
      // clip + redistribute
      const clipLimit = Math.max(1, Math.round((clip * n) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) { if (hist[i] > clipLimit) { excess += hist[i] - clipLimit; hist[i] = clipLimit; } }
      const add = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) hist[i] += add;
      // CDF → LUT
      const lut = new Uint8ClampedArray(256);
      let acc = 0;
      for (let i = 0; i < 256; i++) { acc += hist[i]; lut[i] = Math.round((acc * 255) / n); }
      luts.push(lut);
    }
  }

  for (let y = 0; y < work; y++) {
    for (let x = 0; x < work; x++) {
      const i = (y * work + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const y0 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const fx = clamp(x / tileW - 0.5, 0, T - 1.001);
      const fy = clamp(y / tileH - 0.5, 0, T - 1.001);
      const tx = Math.floor(fx), ty = Math.floor(fy);
      const wx = fx - tx, wy = fy - ty;
      const tx1 = Math.min(T - 1, tx + 1), ty1 = Math.min(T - 1, ty + 1);
      const l00 = luts[ty * T + tx], l10 = luts[ty * T + tx1], l01 = luts[ty1 * T + tx], l11 = luts[ty1 * T + tx1];
      const li = Math.round((1 - wx) * (1 - wy) * l00[Math.round(y0)] + wx * (1 - wy) * l10[Math.round(y0)] + (1 - wx) * wy * l01[Math.round(y0)] + wx * wy * l11[Math.round(y0)]);
      const k = y0 > 0.5 ? li / y0 : 1;
      d[i] = r * k; d[i + 1] = g * k; d[i + 2] = b * k;
    }
  }
  sctx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, size, size);
}

// --- unsharp mask (edge-aware sharpening) ----------------------------------------

function applyUnsharp(ctx: CanvasRenderingContext2D, size: number, amount = 0.45) {
  const tmp = makeCanvas(size);
  const tctx = tmp.getContext('2d')!;
  try {
    tctx.filter = 'blur(2px)';
  } catch { /* filter unsupported — skip */ return; }
  tctx.drawImage(ctx.canvas, 0, 0);
  try { tctx.filter = 'none'; } catch { /* noop */ }
  const base = ctx.getImageData(0, 0, size, size);
  const soft = tctx.getImageData(0, 0, size, size).data;
  const d = base.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const ys = 0.2126 * soft[i] + 0.7152 * soft[i + 1] + 0.0722 * soft[i + 2];
    const y2 = y + (y - ys) * amount;
    const k = y > 0.5 ? y2 / y : 1;
    d[i] = r * k; d[i + 1] = g * k; d[i + 2] = b * k; // chroma preserved, edges pop
  }
  ctx.putImageData(base, 0, 0);
}

// --- entry point ------------------------------------------------------------------

/**
 * Build the sample + detail canvases for a matrix of `matrixSize` modules,
 * running the full photographic preprocessing pipeline first.
 */
export function processImage(
  src: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  opts: ProcessImageOptions,
): ProcessedImage {
  const { crop, matrixSize, adjustments, enhance } = opts;
  const w = (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width;
  const h = (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height;

  const detailRes = clamp(matrixSize * 24, 256, 2048);
  const detail = makeCanvas(detailRes);
  const dctx = detail.getContext('2d')!;

  // 1. smart crop — only when the user hasn't framed the image manually.
  let effectiveCrop = crop;
  let smartCrop: { x: number; y: number } | null = null;
  const untouched = crop.zoom === 1 && crop.x === 0 && crop.y === 0;
  if (enhance?.smartCrop && untouched) {
    const pan = smartCropPan(src, w, h);
    if (pan) {
      smartCrop = pan;
      effectiveCrop = { zoom: 1, x: pan.x, y: pan.y };
    }
  }
  drawCroppedSquare(dctx, src, w, h, detailRes, effectiveCrop);

  // 2. user adjustments
  applyAdjustments(dctx, detailRes, adjustments);

  // 3. auto contrast
  let pLow = 0, pHigh = 255;
  if (enhance?.autoContrast) {
    const r = applyAutoContrast(dctx, detailRes);
    pLow = r.pLow; pHigh = r.pHigh;
  }

  // 4. local contrast (CLAHE)
  if (enhance?.clahe) applyCLAHE(dctx, detailRes);

  // 5. edge-aware sharpen
  if (enhance?.sharpen) applyUnsharp(dctx, detailRes);

  // Sample canvas: one pixel per module, downscaled from detail for smooth averages.
  const sample = makeCanvas(matrixSize);
  const sctx = sample.getContext('2d')!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(detail, 0, 0, matrixSize, matrixSize);

  // Stats over the final detail canvas.
  const sdata = sctx.getImageData(0, 0, matrixSize, matrixSize).data;
  let sum = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < sdata.length; i += 4) {
    const y = 0.2126 * sdata[i] + 0.7152 * sdata[i + 1] + 0.0722 * sdata[i + 2];
    sum += y;
    hist[Math.round(y)]++;
  }
  const n = matrixSize * matrixSize;
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < sdata.length; i += 4) {
    const y = 0.2126 * sdata[i] + 0.7152 * sdata[i + 1] + 0.0722 * sdata[i + 2];
    varSum += (y - mean) * (y - mean);
  }
  const stdDev = Math.sqrt(varSum / n);
  let acc = 0, pl = 0, ph = 255;
  const tLow = n * 0.005, tHigh = n * 0.995;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= tLow && pl === 0 && i > 0) pl = i;
    if (acc >= tHigh) { ph = i; break; }
  }
  if (enhance?.autoContrast) { pl = pLow; ph = pHigh; }

  return {
    sample,
    detail,
    meanLuminance: mean,
    stats: { mean, stdDev, pLow: pl, pHigh: ph },
    smartCrop,
  };
}

/**
 * Sample one colour per module from the N×N sample canvas.
 * Returns colours in row-major order plus their luminance.
 */
export function sampleModuleColors(
  sampleCanvas: HTMLCanvasElement,
  matrixSize: number,
): { colors: RGB[]; luma: Float32Array } {
  const ctx = sampleCanvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, matrixSize, matrixSize).data;
  const colors: RGB[] = new Array(matrixSize * matrixSize);
  const luma = new Float32Array(matrixSize * matrixSize);
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      const i = (r * matrixSize + c) * 4;
      const col = { r: data[i], g: data[i + 1], b: data[i + 2] };
      colors[r * matrixSize + c] = col;
      luma[r * matrixSize + c] = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    }
  }
  return { colors, luma };
}

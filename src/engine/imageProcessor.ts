// ---------------------------------------------------------------------------
// DOTRA image processor
//
// Turns an uploaded photograph into the two canvases the dot engine needs:
//   * `sample` — exactly N×N px (one pixel per QR module) for colour sampling
//   * `detail` — high-resolution copy for "image fragment" dot shapes
//
// Cropping (zoom / pan), brightness, contrast and saturation are applied here,
// before any colour ever reaches a QR module.
// ---------------------------------------------------------------------------

import type { CropTransform, ImageAdjustments, RGB } from './types';
import { clamp, luminance } from '@/utils/colorUtils';

export interface ProcessedImage {
  sample: HTMLCanvasElement; // N×N
  detail: HTMLCanvasElement; // high-res, aspect-cropped square
  meanLuminance: number;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Brightness + contrast LUTs (applied in sRGB space, good enough for art). */
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
}

/**
 * Build the sample + detail canvases for a matrix of `matrixSize` modules.
 */
export function processImage(
  src: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  crop: CropTransform,
  matrixSize: number,
  adj: ImageAdjustments,
): ProcessedImage {
  const w = (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width;
  const h = (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height;

  // Detail canvas: high enough for crisp fragment dots, capped for memory.
  const detailRes = clamp(matrixSize * 24, 256, 2048);
  const detail = makeCanvas(detailRes);
  drawCroppedSquare(detail.getContext('2d')!, src, w, h, detailRes, crop);
  applyAdjustments(detail.getContext('2d')!, detailRes, adj);

  // Sample canvas: one pixel per module, downscaled from detail for smooth averages.
  const sample = makeCanvas(matrixSize);
  const sctx = sample.getContext('2d')!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(detail, 0, 0, matrixSize, matrixSize);

  const data = sctx.getImageData(0, 0, matrixSize, matrixSize).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  const meanLuminance = sum / (matrixSize * matrixSize);

  return { sample, detail, meanLuminance };
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

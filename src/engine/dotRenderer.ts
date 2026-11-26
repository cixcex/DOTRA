// ---------------------------------------------------------------------------
// DOTRA dot renderer
//
// Turns a genuine QR matrix + processed image into a plan of coloured dots and
// paints them onto a canvas. Every dot corresponds 1:1 to a QR module; the
// encoded dark/light value is never altered — only colour is mapped.
//
// Structural (function) modules are painted as solid pure black / white
// squares so finders, timing, alignment, format and version information stay
// perfectly decodable no matter how artistic the data modules become.
// ---------------------------------------------------------------------------

import type { Dot, DotOptions, MatrixInfo, QualityPreset, RGB } from './types';
import { mapModuleColor, analyzeToneHealth, PRESET_TONES, REPAIR_TONES, type ToneHealth } from '@/utils/contrastOptimizer';
import { colorBucket, cssRgb, liftToLuminance, scaleToLuminance } from '@/utils/colorUtils';
import { sampleModuleColors, type ProcessedImage } from './imageProcessor';

export interface DotPlan {
  matrixSize: number;
  version: number;
  ecLevel: string;
  dots: Dot[]; // data modules only (function modules are rendered structurally)
  toneHealth: ToneHealth;
  moduleCount: number;
  /** Raw per-module photo samples (N×N row-major) — drives the photo phase of the animation. */
  photoColors: RGB[];
  /** Tone-safe copy of the detail image for fragment dots (null in DOM-less contexts). */
  fragmentSource: HTMLCanvasElement | null;
}

export interface BuildPlanOptions {
  matrix: MatrixInfo;
  processed: ProcessedImage;
  dots: DotOptions;
  preset: QualityPreset;
  repairLevel: number; // 0..3 — escalated by the verification repair loop
}

/** Per-module colour samples used to build a dot plan. */
export interface ModuleSamples {
  colors: RGB[]; // N×N, row-major
  luma: Float32Array;
}

/**
 * Build the full dot plan from per-module colour samples: map colours under
 * strict luminance constraints and select which light modules keep a dot
 * (density control). Dark modules are ALWAYS rendered — they carry the data.
 *
 * Kept DOM-free so the Node test harness can exercise the exact same logic.
 */
export function buildDotPlanFromSamples(inputs: BuildPlanOptions & ModuleSamples & { detail?: HTMLCanvasElement | null }): DotPlan {
  const { matrix, dots, preset, repairLevel } = inputs;
  const N = matrix.size;
  const { colors, luma } = inputs;

  const darkFlags = new Array<boolean>(N * N);
  const samples: RGB[] = new Array(N * N);

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      darkFlags[i] = matrix.isDark(r, c);
      samples[i] = colors[i];
    }
  }

  // Density: choose which light modules keep a coloured dot.
  // Deterministic ranking by "visual information" (chroma + distance from bg).
  const lightIndices: number[] = [];
  const lightScore: number[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix.isDark(r, c)) continue;
      const i = r * N + c;
      const col = colors[i];
      const mx = Math.max(col.r, col.g, col.b), mn = Math.min(col.r, col.g, col.b);
      const score = mx - mn + Math.abs(luma[i] - 250) * 0.35;
      lightIndices.push(i);
      lightScore.push(score);
    }
  }
  const keepCount = Math.round(lightIndices.length * dots.density);
  const keep = new Uint8Array(N * N);
  if (keepCount >= lightIndices.length) {
    keep.fill(1);
  } else {
    const order = lightIndices
      .map((idx, k) => k)
      .sort((a, b) => lightScore[b] - lightScore[a] || lightIndices[a] - lightIndices[b]);
    for (let k = 0; k < keepCount; k++) keep[lightIndices[order[k]]] = 1;
  }

  // Data-module dots (function modules are rendered separately by the renderer).
  const dotList: Dot[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix.isFunctionModule(r, c)) continue;
      const i = r * N + c;
      const dark = darkFlags[i];
      if (!dark && !keep[i]) continue; // dropped light dot — background shows through
      const color = mapModuleColor(colors[i], {
        dark,
        protectedModule: false,
        preset,
        colorIntensity: dots.colorIntensity,
        repairLevel,
        desaturateDark: repairLevel >= 2 ? 0.35 : 0,
      });
      dotList.push({ col: c, row: r, dark, protectedModule: false, color });
    }
  }

  const effectiveTones =
    repairLevel <= 0 ? PRESET_TONES[preset] : REPAIR_TONES[Math.min(Math.max(repairLevel, 1), 4) - 1];
  const toneHealth = analyzeToneHealth(samples, darkFlags, effectiveTones);

  // Fragment dots paste raw image patches — build a tone-safe copy so every
  // patch respects the same luminance constraints as the mapped dot colours.
  const detail = inputs.detail ?? (opts_processed_detail(inputs));
  const fragmentSource = detail ? buildClampedDetail(detail, N, darkFlags, effectiveTones, dots.colorIntensity, repairLevel >= 2 ? 0.35 : 0) : null;

  return {
    matrixSize: N,
    version: matrix.version,
    ecLevel: matrix.ecLevel,
    dots: dotList,
    toneHealth,
    moduleCount: N * N,
    photoColors: colors,
    fragmentSource,
  };
}

function opts_processed_detail(inputs: BuildPlanOptions & ModuleSamples & { detail?: HTMLCanvasElement | null }): HTMLCanvasElement | null {
  return (inputs as BuildPlanOptions).processed?.detail ?? null;
}

/** Browser path: sample colours from the processed canvas, then plan. */
export function buildDotPlan(opts: BuildPlanOptions): DotPlan {
  const { colors, luma } = sampleModuleColors(opts.processed.sample, opts.matrix.size);
  return buildDotPlanFromSamples({ ...opts, colors, luma });
}

// --- tone-safe detail for fragment dots ---------------------------------------
const clampedDetailCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();

/**
 * Build a copy of the high-res detail image whose every pixel respects the
 * module's tone BAND — the per-pixel equivalent of mapModuleColor, so
 * fragment patches carry the same photographic colour as the dot renderer
 * while staying inside scan-safe luminance ranges.
 *
 * Dark patches: proportional scale-down into [?, fragmentCap] (hue kept).
 * Light patches: proportional scale-up to fragmentFloor (hue kept); pixels
 * too dark to scale without hue-destroying clipping blend toward white
 * instead. Fragment patches keep intra-module texture, which is harder on
 * jsQR's local binarization than flat dots, so fragments use a tighter band:
 * cap <= 96, floor >= 246. Empirically calibrated — see docs/testing-report.md.
 */
export function buildClampedDetail(
  detail: HTMLCanvasElement,
  N: number,
  darkFlags: Array<boolean>,
  tones: { darkCap: number; lightFloor: number; chromaBoost?: number },
  colorIntensity: number,
  desaturateDark: number,
): HTMLCanvasElement {
  const fragmentCap = Math.min(tones.darkCap, 96);
  const fragmentFloor = Math.max(tones.lightFloor + 8, 246);
  const boost = tones.chromaBoost ?? 1;
  const key = `frag${fragmentCap}|${fragmentFloor}|${colorIntensity}|${desaturateDark}|${boost}`;
  let perCanvas = clampedDetailCache.get(detail);
  if (!perCanvas) {
    perCanvas = new Map();
    clampedDetailCache.set(detail, perCanvas);
  }
  const hit = perCanvas.get(key);
  if (hit) return hit;

  const out = document.createElement('canvas');
  out.width = detail.width;
  out.height = detail.height;
  const sctx = detail.getContext('2d')!;
  const octx = out.getContext('2d')!;
  const src = sctx.getImageData(0, 0, out.width, out.height);
  const dst = octx.createImageData(out.width, out.height);
  const sd = src.data, dd = dst.data;
  const dw = out.width / N;
  const dh = out.height / N;

  for (let y = 0; y < out.height; y++) {
    const row = Math.min(N - 1, Math.floor(y / dh));
    for (let x = 0; x < out.width; x++) {
      const col = Math.min(N - 1, Math.floor(x / dw));
      const i = (y * out.width + x) * 4;
      let r = sd[i], g = sd[i + 1], b = sd[i + 2];

      if (colorIntensity < 1) {
        const yv = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = yv + (r - yv) * colorIntensity;
        g = yv + (g - yv) * colorIntensity;
        b = yv + (b - yv) * colorIntensity;
      }

      const dark = darkFlags[row * N + col];
      let Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (dark) {
        if (Y > fragmentCap) {
          const out = scaleToLuminance({ r, g, b }, Y, fragmentCap);
          r = out.r; g = out.g; b = out.b;
          Y = fragmentCap;
        }
        if (desaturateDark > 0) {
          r += (Y - r) * desaturateDark;
          g += (Y - g) * desaturateDark;
          b += (Y - b) * desaturateDark;
        }
      } else if (Y < fragmentFloor) {
        // hue-safe lift into the fragment light band
        const out = Y < 24
          ? (() => { const t = (fragmentFloor - Y) / Math.max(255 - Y, 0.5); return { r: r + (255 - r) * t, g: g + (255 - g) * t, b: b + (255 - b) * t }; })()
          : liftToLuminance({ r, g, b }, Y, fragmentFloor);
        r = out.r; g = out.g; b = out.b;
        Y = fragmentFloor;
        if (boost > 1) {
          r = Y + (r - Y) * boost;
          g = Y + (g - Y) * boost;
          b = Y + (b - Y) * boost;
        }
      }

      dd[i] = r; dd[i + 1] = g; dd[i + 2] = b; dd[i + 3] = sd[i + 3];
    }
  }
  octx.putImageData(dst, 0, 0);
  perCanvas.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderOptions {
  quietZone: number; // modules
  bgColor: string; // css colour
  transparent: boolean;
  shape: DotOptions['shape'];
  dotSize: number; // fraction of module
  spacing: number; // gap fraction of module between dots
  fragmentSource?: HTMLCanvasElement | null; // high-res image for fragment dots
}

interface Geometry {
  modulePx: number;
  origin: number;
  dotDiameter: number;
}

function computeGeometry(matrixSize: number, opts: RenderOptions, canvasSize: number): Geometry {
  const total = matrixSize + opts.quietZone * 2;
  const modulePx = canvasSize / total;
  return {
    modulePx,
    origin: opts.quietZone * modulePx,
    dotDiameter: modulePx * Math.max(0.25, Math.min(1, opts.dotSize - opts.spacing)),
  };
}

// --- sprite cache ------------------------------------------------------------
const spriteCache = new Map<string, HTMLCanvasElement>();

function getSprite(shape: 'circle' | 'rounded' | 'soft', d: number, color: RGB): HTMLCanvasElement {
  const b = colorBucket(color);
  const key = `${shape}|${d}|${b}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const pad = 1;
  const size = Math.ceil(d) + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const cx = size / 2, cy = size / 2, r = d / 2;
  const col = cssRgb(color);

  if (shape === 'circle') {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  } else if (shape === 'rounded') {
    ctx.fillStyle = col;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pad, pad, d, d, d * 0.32);
    else ctx.rect(pad, pad, d, d);
    ctx.fill();
  } else {
    // soft particle: solid core, feathered edge (alpha fade, hue preserved)
    const grad = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
    grad.addColorStop(0, col);
    grad.addColorStop(0.62, col);
    grad.addColorStop(1, `rgba(${color.r | 0},${color.g | 0},${color.b | 0},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  if (spriteCache.size > 2400) spriteCache.clear(); // bound memory
  spriteCache.set(key, cv);
  return cv;
}

/**
 * Render a complete dot-QR onto `canvas`. Canvas dimensions define output res.
 * This exact function is also used for every animation frame (t = 1 state),
 * which guarantees the animation's final frame matches the exported PNG.
 */
export function renderDotQR(
  canvas: HTMLCanvasElement,
  plan: DotPlan,
  matrix: MatrixInfo,
  opts: RenderOptions,
): void {
  const S = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const N = plan.matrixSize;
  const geo = computeGeometry(N, opts, S);
  const mp = geo.modulePx;
  const ox = geo.origin, oy = geo.origin;

  // Background / quiet zone
  if (opts.transparent) {
    ctx.clearRect(0, 0, S, S);
  } else {
    ctx.fillStyle = opts.bgColor;
    ctx.fillRect(0, 0, S, S);
  }

  // -- Pass 1: structural modules as solid squares (pure black / white) ------
  ctx.fillStyle = '#0a0a0a';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!matrix.isFunctionModule(r, c) || !matrix.isDark(r, c)) continue;
      ctx.fillRect(ox + c * mp, oy + r * mp, mp + 0.6, mp + 0.6);
    }
  }
  ctx.fillStyle = '#ffffff';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!matrix.isFunctionModule(r, c) || matrix.isDark(r, c)) continue;
      ctx.fillRect(ox + c * mp, oy + r * mp, mp + 0.6, mp + 0.6);
    }
  }

  // -- Pass 2: data module dots ----------------------------------------------
  const d = geo.dotDiameter;
  const half = d / 2;

  if (opts.shape === 'pixel') {
    const groups = new Map<number, Dot[]>();
    for (const dot of plan.dots) {
      const b = colorBucket(dot.color);
      const arr = groups.get(b);
      if (arr) arr.push(dot);
      else groups.set(b, [dot]);
    }
    for (const arr of groups.values()) {
      ctx.fillStyle = cssRgb(arr[0].color);
      for (const dot of arr) {
        ctx.fillRect(ox + (dot.col + 0.5) * mp - half, oy + (dot.row + 0.5) * mp - half, d, d);
      }
    }
    return;
  }

  if (opts.shape === 'fragment') {
    const detail = opts.fragmentSource;
    if (detail) {
      const dw = detail.width / N, dh = detail.height / N;
      const inset = 0.4;
      const off = (mp - d) / 2;
      for (const dot of plan.dots) {
        const x = ox + dot.col * mp, y = oy + dot.row * mp;
        ctx.save();
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x + off, y + off, d, d, d * 0.28);
        else ctx.rect(x + off, y + off, d, d);
        ctx.clip();
        ctx.drawImage(
          detail,
          dot.col * dw + inset, dot.row * dh + inset, dw - inset * 2, dh - inset * 2,
          x + off, y + off, d, d,
        );
        ctx.restore();
      }
      return;
    }
    // no detail source — fall back to circles below
  }

  if (opts.shape === 'soft' || opts.shape === 'circle' || opts.shape === 'rounded') {
    const shapeKey = opts.shape === 'soft' ? 'soft' : opts.shape === 'circle' ? 'circle' : 'rounded';
    const groups = new Map<number, Dot[]>();
    for (const dot of plan.dots) {
      const b = colorBucket(dot.color);
      const arr = groups.get(b);
      if (arr) arr.push(dot);
      else groups.set(b, [dot]);
    }
    const spriteSize = Math.ceil(d) + 2;
    for (const arr of groups.values()) {
      const sprite = getSprite(shapeKey, Math.max(2, Math.round(d)), arr[0].color);
      for (const dot of arr) {
        const x = ox + (dot.col + 0.5) * mp;
        const y = oy + (dot.row + 0.5) * mp;
        ctx.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2, spriteSize, spriteSize);
      }
    }
    return;
  }

  // fallback: plain circles via arcs
  const groups = new Map<number, Dot[]>();
  for (const dot of plan.dots) {
    const b = colorBucket(dot.color);
    const arr = groups.get(b);
    if (arr) arr.push(dot);
    else groups.set(b, [dot]);
  }
  for (const arr of groups.values()) {
    ctx.fillStyle = cssRgb(arr[0].color);
    for (const dot of arr) {
      const x = ox + (dot.col + 0.5) * mp;
      const y = oy + (dot.row + 0.5) * mp;
      ctx.beginPath();
      ctx.arc(x, y, half, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Render a plan to a fresh canvas of exactly `px` × `px` pixels. */
export function renderPlanToCanvas(
  plan: DotPlan,
  matrix: MatrixInfo,
  opts: RenderOptions,
  px: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  renderDotQR(canvas, plan, matrix, opts);
  return canvas;
}

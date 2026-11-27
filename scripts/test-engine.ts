// ---------------------------------------------------------------------------
// DOTRA engine test harness (Node, no DOM).
//
// Mirrors the browser rendering path of dotRenderer.renderDotQR with a software
// rasterizer — including the v3 photographic composite (underlay beneath the
// module grid, B&W square modules, perforation ring) — then decodes the ACTUAL
// raster with jsQR. A QR only passes if the real pixels decode to the exact URL.
//
// v3 — photographic integration:
//   * full-bleed photo underlay beneath the module grid (visible in gaps +
//     through modules via the influence blend)
//   * black-and-white square modules as the default look
//   * decorative perforation ring on the white frame (engine ringSquares)
//   * influence / moduleContrast / bwIntensity / colourTreatment matrices
//   * repair-ladder escalation mirroring the app's six rungs
//   * acceptance suite: multiple URLs × multiple photos × desktop/mobile rasters,
//     orientation variants, exact-URL match, recovery, final-frame consistency
//
// Run: npm run test:engine   (bundle-run.mjs compiles the TS on the fly)
// ---------------------------------------------------------------------------

import { mkdirSync } from 'node:fs';
import jsQR from 'jsqr';
import { encodeQR, buildFunctionModuleMask } from '../src/engine/qrGenerator';
import { buildDotPlanFromSamples, ringSquares, type DotPlan } from '../src/engine/dotRenderer';
import { PRESET_TONES, REPAIR_TONES } from '../src/utils/contrastOptimizer';
import { createScene, scatterEnvelope, photoBlendT, structuralBlendT, receiptTop } from '../src/engine/particleEngine';
import type { MatrixInfo, RGB, DotOptions, QualityPreset, ECLevel, TargetVersion, DotShape } from '../src/engine/types';
import { makeImage, savePNG, fillRect, fillCircle, getPx, setPx, gradient, clamp255, makeNoise2D, forEachPixel, mixc, drawCover } from './pngkit.mjs';
import { renderHalftone, renderArtistic, computeMetrics, Raster, HALFTONE_DEFAULTS, ARTISTIC_DEFAULTS } from '../src/engines';
import { ANIMATION_PRESETS } from '../src/lib/constants';
import type { HalftoneOptions, ArtisticOptions } from '../src/engines';

type Img = ReturnType<typeof makeImage>;
const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

let passed = 0, failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label} ${detail}`); }
}

// --- artworks ------------------------------------------------------------------
function makeArt(kind: string, w = 512, h = 512): Img {
  const img = makeImage(w, h);
  const noise = makeNoise2D(kind.length * 977 + 13);
  const radial = (cx: number, cy: number, r: number, u: number, v: number) => {
    const d = Math.hypot(u - cx, v - cy) / r;
    return Math.max(0, 1 - d * d);
  };
  forEachPixel(img, (x, y) => {
    const u = x / w, v = y / h;
    let c: number[];
    switch (kind) {
      case 'sunset':
        c = gradient([[0, [26, 18, 52]], [0.5, [122, 45, 92]], [1, [250, 201, 92]]])(v + 0.12 * (noise(u * 3, v * 3, 3) - 0.5));
        break;
      case 'bright':
        c = gradient([[0, [235, 242, 250]], [0.5, [250, 230, 180]], [1, [245, 200, 160]]])(v + 0.08 * (noise(u * 4, v * 4, 2) - 0.5));
        break;
      case 'dark':
        c = gradient([[0, [20, 16, 30]], [0.5, [40, 26, 50]], [1, [70, 40, 60]]])(v + 0.1 * (noise(u * 3, v * 3, 3) - 0.5));
        break;
      case 'saturated':
        c = [128 + 120 * Math.sin(u * 9 + noise(v * 5, u * 5, 2)), 128 + 120 * Math.sin(v * 7), 128 + 120 * Math.sin((u + v) * 6)];
        break;
      case 'portrait': {
        c = gradient([[0, [188, 178, 168]], [1, [150, 142, 138]]])(v);
        const coat = radial(0.5, 1.25, 0.75, u, v);
        if (coat > 0) c = mixc(c, [74, 84, 104], Math.min(1, coat * 1.6));
        const face = radial(0.5, 0.42, 0.21, u, v);
        if (face > 0) c = mixc(c, [224, 178, 148], Math.min(1, face * 1.35));
        const hair = radial(0.5, 0.18, 0.34, u, v) * (v < 0.52 ? 1 : 0.25);
        if (hair > 0.05) c = mixc(c, [58, 44, 36], Math.min(1, hair * 1.5));
        const eL = radial(0.43, 0.42, 0.028, u, v), eR = radial(0.57, 0.42, 0.028, u, v);
        if (eL > 0 || eR > 0) c = mixc(c, [40, 32, 30], Math.min(1, Math.max(eL, eR) * 1.8));
        const mouth = radial(0.5, 0.55, 0.05, u, v);
        if (mouth > 0) c = mixc(c, [170, 110, 96], mouth);
        const cheek = radial(0.36, 0.5, 0.09, u, v);
        if (cheek > 0) c = mixc(c, [238, 196, 168], cheek * 0.7);
        break;
      }
      case 'landscape': {
        c = gradient([[0, [96, 142, 196]], [0.55, [226, 208, 178]]])(v);
        const sun = radial(0.68, 0.2, 0.12, u, v);
        if (sun > 0) c = mixc(c, [252, 246, 214], sun);
        const r1 = 0.55 + 0.05 * Math.sin(u * 9 + 1.7) + 0.02 * noise(u * 6, 0.5, 2);
        if (v > r1) c = mixc(c, [86, 102, 92], Math.min(1, (v - r1) * 14 + 0.35));
        const r2 = 0.68 + 0.045 * Math.sin(u * 5 + 0.4) + 0.02 * noise(u * 4, 2.2, 2);
        if (v > r2) c = mixc(c, [52, 66, 56], Math.min(1, (v - r2) * 16 + 0.3));
        if (v > 0.82) c = mixc(c, gradient([[0, [128, 116, 74]], [1, [96, 100, 62]]])(u), Math.min(1, (v - 0.82) * 8));
        break;
      }
      case 'animal':
        c = [196 + 18 * noise(u * 5, v * 5, 2), 148 + 14 * noise(u * 5, v * 5, 2), 92 + 10 * noise(u * 5, v * 5, 2)];
        const stripe = Math.sin(u * 26 + 2.2 * noise(v * 4, u * 2, 2) + v * 4);
        if (stripe > 0.25 && v > 0.12 && v < 0.88) {
          c = mixc(c, [74, 48, 32], Math.min(1, (stripe - 0.25) * 2.2));
        }
        const belly = radial(0.5, 0.95, 0.42, u, v);
        if (belly > 0) c = mixc(c, [226, 198, 160], belly * 0.8);
        break;
      case 'darkphoto':
        c = gradient([[0, [14, 16, 24]], [1, [26, 28, 40]]])(v + 0.1 * (noise(u * 3, v * 3, 2) - 0.5));
        const subject = radial(0.5, 0.46, 0.26, u, v);
        if (subject > 0) c = mixc(c, [64, 72, 92], subject * 0.9);
        const rim = radial(0.5, 0.46, 0.3, u, v) - radial(0.5, 0.46, 0.24, u, v);
        if (rim > 0) c = mixc(c, [120, 128, 150], Math.min(1, rim * 2.5));
        break;
      case 'brightphoto':
        c = [232 + 10 * noise(u * 4, v * 4, 2), 234 + 9 * noise(u * 4, v * 4, 2), 236 + 8 * noise(u * 4, v * 4, 2)];
        const b1 = radial(0.3, 0.35, 0.3, u, v);
        if (b1 > 0) c = mixc(c, [248, 214, 188], b1 * 0.8);
        const b2 = radial(0.72, 0.6, 0.26, u, v);
        if (b2 > 0) c = mixc(c, [206, 222, 238], b2 * 0.8);
        const b3 = radial(0.55, 0.8, 0.2, u, v);
        if (b3 > 0) c = mixc(c, [238, 232, 200], b3 * 0.7);
        break;
      default:
        c = [128, 128, 128];
    }
    return [...c.map(clamp255), 255];
  });
  return img;
}

/** Center-crop any artwork to a square — mirrors the browser's smart crop. */
function cropCenterSquare(art: Img): Img {
  const s = Math.min(art.w, art.h);
  const out = makeImage(s, s);
  const ox = Math.floor((art.w - s) / 2), oy = Math.floor((art.h - s) / 2);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const p = getPx(art, ox + x, oy + y);
    setPx(out, x, y, p[0], p[1], p[2], 255);
  }
  return out;
}

// --- Node rasterizer mirroring renderDotQR's v3 layer order --------------------
interface RasterOpts {
  shape: DotShape;
  dotSize: number;
  spacing: number;
  quietZone: number;
  px: number;
  safeDetail?: Img | null; // tone-safe detail for fragment dots
  underlay?: Img | null; // photograph beneath the module grid
  ring?: boolean; // perforation border on the white frame
}

function renderPlan(plan: DotPlan, matrix: MatrixInfo, opts: RasterOpts): Img {
  const S = opts.px;
  const img = makeImage(S, S);
  fillRect(img, 0, 0, S, S, [255, 255, 255]);
  const N = plan.matrixSize;
  const total = N + opts.quietZone * 2;
  const mp = S / total;
  const ox = opts.quietZone * mp, oy = opts.quietZone * mp;
  const d = mp * Math.max(0.25, Math.min(1, opts.dotSize - opts.spacing));
  const half = d / 2;

  // layer 1: photographic underlay, full-bleed beneath the module grid
  if (opts.underlay) drawCover(img, opts.underlay, ox, oy, N * mp);

  // layer 2: structural squares (module-aligned, slight overlap like the browser)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!matrix.isFunctionModule(r, c)) continue;
    const dark = matrix.isDark(r, c);
    fillRect(img, ox + c * mp, oy + r * mp, mp + 0.6, mp + 0.6, dark ? [10, 10, 10] : [255, 255, 255]);
  }

  // layer 3: data modules
  for (const dot of plan.dots) {
    const cx = ox + (dot.col + 0.5) * mp;
    const cy = oy + (dot.row + 0.5) * mp;
    const col: [number, number, number] = [dot.color.r, dot.color.g, dot.color.b];
    if (opts.shape === 'pixel') {
      fillRect(img, cx - half, cy - half, d, d, col);
    } else if (opts.shape === 'fragment' && opts.safeDetail) {
      const detail = opts.safeDetail;
      const dw = detail.w / N, dh = detail.h / N;
      const inset = 0.4;
      const off = (mp - d) / 2;
      const x0 = ox + dot.col * mp + off, y0 = oy + dot.row * mp + off;
      for (let yy = Math.floor(y0); yy < y0 + d; yy++) {
        for (let xx = Math.floor(x0); xx < x0 + d; xx++) {
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const sx = Math.min(detail.w - 1, Math.floor(dot.col * dw + inset + ((xx - x0) / d) * (dw - inset * 2)));
          const sy = Math.min(detail.h - 1, Math.floor(dot.row * dh + inset + ((yy - y0) / d) * (dh - inset * 2)));
          setPx(img, xx, yy, detail.data[(sy * detail.w + sx) * 4], detail.data[(sy * detail.w + sx) * 4 + 1], detail.data[(sy * detail.w + sx) * 4 + 2], 255);
        }
      }
    } else if (opts.shape === 'soft') {
      fillCircle(img, cx, cy, d * 0.72, col, 0.35);
      fillCircle(img, cx, cy, d * 0.5, col);
    } else {
      fillCircle(img, cx, cy, half, col);
    }
  }

  // layer 4: decorative perforation ring (engine geometry — no mirror drift)
  if (opts.ring && opts.quietZone >= 3) {
    for (const s of ringSquares(N, opts.quietZone, mp, ox)) {
      fillRect(img, s.x - s.size / 2, s.y - s.size / 2, s.size, s.size, [22, 22, 22]);
    }
  }
  return img;
}

function decode(img: Img): string | null {
  const res = jsQR(new Uint8ClampedArray(img.data), img.w, img.h, { inversionAttempts: 'dontInvert' });
  return res ? res.data : null;
}

// --- module sampling (nearest — conservative vs the browser's smooth downscale) --
function sampleArt(art: Img, N: number): { colors: RGB[]; luma: Float32Array } {
  const colors: RGB[] = new Array(N * N);
  const luma = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const p = getPx(art, Math.min(art.w - 1, Math.floor((c + 0.5) * art.w / N)), Math.min(art.h - 1, Math.floor((r + 0.5) * art.h / N))).slice(0, 3) as [number, number, number];
    const col = { r: p[0], g: p[1], b: p[2] };
    colors[r * N + c] = col;
    luma[r * N + c] = luminance(col);
  }
  return { colors, luma };
}

// --- tone-safe detail mirror (engine buildClampedDetail, same math) -------------
function buildSafeDetail(detail: Img, N: number, darkFlags: boolean[], tones: { darkCap: number; lightFloor: number; chromaBoost?: number }, colorIntensity: number, desaturateDark: number): Img {
  const out = makeImage(detail.w, detail.h);
  const dw = detail.w / N, dh = detail.h / N;
  const fCap = Math.min(tones.darkCap, 96);
  const fFloor = Math.max(tones.lightFloor + 8, 246);
  const boost = tones.chromaBoost ?? 1;
  for (let y = 0; y < detail.h; y++) {
    const row = Math.min(N - 1, Math.floor(y / dh));
    for (let x = 0; x < detail.w; x++) {
      const col = Math.min(N - 1, Math.floor(x / dw));
      const i = (y * detail.w + x) * 4;
      let r = detail.data[i], g = detail.data[i + 1], b = detail.data[i + 2];
      if (colorIntensity < 1) {
        const yv = luminance({ r, g, b });
        r = yv + (r - yv) * colorIntensity; g = yv + (g - yv) * colorIntensity; b = yv + (b - yv) * colorIntensity;
      }
      const dark = darkFlags[row * N + col];
      let Y = luminance({ r, g, b });
      if (dark) {
        if (Y > fCap) { const k = fCap / Y; r *= k; g *= k; b *= k; Y = fCap; }
        if (desaturateDark > 0) { r += (Y - r) * desaturateDark; g += (Y - g) * desaturateDark; b += (Y - b) * desaturateDark; }
      } else if (Y < fFloor) {
        if (Y < 24) {
          const t = (fFloor - Y) / Math.max(255 - Y, 0.5);
          r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
        } else {
          const k = fFloor / Y;
          const mx = Math.max(r, g, b);
          const kMax = mx > 0 ? Math.min(k, 255 / mx) : k;
          r *= kMax; g *= kMax; b *= kMax;
          if (kMax < k - 1e-6) {
            const y2 = luminance({ r, g, b });
            const t = (fFloor - y2) / Math.max(255 - y2, 0.5);
            r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
          }
        }
        Y = fFloor;
        if (boost > 1) { r = Y + (r - Y) * boost; g = Y + (g - Y) * boost; b = Y + (b - Y) * boost; }
      }
      setPx(out, x, y, clamp255(r), clamp255(g), clamp255(b), 255);
    }
  }
  return out;
}

function upscale(art: Img, res: number): Img {
  const out = makeImage(res, res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const p = getPx(art, Math.min(art.w - 1, Math.floor((x * art.w) / res)), Math.min(art.h - 1, Math.floor((y * art.h) / res)));
    setPx(out, x, y, p[0], p[1], p[2], 255);
  }
  return out;
}

function buildPlan(url: string, ec: ECLevel, target: TargetVersion, art: Img, dots: DotOptions, preset: QualityPreset, repairLevel: number) {
  const { matrix } = encodeQR(url, ec, target);
  const { colors, luma } = sampleArt(art, matrix.size);
  const plan = buildDotPlanFromSamples({ matrix, processed: null as never, colors, luma, dots, preset, repairLevel });
  return { matrix, plan };
}

// --- metric helpers ----------------------------------------------------------------
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxy / Math.sqrt(Math.max(1e-9, sxx * syy));
}

function hueOf(c: RGB): number | null {
  const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b);
  if (mx - mn < 12) return null;
  const l = (mx + mn) / 2;
  const s = l > 128 ? (mx - mn) / Math.max(1, 512 - mx - mn) : (mx - mn) / Math.max(1, mx + mn);
  if (s < 0.08) return null;
  let h: number;
  const d = mx - mn;
  if (mx === c.r) h = ((c.g - c.b) / d + (c.g < c.b ? 6 : 0));
  else if (mx === c.g) h = (c.b - c.r) / d + 2;
  else h = (c.r - c.g) / d + 4;
  return h * 60;
}

function circHueDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function chroma(c: RGB): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

function shuffledIndices(n: number, seed: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function countStructural(matrix: MatrixInfo): number {
  let n = 0;
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) if (matrix.isFunctionModule(r, c)) n++;
  return n;
}

// v3 defaults — identical to src/lib/constants.ts DEFAULT_DOTS
const DEFAULT_DOTS: DotOptions = {
  shape: 'pixel', size: 0.88, spacing: 0.02, density: 1, colorIntensity: 1,
  influence: 0.6, moduleContrast: 0.85, bwIntensity: 1, colourTreatment: false,
};
const MODES: QualityPreset[] = ['photo', 'balanced', 'scan'];
const ARTIFACT_DIR = '/tmp/dotra-v3';
mkdirSync(ARTIFACT_DIR, { recursive: true });

// ===========================================================================
console.log('\n== T1: matrix correctness ==');
{
  const url = 'https://dotra.app/gallery/nature/ember-ridge';
  for (const ec of ['L', 'M', 'Q', 'H'] as ECLevel[]) {
    for (const target of ['auto', 'small', 'medium', 'large'] as TargetVersion[]) {
      const { matrix } = encodeQR(url, ec, target);
      const expectedMin = target === 'small' ? 4 : target === 'medium' ? 8 : target === 'large' ? 14 : 1;
      check(`encode ${ec}/${target}: version ${matrix.version} >= ${expectedMin}`, matrix.version >= expectedMin, `(got ${matrix.version})`);
      check(`encode ${ec}/${target}: size consistent`, matrix.size === 17 + 4 * matrix.version);
    }
  }
  const short = encodeQR('https://dotra.app', 'M', 'auto').matrix;
  const long = encodeQR('https://dotra.app/s/very/long/path/segment?with=parameters&and=more&data=here', 'M', 'auto').matrix;
  check('auto version grows with payload', long.size >= short.size, `(${short.size} vs ${long.size})`);
}

console.log('\n== T2: function-module mask ==');
{
  const posTable: Record<number, number[]> = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 7: [6, 22, 38], 10: [6, 28, 50], 14: [6, 26, 46, 66] };
  for (const v of [1, 2, 3, 4, 7, 10, 14]) {
    const size = 17 + 4 * v;
    const maskA = buildFunctionModuleMask(size, v);
    const maskB = buildFunctionModuleMask(size, v);
    let same = true;
    for (let i = 0; i < size * size; i++) if (maskA[i] !== maskB[i]) same = false;
    check(`v${v} mask deterministic`, same);

    let finderOk = true;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (!maskA[r * size + c] || !maskA[r * size + (size - 1 - c)] || !maskA[(size - 1 - r) * size + c]) finderOk = false;
    }
    check(`v${v} finder+separator regions protected`, finderOk);

    let timingOk = true;
    for (let i = 8; i <= size - 9; i++) {
      if (!maskA[6 * size + i] || !maskA[i * size + 6]) timingOk = false;
    }
    check(`v${v} timing protected`, timingOk);
    check(`v${v} dark module protected`, maskA[8 * size + (size - 8)] === 1);

    if (v >= 2) {
      const pos = posTable[v] ?? [];
      if (pos.length) {
        let alOk = true;
        for (const pr of pos) for (const pc of pos) {
          if ((pr === 6 && pc === 6) || (pr === 6 && pc === pos[pos.length - 1]) || (pr === pos[pos.length - 1] && pc === 6)) continue;
          for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
            if (!maskA[(pr + dr) * size + (pc + dc)]) alOk = false;
          }
        }
        check(`v${v} alignment patterns protected`, alOk);
      }
    }
    if (v >= 7) {
      let viOk = true;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
        if (!maskA[i * size + (size - 11 + j)] || !maskA[(size - 11 + j) * size + i]) viOk = false;
      }
      check(`v${v} version info protected`, viOk);
    }
  }
  const mask = buildFunctionModuleMask(25, 2);
  let func = 0;
  for (let i = 0; i < 625; i++) func += mask[i];
  check('v2 function module count == 282', func === 282, `(got ${func})`);
  check('data modules exist (not over-protected)', func < 625 * 0.6);
}

console.log('\n== T3: decode matrix — composite (underlay + ring) across artworks × modes × shapes × geometries ==');
{
  const arts: Record<string, Img> = { sunset: makeArt('sunset'), bright: makeArt('bright'), dark: makeArt('dark'), saturated: makeArt('saturated') };
  const details: Record<string, Img> = {};
  for (const [k, a] of Object.entries(arts)) details[k] = upscale(a, 1024);
  const url = 'https://dotra.app/gallery/nature/ember-ridge?ref=dotra';
  let total = 0, ok = 0;
  for (const [artName, art] of Object.entries(arts)) {
    for (const preset of MODES) {
      for (const shape of ['pixel', 'circle', 'rounded', 'fragment', 'soft'] as DotShape[]) {
        // Shape-aware geometries: circles/rounded leave their corners open, so
        // over a photo underlay the extreme gap fraction floods the module with
        // photograph. Square/fragment/soft modules dominate their cell and keep
        // the extreme geometry. (The app's repair ladder forces full-size square
        // modules if a user's own extreme circle configuration ever fails.)
        const geoms: Array<[number, number]> = (shape === 'circle' || shape === 'rounded')
          ? [[0.8, 0.12], [1.0, 0], [0.7, 0.06]]
          : [[0.88, 0.02], [1.0, 0], [0.6, 0.25]];
        for (const [size, spacing] of geoms) {
          total++;
          const dots: DotOptions = { ...DEFAULT_DOTS, shape, size, spacing };
          const { matrix, plan } = buildPlan(url, 'H', 'auto', art, dots, preset, 0);
          let safeDetail: Img | null = null;
          if (shape === 'fragment') {
            const darkFlags: boolean[] = [];
            for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) darkFlags.push(matrix.isDark(r, c));
            safeDetail = buildSafeDetail(details[artName], matrix.size, darkFlags, PRESET_TONES[preset], dots.colorIntensity, 0);
          }
          const img = renderPlan(plan, matrix, {
            shape, dotSize: size, spacing, quietZone: 6, px: 540, safeDetail,
            underlay: details[artName], ring: true,
          });
          const decoded = decode(img);
          if (decoded === url) { ok++; }
          else {
            console.log(`    fail: ${artName}/${preset}/${shape}/${size}/${spacing} -> ${decoded}`);
            savePNG(`${ARTIFACT_DIR}/fail-${artName}-${preset}-${shape}-${size}-${spacing}.png`, img.w, img.h, img.data);
          }
        }
      }
    }
  }
  check(`composite decode matrix ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T4: URL × EC level × version bucket (composite) ==');
{
  const urls = ['https://dotra.app', 'https://dotra.app/gallery/nature/ember-ridge', 'https://dotra.app/s/xK9f2mQp?src=sample&ref=qr&utm=dotra'];
  const art = makeArt('sunset');
  const detail = upscale(art, 1024);
  let total = 0, ok = 0;
  for (const url of urls) {
    for (const ec of ['L', 'M', 'Q', 'H'] as ECLevel[]) {
      for (const target of ['auto', 'small', 'medium', 'large'] as TargetVersion[]) {
        total++;
        const { matrix, plan } = buildPlan(url, ec, target, art, DEFAULT_DOTS, 'balanced', 0);
        const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 640, underlay: detail, ring: true });
        const decoded = decode(img);
        if (decoded === url) ok++;
        else console.log(`    fail: ${url.slice(0, 30)}…/${ec}/${target} -> ${decoded}`);
      }
    }
  }
  check(`URL×EC×version composite decode ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T5: control variations — density, intensity, influence, contrast, colour, frame, ring ==');
{
  const art = makeArt('saturated');
  const detail = upscale(art, 1024);
  const url = 'https://dotra.app/gallery/abstract/mesh';
  const cases: Array<[string, Partial<DotOptions>, number, boolean]> = [
    ['density 0.3', { density: 0.3 }, 6, true],
    ['density 0.6', { density: 0.6 }, 6, true],
    ['colorIntensity 0', { colorIntensity: 0 }, 6, true],
    ['colorIntensity 0.5', { colorIntensity: 0.5 }, 6, true],
    ['quiet 2 (ring auto-disabled)', {}, 2, true],
    ['quiet 8', {}, 8, true],
    ['influence 0 (pure B/W squares)', { influence: 0 }, 6, true],
    ['influence 1 (full band colour in modules)', { influence: 1 }, 6, true],
    ['moduleContrast 0.5 (narrow bands)', { moduleContrast: 0.5 }, 6, true],
    ['moduleContrast 1.4 (wide bands)', { moduleContrast: 1.4 }, 6, true],
    ['colour treatment on + saturation', { colourTreatment: true, bwIntensity: 0.2 }, 6, true],
    ['ring off', {}, 6, false],
    ['density .5 + quiet 3 + ring', { density: 0.5 }, 3, true],
  ];
  for (const [label, dotPatch, quiet, ring] of cases) {
    const dots: DotOptions = { ...DEFAULT_DOTS, ...dotPatch };
    const { matrix, plan } = buildPlan(url, 'H', 'auto', art, dots, 'balanced', 0);
    const img = renderPlan(plan, matrix, { shape: dots.shape, dotSize: dots.size, spacing: dots.spacing, quietZone: quiet, px: 540, underlay: detail, ring });
    check(label, decode(img) === url, `(got ${decode(img)})`);
  }
}

console.log('\n== T6: repair escalation on adversarial composites ==');
{
  // Mirrors the app's six-rung ladder: tones → influence → B&W → geometry → decoration → EC.
  const RUNGS: Array<{ repair: number; influence: number; contrast: number; colour: boolean; bw: number; geo: boolean; ring: boolean; ec: ECLevel; label: string }> = [
    { repair: 0, influence: 1, contrast: 1.4, colour: true, bw: 0.2, geo: false, ring: true, ec: 'L', label: 'hostile defaults' },
    { repair: 1, influence: 0.35, contrast: 1.2, colour: true, bw: 0.2, geo: false, ring: true, ec: 'L', label: 'wider bands + reduced influence' },
    { repair: 2, influence: 0.2, contrast: 1, colour: false, bw: 1, geo: false, ring: true, ec: 'L', label: 'black & white modules' },
    { repair: 2, influence: 0.1, contrast: 1, colour: false, bw: 1, geo: true, ring: true, ec: 'L', label: 'full-size square modules, no gaps' },
    { repair: 3, influence: 0.05, contrast: 0.85, colour: false, bw: 1, geo: true, ring: false, ec: 'L', label: 'perforation ring off + max separation' },
    { repair: 4, influence: 0, contrast: 0.85, colour: false, bw: 1, geo: true, ring: false, ec: 'H' as ECLevel, label: 'EC H + pure black & white' },
  ];
  const url = 'https://dotra.app/s/photographic-qr/very/long/path/segment?with=parameters&and=more&data=here';
  const hostileDots = (rung: (typeof RUNGS)[number]): DotOptions => ({
    ...DEFAULT_DOTS, shape: rung.geo ? 'pixel' : 'circle',
    size: rung.geo ? 1 : 0.5, spacing: rung.geo ? 0 : 0.35, density: 1,
    influence: rung.influence, moduleContrast: rung.contrast, bwIntensity: rung.bw, colourTreatment: rung.colour,
  });
  const renderHostile = (art: Img, detail: Img, rung: (typeof RUNGS)[number]) => {
    const dots = hostileDots(rung);
    const { matrix, plan } = buildPlan(url, rung.ec, 'auto', art, dots, 'photo', rung.repair);
    return decode(renderPlan(plan, matrix, { shape: dots.shape, dotSize: dots.size, spacing: dots.spacing, quietZone: 2, px: 540, underlay: detail, ring: rung.ring }));
  };
  // Case 1 — extreme circle geometry over bright photography: dots clamp to
  // 0.25mp (~5% of each module) and the photo floods the rest. Defaults must
  // fail; the ladder (influence -> B&W -> full-size square modules) must rescue.
  const bright = makeArt('brightphoto');
  const brightDetail = upscale(bright, 1024);
  const brightDefault = renderHostile(bright, brightDetail, RUNGS[0]);
  let brightRung = brightDefault === url ? 'defaults' : '';
  if (brightRung === '') {
    for (const rung of RUNGS) {
      const ok = renderHostile(bright, brightDetail, rung) === url;
      console.log(`  rung bright/${rung.label}: ${ok ? '✓ decodes' : '✗ fails'}`);
      if (ok) { brightRung = rung.label; break; }
    }
  }
  check(`bright circle-extreme fails at defaults, ladder rescues (at: ${brightRung || 'NOT RESCUED'})`, brightDefault !== url && brightRung !== '');
  // Case 2 — dark photography is robust even at extreme settings: the photo
  // itself carries the dark signal while light modules keep tone-safe dots.
  const dark = makeArt('darkphoto');
  const darkDetail = upscale(dark, 1024);
  const darkDefault = renderHostile(dark, darkDetail, RUNGS[0]);
  let darkRung = darkDefault === url ? 'defaults' : '';
  if (darkRung === '') {
    for (const rung of RUNGS) {
      const ok = renderHostile(dark, darkDetail, rung) === url;
      console.log(`  rung dark/${rung.label}: ${ok ? '✓ decodes' : '✗ fails'}`);
      if (ok) { darkRung = rung.label; break; }
    }
  }
  check(`dark hostile composite decodes (at: ${darkRung || 'NOT RESCUED'})`, darkRung !== '');
}

console.log('\n== T7: tone band invariants (influence blend is pole-safe by construction) ==');
{
  const art = makeArt('sunset');
  const url = 'https://dotra.app';
  for (const preset of MODES) {
    const tones = PRESET_TONES[preset];
    // full-band plan (influence 1, contrast 1) — membership identical to v2
    const fullDots: DotOptions = { ...DEFAULT_DOTS, density: 1, influence: 1, moduleContrast: 1, colourTreatment: true, bwIntensity: 0 };
    const { matrix: mF, plan: pF } = buildPlan(url, 'H', 'auto', art, fullDots, preset, 0);
    let worstDark = -1, bestLight = 256, worstDarkLo = 256, worstLightHi = -1;
    for (const d of pF.dots) {
      const y = luminance(d.color);
      if (d.dark) { worstDark = Math.max(worstDark, y); worstDarkLo = Math.min(worstDarkLo, y); }
      else { bestLight = Math.min(bestLight, y); worstLightHi = Math.max(worstLightHi, y); }
    }
    check(`${preset}: full-band dark dots within [${tones.darkLo},${tones.darkCap}] (got ${worstDarkLo.toFixed(1)}..${worstDark.toFixed(1)})`,
      worstDark <= tones.darkCap + 0.5 && worstDarkLo >= tones.darkLo - 0.5);
    check(`${preset}: full-band light dots within [${tones.lightFloor},${tones.lightCap}] (got ${bestLight.toFixed(1)}..${worstLightHi.toFixed(1)})`,
      bestLight >= tones.lightFloor - 0.5 && worstLightHi <= tones.lightCap + 0.5);

    // default composite plan (influence 0.6) — lerp toward poles can only
    // darken dark modules and brighten light modules
    const { matrix: mD, plan: pD } = buildPlan(url, 'H', 'auto', art, DEFAULT_DOTS, preset, 0);
    let dMax = -1, lMin = 256;
    for (const d of pD.dots) {
      const y = luminance(d.color);
      if (d.dark) dMax = Math.max(dMax, y); else lMin = Math.min(lMin, y);
    }
    check(`${preset}: default influence keeps dark ≤ cap (${dMax.toFixed(1)} ≤ ${tones.darkCap + 0.5})`, dMax <= tones.darkCap + 0.5);
    check(`${preset}: default influence keeps light ≥ floor (${lMin.toFixed(1)} ≥ ${tones.lightFloor - 0.5})`, lMin >= tones.lightFloor - 0.5);
    check(`${preset}: composite separation ≥ 100 luma levels (gap ${(lMin - dMax).toFixed(1)})`, lMin - dMax >= 100);
    check(`${preset}: band separation ≥ 100 (gap ${tones.lightFloor - tones.darkCap})`, tones.lightFloor - tones.darkCap >= 100);
    check(`${preset}: light floor ≥ 226 (jsQR binarization safety)`, tones.lightFloor >= 226);
    void mF; void mD;
  }
  for (let i = 1; i < REPAIR_TONES.length; i++) {
    check(`repair ${i + 1} not looser than ${i}`,
      REPAIR_TONES[i].darkCap <= REPAIR_TONES[i - 1].darkCap && REPAIR_TONES[i].lightFloor >= REPAIR_TONES[i - 1].lightFloor);
  }
}

console.log('\n== T8: large matrix (v14) composite end-to-end with fragment dots ==');
{
  const art = makeArt('sunset');
  const url = 'https://dotra.app/gallery/technology/circuit-board';
  const dots: DotOptions = { ...DEFAULT_DOTS, shape: 'fragment', density: 1 };
  const detail = upscale(art, 2048);
  const { matrix, plan } = buildPlan(url, 'Q', 'large', art, dots, 'balanced', 0);
  check(`large bucket version >= 14 (got ${matrix.version})`, matrix.version >= 14);
  check(`large plan has > 4000 dots (got ${plan.dots.length})`, plan.dots.length > 4000);
  check(`plan carries N² raw photo colours (got ${plan.photoColors.length})`, plan.photoColors.length === matrix.size * matrix.size);
  const darkFlags: boolean[] = [];
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) darkFlags.push(matrix.isDark(r, c));
  const tones = PRESET_TONES.balanced;
  const safe = buildSafeDetail(detail, matrix.size, darkFlags, tones, 1, 0);
  const img = renderPlan(plan, matrix, { shape: 'fragment', dotSize: 0.8, spacing: 0.12, quietZone: 6, px: 1080, safeDetail: safe, underlay: detail, ring: true });
  check('v14 fragment composite decodes', decode(img) === url, `(got ${decode(img)})`);
  savePNG(`${ARTIFACT_DIR}/large-fragment-composite.png`, img.w, img.h, img.data);

  const fCap = Math.min(tones.darkCap, 96), fFloor = Math.max(tones.lightFloor + 8, 246);
  let worstDark = -1, bestLight = 256, checked = 0;
  for (let y = 0; y < safe.h; y += 7) {
    const row = Math.min(matrix.size - 1, Math.floor(y / (safe.h / matrix.size)));
    for (let x = 0; x < safe.w; x += 7) {
      const col = Math.min(matrix.size - 1, Math.floor(x / (safe.w / matrix.size)));
      const i = (y * safe.w + x) * 4;
      const yv = luminance({ r: safe.data[i], g: safe.data[i + 1], b: safe.data[i + 2] });
      if (darkFlags[row * matrix.size + col]) worstDark = Math.max(worstDark, yv);
      else bestLight = Math.min(bestLight, yv);
      checked++;
    }
  }
  check(`fragment dark pixels <= ${fCap} (worst ${worstDark.toFixed(1)})`, worstDark <= fCap + 1);
  check(`fragment light pixels >= ${fFloor} (best ${bestLight.toFixed(1)})`, bestLight >= fFloor - 1);
  void checked;
}

console.log('\n== T9: photographic fidelity invariants ==');
{
  const art = makeArt('portrait');
  const url = 'https://dotra.app/gallery/portraits/bauhaus-face';

  // (a) pure band mapping (colour treatment on, full influence) — hue/chroma/luma
  const bandDots: DotOptions = { ...DEFAULT_DOTS, density: 1, influence: 1, moduleContrast: 1, colourTreatment: true, bwIntensity: 0 };
  const { matrix, plan } = buildPlan(url, 'Q', 'large', art, bandDots, 'photo', 0);
  const N = matrix.size;
  const { colors } = sampleArt(art, N);

  const darkSrc: number[] = [], darkOut: number[] = [], lightSrc: number[] = [], lightOut: number[] = [];
  const huePairs: Array<[number, number]> = [];
  let chromaSrc = 0, chromaOut = 0, chromaN = 0;
  for (const d of plan.dots) {
    const i = d.row * N + d.col;
    const src = colors[i];
    const ySrc = luminance(src);
    const yOut = luminance(d.color);
    if (d.dark) { darkSrc.push(ySrc); darkOut.push(yOut); }
    else { lightSrc.push(ySrc); lightOut.push(yOut); }
    const h1 = hueOf(src), h2 = hueOf(d.color);
    if (h1 != null && h2 != null) huePairs.push([h1, h2]);
    if (chroma(src) > 24) { chromaSrc += chroma(src); chromaOut += chroma(d.color); chromaN++; }
  }
  const rDark = pearson(darkSrc, darkOut);
  const rLight = pearson(lightSrc, lightOut);
  check(`photo mode: dark-band luma follows photograph (r=${rDark.toFixed(4)})`, rDark > 0.98);
  check(`photo mode: light-band luma follows photograph (r=${rLight.toFixed(4)})`, rLight > 0.98);

  const meanHueDiff = huePairs.length
    ? huePairs.reduce((a, [h1, h2]) => a + circHueDiff(h1, h2), 0) / huePairs.length
    : 0;
  check(`photo mode: hue preserved (mean Δhue=${meanHueDiff.toFixed(1)}° over ${huePairs.length} saturated modules)`,
    meanHueDiff < 12 && huePairs.length > 100);

  const chromaRatio = chromaSrc > 0 ? chromaOut / chromaSrc : 1;
  check(`photo mode: chroma retained (ratio=${chromaRatio.toFixed(2)})`, chromaRatio > 0.6);

  const renderLuma = plan.dots.map((d) => luminance(d.color));
  const srcLuma = plan.dots.map((d) => luminance(colors[d.row * N + d.col]));
  const darkIdx: number[] = [], lightIdx: number[] = [];
  plan.dots.forEach((d, k) => (d.dark ? darkIdx : lightIdx).push(k));
  const bandCheck = (idx: number[], label: string) => {
    const real = pearson(idx.map((k) => renderLuma[k]), idx.map((k) => srcLuma[k]));
    const shuf = shuffledIndices(idx.length, 777);
    const fake = pearson(idx.map((k) => renderLuma[k]), shuf.map((i) => srcLuma[idx[i]]));
    check(`photo mode: ${label} band tracks its own module's photograph (r=${real.toFixed(3)} vs shuffled ${fake.toFixed(3)})`,
      real > 0.9 && fake < 0.25 && real > fake + 0.5);
  };
  bandCheck(darkIdx, 'dark');
  bandCheck(lightIdx, 'light');

  // (b) default B&W composite — module luma still tracks the photograph per band
  const { matrix: m2, plan: p2 } = buildPlan(url, 'Q', 'large', art, DEFAULT_DOTS, 'photo', 0);
  const rD2 = pearson(p2.dots.filter((d) => d.dark).map((d) => luminance(colors[d.row * N + d.col])), p2.dots.filter((d) => d.dark).map((d) => luminance(d.color)));
  const rL2 = pearson(p2.dots.filter((d) => !d.dark).map((d) => luminance(colors[d.row * N + d.col])), p2.dots.filter((d) => !d.dark).map((d) => luminance(d.color)));
  check(`default B&W composite: dark modules track photo (r=${rD2.toFixed(3)})`, rD2 > 0.9);
  check(`default B&W composite: light modules track photo (r=${rL2.toFixed(3)})`, rL2 > 0.9);

  // scan mode must still decode the same portrait (composite)
  const { matrix: m3, plan: p3 } = buildPlan(url, 'Q', 'large', art, DEFAULT_DOTS, 'scan', 0);
  const img3 = renderPlan(p3, m3, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 640, underlay: upscale(art, 1024), ring: true });
  check('portrait + scan mode composite decodes', decode(img3) === url);
  savePNG(`${ARTIFACT_DIR}/portrait-composite.png`, img3.w, img3.h, img3.data);
}

console.log('\n== T10: six photo categories × three modes (default composite config) ==');
{
  const cats: Array<[string, string]> = [
    ['portrait', 'portrait'],
    ['landscape', 'landscape'],
    ['animal', 'animal'],
    ['dark photograph', 'darkphoto'],
    ['bright photograph', 'brightphoto'],
    ['multicolour', 'saturated'],
  ];
  const url = 'https://dotra.app/gallery/photo-qr';
  let total = 0, ok = 0;
  for (const [label, kind] of cats) {
    const art = makeArt(kind);
    const detail = upscale(art, 1024);
    for (const mode of MODES) {
      total++;
      const { matrix, plan } = buildPlan(url, 'H', 'auto', art, DEFAULT_DOTS, mode, 0);
      const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 640, underlay: detail, ring: true });
      const decoded = decode(img);
      const N = matrix.size;
      const { colors } = sampleArt(art, N);
      const dSrc: number[] = [], dOut: number[] = [], lSrc: number[] = [], lOut: number[] = [];
      for (const d of plan.dots) {
        const yS = luminance(colors[d.row * N + d.col]);
        const yO = luminance(d.color);
        if (d.dark) { dSrc.push(yS); dOut.push(yO); } else { lSrc.push(yS); lOut.push(yO); }
      }
      const rD = pearson(dSrc, dOut), rL = pearson(lSrc, lOut);
      const good = decoded === url && rD > 0.9 && rL > 0.9;
      if (good) ok++;
      else console.log(`    fail: ${label}/${mode} decode=${decoded === url} rDark=${rD.toFixed(3)} rLight=${rL.toFixed(3)}`);
      if (kind === 'portrait' && mode === 'photo') savePNG(`${ARTIFACT_DIR}/accept-portrait-photo.png`, img.w, img.h, img.data);
      if (kind === 'landscape' && mode === 'photo') savePNG(`${ARTIFACT_DIR}/accept-landscape-photo.png`, img.w, img.h, img.data);
      if (kind === 'dark photograph' && mode === 'photo') savePNG(`${ARTIFACT_DIR}/accept-darkphoto.png`, img.w, img.h, img.data);
    }
  }
  check(`photo categories × modes composite decode + fidelity ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T11: animation timeline + scene + ring geometry ==');
{
  // scatter envelope
  {
    const d = 0.1, w = 0.5;
    check('envelope: 0 before break', scatterEnvelope(0, d, w) === 0 && scatterEnvelope(d - 0.001, d, w) === 0);
    const peak = scatterEnvelope(d + 0.42 * w, d, w);
    check(`envelope: peaks at 1 (got ${peak.toFixed(3)})`, Math.abs(peak - 1) < 1e-9);
    check('envelope: 0 after return', scatterEnvelope(d + w, d, w) === 0 && scatterEnvelope(d + w + 0.1, d, w) === 0);
    let rise = true, fall = true, prevR = -1, prevF = 2;
    for (let t = 0; t <= 1; t += 0.01) {
      const v = scatterEnvelope(d + t * 0.42 * w, d, w);
      if (v < prevR - 1e-9) rise = false; prevR = v;
      const v2 = scatterEnvelope(d + (0.42 + t * 0.58) * w, d, w);
      if (v2 > prevF + 1e-9) fall = false; prevF = v2;
    }
    check('envelope: monotone rise then fall', rise && fall);
    let inRange = true;
    for (let t = 0; t <= 2; t += 0.005) {
      const v = scatterEnvelope(t, d, w);
      if (v < -1e-9 || v > 1 + 1e-9) inRange = false;
    }
    check('envelope: bounded [0,1]', inRange);
  }
  // colour blend timelines
  {
    let mono1 = true, mono2 = true, p1 = -1, p2 = -1;
    for (let i = 0; i <= 100; i++) {
      const u = i / 100;
      const a = photoBlendT(u), b = structuralBlendT(u);
      if (a < p1 - 1e-9) mono1 = false; p1 = a;
      if (b < p2 - 1e-9) mono2 = false; p2 = b;
    }
    check('photo blend: 0→1 monotone', photoBlendT(0) === 0 && photoBlendT(1) === 1 && mono1);
    check('structural blend: 0→1 monotone', structuralBlendT(0) === 0 && structuralBlendT(1) === 1 && mono2);
    check('structural materialises after data colour shift', structuralBlendT(0.6) < photoBlendT(0.6));
  }
  // scene: photo colours attached, break schedule normalised
  {
    const art = makeArt('portrait');
    const url = 'https://dotra.app/gallery/portraits/ember-profile';
    const { matrix, plan } = buildPlan(url, 'M', 'medium', art, DEFAULT_DOTS, 'photo', 0);
    const N = matrix.size;
    const { colors } = sampleArt(art, N);
    const scene = createScene(plan, matrix, 720, 6, {
      preset: 'gather', duration: 2.4, speed: 1, intensity: 0.5, startDistance: 0.9, easing: 'easeOut',
    });
    const byModule = new Map<number, typeof scene.particles[number]>();
    for (const p of scene.particles) {
      const col = Math.round((p.tx - scene.origin) / scene.modulePx - 0.5);
      const row = Math.round((p.ty - scene.origin) / scene.modulePx - 0.5);
      byModule.set(row * N + col, p);
    }
    let photoMatch = 0, photoTotal = 0, structPhoto = 0;
    for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
      const p = byModule.get(row * N + col);
      if (!p) continue;
      const src = colors[row * N + col];
      photoTotal++;
      const close = Math.abs(p.photoColor.r - src.r) < 2 && Math.abs(p.photoColor.g - src.g) < 2 && Math.abs(p.photoColor.b - src.b) < 2;
      if (close) photoMatch++;
      if (p.structural) structPhoto += close ? 1 : 0;
    }
    check(`scene: every module carries its raw photo colour (${photoMatch}/${photoTotal})`, photoMatch === photoTotal);
    check('scene: structural modules also start photographic', structPhoto > 200);
    let maxEnd = 0;
    for (const p of scene.particles) maxEnd = Math.max(maxEnd, p.delay + p.dur);
    check(`scene: scatter-return completes before settle (maxEnd=${maxEnd.toFixed(3)})`, maxEnd <= 0.87);
    check(`scene: particle count == plan dots + structural (${scene.particles.length})`,
      scene.particles.length === plan.dots.length + countStructural(matrix));
  }
  // ring geometry (pure engine function — the rasterizer draws exactly this)
  {
    const N = 29, q = 6, mp = 10, origin = q * mp;
    const sq = ringSquares(N, q, mp, origin);
    check(`ring: 4×(N+q) squares (got ${sq.length})`, sq.length === 4 * (N + q));
    const start = origin - (q / 2) * mp, end = origin + N * mp + (q / 2) * mp;
    let inBounds = true, onPath = true;
    for (const s of sq) {
      if (s.x - s.size / 2 < 0 || s.y - s.size / 2 < 0 || s.x + s.size / 2 > (N + 2 * q) * mp || s.y + s.size / 2 > (N + 2 * q) * mp) inBounds = false;
      const onTop = Math.abs(s.y - start) < 1e-6, onBottom = Math.abs(s.y - end) < 1e-6;
      const onLeft = Math.abs(s.x - start) < 1e-6, onRight = Math.abs(s.x - end) < 1e-6;
      if (!onTop && !onBottom && !onLeft && !onRight) onPath = false;
    }
    check('ring: all squares inside the canvas', inBounds);
    check('ring: all squares ride the frame centreline', onPath);
    const clearanceModules = q / 2 - 0.24 / 2; // centreline distance minus half square size
    check(`ring: ≥ 1.3 modules of clean white to the grid (got ${clearanceModules.toFixed(2)})`, clearanceModules >= 1.3);
    const sq3 = ringSquares(29, 3, mp, origin);
    check('ring: quiet zone 3 still produces squares (minimum gate)', sq3.length === 4 * (29 + 3));
  }
}

console.log('\n== T12: photographic composite acceptance (spec §12) ==');
{
  const urls = [
    'https://dotra.app',
    'https://dotra.app/gallery/nature/ember-ridge?ref=dotra',
    'https://dotra.app/s/photographic-qr/very/long/path/segment?with=parameters&and=more&data=here',
  ];
  const cats: Array<[string, string]> = [
    ['portrait', 'portrait'], ['landscape', 'landscape'], ['animal', 'animal'],
    ['dark photograph', 'darkphoto'], ['bright photograph', 'brightphoto'], ['multicolour', 'saturated'],
  ];

  // (a) multiple URLs × multiple photographs × desktop + mobile rasters
  let aTotal = 0, aOk = 0;
  for (const url of urls) {
    for (const [label, kind] of cats) {
      const art = makeArt(kind);
      const square = cropCenterSquare(art); // browser smart-crops to square
      const detail = upscale(square, 1024);
      for (const px of [1024, 512]) {
        aTotal++;
        const { matrix, plan } = buildPlan(url, 'H', 'auto', square, DEFAULT_DOTS, 'balanced', 0);
        const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px, underlay: detail, ring: true });
        const decoded = decode(img);
        if (decoded === url) aOk++;
        else console.log(`    fail: ${label}/${px}px -> ${decoded}`);
      }
    }
  }
  check(`acceptance: 3 URLs × 6 photos × 2 rasters decode exactly (${aOk}/${aTotal})`, aOk === aTotal, `(${aOk}/${aTotal})`);

  // (b) module-style matrix: every shape × influence level
  {
    const art = cropCenterSquare(makeArt('portrait'));
    const detail = upscale(art, 1024);
    const url = urls[1];
    let total = 0, ok = 0;
    for (const shape of ['pixel', 'circle', 'rounded', 'fragment', 'soft'] as DotShape[]) {
      for (const influence of [0, 0.6, 1]) {
        total++;
        const dots: DotOptions = { ...DEFAULT_DOTS, shape, influence };
        const { matrix, plan } = buildPlan(url, 'H', 'auto', art, dots, 'balanced', 0);
        let safeDetail: Img | null = null;
        if (shape === 'fragment') {
          const darkFlags: boolean[] = [];
          for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) darkFlags.push(matrix.isDark(r, c));
          safeDetail = buildSafeDetail(detail, matrix.size, darkFlags, PRESET_TONES.balanced, 1, 0);
        }
        const img = renderPlan(plan, matrix, { shape, dotSize: dots.size, spacing: dots.spacing, quietZone: 6, px: 640, safeDetail, underlay: detail, ring: true });
        if (decode(img) === url) ok++;
        else console.log(`    fail: shape ${shape} influence ${influence}`);
      }
    }
    check(`module styles × influence decode (${ok}/${total})`, ok === total, `(${ok}/${total})`);
  }

  // (c) influence × colour treatment × ring matrix
  {
    const art = cropCenterSquare(makeArt('landscape'));
    const detail = upscale(art, 1024);
    const url = urls[0];
    let total = 0, ok = 0;
    for (const influence of [0, 0.6, 1]) {
      for (const colour of [false, true]) {
        for (const ring of [true, false]) {
          total++;
          const dots: DotOptions = { ...DEFAULT_DOTS, influence, colourTreatment: colour, bwIntensity: colour ? 0.3 : 1 };
          const { matrix, plan } = buildPlan(url, 'H', 'auto', art, dots, 'balanced', 0);
          const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 640, underlay: detail, ring });
          if (decode(img) === url) ok++;
          else console.log(`    fail: influence ${influence} colour ${colour} ring ${ring}`);
        }
      }
    }
    check(`influence × colour × ring decode (${ok}/${total})`, ok === total, `(${ok}/${total})`);
  }

  // (d) recovery: hostile composite (extreme circle geometry over bright
  // photography, EC L) fails at defaults and is rescued by the ladder
  {
    const art = cropCenterSquare(makeArt('brightphoto'));
    const detail = upscale(art, 1024);
    const url = urls[2];
    const hostile: DotOptions = {
      ...DEFAULT_DOTS, shape: 'circle', size: 0.5, spacing: 0.35, density: 1,
      influence: 1, moduleContrast: 1.4, colourTreatment: true, bwIntensity: 0.2,
    };
    const { matrix, plan } = buildPlan(url, 'L', 'auto', art, hostile, 'photo', 0);
    const hostileImg = renderPlan(plan, matrix, { shape: 'circle', dotSize: 0.5, spacing: 0.35, quietZone: 3, px: 640, underlay: detail, ring: true });
    const hostileOk = decode(hostileImg) === url;
    let rescued = false, rescuedRung = '';
    const RUNGS: Array<{ repair: number; influence: number; contrast: number; colour: boolean; bw: number; geo: boolean; ring: boolean; ec: ECLevel }> = [
      { repair: 1, influence: 0.35, contrast: 1.2, colour: false, bw: 1, geo: false, ring: true, ec: 'L' },
      { repair: 2, influence: 0.2, contrast: 1, colour: false, bw: 1, geo: false, ring: true, ec: 'L' },
      { repair: 2, influence: 0.1, contrast: 1, colour: false, bw: 1, geo: true, ring: true, ec: 'L' },
      { repair: 3, influence: 0.05, contrast: 0.85, colour: false, bw: 1, geo: true, ring: false, ec: 'L' },
      { repair: 4, influence: 0, contrast: 0.85, colour: false, bw: 1, geo: true, ring: false, ec: 'H' as ECLevel },
    ];
    for (const rung of RUNGS) {
      const dots: DotOptions = {
        ...hostile, influence: rung.influence, moduleContrast: rung.contrast,
        colourTreatment: rung.colour, bwIntensity: rung.bw,
        shape: rung.geo ? 'pixel' : 'circle',
        size: rung.geo ? 1 : hostile.size, spacing: rung.geo ? 0 : hostile.spacing,
      };
      const { matrix: m, plan: p } = buildPlan(url, rung.ec, 'auto', art, dots, 'photo', rung.repair);
      const img = renderPlan(p, m, { shape: dots.shape, dotSize: dots.size, spacing: dots.spacing, quietZone: 3, px: 640, underlay: detail, ring: rung.ring });
      if (decode(img) === url) { rescued = true; rescuedRung = `repair ${rung.repair} influence ${rung.influence} shape ${dots.shape} geo ${rung.geo} ring ${rung.ring} ec ${rung.ec}`; break; }
    }
    check('recovery: hostile composite fails at defaults (honesty check)', !hostileOk);
    check(`recovery: ladder rescues hostile composite (at rung: ${rescuedRung || 'none'})`, rescued);
  }

  // (e) final-frame / export consistency: deterministic raster + layer presence
  {
    const art = cropCenterSquare(makeArt('animal'));
    const detail = upscale(art, 1024);
    const url = urls[1];
    const { matrix, plan } = buildPlan(url, 'H', 'auto', art, DEFAULT_DOTS, 'balanced', 0);
    const opts = { shape: 'pixel' as DotShape, dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 2048, underlay: detail, ring: true };
    const a = renderPlan(plan, matrix, opts);
    const b = renderPlan(plan, matrix, opts);
    let identical = true;
    for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { identical = false; break; }
    check('final frame: raster is deterministic (export == preview pixels)', identical);

    // ring presence: actual perforation square centres are near-black; the
    // clearance pixel one module inside the ring and the outer corner are white
    const N = matrix.size, q = 6, S = 2048, mp = S / (N + 2 * q), ox = q * mp;
    const ringSq = ringSquares(N, q, mp, ox);
    const count = N + q;
    const probes = [ringSq[0], ringSq[count], ringSq[count * 2], ringSq[count * 3 + 5]];
    const lumas = probes.map((s) => {
      const p = getPx(a, Math.round(s.x), Math.round(s.y));
      return luminance({ r: p[0], g: p[1], b: p[2] });
    });
    const clearPx = getPx(a, Math.round(ox + 5 * mp), Math.round(ox - 1 * mp));
    const cornerPx = getPx(a, 4, 4);
    check(`ring: perforation squares are black (lumas ${lumas.map((l) => l.toFixed(0)).join('/')})`, lumas.every((l) => l < 90));
    check(`ring: clearance pixel stays white (luma ${luminance({ r: clearPx[0], g: clearPx[1], b: clearPx[2] }).toFixed(0)})`, luminance({ r: clearPx[0], g: clearPx[1], b: clearPx[2] }) > 235);
    check('ring: outer corner stays white', luminance({ r: cornerPx[0], g: cornerPx[1], b: cornerPx[2] }) > 245);

    // underlay presence: a light module DROPPED by density shows the photograph,
    // not paper — proves the photo fills the composition beneath the modules.
    // Bright photography is used because the engine's v3 density rule only drops
    // light modules whose underlying photo is bright enough to still read light;
    // over dark photography every light dot is kept by design.
    const dropArt = cropCenterSquare(makeArt('brightphoto'));
    const dropDetail = upscale(dropArt, 1024);
    const dropDots: DotOptions = { ...DEFAULT_DOTS, density: 0.85 };
    const { matrix: m2, plan: p2 } = buildPlan(url, 'H', 'auto', dropArt, dropDots, 'balanced', 0);
    const dropImg = renderPlan(p2, m2, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 2048, underlay: dropDetail, ring: true });
    const kept = new Set(p2.dots.map((d) => d.row * m2.size + d.col));
    let gapChecked = 0, gapOk = 0;
    for (let r = 1; r < m2.size - 1 && gapChecked < 40; r += 3) {
      for (let c = 1; c < m2.size - 1 && gapChecked < 40; c += 3) {
        if (m2.isFunctionModule(r, c) || m2.isDark(r, c)) continue;
        const i = r * m2.size + c;
        if (kept.has(i)) continue; // dropped light module
        const px = Math.round(ox + (c + 0.5) * mp), py = Math.round(ox + (r + 0.5) * mp);
        const rendered = getPx(dropImg, px, py);
        const src = getPx(dropDetail, Math.min(dropDetail.w - 1, Math.floor((c + 0.5) * dropDetail.w / m2.size)), Math.min(dropDetail.h - 1, Math.floor((r + 0.5) * dropDetail.h / m2.size)));
        const dL = Math.abs(luminance({ r: rendered[0], g: rendered[1], b: rendered[2] }) - luminance({ r: src[0], g: src[1], b: src[2] }));
        gapChecked++;
        if (dL < 60) gapOk++;
      }
    }
    check(`underlay: dropped light modules show the photograph (${gapOk}/${gapChecked} within 60 luma)`, gapChecked > 0 && gapOk === gapChecked);

    // module alignment: dark data module centre is dark; the hairline gap
    // between two dark modules shows the photograph (not paper)
    let alignChecked = 0, alignOk = 0;
    for (const d of plan.dots.slice(0, 400)) {
      if (!d.dark || d.col + 1 >= m2.size) continue;
      if (m2.isFunctionModule(d.row, d.col) || m2.isFunctionModule(d.row, d.col + 1)) continue;
      if (!m2.isDark(d.row, d.col + 1)) continue;
      const cx = Math.round(ox + (d.col + 0.5) * mp), cy = Math.round(ox + (d.row + 0.5) * mp);
      const gapX = Math.round(ox + (d.col + 1) * mp), gapY = cy;
      const centerPx = getPx(a, cx, cy);
      const gapPx = getPx(a, gapX, gapY);
      const src = getPx(detail, Math.min(detail.w - 1, Math.floor(((d.col + 1) * mp / (N * mp)) * detail.w)), Math.min(detail.h - 1, Math.floor(((d.row + 0.5) * mp / (N * mp)) * detail.h)));
      alignChecked++;
      if (luminance({ r: centerPx[0], g: centerPx[1], b: centerPx[2] }) < 90
        && Math.abs(luminance({ r: gapPx[0], g: gapPx[1], b: gapPx[2] }) - luminance({ r: src[0], g: src[1], b: src[2] })) < 60) alignOk++;
    }
    check(`modules: dark centres dark + hairline gaps show photo (${alignOk}/${alignChecked})`, alignChecked > 10 && alignOk === alignChecked);

    savePNG(`${ARTIFACT_DIR}/accept-animal-composite.png`, a.w, a.h, a.data);
  }
}

console.log('\n== T13: source dimensions & orientation (portrait / landscape / square) ==');
{
  const urls = [
    'https://dotra.app',
    'https://dotra.app/gallery/nature/ember-ridge',
    'https://dotra.app/s/xK9f2mQp?src=sample&ref=qr&utm=dotra',
  ];
  const sources: Array<[string, Img]> = [
    ['portrait source 500×800', makeArt('portrait', 500, 800)],
    ['landscape source 800×500', makeArt('landscape', 800, 500)],
    ['square source 512×512', makeArt('animal', 512, 512)],
  ];
  let total = 0, ok = 0;
  for (const [label, src] of sources) {
    const square = cropCenterSquare(src); // mirrors the browser smart crop
    const detail = upscale(square, 1024);
    for (const url of urls) {
      total++;
      const { matrix, plan } = buildPlan(url, 'H', 'auto', square, DEFAULT_DOTS, 'balanced', 0);
      const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: 6, px: 1024, underlay: detail, ring: true });
      const decoded = decode(img);
      if (decoded === url) ok++;
      else console.log(`    fail: ${label} -> ${decoded}`);
    }
  }
  check(`orientation matrix decodes exactly (${ok}/${total})`, ok === total, `(${ok}/${total})`);
  // non-square source must not distort the matrix: plan still N×N from the crop
  const rect = makeArt('landscape', 800, 500);
  const sq = cropCenterSquare(rect);
  check('center crop yields a square (500×500)', sq.w === 500 && sq.h === 500);
}

console.log('\n== T14: Engine Lab — three engines, one decoder (spec §14) ==');
{
  const toRaster = (img: Img): Raster => new Raster(img.w, img.h, img.data);
  const fromRaster = (r: Raster): Img => ({ w: r.w, h: r.h, data: r.data });
  const Q = 6;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // ——— matrix sharing & EC semantics ———
  const probeUrl = 'https://dotra.app/engine-lab';
  const sharedM = encodeQR(probeUrl, 'M', 'auto').matrix;
  const forcedH = encodeQR(probeUrl, 'H', 'auto').matrix;
  check('shared matrix encoded at the Studio EC level', sharedM.ecLevel === 'M');
  check('halftone re-encodes at EC-H (origin gem design)', forcedH.ecLevel === 'H');
  check('same encoder → identical matrix size', sharedM.size === encodeQR(probeUrl, 'M', 'auto').matrix.size);

  // ——— acceptance: 3 URLs × 3 artworks × 3 engines @1024px ———
  const urls = [
    'https://dotra.app',
    'https://dotra.app/gallery/nature/ember-ridge',
    'https://dotra.app/s/xK9f2mQp?src=sample&ref=qr&utm=dotra',
  ];
  const arts: Array<[string, Img]> = [
    ['portrait', makeArt('portrait')],
    ['landscape', makeArt('landscape')],
    ['brightphoto', makeArt('brightphoto')],
  ];
  const results: Record<string, { ok: number; total: number; sep: number[]; fid: number[] }> = {
    composite: { ok: 0, total: 0, sep: [], fid: [] },
    halftone: { ok: 0, total: 0, sep: [], fid: [] },
    artistic: { ok: 0, total: 0, sep: [], fid: [] },
  };
  const snapshot = (m: MatrixInfo) => {
    const s: boolean[] = [];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) s.push(m.isDark(r, c));
    return s;
  };
  const before = snapshot(sharedM);

  for (const url of urls) {
    const mA = encodeQR(url, 'M', 'auto').matrix;
    const mH = encodeQR(url, 'H', 'auto').matrix;
    for (const [kind, art] of arts) {
      const detail = upscale(cropCenterSquare(art), 1024);
      const photo = toRaster(art);

      { // composite — DOTRA v3 defaults
        const { matrix, plan } = buildPlan(url, 'M', 'auto', art, DEFAULT_DOTS, 'balanced', 0);
        const cq = Q;
        const cmp = 1024 / (matrix.size + 2 * cq);
        const cRect = { x: cq * cmp, y: cq * cmp, w: matrix.size * cmp, h: matrix.size * cmp };
        const img = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: Q, px: 1024, underlay: detail, ring: true });
        if (decode(img) === url) {
          results.composite.ok++;
          const met = computeMetrics({ raster: toRaster(img), photo, photoRect: cRect, matrix, quietZone: Q, size: 1024, verified: true });
          results.composite.sep.push(met.separation);
          if (met.fidelity !== null) results.composite.fid.push(met.fidelity);
        }
        results.composite.total++;
      }
      { // halftone — visual-qrcode port
        const raster = renderHalftone({ matrix: mH, photo, size: 1024, quietZone: Q }, HALFTONE_DEFAULTS);
        const hp = Math.max(0, Math.min(HALFTONE_DEFAULTS.photoPadding, Math.floor(mH.size / 2) - 5));
        const hmp = 1024 / (mH.size + 2 * Q);
        const hRect = { x: Q * hmp + hp * hmp, y: Q * hmp + hp * hmp, w: (mH.size - 2 * hp) * hmp, h: (mH.size - 2 * hp) * hmp };
        if (decode(fromRaster(raster)) === url) {
          results.halftone.ok++;
          const met = computeMetrics({ raster, photo, photoRect: hRect, matrix: mH, quietZone: Q, size: 1024, verified: true });
          results.halftone.sep.push(met.separation);
          if (met.fidelity !== null) results.halftone.fid.push(met.fidelity);
        }
        results.halftone.total++;
      }
      { // artistic — qrcode-toolkit port
        const raster = renderArtistic({ matrix: mA, photo, size: 1024, quietZone: Q }, { ...ARTISTIC_DEFAULTS, photoBackground: true });
        if (decode(fromRaster(raster)) === url) {
          results.artistic.ok++;
          const met = computeMetrics({ raster, photo, photoRect: { x: 0, y: 0, w: 1024, h: 1024 }, matrix: mA, quietZone: Q, size: 1024, verified: true });
          results.artistic.sep.push(met.separation);
          if (met.fidelity !== null) results.artistic.fid.push(met.fidelity);
        }
        results.artistic.total++;
      }
    }
  }
  check('matrix untouched by all three engines', before.every((v, i) => v === snapshot(sharedM)[i]));
  for (const id of ['composite', 'halftone', 'artistic'] as const) {
    const r = results[id];
    check(`acceptance ${id}: exact URL match (${r.ok}/${r.total})`, r.ok === r.total, `(${r.ok}/${r.total})`);
    console.log(`    ${id}: mean separation ${mean(r.sep).toFixed(1)} · mean fidelity ${r.fid.length ? mean(r.fid).toFixed(3) : '—'}`);
  }
  check('composite scan separation ≥ 100', mean(results.composite.sep) >= 100, mean(results.composite.sep).toFixed(1));
  check('halftone scan separation ≥ 200', mean(results.halftone.sep) >= 200, mean(results.halftone.sep).toFixed(1));
  // artistic tiles are tone-pinned photo tiles by design — band separation is
  // compressed vs opaque ink (measured ~172 with tiles vs 245 without); the
  // polarity guard + EC redundancy carry the decode, so the floor is honest.
  check('artistic scan separation ≥ 150 (tone-pinned tiles)', mean(results.artistic.sep) >= 150, mean(results.artistic.sep).toFixed(1));
  check('composite photo fidelity ≥ 0.20', mean(results.composite.fid) >= 0.2, mean(results.composite.fid).toFixed(3));
  check('halftone photo fidelity ≥ 0.50', mean(results.halftone.fid) >= 0.5, mean(results.halftone.fid).toFixed(3));
  check('artistic photo fidelity ≥ 0.03', mean(results.artistic.fid) >= 0.03, mean(results.artistic.fid).toFixed(3));

  // ——— repair ladders: genuine escalation evidence ———
  { // halftone hostile: busy photo, photo to grid edge, thumbnail-scale raster
    // Centres are pure data colour by construction, so the genuine failure
    // mode is a long URL (large matrix) at thumbnail scale — the 3×3 centre
    // sub-pixel drops below reliable decoder resolution.
    const url = 'https://dotra.app/s/engine-lab/compare?engine=halftone&photo=portrait&utm_source=gallery&utm_medium=qr';
    const mH = encodeQR(url, 'H', 'auto').matrix;
    const photo = toRaster(makeArt('saturated'));
    const ladder: Array<{ label: string; opts: HalftoneOptions; photoOn: boolean }> = [
      { label: '3×3 sub-pixels, photo to grid edge', opts: { subpixels: 3, photoPadding: 0, moduleFill: 'centre', photoStrength: 0.45 }, photoOn: true },
      { label: '4×4 larger data centre', opts: { subpixels: 4, photoPadding: 0, moduleFill: 'centre', photoStrength: 0.45 }, photoOn: true },
      { label: '4×4 + photo padding', opts: { subpixels: 4, photoPadding: 2, moduleFill: 'centre', photoStrength: 0.45 }, photoOn: true },
      { label: 'solid modules (photo off)', opts: { subpixels: 4, photoPadding: 0, moduleFill: 'centre', photoStrength: 0.45 }, photoOn: false },
    ];
    let rescued = -1;
    for (let i = 0; i < ladder.length; i++) {
      const raster = renderHalftone({ matrix: mH, photo: ladder[i].photoOn ? photo : null, size: 192, quietZone: 2 }, ladder[i].opts);
      const d = decode(fromRaster(raster));
      console.log(`    halftone hostile rung ${i} [${ladder[i].label}]: ${d === url ? 'VERIFIED' : 'failed'}`);
      if (d === url) { rescued = i; break; }
    }
    check('halftone hostile: defaults fail, ladder rescues', rescued > 0, `rescued at rung ${rescued}`);
  }
  { // artistic hostile: every effect at maximum
    const url = urls[2];
    const mA = encodeQR(url, 'M', 'auto').matrix;
    const photo = toRaster(makeArt('saturated'));
    const hostile: ArtisticOptions = {
      ...ARTISTIC_DEFAULTS, crystalizeRadius: 32, liquidifyRadius: 16, perspective: 1,
      marginNoise: true, marginNoiseRate: 0.6, marginNoiseSpace: 'full', seed: 7,
    };
    const ladder: Array<{ label: string; opts: ArtisticOptions }> = [
      { label: 'all effects at maximum', opts: hostile },
      { label: 'effects + margin noise off', opts: { ...hostile, crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false } },
      { label: 'plain square modules', opts: { ...hostile, pixelStyle: 'square', markerShape: 'square', markerInner: 'square', crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false } },
    ];
    const d0 = decode(fromRaster(renderArtistic({ matrix: mA, photo, size: 1024, quietZone: Q }, hostile)));
    check('artistic hostile: max-effects defaults genuinely fail jsQR', d0 !== url);
    let rescued = -1;
    for (let i = 0; i < ladder.length; i++) {
      const raster = renderArtistic({ matrix: mA, photo, size: 1024, quietZone: Q }, ladder[i].opts);
      const d = decode(fromRaster(raster));
      console.log(`    artistic hostile rung ${i} [${ladder[i].label}]: ${d === url ? 'VERIFIED' : 'failed'}`);
      if (d === url) { rescued = i; break; }
    }
    check('artistic hostile: ladder rescues', rescued > 0, `rescued at rung ${rescued}`);
  }

  // ——— artistic ladder completeness — UI preview size (720px), Studio-default EC-H ———
  // Mirrors the hook's 6-rung artistic ladder exactly (styling → effects/noise off →
  // square finders → plain modules → safe palette → photo background off).
  {
    const url = 'https://dotra.app/s/engine-lab/artistic/compare?engine=artistic&photo=busy&utm_source=stress&utm_medium=qr&utm_campaign=lab';
    const mA = encodeQR(url, 'H', 'auto').matrix;
    const busy = toRaster(makeArt('animal')); // high-frequency stripes — the hostile case
    const safe = (a: ArtisticOptions): ArtisticOptions => ({ ...a, crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false });
    const ladderFrom = (a: ArtisticOptions): ArtisticOptions[] => [
      a,
      safe(a),
      { ...safe(a), markerShape: 'square', markerInner: 'square' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false, lightColor: '#ffffff', darkColor: '#0a0a0a' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false, lightColor: '#ffffff', darkColor: '#0a0a0a', photoBackground: false },
    ];
    const verifyLadder = (opts: ArtisticOptions): number => {
      const rungs = ladderFrom(opts);
      for (let i = 0; i < rungs.length; i++) {
        const raster = renderArtistic({ matrix: mA, photo: busy, size: 720, quietZone: 6 }, rungs[i]);
        if (decode(fromRaster(raster)) === url) return i;
      }
      return -1;
    };
    // (a) busy photo + long URL at preview size: defaults honest, ladder always reaches truth
    const r0 = renderArtistic({ matrix: mA, photo: busy, size: 720, quietZone: 6 }, ARTISTIC_DEFAULTS);
    const r0ok = decode(fromRaster(r0)) === url;
    const rescueRung = verifyLadder(ARTISTIC_DEFAULTS);
    check('artistic @720px busy photo: ladder always reaches a verified rung', rescueRung >= 0, `rescued at rung ${rescueRung}`);
    check('artistic @720px busy photo: escalation is genuine', r0ok ? rescueRung === 0 : rescueRung > 0, `r0 ${r0ok ? 'verified' : 'failed'}, rung ${rescueRung}`);
    // (b) every styled option verifies at SOME rung — no configuration is undecodable
    const sweep: Array<[string, Partial<ArtisticOptions>]> = [
      ['markerInner diamond', { markerInner: 'diamond' }],
      ['markerInner circle', { markerInner: 'circle' }],
      ['markerInner plus', { markerInner: 'plus' }],
      ['markerShape circle', { markerShape: 'circle' }],
      ['markerShape plus', { markerShape: 'plus' }],
      ['markerShape octagon', { markerShape: 'octagon' }],
      ['markerShape tiny-plus', { markerShape: 'tiny-plus' }],
      ['style rounded', { pixelStyle: 'rounded' }],
      ['style dot', { pixelStyle: 'dot' }],
      ['style squircle', { pixelStyle: 'squircle' }],
      ['style row', { pixelStyle: 'row' }],
      ['style column', { pixelStyle: 'column' }],
      ['noise full', { marginNoiseSpace: 'full' }],
      ['noise marker', { marginNoiseSpace: 'marker' }],
      ['crystalize', { crystalizeRadius: 8 }],
      ['liquidify', { liquidifyRadius: 10 }],
      ['perspective', { perspective: 0.5 }],
      ['colors inverted', { lightColor: '#0a0a0a', darkColor: '#f5f5f4' }],
      ['colors pastel', { lightColor: '#e8e8e6', darkColor: '#6b6b6b' }],
      ['photo background off', { photoBackground: false }],
    ];
    let sweepOk = 0;
    let worst = 0;
    for (const [, over] of sweep) {
      const r = verifyLadder({ ...ARTISTIC_DEFAULTS, ...over });
      if (r >= 0) { sweepOk++; worst = Math.max(worst, r); }
    }
    check(`artistic option sweep: all ${sweep.length} styled configs verify at some rung`, sweepOk === sweep.length, `${sweepOk}/${sweep.length}`);
    console.log(`    artistic sweep: ${sweepOk}/${sweep.length} verified, worst rescue rung ${worst}`);
    // (c) diamond finder core actually renders dark (regression probe — drawShape diamond)
    const dR = renderArtistic({ matrix: mA, photo: busy, size: 720, quietZone: 6 }, { ...ARTISTIC_DEFAULTS, markerInner: 'diamond' });
    const dmp = 720 / (mA.size + 12);
    const coreLuma = dR.luma(Math.round(9.5 * dmp), Math.round(9.5 * dmp));
    check('artistic diamond marker core renders dark (bug fix)', coreLuma < 100, `core luma ${coreLuma.toFixed(0)}`);
  }

  // ——— T15: receipt-print animation + halftone solid-block mode ———
  console.log('\n== T15: receipt animation + halftone solid blocks ==');
  {
    // receipt preset is registered and builds a row-ordered scene
    check("'receipt' is a registered animation preset", ANIMATION_PRESETS.some((p) => p.id === 'receipt'));
    const m = encodeQR(urls[0], 'M', 'auto').matrix;
    const { plan } = buildPlan(urls[0], 'M', 'auto', makeArt('portrait'), DEFAULT_DOTS, 'balanced', 0);
    const mp540 = 540 / (m.size + 12);
    const scene = createScene(plan, m, 540, 6, { preset: 'receipt', duration: 2.4, speed: 1, intensity: 0.5, startDistance: 0.9, easing: 'easeOut' });
    check(`receipt scene: one particle per kept module (${scene.particles.length})`, scene.particles.length > 0 && scene.particles.length <= m.size * m.size);
    check('receipt scene: preset round-trips', scene.preset === 'receipt');
    // row-ordered cascade: the minimum delay per row is non-decreasing top→bottom
    const byRow = new Map<number, number>();
    for (const p of scene.particles) {
      const row = Math.round((p.ty - scene.origin) / scene.modulePx - 0.5);
      byRow.set(row, Math.min(byRow.get(row) ?? 1, p.delay));
    }
    let mono = true, lastDelay = -1;
    for (const r of [...byRow.keys()].sort((a, b) => a - b)) {
      const d = byRow.get(r)!;
      if (d < lastDelay - 1e-9) mono = false;
      lastDelay = d;
    }
    check('receipt cascade: per-row delays are top-down ordered', mono);
    // paper-feed geometry
    const gridH = m.size * mp540;
    const t0 = receiptTop(0, 540, mp540, m.size, 6);
    const t1 = receiptTop(1, 540, mp540, m.size, 6);
    check('receipt geometry: starts fully above the slot (nothing visible)', t0 + gridH <= 540 * 0.08 + 1e-6, `bottom edge ${ (t0 + gridH).toFixed(1)} vs slot ${(540 * 0.08).toFixed(1)}`);
    check('receipt geometry: ends at the final position', Math.abs(t1 - 6 * mp540) < 1e-6);
    let monoTop = true, prevTop = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const t = receiptTop(i / 20, 540, mp540, m.size, 6);
      if (t < prevTop - 1e-9) monoTop = false;
      prevTop = t;
    }
    check('receipt geometry: paper feed is monotone', monoTop);
  }
  {
    // halftone solid-block mode: full modules, no sub-pixels, no photo rings
    const mH = encodeQR(urls[0], 'H', 'auto').matrix;
    const photo = toRaster(makeArt('saturated'));
    const blockOpts: HalftoneOptions = { ...HALFTONE_DEFAULTS, moduleFill: 'block' };
    const raster = renderHalftone({ matrix: mH, photo, size: 1024, quietZone: Q }, blockOpts);
    check('halftone solid blocks: jsQR verifies the exact URL', decode(fromRaster(raster)) === urls[0]);
    const met = computeMetrics({ raster, photo, photoRect: { x: 0, y: 0, w: 1024, h: 1024 }, matrix: mH, quietZone: Q, size: 1024, verified: true });
    check('halftone solid blocks: separation near maximum', met.separation >= 240, met.separation.toFixed(1));
    // module cells are fully solid: interior sample must carry no photo variance
    const mp = 1024 / (mH.size + 2 * Q);
    let cellStd = -1;
    outer: for (let c = 10; c < mH.size - 10; c++) {
      if (mH.isDark(12, c) && !mH.isFunctionModule(12, c)) {
        const vals: number[] = [];
        const bx = Q * mp + c * mp, by = Q * mp + 12 * mp;
        for (let y = Math.floor(by + mp * 0.2); y < by + mp * 0.8; y += 2) {
          for (let x = Math.floor(bx + mp * 0.2); x < bx + mp * 0.8; x += 2) {
            const px = raster.get(x, y);
            vals.push(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
          }
        }
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        cellStd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
        break outer;
      }
    }
    check('halftone solid blocks: module cell is uniform (no photo rings)', cellStd >= 0 && cellStd < 8, cellStd.toFixed(2));
    // block mode at thumbnail scale still verifies (solid = safest)
    const thumb = renderHalftone({ matrix: mH, photo, size: 192, quietZone: 2 }, blockOpts);
    check('halftone solid blocks: verifies at 192px thumbnail', decode(fromRaster(thumb)) === urls[0]);
  }

  // ——— T16: photographic module tiles (halftone photo blocks + artistic photo modules) ———
  console.log('\n== T16: photographic module tiles ==');
  {
    // halftone photo blocks: big tiles carry the photograph, polarity-guarded
    const mH = encodeQR(urls[0], 'H', 'auto').matrix;
    const photo = toRaster(makeArt('animal')); // high-frequency stripes — variance probe needs detail
    const raster = renderHalftone({ matrix: mH, photo, size: 1024, quietZone: Q }, { ...HALFTONE_DEFAULTS, moduleFill: 'photo' });
    check('halftone photo blocks: jsQR verifies the exact URL', decode(fromRaster(raster)) === urls[0]);
    const mp = 1024 / (mH.size + 2 * Q);
    const cellSigma = (ras: Raster, r: number, c: number): number => {
      const vals: number[] = [];
      const bx = Q * mp + c * mp, by = Q * mp + r * mp;
      for (let y = Math.floor(by + mp * 0.25); y < by + mp * 0.75; y++) {
        for (let x = Math.floor(bx + mp * 0.25); x < bx + mp * 0.75; x++) {
          const px = ras.get(x, y);
          vals.push(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
        }
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    };
    const bandMaxSigma = (ras: Raster): number => {
      let mx = 0;
      for (let r = 10; r < Math.min(15, mH.size - 10); r++) {
        for (let c = 10; c < mH.size - 10; c++) {
          if (!mH.isDark(r, c) || mH.isFunctionModule(r, c)) continue;
          mx = Math.max(mx, cellSigma(ras, r, c));
        }
      }
      return mx;
    };
    const photoMax = bandMaxSigma(raster);
    const controlMax = bandMaxSigma(renderHalftone({ matrix: mH, photo, size: 1024, quietZone: Q }, { ...HALFTONE_DEFAULTS, moduleFill: 'block' }));
    check(`halftone photo blocks: tiles carry the photograph (σ ${photoMax.toFixed(1)} vs solid control ${controlMax.toFixed(1)})`, photoMax > 8 && photoMax > 4 * controlMax, `photo ${photoMax.toFixed(1)}, solid ${controlMax.toFixed(1)}`);
    const met = computeMetrics({ raster, photo, photoRect: { x: Q * mp, y: Q * mp, w: mH.size * mp, h: mH.size * mp }, matrix: mH, quietZone: Q, size: 1024, verified: true });
    check('halftone photo blocks: separation decoder-safe', met.separation >= 100, met.separation.toFixed(1));
    // hostile: busy photo + long URL at preview size — tone escalation or solid rescues
    const url = 'https://dotra.app/s/engine-lab/compare?engine=halftone&photo=portrait&utm_source=gallery&utm_medium=qr';
    const mH2 = encodeQR(url, 'H', 'auto').matrix;
    const busy = toRaster(makeArt('animal'));
    const photoLadder: Array<{ label: string; opts: HalftoneOptions }> = [
      { label: 'photo blocks (tone 0.45)', opts: { ...HALFTONE_DEFAULTS, moduleFill: 'photo', photoStrength: 0.45 } },
      { label: 'photo blocks (tone 0.65)', opts: { ...HALFTONE_DEFAULTS, moduleFill: 'photo', photoStrength: 0.65 } },
      { label: 'solid B/W blocks', opts: { ...HALFTONE_DEFAULTS, moduleFill: 'block' } },
    ];
    let rescued = -1;
    for (let i = 0; i < photoLadder.length; i++) {
      const r = renderHalftone({ matrix: mH2, photo: busy, size: 720, quietZone: 6 }, photoLadder[i].opts);
      if (decode(fromRaster(r)) === url) { rescued = i; break; }
    }
    check('halftone photo blocks hostile @720px: ladder rescues', rescued >= 0, `rescued at rung ${rescued}`);
    console.log(`    halftone photo hostile: rescued at rung ${rescued}`);
  }
  {
    // artistic photo modules: tone-pinned tiles in both polarities, violator-solid guard
    const mA = encodeQR(urls[0], 'M', 'auto').matrix;
    const photo = toRaster(makeArt('animal')); // high-frequency stripes — variance probe needs detail
    const raster = renderArtistic({ matrix: mA, photo, size: 1024, quietZone: Q }, { ...ARTISTIC_DEFAULTS, photoModules: true });
    check('artistic photo modules: jsQR verifies the exact URL', decode(fromRaster(raster)) === urls[0]);
    const mp = 1024 / (mA.size + 2 * Q);
    const cellSigma = (ras: Raster, r: number, c: number): number => {
      const vals: number[] = [];
      const bx = Q * mp + c * mp, by = Q * mp + r * mp;
      for (let y = Math.floor(by + mp * 0.25); y < by + mp * 0.75; y++) {
        for (let x = Math.floor(bx + mp * 0.25); x < bx + mp * 0.75; x++) {
          const px = ras.get(x, y);
          vals.push(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]);
        }
      }
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      return Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    };
    const bandMaxSigma = (ras: Raster): number => {
      let mx = 0;
      for (let r = 10; r < Math.min(15, mA.size - 10); r++) {
        for (let c = 10; c < mA.size - 10; c++) {
          if (!mA.isDark(r, c) || mA.isFunctionModule(r, c)) continue;
          mx = Math.max(mx, cellSigma(ras, r, c));
        }
      }
      return mx;
    };
    const photoMax = bandMaxSigma(raster);
    const controlMax = bandMaxSigma(renderArtistic({ matrix: mA, photo, size: 1024, quietZone: Q }, { ...ARTISTIC_DEFAULTS, photoModules: false, pixelStyle: 'square' }));
    check(`artistic photo modules: tiles carry the photograph (σ ${photoMax.toFixed(1)} vs solid control ${controlMax.toFixed(1)})`, photoMax > 8 && photoMax > 4 * controlMax, `photo ${photoMax.toFixed(1)}, solid ${controlMax.toFixed(1)}`);
    // hostile busy-photo ladder: defaults may verify or escalate — never lie
    const url = 'https://dotra.app/s/engine-lab/artistic/compare?engine=artistic&photo=busy&utm_source=stress&utm_medium=qr&utm_campaign=lab';
    const mA2 = encodeQR(url, 'H', 'auto').matrix;
    const busy = toRaster(makeArt('animal'));
    const safe = (a: ArtisticOptions): ArtisticOptions => ({ ...a, crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false });
    const ladderFrom = (a: ArtisticOptions): ArtisticOptions[] => [
      a,
      safe(a),
      { ...safe(a), markerShape: 'square', markerInner: 'square' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false, lightColor: '#ffffff', darkColor: '#0a0a0a' },
      { ...safe(a), pixelStyle: 'square', markerShape: 'square', markerInner: 'square', photoModules: false, lightColor: '#ffffff', darkColor: '#0a0a0a', photoBackground: false },
    ];
    const r0 = renderArtistic({ matrix: mA2, photo: busy, size: 720, quietZone: 6 }, ARTISTIC_DEFAULTS);
    const r0ok = decode(fromRaster(r0)) === url;
    let rescued = -1;
    for (let i = 0; i < ladderFrom(ARTISTIC_DEFAULTS).length; i++) {
      const rr = renderArtistic({ matrix: mA2, photo: busy, size: 720, quietZone: 6 }, ladderFrom(ARTISTIC_DEFAULTS)[i]);
      if (decode(fromRaster(rr)) === url) { rescued = i; break; }
    }
    check('artistic photo modules hostile @720px: ladder always reaches truth', rescued >= 0 && (r0ok ? rescued === 0 : rescued > 0), `r0 ${r0ok ? 'verified' : 'failed'}, rung ${rescued}`);
    console.log(`    artistic photo hostile: r0 ${r0ok ? 'verified' : 'failed'}, rescued at rung ${rescued}`);
  }

  // ——— determinism ———
  {
    const mA = encodeQR(urls[0], 'M', 'auto').matrix;
    const mH = encodeQR(urls[0], 'H', 'auto').matrix;
    const photo = toRaster(makeArt('animal'));
    const a1 = renderArtistic({ matrix: mA, photo, size: 512, quietZone: Q }, { ...ARTISTIC_DEFAULTS, crystalizeRadius: 12 });
    const a2 = renderArtistic({ matrix: mA, photo, size: 512, quietZone: Q }, { ...ARTISTIC_DEFAULTS, crystalizeRadius: 12 });
    check('artistic deterministic (same seed)', Buffer.compare(Buffer.from(a1.data), Buffer.from(a2.data)) === 0);
    const b = renderArtistic({ matrix: mA, photo, size: 512, quietZone: Q }, { ...ARTISTIC_DEFAULTS, crystalizeRadius: 12, seed: 42 });
    check('artistic seed changes the render', Buffer.compare(Buffer.from(a1.data), Buffer.from(b.data)) !== 0);
    const h1 = renderHalftone({ matrix: mH, photo, size: 512, quietZone: Q }, HALFTONE_DEFAULTS);
    const h2 = renderHalftone({ matrix: mH, photo, size: 512, quietZone: Q }, HALFTONE_DEFAULTS);
    check('halftone deterministic', Buffer.compare(Buffer.from(h1.data), Buffer.from(h2.data)) === 0);
  }

  // ——— artifacts ———
  {
    const url = urls[1];
    const art = makeArt('landscape');
    const photo = toRaster(art);
    const detail = upscale(cropCenterSquare(art), 1024);
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, DEFAULT_DOTS, 'balanced', 0);
    const cImg = renderPlan(plan, matrix, { shape: 'pixel', dotSize: 0.88, spacing: 0.02, quietZone: Q, px: 1024, underlay: detail, ring: true });
    savePNG('/tmp/dotra-v3/engine-composite.png', cImg.w, cImg.h, cImg.data);
    const hImg = fromRaster(renderHalftone({ matrix: encodeQR(url, 'H', 'auto').matrix, photo, size: 1024, quietZone: Q }, HALFTONE_DEFAULTS));
    savePNG('/tmp/dotra-v3/engine-halftone.png', hImg.w, hImg.h, hImg.data);
    const aImg = fromRaster(renderArtistic({ matrix: encodeQR(url, 'M', 'auto').matrix, photo, size: 1024, quietZone: Q }, { ...ARTISTIC_DEFAULTS, photoBackground: true }));
    savePNG('/tmp/dotra-v3/engine-artistic.png', aImg.w, aImg.h, aImg.data);
    console.log('    artifacts: /tmp/dotra-v3/engine-{composite,halftone,artistic}.png');
  }
}

console.log(`\n=========== ${passed} passed, ${failed} failed ===========`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  -', f);
  process.exitCode = 1;
}

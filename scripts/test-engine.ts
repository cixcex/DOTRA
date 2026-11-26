// ---------------------------------------------------------------------------
// DOTRA engine test harness (Node, no DOM).
//
// Mirrors the browser rendering path of dotRenderer.renderDotQR with a software
// rasterizer, then decodes the actual raster with jsQR — the same gate the app
// runs in the browser. A QR only passes if the REAL pixels decode to the URL.
//
// v2 — photograph-based engine:
//   * tone BANDS (dark/light) instead of crush-to-black/white
//   * photographic fidelity metrics (per-band luma correlation, hue preservation,
//     chroma retention, spatial correspondence vs a shuffled control)
//   * six photo categories: portrait / landscape / animal / dark / bright / multicolor
//   * animation timeline math (scatter envelope, photo→QR blend, scene photo colours)
//   * fragment dots tested against the band-lifted tone-safe detail mirror
//
// Run: npm run test:engine   (bundle-run.mjs compiles the TS on the fly)
// ---------------------------------------------------------------------------

import jsQR from 'jsqr';
import { encodeQR, buildFunctionModuleMask } from '../src/engine/qrGenerator';
import { buildDotPlanFromSamples, type DotPlan } from '../src/engine/dotRenderer';
import { PRESET_TONES, REPAIR_TONES } from '../src/utils/contrastOptimizer';
import { createScene, scatterEnvelope, photoBlendT, structuralBlendT } from '../src/engine/particleEngine';
import type { MatrixInfo, RGB, DotOptions, QualityPreset, ECLevel, TargetVersion, DotShape } from '../src/engine/types';
import { makeImage, savePNG, fillRect, fillCircle, getPx, setPx, gradient, clamp255, makeNoise2D, forEachPixel, mixc } from './pngkit.mjs';

type Img = ReturnType<typeof makeImage>;
const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

let passed = 0, failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label} ${detail}`); }
}

// --- artworks ------------------------------------------------------------------
function makeArt(kind: string, size = 512): Img {
  const img = makeImage(size, size);
  const noise = makeNoise2D(kind.length * 977 + 13);
  const radial = (cx: number, cy: number, r: number, u: number, v: number) => {
    const d = Math.hypot(u - cx, v - cy) / r;
    return Math.max(0, 1 - d * d);
  };
  forEachPixel(img, (x, y) => {
    const u = x / size, v = y / size;
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
        // background wall
        c = gradient([[0, [188, 178, 168]], [1, [150, 142, 138]]])(v);
        // shoulders / coat
        const coat = radial(0.5, 1.25, 0.75, u, v);
        if (coat > 0) c = mixc(c, [74, 84, 104], Math.min(1, coat * 1.6));
        // face — skin tone blob
        const face = radial(0.5, 0.42, 0.21, u, v);
        if (face > 0) c = mixc(c, [224, 178, 148], Math.min(1, face * 1.35));
        // hair — dark cap on top
        const hair = radial(0.5, 0.18, 0.34, u, v) * (v < 0.52 ? 1 : 0.25);
        if (hair > 0.05) c = mixc(c, [58, 44, 36], Math.min(1, hair * 1.5));
        // eyes
        const eL = radial(0.43, 0.42, 0.028, u, v), eR = radial(0.57, 0.42, 0.028, u, v);
        if (eL > 0 || eR > 0) c = mixc(c, [40, 32, 30], Math.min(1, Math.max(eL, eR) * 1.8));
        // mouth shadow
        const mouth = radial(0.5, 0.55, 0.05, u, v);
        if (mouth > 0) c = mixc(c, [170, 110, 96], mouth);
        // cheek light
        const cheek = radial(0.36, 0.5, 0.09, u, v);
        if (cheek > 0) c = mixc(c, [238, 196, 168], cheek * 0.7);
        break;
      }
      case 'landscape': {
        // sky
        c = gradient([[0, [96, 142, 196]], [0.55, [226, 208, 178]]])(v);
        // sun glow
        const sun = radial(0.68, 0.2, 0.12, u, v);
        if (sun > 0) c = mixc(c, [252, 246, 214], sun);
        // far ridge
        const r1 = 0.55 + 0.05 * Math.sin(u * 9 + 1.7) + 0.02 * noise(u * 6, 0.5, 2);
        if (v > r1) c = mixc(c, [86, 102, 92], Math.min(1, (v - r1) * 14 + 0.35));
        // near ridge
        const r2 = 0.68 + 0.045 * Math.sin(u * 5 + 0.4) + 0.02 * noise(u * 4, 2.2, 2);
        if (v > r2) c = mixc(c, [52, 66, 56], Math.min(1, (v - r2) * 16 + 0.3));
        // field
        if (v > 0.82) c = mixc(c, gradient([[0, [128, 116, 74]], [1, [96, 100, 62]]])(u), Math.min(1, (v - 0.82) * 8));
        break;
      }
      case 'animal': {
        // tan base
        c = [196 + 18 * noise(u * 5, v * 5, 2), 148 + 14 * noise(u * 5, v * 5, 2), 92 + 10 * noise(u * 5, v * 5, 2)];
        // stripes
        const stripe = Math.sin(u * 26 + 2.2 * noise(v * 4, u * 2, 2) + v * 4);
        if (stripe > 0.25 && v > 0.12 && v < 0.88) {
          c = mixc(c, [74, 48, 32], Math.min(1, (stripe - 0.25) * 2.2));
        }
        // belly
        const belly = radial(0.5, 0.95, 0.42, u, v);
        if (belly > 0) c = mixc(c, [226, 198, 160], belly * 0.8);
        break;
      }
      case 'darkphoto': {
        c = gradient([[0, [14, 16, 24]], [1, [26, 28, 40]]])(v + 0.1 * (noise(u * 3, v * 3, 2) - 0.5));
        const subject = radial(0.5, 0.46, 0.26, u, v);
        if (subject > 0) c = mixc(c, [64, 72, 92], subject * 0.9);
        const rim = radial(0.5, 0.46, 0.3, u, v) - radial(0.5, 0.46, 0.24, u, v);
        if (rim > 0) c = mixc(c, [120, 128, 150], Math.min(1, rim * 2.5));
        break;
      }
      case 'brightphoto': {
        c = [232 + 10 * noise(u * 4, v * 4, 2), 234 + 9 * noise(u * 4, v * 4, 2), 236 + 8 * noise(u * 4, v * 4, 2)];
        const b1 = radial(0.3, 0.35, 0.3, u, v);
        if (b1 > 0) c = mixc(c, [248, 214, 188], b1 * 0.8);
        const b2 = radial(0.72, 0.6, 0.26, u, v);
        if (b2 > 0) c = mixc(c, [206, 222, 238], b2 * 0.8);
        const b3 = radial(0.55, 0.8, 0.2, u, v);
        if (b3 > 0) c = mixc(c, [238, 232, 200], b3 * 0.7);
        break;
      }
      default:
        c = [128, 128, 128];
    }
    return [...c.map(clamp255), 255];
  });
  return img;
}

// --- Node rasterizer mirroring renderDotQR geometry -----------------------------
interface RasterOpts {
  shape: DotShape;
  dotSize: number;
  spacing: number;
  quietZone: number;
  px: number;
  safeDetail?: Img | null; // tone-safe detail for fragment dots
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

  // pass 1: structural squares (module-aligned, slight overlap like the browser)
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (!matrix.isFunctionModule(r, c)) continue;
    const dark = matrix.isDark(r, c);
    fillRect(img, ox + c * mp, oy + r * mp, mp + 0.6, mp + 0.6, dark ? [10, 10, 10] : [255, 255, 255]);
  }

  // pass 2: data dots
  for (const dot of plan.dots) {
    const cx = ox + (dot.col + 0.5) * mp;
    const cy = oy + (dot.row + 0.5) * mp;
    const col: [number, number, number] = [dot.color.r, dot.color.g, dot.color.b];
    if (opts.shape === 'pixel') {
      fillRect(img, cx - half, cy - half, d, d, col);
    } else if (opts.shape === 'fragment' && opts.safeDetail) {
      // module-aligned patch (mirrors the browser: module top-left + inset offset)
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
  // fragment band mirrors the engine: tighter caps/floors for textured patches
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
        if (Y > fCap) { const k = fCap / Math.max(Y, 1); r *= k; g *= k; b *= k; Y = fCap; }
        if (desaturateDark > 0) { r += (Y - r) * desaturateDark; g += (Y - g) * desaturateDark; b += (Y - b) * desaturateDark; }
      } else if (Y < fFloor) {
        // hue-safe lift: proportional until a channel would clip, residual toward white
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
  if (mx - mn < 12) return null; // achromatic
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

// deterministic shuffle (Fisher–Yates with mulberry-like LCG)
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

const DEFAULT_DOTS: DotOptions = { shape: 'circle', size: 0.8, spacing: 0.12, density: 1, colorIntensity: 1 };
const MODES: QualityPreset[] = ['photo', 'balanced', 'scan'];

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

console.log('\n== T3: decode matrix — artworks × modes × shapes × geometries ==');
{
  const arts: Record<string, Img> = { sunset: makeArt('sunset'), bright: makeArt('bright'), dark: makeArt('dark'), saturated: makeArt('saturated') };
  const details: Record<string, Img> = {};
  for (const [k, a] of Object.entries(arts)) details[k] = upscale(a, 1024);
  const url = 'https://dotra.app/gallery/nature/ember-ridge?ref=dotra';
  let total = 0, ok = 0;
  for (const [artName, art] of Object.entries(arts)) {
    for (const preset of MODES) {
      for (const shape of ['circle', 'rounded', 'pixel', 'fragment', 'soft'] as DotShape[]) {
        for (const [size, spacing] of [[0.8, 0.12], [1.0, 0], [0.6, 0.25]] as const) {
          total++;
          const dots: DotOptions = { ...DEFAULT_DOTS, shape, size, spacing };
          const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, preset, 0);
          let safeDetail: Img | null = null;
          if (shape === 'fragment') {
            const darkFlags: boolean[] = [];
            for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) darkFlags.push(matrix.isDark(r, c));
            safeDetail = buildSafeDetail(details[artName], matrix.size, darkFlags, PRESET_TONES[preset], dots.colorIntensity, 0);
          }
          const img = renderPlan(plan, matrix, { shape, dotSize: size, spacing, quietZone: 4, px: 540, safeDetail });
          const decoded = decode(img);
          if (decoded === url) { ok++; }
          else {
            console.log(`    fail: ${artName}/${preset}/${shape}/${size}/${spacing} -> ${decoded}`);
            savePNG(`/tmp/fail-${artName}-${preset}-${shape}-${size}-${spacing}.png`, img.w, img.h, img.data);
          }
        }
      }
    }
  }
  check(`decode matrix ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T4: URL × EC level × version bucket ==');
{
  const urls = ['https://dotra.app', 'https://dotra.app/gallery/nature/ember-ridge', 'https://dotra.app/s/xK9f2mQp?src=sample&ref=qr&utm=dotra'];
  const art = makeArt('sunset');
  let total = 0, ok = 0;
  for (const url of urls) {
    for (const ec of ['L', 'M', 'Q', 'H'] as ECLevel[]) {
      for (const target of ['auto', 'small', 'medium', 'large'] as TargetVersion[]) {
        total++;
        const dots: DotOptions = { ...DEFAULT_DOTS, shape: 'circle', size: 0.8, spacing: 0.12 };
        const { matrix, plan } = buildPlan(url, ec, target, art, dots, 'balanced', 0);
        const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: 0.8, spacing: 0.12, quietZone: 4, px: 640 });
        const decoded = decode(img);
        if (decoded === url) ok++;
        else console.log(`    fail: ${url.slice(0, 30)}…/${ec}/${target} -> ${decoded}`);
      }
    }
  }
  check(`URL×EC×version decode ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T5: density / color intensity / quiet zone variations ==');
{
  const art = makeArt('saturated');
  const url = 'https://dotra.app/gallery/abstract/mesh';
  const cases: Array<[string, Partial<DotOptions>, number]> = [
    ['density 0.3', { density: 0.3 }, 4],
    ['density 0.6', { density: 0.6 }, 4],
    ['colorIntensity 0', { colorIntensity: 0 }, 4],
    ['colorIntensity 0.5', { colorIntensity: 0.5 }, 4],
    ['quiet 2', {}, 2],
    ['quiet 8', {}, 8],
    ['density .5 + quiet 3', { density: 0.5 }, 3],
  ];
  for (const [label, dotPatch, quiet] of cases) {
    const dots: DotOptions = { ...DEFAULT_DOTS, ...dotPatch };
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, 'balanced', 0);
    const img = renderPlan(plan, matrix, { shape: dots.shape, dotSize: dots.size, spacing: dots.spacing, quietZone: quiet, px: 540 });
    check(label, decode(img) === url);
  }
}

console.log('\n== T6: repair escalation on adversarial cases ==');
{
  const art = makeArt('bright');
  const url = 'https://dotra.app/gallery/landscapes/aurora';
  const dots: DotOptions = { ...DEFAULT_DOTS, size: 0.6, spacing: 0.25, density: 0.7 };
  let escaped = false;
  for (let repair = 0; repair <= 3; repair++) {
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, 'photo', repair);
    const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: dots.size, spacing: dots.spacing, quietZone: 4, px: 540 });
    const decoded = decode(img);
    console.log(`  repair level ${repair}: ${decoded === url ? '✓ decodes' : '✗ fails'}`);
    if (decoded === url) { escaped = true; break; }
  }
  check('repair loop rescues hardest case (photo bands)', escaped);

  const dark = makeArt('dark');
  const { matrix, plan } = buildPlan(url, 'M', 'auto', dark, DEFAULT_DOTS, 'scan', 0);
  const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: 0.8, spacing: 0.12, quietZone: 4, px: 540 });
  check('dark artwork + scan mode decodes at level 0', decode(img) === url);
}

console.log('\n== T7: tone band invariants ==');
{
  const art = makeArt('sunset');
  const url = 'https://dotra.app';
  for (const preset of MODES) {
    const dots: DotOptions = { ...DEFAULT_DOTS, density: 1 };
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, preset, 0);
    const tones = PRESET_TONES[preset];
    let worstDark = -1, bestLight = 256, worstDarkLo = 256, worstLightHi = -1;
    for (const d of plan.dots) {
      const y = luminance(d.color);
      if (d.dark) { worstDark = Math.max(worstDark, y); worstDarkLo = Math.min(worstDarkLo, y); }
      else { bestLight = Math.min(bestLight, y); worstLightHi = Math.max(worstLightHi, y); }
    }
    check(`${preset}: dark dots within band [${tones.darkLo},${tones.darkCap}] (got ${worstDarkLo.toFixed(1)}..${worstDark.toFixed(1)})`,
      worstDark <= tones.darkCap + 0.5 && worstDarkLo >= tones.darkLo - 0.5);
    check(`${preset}: light dots within band [${tones.lightFloor},${tones.lightCap}] (got ${bestLight.toFixed(1)}..${worstLightHi.toFixed(1)})`,
      bestLight >= tones.lightFloor - 0.5 && worstLightHi <= tones.lightCap + 0.5);
    check(`${preset}: band separation >= 100 luma levels`, tones.lightFloor - tones.darkCap >= 100,
      `(gap ${tones.lightFloor - tones.darkCap})`);
    check(`${preset}: light floor >= 226 (jsQR binarization safety)`, tones.lightFloor >= 226);
  }
  // repair tones must be monotonically safer
  for (let i = 1; i < REPAIR_TONES.length; i++) {
    check(`repair ${i + 1} not looser than ${i}`,
      REPAIR_TONES[i].darkCap <= REPAIR_TONES[i - 1].darkCap && REPAIR_TONES[i].lightFloor >= REPAIR_TONES[i - 1].lightFloor);
  }
}

console.log('\n== T8: large matrix (v14) end-to-end with fragment dots ==');
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
  const img = renderPlan(plan, matrix, { shape: 'fragment', dotSize: 0.8, spacing: 0.12, quietZone: 4, px: 1080, safeDetail: safe });
  check('v14 fragment QR decodes', decode(img) === url, `(got ${decode(img)})`);
  savePNG('/tmp/test-large-fragment.png', img.w, img.h, img.data);

  // fragment band invariants on the tone-safe detail
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

console.log('\n== T9: photographic fidelity invariants (band mapping) ==');
{
  const art = makeArt('portrait');
  const url = 'https://dotra.app/gallery/portraits/bauhaus-face';
  const dots: DotOptions = { ...DEFAULT_DOTS, density: 1 };
  const { matrix, plan } = buildPlan(url, 'Q', 'large', art, dots, 'photo', 0);
  const N = matrix.size;
  const { colors } = sampleArt(art, N);

  // per-band luma correlation: band mapping is linear per band ⇒ r ≈ 1
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

  // spatial correspondence, band-wise: rendered luma must track the SAME
  // module's sample — not a within-band shuffled one (proves the photograph,
  // not an arbitrary gradient, drives the colours)
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

  // scan mode must still decode the same portrait
  const { matrix: m2, plan: p2 } = buildPlan(url, 'Q', 'large', art, dots, 'scan', 0);
  const img2 = renderPlan(p2, m2, { shape: 'circle', dotSize: 0.78, spacing: 0.13, quietZone: 4, px: 640 });
  check('portrait + scan mode decodes', decode(img2) === url);
  savePNG('/tmp/test-portrait-photo.png', img2.w, img2.h, img2.data);
}

console.log('\n== T10: six photo categories × three modes ==');
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
  const dots: DotOptions = { ...DEFAULT_DOTS, size: 0.78, spacing: 0.13, density: 1 };
  let total = 0, ok = 0;
  for (const [label, kind] of cats) {
    const art = makeArt(kind);
    for (const mode of MODES) {
      total++;
      const { matrix, plan } = buildPlan(url, 'M', 'large', art, dots, mode, 0);
      const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: dots.size, spacing: dots.spacing, quietZone: 4, px: 640 });
      const decoded = decode(img);
      // fidelity: per-band luma correlation
      const N = matrix.size;
      const { colors } = sampleArt(art, N);
      const dSrc: number[] = [], dOut: number[] = [], lSrc: number[] = [], lOut: number[] = [];
      for (const d of plan.dots) {
        const yS = luminance(colors[d.row * N + d.col]);
        const yO = luminance(d.color);
        if (d.dark) { dSrc.push(yS); dOut.push(yO); } else { lSrc.push(yS); lOut.push(yO); }
      }
      const rD = pearson(dSrc, dOut), rL = pearson(lSrc, lOut);
      const good = decoded === url && rD > 0.98 && rL > 0.98;
      if (good) ok++;
      else console.log(`    fail: ${label}/${mode} decode=${decoded === url} rDark=${rD.toFixed(3)} rLight=${rL.toFixed(3)}`);
      if (kind === 'portrait' && mode === 'photo') savePNG('/tmp/test-photo-portrait.png', img.w, img.h, img.data);
      if (kind === 'landscape' && mode === 'photo') savePNG('/tmp/test-photo-landscape.png', img.w, img.h, img.data);
    }
  }
  check(`photo categories decode + fidelity ${ok}/${total}`, ok === total, `(${ok}/${total})`);
}

console.log('\n== T11: animation timeline (photo → scatter → assemble) ==');
{
  // scatter envelope: starts assembled, peaks at 1, returns to 0, single-peaked
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
    const dots: DotOptions = { ...DEFAULT_DOTS, density: 1 };
    const { matrix, plan } = buildPlan(url, 'M', 'medium', art, dots, 'photo', 0);
    const N = matrix.size;
    const { colors } = sampleArt(art, N);
    const scene = createScene(plan, matrix, 720, 4, {
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
      if (!p) continue; // dropped light dot (density < 1) — none at density 1
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
    // final frame identity is guaranteed by u>=1 delegation to the static renderer (browser path)
  }
}

function countStructural(matrix: MatrixInfo): number {
  let n = 0;
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) if (matrix.isFunctionModule(r, c)) n++;
  return n;
}

console.log(`\n=========== ${passed} passed, ${failed} failed ===========`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  -', f);
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// DOTRA engine test harness (Node, no DOM).
//
// Mirrors the browser rendering path of dotRenderer.renderDotQR with a software
// rasterizer, then decodes the actual raster with jsQR — the same gate the app
// runs in the browser. A QR only passes if the REAL pixels decode to the URL.
// Fragment dots are tested against a tone-safe detail canvas that mirrors the
// engine's buildClampedDetail math.
//
// Run: npm run test:engine   (bundle-run.mjs compiles the TS on the fly)
// ---------------------------------------------------------------------------

import jsQR from 'jsqr';
import { encodeQR, buildFunctionModuleMask } from '../src/engine/qrGenerator';
import { buildDotPlanFromSamples, type DotPlan } from '../src/engine/dotRenderer';
import { PRESET_TONES } from '../src/utils/contrastOptimizer';
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
function buildSafeDetail(detail: Img, N: number, darkFlags: boolean[], tones: { darkCap: number; lightFloor: number }, colorIntensity: number, desaturateDark: number): Img {
  const out = makeImage(detail.w, detail.h);
  const dw = detail.w / N, dh = detail.h / N;
  // fragment band mirrors the engine: tighter caps/floors for textured patches
  const fCap = Math.min(tones.darkCap, 96);
  const fFloor = Math.max(tones.lightFloor + 8, 246);
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
        const t = (fFloor - Y) / Math.max(255 - Y, 0.5);
        r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
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

const DEFAULT_DOTS: DotOptions = { shape: 'circle', size: 0.8, spacing: 0.12, density: 1, colorIntensity: 1 };

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

console.log('\n== T3: decode matrix — artworks × presets × shapes × geometries ==');
{
  const arts: Record<string, Img> = { sunset: makeArt('sunset'), bright: makeArt('bright'), dark: makeArt('dark'), saturated: makeArt('saturated') };
  const details: Record<string, Img> = {};
  for (const [k, a] of Object.entries(arts)) details[k] = upscale(a, 1024);
  const url = 'https://dotra.app/gallery/nature/ember-ridge?ref=dotra';
  let total = 0, ok = 0;
  for (const [artName, art] of Object.entries(arts)) {
    for (const preset of ['resemblance', 'balanced', 'reliability'] as QualityPreset[]) {
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
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, 'resemblance', repair);
    const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: dots.size, spacing: dots.spacing, quietZone: 4, px: 540 });
    const decoded = decode(img);
    console.log(`  repair level ${repair}: ${decoded === url ? '✓ decodes' : '✗ fails'}`);
    if (decoded === url) { escaped = true; break; }
  }
  check('repair loop rescues hardest case', escaped);

  const dark = makeArt('dark');
  const { matrix, plan } = buildPlan(url, 'M', 'auto', dark, DEFAULT_DOTS, 'reliability', 0);
  const img = renderPlan(plan, matrix, { shape: 'circle', dotSize: 0.8, spacing: 0.12, quietZone: 4, px: 540 });
  check('dark artwork + reliability preset decodes at level 0', decode(img) === url);
}

console.log('\n== T7: tone safety invariants ==');
{
  const art = makeArt('sunset');
  const url = 'https://dotra.app';
  for (const preset of ['resemblance', 'balanced', 'reliability'] as QualityPreset[]) {
    const dots: DotOptions = { ...DEFAULT_DOTS, density: 1 };
    const { matrix, plan } = buildPlan(url, 'M', 'auto', art, dots, preset, 0);
    const tones = PRESET_TONES[preset];
    let worstDark = -1, worstLight = 256;
    for (const d of plan.dots) {
      const y = luminance(d.color);
      if (d.dark && y > worstDark) worstDark = y;
      if (!d.dark && y < worstLight) worstLight = y;
    }
    check(`${preset}: dark dots <= cap ${tones.darkCap} (worst ${worstDark.toFixed(1)})`, worstDark <= tones.darkCap + 0.5);
    check(`${preset}: light dots >= floor ${tones.lightFloor} (worst ${worstLight.toFixed(1)})`, worstLight >= tones.lightFloor - 0.5);
    check(`${preset}: light floor >= 215 (jsQR binarization safety)`, tones.lightFloor >= 215);
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
  const darkFlags: boolean[] = [];
  for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) darkFlags.push(matrix.isDark(r, c));
  const safe = buildSafeDetail(detail, matrix.size, darkFlags, PRESET_TONES.balanced, 1, 0);
  const img = renderPlan(plan, matrix, { shape: 'fragment', dotSize: 0.8, spacing: 0.12, quietZone: 4, px: 1080, safeDetail: safe });
  check('v14 fragment QR decodes', decode(img) === url, `(got ${decode(img)})`);
  savePNG('/tmp/test-large-fragment.png', img.w, img.h, img.data);
}

console.log(`\n=========== ${passed} passed, ${failed} failed ===========`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log('  -', f);
  process.exitCode = 1;
}

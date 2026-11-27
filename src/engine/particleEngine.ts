// ---------------------------------------------------------------------------
// DOTRA particle engine — photograph → QR assembly
//
// Timeline (u = 0..1):
//   [0.00 .. 0.16]  PHOTO      — particles sit on the module grid as filled
//                                squares carrying the RAW sampled photograph
//                                colours (the QR area reads as the photo).
//                                The smoothed source image crossfades underneath.
//   [0.10 .. 0.55]  BREAK      — per-particle staggered scatter: the photo
//                                tiles lift off and fly outward (preset-specific
//                                vectors: gather / flow / pulse / orbit / reveal).
//   [0.45 .. 0.92]  ASSEMBLE   — particles converge back onto their assigned
//                                QR module positions while their colour
//                                transitions from raw photo colour to the
//                                tone-banded QR colour. Structural modules
//                                (finders, timing, alignment, format, version)
//                                materialise into pure black/white last.
//   [0.92 .. 1.00]  SETTLE     — global scale/alpha settle.
//   u >= 1          — delegates to the static renderer → the final animation
//                     frame is pixel-identical to the verified downloadable QR.
//
// The engine is a pure function of (scene, time) so the live preview, the MP4
// frames and the GIF frames all share one code path.
// ---------------------------------------------------------------------------

import type { AnimationPreset, DotShape, EasingStyle, MatrixInfo, RGB } from './types';
import type { DotPlan } from './dotRenderer';
import { drawPerforationRing } from './dotRenderer';
import { colorBucket, cssRgb, clamp } from '@/utils/colorUtils';

export interface ParticleControls {
  preset: AnimationPreset;
  duration: number; // seconds (at speed = 1)
  speed: number; // 0.25 .. 3
  intensity: number; // 0 .. 1 — path deviation / spread
  startDistance: number; // 0 .. 1 — how far particles scatter
  easing: EasingStyle;
}

export interface Particle {
  tx: number; // module centre (px) — also the photo-formation position
  ty: number;
  r: number; // particle radius (px)
  color: RGB; // final tone-banded QR colour
  photoColor: RGB; // raw sampled photograph colour (photo phase)
  dark: boolean;
  structural: boolean; // function module → solid square, pure black/white at the end
  sx: number; // scattered position (apex of the break)
  sy: number;
  delay: number; // break start (normalised 0..1)
  dur: number; // break window (normalised)
  seed: number;
  bucket: number;
  orbitRadius: number;
  orbitAngle: number;
  orbitDir: number;
}

export interface ParticleScene {
  particles: Particle[];
  duration: number; // actual seconds after speed
  baseDuration: number;
  size: number; // canvas px
  modulePx: number;
  origin: number;
  dotDiameter: number;
  matrixSize: number;
  quietZone: number;
  preset: AnimationPreset;
  intensity: number;
}

// --- deterministic hash ------------------------------------------------------
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

// --- easing ------------------------------------------------------------------
export type EaseFn = (p: number) => number;

export const EASINGS: Record<EasingStyle, EaseFn> = {
  easeOut: (p) => 1 - Math.pow(1 - p, 3),
  easeInOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  spring: (p) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  },
  linear: (p) => p,
};

const smooth01 = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Scatter envelope: 0 (assembled / in photo formation) → 1 (fully scattered)
 * → 0 (assembled again). `d` = break start, `w` = break window.
 * Rise is ease-out (snap off), fall is ease-in-out (settle home).
 */
export function scatterEnvelope(u: number, d: number, w: number): number {
  if (u <= d || w <= 0) return 0;
  const t = (u - d) / w;
  if (t >= 1) return 0;
  if (t < 0.42) {
    const p = t / 0.42;
    return 1 - Math.pow(1 - p, 3);
  }
  const p = (t - 0.42) / 0.58;
  return 1 - (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
}

/**
 * Receipt preset — paper-feed geometry. The composition is printed on a paper
 * strip that emerges from a slot at the top of the frame: at u = 0 the whole
 * QR sits above the slot (nothing visible below it), at u = 1 it rests at its
 * final position. Returns the QR grid's top-edge y at time u.
 */
export function receiptTop(u: number, size: number, modulePx: number, matrixSize: number, quietZone: number): number {
  const origin = quietZone * modulePx;
  const gridH = matrixSize * modulePx;
  const slotY = size * 0.08;
  const f = smooth01(clamp(u / 0.82, 0, 1));
  return origin + (slotY - gridH - origin) * (1 - f);
}

/** Global photo→QR colour transition for data dots (u = 0..1). */
export function photoBlendT(u: number): number {
  return smooth01((u - 0.52) / 0.26);
}

/** Structural modules materialise into pure black/white near the end. */
export function structuralBlendT(u: number): number {
  return smooth01((u - 0.62) / 0.24);
}

/** Lerp two colours. */
function lerpColor(a: RGB, b: RGB, t: number): RGB {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const SPRITE_PAD = 2;

export interface SceneRenderOptions {
  shape: DotShape;
  fragmentSource?: HTMLCanvasElement | null;
}

interface SpriteEntry {
  canvas: HTMLCanvasElement;
  size: number;
}

const spriteCache = new Map<string, SpriteEntry>();

function getSprite(shape: 'circle' | 'rounded' | 'soft', d: number, color: RGB): SpriteEntry {
  const b = colorBucket(color);
  const key = `${shape}|${d}|${b}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const size = Math.ceil(d) + SPRITE_PAD * 2;
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
    if (ctx.roundRect) ctx.roundRect(SPRITE_PAD, SPRITE_PAD, d, d, d * 0.32);
    else ctx.rect(SPRITE_PAD, SPRITE_PAD, d, d);
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

  if (spriteCache.size > 2400) spriteCache.clear();
  const entry = { canvas: cv, size };
  spriteCache.set(key, entry);
  return entry;
}

/**
 * Build the particle scene for a finished dot plan. Every module that is
 * visible in the final render gets exactly one particle, carrying both its
 * raw photograph colour (photo phase) and its final tone-banded QR colour.
 */
export function createScene(
  plan: DotPlan,
  matrix: MatrixInfo,
  canvasSize: number,
  quietZone: number,
  controls: ParticleControls,
): ParticleScene {
  const N = plan.matrixSize;
  const total = N + quietZone * 2;
  const modulePx = canvasSize / total;
  const origin = quietZone * modulePx;
  const dotDiameter = modulePx * 0.92;
  const r = dotDiameter / 2;

  const cx = canvasSize / 2, cy = canvasSize / 2;
  const diag = Math.hypot(canvasSize, canvasSize);

  // Fast colour lookup for data dots.
  const planColors = new Map<number, RGB>();
  for (const dot of plan.dots) planColors.set(dot.row * N + dot.col, dot.color);
  const photoColors = plan.photoColors;

  const particles: Particle[] = [];
  let idx = 0;

  const push = (col: number, row: number, color: RGB, photoColor: RGB, dark: boolean, structural: boolean) => {
    const tx = origin + (col + 0.5) * modulePx;
    const ty = origin + (row + 0.5) * modulePx;
    const h1 = hash01(idx * 3 + 1);
    const h2 = hash01(idx * 3 + 2);
    const h3 = hash01(idx * 3 + 3);
    const distN = Math.hypot(tx - cx, ty - cy) / (diag / 2);

    let sx = tx, sy = ty;
    let delay = 0.08 + h3 * 0.16;
    let dur = 0.5 + h1 * 0.25;
    let orbitRadius = 0, orbitAngle = 0, orbitDir = 1;

    switch (controls.preset) {
      case 'gather': {
        const R = (0.25 + 0.75 * controls.startDistance) * (diag / 2) * (0.55 + 0.45 * h2);
        const a = h1 * Math.PI * 2;
        sx = cx + Math.cos(a) * R * (0.6 + 0.6 * h2);
        sy = cy + Math.sin(a) * R * (0.6 + 0.6 * h3);
        delay = 0.06 + h3 * 0.16;
        dur = 0.5 + h1 * 0.25;
        break;
      }
      case 'flow': {
        sx = -r * 2 - h2 * canvasSize * 0.35;
        sy = ty + (h1 - 0.5) * canvasSize * 0.85 * (0.35 + 0.65 * controls.intensity);
        delay = 0.05 + (tx / canvasSize) * 0.3 + h3 * 0.06;
        dur = 0.45 + h2 * 0.2;
        break;
      }
      case 'pulse': {
        sx = tx;
        sy = ty;
        delay = 0.04 + distN * 0.34 + h3 * 0.06;
        dur = 0.3 + h1 * 0.18;
        break;
      }
      case 'orbit': {
        orbitRadius =
          (0.25 + 0.75 * controls.startDistance) * canvasSize * 0.42 * (0.35 + 0.65 * h2);
        orbitAngle = h1 * Math.PI * 2;
        orbitDir = h3 > 0.5 ? 1 : -1;
        sx = tx + Math.cos(orbitAngle) * orbitRadius;
        sy = ty + Math.sin(orbitAngle) * orbitRadius;
        delay = 0.05 + h2 * 0.16;
        dur = 0.55 + h1 * 0.2;
        break;
      }
      case 'reveal': {
        sx = tx;
        sy = ty;
        delay = 0.03 + (row / N) * 0.34 + h3 * 0.06;
        dur = 0.32 + h1 * 0.16;
        break;
      }
      case 'receipt': {
        sx = tx;
        sy = ty;
        delay = 0.02 + (row / N) * 0.5 + h3 * 0.04;
        dur = 0.3 + h1 * 0.15;
        break;
      }
    }

    particles.push({
      tx, ty, r, color, photoColor, dark, structural,
      sx, sy, delay, dur,
      seed: h1 * 1000 + h2,
      bucket: colorBucket(color),
      orbitRadius, orbitAngle, orbitDir,
    });
    idx++;
  };

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const isFunc = matrix.isFunctionModule(row, col);
      const dark = matrix.isDark(row, col);
      const photo = photoColors?.[row * N + col] ?? { r: 128, g: 128, b: 128 };
      if (isFunc) {
        push(col, row, dark ? { r: 10, g: 10, b: 10 } : { r: 255, g: 255, b: 255 }, photo, dark, true);
      } else if (dark) {
        push(col, row, planColors.get(row * N + col) ?? { r: 20, g: 20, b: 20 }, photo, true, false);
      } else {
        const c = planColors.get(row * N + col);
        if (c) push(col, row, c, photo, false, false); // kept light dot
        // dropped light dots are background — no particle (final frame matches)
      }
    }
  }

  // Normalise so the last particle finishes its scatter-return by ~0.86.
  let maxEnd = 0;
  for (const p of particles) maxEnd = Math.max(maxEnd, p.delay + p.dur);
  if (maxEnd > 0.86) {
    const k = 0.86 / maxEnd;
    for (const p of particles) {
      p.delay *= k;
      p.dur *= k;
    }
  }

  return {
    particles,
    duration: controls.duration / Math.max(0.1, controls.speed),
    baseDuration: controls.duration,
    size: canvasSize,
    modulePx,
    origin,
    dotDiameter,
    matrixSize: N,
    quietZone,
    preset: controls.preset,
    intensity: controls.intensity,
  };
}

export interface SceneDrawOptions extends SceneRenderOptions {
  plan: DotPlan;
  matrix: MatrixInfo;
  quietZone: number;
  bgColor: string;
  transparent: boolean;
  dotSize: number;
  spacing: number;
  easing: EasingStyle;
  /** Smoothed source photograph, crossfaded under the opening photo phase. */
  photoSource?: HTMLCanvasElement | null;
  /** Decorative perforation ring (fades in with the settle). */
  perforationBorder?: boolean;
  renderStatic: (
    canvas: HTMLCanvasElement,
    plan: DotPlan,
    matrix: MatrixInfo,
    ropts: {
      quietZone: number;
      bgColor: string;
      transparent: boolean;
      shape: DotShape;
      dotSize: number;
      spacing: number;
      fragmentSource?: HTMLCanvasElement | null;
      photoUnderlay?: HTMLCanvasElement | null;
      perforationBorder?: boolean;
    },
  ) => void;
  staticCanvas: HTMLCanvasElement;
  renderOpts: {
    quietZone: number;
    bgColor: string;
    transparent: boolean;
    shape: DotShape;
    dotSize: number;
    spacing: number;
    fragmentSource?: HTMLCanvasElement | null;
    photoUnderlay?: HTMLCanvasElement | null;
    perforationBorder?: boolean;
  };
}

/**
 * Render the scene at normalised timeline time u (0..1).
 * u >= 1 delegates to the static renderer → pixel-identical final frame.
 */
export function drawSceneFrame(ctx: CanvasRenderingContext2D, scene: ParticleScene, u: number, o: SceneDrawOptions): void {
  const { size, modulePx, particles, preset, intensity } = scene;

  if (o.transparent) ctx.clearRect(0, 0, size, size);
  else {
    ctx.fillStyle = o.bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  // Final state → exact static render (guarantees a PNG-identical frame).
  if (u >= 1) {
    ctx.clearRect(0, 0, size, size);
    o.renderStatic(o.staticCanvas, o.plan, o.matrix, o.renderOpts);
    ctx.drawImage(o.staticCanvas, 0, 0, size, size);
    return;
  }

  // Receipt preset: the whole composition is paper emerging from a slot at the
  // top — translate it down as it feeds out, clip everything still "inside the
  // printer", and draw the slot bar (faded out before u = 1 so the final
  // frame stays pixel-clean).
  const receipt = preset === 'receipt';
  const slotY = receipt ? size * 0.08 : 0;
  if (receipt) {
    const top = receiptTop(u, size, modulePx, scene.matrixSize, scene.quietZone);
    ctx.save();
    ctx.translate(0, top - scene.origin);
    ctx.beginPath();
    ctx.rect(0, slotY, size, size - slotY);
    ctx.clip();
  }

  const ease = EASINGS[o.easing];
  const finish = u > 0.9;
  const f = finish ? (u - 0.9) / 0.1 : 1;
  const globalScale = finish ? 0.965 + 0.035 * f : 1;
  const globalAlpha = finish ? 0.9 + 0.1 * f : 1;

  const shape = o.shape;
  const fragmentSource = o.fragmentSource;
  const N = scene.matrixSize;

  // -- photograph underlay: fades out as the photo tiles lift off, fades back
  // in while the particles converge, so the assembled modules land on the photo
  if (o.photoSource) {
    let a = 0;
    if (u < 0.2) a = 1 - smooth01((u - 0.02) / 0.13); // opening photo phase
    else a = smooth01((u - 0.55) / 0.3); // return beneath the assembling modules
    if (a > 0.001) {
      ctx.globalAlpha = a;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(o.photoSource, scene.origin, scene.origin, N * modulePx, N * modulePx);
      ctx.globalAlpha = 1;
    }
  }

  const blend = photoBlendT(u);
  const structBlend = structuralBlendT(u);
  const photoFadeIn = smooth01((u - 0.01) / 0.1); // squares materialise as the photo underlay fades

  // -- per-particle state ------------------------------------------------------
  // squarePhase: particle renders as a filled module square (photo formation
  // + the first instants of the break), then becomes a dot. Structural
  // modules stay module-sized squares for the entire timeline — they end as
  // the crisp pure black/white squares of the static renderer.
  interface RenderItem { p: Particle; x: number; y: number; color: RGB; scale: number; alpha: number; square: boolean }
  const items: RenderItem[] = new Array(particles.length);
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const s = scatterEnvelope(u, p.delay, p.dur);
    const x = p.tx + (p.sx - p.tx) * s;
    const y = p.ty + (p.sy - p.ty) * s;

    const color = p.structural
      ? lerpColor(p.photoColor, p.dark ? STRUCT_BLACK : STRUCT_WHITE, structBlend)
      : lerpColor(p.photoColor, p.color, blend);

    const ret = s > 0 ? 1 - s : 1; // 0 scattered → 1 assembled
    const er = ease(clamp(ret, 0, 1)); // user easing shapes the settle
    let scale: number;
    if (p.structural) scale = 1;
    else if (preset === 'pulse' || preset === 'reveal') {
      const c1 = 1.70158, c3 = c1 + 1;
      scale = 0.6 + 0.4 * (1 + c3 * Math.pow(er - 1, 3) + c1 * Math.pow(er - 1, 2));
    } else {
      scale = 0.8 + 0.2 * er;
    }
    if (preset === 'pulse' && !p.structural) scale *= 1 + 0.3 * s; // breathing while scattered

    const squarePhase = p.structural || u < p.delay + 0.3 * p.dur;
    items[i] = { p, x, y, color, scale, alpha: globalAlpha, square: squarePhase };
  }

  // -- pass 1: module squares (photo formation / early break) ------------------
  const squares = new Map<number, RenderItem[]>();
  for (const it of items) {
    if (!it.square) continue;
    const key = it.p.structural ? (it.p.dark ? -1 : -2) : colorBucket(it.color);
    const arr = squares.get(key);
    if (arr) arr.push(it);
    else squares.set(key, [it]);
  }
  for (const arr of squares.values()) {
    ctx.fillStyle = cssRgb(arr[0].color);
    ctx.globalAlpha = arr[0].alpha * photoFadeIn;
    for (const it of arr) {
      const m = modulePx * 1.02 * it.scale * globalScale;
      ctx.fillRect(it.x - m / 2, it.y - m / 2, m, m);
    }
  }

  // -- pass 2: dots -------------------------------------------------------------
  const byBucket = new Map<number, RenderItem[]>();
  for (const it of items) {
    if (it.square) continue;
    const key = it.p.structural ? (it.p.dark ? -1 : -2) : colorBucket(it.color);
    const arr = byBucket.get(key);
    if (arr) arr.push(it);
    else byBucket.set(key, [it]);
  }

  for (const arr of byBucket.values()) {
    const first = arr[0];
    if (!first.p.structural && shape !== 'pixel' && shape !== 'fragment') {
      const sprite = getSprite(shape === 'soft' ? 'soft' : shape === 'rounded' ? 'rounded' : 'circle', Math.max(2, first.p.r * 2), first.color);
      for (const it of arr) {
        const d = it.p.r * 2 * it.scale * globalScale;
        const sp = sprite.size * (d / (it.p.r * 2));
        ctx.globalAlpha = it.alpha;
        ctx.drawImage(sprite.canvas, it.x - sp / 2, it.y - sp / 2, sp, sp);
      }
    } else {
      for (const it of arr) {
        ctx.globalAlpha = it.alpha;

        if (it.p.structural) {
          const m = modulePx * it.scale * globalScale;
          ctx.fillStyle = it.p.dark ? '#0a0a0a' : '#ffffff';
          ctx.fillRect(it.x - m / 2, it.y - m / 2, m, m);
          continue;
        }

        const d = it.p.r * 2 * it.scale * globalScale;
        if (shape === 'pixel') {
          ctx.fillStyle = cssRgb(it.color);
          ctx.fillRect(it.x - d / 2, it.y - d / 2, d, d);
          continue;
        }
        if (shape === 'fragment' && fragmentSource) {
          const dw = fragmentSource.width / N;
          const dh = fragmentSource.height / N;
          const inset = 0.4;
          const col = (it.p.tx - scene.origin) / modulePx - 0.5;
          const row = (it.p.ty - scene.origin) / modulePx - 0.5;
          ctx.save();
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(it.x - d / 2, it.y - d / 2, d, d, d * 0.28);
          else ctx.rect(it.x - d / 2, it.y - d / 2, d, d);
          ctx.clip();
          ctx.drawImage(
            fragmentSource,
            col * dw + inset, row * dh + inset, dw - inset * 2, dh - inset * 2,
            it.x - d / 2, it.y - d / 2, d, d,
          );
          ctx.restore();
          continue;
        }
        // soft / circle / rounded — direct arc (covers sprite-miss edge cases)
        ctx.fillStyle = cssRgb(it.color);
        ctx.beginPath();
        ctx.arc(it.x, it.y, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // -- perforation ring materialises with the final settle --------------------
  if (o.perforationBorder && scene.quietZone >= 3 && u > 0.88) {
    ctx.globalAlpha = smooth01((u - 0.88) / 0.08);
    drawPerforationRing(ctx, N, scene.quietZone, modulePx, scene.origin);
    ctx.globalAlpha = 1;
  }

  if (receipt) {
    ctx.restore();
    // printer slot bar — gone by u = 1 so the final frame stays pixel-clean
    const barA = u > 0.84 ? 1 - smooth01((u - 0.84) / 0.14) : 1;
    if (barA > 0.001) {
      const bw = size * 0.34;
      const bh = Math.max(3, size * 0.008);
      ctx.globalAlpha = barA;
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(size / 2 - bw / 2, slotY - bh / 2, bw, bh, bh / 2);
      else ctx.rect(size / 2 - bw / 2, slotY - bh / 2, bw, bh);
      ctx.fill();
      ctx.globalAlpha = barA * 0.16;
      ctx.fillRect(size / 2 - bw / 2, slotY + bh / 2, bw, size * 0.012);
    }
  }

  ctx.globalAlpha = 1;
}

const STRUCT_BLACK: RGB = { r: 10, g: 10, b: 10 };
const STRUCT_WHITE: RGB = { r: 255, g: 255, b: 255 };

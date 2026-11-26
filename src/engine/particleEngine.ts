// ---------------------------------------------------------------------------
// DOTRA particle engine
//
// The signature DOTRA experience: thousands of coloured dots fly across the
// canvas and assemble into the final image-based QR code. The engine is a pure
// function of (scene, time) so the exact same code path renders the live
// preview, the MP4 frames and the GIF frames — and the u = 1 state delegates
// to the static renderer, guaranteeing the final frame is identical to the
// verified PNG.
// ---------------------------------------------------------------------------

import type { AnimationPreset, DotShape, EasingStyle, MatrixInfo, RGB } from './types';
import type { DotPlan } from './dotRenderer';
import { colorBucket, cssRgb, clamp } from '@/utils/colorUtils';

export interface ParticleControls {
  preset: AnimationPreset;
  duration: number; // seconds (at speed = 1)
  speed: number; // 0.25 .. 3
  intensity: number; // 0 .. 1 — path deviation / spread
  startDistance: number; // 0 .. 1 — how far particles start
  easing: EasingStyle;
}

export interface Particle {
  tx: number; // target centre (px)
  ty: number;
  r: number; // particle radius (px)
  color: RGB;
  dark: boolean;
  structural: boolean; // function module → solid square, pure black/white
  sx: number; // start position
  sy: number;
  delay: number; // normalised 0..1 of timeline
  dur: number; // normalised flight duration
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
 * visible in the final render gets exactly one particle.
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

  const particles: Particle[] = [];
  let idx = 0;

  const push = (col: number, row: number, color: RGB, dark: boolean, structural: boolean) => {
    const tx = origin + (col + 0.5) * modulePx;
    const ty = origin + (row + 0.5) * modulePx;
    const h1 = hash01(idx * 3 + 1);
    const h2 = hash01(idx * 3 + 2);
    const h3 = hash01(idx * 3 + 3);
    const distN = Math.hypot(tx - cx, ty - cy) / (diag / 2);

    let sx = tx, sy = ty;
    let delay = 0.05 + h3 * 0.25;
    let dur = 0.5 + h1 * 0.25;
    let orbitRadius = 0, orbitAngle = 0, orbitDir = 1;

    switch (controls.preset) {
      case 'gather': {
        const R = (0.25 + 0.75 * controls.startDistance) * (diag / 2) * (0.55 + 0.45 * h2);
        const a = h1 * Math.PI * 2;
        sx = cx + Math.cos(a) * R * (0.6 + 0.6 * h2);
        sy = cy + Math.sin(a) * R * (0.6 + 0.6 * h3);
        delay = 0.08 + h3 * 0.3;
        dur = 0.5 + h1 * 0.25;
        break;
      }
      case 'flow': {
        sx = -r * 2 - h2 * canvasSize * 0.35;
        sy = ty + (h1 - 0.5) * canvasSize * 0.85 * (0.35 + 0.65 * controls.intensity);
        delay = 0.05 + (tx / canvasSize) * 0.38 + h3 * 0.08;
        dur = 0.42 + h2 * 0.2;
        break;
      }
      case 'pulse': {
        sx = tx;
        sy = ty;
        delay = 0.04 + distN * 0.62 + h3 * 0.06;
        dur = 0.2 + h1 * 0.12;
        break;
      }
      case 'orbit': {
        orbitRadius =
          (0.25 + 0.75 * controls.startDistance) * canvasSize * 0.42 * (0.35 + 0.65 * h2);
        orbitAngle = h1 * Math.PI * 2;
        orbitDir = h3 > 0.5 ? 1 : -1;
        sx = tx + Math.cos(orbitAngle) * orbitRadius;
        sy = ty + Math.sin(orbitAngle) * orbitRadius;
        delay = 0.05 + h2 * 0.2;
        dur = 0.55 + h1 * 0.25;
        break;
      }
      case 'reveal': {
        sx = tx;
        sy = ty;
        delay = 0.03 + (row / N) * 0.55 + h3 * 0.08;
        dur = 0.18 + h1 * 0.12;
        break;
      }
    }

    particles.push({
      tx, ty, r, color, dark, structural,
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
      if (isFunc) {
        push(col, row, dark ? { r: 10, g: 10, b: 10 } : { r: 255, g: 255, b: 255 }, dark, true);
      } else if (dark) {
        push(col, row, planColors.get(row * N + col) ?? { r: 20, g: 20, b: 20 }, true, false);
      } else {
        const c = planColors.get(row * N + col);
        if (c) push(col, row, c, false, false); // kept light dot
        // dropped light dots are background — no particle (final frame matches)
      }
    }
  }

  // Normalise so the last particle lands at ~0.92 of the timeline.
  let maxEnd = 0;
  for (const p of particles) maxEnd = Math.max(maxEnd, p.delay + p.dur);
  if (maxEnd > 0.92) {
    const k = 0.92 / maxEnd;
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

/**
 * Render the scene at normalised timeline time u (0..1).
 * u >= 1 delegates to the static renderer → pixel-identical final frame.
 */
export function drawSceneFrame(
  ctx: CanvasRenderingContext2D,
  scene: ParticleScene,
  u: number,
  o: SceneRenderOptions & {
    plan: DotPlan;
    matrix: MatrixInfo;
    quietZone: number;
    bgColor: string;
    transparent: boolean;
    dotSize: number;
    spacing: number;
    easing: EasingStyle;
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
    };
  },
): void {
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

  const ease = EASINGS[o.easing];
  const finish = u > 0.9;
  const f = finish ? (u - 0.9) / 0.1 : 1;
  const globalScale = finish ? 0.965 + 0.035 * f : 1;
  const globalAlpha = finish ? 0.9 + 0.1 * f : 1;

  const shape = o.shape;
  const fragmentSource = o.fragmentSource;
  const N = scene.matrixSize;

  // Batch by bucket to minimise state switches.
  const byBucket = new Map<number, Particle[]>();
  for (const p of particles) {
    const key = p.structural ? (p.dark ? -1 : -2) : p.bucket;
    const arr = byBucket.get(key);
    if (arr) arr.push(p);
    else byBucket.set(key, [p]);
  }

  for (const arr of byBucket.values()) {
    const first = arr[0];
    if (!first.structural && shape !== 'pixel' && shape !== 'fragment') {
      const sprite = getSprite(shape === 'soft' ? 'soft' : shape === 'rounded' ? 'rounded' : 'circle', Math.max(2, first.r * 2), first.color);
      for (const p of arr) {
        const e = ease(clamp((u - p.delay) / p.dur, 0, 1));
        if (e <= 0) continue;
        const pos = particlePosition(p, e, preset, intensity, scene);
        const scale = particleScale(p, e, preset) * globalScale;
        const alpha = particleAlpha(p, e, preset) * globalAlpha;
        if (alpha < 0.01) continue;
        ctx.globalAlpha = alpha;
        const d = p.r * 2 * scale;
        const s = sprite.size * (d / (p.r * 2));
        ctx.drawImage(sprite.canvas, pos.x - s / 2, pos.y - s / 2, s, s);
      }
    } else {
      for (const p of arr) {
        const e = ease(clamp((u - p.delay) / p.dur, 0, 1));
        if (e <= 0) continue;
        const pos = particlePosition(p, e, preset, intensity, scene);
        const scale = particleScale(p, e, preset) * globalScale;
        const alpha = particleAlpha(p, e, preset) * globalAlpha;
        if (alpha < 0.01) continue;
        ctx.globalAlpha = alpha;

        if (p.structural) {
          const s = modulePx * scale;
          ctx.fillStyle = p.dark ? '#0a0a0a' : '#ffffff';
          ctx.fillRect(pos.x - s / 2, pos.y - s / 2, s, s);
          continue;
        }

        const d = p.r * 2 * scale;
        if (shape === 'pixel') {
          ctx.fillStyle = cssRgb(p.color);
          ctx.fillRect(pos.x - d / 2, pos.y - d / 2, d, d);
          continue;
        }
        if (shape === 'fragment' && fragmentSource) {
          const dw = fragmentSource.width / N;
          const dh = fragmentSource.height / N;
          const inset = 0.4;
          const col = (p.tx - scene.origin) / modulePx - 0.5;
          const row = (p.ty - scene.origin) / modulePx - 0.5;
          ctx.save();
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(pos.x - d / 2, pos.y - d / 2, d, d, d * 0.28);
          else ctx.rect(pos.x - d / 2, pos.y - d / 2, d, d);
          ctx.clip();
          ctx.drawImage(
            fragmentSource,
            col * dw + inset, row * dh + inset, dw - inset * 2, dh - inset * 2,
            pos.x - d / 2, pos.y - d / 2, d, d,
          );
          ctx.restore();
          continue;
        }
        // soft / circle / rounded without sprite (shouldn't happen, but safe)
        ctx.fillStyle = cssRgb(p.color);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  ctx.globalAlpha = 1;
}

// --- per-preset kinematics -----------------------------------------------------

function particlePosition(
  p: Particle,
  e: number,
  preset: AnimationPreset,
  intensity: number,
  scene: ParticleScene,
): { x: number; y: number } {
  switch (preset) {
    case 'pulse':
    case 'reveal':
      return { x: p.tx, y: p.ty };
    case 'orbit': {
      const remaining = 1 - e;
      const ang = p.orbitAngle + p.orbitDir * remaining * Math.PI * 2.2;
      const rad = p.orbitRadius * remaining;
      return { x: p.tx + Math.cos(ang) * rad, y: p.ty + Math.sin(ang) * rad };
    }
    case 'flow': {
      const x = p.sx + (p.tx - p.sx) * e;
      const wob = Math.sin(e * Math.PI * 2 + p.seed) * 10 * intensity * (1 - e);
      const y = p.sy + (p.ty - p.sy) * e + wob;
      return { x, y };
    }
    default: {
      // gather — straight flight + perpendicular wobble
      const px = p.tx - p.sx, py = p.ty - p.sy;
      const len = Math.hypot(px, py) || 1;
      const wob = Math.sin(e * Math.PI + p.seed) * 14 * intensity * (1 - e);
      return {
        x: p.sx + px * e + (-py / len) * wob,
        y: p.sy + py * e + (px / len) * wob,
      };
    }
  }
}

function particleScale(p: Particle, e: number, preset: AnimationPreset): number {
  if (p.structural) return 1;
  if (preset === 'pulse' || preset === 'reveal') {
    // easeOutBack for a satisfying pop-in
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(e - 1, 3) + c1 * Math.pow(e - 1, 2);
  }
  if (preset === 'flow' || preset === 'gather') return 0.8 + 0.2 * e;
  return 1;
}

function particleAlpha(p: Particle, e: number, preset: AnimationPreset): number {
  if (p.structural) return e;
  if (preset === 'flow') return 1;
  return e;
}

// ---------------------------------------------------------------------------
// DOTRA animation frame source — shared by the MP4 and GIF exporters so both
// render byte-identical frames from the particle engine.
// ---------------------------------------------------------------------------

import type { DotShape, EasingStyle, MatrixInfo } from './types';
import type { DotPlan } from './dotRenderer';
import type { ParticleScene } from './particleEngine';
import { drawSceneFrame } from './particleEngine';
import { renderDotQR, type RenderOptions } from './dotRenderer';

export interface FrameSource {
  scene: ParticleScene;
  plan: DotPlan;
  matrix: MatrixInfo;
  shape: DotShape;
  easing: EasingStyle;
  quietZone: number;
  bgColor: string;
  transparent: boolean;
  dotSize: number;
  spacing: number;
  fragmentSource: HTMLCanvasElement | null;
  /** Smoothed source photograph for the opening photo phase of the animation. */
  photoSource?: HTMLCanvasElement | null;
  /** Decorative perforation ring on the white frame. */
  perforationBorder?: boolean;
  fps: number;
  holdSeconds: number;
}

export function animationFrameCount(src: FrameSource): number {
  const animFrames = Math.max(1, Math.round(src.scene.duration * src.fps));
  const holdFrames = Math.max(1, Math.round(src.holdSeconds * src.fps));
  return animFrames + holdFrames;
}

/** Render frame `i` (0-based) onto a canvas sized to the scene. */
export function renderAnimationFrame(canvas: HTMLCanvasElement, src: FrameSource, i: number): void {
  const ctx = canvas.getContext('2d')!;
  const animFrames = Math.max(1, Math.round(src.scene.duration * src.fps));
  const u = Math.min(1, i / animFrames);

  const drawOpts = {
    shape: src.shape,
    fragmentSource: src.fragmentSource,
    photoSource: src.photoSource ?? null,
    perforationBorder: src.perforationBorder ?? false,
    plan: src.plan,
    matrix: src.matrix,
    quietZone: src.quietZone,
    bgColor: src.bgColor,
    transparent: src.transparent,
    dotSize: src.dotSize,
    spacing: src.spacing,
    easing: src.easing,
    renderStatic: renderDotQR,
    staticCanvas: document.createElement('canvas'),
    renderOpts: {
      quietZone: src.quietZone,
      bgColor: src.bgColor,
      transparent: src.transparent,
      shape: src.shape,
      dotSize: src.dotSize,
      spacing: src.spacing,
      fragmentSource: src.fragmentSource,
      photoUnderlay: src.photoSource ?? null,
      perforationBorder: src.perforationBorder ?? false,
    } as RenderOptions,
  };
  drawOpts.staticCanvas.width = canvas.width;
  drawOpts.staticCanvas.height = canvas.height;

  drawSceneFrame(ctx, src.scene, u, drawOpts);
}

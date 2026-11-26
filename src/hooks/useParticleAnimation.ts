// ---------------------------------------------------------------------------
// DOTRA — drives a ParticleScene onto a canvas with requestAnimationFrame.
// u >= 1 delegates to the static renderer (pixel-identical final frame).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useCallback } from 'react';
import type { ParticleScene, ParticleControls } from '@/engine/particleEngine';
import { drawSceneFrame } from '@/engine/particleEngine';
import type { MatrixInfo, DotShape, EasingStyle } from '@/engine/types';
import type { DotPlan } from '@/engine/dotRenderer';
import { renderDotQR, type RenderOptions } from '@/engine/dotRenderer';

export interface AnimationDriverArgs {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Current scene; null pauses rendering. */
  scene: ParticleScene | null;
  plan: DotPlan | null;
  matrix: MatrixInfo | null;
  renderOpts: Omit<RenderOptions, 'fragmentSource'> & { fragmentSource?: HTMLCanvasElement | null };
  /** Smoothed source photograph for the opening photo phase. */
  photoSource?: HTMLCanvasElement | null;
  easing: EasingStyle;
  playing: boolean;
  /** Bump to restart the timeline from 0. */
  replayKey: number;
  loop?: boolean;
}

export function useParticleAnimation(args: AnimationDriverArgs) {
  const { canvasRef, scene, plan, matrix, renderOpts, easing, playing, replayKey, loop = false } = args;
  const stateRef = useRef(args);
  stateRef.current = args;

  const rafRef = useRef(0);
  const startRef = useRef(0);
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawStatic = useCallback((ctx: CanvasRenderingContext2D, size: number) => {
    const s = stateRef.current;
    if (!s.plan || !s.matrix) return;
    if (!staticCanvasRef.current) staticCanvasRef.current = document.createElement('canvas');
    const sc = staticCanvasRef.current;
    if (sc.width !== size) { sc.width = size; sc.height = size; }
    renderDotQR(sc, s.plan, s.matrix, {
      quietZone: s.renderOpts.quietZone,
      bgColor: s.renderOpts.bgColor,
      transparent: s.renderOpts.transparent,
      shape: s.renderOpts.shape,
      dotSize: s.renderOpts.dotSize,
      spacing: s.renderOpts.spacing,
      fragmentSource: s.renderOpts.fragmentSource ?? null,
    });
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(sc, 0, 0, size, size);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // No scene yet → draw the verified static frame if we have a plan.
    if (!scene || !playing) {
      if (!scene && plan && matrix) drawStatic(ctx, canvas.width);
      return;
    }

    // Build the draw options once per run — they change only when the pipeline
    // rebuilds the scene (which is exactly when this effect re-runs).
    const drawOpts = makeDrawOpts({
      canvasRef, scene, plan, matrix, renderOpts, easing, playing, replayKey, loop,
    });

    let running = true;
    startRef.current = performance.now();

    const tick = (now: number) => {
      if (!running) return;
      const s = stateRef.current;
      if (!s.scene) { running = false; return; }
      const elapsed = (now - startRef.current) / 1000;
      const u = elapsed / Math.max(0.001, s.scene.duration);

      if (u >= 1) {
        if (loop) {
          startRef.current = now;
          drawSceneFrame(ctx, s.scene, 0.0001, drawOpts);
        } else {
          drawStatic(ctx, canvas.width);
          running = false;
        }
        return;
      }
      drawSceneFrame(ctx, s.scene, u, drawOpts);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, playing, replayKey, loop, plan, matrix, drawStatic, renderOpts, easing]);

  return { drawStatic };
}

function makeDrawOpts(s: AnimationDriverArgs) {
  return {
    shape: s.renderOpts.shape,
    fragmentSource: s.renderOpts.fragmentSource ?? null,
    photoSource: s.photoSource ?? null,
    plan: s.plan!,
    matrix: s.matrix!,
    quietZone: s.renderOpts.quietZone,
    bgColor: s.renderOpts.bgColor,
    transparent: s.renderOpts.transparent,
    dotSize: s.renderOpts.dotSize,
    spacing: s.renderOpts.spacing,
    easing: s.easing,
    renderStatic: renderDotQR,
    staticCanvas: document.createElement('canvas'),
    renderOpts: {
      quietZone: s.renderOpts.quietZone,
      bgColor: s.renderOpts.bgColor,
      transparent: s.renderOpts.transparent,
      shape: s.renderOpts.shape,
      dotSize: s.renderOpts.dotSize,
      spacing: s.renderOpts.spacing,
      fragmentSource: s.renderOpts.fragmentSource ?? null,
    },
  };
}

export type { ParticleControls };

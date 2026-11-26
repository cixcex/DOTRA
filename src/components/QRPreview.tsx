import { useRef } from 'react';
import { RotateCw, Pause, Play } from 'lucide-react';
import type { MatrixInfo, DotShape, EasingStyle } from '@/engine/types';
import type { DotPlan } from '@/engine/dotRenderer';
import type { ParticleScene } from '@/engine/particleEngine';
import { useParticleAnimation } from '@/hooks/useParticleAnimation';
import { PREVIEW_PX } from '@/hooks/useQRGenerator';

export interface PreviewRenderOpts {
  quietZone: number;
  bgColor: string;
  transparent: boolean;
  shape: DotShape;
  dotSize: number;
  spacing: number;
  fragmentSource: HTMLCanvasElement | null;
  /** Photograph composited beneath the module grid (identical in exports). */
  photoUnderlay?: HTMLCanvasElement | null;
  /** Decorative perforation ring on the white frame. */
  perforationBorder?: boolean;
}

export function QRPreview({
  scene, plan, matrix, renderOpts, easing, playing, onTogglePlaying, replayKey, onReplay,
  empty, phase, photoSource,
}: {
  scene: ParticleScene | null;
  plan: DotPlan | null;
  matrix: MatrixInfo | null;
  renderOpts: PreviewRenderOpts;
  easing: EasingStyle;
  playing: boolean;
  onTogglePlaying: () => void;
  replayKey: number;
  onReplay: () => void;
  empty: boolean;
  phase: string;
  photoSource?: HTMLCanvasElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useParticleAnimation({
    canvasRef,
    scene,
    plan,
    matrix,
    renderOpts,
    photoSource,
    easing,
    playing: playing && !empty,
    replayKey,
    loop: false,
  });

  return (
    <div className="relative">
      <div
        className={`relative rounded-xl overflow-hidden border border-line ${renderOpts.transparent ? 'checkerboard' : 'bg-white'}`}
        style={{ aspectRatio: '1/1' }}
      >
        <canvas
          ref={canvasRef}
          width={PREVIEW_PX}
          height={PREVIEW_PX}
          className="absolute inset-0 w-full h-full"
          aria-label="QR code preview"
        />
        {empty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 bg-white">
            <div className="w-10 h-10 rounded-full border border-line flex items-center justify-center mb-3">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-300" />
              </div>
            </div>
            <p className="text-sm font-medium text-ink">Your QR code will appear here</p>
            <p className="text-xs text-mute mt-1 leading-relaxed">
              Add a link and an image — DOTRA assembles the dots and verifies the result.
            </p>
          </div>
        )}
      </div>

      {/* floating controls */}
      {!empty && (
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onTogglePlaying}
            aria-label={playing ? 'Pause animation' : 'Play animation'}
            className="w-8 h-8 rounded-full bg-white/90 backdrop-blur border border-line shadow-card flex items-center justify-center text-ink hover:shadow-lift transition-shadow"
          >
            {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
          </button>
          <button
            type="button"
            onClick={onReplay}
            aria-label="Replay assembly animation"
            title="Replay assembly"
            className="w-8 h-8 rounded-full bg-white/90 backdrop-blur border border-line shadow-card flex items-center justify-center text-ink hover:shadow-lift transition-shadow"
          >
            <RotateCw size={14} />
          </button>
        </div>
      )}

      {!empty && matrix && (
        <div className="absolute left-3 bottom-3 rounded-full bg-ink/85 text-paper/90 backdrop-blur px-2.5 py-1 text-[10px] font-medium tracking-wide">
          v{matrix.version} · {matrix.size}×{matrix.size} modules · {plan?.dots.length.toLocaleString()} coloured dots
        </div>
      )}
      {phase === 'verifying' && (
        <div className="absolute left-3 top-3 rounded-full bg-white/90 backdrop-blur border border-line px-2.5 py-1 text-[10px] font-medium text-mute">
          verifying with jsQR…
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DOTRA — generation orchestrator.
//
// Pipeline: URL → QR matrix → processed image → dot plan → static render →
// particle scene → jsQR verification of the ACTUAL rendered pixels →
// automatic repair escalation (tones → geometry → desaturate → EC boost).
//
// Non-negotiables honoured here:
//   * the encoded URL never changes during optimization
//   * downloads only unlock after the real rendered image decodes correctly
//   * every export resolution is verified independently
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CropTransform, ImageAdjustments, DotOptions, QROptions, QualityPreset,
  MatrixInfo, ECLevel, GenerationPhase, VerificationStatus,
} from '@/engine/types';
import { encodeQR } from '@/engine/qrGenerator';
import { processImage, type ProcessedImage } from '@/engine/imageProcessor';
import { buildDotPlan, renderPlanToCanvas, type DotPlan, type RenderOptions } from '@/engine/dotRenderer';
import { createScene, type ParticleScene, type ParticleControls } from '@/engine/particleEngine';
import { verifyCanvas } from '@/engine/qrVerifier';
import { canvasToPngBlob, downloadBlob, safeFilename } from '@/engine/pngExporter';
import { exportAnimationVideo, mp4Supported, type VideoExportResult } from '@/engine/videoExporter';
import { exportGIF } from '@/engine/gifExporter';
import type { FrameSource } from '@/engine/animationFrames';
import { normalizeUrl } from '@/utils/urlValidator';
import { MODE_ENHANCE } from '@/lib/constants';

export const PREVIEW_PX = 720;

export interface GeneratorState {
  phase: GenerationPhase;
  status: VerificationStatus;
  decodedText: string | null;
  failureReason: string | null;
  repairLevel: number;
  attempts: string[];
  matrix: MatrixInfo | null;
  plan: DotPlan | null;
  scene: ParticleScene | null;
  processed: ProcessedImage | null;
  toneWarning: string | undefined;
  moduleCount: number;
  version: number;
  dotCount: number;
  url: string; // normalized, encoded URL
  geometryOverride: boolean; // repair forced dotSize 1 / spacing 0
}

export interface GeneratorArgs {
  urlInput: string;
  sourceImg: HTMLImageElement | null;
  sourceName: string;
  crop: CropTransform;
  adjustments: ImageAdjustments;
  dots: DotOptions;
  qr: QROptions;
  preset: QualityPreset;
  anim: ParticleControls;
}

export interface PNGExportOutcome { ok: boolean; blob?: Blob; reason?: string }
export type VideoExportOutcome = VideoExportResult | { ok: false; reason: string };

const INITIAL: GeneratorState = {
  phase: 'idle',
  status: 'idle',
  decodedText: null,
  failureReason: null,
  repairLevel: 0,
  attempts: [],
  matrix: null,
  plan: null,
  scene: null,
  processed: null,
  toneWarning: undefined,
  moduleCount: 0,
  version: 0,
  dotCount: 0,
  url: '',
  geometryOverride: false,
};

// Repair ladder: band escalation → geometry safety → desaturation → EC boost.
interface AttemptSpec { repair: number; geo: boolean; ecBoost: boolean; label: string }
const REPAIR_LADDER: AttemptSpec[] = [
  { repair: 0, geo: false, ecBoost: false, label: 'photographic tone bands' },
  { repair: 1, geo: false, ecBoost: false, label: 'wider band separation' },
  { repair: 2, geo: false, ecBoost: false, label: 'band separation + desaturation' },
  { repair: 3, geo: true, ecBoost: false, label: 'full-size dots, no gaps' },
  { repair: 4, geo: true, ecBoost: true, label: 'maximum redundancy (EC H)' },
];

/** Verification renders must always be opaque — jsQR cannot read transparency. */
function opaqueRenderOpts(opts: RenderOptions): RenderOptions {
  return { ...opts, transparent: false, bgColor: '#ffffff' };
}

export function useQRGenerator() {
  const [state, setState] = useState<GeneratorState>(INITIAL);
  const [exporting, setExporting] = useState<string | null>(null);
  const [mp4Ok, setMp4Ok] = useState<boolean | null>(null);
  const [replayKey, setReplayKey] = useState(0);

  const argsRef = useRef<GeneratorArgs | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const genRef = useRef(0);

  useEffect(() => {
    let alive = true;
    mp4Supported().then((ok) => { if (alive) setMp4Ok(ok); }).catch(() => { if (alive) setMp4Ok(false); });
    return () => { alive = false; };
  }, []);

  /** Render the static frame at `px` and decode it with jsQR. */
  const renderAndVerify = useCallback(async (
    url: string,
    matrix: MatrixInfo,
    plan: DotPlan,
    spec: AttemptSpec,
    dots: DotOptions,
    quietZone: number,
    px: number,
  ): Promise<{ canvas: HTMLCanvasElement; verified: boolean; decoded: string | null; reason?: string }> => {
    const canvas = renderPlanToCanvas(
      plan,
      matrix,
      opaqueRenderOpts({
        quietZone,
        bgColor: '#ffffff',
        transparent: false,
        shape: dots.shape,
        dotSize: spec.geo ? 1 : dots.size,
        spacing: spec.geo ? 0 : dots.spacing,
        fragmentSource: plan.fragmentSource,
      }),
      px,
    );
    const outcome = await verifyCanvas(canvas, url);
    return { canvas, verified: outcome.verified, decoded: outcome.decoded, reason: outcome.reason };
  }, []);

  const runFullPipeline = useCallback(async (args: GeneratorArgs) => {
    const gen = ++genRef.current;
    const alive = () => genRef.current === gen;

    const urlCheck = normalizeUrl(args.urlInput);
    if (!urlCheck.ok || !args.sourceImg) {
      setState(INITIAL);
      return;
    }
    const url = urlCheck.url!;

    const setPartial = (p: Partial<GeneratorState> | ((s: GeneratorState) => Partial<GeneratorState>)) => {
      if (!alive()) return;
      setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
    };

    setPartial({ phase: 'matrix', status: 'working', url, attempts: [], failureReason: null, decodedText: null, geometryOverride: false });

    // -- 1. matrix -----------------------------------------------------------
    let matrix: MatrixInfo;
    try {
      matrix = encodeQR(url, args.qr.ecLevel, args.qr.targetVersion).matrix;
    } catch (err) {
      setPartial({ phase: 'failed', status: 'failed', failureReason: err instanceof Error ? err.message : 'Could not encode this URL.' });
      return;
    }

    // -- 2. image processing ---------------------------------------------------
    setPartial({ phase: 'analyzing' });
    let processed: ProcessedImage;
    try {
      processed = processImage(args.sourceImg, {
        crop: args.crop,
        matrixSize: matrix.size,
        adjustments: args.adjustments,
        enhance: MODE_ENHANCE[args.preset],
      });
    } catch {
      setPartial({ phase: 'failed', status: 'failed', failureReason: 'Could not process that image.' });
      return;
    }

    // -- 3..7. plan → render → scene → verify, with repair ladder -------------
    setPartial({ phase: 'rendering', moduleCount: matrix.size * matrix.size, version: matrix.version });

    for (const spec of REPAIR_LADDER) {
      if (!alive()) return;

      let attemptMatrix = matrix;
      if (spec.ecBoost && matrix.ecLevel !== 'H') {
        try {
          attemptMatrix = encodeQR(url, 'H', args.qr.targetVersion).matrix;
        } catch { /* keep original matrix */ }
      }

      let plan: DotPlan;
      try {
        plan = buildDotPlan({ matrix: attemptMatrix, processed, dots: args.dots, preset: args.preset, repairLevel: spec.repair });
      } catch {
        setPartial({ phase: 'failed', status: 'failed', failureReason: 'Dot planning failed.' });
        return;
      }

      const staticCanvas = renderPlanToCanvas(
        plan,
        attemptMatrix,
        opaqueRenderOpts({
          quietZone: args.qr.quietZone,
          bgColor: '#ffffff',
          transparent: false,
          shape: args.dots.shape,
          dotSize: spec.geo ? 1 : args.dots.size,
          spacing: spec.geo ? 0 : args.dots.spacing,
          fragmentSource: plan.fragmentSource,
        }),
        PREVIEW_PX,
      );
      const scene = createScene(plan, attemptMatrix, PREVIEW_PX, args.qr.quietZone, args.anim);

      setPartial((s) => ({ phase: 'verifying', status: spec.repair > 0 ? 'optimizing' : 'working', repairLevel: spec.repair, attempts: [...s.attempts, spec.label] }));

      const outcome = await verifyCanvas(staticCanvas, url);
      if (!alive()) return;

      if (outcome.verified) {
        setPartial({
          phase: 'done',
          status: 'verified',
          decodedText: outcome.decoded,
          failureReason: null,
          repairLevel: spec.repair,
          matrix: attemptMatrix,
          plan,
          scene,
          processed,
          toneWarning: plan.toneHealth.warning,
          dotCount: plan.dots.length,
          geometryOverride: spec.geo,
        });
        setReplayKey((k) => k + 1); // replay the assembly on every successful (re)build
        return;
      }

      setPartial({
        failureReason: outcome.decoded
          ? `The rendered QR decoded to a different link (${outcome.decoded.slice(0, 60)}${outcome.decoded.length > 60 ? '…' : ''}).`
          : (outcome.reason ?? 'The rendered QR could not be decoded.'),
      });
    }

    // Ladder exhausted — keep the last render visible, report failure honestly.
    if (alive()) {
      setState((s) => ({ ...s, phase: 'failed', status: 'failed', matrix, processed }));
    }
  }, []);

  // --------------------------------------------------------------------------
  // Exports — each re-renders at its own resolution and re-verifies before
  // producing a download.
  // --------------------------------------------------------------------------

  const exportVerifiedCanvas = useCallback(async (px: number): Promise<HTMLCanvasElement | null> => {
    const args = argsRef.current;
    const s = stateRef.current;
    if (!args || !s.matrix || !s.plan || !s.processed) return null;
    for (const spec of REPAIR_LADDER) {
      if (spec.repair > 0 && spec.repair <= s.repairLevel && !spec.geo && !spec.ecBoost) continue; // already-verified strategy
      let m = s.matrix;
      if (spec.ecBoost && s.matrix.ecLevel !== 'H') {
        try { m = encodeQR(s.url, 'H', args.qr.targetVersion).matrix; } catch { /* keep */ }
      }
      const plan = spec.repair === 0 && !spec.geo && !spec.ecBoost
        ? s.plan
        : buildDotPlan({ matrix: m, processed: s.processed, dots: args.dots, preset: args.preset, repairLevel: spec.repair });
      // Keep export renders identical to what was verified: if generation needed
      // the geometry override (full-size dots), apply it here too.
      const dots = (s.geometryOverride || spec.geo) ? { ...args.dots, size: 1, spacing: 0 } : args.dots;
      const { canvas, verified } = await renderAndVerify(s.url, m, plan, spec, dots, args.qr.quietZone, px);
      if (verified) return canvas;
    }
    return null;
  }, [renderAndVerify]);

  const exportPNG = useCallback(async (px: number): Promise<PNGExportOutcome> => {
    const canvas = await exportVerifiedCanvas(px);
    if (!canvas) return { ok: false, reason: 'This resolution did not verify. Try the Scan mode preset.' };
    const blob = await canvasToPngBlob(canvas);
    downloadBlob(blob, `${safeFilename(stateRef.current.url || 'dotra-qr')}-${px}px.png`);
    return { ok: true, blob };
  }, [exportVerifiedCanvas]);

  const exportVideo = useCallback(async (): Promise<VideoExportOutcome> => {
    const args = argsRef.current;
    const s = stateRef.current;
    if (!args || !s.matrix || !s.plan || !s.processed) return { ok: false, reason: 'Nothing to export yet.' };

    const px = 1080;
    const canvas = await exportVerifiedCanvas(px);
    if (!canvas) return { ok: false, reason: 'The 1080p render did not verify. Try the Scan mode preset.' };

    const scene = createScene(s.plan, s.matrix, px, args.qr.quietZone, args.anim);
    const src: FrameSource = {
      scene,
      plan: s.plan,
      matrix: s.matrix,
      shape: args.dots.shape,
      easing: args.anim.easing,
      quietZone: args.qr.quietZone,
      bgColor: args.qr.bgColor,
      transparent: false,
      dotSize: s.geometryOverride ? 1 : args.dots.size,
      spacing: s.geometryOverride ? 0 : args.dots.spacing,
      fragmentSource: s.plan.fragmentSource,
      photoSource: s.processed?.detail ?? null,
      fps: 30,
      holdSeconds: 1.2,
    };
    const workCanvas = document.createElement('canvas');
    workCanvas.width = px;
    workCanvas.height = px;
    return exportAnimationVideo(src, workCanvas, () => {});
  }, [exportVerifiedCanvas]);

  const exportGif = useCallback(async (onProgress: (done: number, total: number) => void) => {
    const args = argsRef.current;
    const s = stateRef.current;
    if (!args || !s.matrix || !s.plan || !s.processed) return null;
    const px = 480;
    const canvas = await exportVerifiedCanvas(px);
    if (!canvas) return null;
    const scene = createScene(s.plan, s.matrix, px, args.qr.quietZone, args.anim);
    const src: FrameSource = {
      scene,
      plan: s.plan,
      matrix: s.matrix,
      shape: args.dots.shape,
      easing: args.anim.easing,
      quietZone: args.qr.quietZone,
      bgColor: args.qr.bgColor,
      transparent: false,
      dotSize: s.geometryOverride ? 1 : args.dots.size,
      spacing: s.geometryOverride ? 0 : args.dots.spacing,
      fragmentSource: s.plan.fragmentSource,
      photoSource: s.processed?.detail ?? null,
      fps: 12,
      holdSeconds: 1.2,
    };
    const workCanvas = document.createElement('canvas');
    return exportGIF(src, workCanvas, {
      width: px, height: px, fps: 12, holdFps: 6, onProgress,
    });
  }, [exportVerifiedCanvas]);

  const replay = useCallback(() => setReplayKey((k) => k + 1), []);

  return {
    state,
    exporting,
    setExporting,
    mp4Ok,
    replayKey,
    replay,
    argsRef,
    stateRef,
    runFullPipeline,
    exportPNG,
    exportVideo,
    exportGif,
  };
}

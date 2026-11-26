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
  CropTransform, ImageAdjustments, DotOptions, DotShape, QROptions, QualityPreset,
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
  ringEnabled: boolean; // whether the verified render includes the perforation ring
  rungIndex: number; // which ladder rung produced the verified render
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
  ringEnabled: true,
  rungIndex: 0,
};

// Repair ladder (v3 photographic integration): band escalation → reduced photo
// influence → pure B&W modules → full-size square modules → decoration off →
// EC boost. The encoded URL never changes; every rung re-renders and re-verifies
// the ACTUAL pixels before the next escalation.
interface AttemptSpec {
  repair: number;
  geo: boolean;
  ecBoost: boolean;
  influence?: number; // override photo influence through the modules
  forceBW?: boolean; // force pure greyscale modules
  forceShape?: DotShape; // force the simplest module geometry
  ring?: boolean; // override the decorative perforation border
  label: string;
}

const REPAIR_LADDER: AttemptSpec[] = [
  { repair: 0, geo: false, ecBoost: false, label: 'photographic tone bands' },
  { repair: 1, geo: false, ecBoost: false, influence: 0.35, label: 'wider band separation + reduced photo influence' },
  { repair: 2, geo: false, ecBoost: false, influence: 0.2, forceBW: true, label: 'band separation + black & white modules' },
  { repair: 2, geo: true, ecBoost: false, influence: 0.1, forceBW: true, forceShape: 'pixel', label: 'full-size square modules, no gaps' },
  { repair: 3, geo: true, ecBoost: false, influence: 0.05, forceBW: true, forceShape: 'pixel', ring: false, label: 'decorative border off + maximum band separation' },
  { repair: 4, geo: true, ecBoost: true, influence: 0, forceBW: true, forceShape: 'pixel', ring: false, label: 'maximum redundancy (EC H) + pure black & white' },
];

/** Apply a ladder rung's rendering overrides to the user's dot options. */
function rungDotOptions(base: DotOptions, spec: AttemptSpec): DotOptions {
  return {
    ...base,
    influence: spec.influence ?? base.influence,
    bwIntensity: spec.forceBW ? 1 : base.bwIntensity,
    colourTreatment: spec.forceBW ? false : base.colourTreatment,
    shape: spec.forceShape ?? base.shape,
  };
}

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
    ring: boolean,
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
        photoUnderlay: plan.underlay,
        perforationBorder: ring,
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

    for (let li = 0; li < REPAIR_LADDER.length; li++) {
      const spec = REPAIR_LADDER[li];
      if (!alive()) return;

      const rungDots = rungDotOptions(args.dots, spec);
      const ringOn = spec.ring !== false && args.qr.perforationBorder;

      let attemptMatrix = matrix;
      if (spec.ecBoost && matrix.ecLevel !== 'H') {
        try {
          attemptMatrix = encodeQR(url, 'H', args.qr.targetVersion).matrix;
        } catch { /* keep original matrix */ }
      }

      let plan: DotPlan;
      try {
        plan = buildDotPlan({ matrix: attemptMatrix, processed, dots: rungDots, preset: args.preset, repairLevel: spec.repair });
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
          shape: rungDots.shape,
          dotSize: spec.geo ? 1 : rungDots.size,
          spacing: spec.geo ? 0 : rungDots.spacing,
          fragmentSource: plan.fragmentSource,
          photoUnderlay: plan.underlay,
          perforationBorder: ringOn,
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
          ringEnabled: ringOn,
          rungIndex: li,
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
    for (let li = 0; li < REPAIR_LADDER.length; li++) {
      const spec = REPAIR_LADDER[li];
      if (li < s.rungIndex) continue; // rungs before the verified one already failed
      let m = s.matrix;
      if (spec.ecBoost && s.matrix.ecLevel !== 'H') {
        try { m = encodeQR(s.url, 'H', args.qr.targetVersion).matrix; } catch { /* keep */ }
      }
      const rungDots = rungDotOptions(args.dots, spec);
      // Keep export renders identical to what was verified: if generation needed
      // the geometry override (full-size modules), apply it here too.
      if (s.geometryOverride || spec.geo) { rungDots.size = 1; rungDots.spacing = 0; }
      const ringOn = spec.ring !== false && args.qr.perforationBorder;
      const plan = li === s.rungIndex
        ? s.plan // the exact plan that verified at generation time
        : buildDotPlan({ matrix: m, processed: s.processed, dots: rungDots, preset: args.preset, repairLevel: spec.repair });
      const { canvas, verified } = await renderAndVerify(s.url, m, plan, spec, rungDots, args.qr.quietZone, px, ringOn);
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
      perforationBorder: s.ringEnabled,
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
      perforationBorder: s.ringEnabled,
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

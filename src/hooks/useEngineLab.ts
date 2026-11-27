// ---------------------------------------------------------------------------
// DOTRA Engine Lab — multi-engine orchestration
//
// One URL, one photograph, ONE shared matrix (halftone forces EC-H per its
// origin engine's design). Every engine renders the ACTUAL raster, which is
// decoded with jsQR and compared against the URL — the same non-negotiable
// gate as the Studio. Each engine carries a small repair ladder; exports
// re-render at full resolution and re-verify before any download.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from 'react';
import type {
  CropTransform, ImageAdjustments, DotOptions, QROptions, QualityPreset,
  ECLevel, VerificationStatus, MatrixInfo,
} from '@/engine/types';
import { encodeQR } from '@/engine/qrGenerator';
import { processImage, type ProcessedImage } from '@/engine/imageProcessor';
import { buildDotPlan, renderPlanToCanvas } from '@/engine/dotRenderer';
import { verifyCanvas } from '@/engine/qrVerifier';
import { canvasToPngBlob, downloadBlob, safeFilename } from '@/engine/pngExporter';
import { normalizeUrl } from '@/utils/urlValidator';
import { MODE_ENHANCE } from '@/lib/constants';
import { renderHalftone, type HalftoneOptions } from '@/engines/halftoneEngine';
import { renderArtistic, type ArtisticOptions } from '@/engines/artisticEngine';
import { computeMetrics, type EngineMetrics } from '@/engines/compare';
import { Raster, type EngineId } from '@/engines';
import { PREVIEW_PX } from './useQRGenerator';

export interface EngineLabArgs {
  urlInput: string;
  sourceImg: HTMLImageElement | null;
  crop: CropTransform;
  adjustments: ImageAdjustments;
  dots: DotOptions;
  qr: QROptions;
  preset: QualityPreset;
  halftone: HalftoneOptions;
  artistic: ArtisticOptions;
}

type CompositeSpec = { kind: 'composite'; dots: DotOptions; ring: boolean; ec: ECLevel; targetVersion: QROptions['targetVersion']; rung: number };
type HalftoneSpec = { kind: 'halftone'; opts: HalftoneOptions; targetVersion: QROptions['targetVersion']; rung: number };
type ArtisticSpec = { kind: 'artistic'; opts: ArtisticOptions; ec: ECLevel; targetVersion: QROptions['targetVersion']; rung: number };
export type EngineSpec = CompositeSpec | HalftoneSpec | ArtisticSpec;

export interface EnginePanel {
  id: EngineId;
  status: VerificationStatus;
  decodedText: string | null;
  reason: string | null;
  attempts: string[];
  rung: number;
  metrics: EngineMetrics | null;
  dataUrl: string | null;
  spec: EngineSpec | null;
}

const IDLE_PANEL = (id: EngineId): EnginePanel => ({
  id, status: 'idle', decodedText: null, reason: null, attempts: [], rung: 0,
  metrics: null, dataUrl: null, spec: null,
});

const INITIAL: Record<EngineId, EnginePanel> = {
  composite: IDLE_PANEL('composite'),
  halftone: IDLE_PANEL('halftone'),
  artistic: IDLE_PANEL('artistic'),
};

// ---------------------------------------------------------------------------
// browser-only raster glue
// ---------------------------------------------------------------------------

function rasterToCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = r.w;
  c.height = r.h;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
  return c;
}

function rasterFromCanvas(c: HTMLCanvasElement): Raster {
  const ctx = c.getContext('2d')!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return new Raster(c.width, c.height, new Uint8ClampedArray(d.data));
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

export function useEngineLab() {
  const [panels, setPanels] = useState<Record<EngineId, EnginePanel>>(INITIAL);
  const [busy, setBusy] = useState(false);
  const argsRef = useRef<EngineLabArgs | null>(null);
  const genRef = useRef(0);

  const run = useCallback(async (args: EngineLabArgs) => {
    const gen = ++genRef.current;
    const alive = () => genRef.current === gen;
    argsRef.current = args;

    const urlCheck = normalizeUrl(args.urlInput);
    if (!urlCheck.ok || !args.sourceImg) {
      setPanels(INITIAL);
      return;
    }
    const url = urlCheck.url!;
    setBusy(true);
    setPanels({
      composite: { ...INITIAL.composite, status: 'working', attempts: [] },
      halftone: { ...INITIAL.halftone, status: 'working', attempts: [] },
      artistic: { ...INITIAL.artistic, status: 'working', attempts: [] },
    });

    // -- shared matrix + processed photograph --------------------------------
    let matrix: MatrixInfo;
    try {
      matrix = encodeQR(url, args.qr.ecLevel, args.qr.targetVersion).matrix;
    } catch {
      setPanels((p) => ({
        composite: { ...p.composite, status: 'failed', reason: 'Could not encode this URL.' },
        halftone: { ...p.halftone, status: 'failed', reason: 'Could not encode this URL.' },
        artistic: { ...p.artistic, status: 'failed', reason: 'Could not encode this URL.' },
      }));
      setBusy(false);
      return;
    }
    let matrixH: MatrixInfo = matrix;
    if (matrix.ecLevel !== 'H') {
      try { matrixH = encodeQR(url, 'H', args.qr.targetVersion).matrix; } catch { /* keep */ }
    }

    let processed: ProcessedImage;
    try {
      processed = processImage(args.sourceImg, {
        crop: args.crop,
        matrixSize: matrix.size,
        adjustments: args.adjustments,
        enhance: MODE_ENHANCE[args.preset],
      });
    } catch {
      setBusy(false);
      return;
    }
    const photoRaster = rasterFromCanvas(processed.detail);

    const patch = (id: EngineId, p: Partial<EnginePanel>) => {
      if (!alive()) return;
      setPanels((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));
    };

    // -- composite (DOTRA v3) ------------------------------------------------
    {
      const qz = args.qr.quietZone;
      const cmp = PREVIEW_PX / (matrix.size + 2 * qz);
      const gridRect = { x: qz * cmp, y: qz * cmp, w: matrix.size * cmp, h: matrix.size * cmp };
      const ladder: { label: string; dots: DotOptions; ring: boolean }[] = [
        { label: 'studio module settings', dots: args.dots, ring: args.qr.perforationBorder },
        { label: 'reduced photo influence', dots: { ...args.dots, influence: 0.2, bwIntensity: 1, colourTreatment: false }, ring: args.qr.perforationBorder },
        { label: 'pure B&W square modules', dots: { ...args.dots, influence: 0, shape: 'pixel', size: 1, spacing: 0, bwIntensity: 1, colourTreatment: false }, ring: false },
      ];
      let done = false;
      for (let li = 0; li < ladder.length && !done; li++) {
        const rung = ladder[li];
        if (!alive()) return;
        patch('composite', { attempts: ladder.slice(0, li + 1).map((l) => l.label) });
        let canvas: HTMLCanvasElement | null = null;
        try {
          const plan = buildDotPlan({ matrix, processed, dots: rung.dots, preset: args.preset, repairLevel: 0 });
          canvas = renderPlanToCanvas(plan, matrix, {
            quietZone: args.qr.quietZone, bgColor: '#ffffff', transparent: false,
            shape: rung.dots.shape, dotSize: rung.dots.size, spacing: rung.dots.spacing,
            fragmentSource: plan.fragmentSource, photoUnderlay: plan.underlay, perforationBorder: rung.ring,
          }, PREVIEW_PX);
        } catch { canvas = null; }
        if (!canvas) continue;
        const outcome = await verifyCanvas(canvas, url);
        if (!alive()) return;
        if (outcome.verified) {
          const raster = rasterFromCanvas(canvas);
          patch('composite', {
            status: 'verified', decodedText: outcome.decoded, reason: null, rung: li,
            dataUrl: canvas.toDataURL('image/png'),
            metrics: computeMetrics({ raster, photo: photoRaster, photoRect: gridRect, matrix, quietZone: args.qr.quietZone, size: PREVIEW_PX, verified: true }),
            spec: { kind: 'composite', dots: rung.dots, ring: rung.ring, ec: matrix.ecLevel, targetVersion: args.qr.targetVersion, rung: li },
          });
          done = true;
        } else {
          patch('composite', { reason: outcome.reason ?? 'Decode mismatch.' });
        }
      }
      if (!done && alive()) patch('composite', { status: 'failed' });
    }

    // -- halftone (visual-qrcode port; EC-H by design) ------------------------
    {
      const qz = args.qr.quietZone;
      const hmp = PREVIEW_PX / (matrixH.size + 2 * qz);
      const hox = qz * hmp;
      const ladder: { label: string; opts: HalftoneOptions; photo: boolean }[] = [
        { label: 'halftone 3×3 sub-pixels', opts: args.halftone, photo: true },
        { label: 'larger data centre (4×4)', opts: { ...args.halftone, subpixels: 4 }, photo: true },
        { label: '4×4 + photo to grid edge', opts: { ...args.halftone, subpixels: 4, photoPadding: 0 }, photo: true },
        { label: 'solid modules (photo off)', opts: { ...args.halftone, subpixels: 4 }, photo: false },
      ];
      let done = false;
      for (let li = 0; li < ladder.length && !done; li++) {
        const rung = ladder[li];
        if (!alive()) return;
        patch('halftone', { attempts: ladder.slice(0, li + 1).map((l) => l.label) });
        const raster = renderHalftone(
          { matrix: matrixH, photo: rung.photo ? photoRaster : null, size: PREVIEW_PX, quietZone: args.qr.quietZone },
          rung.opts,
        );
        const canvas = rasterToCanvas(raster);
        const outcome = await verifyCanvas(canvas, url);
        if (!alive()) return;
        if (outcome.verified) {
          const hp = Math.max(0, Math.min(Math.floor(rung.opts.photoPadding), Math.floor(matrixH.size / 2) - 5));
          const hRect = rung.photo
            ? { x: hox + hp * hmp, y: hox + hp * hmp, w: (matrixH.size - 2 * hp) * hmp, h: (matrixH.size - 2 * hp) * hmp }
            : null;
          patch('halftone', {
            status: 'verified', decodedText: outcome.decoded, reason: null, rung: li,
            dataUrl: canvas.toDataURL('image/png'),
            metrics: computeMetrics({ raster, photo: rung.photo ? photoRaster : null, photoRect: hRect, matrix: matrixH, quietZone: args.qr.quietZone, size: PREVIEW_PX, verified: true }),
            spec: { kind: 'halftone', opts: rung.opts, targetVersion: args.qr.targetVersion, rung: li },
          });
          done = true;
        } else {
          patch('halftone', { reason: outcome.reason ?? 'Decode mismatch.' });
        }
      }
      if (!done && alive()) patch('halftone', { status: 'failed' });
    }

    // -- artistic (qrcode-toolkit port) ---------------------------------------
    {
      const ladder: { label: string; opts: ArtisticOptions }[] = [
        { label: 'toolkit styling', opts: args.artistic },
        { label: 'effects + margin noise off', opts: { ...args.artistic, crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false } },
        { label: 'plain square modules', opts: { ...args.artistic, crystalizeRadius: 0, liquidifyRadius: 0, perspective: 0, marginNoise: false, pixelStyle: 'square', markerShape: 'square', markerInner: 'square' } },
      ];
      let done = false;
      for (let li = 0; li < ladder.length && !done; li++) {
        const rung = ladder[li];
        if (!alive()) return;
        patch('artistic', { attempts: ladder.slice(0, li + 1).map((l) => l.label) });
        const raster = renderArtistic(
          { matrix, photo: photoRaster, size: PREVIEW_PX, quietZone: args.qr.quietZone },
          rung.opts,
        );
        const canvas = rasterToCanvas(raster);
        const outcome = await verifyCanvas(canvas, url);
        if (!alive()) return;
        if (outcome.verified) {
          patch('artistic', {
            status: 'verified', decodedText: outcome.decoded, reason: null, rung: li,
            dataUrl: canvas.toDataURL('image/png'),
            metrics: computeMetrics({ raster, photo: photoRaster, photoRect: rung.opts.photoBackground ? { x: 0, y: 0, w: PREVIEW_PX, h: PREVIEW_PX } : null, matrix, quietZone: args.qr.quietZone, size: PREVIEW_PX, verified: true }),
            spec: { kind: 'artistic', opts: rung.opts, ec: matrix.ecLevel, targetVersion: args.qr.targetVersion, rung: li },
          });
          done = true;
        } else {
          patch('artistic', { reason: outcome.reason ?? 'Decode mismatch.' });
        }
      }
      if (!done && alive()) patch('artistic', { status: 'failed' });
    }

    if (alive()) setBusy(false);
  }, []);

  // --------------------------------------------------------------------------
  // Exports — re-render the VERIFIED rung at full resolution, re-verify, download.
  // --------------------------------------------------------------------------

  const renderSpecAt = useCallback(async (spec: EngineSpec, args: EngineLabArgs, url: string, processed: ProcessedImage, photoRaster: Raster, px: number): Promise<HTMLCanvasElement | null> => {
    if (spec.kind === 'composite') {
      const matrix = encodeQR(url, spec.ec, spec.targetVersion).matrix;
      const plan = buildDotPlan({ matrix, processed, dots: spec.dots, preset: args.preset, repairLevel: 0 });
      return renderPlanToCanvas(plan, matrix, {
        quietZone: args.qr.quietZone, bgColor: '#ffffff', transparent: false,
        shape: spec.dots.shape, dotSize: spec.dots.size, spacing: spec.dots.spacing,
        fragmentSource: plan.fragmentSource, photoUnderlay: plan.underlay, perforationBorder: spec.ring,
      }, px);
    }
    if (spec.kind === 'halftone') {
      const matrix = encodeQR(url, 'H', spec.targetVersion).matrix;
      const raster = renderHalftone({ matrix, photo: photoRaster, size: px, quietZone: args.qr.quietZone }, spec.opts);
      return rasterToCanvas(raster);
    }
    const matrix = encodeQR(url, spec.ec, spec.targetVersion).matrix;
    const raster = renderArtistic({ matrix, photo: photoRaster, size: px, quietZone: args.qr.quietZone }, spec.opts);
    return rasterToCanvas(raster);
  }, []);

  const exportEnginePNG = useCallback(async (id: EngineId, px: number): Promise<{ ok: boolean; reason?: string }> => {
    const args = argsRef.current;
    const panel = panels[id];
    if (!args || !panel.spec || panel.status !== 'verified') return { ok: false, reason: 'Nothing verified to export.' };
    const urlCheck = normalizeUrl(args.urlInput);
    if (!urlCheck.ok || !args.sourceImg) return { ok: false, reason: 'Invalid URL.' };
    const url = urlCheck.url!;
    const ec = panel.spec.kind === 'halftone' ? 'H' : panel.spec.ec;
    const probe = encodeQR(url, ec, panel.spec.targetVersion).matrix;
    const processed = processImage(args.sourceImg, {
      crop: args.crop, matrixSize: probe.size, adjustments: args.adjustments, enhance: MODE_ENHANCE[args.preset],
    });
    const photoRaster = rasterFromCanvas(processed.detail);
    const canvas = await renderSpecAt(panel.spec, args, url, processed, photoRaster, px);
    if (!canvas) return { ok: false, reason: 'Render failed.' };
    const outcome = await verifyCanvas(canvas, url);
    if (!outcome.verified) return { ok: false, reason: 'This resolution did not verify. Try a gentler engine setting.' };
    const blob = await canvasToPngBlob(canvas);
    downloadBlob(blob, `${safeFilename(url)}-${id}-${px}px.png`);
    return { ok: true };
  }, [panels, renderSpecAt]);

  const bestEngine = useCallback((): EngineId | null => {
    let best: EngineId | null = null;
    let bestScore = -1;
    (Object.keys(panels) as EngineId[]).forEach((id) => {
      const p = panels[id];
      if (p.status === 'verified' && p.metrics && p.metrics.score > bestScore) {
        bestScore = p.metrics.score;
        best = id;
      }
    });
    return best;
  }, [panels]);

  const exportBestPNG = useCallback(async (px: number): Promise<{ ok: boolean; reason?: string; engine?: EngineId }> => {
    const id = bestEngine();
    if (!id) return { ok: false, reason: 'No engine verified yet.' };
    const r = await exportEnginePNG(id, px);
    return { ...r, engine: id };
  }, [bestEngine, exportEnginePNG]);

  return { panels, busy, run, exportEnginePNG, exportBestPNG, bestEngine };
}

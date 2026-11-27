// ---------------------------------------------------------------------------
// DOTRA Engine Lab — side-by-side comparison of three QR render engines
//
// One URL, one photograph, one shared matrix. Every engine renders the real
// raster, jsQR decodes it, and only verified engines can export. The panel
// also shows honest fidelity metrics so the photograph-driven engines can be
// compared on more than "it scans".
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Layers, Download, CheckCircle2, XCircle, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import type {
  CropTransform, ImageAdjustments, DotOptions, QROptions, QualityPreset,
} from '@/engine/types';
import { useEngineLab } from '@/hooks/useEngineLab';
import {
  ENGINE_META, ENGINE_IDS, HALFTONE_DEFAULTS, ARTISTIC_DEFAULTS,
  type EngineId, type HalftoneOptions, type ArtisticOptions, type EngineMetrics,
} from '@/engines';
import { Card, Button, Segmented, SliderRow, SelectRow, Toggle, StatusBadge, SectionLabel } from './primitives';

export interface EngineLabProps {
  urlInput: string;
  sourceImg: HTMLImageElement | null;
  crop: CropTransform;
  adjustments: ImageAdjustments;
  dots: DotOptions;
  qr: QROptions;
  preset: QualityPreset;
}

function MetricBar({ label, value, display }: { label: string; value: number | null; display: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] text-mute">{label}</span>
        <span className="text-[11px] font-medium text-ink tabular-nums">{display}</span>
      </div>
      <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-ink transition-[width] duration-500"
          style={{ width: value === null ? '0%' : `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function metricDisplay(m: EngineMetrics | null) {
  if (!m) return null;
  return {
    separation: { value: m.separation / 255, display: `${Math.round(m.separation)} levels` },
    fidelity: { value: m.fidelity, display: m.fidelity === null ? 'no photo' : `r = ${m.fidelity.toFixed(3)}` },
    hue: { value: m.hueDev === null ? null : Math.max(0, 1 - m.hueDev / 45), display: m.hueDev === null ? '—' : `Δhue ${m.hueDev.toFixed(1)}°` },
    score: { value: m.score, display: m.score > 0 ? `${Math.round(m.score * 100)}` : 'unverified' },
  };
}

export function EngineLab({ urlInput, sourceImg, crop, adjustments, dots, qr, preset }: EngineLabProps) {
  const lab = useEngineLab();
  const [halftone, setHalftone] = useState<HalftoneOptions>(HALFTONE_DEFAULTS);
  const [artistic, setArtistic] = useState<ArtisticOptions>(ARTISTIC_DEFAULTS);
  const [exporting, setExporting] = useState<EngineId | 'best' | null>(null);

  // Debounced regeneration — identical trigger pattern to the Studio.
  useEffect(() => {
    const t = window.setTimeout(() => {
      void lab.run({ urlInput, sourceImg, crop, adjustments, dots, qr, preset, halftone, artistic });
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlInput, sourceImg, crop, adjustments, dots, qr, preset, halftone, artistic]);

  const best = lab.bestEngine();

  const doExport = async (id: EngineId | 'best') => {
    setExporting(id);
    try {
      if (id === 'best') await lab.exportBestPNG(1024);
      else await lab.exportEnginePNG(id, 1024);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-mute">Engine Lab</p>
          <h2 className="font-display font-bold tracking-tight text-3xl text-ink mt-1">
            Three engines, one decoder
          </h2>
          <p className="text-[13px] text-mute mt-1.5 max-w-xl leading-relaxed">
            The same URL and photograph are rendered by DOTRA's composite engine and two
            ported artistic engines — halftone (visual-qrcode) and toolkit styling
            (artistic-qrcode-generator). Each raster is decoded with jsQR against the
            exact URL; only verified engines export.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lab.busy && (
            <span className="inline-flex items-center gap-2 text-xs text-mute">
              <Loader2 size={14} className="animate-spin" /> rendering…
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={!best || exporting !== null}
            onClick={() => { void doExport('best'); }}
            title={best ? `Export the best verified engine (${ENGINE_META[best].label}) at 1024px` : 'No engine verified yet'}
          >
            <Download size={14} />
            Export best{best ? ` (${ENGINE_META[best].label})` : ''}
          </Button>
        </div>
      </div>

      {/* attribution */}
      <div className="rounded-xl border border-line bg-neutral-50 px-4 py-3 text-[11px] leading-relaxed text-mute">
        <span className="font-semibold text-ink">Attributions (MIT).</span>{' '}
        Halftone engine — port of{' '}
        <a className="underline underline-offset-2 hover:text-ink" href="https://github.com/JeSuisUnCaillou/visual-qrcode" target="_blank" rel="noreferrer">visual-qrcode</a>{' '}
        by JeSuisUnCaillou (halftone QR, EC-H). Artistic engine — port of the deterministic
        qrcode-toolkit pipeline from{' '}
        <a className="underline underline-offset-2 hover:text-ink" href="https://github.com/duanxianpi/artistic-qrcode-generator" target="_blank" rel="noreferrer">artistic-qrcode-generator</a>{' '}
        by duanxianpi (toolkit by antfu). Both ports run entirely in the browser; the
        diffusion stage of the artistic repo is GPU-bound and deliberately not ported.
      </div>

      {/* engine cards */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {ENGINE_IDS.map((id) => {
          const meta = ENGINE_META[id];
          const panel = lab.panels[id];
          const m = metricDisplay(panel.metrics);
          const isBest = best === id && panel.status === 'verified';
          return (
            <Card
              key={id}
              id={`engine-${id}`}
              title={meta.label}
              subtitle={meta.description}
              actions={isBest ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 text-ok border border-green-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  <Sparkles size={11} /> best verified
                </span>
              ) : undefined}
              className={isBest ? 'ring-1 ring-ok/40' : ''}
            >
              <div className="space-y-4">
                {/* render */}
                <div className="relative rounded-xl overflow-hidden border border-line bg-white" style={{ aspectRatio: '1/1' }}>
                  {panel.dataUrl ? (
                    <img src={panel.dataUrl} alt={`${meta.label} QR render`} className="absolute inset-0 w-full h-full" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-mute">
                      {panel.status === 'failed' ? 'No verified render' : 'Waiting for input…'}
                    </div>
                  )}
                </div>

                {/* status */}
                <div className="flex items-start gap-2">
                  <StatusBadge status={panel.status}>
                    {panel.status === 'verified' ? 'Verified' : panel.status === 'failed' ? 'Not verified' : panel.status === 'working' ? 'Rendering' : 'Idle'}
                  </StatusBadge>
                  {panel.status === 'verified' && panel.decodedText && (
                    <span className="text-[11px] text-mute break-all leading-snug">
                      decoded {panel.decodedText.length > 42 ? `${panel.decodedText.slice(0, 42)}…` : panel.decodedText}
                    </span>
                  )}
                </div>
                {panel.status === 'failed' && (panel.reason || panel.attempts.length > 0) && (
                  <p className="flex items-start gap-1.5 text-[11px] text-bad leading-snug">
                    <AlertTriangle size={12} className="mt-px shrink-0" />
                    <span>{panel.reason ?? 'The repair ladder could not produce a scannable render.'}</span>
                  </p>
                )}
                {panel.rung > 0 && panel.attempts.length > 0 && (
                  <p className="text-[11px] text-mute leading-snug">
                    Repaired via: {panel.attempts[panel.attempts.length - 1]} (rung {panel.rung})
                  </p>
                )}

                {/* metrics */}
                {m && (
                  <div className="space-y-2.5 rounded-xl border border-line bg-neutral-50 px-3.5 py-3">
                    <SectionLabel>Measured on the actual raster</SectionLabel>
                    <MetricBar label="Scan separation" value={m.separation.value} display={m.separation.display} />
                    <MetricBar label="Photo fidelity" value={m.fidelity.value} display={m.fidelity.display} />
                    <MetricBar label="Hue drift" value={m.hue.value} display={m.hue.display} />
                    <MetricBar label="Engine score" value={m.score.value} display={m.score.display} />
                  </div>
                )}

                {/* engine options */}
                {id === 'composite' && (
                  <div className="space-y-2">
                    <SectionLabel>Engine options</SectionLabel>
                    <p className="text-[11px] text-mute leading-relaxed">
                      Uses your Studio module settings ({dots.shape} modules, influence {dots.influence.toFixed(2)},
                      contrast {dots.moduleContrast.toFixed(2)}){qr.perforationBorder ? ', perforation border on' : ''}.
                      The full Studio repair ladder applies in the Composer; here a compact 3-rung ladder runs.
                    </p>
                  </div>
                )}

                {id === 'halftone' && (
                  <div className="space-y-3">
                    <SectionLabel>Engine options — sub-pixel halftone</SectionLabel>
                    <Segmented<string>
                      options={[
                        { id: '3', label: '3×3 sub-pixels', hint: 'original visual-qrcode look' },
                        { id: '4', label: '4×4', hint: 'larger data centre — safer' },
                      ]}
                      value={String(halftone.subpixels)}
                      onChange={(v) => setHalftone((h) => ({ ...h, subpixels: Number(v) as 3 | 4 }))}
                    />
                    <SliderRow
                      label="Photo padding"
                      value={halftone.photoPadding}
                      min={0}
                      max={4}
                      step={1}
                      onChange={(v) => setHalftone((h) => ({ ...h, photoPadding: v }))}
                      format={(v) => `${v} modules`}
                      hint="Clean B&W modules between the photograph and the grid edge."
                    />
                    <p className="text-[11px] text-mute leading-relaxed">
                      Centre sub-pixel carries the data; the ring shows the photograph.
                      Error correction is forced to level H, exactly like the origin gem.
                    </p>
                  </div>
                )}

                {id === 'artistic' && (
                  <div className="space-y-3">
                    <SectionLabel>Engine options — toolkit styling</SectionLabel>
                    <SelectRow
                      label="Module style"
                      value={artistic.pixelStyle}
                      options={[
                        { id: 'square', label: 'Square' }, { id: 'rounded', label: 'Rounded' },
                        { id: 'dot', label: 'Dot' }, { id: 'squircle', label: 'Squircle' },
                        { id: 'row', label: 'Row stripes' }, { id: 'column', label: 'Column stripes' },
                      ]}
                      onChange={(v) => setArtistic((a) => ({ ...a, pixelStyle: v as ArtisticOptions['pixelStyle'] }))}
                    />
                    <SelectRow
                      label="Finder marker"
                      value={artistic.markerShape}
                      options={[
                        { id: 'square', label: 'Square' }, { id: 'circle', label: 'Circle' },
                        { id: 'plus', label: 'Plus' }, { id: 'box', label: 'Box' },
                        { id: 'octagon', label: 'Octagon' }, { id: 'tiny-plus', label: 'Tiny plus' },
                      ]}
                      onChange={(v) => setArtistic((a) => ({ ...a, markerShape: v as ArtisticOptions['markerShape'] }))}
                    />
                    <SelectRow
                      label="Marker core"
                      value={artistic.markerInner}
                      options={[
                        { id: 'square', label: 'Square' }, { id: 'circle', label: 'Circle' },
                        { id: 'plus', label: 'Plus' }, { id: 'diamond', label: 'Diamond' },
                      ]}
                      onChange={(v) => setArtistic((a) => ({ ...a, markerInner: v as ArtisticOptions['markerInner'] }))}
                    />
                    <Toggle
                      label="Photograph background"
                      checked={artistic.photoBackground}
                      onChange={(v) => setArtistic((a) => ({ ...a, photoBackground: v }))}
                      hint="Cover-fit photo behind the whole composition; gaps and noise show it."
                    />
                    <Toggle
                      label="Margin noise"
                      checked={artistic.marginNoise}
                      onChange={(v) => setArtistic((a) => ({ ...a, marginNoise: v }))}
                      hint="Seeded dark modules in the quiet zone — the toolkit's hiding trick."
                    />
                    {artistic.marginNoise && (
                      <SliderRow
                        label="Noise density"
                        value={artistic.marginNoiseRate}
                        min={0}
                        max={0.6}
                        step={0.05}
                        onChange={(v) => setArtistic((a) => ({ ...a, marginNoiseRate: v }))}
                        format={(v) => `${Math.round(v * 100)}%`}
                      />
                    )}
                    <SliderRow
                      label="Crystalize radius"
                      value={artistic.crystalizeRadius}
                      min={0}
                      max={32}
                      step={1}
                      onChange={(v) => setArtistic((a) => ({ ...a, crystalizeRadius: v }))}
                      format={(v) => (v === 0 ? 'off' : `${v}px`)}
                      hint="Delaunay triangle averaging over the render."
                    />
                    <SliderRow
                      label="Liquidify blur"
                      value={artistic.liquidifyRadius}
                      min={0}
                      max={16}
                      step={1}
                      onChange={(v) => setArtistic((a) => ({ ...a, liquidifyRadius: v }))}
                      format={(v) => (v === 0 ? 'off' : `${v}px`)}
                      hint="Box blur then hard two-tone threshold."
                    />
                    <SliderRow
                      label="Perspective tilt"
                      value={artistic.perspective}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => setArtistic((a) => ({ ...a, perspective: v }))}
                      format={(v) => (v === 0 ? 'off' : `${Math.round(v * 100)}%`)}
                      hint="Keystone warp of the finished raster."
                    />
                    <SliderRow
                      label="Random seed"
                      value={artistic.seed}
                      min={0}
                      max={99}
                      step={1}
                      onChange={(v) => setArtistic((a) => ({ ...a, seed: v }))}
                      format={(v) => `#${v}`}
                    />
                    <p className="text-[11px] text-mute leading-relaxed">
                      Styling is bounded by scanability: if a configuration can't be decoded
                      by jsQR, the ladder simplifies it step by step — effects off, square
                      finder markers, plain modules, safe palette, and finally a clean white
                      frame. The attempts list shows exactly which rung verified.
                    </p>
                  </div>
                )}

                {/* export */}
                <Button
                  variant={isBest ? 'primary' : 'secondary'}
                  size="sm"
                  className="w-full"
                  disabled={panel.status !== 'verified' || exporting !== null}
                  loading={exporting === id}
                  onClick={() => { void doExport(id); }}
                  title={panel.status === 'verified' ? 'Export this engine at 1024px (re-verified at export resolution)' : 'Engine must verify before export'}
                >
                  {panel.status === 'verified' ? <Download size={14} /> : <XCircle size={14} />}
                  {panel.status === 'verified' ? 'Export 1024px PNG' : panel.status === 'failed' ? 'Not scannable' : 'Rendering…'}
                </Button>
                {panel.status === 'verified' && (
                  <p className="flex items-center gap-1.5 text-[11px] text-ok">
                    <CheckCircle2 size={12} /> jsQR decoded the final raster — exact URL match
                  </p>
                )}
                <p className="text-[10px] text-mute leading-relaxed">
                  {meta.origin} · {meta.license} ·{' '}
                  <a className="underline underline-offset-2 hover:text-ink" href={meta.originUrl} target="_blank" rel="noreferrer">{meta.originUrl.replace('https://', '')}</a>
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* footer note */}
      <div className="flex items-start gap-2 rounded-xl border border-line bg-white px-4 py-3">
        <Layers size={14} className="mt-0.5 shrink-0 text-mute" />
        <p className="text-[11px] text-mute leading-relaxed">
          Fair-comparison rules: one encoded URL (never changes), one photograph, one shared matrix
          (the halftone engine re-encodes at EC level H per its origin design), identical
          quiet zone, and the same jsQR gate on the actual exported pixels. GIF/MP4 animation
          exports remain a Composer feature — the Lab compares final frames.
        </p>
      </div>
    </div>
  );
}

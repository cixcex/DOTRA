import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, ImagePlus } from 'lucide-react';
import { useQRGenerator } from '@/hooks/useQRGenerator';
import type { GeneratorArgs } from '@/hooks/useQRGenerator';
import type {
  CropTransform, ImageAdjustments, DotOptions, QROptions, QualityPreset, AnimationBackground,
} from '@/engine/types';
import type { ParticleControls } from '@/engine/particleEngine';
import {
  DEFAULT_DOTS, DEFAULT_QR, DEFAULT_ADJ, DEFAULT_CROP, DEFAULT_ANIM,
} from '@/lib/constants';
import { SAMPLES, type SampleItem } from '@/lib/samples';
import { normalizeUrl } from '@/utils/urlValidator';
import { loadImageFromUrl } from '@/utils/imageUtils';
import { MODE_VERSION_HINT } from '@/engine/types';
import { Card, TextInput } from './primitives';
import { QRPreview, type PreviewRenderOpts } from './QRPreview';
import { VerificationBadge } from './VerificationBadge';
import { ExportPanel } from './ExportPanel';
import { EngineLab } from './EngineLab';
import { ImageUploader, type LoadedSource } from './ImageUploader';
import { GalleryPanel } from './GalleryPanel';
import { CropEditor } from './CropEditor';
import { QualitySection, DotsSection, QRSection, AnimationSection } from './CustomizationPanel';

const sampleCache = new Map<string, HTMLImageElement>();

function loadSample(sample: SampleItem): Promise<HTMLImageElement> {
  const cached = sampleCache.get(sample.id);
  if (cached) return Promise.resolve(cached);
  return loadImageFromUrl(sample.src).then((img) => {
    sampleCache.set(sample.id, img);
    return img;
  });
}

const PHASE_PCT: Record<string, number> = {
  idle: 0, matrix: 10, analyzing: 28, rendering: 50, animating: 62, verifying: 80, optimizing: 90, done: 100, failed: 100,
};

export function Studio() {
  const gen = useQRGenerator();

  const [urlInput, setUrlInput] = useState('https://dotra.app');
  const [source, setSource] = useState<LoadedSource | null>(null);
  const [crop, setCrop] = useState<CropTransform>(DEFAULT_CROP);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJ);
  const [dots, setDots] = useState<DotOptions>(DEFAULT_DOTS);
  const [qr, setQr] = useState<QROptions>(DEFAULT_QR);
  const [preset, setPreset] = useState<QualityPreset>('balanced');
  const [anim, setAnim] = useState<ParticleControls & { background: AnimationBackground }>(DEFAULT_ANIM);
  const [view, setView] = useState<'composer' | 'lab'>('composer');
  const [playing, setPlaying] = useState(true);
  const [sampleLoaded, setSampleLoaded] = useState(false);

  // Seed the studio with a bundled sample so it is alive on first paint.
  useEffect(() => {
    const seed = SAMPLES.find((s) => s.id === 'nature-ember-ridge');
    if (!seed) return;
    let cancelled = false;
    loadSample(seed).then((img) => {
      if (cancelled) return;
      setSource({ img, name: seed.name, kind: 'sample', sampleId: seed.id });
      setSampleLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // External URL requests (e.g. "Use in studio" from the Test QR modal).
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === 'string' && text.trim()) setUrlInput(text.trim());
    };
    window.addEventListener('dotra:set-url', handler);
    return () => window.removeEventListener('dotra:set-url', handler);
  }, []);

  // Sample selection from anywhere in the app (compact library or gallery section).
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const sample = SAMPLES.find((s) => s.id === id);
      if (!sample) return;
      void loadSample(sample).then((img) => {
        setSource({ img, name: sample.name, kind: 'sample', sampleId: sample.id });
        setUrlInput(sample.url);
      });
    };
    window.addEventListener('dotra:select-sample', handler);
    return () => window.removeEventListener('dotra:select-sample', handler);
  }, []);

  // Photographic modes need matrix density to be recognizable — when the user
  // leaves the matrix on Auto, follow the mode's recommended bucket.
  useEffect(() => {
    setQr((q) => (q.targetVersion === 'auto' ? { ...q, targetVersion: MODE_VERSION_HINT[preset] } : q));
  }, [preset]);

  const urlCheck = useMemo(() => normalizeUrl(urlInput), [urlInput]);

  const args = useMemo<GeneratorArgs>(() => ({
    urlInput,
    sourceImg: source?.img ?? null,
    sourceName: source?.name ?? '',
    crop,
    adjustments,
    dots,
    qr,
    preset,
    anim,
  }), [urlInput, source, crop, adjustments, dots, qr, preset, anim]);

  // Keep the export-time args ref fresh.
  useEffect(() => { gen.argsRef.current = args; });

  // Debounced regeneration on any input change.
  const argsRef = useRef(args);
  argsRef.current = args;
  useEffect(() => {
    const t = window.setTimeout(() => { void gen.runFullPipeline(argsRef.current); }, 320);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args]);

  const onSelectSample = useCallback((sample: SampleItem) => {
    window.dispatchEvent(new CustomEvent('dotra:select-sample', { detail: sample.id }));
  }, []);

  const onUpload = useCallback((src: LoadedSource) => setSource(src), []);
  const removeSource = useCallback(() => setSource(null), []);

  const effDotSize = gen.state.geometryOverride ? 1 : dots.size;
  const effSpacing = gen.state.geometryOverride ? 0 : dots.spacing;
  const transparent = qr.transparentBackground || anim.background === 'transparent';
  const previewBg = anim.background === 'transparent' ? 'checkerboard'
    : anim.background === 'dark' ? 'bg-neutral-900'
    : anim.background === 'light' ? 'bg-neutral-100' : 'bg-white';

  const renderOpts: PreviewRenderOpts = {
    quietZone: qr.quietZone,
    bgColor: qr.bgColor,
    transparent,
    shape: dots.shape,
    dotSize: effDotSize,
    spacing: effSpacing,
    fragmentSource: gen.state.plan?.fragmentSource ?? null,
    photoUnderlay: gen.state.processed?.detail ?? null,
    perforationBorder: qr.perforationBorder,
  };

  const { state } = gen;
  const busy = state.status === 'working' || state.status === 'optimizing';
  const phasePct = PHASE_PCT[state.phase] ?? 0;

  return (
    <section id="studio" className="max-w-[1400px] mx-auto px-5 sm:px-8 py-14 scroll-mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-mute">Studio</p>
          <h2 className="font-display font-bold tracking-tight text-3xl text-ink mt-1">Compose your code</h2>
        </div>
        <div className="w-full sm:w-auto sm:min-w-[320px]">
          <VerificationBadge
            status={state.status}
            decodedText={state.decodedText}
            failureReason={state.failureReason}
            attempts={state.attempts}
            toneWarning={state.toneWarning}
            geometryOverride={state.geometryOverride}
          />
        </div>
      </div>

      {busy && (
        <div className="mb-4">
          <div className="flex justify-between text-[11px] text-mute mb-1">
            <span className="capitalize">
              {state.phase}{state.status === 'optimizing' ? ` · repairing (attempt ${state.attempts.length})` : ''}
            </span>
            <span>{phasePct}%</span>
          </div>
          <div className="h-1 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className="h-full bg-ink transition-[width] duration-300"
              style={{ width: `${phasePct}%` }}
            />
          </div>
        </div>
      )}

      {/* view tabs */}
      <div className="flex items-center gap-1 rounded-full border border-line bg-white p-1 w-fit mb-5">
        {(['composer', 'lab'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
              view === v ? 'bg-ink text-paper' : 'text-mute hover:text-ink'
            }`}
          >
            {v === 'composer' ? 'Composer' : 'Engine Lab'}
          </button>
        ))}
      </div>

      {view === 'lab' ? (
        <EngineLab
          urlInput={urlInput}
          sourceImg={source?.img ?? null}
          crop={crop}
          adjustments={adjustments}
          dots={dots}
          qr={qr}
          preset={preset}
        />
      ) : (
      <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
        {/* ——— Left column ——— */}
        <div className="space-y-5">
          <Card title="Link" subtitle="The URL encoded in the QR">
            <TextInput
              label="Destination URL"
              value={urlInput}
              onChange={setUrlInput}
              valid={urlInput.trim() === '' ? null : urlCheck.ok}
              error={urlCheck.ok ? null : urlCheck.error}
              placeholder="https://your-site.com"
              hint={<p className="text-[11px] text-mute mt-2 leading-relaxed">
                Encodes <span className="font-mono text-ink/80 break-all">{urlCheck.url}</span>
              </p>}
            />
          </Card>

          <Card title="Image" subtitle="Becomes the coloured dots">
            <div className="space-y-3">
              <ImageUploader onLoaded={onUpload} currentName={source?.name ?? null} />
              {source && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-neutral-50 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {source.kind === 'sample' ? (
                      <span className="w-8 h-8 rounded-md overflow-hidden bg-neutral-200 shrink-0 block">
                        <img src={SAMPLES.find((s) => s.id === source.sampleId)?.src} alt="" className="w-full h-full object-cover" />
                      </span>
                    ) : (
                      <span className="w-8 h-8 rounded-md bg-neutral-200 text-mute flex items-center justify-center shrink-0">
                        <ImagePlus size={14} />
                      </span>
                    )}
                    <span className="text-xs text-ink truncate">{source.name}</span>
                  </div>
                  <button
                    type="button"
                    onClick={removeSource}
                    aria-label="Remove image"
                    className="p-1.5 rounded-md text-mute hover:text-bad hover:bg-red-50 transition-colors shrink-0"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              <p className="text-[11px] text-mute leading-relaxed">
                High-resolution images with clear areas of colour produce the most
                legible dot patterns.
              </p>
            </div>
          </Card>

          <Card title="Sample library" subtitle="24 seeded artworks — click to load">
            <GalleryPanel
              activeId={source?.kind === 'sample' ? source.sampleId ?? null : null}
              onSelect={onSelectSample}
              compact
            />
          </Card>
        </div>

        {/* ——— Center column ——— */}
        <div className="space-y-5">
          <Card title="Preview" subtitle={`Rendered live${sampleLoaded ? '' : ' — loading sample…'}`}>
            <QRPreview
              scene={state.scene}
              plan={state.plan}
              matrix={state.matrix}
              renderOpts={renderOpts}
              photoSource={gen.state.processed?.detail ?? null}
              easing={anim.easing}
              playing={playing}
              onTogglePlaying={() => setPlaying((p) => !p)}
              replayKey={gen.replayKey}
              onReplay={gen.replay}
              empty={!source || !state.plan}
              phase={state.phase}
            />
          </Card>

          <Card title="Export" subtitle="PNG · MP4 · GIF — verified at export resolution">
            <ExportPanel
              status={state.status}
              url={state.url}
              exporting={gen.exporting}
              mp4Ok={gen.mp4Ok}
              exportPNG={gen.exportPNG}
              exportVideo={gen.exportVideo}
              exportGif={gen.exportGif}
            />
          </Card>
        </div>

        {/* ——— Right column ——— */}
        <div className="space-y-5">
          <Card title="Quality" subtitle="Photographic fidelity vs. scan margin">
            <QualitySection preset={preset} onChange={setPreset} />
          </Card>

          <Card title="Modules" subtitle="Shape, size and photographic blend">
            <DotsSection dots={dots} onChange={setDots} />
          </Card>

          <Card title="QR structure" subtitle="Matrix, error correction, frame">
            <QRSection qr={qr} onChange={setQr} />
          </Card>

          <Card title="Image" subtitle="Framing and tone">
            <CropEditor crop={crop} onChangeCrop={setCrop} adjustments={adjustments} onChangeAdjustments={setAdjustments} />
          </Card>

          <Card title="Animation" subtitle="How the dots assemble">
            <AnimationSection anim={anim} onChange={setAnim} />
          </Card>
        </div>
      </div>
      )}
    </section>
  );
}

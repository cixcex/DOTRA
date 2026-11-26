import type {
  DotOptions, QROptions, QualityPreset, DotShape, ECLevel,
  TargetVersion, ImageAdjustments, CropTransform, EasingStyle, AnimationBackground,
} from '@/engine/types';
import type { ParticleControls } from '@/engine/particleEngine';
import { CropEditor } from './CropEditor';
import {
  QUALITY_PRESETS, DOT_SHAPES, ANIMATION_PRESETS, EC_LEVELS, VERSION_BUCKETS, EASINGS, ANIM_BACKGROUNDS,
} from '@/lib/constants';
import { SliderRow, SelectRow, Toggle, SectionLabel, Segmented } from './primitives';

export function OptionChip({
  active, onClick, children, title,
}: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
        active ? 'border-ink bg-ink text-paper shadow-card' : 'border-line bg-white text-ink hover:border-neutral-300'
      }`}
    >
      {children}
    </button>
  );
}

export function QualitySection({
  preset, onChange,
}: { preset: QualityPreset; onChange: (p: QualityPreset) => void }) {
  return (
    <div>
      <SectionLabel>Quality mode</SectionLabel>
      <Segmented
        options={QUALITY_PRESETS.map((p) => ({ id: p.id, label: p.label, hint: p.hint }))}
        value={preset}
        onChange={onChange}
      />
      <p className="text-[11px] text-mute mt-2 leading-relaxed">
        Each mode maps the photograph into scan-safe luminance bands — dark modules stay
        dark, light modules stay bright, hue follows the photo. Every mode is verified;
        if a render ever fails to decode, DOTRA widens the bands automatically.
      </p>
    </div>
  );
}

export function DotsSection({
  dots, onChange,
}: { dots: DotOptions; onChange: (d: DotOptions) => void }) {
  const set = (patch: Partial<DotOptions>) => onChange({ ...dots, ...patch });
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel>Dot shape</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {DOT_SHAPES.map((s) => (
            <OptionChip key={s.id} active={dots.shape === s.id} onClick={() => set({ shape: s.id as DotShape })} title={s.hint}>
              {s.label}
            </OptionChip>
          ))}
        </div>
        <p className="text-[11px] text-mute mt-1.5">{DOT_SHAPES.find((s) => s.id === dots.shape)?.hint}</p>
      </div>
      <SliderRow label="Module size" value={dots.size} min={0.55} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ size: v })} hint="At 88% the modules leave hairline gaps — the photograph shows through between them." />
      <SliderRow label="Spacing" value={dots.spacing} min={0} max={0.35} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ spacing: v })} hint="Gaps between modules — the photograph shows through." />
      <SliderRow label="Light-dot density" value={dots.density} min={0.2} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ density: v })} hint="Fraction of light modules that keep a dot. Dark modules always render — they carry the data." />
      <div className="h-px bg-line" />
      <SectionLabel>Photographic integration</SectionLabel>
      <SliderRow label="Image influence" value={dots.influence} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ influence: v })} hint="How much of the photograph shows through the modules themselves. 0% = pure black & white squares." />
      <SliderRow label="Module contrast" value={dots.moduleContrast} min={0.4} max={1.4} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ moduleContrast: v })} hint="Width of the black/white tone bands. Lower scans safer; higher keeps more photographic range." />
      <Toggle
        label="Colour treatment"
        hint="Keep the photograph's hue inside the modules. Off = strict black & white, like the reference."
        checked={dots.colourTreatment}
        onChange={(v) => set({ colourTreatment: v, ...(v && dots.bwIntensity >= 1 ? { bwIntensity: 0.35 } : {}) })}
      />
      {dots.colourTreatment && (
        <SliderRow label="Black-and-white intensity" value={dots.bwIntensity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ bwIntensity: v })} hint="100% = pure greyscale modules even with colour treatment on." />
      )}
    </div>
  );
}

export function QRSection({
  qr, onChange,
}: { qr: QROptions; onChange: (q: QROptions) => void }) {
  const set = (patch: Partial<QROptions>) => onChange({ ...qr, ...patch });
  return (
    <div className="space-y-4">
      <SelectRow
        label="Error correction"
        value={qr.ecLevel}
        options={EC_LEVELS.map((e) => ({ id: e.id, label: e.label, hint: e.hint }))}
        onChange={(v) => set({ ecLevel: v as ECLevel })}
      />
      <SliderRow label="Outer frame" value={qr.quietZone} min={2} max={8} step={1} format={(v) => `${v} modules`} onChange={(v) => set({ quietZone: v })} hint="White breathing room around the code — scanners need it. 6+ gives the reference artwork its generous frame." />
      <div>
        <SectionLabel>Matrix size</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {VERSION_BUCKETS.map((v) => (
            <OptionChip key={v.id} active={qr.targetVersion === v.id} onClick={() => set({ targetVersion: v.id as TargetVersion })} title={v.hint}>
              {v.label}
            </OptionChip>
          ))}
        </div>
        <p className="text-[11px] text-mute mt-1.5">{VERSION_BUCKETS.find((v) => v.id === qr.targetVersion)?.hint}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <label htmlFor="bgcolor" className="text-[13px] font-medium text-ink">Background</label>
          <p className="text-[11px] text-mute mt-0.5">Quiet zone colour.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="bgcolor"
            type="color"
            value={qr.bgColor}
            onChange={(e) => set({ bgColor: e.target.value })}
            className="w-9 h-9 rounded-lg border border-line bg-white cursor-pointer p-0.5"
            aria-label="Background colour"
          />
          <code className="text-[11px] text-mute uppercase">{qr.bgColor}</code>
        </div>
      </div>
      <Toggle
        label="Perforation border"
        hint="Decorative black perforation squares riding the outer frame. Removed automatically if a repair rung needs the space."
        checked={qr.perforationBorder}
        onChange={(v) => set({ perforationBorder: v })}
      />
      <Toggle
        label="Transparent background"
        hint="Preview only — exports are always composited on white for verification."
        checked={qr.transparentBackground}
        onChange={(v) => set({ transparentBackground: v })}
      />
    </div>
  );
}

export function AnimationSection({
  anim, onChange,
}: {
  anim: ParticleControls & { background: AnimationBackground };
  onChange: (a: ParticleControls & { background: AnimationBackground }) => void;
}) {
  const set = (patch: Partial<ParticleControls & { background: AnimationBackground }>) => onChange({ ...anim, ...patch });
  return (
    <div className="space-y-4">
      <div>
        <SectionLabel>Assembly style</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {ANIMATION_PRESETS.map((p) => (
            <OptionChip key={p.id} active={anim.preset === p.id} onClick={() => set({ preset: p.id })} title={p.hint}>
              {p.label}
            </OptionChip>
          ))}
        </div>
        <p className="text-[11px] text-mute mt-1.5">{ANIMATION_PRESETS.find((p) => p.id === anim.preset)?.hint}</p>
      </div>
      <SliderRow label="Duration" value={anim.duration} min={1.2} max={6} step={0.1} format={(v) => `${v.toFixed(1)}s`} onChange={(v) => set({ duration: v })} />
      <SliderRow label="Speed" value={anim.speed} min={0.25} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ speed: v })} />
      <SliderRow label="Motion intensity" value={anim.intensity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ intensity: v })} />
      <SliderRow label="Start distance" value={anim.startDistance} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ startDistance: v })} />
      <SelectRow
        label="Easing"
        value={anim.easing}
        options={EASINGS.map((e) => ({ id: e.id, label: e.label }))}
        onChange={(v) => set({ easing: v as EasingStyle })}
      />
      <SelectRow
        label="Animation background"
        value={anim.background}
        options={ANIM_BACKGROUNDS.map((b) => ({ id: b.id, label: b.label }))}
        onChange={(v) => set({ background: v as AnimationBackground })}
      />
    </div>
  );
}

export function ImageSection({
  crop, onChangeCrop, adjustments, onChangeAdjustments,
}: {
  crop: CropTransform;
  onChangeCrop: (c: CropTransform) => void;
  adjustments: ImageAdjustments;
  onChangeAdjustments: (a: ImageAdjustments) => void;
}) {
  return <CropEditor crop={crop} onChangeCrop={onChangeCrop} adjustments={adjustments} onChangeAdjustments={onChangeAdjustments} />;
}

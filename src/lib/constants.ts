// ---------------------------------------------------------------------------
// DOTRA — shared UI constants: labels, defaults, export settings
// ---------------------------------------------------------------------------

import type {
  AnimationPreset, DotShape, ECLevel, EasingStyle, QualityPreset,
  TargetVersion, AnimationBackground, ImageAdjustments, CropTransform,
  DotOptions, QROptions,
} from '@/engine/types';
import type { ParticleControls } from '@/engine/particleEngine';

export const QUALITY_PRESETS: { id: QualityPreset; label: string; hint: string }[] = [
  { id: 'resemblance', label: 'Maximum resemblance', hint: 'Photographic colour, darkest tones' },
  { id: 'balanced', label: 'Balanced', hint: 'Colour with a safety margin' },
  { id: 'reliability', label: 'Maximum scan reliability', hint: 'High contrast, conservative tones' },
];

export const DOT_SHAPES: { id: DotShape; label: string; hint: string }[] = [
  { id: 'circle', label: 'Circle', hint: 'Classic DOTRA dot' },
  { id: 'rounded', label: 'Rounded', hint: 'Soft squared dots' },
  { id: 'pixel', label: 'Pixel', hint: 'Sharp square modules' },
  { id: 'fragment', label: 'Fragment', hint: 'True image crops inside each dot' },
  { id: 'soft', label: 'Soft', hint: 'Feathered particle glow' },
];

export const ANIMATION_PRESETS: { id: AnimationPreset; label: string; hint: string }[] = [
  { id: 'gather', label: 'Gather', hint: 'Dots fly in from all directions' },
  { id: 'flow', label: 'Flow', hint: 'Dots sweep in from the left' },
  { id: 'pulse', label: 'Pulse', hint: 'Dots pop in outward from the centre' },
  { id: 'orbit', label: 'Orbit', hint: 'Dots spiral into place' },
  { id: 'reveal', label: 'Reveal', hint: 'Dots cascade top to bottom' },
];

export const EC_LEVELS: { id: ECLevel; label: string; hint: string }[] = [
  { id: 'L', label: 'L · 7%', hint: 'Smallest QR, least redundancy' },
  { id: 'M', label: 'M · 15%', hint: 'Recommended balance' },
  { id: 'Q', label: 'Q · 25%', hint: 'Extra redundancy' },
  { id: 'H', label: 'H · 30%', hint: 'Maximum redundancy — most robust' },
];

export const VERSION_BUCKETS: { id: TargetVersion; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Smallest matrix that fits the link' },
  { id: 'small', label: 'Small', hint: '≈ v4 · 33×33 modules · bold dots' },
  { id: 'medium', label: 'Medium', hint: '≈ v8 · 49×49 modules · ~2.4k dots' },
  { id: 'large', label: 'Large', hint: '≈ v14 · 73×73 modules · ~5.3k dots' },
];

export const EASINGS: { id: EasingStyle; label: string }[] = [
  { id: 'easeOut', label: 'Ease out' },
  { id: 'easeInOut', label: 'Ease in-out' },
  { id: 'spring', label: 'Spring' },
  { id: 'linear', label: 'Linear' },
];

export const ANIM_BACKGROUNDS: { id: AnimationBackground; label: string; css: string }[] = [
  { id: 'white', label: 'White', css: '#ffffff' },
  { id: 'light', label: 'Paper', css: '#fafaf9' },
  { id: 'dark', label: 'Ink', css: '#0a0a0a' },
  { id: 'transparent', label: 'Transparent', css: 'transparent' },
];

export const DEFAULT_DOTS: DotOptions = { shape: 'circle', size: 0.8, spacing: 0.12, density: 1, colorIntensity: 1 };
export const DEFAULT_QR: QROptions = { ecLevel: 'M', quietZone: 4, targetVersion: 'auto', bgColor: '#ffffff', transparentBackground: false };
export const DEFAULT_ADJ: ImageAdjustments = { brightness: 0, contrast: 0, saturation: 0 };
export const DEFAULT_CROP: CropTransform = { zoom: 1, x: 0, y: 0 };
export const DEFAULT_ANIM: ParticleControls & { background: AnimationBackground } = {
  preset: 'gather', duration: 2.4, speed: 1, intensity: 0.5, startDistance: 0.9, easing: 'easeOut', background: 'white',
};

export const PNG_EXPORT_SIZES = [1024, 2048, 4096] as const;
export const VIDEO_EXPORT = { width: 1080, height: 1080, fps: 30, holdSeconds: 1.2 };
export const GIF_EXPORT = { width: 480, height: 480, fps: 12, holdFps: 6, holdSeconds: 1.2 };

export const HERO_DEMO_URL = 'https://dotra.app';

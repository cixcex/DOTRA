// ---------------------------------------------------------------------------
// DOTRA contrast optimizer
//
// Maps sampled image colours onto QR modules while guaranteeing the luminance
// separation that decoders need:
//   * dark modules  → luminance clamped to a "dark cap"
//   * light modules → luminance clamped to a "light floor"
//   * protected structural modules → pure black / pure white
//
// Blending toward black / white is luminance-linear, so the mapped colour keeps
// the hue and saturation of the photograph wherever the tonal range allows.
// ---------------------------------------------------------------------------

import type { QualityPreset, RGB } from '@/engine/types';
import { blendTowardBlack, blendTowardWhite, desaturate, luminance } from './colorUtils';

export interface ToneConstraints {
  darkCap: number; // max luminance of a dark module (0..255)
  lightFloor: number; // min luminance of a light module (0..255)
}

/**
 * Per-preset tone ranges. Lower = safer, higher = prettier.
 * Empirically calibrated against jsQR's area-based binarization (see
 * docs/testing.md): light modules must stay near-white (floor >= ~215),
 * because in blocks without dark modules the local threshold rises toward
 * white and flips mid-light modules to dark. Dark modules stay decodable
 * with caps well above 100.
 */
export const PRESET_TONES: Record<QualityPreset, ToneConstraints> = {
  resemblance: { darkCap: 128, lightFloor: 232 },
  balanced: { darkCap: 105, lightFloor: 238 },
  reliability: { darkCap: 78, lightFloor: 246 },
};

/** Escalation levels applied by the automatic repair loop. */
export const REPAIR_TONES: ToneConstraints[] = [
  { darkCap: 95, lightFloor: 244 },
  { darkCap: 75, lightFloor: 250 },
  { darkCap: 55, lightFloor: 252 },
  { darkCap: 45, lightFloor: 254 },
];

export interface MapColorOptions {
  dark: boolean;
  protectedModule: boolean;
  preset: QualityPreset;
  colorIntensity: number; // 0..1 — how much image colour survives
  repairLevel: number; // 0 = preset tones, 1..4 = escalating repair
  desaturateDark?: number; // extra desaturation for dark modules during repair
}

/** Map one sampled colour to its final module colour. */
export function mapModuleColor(sample: RGB, opts: MapColorOptions): RGB {
  if (opts.protectedModule) {
    return opts.dark ? { r: 8, g: 8, b: 8 } : { r: 255, g: 255, b: 255 };
  }

  // Colour intensity: 0 = pure greyscale QR, 1 = full photographic colour.
  let c = sample;
  if (opts.colorIntensity < 1) {
    const y = luminance(sample);
    const gray = { r: y, g: y, b: y };
    const k = opts.colorIntensity;
    c = {
      r: gray.r + (sample.r - gray.r) * k,
      g: gray.g + (sample.g - gray.g) * k,
      b: gray.b + (sample.b - gray.b) * k,
    };
  }

  const tones = opts.repairLevel <= 0 ? PRESET_TONES[opts.preset] : REPAIR_TONES[Math.min(opts.repairLevel, 4) - 1];
  const y = luminance(c);

  if (opts.dark) {
    let out = c;
    if (y > tones.darkCap) {
      out = blendTowardBlack(out, (y - tones.darkCap) / Math.max(y, 1));
    }
    if (opts.desaturateDark) out = desaturate(out, opts.desaturateDark);
    return out;
  }

  // Light module: lift toward white if too dark.
  if (y < tones.lightFloor) {
    const denom = 255 - y;
    const t = denom > 0.5 ? (tones.lightFloor - y) / denom : 1;
    return blendTowardWhite(c, t);
  }
  return c;
}

/**
 * Analyse a finished dot plan for tonal health.
 * Returns stats the UI uses to warn when an image cannot support
 * strong photographic resemblance (e.g. near-white or flat images).
 */
export interface ToneHealth {
  darkClamped: number; // 0..1 fraction of dark modules that hit the cap
  lightClamped: number; // 0..1 fraction of light modules lifted to the floor
  meanLuminance: number; // of the source sampling
  usable: boolean;
  warning?: string;
}

export function analyzeToneHealth(
  samples: RGB[],
  darkFlags: boolean[],
  tones: ToneConstraints,
): ToneHealth {
  let darkTotal = 0, darkHit = 0, lightTotal = 0, lightHit = 0, sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const y = luminance(samples[i]);
    sum += y;
    if (darkFlags[i]) {
      darkTotal++;
      if (y > tones.darkCap) darkHit++;
    } else {
      lightTotal++;
      if (y < tones.lightFloor) lightHit++;
    }
  }
  const n = Math.max(samples.length, 1);
  const mean = sum / n;
  const darkClamped = darkTotal ? darkHit / darkTotal : 0;
  const lightClamped = lightTotal ? lightHit / lightTotal : 0;

  let warning: string | undefined;
  if (mean > 225) {
    warning = 'This image is very bright. DOTRA will darken the dots automatically, but consider a richer image for stronger resemblance.';
  } else if (mean < 28) {
    warning = 'This image is very dark. DOTRA will lift the light modules automatically, but consider a brighter image for stronger resemblance.';
  } else if (darkClamped > 0.75 && lightClamped > 0.75) {
    warning = 'This image has a limited tonal range. The QR will scan reliably, but colours will be pushed toward black and white.';
  }

  return {
    darkClamped,
    lightClamped,
    meanLuminance: mean,
    usable: true,
    warning,
  };
}

// ---------------------------------------------------------------------------
// DOTRA contrast optimizer — photographic tone bands
//
// The old engine crushed dark modules toward black and light modules toward
// white, which made scans safe but destroyed the photograph. The new engine
// maps each module's sampled colour into a LUMINANCE BAND while preserving
// hue and saturation:
//
//   dark modules  → luminance remapped into [darkLo, darkCap]
//   light modules → luminance remapped into [lightFloor, lightCap]
//
// The remap is a proportional RGB scale around the sampled luminance, so the
// dot keeps the exact hue of the photograph — only its brightness is pinned
// into the band the QR matrix requires. The two bands are separated by a wide
// neutral gap (≈ 100+ luminance levels) which is what decoders actually need;
// everything in between is free for photographic colour.
//
// Bands are empirically calibrated against jsQR's area-based local
// binarization (see docs/testing-report.md): in blocks without dark modules
// the local threshold rises toward white, so light modules must stay bright
// (floor ≥ ~230); dark modules stay decodable with caps well above 80.
// ---------------------------------------------------------------------------

import type { QualityPreset, RGB } from '@/engine/types';
import { blendTowardWhite, liftToLuminance, scaleToLuminance, luminance, clamp } from './colorUtils';

export interface ToneConstraints {
  darkLo: number; // min luminance of a dark-module dot
  darkCap: number; // max luminance of a dark-module dot
  lightFloor: number; // min luminance of a light-module dot
  lightCap: number; // max luminance of a light-module dot
  chromaBoost: number; // >1 saturates light-module dots to offset band compression
}

/**
 * Per-mode tone bands. PHOTO keeps the widest bands (most photographic
 * tonal range); SCAN narrows them for maximum decoder margin.
 */
export const PRESET_TONES: Record<QualityPreset, ToneConstraints> = {
  photo: { darkLo: 10, darkCap: 118, lightFloor: 230, lightCap: 250, chromaBoost: 1.25 },
  balanced: { darkLo: 8, darkCap: 104, lightFloor: 236, lightCap: 251, chromaBoost: 1.12 },
  scan: { darkLo: 5, darkCap: 84, lightFloor: 242, lightCap: 252, chromaBoost: 1.0 },
};

/** Escalation levels applied by the automatic repair loop (repairLevel 1..4). */
export const REPAIR_TONES: ToneConstraints[] = [
  { darkLo: 6, darkCap: 100, lightFloor: 238, lightCap: 251, chromaBoost: 1.1 },
  { darkLo: 5, darkCap: 84, lightFloor: 242, lightCap: 252, chromaBoost: 1.05 },
  { darkLo: 4, darkCap: 70, lightFloor: 246, lightCap: 253, chromaBoost: 1.0 },
  { darkLo: 3, darkCap: 56, lightFloor: 250, lightCap: 254, chromaBoost: 1.0 },
];

export interface MapColorOptions {
  dark: boolean;
  protectedModule: boolean;
  preset: QualityPreset;
  colorIntensity: number; // 0..1 — how much image colour survives
  repairLevel: number; // 0 = preset bands, 1..4 = escalating repair
  desaturateDark?: number; // extra desaturation for dark modules during repair
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Map one sampled colour into its module's luminance band, preserving hue. */
export function mapModuleColor(sample: RGB, opts: MapColorOptions): RGB {
  if (opts.protectedModule) {
    return opts.dark ? { r: 8, g: 8, b: 8 } : { r: 255, g: 255, b: 255 };
  }

  // Colour intensity: 0 = pure greyscale QR, 1 = full photographic colour.
  let c = sample;
  if (opts.colorIntensity < 1) {
    const y = luminance(sample);
    const k = opts.colorIntensity;
    c = {
      r: y + (sample.r - y) * k,
      g: y + (sample.g - y) * k,
      b: y + (sample.b - y) * k,
    };
  }

  const tones = opts.repairLevel <= 0 ? PRESET_TONES[opts.preset] : REPAIR_TONES[Math.min(Math.max(opts.repairLevel, 1), 4) - 1];
  const y = luminance(c);

  if (opts.dark) {
    // Dark module: compress the sampled tone into the dark band. Pure
    // proportional down-scale — hue is preserved exactly, nothing clips.
    const target = tones.darkLo + (clamp255(y) / 255) * (tones.darkCap - tones.darkLo);
    let out = scaleToLuminance(c, y, target);
    if (opts.desaturateDark) {
      const y2 = luminance(out);
      const k = opts.desaturateDark;
      out = { r: y2 + (out.r - y2) * (1 - k), g: y2 + (out.g - y2) * (1 - k), b: y2 + (out.b - y2) * (1 - k) };
    }
    return out;
  }

  // Light module: lift into the light band (hue-safe two-stage lift), then
  // re-saturate to compensate for the compression of the photograph's bright
  // tonal range into a narrow bright band.
  const target = tones.lightFloor + (clamp255(y) / 255) * (tones.lightCap - tones.lightFloor);
  let out = y < 24
    ? blendTowardWhite(c, clamp((target - y) / Math.max(255 - y, 0.5), 0, 1))
    : liftToLuminance(c, y, target);
  if (tones.chromaBoost > 1) {
    const y2 = luminance(out);
    const k = tones.chromaBoost;
    out = {
      r: clamp255(y2 + (out.r - y2) * k),
      g: clamp255(y2 + (out.g - y2) * k),
      b: clamp255(y2 + (out.b - y2) * k),
    };
  }
  return out;
}

/**
 * Analyse a finished dot plan for tonal health.
 * Returns stats the UI uses to warn when an image cannot support
 * strong photographic resemblance (e.g. near-white or flat images).
 */
export interface ToneHealth {
  darkClamped: number; // 0..1 fraction of dark modules compressed by the band
  lightClamped: number; // 0..1 fraction of light modules lifted by the band
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
  if (mean > 228) {
    warning = 'This image is very bright. DOTRA keeps the light band bright for scanning — consider a richer image for stronger photographic depth.';
  } else if (mean < 30) {
    warning = 'This image is very dark. DOTRA lifts light modules into the bright band automatically — consider a brighter image for stronger resemblance.';
  } else if (darkClamped > 0.75 && lightClamped > 0.75) {
    warning = 'This image has a limited tonal range. Dots stay within their scan-safe bands, so colours are pushed toward the extremes.';
  }

  return {
    darkClamped,
    lightClamped,
    meanLuminance: mean,
    usable: true,
    warning,
  };
}

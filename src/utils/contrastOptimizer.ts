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
  // Photographic integration (v3)
  influence?: number; // 0..1 — photograph visible through the module (default 1 = full band colour)
  moduleContrast?: number; // 0.4..1.4 — scales band width around its centre (clamped to the safe envelope)
  bwIntensity?: number; // 0..1 — desaturation of the photo contribution (1 = pure greyscale)
  colourTreatment?: boolean; // keep photo hue (default false = black & white modules)
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Scale a band around its centre, clamped to the decoder-safe envelope. */
function scaledBand(lo: number, hi: number, k: number, minLo: number, maxHi: number): { lo: number; hi: number } {
  const c = (lo + hi) / 2;
  const h = ((hi - lo) / 2) * k;
  return { lo: Math.max(minLo, c - h), hi: Math.min(maxHi, c + h) };
}

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

const grayOf = (c: RGB): RGB => {
  const y = luminance(c);
  return { r: y, g: y, b: y };
};

/**
 * Map one sampled colour into its module's luminance band, preserving hue,
 * then apply the v3 photographic-integration display transform:
 *   band colour → (optionally greyscale / desaturated) → lerp toward the
 *   black/white pole by (1 - influence).
 * Because the band mapping already pins luminance into a decoder-safe band and
 * the poles are pure black / white, EVERY influence level stays scan-safe.
 */
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

  const base = opts.repairLevel <= 0 ? PRESET_TONES[opts.preset] : REPAIR_TONES[Math.min(Math.max(opts.repairLevel, 1), 4) - 1];
  const k = opts.moduleContrast ?? 1;
  const dk = scaledBand(base.darkLo, base.darkCap, k, 2, 160);
  const lt = scaledBand(base.lightFloor, base.lightCap, k, 215, 254);
  const tones = { darkLo: dk.lo, darkCap: dk.hi, lightFloor: lt.lo, lightCap: lt.hi, chromaBoost: base.chromaBoost };
  const y = luminance(c);

  let banded: RGB;
  if (opts.dark) {
    // Dark module: compress the sampled tone into the dark band. Pure
    // proportional down-scale — hue is preserved exactly, nothing clips.
    const target = tones.darkLo + (clamp255(y) / 255) * (tones.darkCap - tones.darkLo);
    banded = scaleToLuminance(c, y, target);
    if (opts.desaturateDark) {
      const y2 = luminance(banded);
      const dk2 = opts.desaturateDark;
      banded = { r: y2 + (banded.r - y2) * (1 - dk2), g: y2 + (banded.g - y2) * (1 - dk2), b: y2 + (banded.b - y2) * (1 - dk2) };
    }
  } else {
    // Light module: lift into the light band (hue-safe two-stage lift), then
    // re-saturate to compensate for the compression of the photograph's bright
    // tonal range into a narrow bright band.
    const target = tones.lightFloor + (clamp255(y) / 255) * (tones.lightCap - tones.lightFloor);
    banded = y < 24
      ? blendTowardWhite(c, clamp((target - y) / Math.max(255 - y, 0.5), 0, 1))
      : liftToLuminance(c, y, target);
    if (tones.chromaBoost > 1) {
      const y2 = luminance(banded);
      const boost = tones.chromaBoost;
      banded = {
        r: clamp255(y2 + (banded.r - y2) * boost),
        g: clamp255(y2 + (banded.g - y2) * boost),
        b: clamp255(y2 + (banded.b - y2) * boost),
      };
    }
  }

  // -- v3 display transform -------------------------------------------------
  // Black-and-white intensity: 1 = pure greyscale modules (the reference look).
  let out = banded;
  const bw = opts.bwIntensity ?? 1;
  if (bw < 1) out = mix(out, grayOf(out), bw);
  if (!opts.colourTreatment) out = grayOf(out); // colour treatment OFF → strict B&W

  // Image influence: blend toward the pure black/white pole. The result can
  // only get MORE decoder-safe — poles are the extremes of the safe envelope.
  const influence = opts.influence ?? 1;
  if (influence < 1) {
    const pole: RGB = opts.dark ? { r: 8, g: 8, b: 8 } : { r: 255, g: 255, b: 255 };
    out = mix(pole, out, influence);
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

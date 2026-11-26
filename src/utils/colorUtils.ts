// ---------------------------------------------------------------------------
// DOTRA colour utilities — RGB / HSL conversions, luminance, blending
// ---------------------------------------------------------------------------

import type { RGB } from '@/engine/types';

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): RGB {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  if (Number.isNaN(n) || s.length !== 6) return { r: 255, g: 255, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Rec.709 relative luminance, 0..255 scale. */
export function luminance({ r, g, b }: RGB): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number): RGB {
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/** Blend a colour toward black; `t` in [0,1]. Preserves hue. */
export function blendTowardBlack(c: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return { r: c.r * (1 - k), g: c.g * (1 - k), b: c.b * (1 - k) };
}

/** Blend a colour toward white; `t` in [0,1]. Preserves hue. */
export function blendTowardWhite(c: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return { r: c.r + (255 - c.r) * k, g: c.g + (255 - c.g) * k, b: c.b + (255 - c.b) * k };
}

/**
 * Scale a colour proportionally so its luminance becomes `target`.
 * Down-scaling never clips — hue is preserved exactly. Used for dark modules.
 */
export function scaleToLuminance(c: RGB, y: number, target: number): RGB {
  if (y <= 0.5) return { r: target, g: target, b: target };
  const k = target / y;
  return { r: clamp(c.r * k, 0, 255), g: clamp(c.g * k, 0, 255), b: clamp(c.b * k, 0, 255) };
}

/**
 * Hue-safe luminance LIFT for light modules: scale proportionally until the
 * brightest channel would clip, then blend the residual toward white
 * (white-blending preserves hue exactly). The result lands on `target`.
 */
export function liftToLuminance(c: RGB, y: number, target: number): RGB {
  if (y <= 0.5) return { r: target, g: target, b: target };
  const k = target / y;
  const mx = Math.max(c.r, c.g, c.b);
  const kMax = mx > 0 ? Math.min(k, 255 / mx) : k;
  let r = c.r * kMax, g = c.g * kMax, b = c.b * kMax;
  if (kMax < k - 1e-6) {
    const y2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const t = clamp((target - y2) / Math.max(255 - y2, 0.5), 0, 1);
    r = r + (255 - r) * t;
    g = g + (255 - g) * t;
    b = b + (255 - b) * t;
  }
  return { r, g, b };
}

/** Blend a colour toward neutral grey (desaturation); `t` in [0,1]. */
export function desaturate(c: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  const y = luminance(c);
  return { r: c.r + (y - c.r) * k, g: c.g + (y - c.g) * k, b: c.b + (y - c.b) * k };
}

export function cssRgb(c: RGB): string {
  return `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;
}

/** Quantise a colour to 4 bits/channel for sprite caching. */
export function colorBucket(c: RGB): number {
  const q = (v: number) => clamp(Math.round((v / 255) * 15), 0, 15);
  return (q(c.r) << 8) | (q(c.g) << 4) | q(c.b);
}

/** Quantised colour for sprite keys. */
export function bucketColor(c: RGB): RGB {
  const q = (v: number) => Math.round((clamp(Math.round(v / 17), 0, 15) * 17 + 8) / 255 * 255);
  return { r: q(c.r), g: q(c.g), b: q(c.b) };
}

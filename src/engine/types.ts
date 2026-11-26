// ---------------------------------------------------------------------------
// DOTRA — shared types for the QR / image / animation pipeline
// ---------------------------------------------------------------------------

export type RGB = { r: number; g: number; b: number };

export type ECLevel = 'L' | 'M' | 'Q' | 'H';

export type DotShape = 'circle' | 'rounded' | 'pixel' | 'fragment' | 'soft';

export type QualityPreset = 'resemblance' | 'balanced' | 'reliability';

export type AnimationPreset = 'gather' | 'flow' | 'pulse' | 'orbit' | 'reveal';

export type EasingStyle = 'easeOut' | 'easeInOut' | 'spring' | 'linear';

export type AnimationBackground = 'white' | 'light' | 'dark' | 'transparent';

export type TargetVersion = 'auto' | 'small' | 'medium' | 'large';

export type VerificationStatus = 'idle' | 'working' | 'optimizing' | 'verified' | 'failed';

/** Image adjustments applied before colours are sampled. */
export interface ImageAdjustments {
  brightness: number; // -100 .. +100
  contrast: number; // -100 .. +100
  saturation: number; // -100 .. +100
}

/** Controls for how the uploaded image is mapped onto the QR area. */
export interface CropTransform {
  zoom: number; // 1 .. 4  (1 = cover fit)
  x: number; // -0.5 .. 0.5 offset in normalized image space
  y: number; // -0.5 .. 0.5
}

/** Per-dot visual options. */
export interface DotOptions {
  shape: DotShape;
  size: number; // 0.55 .. 1  — fraction of a module
  spacing: number; // 0 .. 0.35 — gap fraction of a module between dots
  density: number; // 0 .. 1 — fraction of light modules that keep a coloured dot
  colorIntensity: number; // 0 .. 1 — how strongly dot colours deviate from B/W
}

/** Structural QR options. */
export interface QROptions {
  ecLevel: ECLevel;
  quietZone: number; // modules, 2..8
  targetVersion: TargetVersion;
  bgColor: string; // CSS colour for the quiet zone / background
  transparentBackground: boolean;
}

/** Quality presets balance image resemblance vs scan reliability. */
export interface QualityOptions {
  preset: QualityPreset;
}

/** Everything needed to render one finished dot-QR. */
export interface RenderConfig {
  url: string;
  image: HTMLCanvasElement | null; // preprocessed square image (matrix-resolution source)
  adjustments: ImageAdjustments;
  crop: CropTransform;
  dots: DotOptions;
  qr: QROptions;
  quality: QualityOptions;
  scale: number; // px per module (output canvas = (N + 2*quiet) * scale)
}

/** A single rendered dot (one QR module). */
export interface Dot {
  col: number; // module coordinates
  row: number;
  dark: boolean; // encoded value — never changed for looks
  protectedModule: boolean; // finder / timing / alignment / format / version
  color: RGB; // final display colour
}

export interface MatrixInfo {
  size: number; // modules per side
  version: number;
  ecLevel: ECLevel;
  isDark: (row: number, col: number) => boolean;
  isFunctionModule: (row: number, col: number) => boolean;
}

/** Result of decoding a rendered QR image. */
export interface DecodeResult {
  ok: boolean;
  text: string | null;
  reason?: string;
}

export type GenerationPhase =
  | 'idle'
  | 'analyzing'
  | 'matrix'
  | 'rendering'
  | 'animating'
  | 'verifying'
  | 'optimizing'
  | 'done'
  | 'failed';

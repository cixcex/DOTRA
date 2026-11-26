// Type declarations for scripts/pngkit.mjs (dependency-free Node PNG toolkit).

export interface PngImg {
  w: number;
  h: number;
  data: Uint8ClampedArray; // RGBA
}

export type RgbTuple = [number, number, number];
export type RgbaTuple = [number, number, number, number];
/** Scripts build colours from helpers that return plain number arrays. */
export type ColorInput = RgbTuple | number[];

export function encodePNG(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array;
export function savePNG(path: string, width: number, height: number, rgba: Uint8ClampedArray): void;
export function makeImage(w: number, h: number): PngImg;
export function setPx(img: PngImg, x: number, y: number, r: number, g: number, b: number, a?: number): void;
export function getPx(img: PngImg, x: number, y: number): number[];
export function fillRect(img: PngImg, x0: number, y0: number, w: number, h: number, color: ColorInput, alpha?: number): void;
export function fillCircle(img: PngImg, cx: number, cy: number, r: number, color: ColorInput, alpha?: number): void;
export function forEachPixel(img: PngImg, fn: (x: number, y: number) => number[] | void): void;
export const clamp255: (v: number) => number;
export function lerp(a: number, b: number, t: number): number;
export function mixc(c1: ColorInput, c2: ColorInput, t: number): number[];
export function gradient(stops: Array<[number, ColorInput]>): (t: number) => number[];
export function mulberry32(seed: number): () => number;
export function makeNoise2D(seed?: number): (x: number, y: number, scale?: number) => number;
export function sampleImage(img: PngImg, u: number, v: number): number[];
export function drawCover(dst: PngImg, src: PngImg, dx: number, dy: number, size: number): void;

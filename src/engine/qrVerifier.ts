// ---------------------------------------------------------------------------
// DOTRA QR verifier
//
// Decodes the ACTUAL rendered QR image (not the internal matrix) with jsQR and
// compares it against the URL the user entered. This is the non-negotiable
// gate: downloads only unlock when the real exported image decodes correctly.
// ---------------------------------------------------------------------------

import jsQR from 'jsqr';
import type { DecodeResult } from './types';

type VerifyWorker = Worker & {
  postMessage: (msg: { data: Uint8ClampedArray; width: number; height: number }) => void;
};

let worker: VerifyWorker | null = null;
let workerFailed = false;

function getWorker(): VerifyWorker | null {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/qrDecode.worker.ts', import.meta.url), {
      type: 'module',
    }) as VerifyWorker;
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

/** Decode raw RGBA pixels with jsQR (main-thread fallback path). */
export function decodePixels(data: Uint8ClampedArray, width: number, height: number): DecodeResult {
  try {
    const result = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
    if (result) return { ok: true, text: result.data };
    return { ok: false, text: null, reason: 'No QR code found in the image.' };
  } catch (err) {
    return { ok: false, text: null, reason: err instanceof Error ? err.message : 'Decoder error.' };
  }
}

/** Decode the contents of a canvas element. */
export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<DecodeResult> {
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const w = imageData.width, h = imageData.height;

  const wkr = getWorker();
  if (wkr) {
    return new Promise<DecodeResult>((resolve) => {
      const buf = imageData.data.buffer.slice(0) as ArrayBuffer;
      const timer = setTimeout(() => {
        workerFailed = true;
        resolve(decodePixels(new Uint8ClampedArray(imageData.data), w, h));
      }, 4000);
      wkr.onmessage = (e: MessageEvent<{ text: string | null; error?: string }>) => {
        clearTimeout(timer);
        if (e.data.text != null) resolve({ ok: true, text: e.data.text });
        else resolve({ ok: false, text: null, reason: e.data.error ?? 'No QR code found.' });
      };
      wkr.onmessageerror = () => {
        clearTimeout(timer);
        workerFailed = true;
        resolve(decodePixels(new Uint8ClampedArray(imageData.data), w, h));
      };
      wkr.postMessage({ data: new Uint8ClampedArray(buf), width: w, height: h }, [buf]);
    });
  }

  return decodePixels(new Uint8ClampedArray(imageData.data), w, h);
}

/**
 * Compare a decoded string with the URL the user entered.
 * Strict by default; reports "close" mismatches for better error messages.
 */
export function compareUrls(expected: string, decoded: string | null): { match: boolean; close: boolean } {
  if (decoded == null) return { match: false, close: false };
  const a = expected.trim();
  const b = decoded.trim();
  if (a === b) return { match: true, close: true };
  const norm = (s: string) => s.toLowerCase().replace(/\/+$/, '');
  if (norm(a) === norm(b)) return { match: true, close: true };
  return { match: false, close: false };
}

export interface VerificationOutcome {
  verified: boolean;
  decoded: string | null;
  match: boolean;
  close: boolean;
  reason?: string;
}

/** Full verification of a rendered canvas against the original URL. */
export async function verifyCanvas(canvas: HTMLCanvasElement, expectedUrl: string): Promise<VerificationOutcome> {
  const result = await decodeCanvas(canvas);
  if (!result.ok) {
    return { verified: false, decoded: null, match: false, close: false, reason: result.reason };
  }
  const { match, close } = compareUrls(expectedUrl, result.text);
  return { verified: match, decoded: result.text, match, close };
}

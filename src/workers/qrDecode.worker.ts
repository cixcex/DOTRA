// DOTRA verification worker — decodes a rendered QR image with jsQR off the
// main thread. Receives transferable ImageData buffers, returns the decoded
// text (or null). Falls back to main-thread decoding if workers are blocked.
import jsQR from 'jsqr';

export interface DecodeRequest {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export interface DecodeResponse {
  text: string | null;
  error?: string;
}

const ctx: Worker = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<DecodeRequest>) => {
  try {
    const { data, width, height } = e.data;
    const result = jsQR(data, width, height, {
      inversionAttempts: 'dontInvert',
    });
    const resp: DecodeResponse = { text: result ? result.data : null };
    ctx.postMessage(resp);
  } catch (err) {
    ctx.postMessage({ text: null, error: err instanceof Error ? err.message : 'decode error' });
  }
};

export {};

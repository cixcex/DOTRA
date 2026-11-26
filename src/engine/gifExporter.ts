// ---------------------------------------------------------------------------
// DOTRA GIF exporter — gifenc, chunked with progress, UI never freezes.
// ---------------------------------------------------------------------------

import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { renderAnimationFrame, type FrameSource } from './animationFrames';

export interface GifExportOptions {
  width: number;
  height: number;
  fps: number; // animation frames per second (hold frames use a longer delay)
  holdFps: number; // lower fps for the static hold → smaller file
  onProgress: (done: number, total: number) => void;
}

export async function exportGIF(src: FrameSource, canvas: HTMLCanvasElement, opts: GifExportOptions): Promise<Blob> {
  const { width, height, fps, holdFps, onProgress } = opts;
  canvas.width = width;
  canvas.height = height;

  const animFrames = Math.max(1, Math.round(src.scene.duration * fps));
  const holdFrames = Math.max(1, Math.round(src.holdSeconds * holdFps));
  const totalFrames = animFrames + holdFrames;

  const gif = GIFEncoder();
  const ctx = canvas.getContext('2d')!;

  for (let i = 0; i < totalFrames; i++) {
    const inHold = i >= animFrames;
    // hold frames render the final static state (u = 1)
    renderAnimationFrame(canvas, src, inHold ? animFrames : i);

    const imageData = ctx.getImageData(0, 0, width, height);
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette);
    const delay = inHold ? Math.round(1000 / holdFps) : Math.round(1000 / fps);
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      first: i === 0,
      repeat: 0, // loop forever
    });

    if (i % 4 === 0) {
      onProgress(i, totalFrames);
      await new Promise((r) => setTimeout(r, 0)); // keep UI alive
    }
  }

  gif.finish();
  onProgress(totalFrames, totalFrames);
  const bytes = gif.bytes();
  const copy = bytes.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Blob([copy.buffer as ArrayBuffer], { type: 'image/gif' });
}

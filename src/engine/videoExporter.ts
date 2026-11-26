// ---------------------------------------------------------------------------
// DOTRA video exporter
//
// Primary path: WebCodecs VideoEncoder (H.264 / AV1 / VP9) + mp4-muxer →
// a genuine .mp4 file, encoded off the main thread.
// Fallback path: MediaRecorder canvas capture → WebM (or MP4 where the
// platform supports it), with a clear note in the UI. Never fails silently.
// ---------------------------------------------------------------------------

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { renderAnimationFrame, type FrameSource } from './animationFrames';

export interface VideoExportResult {
  blob: Blob;
  extension: 'mp4' | 'webm';
  usedFallback: boolean;
  note?: string;
}

const CODEC_CANDIDATES: { codec: string; muxerCodec: 'avc' | 'av1' | 'vp9' }[] = [
  { codec: 'avc1.420028', muxerCodec: 'avc' }, // H.264 Baseline L4.0 — 1080p30
  { codec: 'avc1.42001E', muxerCodec: 'avc' },
  { codec: 'avc1.640028', muxerCodec: 'avc' }, // High L4.0
  { codec: 'av01.0.04M.08', muxerCodec: 'av1' },
  { codec: 'vp09.00.10.08', muxerCodec: 'vp9' },
];

function pickMuxerCodec(codec: string): 'avc' | 'av1' | 'vp9' {
  if (codec.startsWith('avc')) return 'avc';
  if (codec.startsWith('av01')) return 'av1';
  return 'vp9';
}

async function probeCodec(codec: string, width: number, height: number, fps: number) {
  try {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: 6_000_000,
      framerate: fps,
    });
    return support.supported ? support.config ?? null : null;
  } catch {
    return null;
  }
}

/**
 * Export the particle animation as MP4 via WebCodecs.
 * Throws { code: 'webcodecs-unavailable' } when the platform cannot encode,
 * so the caller can fall back to MediaRecorder.
 */
export async function exportMP4WebCodecs(
  src: FrameSource,
  canvas: HTMLCanvasElement,
  onProgress: (done: number, total: number) => void,
): Promise<VideoExportResult> {
  if (typeof VideoEncoder === 'undefined') {
    throw { code: 'webcodecs-unavailable' } as unknown as Error;
  }

  const width = canvas.width;
  const height = canvas.height;
  const fps = src.fps;
  const totalFrames = Math.round(src.scene.duration * fps) + Math.round(src.holdSeconds * fps);
  const frameDurationUs = Math.round(1_000_000 / fps);
  const bitrate = Math.min(20_000_000, Math.max(2_000_000, Math.round(width * height * fps * 0.14)));

  let chosen: { codec: string; muxerCodec: 'avc' | 'av1' | 'vp9' } | null = null;
  for (const candidate of CODEC_CANDIDATES) {
    const cfg = await probeCodec(candidate.codec, width, height, fps);
    if (cfg) {
      chosen = candidate;
      break;
    }
  }
  if (!chosen) throw { code: 'webcodecs-unavailable' } as unknown as Error;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: chosen.muxerCodec, width, height },
    fastStart: 'in-memory',
  });

  let failed = false;
  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      muxer.addVideoChunk(chunk, metadata);
    },
    error: () => {
      failed = true;
    },
  });

  encoder.configure({
    codec: chosen.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'quality',
  } as VideoEncoderConfig);

  for (let i = 0; i < totalFrames; i++) {
    renderAnimationFrame(canvas, src, i);
    const frame = new VideoFrame(canvas, {
      timestamp: i * frameDurationUs,
      duration: frameDurationUs,
    });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (i % 10 === 0) onProgress(i, totalFrames);
    // keep UI responsive
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
  muxer.finalize();

  if (failed) {
    throw { code: 'encode-failed' } as unknown as Error;
  }

  const buffer = muxer.target.buffer;
  const blob = new Blob([buffer], { type: 'video/mp4' });
  onProgress(totalFrames, totalFrames);
  return { blob, extension: 'mp4', usedFallback: false };
}

/**
 * MediaRecorder fallback — captures the canvas live while the animation plays.
 * Produces WebM (or MP4 on platforms that support it in MediaRecorder).
 */
export async function exportVideoMediaRecorder(
  src: FrameSource,
  canvas: HTMLCanvasElement,
  onProgress: (done: number, total: number) => void,
): Promise<VideoExportResult> {
  const fps = src.fps;
  const totalFrames = Math.round(src.scene.duration * fps) + Math.round(src.holdSeconds * fps);
  const totalMs = (totalFrames / fps) * 1000;

  const mimeCandidates = ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mime = '';
  for (const m of mimeCandidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) {
        mime = m;
        break;
      }
    } catch {
      /* keep looking */
    }
  }
  if (!mime) {
    throw { code: 'mediarecorder-unavailable' } as unknown as Error;
  }

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 8_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(200);

  // Play the timeline in real time onto the captured canvas.
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsed = performance.now() - start;
      const i = Math.min(totalFrames - 1, Math.floor((elapsed / 1000) * fps));
      renderAnimationFrame(canvas, src, i);
      onProgress(i + 1, totalFrames);
      if (elapsed >= totalMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  await done;

  const blob = new Blob(chunks, { type: mime });
  const isMp4 = mime.startsWith('video/mp4');
  return {
    blob,
    extension: isMp4 ? 'mp4' : 'webm',
    usedFallback: true,
    note: isMp4
      ? 'Exported with the browser recorder.'
      : 'This browser cannot encode MP4 directly, so a WebM file was exported instead. It plays in all modern browsers and can be converted to MP4 with any video tool.',
  };
}

/** Top-level export: MP4 when possible, clearly-labelled fallback otherwise. */
export async function exportAnimationVideo(
  src: FrameSource,
  canvas: HTMLCanvasElement,
  onProgress: (done: number, total: number) => void,
): Promise<VideoExportResult> {
  try {
    return await exportMP4WebCodecs(src, canvas, onProgress);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== 'webcodecs-unavailable' && code !== 'encode-failed') throw err;
    return exportVideoMediaRecorder(src, canvas, onProgress);
  }
}

/** True when the WebCodecs MP4 path is available (for UI hints). */
export async function mp4Supported(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  for (const c of CODEC_CANDIDATES) {
    const cfg = await probeCodec(c.codec, 1080, 1080, 30);
    if (cfg) return true;
  }
  return false;
}

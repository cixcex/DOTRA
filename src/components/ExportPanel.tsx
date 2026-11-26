import { useState } from 'react';
import { FileImage, Film, ImageDown, Check, Loader2, ShieldCheck } from 'lucide-react';
import { PNG_EXPORT_SIZES, VIDEO_EXPORT, GIF_EXPORT } from '@/lib/constants';
import type { VerificationStatus } from '@/engine/types';
import type { VideoExportResult } from '@/engine/videoExporter';
import { Button } from './primitives';

type PngState = 'idle' | 'working' | 'done' | 'error';
type MediaState = 'idle' | 'working' | 'done' | 'error';

function hostLabel(url: string | null): string {
  if (!url) return 'qr';
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^\w.-]/g, '');
  } catch {
    return 'qr';
  }
}

export function ExportPanel({
  status, url, exporting, mp4Ok, exportPNG, exportVideo, exportGif,
}: {
  status: VerificationStatus;
  url: string | null;
  exporting: string | null;
  mp4Ok: boolean | null;
  exportPNG: (px: number) => Promise<{ ok: boolean; reason?: string }>;
  exportVideo: () => Promise<VideoExportResult | { ok: false; reason: string }>;
  exportGif: (onProgress: (done: number, total: number) => void) => Promise<Blob | null>;
}) {
  const [pngs, setPngs] = useState<Record<number, PngState>>({ 1024: 'idle', 2048: 'idle', 4096: 'idle' });
  const [pngErr, setPngErr] = useState<string | null>(null);
  const [video, setVideo] = useState<MediaState>('idle');
  const [videoNote, setVideoNote] = useState<string | null>(null);
  const [gif, setGif] = useState<MediaState>('idle');
  const [gifProg, setGifProg] = useState(0);

  const gated = status !== 'verified';
  const busy = exporting !== null;
  const host = hostLabel(url);
  const base = `dotra-${host}`;

  const runPng = async (px: number) => {
    setPngErr(null);
    setPngs((p) => ({ ...p, [px]: 'working' }));
    const r = await exportPNG(px);
    setPngs((p) => ({ ...p, [px]: r.ok ? 'done' : 'error' }));
    if (!r.ok) setPngErr(r.reason ?? 'Export failed.');
  };

  const runVideo = async () => {
    setVideoNote(null);
    setVideo('working');
    const r = await exportVideo();
    if ('ok' in r) {
      setVideo('error');
      setVideoNote(r.reason);
      return;
    }
    setVideo('done');
    if (r.usedFallback) setVideoNote(r.note ?? 'Exported as WebM (MP4 not supported here).');
  };

  const runGif = async () => {
    setGif('working');
    setGifProg(0);
    const blob = await exportGif((d, t) => setGifProg(t > 0 ? d / t : 0));
    setGif(blob ? 'done' : 'error');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-lg border border-line bg-neutral-50 px-3 py-2.5">
        <ShieldCheck size={14} className="text-ok shrink-0 mt-px" />
        <p className="text-[11px] text-mute leading-relaxed">
          Downloads unlock after jsQR verifies the rendered QR. Every export is
          re-decoded at its own resolution before it reaches your device.
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-mute mb-2">PNG</p>
        <div className="grid grid-cols-3 gap-2">
          {PNG_EXPORT_SIZES.map((px) => {
            const st = pngs[px];
            return (
              <Button
                key={px}
                variant={st === 'done' ? 'secondary' : 'primary'}
                size="sm"
                disabled={gated || busy}
                loading={st === 'working'}
                onClick={() => void runPng(px)}
                className="flex-col !items-center gap-0.5 h-auto py-2.5"
              >
                <span className="flex items-center gap-1.5">
                  <FileImage size={13} />
                  {px}px
                </span>
                <span className="text-[10px] opacity-70 font-normal">
                  {st === 'done' ? 'verified ✓' : st === 'error' ? 'failed' : 'square'}
                </span>
              </Button>
            );
          })}
        </div>
        {pngErr && <p className="text-[11px] text-bad mt-1.5">{pngErr}</p>}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-mute mb-2">Video</p>
        <Button
          variant="primary"
          size="sm"
          disabled={gated || busy}
          loading={video === 'working'}
          onClick={() => void runVideo()}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <Film size={14} />
            MP4 · {VIDEO_EXPORT.width}p · {VIDEO_EXPORT.fps}fps
          </span>
          {video === 'done' && <Check size={14} />}
        </Button>
        {mp4Ok === false && (
          <p className="text-[11px] text-warn mt-1.5 leading-relaxed">
            This browser can't encode MP4 directly — DOTRA will deliver a WebM file
            (same motion, broadly compatible player support).
          </p>
        )}
        {mp4Ok === null && !gated && (
          <p className="text-[11px] text-mute mt-1.5">Checking video encoding support…</p>
        )}
        {videoNote && (
          <p className={`text-[11px] mt-1.5 leading-relaxed ${video === 'error' ? 'text-bad' : 'text-mute'}`}>{videoNote}</p>
        )}
        {video === 'error' && !videoNote && <p className="text-[11px] text-bad mt-1.5">Video export failed in this browser.</p>}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-mute mb-2">GIF</p>
        <Button
          variant="primary"
          size="sm"
          disabled={gated || busy}
          loading={gif === 'working'}
          onClick={() => void runGif()}
          className="w-full justify-between"
        >
          <span className="flex items-center gap-2">
            <ImageDown size={14} />
            GIF · {GIF_EXPORT.width}px · {GIF_EXPORT.fps}fps
          </span>
          {gif === 'done' && <Check size={14} />}
        </Button>
        {gif === 'working' && (
          <div className="mt-2 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div className="h-full bg-ink transition-[width] duration-150" style={{ width: `${Math.round(gifProg * 100)}%` }} />
          </div>
        )}
        {gif === 'error' && <p className="text-[11px] text-bad mt-1.5">GIF export failed — try a smaller dot count.</p>}
      </div>

      <p className="text-[11px] text-mute leading-relaxed">
        Files are named <code className="text-ink/80">{base}.png</code>,{' '}
        <code className="text-ink/80">{base}.mp4</code> and <code className="text-ink/80">{base}.gif</code>.
      </p>
    </div>
  );
}

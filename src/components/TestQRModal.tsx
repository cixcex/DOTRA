import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, X, CheckCircle2, XCircle, RotateCcw, ExternalLink } from 'lucide-react';
import { decodeCanvas } from '@/engine/qrVerifier';
import { validateImageFile, loadImageFromFile } from '@/utils/imageUtils';
import { Modal, Button, SectionLabel } from './primitives';

type Source = 'camera' | 'upload';

export function TestQRModal({ open, onClose, onUseUrl }: {
  open: boolean;
  onClose: () => void;
  onUseUrl: (url: string) => void;
}) {
  const [tab, setTab] = useState<Source>('camera');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const lastDecodeRef = useRef(0);
  const [camState, setCamState] = useState<'off' | 'starting' | 'streaming' | 'error'>('off');
  const [camError, setCamError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; from: Source } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamState((s) => (s === 'streaming' ? 'off' : s));
  }, []);

  const startCamera = useCallback(async () => {
    setCamError(null);
    setResult(null);
    setCamState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();
      setCamState('streaming');

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
      if (!canvas || !ctx) return;

      const loop = async (now: number) => {
        if (video.readyState >= video.HAVE_CURRENT_DATA && now - lastDecodeRef.current > 180) {
          lastDecodeRef.current = now;
          const side = Math.min(video.videoWidth, video.videoHeight);
          if (side > 0) {
            const sx = (video.videoWidth - side) / 2;
            const sy = (video.videoHeight - side) / 2;
            canvas.width = 640;
            canvas.height = 640;
            ctx.drawImage(video, sx, sy, side, side, 0, 0, 640, 640);
            const res = await decodeCanvas(canvas);
            if (res.text) {
              setResult({ text: res.text, from: 'camera' });
              stopCamera();
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      setCamError(
        name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access or use the upload tab.'
        : name === 'NotFoundError' ? 'No camera was found on this device.'
        : 'The camera could not be started in this browser.',
      );
      setCamState('error');
    }
  }, [stopCamera]);

  // Clean up whenever the modal closes.
  useEffect(() => {
    if (!open) stopCamera();
  }, [open, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setResult(null);
    const check = validateImageFile(file);
    if (!check.ok) { setUploadError(check.error ?? 'Unsupported file.'); return; }
    try {
      const img = await loadImageFromFile(file);
      const side = Math.min(1280, Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { setUploadError('Canvas unavailable.'); return; }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, side, side);
      ctx.drawImage(img, 0, 0, side, side);
      const res = await decodeCanvas(canvas);
      if (res.text) setResult({ text: res.text, from: 'upload' });
      else setUploadError('No QR code found in that image. Try a sharper or closer shot.');
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not read that image.');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Test a QR code">
      <div className="space-y-4">
        <p className="text-sm text-mute leading-relaxed">
          Point your camera at any QR — including one exported from DOTRA — or upload a
          photo of one. Decoding happens entirely on your device.
        </p>

        <div className="flex gap-1.5">
          {(['camera', 'upload'] as Source[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setResult(null); setUploadError(null); }}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                tab === t ? 'border-ink bg-ink text-paper' : 'border-line bg-white text-ink hover:border-neutral-300'
              }`}
            >
              {t === 'camera' ? 'Camera' : 'Upload photo'}
            </button>
          ))}
        </div>

        {tab === 'camera' && (
          <div>
            <div className="relative rounded-xl overflow-hidden border border-line bg-neutral-900 aspect-[4/3] flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover ${camState === 'streaming' ? '' : 'hidden'}`}
              />
              {camState === 'off' && (
                <div className="text-center px-6">
                  <Camera size={22} className="mx-auto text-white/40" />
                  <p className="text-xs text-white/60 mt-2">Camera is off.</p>
                </div>
              )}
              {camState === 'starting' && (
                <p className="text-xs text-white/60">Starting camera…</p>
              )}
              {camState === 'error' && (
                <p className="text-xs text-white/70 text-center px-6">{camError}</p>
              )}
              {camState === 'streaming' && !result && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 rounded-xl border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              {camState !== 'streaming' ? (
                <Button variant="primary" size="sm" onClick={() => void startCamera()} loading={camState === 'starting'}>
                  <Camera size={14} /> Start camera
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={stopCamera}>
                  <X size={14} /> Stop camera
                </Button>
              )}
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <div>
            <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-neutral-50 px-4 py-8 text-center cursor-pointer hover:border-neutral-300 transition-colors">
              <Upload size={20} className="text-mute" />
              <span className="text-sm font-medium text-ink mt-2">Choose a QR photo</span>
              <span className="text-xs text-mute mt-1">JPG or PNG</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {uploadError && <p className="text-xs text-bad mt-2">{uploadError}</p>}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-ok shrink-0" />
              <p className="text-sm font-semibold text-ok">QR decoded successfully</p>
            </div>
            <p className="text-xs text-ink/80 mt-1.5 break-all font-mono">{result.text}</p>
            <div className="flex gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={() => { onUseUrl(result.text); onClose(); }}>
                <ExternalLink size={13} /> Use in studio
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setResult(null); if (tab === 'camera') void startCamera(); }}>
                <RotateCcw size={13} /> Scan again
              </Button>
            </div>
          </div>
        )}

        {scanning && !result && null}

        <div className="border-t border-line/70 pt-3">
          <SectionLabel>Tips</SectionLabel>
          <ul className="text-xs text-mute leading-relaxed list-disc pl-4 space-y-1">
            <li>Hold the QR steady and fill most of the frame.</li>
            <li>Good light helps — avoid glare on glossy prints.</li>
            <li>Exported DOTRA QRs are verified before download, so they always decode.</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}

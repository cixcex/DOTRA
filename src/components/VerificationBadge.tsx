import { CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { VerificationStatus } from '@/engine/types';
import { urlHostLabel } from '@/utils/urlValidator';

export function VerificationBadge({
  status, decodedText, failureReason, attempts, toneWarning, geometryOverride,
}: {
  status: VerificationStatus;
  decodedText: string | null;
  failureReason: string | null;
  attempts: string[];
  toneWarning?: string;
  geometryOverride: boolean;
}) {
  if (status === 'verified') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={16} className="text-ok shrink-0" />
          <p className="text-sm font-semibold text-ok">QR successfully verified.</p>
        </div>
        <p className="text-xs text-ink/70 mt-1.5 leading-relaxed">
          The rendered image decodes to{' '}
          <span className="font-medium text-ink break-all">{decodedText}</span>
          {' '}(host: {decodedText ? urlHostLabel(decodedText) : '—'})
          {geometryOverride && <span className="text-mute"> · full-size dots were used for reliability</span>}
        </p>
        {toneWarning && (
          <p className="text-[11px] text-warn mt-1.5 leading-relaxed">{toneWarning}</p>
        )}
      </div>
    );
  }
  if (status === 'optimizing') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-warn animate-spin shrink-0" />
          <p className="text-sm font-semibold text-warn">Optimizing QR readability…</p>
        </div>
        <p className="text-xs text-ink/70 mt-1.5">
          The first render did not decode cleanly. DOTRA is automatically adjusting
          tone separation{attempts.length > 1 ? ` (strategy ${attempts.length} of 5: ${attempts[attempts.length - 1]})` : ''}…
        </p>
      </div>
    );
  }
  if (status === 'working') {
    return (
      <div className="rounded-xl border border-line bg-neutral-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 size={14} className="text-mute animate-spin shrink-0" />
          <p className="text-sm font-medium text-mute">Rendering and verifying…</p>
        </div>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <XCircle size={16} className="text-bad shrink-0" />
          <p className="text-sm font-semibold text-bad">Verification failed.</p>
        </div>
        <p className="text-xs text-ink/70 mt-1.5 leading-relaxed">{failureReason ?? 'The rendered QR could not be decoded.'}</p>
        {attempts.length > 0 && (
          <p className="text-[11px] text-mute mt-1.5">
            Strategies tried: {attempts.join(' → ')}.
          </p>
        )}
        <p className="text-xs text-ink/70 mt-2 leading-relaxed">
          Try the <em>Scan</em> mode, a less busy image, or a shorter URL.
        </p>
      </div>
    );
  }
  if (status === 'idle') {
    return (
      <div className="rounded-xl border border-line bg-neutral-50 px-4 py-3 flex items-center gap-2">
        <AlertTriangle size={14} className="text-mute shrink-0" />
        <p className="text-sm text-mute">Enter a link and choose an image to begin.</p>
      </div>
    );
  }
  return null;
}

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, UploadCloud, X } from 'lucide-react';
import { validateImageFile, loadImageFromFile, ACCEPT_EXTENSIONS } from '@/utils/imageUtils';

export interface LoadedSource {
  img: HTMLImageElement;
  name: string;
  kind: 'upload' | 'sample';
  sampleId?: string;
}

export function ImageUploader({ onLoaded, currentName }: {
  onLoaded: (src: LoadedSource) => void;
  currentName: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    const check = validateImageFile(file);
    if (!check.ok) { setError(check.error ?? 'Unsupported file.'); return; }
    try {
      const img = await loadImageFromFile(file);
      onLoaded({ img, name: file.name, kind: 'upload' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that image.');
    }
  }, [onLoaded]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload an image"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-all duration-150 ${
          dragging ? 'border-ink bg-neutral-50 scale-[0.995]' : 'border-line bg-neutral-50/60 hover:border-neutral-300 hover:bg-neutral-50'
        }`}
      >
        <UploadCloud size={22} className="mx-auto text-mute" />
        <p className="text-sm font-medium text-ink mt-2">Drop an image here</p>
        <p className="text-xs text-mute mt-1">or click to browse · JPG, PNG, WEBP up to 25 MB</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-bad mt-2 leading-relaxed">{error}</p>
      )}

      {currentName && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-neutral-50 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <ImagePlus size={14} className="text-mute shrink-0" />
            <span className="text-xs text-ink truncate">{currentName}</span>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-mute shrink-0">source</span>
        </div>
      )}
    </div>
  );
}

export function RemoveSourceButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove image"
      className="p-1 rounded-md text-mute hover:text-bad hover:bg-red-50 transition-colors"
    >
      <X size={14} />
    </button>
  );
}

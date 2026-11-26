// ---------------------------------------------------------------------------
// DOTRA PNG export + download helpers
// ---------------------------------------------------------------------------

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode PNG.'));
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(base: string): string {
  const cleaned = base.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '') || 'dotra';
  return cleaned.slice(0, 60);
}

// ---------------------------------------------------------------------------
// DOTRA image loading + validation helpers
// ---------------------------------------------------------------------------

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ACCEPT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_SOURCE_PIXELS = 48_000_000; // ~48 MP safety cap

export interface FileCheck {
  ok: boolean;
  error?: string;
}

export function validateImageFile(file: File): FileCheck {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase();
  const typeOk = ACCEPTED_TYPES.includes(file.type) || ACCEPT_EXTENSIONS.includes(ext);
  if (!typeOk) {
    return { ok: false, error: 'Unsupported format. Please use JPG, PNG or WEBP.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'That file is over 25 MB. Please use a smaller image.' };
  }
  return { ok: true };
}

/** Load a File into an HTMLImageElement (object-URL based). */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth * img.naturalHeight > MAX_SOURCE_PIXELS) {
        URL.revokeObjectURL(url);
        reject(new Error('This image is extremely large. Please downscale it first.'));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image. It may be corrupted.'));
    };
    img.src = url;
  });
}

/** Load an image from a same-origin URL (sample gallery). */
export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = url;
  });
}

/** Draw any image source into a square canvas (cover fit). */
export function sourceToSquareCanvas(
  src: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  maxDim = 2048,
): HTMLCanvasElement {
  const w = (src as HTMLImageElement).naturalWidth ?? (src as HTMLCanvasElement).width;
  const h = (src as HTMLImageElement).naturalHeight ?? (src as HTMLCanvasElement).height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const size = Math.max(8, Math.round(Math.max(w, h) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = Math.min(size / w, size / h) * (scale < 1 ? 1 / scale : 1);
  // cover-fit into the square
  const cover = Math.max(size / w, size / h);
  ctx.drawImage(src, (size - w * cover) / 2, (size - h * cover) / 2, w * cover, h * cover);
  void s;
  return canvas;
}

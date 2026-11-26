// ---------------------------------------------------------------------------
// DOTRA QR matrix engine
//
// Generates a genuine QR matrix from a URL using the battle-tested
// `qrcode-generator` library, and exposes an exact ISO/IEC 18004 function-module
// mask (finder / separator / timing / alignment / format / version regions) so
// the renderer can protect structural modules with pure black & white while
// data modules carry image colours.
// ---------------------------------------------------------------------------

import qrcode from 'qrcode-generator';
import type { ECLevel, MatrixInfo, TargetVersion } from './types';

/** Alignment pattern centre positions per QR version (ISO/IEC 18004 Table E.1). */
const ALIGNMENT_POSITIONS: number[][] = [
  [], // v1
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 34, 64, 94],
  [6, 34, 66, 98],
  [6, 38, 70, 102],
  [6, 38, 72, 106],
  [6, 38, 74, 110],
  [6, 42, 78, 114],
  [6, 42, 80, 118],
  [6, 42, 82, 122],
  [6, 46, 86, 126],
  [6, 46, 88, 130],
  [6, 46, 90, 134],
  [6, 50, 94, 138],
  [6, 50, 96, 142],
  [6, 50, 98, 146],
  [6, 54, 102, 150],
  [6, 54, 104, 154],
  [6, 54, 106, 158],
  [6, 58, 110, 162],
  [6, 58, 112, 166],
  [6, 58, 114, 170],
];

/**
 * Builds the set of function (reserved) module coordinates for a QR of the
 * given size. These modules keep the encoded structure intact and are rendered
 * in pure black/white to guarantee decodability.
 */
export function buildFunctionModuleMask(size: number, version: number): Uint8Array {
  const mask = new Uint8Array(size * size);
  const mark = (r: number, c: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) mask[r * size + c] = 1;
  };

  // --- Finder patterns + separators (three 9x9 corner blocks) ---------------
  for (let r = 0; r <= 8; r++) {
    for (let c = 0; c <= 8; c++) {
      mark(r, c); // top-left
      mark(r, size - 1 - c); // top-right
      mark(size - 1 - r, c); // bottom-left
    }
  }

  // --- Timing patterns (row 6 / column 6 between the finders) ---------------
  for (let i = 8; i <= size - 9; i++) {
    mark(6, i);
    mark(i, 6);
  }

  // --- Alignment patterns (5x5, skipping overlaps with finders) -------------
  if (version >= 2) {
    const pos = ALIGNMENT_POSITIONS[version - 1] ?? [];
    const last = pos[pos.length - 1];
    for (const pr of pos) {
      for (const pc of pos) {
        if ((pr === 6 && pc === 6) || (pr === 6 && pc === last) || (pr === last && pc === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            mark(pr + dr, pc + dc);
          }
        }
      }
    }
  }

  // --- Format information + dark module --------------------------------------
  // Copy 1 (around top-left finder) and copy 2 (right / bottom edges) all live
  // inside the reserved 9x9 corner blocks above, including the fixed dark
  // module at (8, size-8). Nothing extra required.

  // --- Version information (versions 7+) -------------------------------------
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        mark(i, size - 11 + j); // top-right block
        mark(size - 11 + j, i); // bottom-left block
      }
    }
  }

  return mask;
}

/** Minimum QR version (1..40) required for a payload, or -1 if it never fits. */
function minVersionForData(url: string, ec: ECLevel): number {
  for (let v = 1; v <= 40; v++) {
    try {
      const probe = qrcode(v as Parameters<typeof qrcode>[0], ec);
      probe.addData(url);
      probe.make();
      return v;
    } catch {
      // data does not fit in this version — try the next one
    }
  }
  return -1;
}

const VERSION_BUCKETS: Record<TargetVersion, number> = {
  auto: 0,
  small: 4, // 33x33 modules — compact look
  medium: 8, // 49x49 — ~2.4k dots
  large: 14, // 73x73 — ~5.3k dots, maximum image detail
};

export interface EncodeResult {
  matrix: MatrixInfo;
  dotEstimate: number;
}

/**
 * Encodes a URL into a genuine QR matrix.
 * `targetVersion` may force a *larger* matrix (more dots, finer image detail);
 * the library always pads with error-correction codewords, never alters data.
 */
export function encodeQR(url: string, ec: ECLevel, targetVersion: TargetVersion): EncodeResult {
  let typeNumber = 0;

  if (targetVersion !== 'auto') {
    const wanted = VERSION_BUCKETS[targetVersion];
    const minNeeded = minVersionForData(url, ec);
    if (minNeeded === -1) {
      throw new Error('This URL is too long to encode in a QR code.');
    }
    typeNumber = Math.max(wanted, minNeeded);
  }

  let qr: ReturnType<typeof qrcode> | null = null;
  let lastError: unknown = null;

  // Start at the requested version (or 1 for auto) and grow until the data fits.
  for (let v = typeNumber || 1; v <= 40; v++) {
    try {
      const candidate = qrcode(v as Parameters<typeof qrcode>[0], ec);
      candidate.addData(url);
      candidate.make();
      qr = candidate;
      break;
    } catch (err) {
      lastError = err; // version too small — try the next one up
    }
  }

  if (!qr) {
    throw new Error(lastError instanceof Error ? lastError.message : 'QR encoding failed.');
  }

  const size = qr.getModuleCount();
  const version = (size - 17) / 4;
  const mask = buildFunctionModuleMask(size, version);

  const isDark = (row: number, col: number) => qr!.isDark(row, col);
  const isFunctionModule = (row: number, col: number) => mask[row * size + col] === 1;

  return {
    matrix: { size, version, ecLevel: ec, isDark, isFunctionModule },
    dotEstimate: size * size,
  };
}

/** Human-friendly module count for UI hints ("≈ 2,401 dots"). */
export function versionForSize(size: number): number {
  return (size - 17) / 4;
}

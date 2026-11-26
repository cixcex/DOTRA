// ---------------------------------------------------------------------------
// DOTRA brand asset generator
//
// Produces: favicon.svg, favicon-16.png, favicon-32.png, apple-touch-icon.png,
// og-cover.png (1200×630) with a REAL dot-QR embedded (verified with jsQR).
// Run: npm run gen:assets
// ---------------------------------------------------------------------------

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import { encodeQR } from '../src/engine/qrGenerator';
import { ringSquares } from '../src/engine/dotRenderer';
import { mapModuleColor } from '../src/utils/contrastOptimizer';
import {
  makeImage, savePNG, fillRect, fillCircle, forEachPixel, getPx, setPx,
  gradient, mixc, clamp255, mulberry32, makeNoise2D, drawCover,
} from './pngkit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = `${here}/../public/`;
type Img = ReturnType<typeof makeImage>;

// --- 5×7 pixel wordmark font ---------------------------------------------------
const GLYPHS: Record<string, number[]> = {
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
};

function drawWordmark(img: Img, x0: number, y0: number, scale: number, color: number[]) {
  let x = x0;
  for (const ch of 'DOTRA') {
    const g = GLYPHS[ch];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g[row] & (1 << (4 - col))) fillRect(img, x + col * scale, y0 + row * scale, scale, scale, color);
      }
    }
    x += 6 * scale;
  }
}

// --- logo mark: quincunx dot constellation --------------------------------------
function drawMark(img: Img, cx: number, cy: number, r: number, halfTile: number, dotColor: number[], accent: number[]) {
  fillRect(img, cx - halfTile, cy - halfTile, halfTile * 2, halfTile * 2, [10, 10, 10]);
  const off = halfTile * 0.52;
  for (const [dx, dy] of [[-off, -off], [off, -off], [-off, off], [off, off]]) {
    fillCircle(img, cx + dx, cy + dy, r, dotColor);
  }
  fillCircle(img, cx, cy, r * 1.35, accent);
}

// --- procedural artwork used as the OG dot-QR source -----------------------------
function makeArtwork(size: number) {
  const img = makeImage(size, size);
  const noise = makeNoise2D(2026);
  forEachPixel(img, (x, y) => {
    const u = x / size, v = y / size;
    const c = gradient([
      [0, [26, 18, 52]], [0.4, [122, 45, 92]], [0.7, [232, 116, 62]], [1, [250, 201, 92]],
    ])(v + 0.12 * (noise(u * 3, v * 3, 3) - 0.5));
    const sd = Math.hypot(u - 0.64, v - 0.36) / 0.5;
    const glow = Math.max(0, 1 - sd * 2.4);
    let out = mixc(c, [255, 222, 150], glow * glow * 0.8);
    if (sd < 0.07) out = [255, 240, 205];
    const layers = [
      { base: 0.6, amp: 0.06, col: [168, 92, 108] },
      { base: 0.7, amp: 0.08, col: [88, 44, 76] },
      { base: 0.82, amp: 0.1, col: [34, 20, 46] },
    ];
    for (const L of layers) {
      const ry = L.base + L.amp * (noise(u * 6, 0.7, 4) - 0.35);
      if (v > ry) out = L.col;
    }
    return [...out.map(clamp255), 255];
  });
  return img;
}

// --- dot-QR rasteriser (uses the ENGINE's real tone mapper + ring geometry) -----
interface RenderCell { x: number; y: number; half: number; color: number[]; structural: boolean; dark: boolean }

function buildDotCells(url: string, artwork: Img, outSize: number) {
  const { matrix } = encodeQR(url, 'H', 'auto');
  const N = matrix.size;
  const quiet = 6;
  const total = N + quiet * 2;
  const modulePx = outSize / total;
  const origin = quiet * modulePx;
  const artScale = artwork.w / N;

  const cells: RenderCell[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const ax = Math.min(artwork.w - 1, Math.floor(c * artScale));
      const ay = Math.min(artwork.h - 1, Math.floor(r * artScale));
      const col = getPx(artwork, ax, ay).slice(0, 3) as number[];
      const dark = matrix.isDark(r, c);
      const structural = matrix.isFunctionModule(r, c);

      if (structural) {
        cells.push({
          x: origin + (c + 0.5) * modulePx, y: origin + (r + 0.5) * modulePx,
          half: (modulePx + 0.6) / 2, color: dark ? [10, 10, 10] : [255, 255, 255], structural: true, dark,
        });
        continue;
      }
      // identical tone-band + influence blend as the browser engine
      // (photo preset, black & white modules, 60% image influence)
      const mapped = mapModuleColor({ r: col[0], g: col[1], b: col[2] }, {
        dark, protectedModule: false, preset: 'photo', colorIntensity: 1, repairLevel: 0,
        influence: 0.6, moduleContrast: 0.85, bwIntensity: 1, colourTreatment: false,
      });
      cells.push({
        x: origin + (c + 0.5) * modulePx, y: origin + (r + 0.5) * modulePx,
        half: modulePx * 0.44, color: [mapped.r, mapped.g, mapped.b].map(clamp255), structural: false, dark,
      });
    }
  }
  return { cells, N, modulePx, origin, quiet, total, artwork };
}

function paintCells(img: Img, built: ReturnType<typeof buildDotCells>, offX = 0, offY = 0) {
  // photographic underlay beneath the module grid (full-bleed, cover-fit)
  drawCover(img, built.artwork, offX + built.origin, offY + built.origin, built.N * built.modulePx);
  // structural + data modules as precise squares
  for (const cell of built.cells) {
    fillRect(img, offX + cell.x - cell.half, offY + cell.y - cell.half, cell.half * 2, cell.half * 2, cell.color);
  }
  // decorative perforation ring (engine geometry — no mirror drift)
  for (const s of ringSquares(built.N, built.quiet, built.modulePx, built.origin)) {
    fillRect(img, offX + s.x - s.size / 2, offY + s.y - s.size / 2, s.size, s.size, [22, 22, 22]);
  }
}

// ===========================================================================
mkdirSync(publicDir, { recursive: true });

// --- favicon.svg -----------------------------------------------------------------
writeFileSync(`${publicDir}favicon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0a0a0a"/>
  <g fill="#fafaf9">
    <circle cx="20" cy="20" r="4.6"/>
    <circle cx="44" cy="20" r="4.6"/>
    <circle cx="20" cy="44" r="4.6"/>
    <circle cx="44" cy="44" r="4.6"/>
  </g>
  <circle cx="32" cy="32" r="6.2" fill="#16a34a"/>
</svg>
`);
console.log('✓ favicon.svg');

// --- favicon PNGs -------------------------------------------------------------------
function renderFavicon(size: number): Img {
  const img = makeImage(size, size);
  fillRect(img, 0, 0, size, size, [10, 10, 10]);
  const corner = size * 0.16;
  for (let y = 0; y < corner; y++) {
    for (let x = 0; x < corner; x++) {
      const dx = x - corner, dy = y - corner;
      if (dx * dx + dy * dy > corner * corner) {
        setPx(img, x, y, 0, 0, 0, 0);
        setPx(img, size - 1 - x, y, 0, 0, 0, 0);
        setPx(img, x, size - 1 - y, 0, 0, 0, 0);
        setPx(img, size - 1 - x, size - 1 - y, 0, 0, 0, 0);
      }
    }
  }
  const r = size * 0.072;
  const off = size * 0.205;
  const c = size / 2;
  for (const [dx, dy] of [[-off, -off], [off, -off], [-off, off], [off, off]]) {
    fillCircle(img, c + dx, c + dy, r, [250, 250, 249]);
  }
  fillCircle(img, c, c, r * 1.4, [22, 163, 74]);
  return img;
}

savePNG(`${publicDir}favicon-16.png`, 16, 16, renderFavicon(16).data);
savePNG(`${publicDir}favicon-32.png`, 32, 32, renderFavicon(32).data);
// apple-touch-icon must be opaque (iOS ignores transparency)
{
  const opaque = makeImage(180, 180);
  fillRect(opaque, 0, 0, 180, 180, [250, 250, 249]);
  const mark = renderFavicon(180);
  for (let i = 0; i < opaque.data.length; i += 4) {
    if (mark.data[i + 3] > 0) {
      opaque.data[i] = mark.data[i];
      opaque.data[i + 1] = mark.data[i + 1];
      opaque.data[i + 2] = mark.data[i + 2];
      opaque.data[i + 3] = 255;
    }
  }
  savePNG(`${publicDir}apple-touch-icon.png`, 180, 180, opaque.data);
}
console.log('✓ favicon PNGs');

// --- OG cover -----------------------------------------------------------------------
const W = 1200, H = 630;
const cover = makeImage(W, H);
forEachPixel(cover, (x, y) => {
  const c = gradient([[0, [250, 250, 249]], [1, [243, 241, 237]]])(y / H);
  return [...c, 255];
});

drawMark(cover, 104, 112, 13, 60, [250, 250, 249], [22, 163, 74]);
drawWordmark(cover, 196, 94, 15, [10, 10, 10]);
fillRect(cover, 108, 214, 360, 2, [10, 10, 10]);

const art = makeArtwork(512);
const QR_SIZE = 540;
const qx = W - QR_SIZE - 84, qy = (H - QR_SIZE) / 2 + 6;
const built = buildDotCells('https://dotra.app', art, QR_SIZE);

// white card behind the QR
fillRect(cover, qx - 20, qy - 20, QR_SIZE + 40, QR_SIZE + 40, [255, 255, 255]);
// hairline border
forEachPixel(cover, (x, y) => {
  const onH = y === qy - 20 || y === qy + QR_SIZE + 19;
  const onV = x === qx - 20 || x === qx + QR_SIZE + 19;
  if ((onH && x >= qx - 20 && x <= qx + QR_SIZE + 20) || (onV && y >= qy - 20 && y <= qy + QR_SIZE + 20)) {
    return [224, 222, 217, 255];
  }
  return undefined as unknown as number[];
});

paintCells(cover, built, qx, qy);

// small caption under the QR
drawWordmark(cover, qx + 18, qy + QR_SIZE + 40, 3, [140, 138, 132]);

// gentle grain (kept off the QR card so it can never disturb decoding)
const rand = mulberry32(7);
for (let i = 0; i < W * H * 0.00035; i++) {
  const gx = Math.floor(rand() * W), gy = Math.floor(rand() * H);
  const insideQR = gx >= qx - 20 && gx < qx + QR_SIZE + 20 && gy >= qy - 20 && gy < qy + QR_SIZE + 20;
  if (!insideQR) setPx(cover, gx, gy, 0, 0, 0, 12);
}

savePNG(`${publicDir}og-cover.png`, W, H, cover.data);
console.log('✓ og-cover.png');

// --- verify the embedded QR actually decodes -----------------------------------------
{
  const verifyImg = makeImage(QR_SIZE, QR_SIZE);
  fillRect(verifyImg, 0, 0, QR_SIZE, QR_SIZE, [255, 255, 255]);
  paintCells(verifyImg, built, 0, 0);
  const result = jsQR(new Uint8ClampedArray(verifyImg.data), QR_SIZE, QR_SIZE);
  if (result && result.data === 'https://dotra.app') {
    console.log('✓ embedded OG QR verified with jsQR:', result.data);
  } else {
    console.error('✗ OG QR decode failed:', result?.data ?? '(none)');
    process.exitCode = 1;
  }
}

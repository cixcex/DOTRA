// ---------------------------------------------------------------------------
// DOTRA sample gallery generator
//
// Produces 24 locally-bundled sample artworks (512×512 PNG) across eight
// categories. All images are generated procedurally with seeded randomness so
// the gallery is deterministic, license-free and works fully offline.
//
// Run: npm run gen:samples
// ---------------------------------------------------------------------------

import {
  makeImage, savePNG, forEachPixel, fillRect, fillCircle, getPx, setPx,
  gradient, mixc, lerp, clamp255, mulberry32, makeNoise2D, sampleImage, drawCover,
} from './pngkit.mjs';

const S = 512;

function base(noiseSeed) {
  return { noise: makeNoise2D(noiseSeed), rand: mulberry32(noiseSeed * 7 + 3) };
}

function applyGrain(img, amount, seed) {
  const rand = mulberry32(seed);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4;
      const g = (rand() - 0.5) * amount;
      img.data[i] = clamp255(img.data[i] + g);
      img.data[i + 1] = clamp255(img.data[i + 1] + g);
      img.data[i + 2] = clamp255(img.data[i + 2] + g);
    }
  }
}

function vignette(img, strength = 0.22) {
  const cx = img.w / 2, cy = img.h / 2, maxD = Math.hypot(cx, cy);
  forEachPixel(img, (x, y) => {
    const d = Math.hypot(x - cx, y - cy) / maxD;
    const k = 1 - strength * Math.max(0, d - 0.45) * 1.4;
    const [r, g, b] = getPx(img, x, y);
    return [r * k, g * k, b * k, 255];
  });
}

function finish(img, seed, grain = 7, vig = 0.18) {
  applyGrain(img, grain, seed);
  if (vig > 0) vignette(img, vig);
}

function ridge(noise, x, base, amp, freq) {
  return base + amp * (noise(x * freq, 0.7, 4) - 0.35);
}

// ===========================================================================
// NATURE
// ===========================================================================

function natureEmberRidge(img) {
  const { noise, rand } = base(11);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    // sky
    const sky = gradient([
      [0, [16, 12, 42]], [0.35, [74, 26, 74]], [0.62, [196, 61, 79]],
      [0.8, [242, 118, 46]], [1, [247, 183, 51]],
    ])(Math.min(1, v * 1.25));
    let c = sky;
    // sun + glow
    const sd = Math.hypot(u - 0.62, v - 0.4) / 0.5;
    const glow = Math.max(0, 1 - sd * 2.2);
    c = mixc(c, [255, 214, 140], glow * glow * 0.85);
    if (sd < 0.085) c = [255, 236, 190];
    // ridges (back → front)
    const layers = [
      { base: 0.62, amp: 0.05, col: [183, 105, 110] },
      { base: 0.68, amp: 0.07, col: [141, 66, 88] },
      { base: 0.76, amp: 0.09, col: [84, 41, 74] },
      { base: 0.86, amp: 0.11, col: [38, 22, 48] },
    ];
    for (const L of layers) {
      const ry = ridge(noise, u, L.base, L.amp, 6) + 0.02 * Math.sin(u * 40);
      if (v > ry) c = L.col;
    }
    return [...c, 255];
  });
  // birds
  for (let i = 0; i < 5; i++) {
    const bx = 60 + rand() * 380, by = 60 + rand() * 90, s = 4 + rand() * 5;
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const wing = Math.sin(t * Math.PI) * s;
      setPx(img, bx + (t - 0.5) * s * 2.4, by - wing, 20, 12, 24);
    }
  }
  finish(img, 11);
}

function natureVerdant(img) {
  const { noise, rand } = base(23);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c = gradient([
      [0, [223, 242, 216]], [0.45, [127, 176, 105]], [0.8, [45, 106, 79]], [1, [27, 67, 50]],
    ])(v + 0.08 * (noise(u * 3, v * 3, 3) - 0.5));
    return [...c, 255];
  });
  // light rays
  for (let i = 0; i < 4; i++) {
    const rx = 60 + rand() * 400;
    forEachPixel(img, (x, y) => {
      const d = Math.abs(x - rx - (y - S / 2) * 0.35);
      if (d < 26 && y < S * 0.75) {
        const a = (1 - d / 26) * 0.1 * (1 - y / S);
        const idx = (y * S + x) * 4;
        img.data[idx] = clamp255(img.data[idx] + 90 * a);
        img.data[idx + 1] = clamp255(img.data[idx + 1] + 90 * a);
        img.data[idx + 2] = clamp255(img.data[idx + 2] + 70 * a);
      }
    });
  }
  // trunks
  for (let i = 0; i < 9; i++) {
    const tx = rand() * S, w = 10 + rand() * 16, lean = (rand() - 0.5) * 30;
    const dark = [42, 30, 22];
    for (let y = 0; y < S; y++) {
      const x = tx + lean * (y / S);
      for (let k = -w / 2; k < w / 2; k++) setPx(img, x + k, y, ...dark);
    }
  }
  // canopy
  for (let i = 0; i < 130; i++) {
    const cx = rand() * S, cy = rand() * S * 0.42, r = 18 + rand() * 46;
    const greens = [[27, 67, 50], [45, 106, 79], [64, 145, 108], [82, 183, 136], [115, 201, 140]];
    fillCircle(img, cx, cy, r, greens[Math.floor(rand() * greens.length)], 0.55 + rand() * 0.4);
  }
  // fern speckles
  for (let i = 0; i < 500; i++) {
    const x = rand() * S, y = S * 0.7 + rand() * S * 0.3;
    setPx(img, x, y, 120 + rand() * 80, 160 + rand() * 60, 70, 200);
  }
  finish(img, 23);
}

function natureTide(img) {
  const { noise } = base(37);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const deep = gradient([[0, [3, 4, 94]], [0.5, [0, 119, 182]], [1, [0, 180, 216]]]);
    let c = deep(v);
    const wave = Math.sin(v * 46 + noise(u * 6, v * 2, 3) * 6 + u * 4);
    const crest = Math.max(0, wave) ** 3;
    c = mixc(c, [202, 240, 248], crest * 0.5 * (0.4 + 0.6 * v));
    // sun glint column
    const glint = Math.max(0, 1 - Math.abs(u - 0.68) * 9) * Math.max(0, 1 - v * 1.4);
    c = mixc(c, [255, 244, 214], glint * 0.55);
    return [...c, 255];
  });
  finish(img, 37, 5);
}

// ===========================================================================
// ARCHITECTURE
// ===========================================================================

function architectureSkyline(img) {
  const { noise, rand } = base(41);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const sky = gradient([
      [0, [13, 27, 42]], [0.55, [27, 38, 59]], [0.8, [65, 90, 119]], [1, [224, 170, 62]],
    ])(Math.min(1, v * 1.15));
    let c = sky;
    const sd = Math.hypot(u - 0.78, v - 0.18);
    if (sd < 0.05) c = [240, 244, 248];
    else if (sd < 0.2) c = mixc(c, [200, 214, 228], (1 - sd / 0.2) * 0.35);
    return [...c, 255];
  });
  // stars
  const randS = mulberry32(99);
  for (let i = 0; i < 120; i++) {
    const x = randS() * S, y = randS() * S * 0.45;
    setPx(img, x, y, 255, 255, 255, 60 + randS() * 160);
  }
  // buildings
  let x = -10;
  while (x < S + 10) {
    const bw = 34 + rand() * 66;
    const bh = 90 + rand() * 250;
    const by = S - bh;
    const shade = 11 + Math.floor(rand() * 14);
    fillRect(img, x, by, bw, bh, [shade, shade + 4, shade + 12]);
    // windows
    for (let wy = by + 10; wy < S - 12; wy += 14) {
      for (let wx = x + 6; wx < x + bw - 6; wx += 11) {
        if (rand() < 0.32) fillRect(img, wx, wy, 5, 7, [255, 209, 102], 0.9);
        else fillRect(img, wx, wy, 5, 7, [30, 42, 60], 0.8);
      }
    }
    if (rand() < 0.4) fillRect(img, x + bw / 2 - 1, by - 18, 2, 18, [shade, shade + 4, shade + 12]);
    x += bw + 4 + rand() * 14;
  }
  // foreground tower
  fillRect(img, S * 0.68, S * 0.18, 74, S * 0.82, [8, 11, 20]);
  for (let wy = S * 0.2; wy < S - 14; wy += 16) {
    for (let wx = S * 0.68 + 8; wx < S * 0.68 + 66; wx += 13) {
      if (rand() < 0.4) fillRect(img, wx, wy, 6, 8, [255, 209, 102], 0.95);
    }
  }
  finish(img, 41, 5);
}

function architectureArches(img) {
  const { noise } = base(53);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c = gradient([[0, [246, 238, 222]], [1, [228, 211, 184]]])(v);
    return [...c, 255];
  });
  // nested arches: arch = rectangle + semicircle top
  const arch = (cx, baseY, w, h, color) => {
    const r = w / 2;
    forEachPixel(img, (x, y) => {
      const dx = Math.abs(x - cx);
      const inRect = dx <= r && y >= baseY - h + r && y <= baseY;
      const inArc = dx <= r && y < baseY - h + r && Math.hypot(x - cx, y - (baseY - h + r)) <= r;
      if (inRect || inArc) {
        const i = (y * S + x) * 4;
        img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2];
      }
    });
  };
  arch(S * 0.5, S * 0.86, 380, 420, [122, 62, 45]);
  arch(S * 0.5, S * 0.86, 300, 360, [169, 87, 62]);
  arch(S * 0.5, S * 0.86, 220, 300, [201, 111, 74]);
  arch(S * 0.5, S * 0.86, 140, 230, [232, 176, 120]);
  // floor shadow
  forEachPixel(img, (x, y) => {
    if (y > S * 0.86) {
      const i = (y * S + x) * 4;
      img.data[i] = 190; img.data[i + 1] = 168; img.data[i + 3] = 255;
      img.data[i + 2] = 140;
    }
  });
  finish(img, 53);
}

function architectureFacade(img) {
  const { noise, rand } = base(67);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const sky = gradient([[0, [157, 180, 200]], [0.6, [184, 198, 210]], [1, [232, 238, 242]]])(v);
    let c = sky;
    // panel tint
    const px = Math.floor(u * 9), py = Math.floor(v * 12);
    const h = noise(px * 0.8, py * 0.8, 2);
    c = mixc(c, h > 0.55 ? [107, 138, 168] : [150, 172, 190], 0.55);
    // lit office panels
    const lit = noise(px * 3.1 + 40, py * 3.1 + 9, 2);
    if (lit > 0.72) c = mixc(c, [255, 217, 160], 0.75);
    // diagonal reflection band
    const band = Math.max(0, 1 - Math.abs(u + v * 0.6 - 0.9) * 6);
    c = mixc(c, [255, 255, 255], band * 0.25);
    return [...c, 255];
  });
  // mullions
  for (let i = 1; i < 9; i++) fillRect(img, (i * S) / 9 - 1, 0, 3, S, [52, 60, 70]);
  for (let j = 1; j < 12; j++) fillRect(img, 0, (j * S) / 12 - 1, S, 3, [52, 60, 70]);
  finish(img, 67, 4);
}

// ===========================================================================
// LANDSCAPES
// ===========================================================================

function landscapeAlpine(img) {
  const { noise, rand } = base(71);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [168, 208, 230]], [0.5, [216, 232, 240]], [0.62, [232, 241, 245]]])(v);
    const layers = [
      { base: 0.52, amp: 0.09, col: [143, 168, 191], snow: 0.72 },
      { base: 0.62, amp: 0.11, col: [95, 125, 149], snow: 0.78 },
      { base: 0.74, amp: 0.13, col: [51, 71, 91], snow: 0.85 },
    ];
    let covered = false;
    for (const L of layers) {
      const ry = ridge(noise, u, L.base, L.amp, 5);
      if (v > ry) {
        const depth = Math.min(1, (v - ry) * 14);
        let col = mixc(L.col, [255, 255, 255], Math.max(0, 1 - depth * 6) * (v < L.base + 0.06 ? 1 : 0) * (ry < L.base - L.amp * 0.3 ? 0.9 : 0));
        if (depth < 0.25 && ry < L.base - L.amp * 0.2) col = mixc(L.col, [245, 248, 250], 0.85);
        c = mixc(c, col, Math.min(1, depth + 0.35));
        covered = true;
      }
    }
    return [...c, 255];
  });
  // sun
  for (let i = 0; i < 40; i++) {
    const a = i / 40;
    fillCircle(img, S * 0.3, S * 0.2, 10 + a * 46, [255, 246, 220], 0.05 * (1 - a));
  }
  fillCircle(img, S * 0.3, S * 0.2, 12, [255, 250, 235]);
  // lake: mirror the mountains just above the shoreline
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    if (v > 0.82) {
      const srcV = 0.82 - (v - 0.82) * 0.45;
      const mirror = sampleImage(img, u, srcV);
      const rip = Math.sin(v * 160 + noise(u * 20, v * 4, 2) * 8);
      let c = mixc([109, 140, 160], mirror, 0.62);
      c = mixc(c, [220, 235, 242], Math.max(0, rip) * 0.1);
      const i = (y * S + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    }
  });
  finish(img, 71);
}

function landscapeDunes(img) {
  const { noise, rand } = base(83);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [246, 216, 168]], [0.4, [232, 167, 111]], [1, [214, 138, 80]]])(Math.min(1, v * 1.3));
    const sd = Math.hypot(u - 0.7, v - 0.22);
    if (sd < 0.06) c = [255, 244, 214];
    else if (sd < 0.3) c = mixc(c, [255, 220, 160], (1 - sd / 0.3) * 0.4);
    const layers = [
      { base: 0.55, amp: 0.08, col: [217, 160, 91] },
      { base: 0.66, amp: 0.1, col: [201, 138, 62] },
      { base: 0.78, amp: 0.12, col: [168, 106, 44] },
      { base: 0.9, amp: 0.1, col: [138, 82, 32] },
    ];
    for (const L of layers) {
      const ry = ridge(noise, u, L.base, L.amp, 4) + 0.03 * Math.sin(u * 22);
      if (v > ry) {
        const slope = ridge(noise, u + 0.004, L.base, L.amp, 4) - ridge(noise, u - 0.004, L.base, L.amp, 4);
        const shade = slope > 0 ? 0.82 : 1.08;
        c = [L.col[0] * shade, L.col[1] * shade, L.col[2] * shade];
      }
    }
    return [...c.map(clamp255), 255];
  });
  finish(img, 83);
}

function landscapeAurora(img) {
  const { noise, rand } = base(97);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [5, 9, 20]], [0.7, [13, 27, 46]], [1, [20, 36, 58]]])(v);
    // stars
    const star = noise(u * 90, v * 90, 1);
    if (star > 0.985 && v < 0.6) c = mixc(c, [255, 255, 255], (star - 0.985) * 40);
    // aurora ribbons
    const ribbons = [
      { col: [82, 255, 168], base: 0.3, amp: 0.1, f: 3.1, ph: 0.5, a: 0.5 },
      { col: [62, 193, 211], base: 0.42, amp: 0.12, f: 2.3, ph: 2.1, a: 0.4 },
      { col: [139, 92, 246], base: 0.24, amp: 0.08, f: 4.2, ph: 4.0, a: 0.32 },
    ];
    for (const R of ribbons) {
      const cy = R.base + Math.sin(u * R.f * Math.PI * 2 + R.ph) * R.amp + (noise(u * 5, 0.3, 3) - 0.5) * 0.12;
      const d = Math.abs(v - cy);
      const band = Math.exp(-(d * d) / (2 * 0.045 * 0.045)) * R.a;
      c = [
        Math.min(255, c[0] + R.col[0] * band),
        Math.min(255, c[1] + R.col[1] * band),
        Math.min(255, c[2] + R.col[2] * band),
      ];
    }
    // mountains
    const my = ridge(noise, u, 0.86, 0.07, 7);
    if (v > my) c = [8, 12, 22];
    return [...c.map(clamp255), 255];
  });
  finish(img, 97, 5);
}

// ===========================================================================
// ANIMALS
// ===========================================================================

function animalsButterfly(img) {
  const { noise, rand } = base(101);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c = gradient([[0, [36, 27, 46]], [1, [61, 43, 69]]])(v + 0.1 * (noise(u * 2, v * 2, 3) - 0.5));
    return [...c, 255];
  });
  const cx = S / 2, cy = S * 0.46;
  // wings: distance-based lobes with gradient
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    for (const side of [-1, 1]) {
      const dx = (u - 0.5) * 2 * side; // 0 at body, positive outward
      if (dx < 0.01) continue;
      const dy = (v - 0.46) * 2;
      // upper lobe
      const ex = (dx - 0.34) / 0.3, ey = (dy + 0.16) / 0.3;
      const dUp = ex * ex + ey * ey;
      // lower lobe
      const ex2 = (dx - 0.26) / 0.24, ey2 = (dy - 0.3) / 0.26;
      const dLo = ex2 * ex2 + ey2 * ey2;
      let hit = false, edge = 0;
      if (dUp < 1) { hit = true; edge = Math.sqrt(dUp); }
      else if (dLo < 1) { hit = true; edge = Math.sqrt(dLo); }
      if (hit) {
        const wing = gradient([[0, [247, 179, 43]], [0.55, [244, 132, 44]], [0.85, [196, 68, 62]], [1, [90, 32, 54]]])(edge);
        const i = (y * S + x) * 4;
        img.data[i] = wing[0]; img.data[i + 1] = wing[1]; img.data[i + 2] = wing[2];
        // dark rim
        if (edge > 0.86) { img.data[i] = 26; img.data[i + 1] = 16; img.data[i + 2] = 30; }
        // spots
        for (const [su, sv] of [[0.16, -0.14], [0.3, -0.2], [0.34, 0.02], [0.2, 0.22]]) {
          const sd = Math.hypot(dx - su, dy - sv);
          if (sd < 0.035) { img.data[i] = 250; img.data[i + 1] = 244; img.data[i + 2] = 226; }
        }
      }
    }
  });
  // body + antennae
  fillRect(img, cx - 4, cy - 40, 8, 130, [22, 14, 26]);
  fillCircle(img, cx, cy - 46, 9, [22, 14, 26]);
  for (const side of [-1, 1]) {
    for (let t = 0; t <= 1; t += 0.02) {
      const ax = cx + side * (6 + t * 26);
      const ay = cy - 52 - t * 30 + t * t * 14;
      fillCircle(img, ax, ay, 1.6, [22, 14, 26]);
    }
  }
  finish(img, 101, 5);
}

function animalsReef(img) {
  const { noise, rand } = base(113);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c = gradient([[0, [0, 18, 51]], [0.55, [0, 53, 102]], [1, [0, 95, 158]]])(v);
    return [...c, 255];
  });
  // light rays
  for (let i = 0; i < 3; i++) {
    const rx = 80 + i * 150 + rand() * 40;
    forEachPixel(img, (x, y) => {
      const d = Math.abs(x - rx - y * 0.22);
      if (d < 30) {
        const a = (1 - d / 30) * 0.1 * (1 - y / S);
        const idx = (y * S + x) * 4;
        img.data[idx] = clamp255(img.data[idx] + 120 * a);
        img.data[idx + 1] = clamp255(img.data[idx + 1] + 160 * a);
        img.data[idx + 2] = clamp255(img.data[idx + 2] + 190 * a);
      }
    });
  }
  // fish
  const palette = [[255, 107, 107], [255, 169, 77], [78, 205, 196], [255, 143, 92], [129, 212, 250], [255, 213, 128], [149, 117, 205]];
  for (let f = 0; f < 7; f++) {
    const fx = 60 + rand() * 380, fy = 90 + rand() * 300, fs = 0.6 + rand() * 0.9;
    const dir = rand() > 0.5 ? 1 : -1;
    const col = palette[f % palette.length];
    forEachPixel(img, (x, y) => {
      const dx = (x - fx) / (34 * fs) * dir, dy = (y - fy) / (16 * fs);
      const body = (dx * dx) / 1 + (dy * dy) / 0.55;
      const tail = Math.abs(dx - 1.25) < 0.45 && Math.abs(dy) < 0.5 * (1 - Math.abs(dx - 1.25) / 0.45);
      if (body <= 1 || tail) {
        const edge = Math.min(1, Math.sqrt(Math.max(body, 0)));
        const c = mixc([255, 255, 255], col, Math.min(1, 0.35 + edge * 0.75));
        const i = (y * S + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
        if (Math.abs(dx) < 0.12 && Math.abs(dy) < 0.12) { img.data[i] = 12; img.data[i + 1] = 12; img.data[i + 2] = 16; }
      }
    });
  }
  // bubbles
  for (let i = 0; i < 26; i++) {
    fillCircle(img, rand() * S, rand() * S * 0.8, 1 + rand() * 3, [200, 235, 255], 0.35);
  }
  finish(img, 113, 5);
}

function animalsKingfisher(img) {
  const { noise, rand } = base(127);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c = gradient([[0, [233, 240, 226]], [1, [207, 224, 200]]])(v + 0.06 * (noise(u * 3, v * 3, 3) - 0.5));
    return [...c, 255];
  });
  // branch
  fillRect(img, 0, S * 0.78, S, 14, [94, 66, 44]);
  fillRect(img, 0, S * 0.78 + 14, S, 4, [70, 48, 32]);
  for (let i = 0; i < 5; i++) fillRect(img, 40 + i * 110 + rand() * 30, S * 0.72, 4, 30 + rand() * 20, [94, 66, 44]);
  const cx = S * 0.5, cy = S * 0.44;
  // tail
  forEachPixel(img, (x, y) => {
    const dx = (x - cx) / 90, dy = (y - cy) / 26;
    if (dx < -0.2 && Math.abs(dy + 0.4 * (dx + 0.6)) < 0.35 && dx > -1.2) {
      const i = (y * S + x) * 4;
      img.data[i] = 8; img.data[i + 1] = 60; img.data[i + 2] = 66;
    }
  });
  // body
  forEachPixel(img, (x, y) => {
    const dx = (x - cx) / 74, dy = (y - cy) / 92;
    const d = dx * dx + dy * dy;
    if (d <= 1) {
      const belly = dy > 0.15;
      const c = belly ? gradient([[0, [247, 140, 43]], [1, [232, 112, 30]]])((dy - 0.15) / 0.9)
        : gradient([[0, [14, 149, 148]], [1, [8, 106, 117]]])(-dy);
      const i = (y * S + x) * 4;
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    }
  });
  // head + wing + beak
  fillCircle(img, cx + 6, cy - 78, 34, [16, 49, 43]);
  fillCircle(img, cx + 16, cy - 66, 16, [240, 238, 230]);
  fillCircle(img, cx + 22, cy - 84, 5, [250, 250, 250]);
  fillCircle(img, cx + 23, cy - 84, 2.4, [16, 20, 26]);
  for (const t of [0, 1, 2, 3, 4]) fillRect(img, cx + 34 + t * 7, cy - 82 + t * 2, 26 - t * 3, 5, [26, 30, 38]);
  fillCircle(img, cx - 8, cy - 10, 40, [10, 84, 92]);
  fillCircle(img, cx - 14, cy - 18, 26, [62, 181, 171]);
  finish(img, 127, 5);
}

// ===========================================================================
// ABSTRACT
// ===========================================================================

function abstractRadial(img) {
  const { noise } = base(131);
  const wheel = (t) => {
    const stops = [[0, [255, 82, 82]], [0.17, [255, 171, 64]], [0.34, [255, 235, 130]], [0.5, [105, 240, 174]], [0.67, [64, 196, 255]], [0.84, [149, 117, 205]], [1, [255, 82, 82]]];
    for (let i = 0; i < stops.length - 1; i++) {
      const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
      if (t >= p0 && t <= p1) return mixc(c0, c1, (t - p0) / (p1 - p0));
    }
    return stops[0][1];
  };
  forEachPixel(img, (x, y) => {
    const u = x / S - 0.5, v = y / S - 0.5;
    const ang = Math.atan2(v, u) / (Math.PI * 2) + 0.5 + (noise(x * 0.02, y * 0.02, 3) - 0.5) * 0.12;
    const rad = Math.hypot(u, v) * 2 + (noise(x * 0.03 + 9, y * 0.03, 2) - 0.5) * 0.2;
    let c = wheel(((ang % 1) + 1) % 1);
    const ring = Math.sin(rad * 22) * 0.5 + 0.5;
    c = mixc(c, [255, 255, 255], ring * 0.12 * Math.max(0, 1 - rad));
    if (rad > 0.98) c = [24, 20, 34];
    return [...c, 255];
  });
  fillCircle(img, S / 2, S / 2, 14, [16, 12, 24]);
  finish(img, 131, 5, 0.1);
}

function abstractInterference(img) {
  const { noise } = base(139);
  const pal = gradient([
    [0, [26, 20, 64]], [0.3, [124, 58, 168]], [0.55, [219, 84, 122]], [0.78, [247, 179, 102]], [1, [250, 240, 214]],
  ]);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const c =
      Math.sin(u * 22 + noise(u * 4, v * 4, 2) * 4) +
      Math.sin(v * 26 - noise(u * 3, v * 3, 2) * 3) +
      Math.sin((u + v) * 14) +
      Math.sin(Math.hypot(u - 0.5, v - 0.5) * 30);
    const t = (c + 4) / 8;
    const col = pal(t);
    return [...col, 255];
  });
  finish(img, 139, 5, 0.08);
}

function abstractMesh(img) {
  const { rand } = base(149);
  forEachPixel(img, (x, y) => {
    const c = gradient([[0, [247, 243, 234]], [1, [238, 231, 218]]])(y / S);
    return [...c, 255];
  });
  const blobs = [
    [0.28, 0.32, 0.34, [244, 132, 97]], [0.68, 0.26, 0.3, [94, 187, 183]],
    [0.52, 0.62, 0.36, [233, 196, 106]], [0.78, 0.72, 0.26, [181, 131, 220]],
    [0.2, 0.74, 0.24, [107, 142, 35]], [0.55, 0.18, 0.2, [230, 126, 150]],
  ];
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let r = 247, g = 243, b = 234;
    for (const [bx, by, br, col] of blobs) {
      const d = Math.hypot(u - bx, v - by) / br;
      if (d < 1.6) {
        const a = Math.max(0, 1 - d * d) * 0.85;
        // screen blend
        r = 255 - (255 - r) * (1 - col[0] / 255 * a);
        g = 255 - (255 - g) * (1 - col[1] / 255 * a);
        b = 255 - (255 - b) * (1 - col[2] / 255 * a);
      }
    }
    const i = (y * S + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
  });
  finish(img, 149, 6, 0.05);
}

// ===========================================================================
// PORTRAITS
// ===========================================================================

function portraitEmber(img) {
  const { noise, rand } = base(151);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [43, 26, 46]], [0.55, [107, 45, 60]], [1, [232, 132, 95]]])(v);
    // halo behind head
    const hd = Math.hypot(u - 0.5, v - 0.42);
    if (hd < 0.34) c = mixc(c, [255, 196, 120], (1 - hd / 0.34) * 0.55);
    return [...c, 255];
  });
  // silhouette: head circle, neck, shoulders, nose hint
  fillCircle(img, S * 0.5, S * 0.4, 86, [26, 15, 30]);
  fillRect(img, S * 0.44, S * 0.52, S * 0.12, 60, [26, 15, 30]);
  // shoulders
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const dx = (u - 0.5) * 2, dy = (v - 0.86) * 2.2;
    if (dx * dx * 0.55 + dy * dy < 1 && v > 0.6) {
      const i = (y * S + x) * 4;
      img.data[i] = 26; img.data[i + 1] = 15; img.data[i + 2] = 30;
    }
  });
  // nose profile bump
  fillCircle(img, S * 0.585, S * 0.44, 10, [26, 15, 30]);
  fillRect(img, S * 0.56, S * 0.42, 26, 8, [26, 15, 30]);
  // rim light
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const d = Math.hypot(u - 0.5, v - 0.4);
    if (d > 0.155 && d < 0.185 && u > 0.5) {
      const i = (y * S + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 200; img.data[i + 2] = 140;
    }
  });
  finish(img, 151, 6);
}

function portraitBauhaus(img) {
  const { noise } = base(163);
  forEachPixel(img, (x, y) => {
    const c = gradient([[0, [242, 237, 228]], [1, [228, 220, 205]]])(y / S);
    return [...c, 255];
  });
  // head: half light / half shadow circle
  forEachPixel(img, (x, y) => {
    const dx = (x - S * 0.5) / 130, dy = (y - S * 0.42) / 140;
    if (dx * dx + dy * dy <= 1) {
      const i = (y * S + x) * 4;
      const c = x < S * 0.5 ? [240, 183, 141] : [58, 44, 60];
      img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    }
  });
  // hair half-disc
  forEachPixel(img, (x, y) => {
    const dx = (x - S * 0.46) / 128, dy = (y - S * 0.36) / 128;
    if (dx * dx + dy * dy <= 1 && y < S * 0.4) {
      const i = (y * S + x) * 4;
      img.data[i] = 34; img.data[i + 1] = 28; img.data[i + 2] = 34;
    }
  });
  // eye, brow, nose, lips (geometric)
  fillCircle(img, S * 0.56, S * 0.42, 7, [24, 20, 26]);
  fillRect(img, S * 0.53, S * 0.38, 40, 5, [34, 28, 34]);
  fillRect(img, S * 0.585, S * 0.42, 6, 34, [222, 171, 132]);
  fillRect(img, S * 0.545, S * 0.52, 50, 8, [196, 68, 62]);
  // neck + shoulders (ochre + teal)
  fillRect(img, S * 0.45, S * 0.58, S * 0.1, 40, [240, 183, 141]);
  forEachPixel(img, (x, y) => {
    const dx = (x - S * 0.5) / 200, dy = (y - S * 1.05) / 120;
    if (dx * dx + dy * dy <= 1) {
      const i = (y * S + x) * 4;
      img.data[i] = 14; img.data[i + 1] = 122; img.data[i + 2] = 120;
    }
  });
  // earring dot + accent
  fillCircle(img, S * 0.36, S * 0.46, 8, [224, 170, 62]);
  finish(img, 163, 5, 0.08);
}

function portraitLine(img) {
  const { noise, rand } = base(167);
  forEachPixel(img, (x, y) => {
    const c = gradient([[0, [250, 247, 240]], [1, [240, 234, 224]]])(y / S);
    return [...c, 255];
  });
  const ink = [31, 36, 48];
  // face oval via parametric stroke
  const stroke = (fn, w = 2) => {
    for (let t = 0; t < 1000; t++) {
      const [x, y] = fn(t / 1000);
      fillCircle(img, x, y, w, ink);
    }
  };
  // face contour
  stroke((t) => {
    const a = t * Math.PI * 2;
    const r = 120 * (1 + 0.06 * Math.sin(a * 3 + 1) * (noise(t * 8, 0.5, 2) - 0.5));
    return [S * 0.5 + Math.cos(a) * r * 0.82, S * 0.44 + Math.sin(a) * r];
  }, 2.4);
  // closed eyes (arcs)
  for (const side of [-1, 1]) {
    stroke((t) => {
      const a = Math.PI * (0.15 + t * 0.7);
      return [S * 0.5 + side * 46 + Math.cos(a) * 20, S * 0.4 + Math.sin(a) * 12 + 4];
    }, 2.2);
    // brows
    stroke((t) => {
      const a = Math.PI * (0.1 + t * 0.8);
      return [S * 0.5 + side * 48 + Math.cos(a) * 24, S * 0.345 + Math.sin(a) * 10 - 4];
    }, 2.2);
  }
  // nose
  stroke((t) => {
    const tt = t;
    return [S * 0.5 + Math.sin(tt * Math.PI * 0.9) * 10 - 5, S * 0.42 + tt * 46];
  }, 2.2);
  // lips
  stroke((t) => {
    const a = Math.PI * (0.08 + t * 0.84);
    return [S * 0.5 + Math.cos(a) * 26, S * 0.56 + Math.sin(a) * 8 + 2];
  }, 2.4);
  fillCircle(img, S * 0.5 + 30, S * 0.565, 3, [196, 68, 62]);
  // hair strokes
  for (let i = 0; i < 26; i++) {
    const a0 = Math.PI * (0.9 + (i / 26) * 1.2);
    stroke((t) => {
      const a = a0 + t * 0.35;
      const r = 128 + t * 26;
      return [S * 0.5 + Math.cos(a) * r * 0.8, S * 0.42 + Math.sin(a) * r];
    }, 1.8);
  }
  finish(img, 167, 5, 0.05);
}

// ===========================================================================
// MINIMAL ART
// ===========================================================================

function minimalBauhaus(img) {
  const { noise } = base(173);
  forEachPixel(img, (x, y) => {
    const c = gradient([[0, [236, 231, 221]], [1, [226, 219, 205]]])(y / S);
    return [...c, 255];
  });
  // large rust semicircle
  forEachPixel(img, (x, y) => {
    const dx = (x - S * 0.32) / 150, dy = (y - S * 0.62) / 150;
    if (dx * dx + dy * dy <= 1 && y <= S * 0.62) {
      const i = (y * S + x) * 4;
      img.data[i] = 193; img.data[i + 1] = 68; img.data[i + 2] = 46;
    }
  });
  // black quarter circle
  forEachPixel(img, (x, y) => {
    const dx = (x - S * 0.72) / 120, dy = (y - S * 0.3) / 120;
    if (dx * dx + dy * dy <= 1 && dx >= 0 && dy >= 0) {
      const i = (y * S + x) * 4;
      img.data[i] = 26; img.data[i + 1] = 26; img.data[i + 2] = 28;
    }
  });
  // bars
  fillRect(img, S * 0.52, S * 0.68, S * 0.3, 10, [38, 42, 48]);
  fillRect(img, S * 0.52, S * 0.73, S * 0.2, 10, [38, 42, 48]);
  // mustard dot
  fillCircle(img, S * 0.74, S * 0.52, 22, [228, 166, 62]);
  finish(img, 173, 5, 0.05);
}

function minimalMonochrome(img) {
  const { noise } = base(179);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [252, 251, 248]], [1, [240, 238, 233]]])(v);
    const d = Math.hypot(u - 0.38, v - 0.42);
    const ring = Math.exp(-((d - 0.24) ** 2) / 0.0008);
    c = mixc(c, [60, 60, 62], ring * 0.9);
    const soft = Math.exp(-(d * d) / 0.08) * 0.06;
    c = mixc(c, [120, 120, 124], soft);
    return [...c, 255];
  });
  fillRect(img, S * 0.55, S * 0.62, S * 0.28, 3, [26, 26, 28]);
  fillRect(img, S * 0.68, S * 0.3, 26, 26, [26, 26, 28]);
  fillCircle(img, S * 0.82, S * 0.24, 7, [196, 68, 62]);
  finish(img, 179, 4, 0.05);
}

function minimalRhythm(img) {
  const { noise, rand } = base(181);
  forEachPixel(img, (x, y) => {
    const c = gradient([[0, [250, 249, 246]], [1, [238, 236, 231]]])(y / S);
    return [...c, 255];
  });
  // concentric offset rings
  const cx = S * 0.42, cy = S * 0.46;
  forEachPixel(img, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    const ring = Math.abs(((d / 26) % 1) - 0.5);
    if (ring > 0.42 && d < 200) {
      const i = (y * S + x) * 4;
      img.data[i] = 70; img.data[i + 1] = 74; img.data[i + 2] = 80;
    }
  });
  // growing dot column
  for (let i = 0; i < 7; i++) {
    fillCircle(img, S * 0.74, S * 0.24 + i * 44, 5 + i * 1.6, [21, 128, 74]);
  }
  finish(img, 181, 4, 0.05);
}

// ===========================================================================
// TECHNOLOGY
// ===========================================================================

function technologyCircuit(img) {
  const { noise, rand } = base(191);
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    let c = gradient([[0, [11, 16, 32]], [1, [7, 10, 22]]])(v);
    const dot = noise(u * 60, v * 60, 1);
    if (dot > 0.93) c = mixc(c, [40, 56, 88], 0.5);
    return [...c, 255];
  });
  const rand2 = mulberry32(191);
  // traces
  for (let i = 0; i < 26; i++) {
    let x = rand2() * S, y = rand2() * S;
    const col = rand2() > 0.5 ? [31, 111, 235] : [57, 208, 216];
    const steps = 3 + Math.floor(rand2() * 4);
    for (let s = 0; s < steps; s++) {
      const horiz = rand2() > 0.5;
      const len = 40 + rand2() * 120;
      const nx = horiz ? x + len * (rand2() > 0.5 ? 1 : -1) : x;
      const ny = horiz ? y : y + len * (rand2() > 0.5 ? 1 : -1);
      // glow pass + core pass
      const drawLine = (w, color, alpha) => {
        const n = Math.ceil(Math.hypot(nx - x, ny - y) / 2);
        for (let k = 0; k <= n; k++) {
          const lx = lerp(x, nx, k / n), ly = lerp(y, ny, k / n);
          fillCircle(img, lx, ly, w, [color[0], color[1], color[2]], alpha);
        }
      };
      drawLine(5, col, 0.12);
      drawLine(1.6, col, 0.9);
      x = nx; y = ny;
    }
    fillCircle(img, x, y, 5, [230, 241, 255]);
    fillCircle(img, x, y, 2.4, col);
  }
  // chips
  for (let i = 0; i < 3; i++) {
    const cxp = 80 + rand2() * 340, cyp = 80 + rand2() * 340;
    fillRect(img, cxp, cyp, 64, 64, [16, 22, 40]);
    fillRect(img, cxp + 3, cyp + 3, 58, 58, [24, 32, 54]);
    for (let p = 0; p < 6; p++) {
      fillRect(img, cxp + 8 + p * 9, cyp - 6, 4, 6, [57, 208, 216]);
      fillRect(img, cxp + 8 + p * 9, cyp + 64, 4, 6, [57, 208, 216]);
    }
  }
  finish(img, 191, 5, 0.1);
}

function technologyHex(img) {
  const { noise } = base(197);
  const R = 26; // hex radius
  const w = Math.sqrt(3) * R, hstep = R * 1.5;
  // Build lattice of hex centres, then per-pixel nearest centre.
  const centers = [];
  let row = 0;
  for (let y = -R; y < S + R; y += hstep, row++) {
    const off = (row % 2) * (w / 2);
    for (let x = -R; x < S + R; x += w) {
      centers.push([x + off, y]);
    }
  }
  // grid acceleration: bucket centres
  const cell = w;
  const grid = new Map();
  centers.forEach(([cx, cy], idx) => {
    const k = `${Math.floor(cx / cell)},${Math.floor(cy / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([cx, cy, idx]);
  });
  const palette = [[7, 21, 34], [10, 34, 52], [13, 52, 74], [16, 78, 104], [20, 110, 138], [38, 160, 190], [94, 234, 212]];
  forEachPixel(img, (x, y) => {
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    let best = null, bestD = 1e9;
    for (let gy2 = gy - 1; gy2 <= gy + 1; gy2++) {
      for (let gx2 = gx - 1; gx2 <= gx + 1; gx2++) {
        const bucket = grid.get(`${gx2},${gy2}`);
        if (!bucket) continue;
        for (const [cx, cy, idx] of bucket) {
          const d = (x - cx) ** 2 + (y - cy) ** 2;
          if (d < bestD) { bestD = d; best = [cx, cy, idx]; }
        }
      }
    }
    let c = palette[0];
    if (best) {
      const [cx, cy, idx] = best;
      const n = noise(cx * 0.02, cy * 0.02, 3);
      const level = Math.min(palette.length - 1, Math.floor(n * palette.length * 1.4));
      c = palette[level];
      const d = Math.sqrt(bestD);
      if (d > R * 0.86) c = [4, 10, 18]; // edges
    }
    return [...c, 255];
  });
  finish(img, 197, 5, 0.1);
}

function technologyPixels(img) {
  const { noise, rand } = base(211);
  const cellSize = 8;
  const palette = [[34, 211, 238], [244, 114, 182], [163, 230, 53], [251, 191, 36], [167, 139, 250], [248, 250, 252]];
  forEachPixel(img, (x, y) => {
    const u = x / S, v = y / S;
    const cx = Math.floor(u * 24), cy = Math.floor(v * 24);
    const n = noise(cx * 0.35, cy * 0.35, 3);
    let c = [10, 10, 18];
    if (n > 0.52) {
      const idx = Math.floor(noise(cx * 1.3 + 7, cy * 1.3 + 3, 2) * palette.length) % palette.length;
      c = palette[idx];
      const bright = 0.55 + 0.45 * noise(cx * 2.1, cy * 2.1, 2);
      c = [c[0] * bright, c[1] * bright, c[2] * bright];
    }
    // scanlines
    if (y % 2 === 0) c = [c[0] * 0.82, c[1] * 0.82, c[2] * 0.82];
    return [...c.map(clamp255), 255];
  });
  finish(img, 211, 4, 0.12);
}

// ===========================================================================
// Registry + generation
// ===========================================================================

const GALLERY = [
  { category: 'nature', id: 'ember-ridge', name: 'Ember Ridge', draw: natureEmberRidge },
  { category: 'nature', id: 'verdant', name: 'Verdant Canopy', draw: natureVerdant },
  { category: 'nature', id: 'tide', name: 'Morning Tide', draw: natureTide },
  { category: 'architecture', id: 'skyline', name: 'City Dusk', draw: architectureSkyline },
  { category: 'architecture', id: 'arches', name: 'Terracotta Arches', draw: architectureArches },
  { category: 'architecture', id: 'facade', name: 'Glass Grid', draw: architectureFacade },
  { category: 'landscapes', id: 'alpine', name: 'Alpine Mirror', draw: landscapeAlpine },
  { category: 'landscapes', id: 'dunes', name: 'Dune Lines', draw: landscapeDunes },
  { category: 'landscapes', id: 'aurora', name: 'Aurora Drift', draw: landscapeAurora },
  { category: 'animals', id: 'butterfly', name: 'Emperor Wing', draw: animalsButterfly },
  { category: 'animals', id: 'reef', name: 'Reef School', draw: animalsReef },
  { category: 'animals', id: 'kingfisher', name: 'Kingfisher', draw: animalsKingfisher },
  { category: 'abstract', id: 'radial', name: 'Radial Bloom', draw: abstractRadial },
  { category: 'abstract', id: 'interference', name: 'Interference', draw: abstractInterference },
  { category: 'abstract', id: 'mesh', name: 'Colour Mesh', draw: abstractMesh },
  { category: 'portraits', id: 'ember-profile', name: 'Ember Profile', draw: portraitEmber },
  { category: 'portraits', id: 'bauhaus-face', name: 'Bauhaus Face', draw: portraitBauhaus },
  { category: 'portraits', id: 'line-study', name: 'Line Study', draw: portraitLine },
  { category: 'minimal', id: 'bauhaus-comp', name: 'Bauhaus Composition', draw: minimalBauhaus },
  { category: 'minimal', id: 'monochrome', name: 'Monochrome Ring', draw: minimalMonochrome },
  { category: 'minimal', id: 'rhythm', name: 'Rhythm', draw: minimalRhythm },
  { category: 'technology', id: 'circuit', name: 'Circuit Board', draw: technologyCircuit },
  { category: 'technology', id: 'hexgrid', name: 'Hex Data', draw: technologyHex },
  { category: 'technology', id: 'pixelrain', name: 'Pixel Rain', draw: technologyPixels },
];

const outDir = new URL('../src/assets/samples/', import.meta.url).pathname;

for (const item of GALLERY) {
  const img = makeImage(S, S);
  item.draw(img);
  const path = `${outDir}${item.category}-${item.id}.png`;
  savePNG(path, S, S, img.data);
  console.log(`✓ ${item.category}/${item.id}`);
}

// Manifest consumed by src/lib/samples.ts (kept in sync by this script)
const manifest = GALLERY.map(({ category, id, name }) => ({ category, id, name, file: `${category}-${id}.png` }));
writeFileSync(`${outDir}manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} sample images generated.`);

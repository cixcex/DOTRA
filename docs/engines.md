# DOTRA Engines

DOTRA ships **three rendering engines behind one decoder contract**: the same
URL and the same photograph can be rendered by each engine, measured with the
same metrics, and only a raster that jsQR decodes back to the exact URL may be
exported. The Engine Lab (Studio → Engine Lab tab) renders all three
side-by-side so you can compare scan safety, photo fidelity and look — then
export any verified panel, or the best-scoring one.

## Registry

| Engine | Module | Origin | Look |
| --- | --- | --- | --- |
| **Composite** (default) | `src/engine/dotRenderer.ts` | DOTRA v3, this repo | Full-bleed photograph beneath a dense grid of tiny B&W square modules; hairline gaps show raw photo; optional perforation ring |
| **Halftone** | `src/engines/halftoneEngine.ts` | Port of [JeSuisUnCaillou/visual-qrcode](https://github.com/JeSuisUnCaillou/visual-qrcode) (MIT) | Each module = 3×3 (or 4×4) sub-pixels; the centre sub-pixel carries the data in pure B/W, the 8 (or 12) ring sub-pixels show the photograph |
| **Artistic** | `src/engines/artisticEngine.ts` | Port of the deterministic TS toolkit of [duanxianpi/artistic-qrcode-generator](https://github.com/duanxianpi/artistic-qrcode-generator) (MIT) | Shaped modules (square, rounded, dot, squircle, row/column with timing-aware connectors), three-layer markers, seeded margin noise, crystalize / liquidify / perspective effects, optional photo backdrop |

All three share `src/engines/raster.ts` — a DOM-free raster core — and
`src/engines/compare.ts` for metrics. `src/engines/index.ts` is the registry
with MIT attributions.

## The shared raster core

`src/engines/raster.ts` is deliberately free of DOM types (`HTMLCanvasElement`,
`CanvasRenderingContext2D`). It provides:

- `Raster` — a `Uint8ClampedArray` RGBA image with `get/set/luma/averageCellRGB`;
- painters (solid rect, circle, rounded-rect SDF, ring-of-subpixels helpers);
- `drawCover` — the same cover-fit placement the composite engine uses;
- `boxBlur`, `crystalize` (Delaunay via `delaunator`), `liquidify`
  (blur + threshold), `perspectiveWarp` (bilinear solve of the 8 homography
  coefficients);
- `mulberry32` — deterministic seeded RNG.

Because the browser engines and the Node harness import **the same file**, the
harness renders pixel-identical to the app — there is no second implementation
to drift. (`scripts/pngkit.mjs` remains the harness's PNG *codec*; the raster
math is shared.)

## Halftone engine (visual-qrcode port)

Faithful to the origin gem's design:

1. **Sub-pixel grid.** Each module is a k×k block of sub-pixels (k = 3 or 4).
2. **Sacred centre.** The centre sub-pixel (1×1 at k=3, 2×2 at k=4) carries the
   data colour — pure black or white. The remaining 8/12 ring sub-pixels show
   the photograph. This is why the engine scans: the decoder-critical signal is
   never photographic.
3. **Function patterns solid.** Finder/timing/alignment/format modules render
   as solid B/W blocks (the origin gem's behaviour).
4. **EC level H.** The origin gem forces H for redundancy; the lab re-encodes
   the shared URL at H for the halftone panel (the composite and artistic
   panels use the Studio's EC level — asserted in T14).
5. **Photo padding.** The origin gem insets the photograph by padding modules
   so photo content never touches structural patterns; the port keeps this as
   a clamped `photoPadding` option (clamped to `⌊N/2⌋ − 5`).

Adaptations for DOTRA: quiet zone is respected (never photo, never noise);
transparent photo regions fall back to the data colour (origin rule); the
render is canvas-free via the shared raster core; and the engine carries its
own repair ladder (below).

**Honest limitation.** At thumbnail-scale rasters the 3×3 centre sub-pixel
drops below reliable decoder resolution. The harness proves the ladder handles
it: a 192 px render of a long URL fails at defaults and is rescued by the 4×4
centre rung (T14).

## Artistic engine (qrcode-toolkit port)

The origin repository's headline pipeline (Stable Diffusion + ControlNet tile
offload) is **GPU-bound and deliberately not ported** — DOTRA is 100%
client-side with no GPU requirement and no network. What *was* ported is its
deterministic TypeScript toolkit (`node-qrcode-toolkit`, antfu lineage, MIT):

- **Pixel styles** — square, rounded, dot, squircle, plus row/column styles
  with timing-aware connectors that keep the timing pattern continuous;
- **Markers** — three-layer finder/alignment drawing (outer, inner, logo
  layer) with per-marker shapes;
- **Margin noise** — seeded pseudo-random dots in the quiet zone
  (`spaces: full | minimal | marker`), decorative only, never inside the
  matrix;
- **Effects** — `crystalize` (Delaunay triangulation + per-cell tone),
  `liquidify` (blur + threshold), `perspective` (homography warp), applied
  after the noise pass;
- **Photo backdrop** — optional: the photograph renders behind the module
  layer (modules stay opaque ink).

Adaptations: data modules are tone-pinned to B/W ink (the toolkit's coloured
module fills are disabled — DOTRA never lets module polarity drift for
aesthetics); the quiet zone stays clean white except for the seeded margin
noise; every render passes through the same jsQR gate.

**Scan-safety findings (measured with jsQR, T14).** Which styling survives the
gate is empirical, not aesthetic:

- **Module styles all survive** — square, rounded, dot, squircle, row and
  column stripes verify at rung 0: the module centre stays dark, which is what
  jsQR samples.
- **Finder markers are the fragile part.** Square and hollow-box markers verify
  everywhere; circle is marginal; octagon and plus/tiny-plus outer shapes are
  rejected. A diamond, circle or plus *core* leaves light corners inside the
  3×3 finder core and is rejected even at 1024 px on a white frame — the ladder
  flattens markers to square at rung 2. (The diamond core now *renders* correctly;
  it simply cannot carry the finder pattern jsQR looks for.)
- **Effects and full-quiet-zone noise** (crystalize, liquidify, perspective,
  `marginNoiseSpace: 'full'`) escalate to rung 1.
- **Custom palettes** — inverted or low-contrast light/dark colours — escalate
  to rung 4, which resets to the default B/W palette.
- **Busy or dark photograph backgrounds** defeat jsQR's finder search at preview
  size for large matrices; the final rung drops the photo background.
- The completeness property is asserted in the harness: a 20-configuration
  option sweep plus the busy-photo case — **every artistic configuration verifies
  at some rung**; no styled render is ever silently undecodable.

## Comparison metrics (`src/engines/compare.ts`)

All metrics are computed on the **rendered raster**, not internal state:

- **Fidelity** — how much of the photograph survives. Computed *per polarity
  band* (dark vs light data modules), because module polarity comes from the
  QR data, not the photo: a global correlation would be dominated by the binary
  pattern. Per band it is **Pearson r × gain**, where gain is the rendered
  luma standard deviation over the photo's — a render that maps the photo
  monotonically but compresses it into a narrow band (opaque modules,
  pole-locked colours) scores honestly low. Measured on the acceptance matrix
  (3 URLs × 3 artworks, 1024 px): composite **0.315**, halftone **0.878**,
  artistic **0.058** — the numbers match the designs (band-mapped modules vs
  8/9-photo rings vs opaque modules on a photo backdrop).
- **Separation** — dark vs light data-module luminance gap at module centres
  (scan margin). Measured: composite 205.4, halftone 255.0, artistic 245.0.
- **Hue deviation** — mean hue distance over saturated photo modules (null
  when too few saturated samples — e.g. opaque-module designs — and treated
  neutrally).
- **Score** — `0.45·min(sep/180,1) + 0.35·max(0,fidelity) + 0.20·(1−hueDev/45)`,
  and **0 when the panel is not jsQR-verified** — an unverified render can
  never win the comparison.

## Repair ladders

Every engine escalates rendering parameters only — the matrix and the URL are
never touched:

| Engine | Rung 0 | Rung 1 | Rung 2 | Rung 3 | Rung 4 | Rung 5 |
| --- | --- | --- | --- | --- | --- | --- |
| Composite | Studio defaults | influence ↓ 0.35 | influence 0.2 + strict B&W | full-size square modules | ring off | EC-H + influence 0 |
| Halftone | 3×3 sub-pixels, photo to grid edge | 4×4 centre | + photo padding | solid data modules | — | — |
| Artistic | toolkit styling (user options) | effects + margin noise off | square finder markers | plain square modules | default B&W palette | photograph background off |

Each rung re-renders and re-verifies the actual pixels; the UI replays the
exact rung that verified. The artistic ladder was calibrated against jsQR at
the 720 px preview size (T14): styled defaults fail on busy photographs and
large matrices, and the final rung — dropping the photograph background for a
clean white frame — is the same escape hatch the halftone engine uses.

## Attribution & licenses

- **Halftone engine** — ported from [JeSuisUnCaillou/visual-qrcode](https://github.com/JeSuisUnCaillou/visual-qrcode)
  (Ruby, **MIT**). Concept: sub-pixel halftone modules with a decoder-safe
  centre.
- **Artistic engine** — ported from the deterministic TypeScript toolkit of
  [duanxianpi/artistic-qrcode-generator](https://github.com/duanxianpi/artistic-qrcode-generator)
  (**MIT**; toolkit lineage: antfu's `qrcode-toolkit`). The origin's
  SD+ControlNet generation pipeline is GPU-bound and intentionally not part of
  DOTRA.
- Dependencies used by the ports: `qrcode-generator` (MIT), `delaunator` (ISC).

Both origin repositories are MIT-licensed; the ports are faithful re-implementations
in DOTRA's shared raster core, adapted to DOTRA's verification contract (jsQR
gate, immutable URL, sacred function patterns, clean quiet zone).

## Boundaries

- **No network, no GPU ML.** Everything is deterministic and local; seeds are
  explicit and reproducible (asserted in T14).
- **One decoder contract.** All three engines render through the same
  `verifyCanvas` jsQR gate and the same URL comparison as the Studio.
- **No mirror drift.** Browser and Node import the same `src/engines/*`
  sources; the harness bundles them with esbuild.

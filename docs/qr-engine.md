# QR Engine & Verification Design

How DOTRA turns a link and a photograph into a verified-scanable, photographically
recognizable dot QR — and the empirical calibration behind the tone bands.

## 1. Matrix generation

- `qrcode-generator` encodes the normalized URL (Byte mode, auto mask).
- **Version selection**: `auto` grows from v1 until the payload fits; `small`,
  `medium` and `large` buckets target ≈ v4 (33×33), v8 (49×49) and v14 (73×73).
  Forcing a larger version never changes the data — the library pads with
  error-correction codewords. A `minVersionForData` probe guarantees the requested
  bucket can hold the payload; the encoder always grows until it fits.
- Photographic modes recommend dense matrices (Photo → Large, Balanced → Medium,
  Scan → Auto) because recognizable imagery needs thousands of modules; the user
  can always override.
- **Error correction**: user-selectable L/M/Q/H (default M). The repair ladder's
  final step re-encodes at H.

## 2. Function-module mask (ISO/IEC 18004)

DOTRA renders its own mask of structural modules so image colour can never leak
into scanner-critical geometry:

- 3 finder patterns + separators (7×7 + 1-module ring each)
- timing patterns (row 6 / column 6)
- alignment patterns (per-version table, deduplicated against finder overlap)
- version information blocks (v ≥ 7)
- format information areas (both 15-bit strips around the top-left finder)
- the dark module at `(row 8, col N−8)`

These render as **pure black or pure white solid squares** (with a 0.6-module
overlap to avoid antialiasing hairline gaps). Data modules carry image colour.
The Node harness asserts the mask against a hand-computed v2 expectation
(282 protected modules) and per-module protection at v1/v4/v14.

## 3. Photographic preprocessing

`processImage()` runs before any colour is sampled:

1. **Smart crop** — for non-square sources with an untouched crop transform, a
   48×48 gradient-energy (saliency) grid is computed on a 192 px probe; the
   cover-fit window is slid over the overflow axis (13×13 candidates, slight
   centre bias) and the highest-energy window is chosen. Faces and subjects drift
   into the square. Any manual pan/zoom disables it.
2. **User adjustments** — brightness/contrast/saturation LUTs (±64 levels).
3. **Auto contrast** — percentile luminance stretch (0.5%–99.5%), skipped for
   flat images (range < 96 levels) to avoid noise amplification.
4. **CLAHE** — contrast-limited adaptive histogram equalization (8×8 tiles,
   clip 2.0, bilinear tile interpolation) on luminance only, chroma preserved;
   computed on a ≤1024 px working copy and composited back so large photos
   never stall the UI thread.
5. **Unsharp mask** — luminance-only edge sharpening (GPU blur copy, amount
   0.45); chroma is untouched, so edges pop without noisy dots.

The pipeline emits the N×N `sample` canvas (one colour per module) and the
high-res `detail` canvas (`clamp(N·24, 256, 2048)`) for fragment dots and the
animation's opening photo frame.

## 4. Tone bands — the core of photographic fidelity

The engine never repaints a module for looks; it **maps the photograph's colour
into the luminance band the QR matrix requires**:

- **Dark modules** → luminance remapped linearly into `[darkLo, darkCap]`.
- **Light modules** → luminance remapped linearly into `[lightFloor, lightCap]`.

The remap is a proportional RGB scale (down-scale for dark modules; a hue-safe
two-stage lift — proportional until a channel would clip, residual toward white —
for light modules), so **every dot keeps the exact hue of the photograph**; only
its brightness is pinned into its band. A wide neutral gap (≈100+ luminance
levels) separates the bands — that gap is what decoders need; everything inside
the bands is free for photographic colour. Light dots are additionally
chroma-boosted to compensate for the compression of the photograph's bright
tonal range.

`colorIntensity = 0` gives pure greyscale dots; `1` gives full photographic
colour. Higher `repairLevel` narrows the bands and (level ≥ 2) desaturates dark
dots toward neutral.

### Empirical calibration (why the light floor is high)

jsQR binarizes with area-based thresholds: in a block with no dark modules, a
"light" module whose luminance is merely *medium* gets flipped to dark. The
calibration harness (Node, real rasterization + jsQR decode) found:

- light floor **182–200: decode failures** (light modules flip dark)
- light floor **≥ 215: reliable**; **≥ 235: safe everywhere**
- dark modules tolerate caps up to ~150

Mode bands (darkLo/darkCap · lightFloor/lightCap · chromaBoost):

| Mode | Dark band | Light band | Boost | Character |
| --- | --- | --- | --- | --- |
| Photo | 10–118 | 230–250 | 1.25 | Widest bands — maximum photographic tonal range |
| Balanced (default) | 8–104 | 236–251 | 1.12 | Photographic colour with a safety margin |
| Scan | 5–84 | 242–252 | 1.0 | Narrow bands — maximum decoder margin |

Repair ladder bands: `{6–100, 238–251} → {5–84, 242–252} → {4–70, 246–253} → {3–56, 250–254}`.

`analyzeToneHealth()` reports what fraction of each population was compressed
into its band and warns for near-white, near-black or flat images.

## 5. Fragment dots

"Fragment" renders the actual image crop inside each module. Raw patches bypass
tone clamping, so DOTRA builds a **tone-safe detail canvas**
(`buildClampedDetail`, cached per canvas + band key) applying the per-pixel
equivalent of the band mapping: dark patches scale down into the band, light
patches lift with the same hue-safe two-stage math, then chroma boost. Fragment
dots use a tighter band — dark cap `min(darkCap, 96)`, light floor
`max(lightFloor + 8, 246)` — calibrated empirically after observing jsQR's area
binarization on textured patches (a textured block drifts the local threshold
more than a flat dot).

## 6. Verification contract

`verifyCanvas(canvas, expectedUrl)`:

1. `getImageData` on the render canvas (verification renders are always opaque
   white-backed — jsQR cannot read transparency).
2. jsQR decode in the worker (`inversionAttempts: 'dontInvert'`).
3. `compareUrls(expected, decoded)` — exact match after normalization; a
   close-but-different match is reported as a failure with the decoded text.

The same contract runs before **every** download: PNG at 1024/2048/4096 px, video
at 1080 px, GIF at 480 px. Each resolution rasterizes independently (anti-aliasing
behaves differently at different sizes), so each is verified on its own pixels.

## 7. Repair ladder

Tried in order; the first verified render wins. Labels appear in the UI attempt log.

| # | Strategy | Changes |
| --- | --- | --- |
| 1 | Photographic tone bands | — (the chosen mode's bands) |
| 2 | Wider band separation | dark cap 100 / light floor 238 |
| 3 | + Desaturation | as above, dark dots desaturated |
| 4 | Full-size dots, no gaps | `dotSize → 1`, `spacing → 0` |
| 5 | Maximum redundancy | as above + matrix re-encoded at EC level H |

The encoded URL is identical at every rung. If the ladder is exhausted, the app
reports the failure honestly (including "decoded to a different link" when the
payload mismatched) and keeps downloads disabled.

## 8. Photograph → QR animation

`particleEngine` renders one particle per visible module, each carrying **both**
its raw sampled photograph colour and its final tone-banded QR colour:

- **Photo phase** (u ≈ 0–0.16): particles sit on the module grid as filled
  squares in raw photo colours — the QR area reads as the photograph — while the
  smoothed source image crossfades underneath.
- **Break** (staggered per particle): the photo tiles scatter outward along the
  preset's vectors (gather / flow / pulse / orbit / reveal).
- **Assemble**: particles converge back onto their assigned module positions
  while their colour transitions photo → banded QR colour; structural modules
  materialise into pure black/white last, so the finders "crystallize" out of
  the photo.
- **Settle** and hold; at `u ≥ 1` the engine delegates to the static renderer —
  the final animation frame is pixel-identical to the verified downloadable QR.

MP4/GIF exporters receive the same `FrameSource` (including the photo underlay),
so exported videos open on the photograph too.

## 9. What is *not* done (by design)

- No module is "repainted" for aesthetics after calibration — dark/light values
  only move along the repair ladder.
- The QR matrix is the source of truth: the photograph never flips a module's
  encoded value; it only colours dots inside the band the matrix dictates.
- No logo overlays, no centre images, no "decorative" damage to structural modules.
- No server-side fallback: if jsQR cannot verify, the QR is not offered.

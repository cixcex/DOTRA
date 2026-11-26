# QR Engine & Verification Design

How DOTRA turns a link and an image into a verified-scanable dot QR — and the
empirical calibration behind the tone bounds.

## 1. Matrix generation

- `qrcode-generator` encodes the normalized URL (Byte mode, auto mask).
- **Version selection**: `auto` grows from v1 until the payload fits; `small`,
  `medium` and `large` buckets target ≈ v4 (33×33), v8 (49×49) and v14 (73×73).
  Forcing a larger version never changes the data — the library pads with
  error-correction codewords. A `minVersionForData` probe guarantees the requested
  bucket can hold the payload; the encoder always grows until it fits.
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

## 3. Tone mapping under luminance constraints

Each data module's colour comes from `mapModuleColor(sample, { dark, protectedModule,
preset, colorIntensity, repairLevel, desaturateDark })`:

- **Dark modules** (luma < 128): hue-preserving blend toward black, clamped to a
  dark cap. Dark modules are always rendered — they carry the data.
- **Light modules**: blend toward white, clamped to a light floor; `density`
  controls what fraction of light modules keep a coloured dot (the rest show
  paper).
- `colorIntensity = 0` gives pure black & white; `1` gives full photographic colour.
- Higher `repairLevel` widens the dark cap / raises the light floor and (level ≥ 2)
  desaturates dark dots toward neutral.

### Empirical calibration (why the floors are high)

jsQR binarizes with area-based thresholds: in a block with no dark modules, a
"light" module whose luminance is merely *medium* gets flipped to dark. The
calibration harness (Node, real rasterization + jsQR decode) found:

- light floor **182–200: decode failures** (light modules flip dark)
- light floor **≥ 215: reliable**; **≥ 235: safe everywhere**
- dark cap safe up to ~150

Preset bounds (dark cap / light floor):

| Preset | Dark cap | Light floor | Character |
| --- | --- | --- | --- |
| Resemblance | 128 | 232 | Photographic colour, darkest tones |
| Balanced (default) | 105 | 238 | Colour with a safety margin |
| Reliability | 78 | 246 | High contrast, conservative tones |

Repair ladder tones: `{95,244} → {75,250} → {55,252} → {45,254}`.

`analyzeToneHealth()` reports how many samples were clamped and warns when
`darkCap > 150` or `lightFloor < 215` — the same thresholds the harness proved.

## 4. Fragment dots

"Fragment" renders the actual image crop inside each module. Raw patches bypass
tone clamping, so DOTRA builds a **tone-safe detail canvas**
(`buildClampedDetail`, cached per canvas + tone key): pixels are luminance-blended
toward black/white and clamped into the safe band. Fragment dots use a tighter
band — dark cap `min(darkCap, 96)`, light floor `max(lightFloor + 8, 246)` —
calibrated empirically after observing jsQR's area binarization on textured
patches.

## 5. Verification contract

`verifyCanvas(canvas, expectedUrl)`:

1. `getImageData` on the render canvas (verification renders are always opaque
   white-backed — jsQR cannot read transparency).
2. jsQR decode in the worker (`inversionAttempts: 'dontInvert'`).
3. `compareUrls(expected, decoded)` — exact match after normalization; a
   close-but-different match is reported as a failure with the decoded text.

The same contract runs before **every** download: PNG at 1024/2048/4096 px, video
at 1080 px, GIF at 480 px. Each resolution rasterizes independently (anti-aliasing
behaves differently at different sizes), so each is verified on its own pixels.

## 6. Repair ladder

Tried in order; the first verified render wins. Labels appear in the UI attempt log.

| # | Strategy | Changes |
| --- | --- | --- |
| 1 | Preset tones | — (the chosen preset's bounds) |
| 2 | Stronger tone separation | dark cap 95 / light floor 244 |
| 3 | + Desaturation | as above, dark dots desaturated |
| 4 | Full-size dots, no gaps | `dotSize → 1`, `spacing → 0` |
| 5 | Maximum redundancy | as above + matrix re-encoded at EC level H |

The encoded URL is identical at every rung. If the ladder is exhausted, the app
reports the failure honestly (including "decoded to a different link" when the
payload mismatched) and keeps downloads disabled.

## 7. What is *not* done (by design)

- No module is "repainted" for aesthetics after calibration — dark/light values
  only move along the repair ladder.
- No logo overlays, no centre images, no "decorative" damage to structural modules.
- No server-side fallback: if jsQR cannot verify, the QR is not offered.

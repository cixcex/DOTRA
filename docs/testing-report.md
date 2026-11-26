# DOTRA Testing Report

Everything below was executed against the code in this repository. Engine results
are reproducible with `npm run test:engine`.

## 1. Node engine harness — 95 / 95 passed

`scripts/test-engine.ts` runs the *same* DOM-free planning logic the browser uses
(`buildDotPlanFromSamples`), rasterizes with a geometry-identical PNG renderer
(`scripts/pngkit.mjs`), and decodes the result with jsQR.

| Group | Coverage | Result |
| --- | --- | --- |
| T1 Matrix & version growth | v1→v4 growth loop, no re-throw on first overflow; bucket versions v4/v8/v14; minimum-version probe | ✓ |
| T2 Function-module mask | finders, separators, timing, alignment, version info, format info, dark module protected; v2 protected count = 282 (hand-computed); v1/v4/v14 spot checks | ✓ |
| T3 Decode matrix | 4 artworks × 3 presets × 5 shapes × 3 geometries = 180 rasterized QRs, jsQR-decoded | ✓ 180/180 |
| T4 URL × EC × version | 4 URLs × 4 EC levels × 3 version buckets, decode + payload equality | ✓ 48/48 |
| T5 Density / intensity / quiet zone | density 0.2–1.0, colorIntensity 0/1, quiet zone 2 vs 6 | ✓ |
| T6 Repair escalation | synthetic hostile sample forces ladder rungs 1–4; each rung re-verifies; EC-H re-encode at rung 5 | ✓ |
| T7 Tone invariants | dark cap / light floor per preset; `analyzeToneHealth` warnings at darkCap>150, lightFloor<215 | ✓ |
| T8 Large matrix end-to-end | v14 (73×73) with fragment dots: >4000 dots, jsQR decode of the raster | ✓ |

**Final: 95 passed, 0 failed.**

## 2. Tone calibration (empirical, jsQR)

The calibration exposed a real failure mode: jsQR's area-based binarization flips
mid-luminance "light" modules to dark in blocks that contain no dark modules.

| Light floor | Result |
| --- | --- |
| 182 / 200 | decode failures (182/200 test renders failed) |
| ≥ 215 | reliable |
| ≥ 235 | safe across all tested artworks |

Dark modules tolerate caps up to ~150. These findings set the preset floors
(232/238/246), the repair ladder floors (244→254), the fragment band
(`floor+8`, min 246), and the health warnings in `analyzeToneHealth`.

Fragment dots initially failed with raw image patches (tone clamping bypassed).
The fix — a tone-safe clamped detail canvas plus a tighter fragment band — was
also validated empirically: compression of the patches did not help; the band and
margins did.

## 3. Browser verification gate

The Node harness cannot prove the *UI* path, so the app itself enforces the same
contract at runtime:

- every pipeline render is decoded by jsQR (worker) and compared to the normalized
  URL — status stays `working`/`optimizing` until a decode matches;
- every export re-rasterizes at its own resolution and re-verifies before the
  download is produced;
- MP4 support is probed (WebCodecs + codec support) and, when unavailable, the
  exporter falls back to MediaRecorder WebM **with a visible UI note** — never a
  silent format swap.

## 4. Static analysis

- `tsc --noEmit`: clean (strict mode).
- `vite build`: clean; worker, fonts, 24 sample PNGs, favicons and OG cover all
  emitted to `dist/`.
- The OG cover embeds a real engine-generated dot-QR that passes a jsQR self-check
  at generation time (`npm run gen:assets` prints the verification line).

## 5. Known environment limits

- No camera/MP4/WebCodecs runtime QA was possible in the build environment
  (headless, no devices). The camera path uses standard `getUserMedia` + rAF +
  jsQR; the MP4 path probes capability first and degrades explicitly.
- GIF export at 4096-dot counts is intentionally capped at 480 px / 12 fps for
  palette stability; PNG and MP4 carry full resolution.

## 6. Manual QA checklist (for the reviewer)

1. `npm run dev` → studio loads with the ember-ridge sample; the preview animates
   and the badge turns green with the decoded URL.
2. Switch all 5 dot shapes and 5 animation presets — preview re-verifies each time.
3. Enter a long URL with `Large` matrix + `Fragment` dots — still verifies.
4. Upload a busy photograph with `Maximum resemblance` — watch the repair ladder
   engage (attempt log) and either verify or report honestly.
5. Export PNG 1024/2048/4096, MP4, GIF — each file decodes with the correct URL
   (use the in-app Test QR modal on the downloaded PNG).
6. Test QR modal → camera tab → scan a printed DOTRA QR; upload tab → decode a
   phone screenshot of one.

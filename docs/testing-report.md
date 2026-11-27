# DOTRA Testing Report

Everything below was executed against the code in this repository. Engine results
are reproducible with `npm run test:engine`.

## 1. Node engine harness — 181 / 181 passed

`scripts/test-engine.ts` runs the *same* DOM-free planning logic the browser uses
(`buildDotPlanFromSamples`), rasterizes the full v3 photographic composite with
a geometry-identical PNG renderer (`scripts/pngkit.mjs`, including the exported
`ringSquares()` ring geometry — zero mirror drift), and decodes the actual pixels
with jsQR. The v3 harness adds the composite acceptance matrix, influence /
colour / ring control matrices, hostile-composite repair escalation, pixel-level
underlay and ring evidence, and source-orientation coverage. The v4 harness adds
the Engine Lab acceptance matrix (T14): three engines on a shared matrix,
band-wise fidelity metrics, hostile ladder escalation, determinism.

| Group | Coverage | Result |
| --- | --- | --- |
| T1 Matrix & version growth | v1→v40 growth loop, no re-throw on first overflow; bucket versions v4/v8/v14; minimum-version probe | ✓ |
| T2 Function-module mask | finders, separators, timing, alignment, version info, format info, dark module protected; v2 protected count = 282 (hand-computed); v1/v4/v14 spot checks | ✓ |
| T3 Decode matrix | 4 artworks × 3 modes × 5 shapes × 3 shape-aware geometries = 180 rasterized composites with real photo underlays, jsQR-decoded | ✓ 180/180 |
| T4 URL × EC × version | 3 URLs × 4 EC levels × 4 version buckets, decode + payload equality | ✓ 48/48 |
| T5 Control variations | density 0.3–1.0, colorIntensity 0/0.5/1, influence 0/1, moduleContrast 0.5/1.4, colour treatment on/off, outer frame 2/8, ring on/off | ✓ 13/13 |
| T6 Repair escalation | circle-extreme composites (0.5/0.35 dots over bright and dark photography, EC level L): fail rungs 0–2 — defaults, wider bands, even black & white modules — and are rescued at rung 3 (full-size square modules); dark photography additionally decodes at defaults | ✓ |
| T7 Tone band invariants | every dot inside its mode's dark/light band; band separation ≥ 100 luma levels; repair bands monotonically safer | ✓ |
| T8 Large matrix end-to-end | v14 (73×73) fragment dots: 4,647 dots, N² raw photo colours on the plan, jsQR decode of the raster; fragment band invariants on the tone-safe detail (dark ≤ 96, light ≥ 246) | ✓ |
| T9 Photographic fidelity | portrait artwork, Photo mode: per-band luma Pearson r = 1.000 (dark) / 0.996 (light); mean Δhue 1.7° over 2,775 saturated modules; chroma retention 0.66; band-wise spatial correspondence r ≈ 1.0 vs within-band shuffled control ≈ 0 (proves the photograph — not a gradient — drives the colours); Scan mode decodes the same portrait | ✓ |
| T10 Six photo categories | portrait / landscape / animal / dark / bright / multicolor artworks × 3 modes at v14: decode + per-band fidelity for all 18 combinations | ✓ 18/18 |
| T11 Animation timeline | scatter envelope 0→1→0, single-peaked, bounded; photo→QR and structural blends monotone 0→1; structural materializes after data colour shift; real `createScene`: all 2,401 modules carry their raw photo colour (structural included), scatter-return completes by u = 0.86, particle count = dots + structural; ring geometry (4(N+q) squares on the frame centreline, ≥ 1.3-module clearance); underlay pixel evidence (dropped light modules and hairline gaps show the photograph; dark module centres stay dark) | ✓ |
| T12 Composite acceptance (spec §12) | 3 URLs × 6 photo categories × 2 rasters (1024/512 px) decode with exact URL match (36/36); module style × influence 15/15; influence × colour treatment × ring 12/12; hostile composite fails at defaults and is rescued by the ladder; final-frame determinism (export == preview pixels); ring / underlay / alignment pixel probes | ✓ |
| T13 Source dimensions & orientation | portrait 500×800, landscape 800×500, square 512×512 sources via center crop; 1024 px rasters decode exactly (9/9); non-square sources never distort the matrix | ✓ |
| T14 Engine Lab (spec §14) | shared matrix across engines; halftone re-encodes at EC-H; 3 URLs × 3 artworks × 3 engines at 1024 px decode with exact URL match (27/27); metrics — separation 205.4 / 255.0 / 245.0, band-wise fidelity 0.315 / 0.878 / 0.058 (composite / halftone / artistic — the designs honestly differ); halftone hostile (long URL, 192 px thumbnail) fails at 3×3 defaults and is rescued by the 4×4-centre rung; artistic hostile (all effects maximum) fails and is rescued with effects off; determinism (same seed identical, new seed differs); matrix immutability; artistic ladder completeness at the 720 px preview size with Studio-default EC-H — busy-photo (animal) styled defaults genuinely fail jsQR and the photograph-background-off rung rescues, a 20-configuration styled option sweep verifies at some rung in every case (worst rung 5), the diamond finder-core rendering bug is regression-probed (drawShape painted nothing for diamond — fixed), and render guards ensure no panel can stick at “Rendering”; engine artifacts saved | ✓ 27/27 + sweeps |

**Final: 181 passed, 0 failed.**

Recognizability note: the harness cannot *see* images. Its fidelity metrics are
the honest programmatic proxies — per-band luma correlation (the photo's tonal
structure survives inside each band), hue preservation (Δhue ≈ 2°), chroma
retention, and the shuffled-control spatial check. The rendered PNGs are saved
to `/tmp/dotra-v3/` for human review (Engine Lab panels: `engine-{composite,halftone,artistic}.png`).

## 2. Tone calibration (empirical, jsQR)

Two calibration rounds, one per engine generation:

**Crush engine (v1)** — dark modules blended to black, light modules to white.
jsQR's area-based binarization flips mid-luminance "light" modules to dark in
blocks without dark modules: light floor 182/200 failed, ≥ 215 reliable, ≥ 235
safe everywhere. That engine could not show a photograph.

**Band engine (v2) + v3 display transform (current)** — every module keeps the photo's hue; luminance is
pinned into a dark band or a light band. The harness re-validated the whole
decode matrix (T3: 180/180) with the new bands, including the densest
configuration (Photo mode, all light modules kept, v14 fragments). The Photo
mode's light floor (230) sits inside the empirically safe zone; when a hostile
image still fails, the repair ladder widens the bands (238 → 242 → 246 → 250).
The v3 display transform then blends each band colour toward its pure black/white
pole by the image-influence control; the poles are the band-envelope extremes, so
no influence, contrast or B&W setting can cross the decoder-safe gap (asserted
across modes in T7).

Fragment dots use a tighter band (cap ≤ 96, floor ≥ 246) because textured
patches drift jsQR's local threshold more than flat dots — unchanged from v1
and re-asserted in T8.

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
- The OG cover embeds a real engine-generated photographic composite QR that passes a jsQR self-check
  at generation time (`npm run gen:assets` prints the verification line).

## 5. Known environment limits

- No camera/MP4/WebCodecs runtime QA was possible in the build environment
  (headless, no devices). The camera path uses standard `getUserMedia` + rAF +
  jsQR; the MP4 path probes capability first and degrades explicitly.
- GIF export at 5k-dot counts is intentionally capped at 480 px / 12 fps for
  palette stability; PNG and MP4 carry full resolution.
- The bundled 24 samples are procedural artworks, not photographs; the harness
  covers true photographic categories (portrait/landscape/animal/dark/bright/
  multicolor) with synthetic photo-like artworks.

## 6. Manual QA checklist (for the reviewer)

1. `npm run dev` → studio loads with the ember-ridge sample; the preview opens
   on the photograph, breaks into particles, assembles into the dot QR, and the
   badge turns green with the decoded URL.
2. Switch all 3 quality modes (Photo / Balanced / Scan) — Photo is visibly the
   most photographic; Scan the most high-contrast. All verify.
3. Switch all 5 module styles and 5 animation presets — preview re-verifies each
   time; the final frame always matches the exported PNG.
4. Upload a real portrait photograph in Photo mode + Large matrix — facial
   features, hair and clothing tones are recognizable through and between the
   modules; the in-app Test QR modal's upload tab decodes the exported PNG to the exact URL.
5. Enter a long URL with `Large` matrix + `Fragment` dots — still verifies.
6. Export PNG 1024/2048/4096, MP4, GIF — each file decodes with the correct URL.
7. Test QR modal → camera tab → scan a printed DOTRA QR with a phone.

# DOTRA Architecture

A map of the engine, the data flow through the app, and the design decisions that
keep the system testable, private and honest about scanability.

## Guiding constraints

1. **Every QR must genuinely scan.** The app never claims success from the internal
   matrix — jsQR must decode the *rendered raster*, and the decoded payload must
   equal the normalized URL.
2. **The encoded URL is immutable.** Repair may change tones, geometry, dot size,
   desaturation or error-correction level — never the payload.
3. **Structural modules are sacred.** Finder/timing/alignment/version patterns and
   the dark module render as pure black/white solid squares. No image colour, no
   partial coverage.
4. **100% client-side.** No network calls with user content; workers and canvas only.

## Module map

| Module | Responsibility |
| --- | --- |
| `engine/types.ts` | Shared types: options, Dot, MatrixInfo, DotPlan, VerificationStatus, DecodeResult |
| `engine/qrGenerator.ts` | URL → genuine QR matrix (`qrcode-generator`), ISO 18004 function-module mask, version buckets, minimum-version probe |
| `engine/imageProcessor.ts` | Saliency smart crop, tone adjustments (brightness/contrast/saturation), percentile auto-contrast, CLAHE, unsharp mask; N×N module sampling; high-res detail canvas for fragment dots |
| `engine/dotRenderer.ts` | Luminance-band tone mapping input; dot planning (density selection + bright-photo drop rule); five-layer composite rasterization (photo underlay → structural squares → B&W modules → perforation ring); tone-safe fragment detail; N² raw photo colours on the plan |
| `utils/contrastOptimizer.ts` | Band mapping + the v3 display transform (image influence, module contrast, B&W intensity, colour treatment) → final module colours |
| `engine/particleEngine.ts` | Particle scene (one particle per visible module carrying raw photo + final QR colours); photo → scatter → assemble timeline; scene drawing |
| `engine/qrVerifier.ts` | jsQR decoding (Web Worker + main-thread fallback), URL comparison, canvas verification |
| `engine/animationFrames.ts` | `FrameSource` — the common input for video/GIF exporters |
| `engine/pngExporter.ts` | Canvas → PNG blob, download helper, safe filename derivation |
| `engine/videoExporter.ts` | WebCodecs VideoEncoder + mp4-muxer (H.264/AV1/VP9 probe order); MediaRecorder WebM fallback with explicit note |
| `engine/gifExporter.ts` | gifenc palette quantization → animated GIF |
| `workers/qrDecode.worker.ts` | Off-main-thread jsQR decode with transferable buffers and 4s timeout |
| `hooks/useQRGenerator.ts` | Pipeline orchestration, debounce, repair ladder, per-resolution export verification |
| `hooks/useParticleAnimation.ts` | rAF driver for the preview canvas; u≥1 delegates to the static renderer |

## Pipeline data flow

```
URL input
  │ normalizeUrl()            → { ok, url, error }   (auto-https, protocol/host checks)
  ▼
encodeQR(url, ec, bucket)
  │ qrcode-generator          → matrix (isDark), version, error-correction
  ▼
processImage(img, crop, N, adjustments, enhance)
  │ smart crop → LUTs → auto-contrast → CLAHE → unsharp → N×N resample
  │                                          → { sample (N×N), detail (high-res), stats }
  ▼
buildDotPlan({ matrix, processed, dots, preset, repairLevel, influence, moduleContrast,
               bwIntensity, colourTreatment })
  │ sampleModuleColors → mapModuleColor (band mapping + pole blend) → toneHealth → density
  │                           → { dots[], underlay, photoColors (N² raw samples), toneHealth, fragmentSource }
  ▼
renderPlanToCanvas(plan, matrix, renderOpts, px)  → static frame (5 composite layers + ring)
  ▼
createScene(plan, matrix, canvasSize, quietZone, controls) → ParticleScene
  ▼
verifyCanvas(staticCanvas, url)  → jsQR (worker) → { ok, text } → compareUrls
  │
  ├─ verified → status VERIFIED, downloads enabled, replay animation
  └─ failed   → repair ladder (6 rungs, see qr-engine.md) → re-render → re-verify
```

Exports reuse the same primitives: each export resolution renders its own canvas
(with the geometry override applied if generation needed it), verifies it
independently, and only then produces a download.

## Geometry

For a matrix of size `N` with quiet zone `q` on a square canvas of side `S`:

- module pitch `mp = S / (N + 2q)`
- module center `(ox + (c + 0.5)·mp, oy + (r + 0.5)·mp)` where `ox = oy = q·mp`
- dot diameter `d = mp · clamp(dotSize − spacing, 0.25, 1)`
- fragment patches are module-aligned crops from the high-res detail canvas
  (detail resolution `clamp(N·24, 256, 2048)`), inset 0.4 px at detail scale
- v3 composite: the photograph underlay is cover-fit into the grid rectangle
  only (the outer frame stays white); data modules are squares of
  `dotSize − spacing` pitch; the perforation ring rides the quiet-zone
  centreline at ±(q/2)·mp with 0.24·mp squares (4(N+q) of them), gated to
  q ≥ 3 and opaque backgrounds
- tone mapping is band-based: dark modules → `[darkLo, darkCap]`, light modules
  → `[lightFloor, lightCap]`, hue preserved by proportional RGB scaling
  (`mapModuleColor` in `utils/contrastOptimizer.ts`)

The Node test harness rasterizes with byte-identical geometry, which is why its
jsQR decode results are meaningful evidence for the browser path.

## Animation

`ParticleScene` holds one particle per *visible* module (structural and data),
each with its target centre, delay and motion vector derived from the animation
preset, and **two colours**: the raw sampled photograph colour and the final
tone-banded QR colour. `drawSceneFrame(ctx, scene, u, opts)` plays the timeline:
photo phase (module-grid photo tiles over a crossfading source underlay) →
staggered scatter → converge with the photo→QR colour transition → structural
modules materialize as pure black/white last → settle. At `u ≥ 1` it calls the
very same `renderDotQR` used for PNG export, so the last animation frame is
pixel-identical to the verified static render. Hold frames draw statically.

## Workers

jsQR decoding runs in a module Web Worker (`qrDecode.worker.ts`). RGBA buffers are
copied into transferable ArrayBuffers, a 4-second timeout guards against wedged
workers, and failures fall back to main-thread decoding. The worker file is
bundled by Vite automatically.

## Node testability

Browser engines usually resist offline testing. DOTRA extracts every
performance-critical decision into DOM-free functions:

- `buildDotPlanFromSamples()` — the entire dot planner, taking pre-sampled
  colours/luminance instead of a canvas.
- A `scripts/pngkit.mjs` rasterizer mirrors `renderDotQR` geometry exactly —
  including the full five-layer v3 composite and the exported `ringSquares()`
  ring geometry (zero mirror drift).
- `scripts/test-engine.ts` then encodes → plans → rasterizes → jsQR-decodes in
  Node, exercising the same code paths the browser uses.

## UI layout

- **Hero** — self-contained looping demo (real engine pipeline on a bundled
  sample, verified live, with the decode chip).
- **Studio** — three-column workspace: link/source/library · preview/export ·
  quality/dots/QR/image/animation controls. Every control change debounces into a
  full pipeline re-run (typically < 150 ms).
- **Gallery** — 24 procedural samples; selection dispatches a window event that
  the studio consumes (single source of truth for "active sample").
- **Test QR modal** — camera (`getUserMedia`, rAF decode loop) or upload decode.

## Failure honesty

If the repair ladder is exhausted, the last render stays visible, the failure
reason (including "decoded to a different link") is reported verbatim, and
downloads remain disabled. The app never ships an unverified QR.

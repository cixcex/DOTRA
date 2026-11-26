# DOTRA

**Every dot tells a story.**

DOTRA transforms any image into a genuinely scannable QR code made of thousands of
coloured dots — assembled live with a particle animation, and verified against the
*actual rendered pixels* with jsQR before a single byte can be downloaded.

100% client-side. No servers, no uploads, no accounts, no tracking of your content.

---

## Highlights

- **Real QR codes, not QR-looking art.** A genuine ISO/IEC 18004 matrix is generated
  from your link. Finder, timing, alignment and version patterns render as pure
  black and white; only the data modules carry image colour — so the structure
  scanners rely on is never compromised.
- **Verification, not hope.** Every render is decoded with **jsQR** from the raster
  that would actually be exported, and the payload is compared against your link.
  Downloads stay disabled until a decode succeeds.
- **Automatic repair ladder.** If a first render does not decode, DOTRA escalates
  through five strategies — stronger tone separation, desaturation, full-size dots
  with no gaps, and finally maximum error-correction redundancy — re-verifying at
  every step. **The encoded URL never changes during optimization.**
- **Thousands of dots.** Up to a 73×73 module matrix (QR version 14) — ~5,300
  coloured dots carrying real image detail.
- **Five dot shapes** — circle, rounded, pixel, fragment (true image crops inside
  each dot) and soft (feathered particle glow) — with size, spacing, light-dot
  density and colour-intensity controls.
- **Five assembly animations** — gather, flow, pulse, orbit, reveal — with duration,
  speed, intensity, easing and background controls. The final animation frame is
  pixel-identical to the static render.
- **Exports**: PNG at 1024 / 2048 / 4096 px, MP4 animation at 1080p30 (WebCodecs +
  mp4-muxer, with an explicit WebM fallback note where MP4 is unsupported), and GIF
  at 480px. **Every export is re-verified at its own resolution** before download.
- **24 seeded sample artworks** — generated procedurally at build time, bundled
  offline, license-free.
- **Test QR modal** — scan a QR with your camera or upload a photo and decode it
  locally, right inside the app.

## Quick start

```bash
npm install
npm run dev        # local dev server
```

Production build and preview:

```bash
npm run build      # typecheck + vite build → dist/
npm run preview    # serve the production build
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` + production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript check only |
| `npm run test:engine` | Node engine test harness — **95 assertions, 0 failures** |
| `npm run gen:assets` | Regenerate favicons + OG cover (with a real verified dot-QR) |
| `npm run gen:samples` | Regenerate the 24 procedural sample artworks |

## How it works

1. **Normalize & validate** the URL (auto `https://`, protocol and host checks).
2. **Encode** a genuine QR matrix (`qrcode-generator`), choosing the smallest
   version that fits — or a larger bucket for finer image detail.
3. **Process** the source image: crop/transform, tone adjustments, then resample
   onto the N×N module grid plus a high-resolution detail canvas for fragment dots.
4. **Plan** every dot: map module colours under strict luminance constraints,
   protect structural modules, select which light modules keep a dot.
5. **Render** the static frame and build the particle scene (one particle per
   visible module).
6. **Verify** the rendered raster with jsQR in a Web Worker. Compare the decoded
   payload with the normalized URL.
7. **Repair & re-verify** automatically if needed; only then enable downloads.

See [docs/architecture.md](docs/architecture.md) for the module map and data flow,
and [docs/qr-engine.md](docs/qr-engine.md) for the QR engine, tone calibration and
verification design.

## The verification guarantee

- The matrix is real; the render is rasterized; **jsQR decodes the pixels**.
- The encoded URL is immutable during repair — only rendering parameters change.
- Module dark/light values are never altered for aesthetics; tone mapping operates
  inside conservative, empirically calibrated bounds (see
  [docs/testing-report.md](docs/testing-report.md)).
- PNG exports re-verify at 1024, 2048 and 4096 px; video at 1080 px; GIF at 480 px.

## Privacy

Everything runs in your browser tab. Images are read locally (File API) or from
bundled assets; nothing is transmitted anywhere. Close the tab and nothing remains.

## Project structure

```
├── index.html
├── public/                  # favicons, OG cover (with a real verified dot-QR)
├── scripts/                 # Node tooling: engine tests, asset/sample generators
│   ├── test-engine.ts       #   95-assertion engine harness (Node, no DOM)
│   ├── generate-assets.ts   #   favicons + OG cover
│   ├── generate-samples.mjs #   24 procedural sample artworks
│   ├── pngkit.mjs           #   dependency-free PNG encoder/decoder for Node
│   └── bundle-run.mjs       #   esbuild loader so Node can run the TS tooling
├── src/
│   ├── engine/              # QR, image, dots, particles, verification, exporters
│   ├── workers/             # jsQR decode worker (transferable buffers)
│   ├── hooks/               # useQRGenerator (pipeline + repair), useParticleAnimation
│   ├── components/          # Hero, Studio, panels, exports, Test QR modal…
│   ├── lib/                 # constants, sample registry
│   ├── utils/               # colour, contrast, URL, image helpers
│   └── assets/samples/      # 24 bundled sample artworks
└── docs/                    # architecture, QR engine, testing report
```

## Deployment

DOTRA is a static site. Any static host works; the app has no server-side
requirements. A ready-to-deploy bundle with Vercel configuration and deployment
docs is provided separately as `DOTRA-Vercel-Ready.zip`.

## Testing

The Node harness (`npm run test:engine`) exercises the exact same planning and
encoding logic the browser uses — including matrix/version growth, the ISO 18004
function-module mask, tone invariants, repair escalation, and end-to-end jsQR
decodes of rasterized QRs across artworks, presets, shapes and geometries:
**95 passed, 0 failed**. In the browser, the same jsQR gate runs on every render
and every export. Full results in [docs/testing-report.md](docs/testing-report.md).

## License

MIT

## Credits

Built with [jsQR](https://github.com/cozmo/jsQR) (verification),
[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (matrix
encoding), [gifenc](https://github.com/antimatter15/gifenc) (GIF),
[mp4-muxer](https://github.com/videosoft/mp4-muxer) (MP4), React, Vite and
Tailwind CSS. Sample artworks are procedurally generated and license-free.

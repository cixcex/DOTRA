# Contributing to DOTRA

Thanks for taking a look. DOTRA's whole reason to exist is a single promise —
**every QR it produces genuinely scans** — so a few constraints are non-negotiable.

## Development setup

```bash
git clone https://github.com/cixcex/DOTRA.git
cd DOTRA
npm install
npm run dev
```

Node 18+ required. Everything is client-side; no services, no env vars.

## Commands that matter

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run build` | Strict `tsc --noEmit` + production build |
| `npm run test:engine` | Node engine harness — **must stay 95/95** |
| `npm run gen:samples` | Regenerate the 24 procedural sample artworks |
| `npm run gen:assets` | Regenerate favicons + OG cover (self-verifies with jsQR) |

## Non-negotiables

1. **Verification gate.** Downloads stay disabled until jsQR decodes the actual
   rendered raster and the payload matches the normalized URL. Never bypass,
   weaken, or skip this — including for exports.
2. **Immutable payload.** Optimization and repair may change tones, geometry, dot
   size, desaturation or error-correction level — never the encoded URL.
3. **Structural modules are sacred.** Finder, timing, alignment, version and
   format patterns (and the dark module) render as pure black/white squares.
4. **Calibrated tones.** Light-module floors and dark-module caps were chosen
   empirically against jsQR's area-based binarization (see
   [docs/qr-engine.md](docs/qr-engine.md)). Do not relax them for aesthetics.
5. **Privacy.** No network calls with user content. Keep all processing local.

## Making changes

- Engine changes → extend `scripts/test-engine.ts`; the harness exercises the same
  DOM-free planning code the browser uses.
- UI changes → keep the minimalist system: warm off-white `#fafaf9`, ink `#0a0a0a`,
  hairline `#e8e8e6` borders, restrained green/red status colours.
- Exports → every export path re-verifies at its own resolution before download.
- Run `npm run build` and `npm run test:engine` before opening a pull request.

## Reporting issues

Open an issue with: browser + version, input image characteristics, preset/shape,
and whether the failure badge appeared (its verbatim reason text is the most
useful diagnostic DOTRA prints).

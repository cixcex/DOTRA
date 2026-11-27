# DOTRA documentation

- [architecture.md](architecture.md) — module map, pipeline data flow, dot geometry, worker strategy, Node testability design, UI layout
- [qr-engine.md](qr-engine.md) — matrix generation, the ISO 18004 function-module mask, tone mapping and its empirical calibration, fragment dots, the verification contract, the repair ladder
- [engines.md](engines.md) — the Engine Lab: the three rendering engines (composite, halftone port, artistic port), the shared DOM-free raster core, comparison metrics, per-engine repair ladders, MIT attributions
- [testing-report.md](testing-report.md) — the 177/177 Node harness results, tone-calibration experiments, the browser-side verification gate, and a manual QA checklist

> Deploying to Vercel? The `DOTRA-Vercel-Ready` bundle additionally contains
> `DEPLOYMENT.md` with step-by-step instructions and a `vercel.json` SPA rewrite.

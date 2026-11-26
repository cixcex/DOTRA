// Generic runner: bundle a TS entry with esbuild, then execute it.
// Usage: node scripts/bundle-run.mjs scripts/generate-assets.ts
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';

const entry = process.argv[2];
if (!entry) {
  console.error('Usage: node scripts/bundle-run.mjs <entry.ts>');
  process.exit(1);
}

const outfile = entry.replace(/\.tsx?$/, '.bundle.mjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  logLevel: 'silent',
});
await import(pathToFileURL(outfile).href);

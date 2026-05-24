// Runs at Docker build time to pre-bundle the Remotion composition.
// render.mjs skips the bundle() call and uses /app/bundle directly.
import { bundle } from '@remotion/bundler';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webpackOverride = (config) => config;

console.log('[prebundle] bundling Remotion composition...');
const outDir = await bundle({
  entryPoint: join(__dirname, 'src', 'index.ts'),
  outDir: join(__dirname, 'bundle'),
  webpackOverride,
});
console.log('[prebundle] done →', outDir);

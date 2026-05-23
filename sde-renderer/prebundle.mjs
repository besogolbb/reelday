// Runs at Docker build time to pre-bundle the Remotion composition.
// render.mjs skips the bundle() call and uses /app/bundle directly.
import { bundle } from '@remotion/bundler';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const webpackOverride = (config) => config;

console.log('[prebundle] bundling Remotion composition...');
const outDir = await bundle({
  entryPoint: './src/index.ts',
  outDir: './bundle',
  webpackOverride,
});
console.log('[prebundle] done →', outDir);

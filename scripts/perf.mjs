#!/usr/bin/env node
// Quick performance runner. Uses the test event slug from perf-check-prompt.md.
//
// Usage:
//   npm run perf           → spot check (wall 200c/1000req, ~30s)
//   npm run perf pre       → pre-event check (upload 600c + reactions 200c, ~1min)
//   npm run perf full      → full deep check (all scripts, ~6min)
//   npm run perf health    → health via Cloudflare+Traefik
//   npm run perf:local     → health direct to localhost:3000 (bypasses Traefik)
//
// Override slug: SLUG=my-slug npm run perf
// Override base: BASE_URL=http://localhost:3000 npm run perf

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const slug = process.env.SLUG || 'cxzv-fe0y';
const slugB = process.env.SLUG_B || 'scarlette-skye-td9n';
const mode = process.argv[2] || 'spot';

function run(script, ...args) {
  const env = { ...process.env };
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${script} ${args.join(' ')}`);
  console.log('─'.repeat(60));
  const result = spawnSync('node', [join(dir, script), ...args], { stdio: 'inherit', env });
  if (result.status !== 0) process.exitCode = 1;
}

async function health() {
  const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');
  const url = `${base}/api/health`;
  console.log(`\nChecking ${url} …`);
  const t0 = performance.now();
  try {
    const r = await fetch(url);
    const ms = (performance.now() - t0).toFixed(0);
    const body = await r.text();
    console.log(`  ${r.status} in ${ms}ms — ${body.slice(0, 120)}`);
    if (ms > 200) console.log('  ⚠ health > 200ms baseline');
    else console.log('  ✓ health OK');
  } catch (e) {
    console.log(`  ✗ health failed: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log(`\nReelday perf runner — mode=${mode} slug=${slug}`);
console.log(new Date().toISOString());

if (mode === 'local') {
  // Hits Fastify directly inside the container — bypasses Traefik and Cloudflare entirely.
  // Run from the Easypanel terminal to isolate whether Traefik is adding latency.
  process.env.BASE_URL = 'http://localhost:3000';
  console.log('Direct container test (no Traefik, no Cloudflare)');
  await health();
  // Also time the wall endpoint directly
  const wallUrl = `http://localhost:3000/api/uploads/${slug}`;
  console.log(`\nChecking ${wallUrl} …`);
  const t0 = performance.now();
  try {
    const r = await fetch(wallUrl, { headers: { 'X-Guest-Id': 'perf-local' } });
    const ms = (performance.now() - t0).toFixed(0);
    await r.text();
    console.log(`  ${r.status} in ${ms}ms`);
    if (ms > 700) console.log('  ⚠ wall > 700ms baseline');
    else console.log('  ✓ wall OK');
  } catch (e) {
    console.log(`  ✗ wall failed: ${e.message}`);
  }
} else if (mode === 'health') {
  await health();
} else if (mode === 'spot') {
  await health();
  run('stress-wall.mjs', slug, '200', '1000');
} else if (mode === 'pre') {
  await health();
  run('stress-upload.mjs', slug, '600', '600');
  run('stress-reactions.mjs', slug, '200', '1000');
} else if (mode === 'full') {
  await health();
  run('stress-upload.mjs', slug, '1000', '1000');
  run('stress-mixed.mjs', slug, '600', '1500', '30');
  run('stress-sustained.mjs', slug, '3');
  run('stress-multiwall.mjs', slug, '3', '150', '30');
  run('stress-cross-event.mjs', slug, slugB, '200', '30');
} else {
  console.error(`Unknown mode "${mode}". Use: spot | pre | full | health`);
  process.exit(1);
}

// Demo content seeder — uploads a folder of real photos/videos to an event
// as varied Filipino guest names, so the wall looks like a real reception.
//
// Drop your media files in a folder, point this at the event slug, run.
// Each file uploads as a different guest with an occasional sweet message.
//
// Usage:
//   node scripts/seed-demo-content.mjs <slug> [folder=./demo-media] [delay_ms=300]
// Env:
//   BASE_URL (default https://reelday.ph)
//
// Cleanup: every uploaded fileKey contains "demo-seed-", and uploads land in
// the DB with the chosen guest name. To wipe: delete R2 objects with prefix
// uploads/<slug>/ where filename contains "demo-seed-", and delete DB rows
// where original_filename LIKE '%demo-seed-%' for that slug.

import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, basename } from 'node:path';

const slug = process.argv[2];
const folder = process.argv[3] || './demo-media';
const delayMs = Number(process.argv[4] || 300);
const base = (process.env.BASE_URL || 'https://reelday.ph').replace(/\/+$/, '');

if (!slug) {
  console.error('Usage: node scripts/seed-demo-content.mjs <slug> [folder=./demo-media] [delay_ms=300]');
  process.exit(1);
}

const presignedUrl = `${base}/api/uploads/presigned`;
const completeUrl  = `${base}/api/uploads/complete`;

const GUEST_POOL = [
  'Tita Maria Santos', 'Kuya Juan Dela Cruz', 'Ate Joy Reyes', 'Mark Garcia',
  'Tita Linda Mercado', 'Kuya Ben Pascual', 'Ate Sofia Cruz', 'Lola Rosa Aguilar',
  'Tito Eric Domingo', 'Carlo Mendoza', 'Bea Torres', 'Migs Aquino',
  'Ysa Ramirez', 'Paulo Bautista', 'Andrea Lim', 'Daniel Sy',
  'Trisha Chua', 'JM Villar', 'Karla Domingo', 'Justin Robles',
  'Patricia Manalo', 'Ramon de Leon', 'Camille Tan', 'Lance Ocampo',
];

const MESSAGES = [
  'Congrats sa inyo!', 'So happy for you both 💕', 'Ang ganda ng event!',
  'Para sa inyo ❤️', 'Love this moment!', 'Cheers to forever!',
  'Best wishes!', 'Salamat sa imbitasyon!', 'Magandang araw!',
  'Forever yours na talaga 🥰', 'Sweet!', 'Ang saya saya!',
  'Beautiful 😍', 'God bless your journey', 'Walang katulad!',
];

const CONTENT_TYPES = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.mp4':  'video/mp4',
  '.mov':  'video/quicktime',
  '.webm': 'video/webm',
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function uploadOne(filePath, idx) {
  const ext = extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    console.log(`  [skip] ${basename(filePath)} (unsupported type)`);
    return { skipped: true };
  }

  const bytes = await readFile(filePath);
  const sizeKB = (bytes.length / 1024).toFixed(0);
  const isVideo = contentType.startsWith('video/');
  const fileType = isVideo ? 'video' : 'photo';

  const guestName = pick(GUEST_POOL);
  const guestId = `demo-seed-${guestName.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const filename = `demo-seed-${idx}-${basename(filePath)}`;
  const includeMessage = Math.random() < 0.4;
  const message = includeMessage ? pick(MESSAGES) : '';

  process.stdout.write(`  [${idx}] ${guestName.padEnd(22)} ${fileType.padEnd(5)} ${sizeKB.padStart(5)} KB  ${basename(filePath).slice(0, 30).padEnd(30)} ... `);

  // 1. presigned
  const pres = await fetch(presignedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
    body: JSON.stringify({ slug, filename, contentType }),
  });
  if (!pres.ok) {
    console.log(`FAIL (presigned ${pres.status})`);
    return { failed: true };
  }
  const { uploadUrl, fileKey } = await pres.json();

  // 2. R2 PUT
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  if (!put.ok) {
    console.log(`FAIL (R2 PUT ${put.status})`);
    return { failed: true };
  }

  // 3. complete
  const comp = await fetch(completeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
    body: JSON.stringify({
      slug, fileKey,
      uploader_name: guestName,
      message,
      file_type: fileType,
    }),
  });
  if (!comp.ok) {
    console.log(`FAIL (complete ${comp.status})`);
    return { failed: true };
  }

  console.log('OK');
  return { ok: true, guestName, fileType };
}

async function main() {
  let entries;
  try {
    entries = await readdir(folder);
  } catch (e) {
    console.error(`Cannot read folder "${folder}": ${e.message}`);
    console.error(`Create the folder and drop your demo photos/videos in it.`);
    process.exit(1);
  }

  const files = [];
  for (const name of entries) {
    const p = join(folder, name);
    const s = await stat(p);
    if (s.isFile()) files.push(p);
  }
  if (files.length === 0) {
    console.error(`No files in "${folder}".`);
    process.exit(1);
  }

  console.log(`Seeding ${files.length} files to ${base}/u/${slug}`);
  console.log(`Guest pool: ${GUEST_POOL.length} names · delay between uploads: ${delayMs}ms\n`);

  const start = performance.now();
  let ok = 0, failed = 0, skipped = 0;
  for (let i = 0; i < files.length; i++) {
    const r = await uploadOne(files[i], i + 1);
    if (r.ok) ok++;
    else if (r.skipped) skipped++;
    else failed++;
    if (i < files.length - 1) await sleep(delayMs);
  }
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);

  console.log(`\nDone in ${elapsed}s — ok=${ok} failed=${failed} skipped=${skipped}`);
  console.log(`\nWall: ${base}/u/${slug}`);
  console.log(`\nCleanup: delete R2 objects with key prefix uploads/${slug}/ where filename contains "demo-seed-"`);
  console.log(`Also delete DB rows where original_filename LIKE '%demo-seed-%' for slug ${slug}`);

  if (failed > 0) process.exitCode = 1;
}

main();

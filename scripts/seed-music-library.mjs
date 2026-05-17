// One-shot seeder for the wall background-music library.
//
// Reads ./music-library/<mood>/manifest.json + the audio files alongside it,
// uploads each MP3 to R2 at music/<mood>/<filename>, and upserts the
// corresponding music_playlists / music_tracks rows.
//
// Idempotent — re-running replaces tracks for the named playlist. Playlists
// are matched by `name`. R2 uploads use Content-Type: audio/mpeg and a long
// immutable cache header (these files never change once uploaded).
//
// Manifest format (one per mood folder):
//   {
//     "name":        "Cocktail Hour Jazz",
//     "mood":        "cocktail",
//     "description": "Light jazz for arrival and cocktails",
//     "cover_color": "#d4af37",
//     "position":    20,
//     "tracks": [
//       { "file": "01-smooth-sunset.mp3", "title": "Smooth Sunset",
//         "artist": "Bensound", "duration_s": 180,
//         "license_info": "Bensound, free with attribution" }
//     ]
//   }
//
// Usage (from Easypanel terminal or local with .env loaded):
//   node scripts/seed-music-library.mjs [folder=./music-library]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, '..', 'backend', '.env') });

const REQUIRED = ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  console.error(`Run from Easypanel terminal or with backend/.env present.`);
  process.exit(1);
}

const folder = process.argv[2] || './music-library';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  region: 'auto',
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const publicBase = process.env.R2_PUBLIC_URL.replace(/\/+$/, '');

async function uploadTrack(localPath, r2Key) {
  const body = await readFile(localPath);
  await s3.send(new PutObjectCommand({
    Bucket:       process.env.R2_BUCKET_NAME,
    Key:          r2Key,
    Body:         body,
    ContentType:  'audio/mpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${publicBase}/${r2Key}`;
}

async function upsertPlaylist(manifest) {
  const { rows } = await db.query(
    `SELECT id FROM music_playlists WHERE name = $1`,
    [manifest.name],
  );
  if (rows.length) {
    await db.query(
      `UPDATE music_playlists
          SET mood = $2, description = $3, cover_color = $4,
              position = $5, is_active = true
        WHERE id = $1`,
      [rows[0].id, manifest.mood, manifest.description || null,
       manifest.cover_color || null, manifest.position ?? 0],
    );
    return rows[0].id;
  }
  const { rows: ins } = await db.query(
    `INSERT INTO music_playlists (name, mood, description, cover_color, position, is_active)
     VALUES ($1, $2, $3, $4, $5, true)
     RETURNING id`,
    [manifest.name, manifest.mood, manifest.description || null,
     manifest.cover_color || null, manifest.position ?? 0],
  );
  return ins[0].id;
}

async function replaceTracks(playlistId, tracks) {
  await db.query(`DELETE FROM music_tracks WHERE playlist_id = $1`, [playlistId]);
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    await db.query(
      `INSERT INTO music_tracks
         (playlist_id, title, artist, file_url, duration_s, position, license_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [playlistId, t.title, t.artist || null, t.file_url,
       t.duration_s || 0, i, t.license_info || null],
    );
  }
}

async function processMoodFolder(moodPath) {
  const manifestPath = join(moodPath, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (e) {
    console.log(`  [skip] ${basename(moodPath)} — no manifest.json`);
    return;
  }
  if (!manifest.name || !manifest.mood || !Array.isArray(manifest.tracks)) {
    console.log(`  [skip] ${basename(moodPath)} — manifest missing name/mood/tracks`);
    return;
  }

  console.log(`\nPlaylist: ${manifest.name} (${manifest.mood}) — ${manifest.tracks.length} tracks`);

  const uploaded = [];
  for (const t of manifest.tracks) {
    if (!t.file || !t.title) {
      console.log(`  [skip] track missing file/title`);
      continue;
    }
    const localPath = join(moodPath, t.file);
    try { await stat(localPath); }
    catch { console.log(`  [skip] ${t.file} — file not found`); continue; }
    const r2Key   = `music/${manifest.mood}/${t.file}`;
    process.stdout.write(`  uploading ${t.file} ... `);
    const fileUrl = await uploadTrack(localPath, r2Key);
    console.log('OK');
    uploaded.push({ ...t, file_url: fileUrl });
  }

  if (!uploaded.length) {
    console.log(`  ! no tracks uploaded — playlist will be empty, skipping DB upsert`);
    return;
  }

  const playlistId = await upsertPlaylist(manifest);
  await replaceTracks(playlistId, uploaded);
  console.log(`  ✓ DB upserted — playlist_id=${playlistId} with ${uploaded.length} tracks`);
}

async function main() {
  let moods;
  try {
    moods = await readdir(folder);
  } catch {
    console.error(`Cannot read folder "${folder}". Create it with this layout:`);
    console.error(`  music-library/`);
    console.error(`    ceremony/   manifest.json + .mp3 files`);
    console.error(`    cocktail/   manifest.json + .mp3 files`);
    console.error(`    dinner/     manifest.json + .mp3 files`);
    console.error(`    party/      manifest.json + .mp3 files`);
    process.exit(1);
  }

  console.log(`Seeding music from ${folder}`);
  console.log(`R2 bucket: ${process.env.R2_BUCKET_NAME}`);
  console.log(`Public base: ${publicBase}`);

  for (const m of moods) {
    const p = join(folder, m);
    const s = await stat(p);
    if (s.isDirectory()) await processMoodFolder(p);
  }

  await db.end();
  console.log(`\nDone. Picker in dashboard will show all is_active=true playlists.`);
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

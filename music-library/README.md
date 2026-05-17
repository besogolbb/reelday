# Reelday Wall Music Library

Source folder for tracks uploaded to R2 by `scripts/seed-music-library.mjs`.

## Structure

```
music-library/
  ceremony/   manifest.json + .mp3 files
  cocktail/   manifest.json + .mp3 files
  dinner/     manifest.json + .mp3 files
  party/      manifest.json + .mp3 files
```

Manifests are tracked in git so the playlist *structure* is reproducible.
The actual MP3s are **not** tracked (see `.gitignore`) — they live only on
the machine running the seeder and on R2 after upload.

## To add tracks

1. Drop `.mp3` files into the appropriate mood folder
2. Edit `manifest.json` in that folder to list each track:
   - `file`         — exact filename
   - `title`        — what shows on the wall
   - `artist`       — credit (e.g. "FreePD", "Bensound")
   - `duration_s`   — approximate length in seconds (for picker display)
   - `license_info` — attribution string if required (kept in DB for audit)
3. Re-run `node scripts/seed-music-library.mjs` from the Easypanel terminal
4. The seeder is idempotent — it replaces the playlist's tracks on each run

## Track sources (legal, free)

| Source | License | Notes |
|---|---|---|
| YouTube Audio Library | YT-only license, free for any use | Best variety. Requires Google login. studio.youtube.com → Audio Library |
| FreePD | CC0 (public domain) | No attribution required. freepd.com |
| Pixabay Music | Pixabay license (free commercial) | No attribution. pixabay.com/music |
| Bensound | Free tier requires attribution | bensound.com — use sparingly to avoid attribution clutter |

## Avoid

- Vocals (fight with guest video audio on the wall)
- Heavy bass drops or sudden volume spikes
- Anything from "free for non-commercial use" sites — Reelday is commercial
- "Royalty-free" YouTube videos that aren't from a verified library

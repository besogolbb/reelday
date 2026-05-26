# Reelday.ph — Marketing Engine (Remotion)

Reference for producing platform-targeted promo videos from the
`wall-recorder` Remotion project. When the user says "marketing video",
"reel", "FB post", "TikTok", etc., consult this file before building.

---

## Platform matrix

| Platform  | Audience behavior                    | Format decision                                          |
|-----------|--------------------------------------|----------------------------------------------------------|
| Facebook  | Reads captions, watches longer       | Horizontal 16:9 or square 1:1 + long caption             |
| Instagram | Scrolls fast, saves useful content   | Vertical 9:16 Reel + short punchy caption                |
| TikTok    | 2-second decision, sound-on          | Vertical 9:16 + bold on-screen text + trending sound     |

---

## The 3 reusable templates

### Template 1 — Facebook (16:9 horizontal)

- Full-width screen recording of the wall
- Subtle Ken Burns zoom on the demo footage
- Bottom lower-third: reelday.ph branding
- Top sticky bar when showing poll / trivia segment
- **Duration:** 20–30 seconds

### Template 2 — Instagram Reel (9:16 vertical)

- Screen recording centered, padded top and bottom
- Top padding: POV caption text (large, bold)
- Bottom padding: reelday.ph logo + CTA
- Animated text appears line by line
- **Duration:** 15–20 seconds

### Template 3 — TikTok (9:16 vertical)

- Same as IG but more aggressive text
- First frame: bold hook text only — no product yet
- Product appears at second 2–3
- Faster cuts between features
- **Duration:** 10–15 seconds

---

## Existing Remotion compositions (in [src/Root.tsx](src/Root.tsx))

| Composition id           | Size       | Use case                                       |
|--------------------------|------------|------------------------------------------------|
| `DemoWall`               | 1920×1080  | Long-form FB demo (slideshow only)             |
| `WallPollDemo`           | 1920×1080  | FB poll/trivia demo (matches Template 1)       |
| `WallPollDemoVertical`   | 1080×1920  | IG Reel + TikTok (matches Templates 2 & 3)     |
| `WallReactions`          | 1080×1350  | IG square-ish reactions clip                   |
| `HowItWorks`             | 1080×1350  | IG explainer                                   |
| `Pricing`                | 1080×1350  | Pricing static (still)                         |

Render scripts in [package.json](package.json):

```
npm run render                       # DemoWall
npm run render:poll-demo             # WallPollDemo (16:9)
npm run render:poll-demo-vertical    # WallPollDemoVertical (9:16)
```

Studio (live preview): `npm run studio`

---

## House style (keep all promos consistent)

- **Fonts:** Fraunces italic (display) + JetBrains Mono (eyebrow / stats)
- **Palette:** `#1a0f0a` background, `#c45a3a` accent, `#f0a37a` soft accent, `#d8a05a` gold (leader/highlight), `#2d7a4a` green (correct answer)
- **Music:** [public/party.mp3](public/party.mp3) for upbeat/social; [public/ceremony.mp3](public/ceremony.mp3) for soft/wedding tone. More options in [music-library/party/](../../music-library/party/) and [music-library/ceremony/](../../music-library/ceremony/).
- **Couple/event sample:** Andrea & JM, Wedding · Tagaytay (matches the [andrea-jm](https://reelday.ph/wall/andrea-jm) demo slug)

---

## How to add a new promo

1. **Pick a template** above based on the platform.
2. **Reuse existing composition if the framing matches** — most poll/trivia work fits `WallPollDemo` (FB) or `WallPollDemoVertical` (IG/TikTok). The component reads `useVideoConfig` and re-lays itself for the canvas.
3. **For a brand-new flow:** create a new `*.tsx` in [src/](src/), register two `<Composition>` ids in [src/Root.tsx](src/Root.tsx) — one 1920×1080, one 1080×1920 — pointing at the same component so the layout adapts.
4. **Add a render script** in [package.json](package.json) per format.
5. **Render outputs go to [out/](out/).** Commit the source, don't commit the rendered mp4s if they get large (currently they are committed; revisit if `out/` grows).

---

## Hook checklist (TikTok especially)

- Frame 0–2s: bold on-screen text hook, no product. Examples:
  - "Your wedding wall, but it talks back."
  - "Every guest. Every photo. One screen."
  - "We just turned trivia into the wedding game of the night."
- Frame 2–3s: cut to wall (slideshow already running)
- Frame 3s+: feature reveal (poll pops, results animate, etc.)
- Last 1s: reelday.ph logo + single CTA ("Set up your event in 2 min" / "reelday.ph/start")

# reelday.ph — Marketing Engine & Remotion Production Rules

Canonical reference for producing platform-targeted promo videos from the
`wall-recorder` Remotion project. Pass this file (or read it) at the
start of every marketing-video session.

When the user says "marketing video", "reel", "FB post", "TikTok", etc.,
consult this file **before** building.

---

## 🎯 Project Overview

- **Product:** reelday.ph — Live photo wall for Filipino celebrations (weddings, debuts, baptisms, corporate events)
- **Goal:** Reusable Remotion video templates for organic social content
- **Platforms:** TikTok · Instagram Reels · Facebook Reels
- **Stack:** Remotion · React · TypeScript

---

## 🎨 Brand Identity

> Use ONLY these values. Never guess or substitute.

```
PRIMARY (accent)      #c45a3a    // poll bar fill, ring pulse, eyebrow
SECONDARY (soft)      #f0a37a    // soft accent, links
GOLD (highlight)      #d8a05a    // poll leader, fastest-correct card
SUCCESS (correct)     #2d7a4a    // correct-answer reveal
BACKGROUND            #1a0f0a    // base canvas
TEXT                  #ffffff    // primary text
TEXT MUTED            rgba(255,255,255,.55)

DISPLAY FONT          Fraunces (italic) → fallback: Playfair Display, Georgia, serif
MONO FONT             JetBrains Mono → fallback: ui-monospace, monospace

WEBSITE               reelday.ph
DEMO SLUG             andrea-jm   (https://reelday.ph/wall/andrea-jm)
SAMPLE COUPLE         Andrea & JM — Wedding · Tagaytay
```

Logo: no SVG yet in [public/](public/). Use the text wordmark
`Reelday<span style="color:#f0a37a">.ph</span>` (Fraunces italic) until
a logo file is added at `public/logo.svg`.

---

## 🎵 Music

- **Upbeat / social posts:** [public/party.mp3](public/party.mp3) (starostin-upbeat-fun)
- **Soft / wedding tone:** [public/ceremony.mp3](public/ceremony.mp3)
- **More options:** [music-library/party/](../../music-library/party/) · [music-library/ceremony/](../../music-library/ceremony/) · [music-library/cocktail/](../../music-library/cocktail/) · [music-library/dinner/](../../music-library/dinner/)

If a new track is needed, copy from `music-library/` into [public/](public/) and reference via `staticFile('your-track.mp3')`.

---

## 📐 Platform Matrix

| Platform   | Audience behavior                  | Format decision                                          |
|------------|------------------------------------|----------------------------------------------------------|
| Facebook   | Reads captions, watches longer     | Horizontal 16:9 or square 1:1 + long caption             |
| Instagram  | Scrolls fast, saves useful content | Vertical 9:16 Reel + short punchy caption                |
| TikTok     | 2-second decision, sound-on        | Vertical 9:16 + bold on-screen text + trending sound     |

### Render specs

| Platform  | Size       | FPS | Duration       | Frames @ FPS    | Composition id              |
|-----------|------------|-----|----------------|-----------------|-----------------------------|
| TikTok    | 1080×1920  | 30  | 10–15s         | 300–450         | `ReeldayTikTok` (per-post)  |
| Instagram | 1080×1920  | 30  | 15–20s         | 450–600         | `ReeldayInstagram` (per-post)|
| Facebook  | 1920×1080  | 30  | 20–30s         | 600–900         | `ReeldayFacebook` (per-post)|

> Note: project standardizes on **30fps across all platforms** for parity with the wall and existing compositions. (The aspirational spec called for FB at 24fps; we keep 30fps unless a specific post requires otherwise.)

---

## 🧱 The 3 Reusable Templates

### Template 1 — Facebook (16:9 horizontal)
- Full-width screen recording of the wall
- Subtle Ken Burns zoom on the demo footage
- Bottom lower-third: reelday.ph branding
- Top sticky bar when showing poll / trivia segment
- **Duration:** 20–30 seconds

### Template 2 — Instagram Reel (9:16 vertical)
- Screen recording centered, padded top + bottom
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

## 📦 Existing Compositions

Source of truth: [src/Root.tsx](src/Root.tsx). Currently flat under [src/](src/) (no `components/templates/posts/` subfolders yet — refactor when ≥5 posts exist).

| Composition id           | Size       | FPS | Use case                                       |
|--------------------------|------------|-----|------------------------------------------------|
| `DemoWall`               | 1920×1080  | 30  | Long-form FB demo (slideshow only)             |
| `WallPollDemo`           | 1920×1080  | 30  | FB poll/trivia demo (Template 1)               |
| `WallPollDemoVertical`   | 1080×1920  | 30  | IG Reel + TikTok (Templates 2 & 3)             |
| `WallReactions`          | 1080×1350  | 30  | IG square-ish reactions clip                   |
| `HowItWorks`             | 1080×1350  | 30  | IG explainer                                   |
| `Pricing`                | 1080×1350  | 30  | Pricing static (still)                         |

Render scripts in [package.json](package.json):
```
npm run render                       # DemoWall
npm run render:poll-demo             # WallPollDemo (16:9)
npm run render:poll-demo-vertical    # WallPollDemoVertical (9:16)
npm run studio                       # live preview (all comps)
```

Pattern: most poll/trivia promos reuse `WallPollDemo` (16:9) + `WallPollDemoVertical` (9:16) — same component, adapts via `useVideoConfig`. For a new flow: build one component, register two `<Composition>` ids (1920×1080 + 1080×1920).

---

## 🧩 Reusable Component Spec (planned — build as posts are added)

These are the building blocks for new post compositions. Not all exist yet — create them on first need in [src/components/](src/) (or inline initially).

### `<WallFrame />`
Base container. Everything else renders inside or on top of this.

```ts
src: string                        // path to /public/segments/<file>.mp4
platform: 'vertical' | 'horizontal'
borderGlow?: boolean               // default false
children?: React.ReactNode         // overlays
```

Layout rules:
- **Vertical:** top 15% caption zone · middle 70% video · bottom 15% footer zone
- **Horizontal:** video full width, overlays on top
- Use `<OffthreadVideo>` (NOT `<Video>`) for the video source
- Never stretch or distort the screen recording aspect ratio
- Subtle dark vignette around screen recording edges

### `<TopStickyBar />`
Appears at top of WallFrame during poll/trivia segments.
```ts
text: string                       // e.g. "LIVE POLL — Bumoto na! Scan ang QR."
emoji?: string                     // e.g. "🗳️"
animateIn?: boolean                // slide down from top, default true
bgColor?: string                   // default rgba(0,0,0,0.75)
startFrame?: number
```
- Full width, fixed top, single bold line readable at 10–15 ft
- Emoji pulses every 60 frames
- Slides in from top when `animateIn`

### `<POVCaption />`
Animated hook text, line-by-line entrance.
```ts
lines: string[]
position: 'top' | 'bottom'
size: 'large' | 'medium' | 'small'   // TikTok / IG / FB
delay?: number
color?: string                       // default white
```
- Each line fades in + slides up, staggered by 8 frames
- White text + subtle dark drop shadow

### `<EmojiFloat />`
Floating emoji layer mimicking live wall reactions.
```ts
emojis: string[]
count: number
startFrame: number
zone: 'left' | 'right' | 'center' | 'full'
```
- Emojis spawn at bottom of zone, float up with random L/R drift, fade near top
- Random size 1rem–2.5rem, random speed, staggered spawn

### `<BrandFooter />`
reelday.ph branding at the bottom of every video.
```ts
showLogo: boolean
cta: string                          // default "Try it libre → reelday.ph"
animateIn?: boolean                  // default true
startFrame?: number
```
- Logo left, CTA text right; fades in last 30 frames unless `startFrame` set
- Always present in every render

---

## 📹 Video Segments (planned)

Pre-trimmed screen recordings live in `/public/segments/`. Use `<OffthreadVideo>` — NOT `<Video>` — for playback.

```
emoji-reactions.mp4    → Post 3R
pure-emotion.mp4       → Post 4
live-poll.mp4          → Post 5
live-trivia.mp4        → Post 6
```

> Ask the user for segment FPS before writing timing logic. Don't assume 30fps — screen recordings may vary.

---

## 🎬 Post Compositions Catalog

### Post 3R — Emoji Reactions
- **Segment:** `emoji-reactions.mp4`
- **Hook:** "POV: Nag-upload si Tita ng photo — at sabay-sabay na lumutang ang ❤️ sa malaking screen."
- **Key moment:** EmojiFloat layer over wall footage
- **CTA:** "Walang app. Scan lang. → reelday.ph"
- **Durations:** TikTok 15s · IG 20s

### Post 4 — Pure Emotion
- **Segment:** `pure-emotion.mp4`
- **Hook:** "The whole family. Finally in one frame. 🥹"
- **Key moment:** Slow Ken Burns zoom on best wall frame
- **CTA:** "reelday.ph"
- **Durations:** TikTok 12s · IG 18s

### Post 5 — Live Poll
- **Segment:** `live-poll.mp4` (or reuse `WallPollDemoVertical`)
- **Hook:** "POV: May live poll sa malaking screen 🗳️😂"
- **TopStickyBar:** "🗳️ LIVE POLL — Bumoto na! Scan ang QR code sa mesa mo."
- **Key moment:** Poll screen with vote tally animation
- **CTA:** "→ reelday.ph"
- **Durations:** TikTok 12s · IG 18s

### Post 6 — Live Trivia
- **Segment:** `live-trivia.mp4` (or reuse `WallPollDemoVertical`)
- **Hook:** "POV: May trivia tungkol sa couple 🧠"
- **TopStickyBar:** "🧠 TRIVIA TIME — Scan the QR & Answer Now!"
- **Key moment:** Question appear → countdown → correct-answer reveal
- **CTA:** "→ reelday.ph"
- **Durations:** TikTok 15s · IG 20s

---

## ⚙️ Platform Variant Pattern

Each post composition accepts a `platform` prop. Only 3 things change between TikTok and IG: hook size, duration, pacing.

```tsx
// TikTok
<PostComponent platform="tiktok"  hookSize="large"  durationInFrames={450} />
// Instagram
<PostComponent platform="ig"      hookSize="medium" durationInFrames={600} />
// Facebook (horizontal — separate composition)
<PostComponent platform="facebook" hookSize="small" durationInFrames={750} />
```

Register two composition ids per post: one 1080×1920 (TT/IG; same component, prop swap) and one 1920×1080 (FB).

---

## 🚫 Rules Claude Code Must Follow

1. **Never use `<Video>` for screen recordings — always `<OffthreadVideo>`**
2. **Never stretch or distort screen recording aspect ratio**
3. **Never hardcode colors — import from a brand constants module (or const block at top of file). Use the hex codes in §Brand Identity.**
4. **Never hardcode font names — use the brand font constants (`FONT_DISPLAY`, `FONT_MONO`).**
5. **Never guess segment FPS — ask the user if not confirmed.**
6. **Always use `interpolate()` and `spring()` from Remotion for animations — no CSS transitions.**
7. **Always keep text readable at small mobile sizes — minimum 32px body, 48px hooks (vertical canvas).**
8. **No placeholder / lorem ipsum — always use real reelday.ph copy.**
9. **Always export a named composition in [src/Root.tsx](src/Root.tsx) for every new post.**
10. **TikTok and Instagram share the same vertical component — only props change.**
11. **Commit + push after every render-able change** (standing rule across this repo).

---

## 📋 Session Startup Checklist

At the start of every marketing-video session, confirm:

- [ ] Brand hex codes match §Brand Identity (no drift)
- [ ] Brand fonts (Fraunces + JetBrains Mono) — fonts loaded by Remotion or use system fallbacks
- [ ] Segment FPS confirmed (ask if a new screen recording is being added)
- [ ] Segment files present in [public/segments/](public/) (create folder when first segment lands)
- [ ] Music file present in [public/](public/) (copy from `music-library/` if missing)
- [ ] Which post composition to build this session

---

## 💬 Copy Reference

**Signature tagline (use in every video):**
> Walang app. Walang login. Kahit si Lola kaya. 🙏

**CTA variants:**
> Try it libre → reelday.ph
> Scan lang. → reelday.ph
> → reelday.ph

**POV hook formula:**
> "POV: [relatable Filipino event scenario] — [what appears on screen]"

**Event types supported:**
- Weddings (primary)
- Debuts
- Baptisms
- Corporate events / Christmas parties
- Birthdays
- Family reunions

---

## 🎯 Hook Checklist (TikTok especially)

- **Frame 0–2s:** bold on-screen text hook, no product. Examples:
  - "Your wedding wall, but it talks back."
  - "Every guest. Every photo. One screen."
  - "We just turned trivia into the wedding game of the night."
- **Frame 2–3s:** cut to wall (slideshow already running)
- **Frame 3s+:** feature reveal (poll pops, results animate, etc.)
- **Last 1s:** logo + single CTA ("Set up your event in 2 min" / "reelday.ph/start")

---

## 📌 Content Sequence Status

| Post  | Description           | Status                    |
|-------|-----------------------|---------------------------|
| Post 1 | Product intro         | ✅ Published (FB)         |
| Post 2 | How it works          | ✅ Published (FB)         |
| Post 3 | Pricing               | 🙈 Hidden                 |
| Post 3R| Emoji reactions       | 🔜 Build next             |
| Post 4 | Pure emotion          | 🔜 Queue                  |
| Post 5 | Live poll             | ✅ Built (`WallPollDemo` + Vertical) |
| Post 6 | Live trivia           | ✅ Built (same comp, trivia segment) |
| Post 7 | Coordinator content   | ⏳ Queue                  |
| Post 8 | Pricing reintroduced  | ⏳ After social proof     |

---

## 🛠 How to Add a New Promo

1. **Pick a template** above based on the platform.
2. **Reuse an existing composition if framing matches** — most poll/trivia work fits `WallPollDemo` (FB) or `WallPollDemoVertical` (IG/TikTok). The component reads `useVideoConfig` and adapts.
3. **For a brand-new flow:** create one `*.tsx` in [src/](src/), register two `<Composition>` ids in [src/Root.tsx](src/Root.tsx) — one 1920×1080, one 1080×1920 — pointing at the same component.
4. **Add render scripts** in [package.json](package.json) per format.
5. **Render outputs go to [out/](out/).** Currently committed; revisit gitignore if size grows past ~50 MB total.

---

*Last updated: 2026-05-26 · reelday.ph Remotion Production Rules*

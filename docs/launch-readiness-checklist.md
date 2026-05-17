# Reelday Launch Readiness Checklist

**Target launch:** Wednesday 20 May 2026 (public) — slipped one day to ship the wall background-music feature
**Last updated:** 17 May 2026

Use this checklist to confirm everything is in place before the public launch. Work top to bottom — each section gates the next. If a row says "blocker" and isn't checked, do not launch.

---

## 1. Backend Performance — ✅ Validated 17 May

All items below were proven by stress tests run from PowerShell (production-truth, through Cloudflare).

| Check | Result | Evidence |
|---|---|---|
| Upload 1000c kickoff handles burst | ✅ 0 failures, p95 5.3 s | `scripts/stress-upload.mjs cxzv-fe0y 1000 1000` |
| Mixed peak load (600 uploads + 1500 reactions + walls) | ✅ 0 failures, p95 within baseline | `scripts/stress-mixed.mjs cxzv-fe0y 600 1500 30` |
| Sustained 3 min — no memory leak, flat latency | ✅ 0 failures, flat throughout | `scripts/stress-sustained.mjs cxzv-fe0y 3` |
| Multi-wall + 150 reaction spammers | ✅ 0 failures, walls protected | `scripts/stress-multiwall.mjs cxzv-fe0y 3 150 30` |
| Cross-event isolation (storm on A, polling B) | ✅ 0 failures, Wall B p95 611 ms | `scripts/stress-cross-event.mjs cxzv-fe0y scarlette-skye-td9n 200 90` |
| Single-user E2E upload (real guest experience) | ✅ p50 1.7 s, p95 2.3 s | `scripts/stress-upload-e2e.mjs cxzv-fe0y 1 10` |

**Total validation:** ~13,000 requests across the full suite with 0 failures.

**No backend work required before launch.**

---

## 2. Operational Readiness — Close Before Launch (Blockers)

These are the gaps flagged from the perf review. Each one is a launch blocker.

- [ ] **Verify nightly Postgres backup is running.**
  - Where: Hostinger control panel → Backups
  - Test: confirm a backup exists from the last 24h. If not, configure it now.

- [ ] **Test restore-from-backup at least once.**
  - Why: a backup you've never restored is not a backup.
  - Test: spin up a throwaway DB on the VPS, restore last night's snapshot, confirm the schema and a few rows load.

- [ ] **Set up uptime monitoring.**
  - Tool: UptimeRobot (free tier)
  - Configure: HTTPS check on `https://reelday.ph/api/health` every 5 minutes
  - Alert: email + SMS to your number
  - Expected: 200 response in under 2 seconds

- [ ] **Configure Easypanel container restart alerts.**
  - Where: Easypanel → Reelday app → Notifications
  - Alert on: container restart, CPU > 90% sustained 5 min, memory > 90%

- [ ] **Confirm host-warning copy is wired into booking flow.**
  - Where: booking confirmation email + post-booking dashboard message
  - Content: "For events over 500 guests, your wall may take 5–10 minutes to fully display all guest videos during peak upload moments. Nothing is lost — the wall catches up automatically."

- [ ] **Verify SQS dead-letter queue is configured.**
  - Where: AWS Console → SQS → reelday-transcode.fifo
  - Confirm: a DLQ exists and is wired to the main queue
  - Why: if a video fails to transcode 3 times, it lands in DLQ instead of looping forever

- [ ] **Apply the music schema migration on prod Postgres.**
  - Run `database/schema.sql` against prod (idempotent — uses `CREATE TABLE IF NOT EXISTS`)
  - Confirm tables exist: `\d music_playlists`, `\d music_tracks`
  - Confirm `events.music_playlist_id` column exists

- [ ] **Seed the music library.**
  - Curate 4 playlists (one per mood: ceremony, cocktail, dinner, party) with 5–8 royalty-free tracks each
  - Sources: YouTube Audio Library, FreePD, Bensound (with attribution)
  - Layout: `./music-library/<mood>/manifest.json` + `.mp3` files
  - Run from Easypanel terminal: `node scripts/seed-music-library.mjs`
  - Verify in dashboard: open event settings → "Wall music" dropdown shows the playlists

---

## 3. User Flow Validation — Manual Test on Real Devices

Synthetic load tests don't catch device-specific bugs. Run through these flows by hand before launch.

**Devices to test on (minimum):**
- [ ] iPhone (any model with iOS 16+) on Safari
- [ ] Android phone on Chrome
- [ ] Desktop browser (Chrome or Edge)

**Flows to test on each device:**
- [ ] Scan event QR code → land on guest upload page
- [ ] Sign in / register guest name
- [ ] Take a photo with camera → upload → see ✓ confirmation
- [ ] Pick a 30-second video from gallery → upload → see ✓ confirmation
- [ ] Wait up to 60 seconds → video appears on wall display in another tab/screen
- [ ] React with an emoji → wall shows the reaction
- [ ] Vote on a live poll (if one is active) → wall updates tally
- [ ] Force a slow network (Chrome DevTools → throttle to "Fast 3G") → upload still completes

**Wall display flow:**
- [ ] Open wall on a TV / projector / second screen
- [ ] Confirm autoplay works (videos play with no user click required)
- [ ] Confirm wall stays responsive after 30+ minutes of idle time
- [ ] Confirm refresh / reconcile (`?reconcile=1`) recovers a stuck wall

**Wall music flow (new in v1.0):**
- [ ] Pick a playlist for the demo event in dashboard → save
- [ ] Open the wall → tap the sound button once → music starts
- [ ] Trigger a video upload from a guest phone → confirm music **ducks** to low volume while video plays, restores after
- [ ] Run a live poll → confirm music **keeps playing** at normal volume during the poll
- [ ] Reload the wall → music should resume automatically if "sound on" was previously set (sound preference persists in localStorage)
- [ ] Switch playlist to "Off" in dashboard → reload wall → music doesn't play

**Account & dashboard flow:**
- [ ] Create a new event from the host dashboard
- [ ] Generate the event QR code → confirm it scans correctly with a phone camera
- [ ] Customize event branding (colors, message) → confirm changes appear on guest page and wall
- [ ] Receive booking confirmation email → confirm formatting on Gmail and Apple Mail

---

## 4. Day-of-Launch (Tuesday) — Final Checks

Run these on launch morning before flipping any "go live" switches.

- [ ] Run `npm run perf:full-local` from Easypanel terminal — confirm 0 failures
- [ ] Check Easypanel: container is running, no restart loop, CPU < 30% idle
- [ ] Check SQS queue depth: should be 0 (or close to it)
- [ ] Check R2 bucket: writable, no quota warnings
- [ ] Confirm Cloudflare is proxying reelday.ph (orange cloud on)
- [ ] Visit `https://reelday.ph` in incognito → page loads cleanly, no console errors
- [ ] Visit `https://reelday.ph/api/health` → returns 200 in under 2 s
- [ ] Visit the public demo wall → loads, shows existing content
- [ ] Confirm your phone gets UptimeRobot alerts (test by pausing the monitor briefly)

---

## 5. Communication Readiness

Before announcing publicly, make sure the basics are in place.

- [ ] Landing page (`reelday.ph`) has clear CTA to book or try demo
- [ ] Pricing is visible (or "contact us" path is clear)
- [ ] Contact / support method visible (email or Messenger link)
- [ ] FAQ covers the top 5 questions: how does it work, what's the cost, video time limit, what if my guests aren't tech-savvy, what about privacy
- [ ] Social proof: at least 1 testimonial or sample event visible on the landing page
- [ ] Privacy policy and terms of service exist and are linked in the footer
- [ ] Launch announcement post drafted for Instagram, Facebook, TikTok

---

## 6. Rollback / Incident Plan

If something breaks on launch day:

| Symptom | Immediate action | Who to notify |
|---|---|---|
| Site is down (`/api/health` failing) | Check Easypanel → restart container if needed. If DB issue, restore from last backup. | Yourself + anyone with active events |
| Uploads failing en masse | Check R2 status page, check Cloudflare status. If R2 down, communicate the outage to active hosts. | Active hosts |
| Wall not updating | Run `?reconcile=1` on the affected event. If platform-wide, check SQS queue depth and Lambda errors. | Affected hosts |
| Transcoding stuck (videos not appearing) | Check Lambda CloudWatch logs for errors. Check SQS queue depth. Manually drain DLQ if needed. | Affected hosts |
| Container in restart loop | Check Easypanel logs for stack trace. Roll back to the previous deploy if a recent change is the cause. | Yourself |

**Rollback path:** Easypanel keeps deploy history. To roll back, go to the Reelday app → Deployments → click the previous successful deploy → Redeploy.

**Backup contact:** Set one trusted person who can reach you (or check the site) if you're unreachable during an event.

---

## 7. Post-Launch (Days 1–7)

- [ ] Day 1: monitor every 2 hours, respond to all DMs within 2 hours
- [ ] Day 2: ask first 3 users for honest feedback (one question: "what would have made this 10× better?")
- [ ] Day 3: re-run spot-check (`npm run perf:local`)
- [ ] Day 7: full perf check (`npm run perf:full-local`) — compare to baseline, update baseline doc if anything materially changed
- [ ] Day 7: review UptimeRobot logs for any incidents you missed

---

## Sign-off

Launch is approved when:
- ✅ All Section 2 (Operational) checkboxes complete
- ✅ All Section 3 (User Flow) checkboxes complete on at least 2 devices
- ✅ Section 4 (Day-of) checks pass on launch morning
- ✅ You can answer "what do I do if X breaks?" for each row in Section 6 without looking it up

If any of these are not true on Tuesday morning — delay by 24 hours. A 1-day slip is invisible to the public. A botched launch is not.

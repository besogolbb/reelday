# Reelday Launch Readiness — Reconciled Status

**Last reconciled:** 30 May 2026
**Mission (source of truth → [LAUNCH-HANDOVER.md](LAUNCH-HANDOVER.md)):** maximize **paying customers by June 30, 2026**. The platform is technically live; the remaining work is *go-to-market*, not a "flip the switch" public launch. The old "Target launch 20 May" framing in earlier revisions of this file is retired.

> **Why this doc was reconciled (30 May):** the previous revision (19 May) showed *0/69* and a "launch 20 May" target. Since then most code-side blockers shipped to `main` and the mission moved to the June paying-customer push. This file now reflects verified repo state and **delegates ops/security items to the docs that own them** instead of duplicating them.

### Single source of truth — which doc owns what

| Track | Owner doc | This file's role |
|---|---|---|
| Go-to-market / paying customers / Founding 20 | [LAUNCH-HANDOVER.md](LAUNCH-HANDOVER.md) + [LAUNCH-MASTERPLAN-JUNE2026.md](LAUNCH-MASTERPLAN-JUNE2026.md) | summarised in §0 below |
| Operations / backups / deploy / debug | [HANDOVER.md](HANDOVER.md) | linked, not duplicated |
| Owner-action security + infra-I-can't-see | [security-checklist.md](security-checklist.md) | linked, not duplicated |
| SDE beta + Lambda redeploy | [SDE-HANDOVER.md](SDE-HANDOVER.md) | one blocker row in §2 |
| Backend capacity / perf log | [perf-test-database.md](perf-test-database.md) | summarised in §1 |
| Manual device QA | **this file, §3** | owned here |

---

## 0. Go-live status (the actual gate now)

The technical platform is shippable. Go-live = **make Founding 20 bookable, then execute Week 1 outreach.** Full detail in [LAUNCH-HANDOVER.md](LAUNCH-HANDOVER.md).

- ✅ **Coupon / promo-code system built** — merged to `main` 29 May (`88631ff`, `6d7f971`, `3999172`); `coupons` table in both `schema.sql` and boot migrations; admin Coupons tab + checkout `?coupon=` banner. Tested 22/22.
- [ ] **Redeploy in Easypanel** so the boot migration creates the `coupons` table in prod. *(owner action — see [HANDOVER.md](HANDOVER.md) §Deploy)*
- [ ] **Create the `FOUNDING20` code** (₱1,500 off · Dalisay · max 20 · expires Jun 30) in Admin → 🎟️ Coupons → copy the `?coupon=` link.
- [ ] **Smoke the discounted checkout** — open the link once, confirm the "₱2,990 → ₱1,490" banner and that PayMongo charges ₱1,490.
- [ ] **Lock 1–3 free "hero" events** (Week 1 #1 task — the proof pipeline). Sourcing kit: [week1-hero-event-kit.md](week1-hero-event-kit.md); outreach + lead tracker: [week1-outreach-pack.md](week1-outreach-pack.md).

---

## Progress

**Code-side launch blockers: cleared. Remaining = owner/infra actions + manual device QA + go-to-market.**

| Section | Status |
|---|---|
| 0. Go-live (Founding 20) | ⛔ **the real gate** — 4 owner steps open (deploy → create code → smoke → lock hero events) |
| 1. Backend Performance | ✅ validated; re-confirmed 30 May (perf-db entry 51) |
| 2. Operational Readiness | mostly cleared in-repo; remaining items are owner/infra → tracked in [security-checklist.md](security-checklist.md) |
| 3. User Flow Validation | 0 / 37 — **still owed**: manual test on real devices |
| 4. Day-of-Launch | 0 / 9 — run on the morning you announce |
| 5. Communication Readiness | partially done (privacy/ToS live); rest is marketing surface |
| 6. Rollback / Incident Plan | 📖 reference (mirrors [HANDOVER.md](HANDOVER.md) "When something breaks") |
| 7. Post-Launch (Days 1–7) | 0 / 5 — week-one follow-through |

_Markdown can't auto-count; tick by hand. The §3 device flows are the only launch-gating checkboxes still fully open and owned by this file._

---

## 1. Backend Performance — ✅ Validated 17 May

All items below were proven by stress tests run from PowerShell (production-truth, through Cloudflare).

| Check | Result | Evidence |
|---|---|---|
| Upload 1000c kickoff handles burst | ✅ 0 failures, p95 5.3 s | `scripts/stress-upload.mjs cxzv-fe0y 1000 1000` |
| Mixed peak load (600 uploads + 1500 reactions + walls) | ✅ 0 failures, p95 within baseline | `scripts/stress-mixed.mjs cxzv-fe0y 600 1500 30` |
| Sustained 3 min — no memory leak, flat latency | ✅ 0 failures, flat throughout | `scripts/stress-sustained.mjs cxzv-fe0y 3` |
| Multi-wall + 150 reaction spammers | ✅ 0 failures, walls protected | `scripts/stress-multiwall.mjs cxzv-fe0y 3 150 30` |
| Cross-event isolation (storm on A, polling B) | ✅ 0 failures, Wall B p95 168 ms | `scripts/stress-cross-event.mjs cxzv-fe0y scarlette-skye-td9n 200 30` (perf-test-database.md entry 30) |
| Single-user E2E upload (real guest experience) | ✅ p50 1.7 s, p95 2.3 s | `scripts/stress-upload-e2e.mjs cxzv-fe0y 1 10` |

**Total validation (17 May):** ~13,000 requests across the full suite with 0 failures.

### Re-validated 19 May 2026 — post SDE-Lambda rework

Three additional `perf:full` runs after today's Ken Burns + warm-film LUT rework (`3da4a12`, `9029df2`) and the dashboard/auth security fixes (`1e9c7fd`, `f29633f`). Logged as entries 37–39 in [perf-test-database.md](perf-test-database.md):

| Run | Conditions | Result |
|---|---|---|
| 37 | remote (PH laptop), SDE render in flight on AWS | 0 backend failures (~11 k req); sustained flat 6/6 at up/rx p95 ~80 ms; cross-event Wall B 193 ms |
| 38 | remote, **reel streaming on the test laptop** while the suite ran | 0 backend failures; back-half latency 3–7× up — proven to be the documented single-laptop bandwidth artifact (isolation still held) |
| 39 | **CI** (GitHub runner), reel playing | 0 backend failures (~11 k req) at ~2× the throughput of the laptop runs; cross-event Wall B 500 ms < 1 s gate even under a 5623-write storm |

**Conclusion:** the SDE Lambda work and reel playback never touch the request path; backend stays cleared for launch even with the heavier renderer live.

**Re-confirmed 30 May 2026** — a further `perf:full` launch-readiness run logged as **entry 51** in [perf-test-database.md](perf-test-database.md) (latest), plus the new capacity suite (guest-arrival storm, multi-event concurrency, video-transcode saturation). Backend remains cleared.

**No backend work required before launch.**

---

## 2. Operational Readiness — reconciled 30 May

Most of the 19-May "blockers" were code-side and have since shipped. The rest are owner/infra actions that live in [security-checklist.md](security-checklist.md) and [HANDOVER.md](HANDOVER.md) — **do not re-track them here.** This section now lists only (a) what's verified done, and (b) the deploy-time steps unique to a launch push.

### ✅ Cleared in-repo (verified 30 May)

| Item | Evidence |
|---|---|
| Music schema (`music_playlists`, `music_tracks`, `events.music_playlist_id`) | in `database/schema.sql` (11 refs) + boot ALTERs — applies idempotently on deploy |
| Music library seeded | `music-library/{ceremony,cocktail,dinner,party}/manifest.json` present |
| Dashboard auth guard | merged `1e9c7fd` |
| `GET /api/events/:slug` `user_id` leak fix | merged `f29633f` |
| Privacy / DPA notice | `/privacy` route added 25 May (`6c6e72d`) — covers Comms §5 privacy row |
| Nightly Postgres backup + offsite | automated 3am PHT → R2 (90d). See [HANDOVER.md](HANDOVER.md) §"Automated ops" / §"Backup & restore" |

### ⏳ Deploy-time steps for the launch push (owner)

- [ ] **Redeploy + restart the Node container** (`git push` → Easypanel auto-deploy) so prod picks up everything above plus the coupon migration. Verify after: incognito `/dashboard?slug=<any>` → redirects to `/login?next=…`; `curl -s https://reelday.ph/api/events/cxzv-fe0y | jq '.event | has("user_id")'` → `false`.

- [ ] **Redeploy the SDE Lambda zip (`reelday-sde-renderer`)** — `git push` does **not** update Lambda. Rebuild `lambda/sde-deploy.zip` → upload via AWS Console → trigger a Regenerate → watch CloudWatch for `[sde] normalized N bricks`. Beta-only (allowlist `demo@reelday.ph`, `besogol.bb@gmail.com`); SDE is "coming soon" publicly. Env vars + fallback knobs: [SDE-HANDOVER.md](SDE-HANDOVER.md).

- [ ] **Confirm the SDE beta-email allowlist** — `frontend/dashboard.html` → `SDE_BETA_EMAILS` (~L5762). Add any other launch-day beta hosts (lowercase — the gate uses `.toLowerCase()`) **before** the deploy above.

- [ ] **Confirm host-warning copy** is wired into the booking confirmation email + post-booking dashboard message: "For events over 500 guests, your wall may take 5–10 minutes to fully display all guest videos during peak upload moments. Nothing is lost — the wall catches up automatically."

### → Owned elsewhere (don't duplicate — go tick them there)

- Restore-from-backup drill, R2 object versioning, SQS DLQ, IAM key scoping/rotation, UptimeRobot uptime monitor, Easypanel restart/CPU alerts, registrar/DNS 2FA → **[security-checklist.md](security-checklist.md) §2 + §4**.

---

## 3. User Flow Validation — Manual Test on Real Devices — 0/37 (0%)

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

**Event Website flow (Dalisay or Hiraya event) — *new wizard 19 May*:**
- [ ] Walk the wizard end-to-end → on the final step tap **"Save & publish"** (single button — the old separate Publish checkbox is gone)
- [ ] Dashboard pill flips to **"Published"** + inline note shows **"✓ Saved & live"**
- [ ] Open `/e/<slug>` in incognito → page renders with whatever was entered (empty sections are simply skipped; no "page unavailable")
- [ ] Submit an RSVP from the public site → appears in dashboard RSVP list + host receives the Resend email
- [ ] Type a partial guest name into the seat lookup → prefix match returns the seat row

**Landing + dashboard tier copy — *changed 19 May*:**
- [ ] `https://reelday.ph` pricing cards show **"3-day / 7-day / 30-day upload window"** wording (not the old "N days before & after")
- [ ] Dalisay + Hiraya cards on both the landing page **and** the dashboard upgrade modal list **"+ Same Day Edit recap reel _(coming soon)_"**

**Security — dashboard auth guard + API leak fix — *added 19 May*:**
- [ ] Fresh incognito tab → paste `https://reelday.ph/dashboard?slug=cxzv-fe0y` → browser redirects to `/login?next=…` **before** any dashboard chrome paints
- [ ] After login, host lands on the dashboard URL they originally requested (the `?next=` round-trip)
- [ ] `curl -s https://reelday.ph/api/events/cxzv-fe0y | jq '.event | has("user_id")'` returns `false`

**SDE beta gate — *added 19 May, only the allowlisted accounts*:**
- [ ] Log in as `demo@reelday.ph` (or `besogol.bb@gmail.com`) on a Dalisay/Hiraya event → the **Same Day Edit** panel is visible; Curate / Generate / Watch / Play-on-wall all work
- [ ] Log in as any other Dalisay/Hiraya host → the SDE panel is **not present at all** (HTML stays `display:none`, the isolated module never inits)

---

## 4. Day-of-Launch (Tuesday) — Final Checks — 0/9 (0%)

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

## 5. Communication Readiness — 0/7 (0%)

Before announcing publicly, make sure the basics are in place.

- [ ] Landing page (`reelday.ph`) has clear CTA to book or try demo
- [ ] Pricing is visible (or "contact us" path is clear)
- [ ] Contact / support method visible (email or Messenger link)
- [ ] FAQ covers the top 5 questions: how does it work, what's the cost, video time limit, what if my guests aren't tech-savvy, what about privacy
- [ ] Social proof: at least 1 testimonial or sample event visible on the landing page
- [x] Privacy policy and terms of service exist and are linked in the footer — `/privacy` route live since 25 May (`6c6e72d`)
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
| SDE render times out or fails for a beta tester | Set Lambda env `SDE_KEN_BURNS=false` (skips the heavy two-stage zoompan and falls back to flat blur-fill) and/or `SDE_X264_PRESET=ultrafast` — see [SDE-HANDOVER.md](SDE-HANDOVER.md) §"3 GB Lambda — current operating state". Reel still renders without Ken Burns + grade. | Beta tester only — SDE isn't publicly launched |
| Container in restart loop | Check Easypanel logs for stack trace. Roll back to the previous deploy if a recent change is the cause. | Yourself |

**Rollback path:** Easypanel keeps deploy history. To roll back, go to the Reelday app → Deployments → click the previous successful deploy → Redeploy.

**Backup contact:** Set one trusted person who can reach you (or check the site) if you're unreachable during an event.

---

## 7. Post-Launch (Days 1–7) — 0/5 (0%)

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

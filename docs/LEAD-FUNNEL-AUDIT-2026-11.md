# Lead Funnel Audit — "Create a Free Event Website"

**Date:** 2026-11-10 · **Companion to:** `docs/CONVERSION-AUDIT-2026-11.md` (the master plan; this doc covers its Door B in depth).
**Method:** code read of `free-wedding-website.html`, `website-builder.html`, `event-site-render.js`, `events.js`, plus a **live headless walkthrough of production at iPhone size (390×844)**: landing → builder, all 7 steps → save modal. Signup was *not* submitted, so no test account was created in production.

---

## 1. The core finding

**Two fields are enough to make the website look great.** With only *names + date*, the live preview already shows a polished invitation: big serif names, the date, "You're invited", and a running countdown. That's the moment the visitor thinks *"I want this."*

**But today the visitor reaches the save step only after 7 steps and about 25 inputs**, so the wow happens long before we capture them, and many leave in between. The preview is hidden behind a floating button. The draft lives only in that browser, and photos are lost on reload.

> **Redesign principle: wow in 30 seconds → save in 1 tap → publish → *then* make it richer.**
> Today's order is: fill everything → save → (maybe) publish.

---

## 2. What the visitor actually experiences (live, mobile)

| Step | What they see | Inputs | Friction observed |
|---|---|---|---|
| Landing `/free-wedding-website` | Clear headline, "Build my free website →", loads in **0.4s** ✅ | — | Copy says **"Takes about 10 minutes"**, which makes it sound like work |
| 1 Welcome | Template picker (4) + names + date + type + **"Hero kicker"** + cover photo | 9 | Jargon ("Hero kicker"). A big **"Save your event website" button at the top before anything is filled**. Continue works with empty fields |
| 2 Story | Heading + story textarea | 2 | Fine, but writing a love story is the hardest task and comes 2nd |
| 3 Schedule & Venue | Two textareas: `TIME \| LABEL`, `NAME \| ADDRESS` | 2 | **Pipe syntax** on a phone keyboard. The grey placeholders look like real content, so people think it's filled. The floating Preview button covers the textarea |
| 4 Details | Dress code, parking, `QUESTION \|\| ANSWER`, `Title \|\| Body` | 4 | More pipe syntax, "Good to know" is vague |
| 5 Guests | Seat finder ✔, RSVP ✔, deadline | 3 | Shows an internal note: *"Seat-list import and RSVP CSV remain available from the dashboard while this builder moves to its own page."* **Seat finder is ON by default with no seat list**, so guests search and get "not found" |
| 6 Gallery | Add photos | 1 | Photos held in memory only, **lost if the tab reloads** |
| 7 Gifts | Toggle, message, `LABEL \| URL`, `LABEL \| ACCOUNT \| NAME` | 4 | Pipe syntax again. Gift section ON by default |
| Save modal | Full name, email, password | 3 | **No Google sign-in.** "Continue editing" sits above the primary button |
| After save | Redirect to dashboard, site **unpublished** | — | No "it's live" moment, no share step (see master plan) |

**Totals:** 7 steps, ~25 inputs, 4 pipe-syntax fields, about 8–15 minutes before an email is captured.

---

## 3. Barriers, ranked

### Blockers (bugs that lose real leads)
| # | Barrier | Evidence | Fix |
|---|---|---|---|
| B1 | **Already-registered email = lost draft.** The modal says "log in to finish", but after login a logged-in visitor with no event is redirected from the builder to `/my-events`, and the localStorage draft is never picked up again | `website-builder.html:1511` + `:645-652` (`token && !slug` → `/my-events`) | Logged-in + draft present → create the event from the draft (same code as the anonymous save). Show "Log in to save" with `/login?next=/website-builder` |
| B2 | **Logged-in visitors can't start a website from any marketing CTA.** Every "Start free" / "Build my free website" bounces to `/my-events` | same redirect | Logged-in + no slug → if they have one event without a published site, open the builder for it; otherwise offer "New website" (creates the event) |
| B3 | **Users who already used Tala** (`tala_used`) hit a generic "Could not create your event" at save | `events.js:308` | Catch `plan_limit_events`: "Your free event is used — add this website to *{existing event}*" or upgrade. Never a dead end |
| B4 | **Seat finder ON with no seats** → guests search and get no result, and the host looks unprepared | `event-site-render.js:715`, seat import only in dashboard | Default `seatEnabled = false` until a seat list is imported, then auto-enable |
| B5 | **Photos lost on reload** before signup | builder keeps `coverFile`/`galleryFiles` in memory | Move signup *before* photo steps (see §4). The problem disappears because uploads go straight to R2 |

### Friction (makes it slow or confusing)
| # | Barrier | Fix |
|---|---|---|
| F1 | 7 steps / 25 inputs before save | **2-field start** → instant full preview → save (§4) |
| F2 | Pipe-syntax textareas (4) | Repeatable rows: `[time] [label] [+ Add]`, `[venue] [address/Maps link]`, `[question] [answer]`, `[GCash/Maya ▾] [number] [name]` |
| F3 | Placeholders look like real content | Use real **starter content you can keep or edit**, clearly marked: "We added a typical Filipino wedding schedule — edit or remove" (Ceremony / Cocktails / Reception / Program). Guests then see a full site even if the host does nothing |
| F4 | Preview hidden behind a floating button that covers inputs | After the 2-field start, show the preview **full-screen first**. After that, a sticky bottom bar "👁 Preview · Save" that doesn't overlap fields |
| F5 | Jargon and internal notes ("Hero kicker", "Good to know \|\| blocks", "--", the "moves to its own page" note) | Plain words: "Small line above your names (e.g. *You're invited*)". Delete the internal note |
| F6 | No Google sign-in at save; 3 fields + password | **Google 1-tap first**, then email + password. Ask for the host's name later (or default from the couple names) |
| F7 | "Takes about 10 minutes" | "**See your website in 30 seconds.** Free forever." |
| F8 | Love story is step 2 (hardest content) | Move it into the optional "Make it yours" list, with 3 tap-to-use starter paragraphs in English/Taglish |
| F9 | Premature "Save your event website" button at top of step 1 | Hide it until the first preview has been seen |

### Growth-loop leaks
| # | Barrier | Fix |
|---|---|---|
| G1 | Guest-site credit link → `/` (the wall homepage, **6.8s** load in the same headless test) with no attribution | `/free-wedding-website?utm_source=event_site&utm_medium=footer&ref={slug}`. Track `ref` as a sign-up source |
| G2 | No builder funnel analytics (only `free_website_created`, `website_published`, `upgrade_click`) | Add `builder_start` (first keystroke), `preview_open`, `save_open`, `sign_up{method}`, `share_click{channel}` |
| G3 | The website never shows the paid product | After publish (and in the editor's step list), add a locked **"Live photo wall"** card showing *their* names on a wall mock-up, with "Try it free (Test Session)" |

---

## 4. The redesigned flow: "Website in 60 seconds"

```
LANDING  "See your free wedding website in 30 seconds"  [Start →]
   │
1. QUICK START (one screen)
   Names  [Ana & Miguel]   Date [May 15, 2027]   Type chips [Wedding ▸ Birthday ▸ Binyag ▸ …]
   [Show me my website →]
   │
2. WOW: full-screen phone preview of THEIR site
   template swatches under it (tap to switch, instant)
   ┌───────────────────────────────────────────┐
   │ Save it, free:  [G Continue with Google]   │
   │                 [Use email instead]        │   ← email + password only
   └───────────────────────────────────────────┘
   │
3. "YOUR WEBSITE IS SAVED" → [Publish & share]  (one deliberate tap)
   share sheet: Messenger · Viber · Copy link · QR for invitation card
   │
4. MAKE IT YOURS (optional, any order, progress ring "Your site is 40% complete")
   ☐ Cover photo          ☐ Schedule (starter rows prefilled)   ☐ Venue + Maps
   ☐ Your story (3 starters) ☐ Dress code            ☐ Entourage
   ☐ Gifts / GCash         ☐ FAQ (starter Qs)        ☐ Seat finder (import list)
   ★ Live photo wall — "Try it free" (Test Session) → upgrade
```

**Why this converts better**
- **Value before effort:** the visitor sees their own beautiful site after about 2 inputs, which is when they're most willing to save it (endowed-progress effect).
- **One-tap save** (Google), so the email is captured before they get tired.
- **Shareable immediately:** names, date, countdown and RSVP are already a useful site, and every share sends 100+ guests past the "make yours free" footer.
- **Progress ring + checklist** brings them back over the following weeks (each item is a reason for a nudge email: "Add your venue so guests don't get lost").
- **The wall card in the checklist** turns the website into the start of the paid upsell: once they've seen their names on a wall, the Test Session takes them to the aha (master plan §4.2) and then to the in-event upgrade.

**Rules this keeps:** publishing stays a deliberate tap (nothing goes live without review), all upgrades go through the in-event checkout (master plan §2), and the one-free-event guard stays.

---

## 5. From free website to paid: the bridge

| Moment | What the host sees | CTA |
|---|---|---|
| Just published | Share sheet + small card: "On the day, guests can send photos to a live wall — see it with your names" | Try the wall (Test Session) |
| Checklist | Locked "★ Live photo wall" item with mini mock-up | Try it free |
| Every 10 RSVPs (email + dashboard toast) | "25 guests are coming 🎉 — let them send photos & video greetings too" | In-event upgrade |
| t-30 / t-7 | Existing money emails (fixed CTA) + 72h coupon | In-event upgrade |
| Guest RSVP confirmation (guest side) | "See you on May 15! 💛" plus the guest's share button | Spreads the site, more footer impressions |

Upgrade copy in context (in-event modal, Dalisay pre-selected for weddings):
> **Your 38 guests already RSVP'd. Let them be part of the show.**
> Photos and video greetings from every phone, live on the reception screen, plus a recap reel after. ₱2,990 for the whole event, about ₱20 per guest. *Gumana o refund.*

---

## 6. Build order (fits into the master plan's sprints)

| # | Task | Hrs | Sprint |
|---|---|---|---|
| L1 | Fix **B1–B3** (draft recovery on login, logged-in entry, `tala_used` path) | 3 | **0** (bugs that lose leads) |
| L2 | **B4** seat finder default off until import; delete internal note; plain-word labels (F5); landing copy (F7); footer link + UTM (G1) | 1.5 | **0** |
| L3 | Builder analytics events (G2) | 1 | **0** |
| L4 | Quick Start screen + full-screen preview + Google 1-tap save (F1, F4, F6, F9) | 5 | 1 |
| L5 | "Saved → Publish & share" screen (from the master plan) | 2 | 1 |
| L6 | "Make it yours" checklist with progress ring; repeatable-row inputs replacing pipe syntax; starter content (F2, F3, F8) | 6 | 1–2 |
| L7 | Locked "Live photo wall" card → Test Session (G3) | 1.5 | 2 (after Test Session ships) |
| L8 | Checklist nudge emails ("add your venue", "add a cover photo") | 2 | 2 |

**Measure (GA4 + DB) and targets**

| Step | Metric | Target |
|---|---|---|
| Landing → builder start | % of landing visitors | ≥ 40% |
| Builder start → preview seen | % of starts | ≥ 80% |
| Preview → saved (sign-up) | % of previews | ≥ 35% (likely < 10% today; verify with G2 events) |
| Saved → published | % of saves | ≥ 60% |
| Published → ≥ 10 RSVPs | % of published sites | ≥ 40% |
| Published → paid | by event date | ≥ 5% |

If **preview → saved** is low after L4, test **email-only save** (password set later via an emailed link). That's the next friction to remove, and it needs a small backend change (magic-link or set-password email).

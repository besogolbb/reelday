/**
 * Plan configuration — backend copy.
 * Keep in sync with frontend/js/plans.js
 *
 * Backend uses this to enforce hard limits in route handlers and to
 * compute event expiry timestamps at creation time. Never trust client
 * claims about which plan a user is on — always read users.subscription_tier
 * from the database.
 */

// Final pricing tiers (2026) — "1 event per purchase" model, except Hiraya:
//   TALA       Free          — 1 event — testing / small gatherings    — 25 photos, 24h
//   SINAG      ₱1,490 / evt  — 1 event — birthdays, debuts, parties    — unlimited photo+video, 30d
//   DALISAY    ₱2,990 / evt  — 1 event — weddings & milestones         — + audio notes, website, 90d
//   HIRAYA     ₱9,990 / yr   — yearly subscription for coordinators, photographers,
//                              and venues running multiple events / month.
//                              The ONLY tier that isn't per-event. Cap of 10 events / year.
//
// Feature-flag glossary (only flags with real enforcement live here —
// see the audit notes by each tier for matrix rows that are marketing
// or operational, not code-gated):
//   videoUpload  — guests may upload videos at all (Tala = photos only)
//   videoMessage — the guided 3-step video-greeting flow
//   audioNotes   — voice note paired with a photo (Dalisay+ "Audio Notes")
//   reactions    — live emoji reactions on the wall
//   polls        — live polls & games
//   customMusic  — host-uploaded wall background music
//   website      — full event website + seat/table finder
//   customDomain — bring-your-own domain for the event website
export const PLANS = {
  tala: {
    id: 'tala',
    name: 'Tala',
    price: 0,
    eventLimit: 1,
    uploadLimit: 25,           // 25 photos only
    galleryDays: 1,            // 24-hour retention
    uploadWindowDays: 1,
    features: {
      videoUpload:  false,     // photos only
      videoMessage: false,
      audioNotes:   false,
      reactions:    false,
      polls:        false,
      customMusic:  false,
      website:      false,
      customDomain: false,
    },
  },

  sinag: {
    id: 'sinag',
    name: 'Sinag',
    price: 1490,
    eventLimit: 1,
    uploadLimit: null,         // unlimited photos & videos
    galleryDays: 30,
    uploadWindowDays: 1,
    features: {
      videoUpload:  true,
      videoMessage: true,
      // Audio notes are a Dalisay+ differentiator.
      audioNotes:   false,
      reactions:    true,
      // Live Questions & Poll is a Dalisay/Hiraya feature — kept off Sinag
      // so the trivia/quiz experience stays on the higher tiers.
      polls:        false,
      customMusic:  true,
      website:      false,
      customDomain: false,
    },
  },

  dalisay: {
    id: 'dalisay',
    name: 'Dalisay',
    price: 2990,
    // One-time payment per event. Pre-2026 this was a 3-event package; the
    // count was lowered to 1 with the Hiraya-yearly repositioning. Existing
    // users with events_remaining > 1 keep their unused credits — only new
    // Dalisay purchases land on the 1-event model (payments.js sets
    // events_remaining = plan.eventLimit, so this naturally enforces).
    eventLimit: 1,
    uploadLimit: null,
    galleryDays: 90,
    uploadWindowDays: 7,
    features: {
      videoUpload:  true,
      videoMessage: true,
      audioNotes:   true,      // "Unlimited + Audio Notes"
      reactions:    true,
      polls:        true,
      customMusic:  true,
      website:      true,
      customDomain: false,
    },
  },

  hiraya: {
    id: 'hiraya',
    name: 'Hiraya',
    price: 9990,             // ₱9,990 / year (the only yearly tier)
    billing: 'yearly',       // marker for /payments — applied as +1yr expires_at
    eventLimit: 10,
    uploadLimit: null,
    galleryDays: 365,
    uploadWindowDays: 180,
    features: {
      videoUpload:  true,
      videoMessage: true,
      audioNotes:   true,
      reactions:    true,
      polls:        true,
      customMusic:  true,
      website:      true,
      customDomain: true,
    },
  },
};

// ── Matrix rows NOT enforced in code (intentionally) ──────────────
// These differentiate tiers in marketing but have no code gate yet —
// documented here so nobody assumes they're enforced:
//   • Wall style (Tala "Static Slideshow" vs Sinag+ "Cinematic /
//     Ken Burns"): the wall renderer has no per-plan branch.
//   • White-label / "Your Logo" (Hiraya): no branding-toggle gate.
//   • Data Export / Leads (Hiraya): RSVP CSV export is owner-only,
//     not Hiraya-gated.
//   • Custom domain: `customDomain` flag exists but no route reads it.
//   • "Priority Processing" (Hiraya): operational, not a code path.

export const LEGACY_PLAN_MAP = {
  libre:       'tala',
  selebrasyon: 'sinag',
  pro:         'hiraya',
};

export function resolvePlan(planId) {
  if (planId && PLANS[planId])           return PLANS[planId];
  if (planId && LEGACY_PLAN_MAP[planId]) return PLANS[LEGACY_PLAN_MAP[planId]];
  return PLANS.tala;
}

export function planHasFeature(planId, feature) {
  return resolvePlan(planId).features?.[feature] === true;
}

export function planAllowsMoreEvents(planId, currentEventCount) {
  return currentEventCount < resolvePlan(planId).eventLimit;
}

/**
 * Compute when an event's gallery should soft-lock based on plan.
 * Returns an ISO timestamp.
 */
export function galleryExpiryFor(planId, eventDate = new Date()) {
  const plan  = resolvePlan(planId);
  const start = eventDate instanceof Date ? eventDate : new Date(eventDate);
  const end   = new Date(start);
  end.setUTCDate(end.getUTCDate() + plan.galleryDays);
  return end.toISOString();
}

/**
 * Split the upload window symmetrically around the event date.
 * The pattern is: <before> days + the event day itself + <after> days,
 * with the event day counted as the middle "1" so the totals add up
 * to the plan's uploadWindowDays.
 *
 *   Tala / Sinag (N=1):  0 + 1 + 0  = event day only
 *   Dalisay      (N=7):  3 + 1 + 3  = 3 before + day-of + 3 after
 *   Hiraya       (N=180): 89 + 1 + 90 = ~half-year on each side
 *
 * Slight asymmetry on even-total tiers (N=180 → 89/90) lands the
 * extra day in the future, which matches user expectation that
 * "after the event" gets the benefit of the doubt.
 */
export function uploadWindowSplit(planId) {
  const days = resolvePlan(planId).uploadWindowDays;
  return {
    before: Math.floor((days - 1) / 2),
    after:  Math.ceil((days - 1) / 2),
  };
}

/**
 * Compute when uploads start being accepted for an event.
 * Centered window — see uploadWindowSplit() above.
 * Returns an ISO timestamp.
 */
export function uploadWindowStartFor(planId, eventDate = new Date()) {
  const { before } = uploadWindowSplit(planId);
  const d = eventDate instanceof Date ? new Date(eventDate) : new Date(eventDate);
  d.setUTCDate(d.getUTCDate() - before);
  return d.toISOString();
}

/**
 * Compute when uploads should stop being accepted for an event.
 * Returns the moment *after* the last allowed day (so the timestamp
 * is the exclusive upper bound — convenient for `if (now < ends_at)`).
 *
 * For Dalisay (after=3): event_date + 3 days + 1 = midnight starting
 * event+4, which means the last full day of uploads is event+3.
 */
export function uploadWindowEndFor(planId, eventDate = new Date()) {
  const { after } = uploadWindowSplit(planId);
  const d = eventDate instanceof Date ? new Date(eventDate) : new Date(eventDate);
  d.setUTCDate(d.getUTCDate() + after + 1);
  return d.toISOString();
}

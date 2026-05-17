/**
 * Plan configuration — frontend copy.
 * Keep in sync with backend/lib/plans.js
 *
 * One row per tier. Display strings here, hard limits in eventLimit/
 * uploadLimit/galleryDays/uploadWindowDays, and capability flags in features.
 *
 * Subscription model (final 2026 pricing):
 *   - Tala    = free, 1 event, 25 photos, 24h retention, photos only
 *   - Sinag   = ₱1,490 / event, unlimited photo+video, 30d
 *   - Dalisay = ₱2,990 package (3 events), + audio notes + website, 90d
 *   - Hiraya  = Pro, up to 10 events, custom domain, 1-year retention
 *
 * Keep features in 1:1 sync with backend/lib/plans.js — the backend
 * copy is the enforcement source of truth; this is for display +
 * client-side UX gating only.
 */

export const PLANS = {
  tala: {
    id: 'tala',
    name: 'Tala',
    tagline: 'Free starter',
    price: 0,
    priceLabel: 'Free',
    eventLimit: 1,
    uploadLimit: 25,
    galleryDays: 1,            // 24-hour retention
    uploadWindowDays: 1,        // event-day uploads only
    features: {
      videoUpload:  false,     // photos only
      videoMessage: false,
      audioNotes:   false,
      reactions:    false,
      polls:        false,
      website:      false,
      customDomain: false,
    },
  },

  sinag: {
    id: 'sinag',
    name: 'Sinag',
    tagline: 'Birthdays, debuts, parties',
    price: 1490,
    priceLabel: '₱1,490 / event',
    eventLimit: 1,
    uploadLimit: null,          // unlimited photos & videos
    galleryDays: 30,
    uploadWindowDays: 1,
    features: {
      videoUpload:  true,
      videoMessage: true,
      audioNotes:   false,
      reactions:    true,
      // Live Questions & Poll is a Dalisay/Hiraya feature.
      polls:        false,
      website:      false,
      customDomain: false,
    },
  },

  dalisay: {
    id: 'dalisay',
    name: 'Dalisay',
    tagline: 'Weddings & milestones',
    price: 2990,
    priceLabel: '₱2,990 / package',
    eventLimit: 3,
    uploadLimit: null,
    galleryDays: 90,
    uploadWindowDays: 7,
    features: {
      videoUpload:  true,
      videoMessage: true,
      audioNotes:   true,
      reactions:    true,
      polls:        true,
      website:      true,
      customDomain: false,
    },
    featured: true,
  },

  hiraya: {
    id: 'hiraya',
    name: 'Hiraya',
    tagline: 'For organizers & venues',
    price: 4990,
    priceLabel: 'Pro',
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
      website:      true,
      customDomain: true,
    },
  },
};

/* Legacy plan names from earlier schema -> new tier id */
export const LEGACY_PLAN_MAP = {
  libre:        'tala',
  selebrasyon:  'sinag',
  pro:          'hiraya',
};

export const PLAN_ORDER = ['tala', 'sinag', 'dalisay', 'hiraya'];

/* ── Helpers ─────────────────────────────────────────────── */

export function resolvePlan(planId) {
  if (planId && PLANS[planId])             return PLANS[planId];
  if (planId && LEGACY_PLAN_MAP[planId])   return PLANS[LEGACY_PLAN_MAP[planId]];
  return PLANS.tala;
}

export function planHasFeature(planId, feature) {
  return resolvePlan(planId).features?.[feature] === true;
}

export function planAllowsMoreEvents(planId, currentEventCount) {
  return currentEventCount < resolvePlan(planId).eventLimit;
}

export function nextTier(planId) {
  const idx = PLAN_ORDER.indexOf(resolvePlan(planId).id);
  return idx >= 0 && idx < PLAN_ORDER.length - 1 ? PLANS[PLAN_ORDER[idx + 1]] : null;
}

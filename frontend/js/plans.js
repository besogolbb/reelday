/**
 * Plan configuration — frontend copy.
 * Keep in sync with backend/lib/plans.js
 *
 * One row per tier. Display strings here, hard limits in eventLimit/
 * uploadLimit/galleryDays/uploadWindowDays, and capability flags in features.
 *
 * Subscription model:
 *   - Tala  = free, 1 event, no expiry
 *   - Sinag = ₱999 per event (single-event purchase)
 *   - Dalisay = ₱2,499 package, up to 3 events on the account
 *   - Hiraya  = ₱4,990 / year, up to 10 events on the account
 */

export const PLANS = {
  tala: {
    id: 'tala',
    name: 'Tala',
    tagline: 'Free starter',
    price: 0,
    priceLabel: 'Free',
    eventLimit: 1,
    uploadLimit: 50,
    galleryDays: 7,
    uploadWindowDays: 1,        // event-day uploads only
    features: {
      videoMessage: false,
      reactions:    false,
      website:      false,
      customDomain: false,
    },
  },

  sinag: {
    id: 'sinag',
    name: 'Sinag',
    tagline: 'Single celebration',
    price: 999,
    priceLabel: '₱999 / event',
    eventLimit: 1,
    uploadLimit: null,          // unlimited
    galleryDays: 30,
    uploadWindowDays: 1,
    features: {
      videoMessage: true,
      reactions:    false,
      website:      false,
      customDomain: false,
    },
  },

  dalisay: {
    id: 'dalisay',
    name: 'Dalisay',
    tagline: 'Package of 3 events',
    price: 2499,
    priceLabel: '₱2,499 / package',
    eventLimit: 3,
    uploadLimit: null,
    galleryDays: 90,
    uploadWindowDays: 7,
    features: {
      videoMessage: true,
      reactions:    true,
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
    priceLabel: '₱4,990 / year',
    eventLimit: 10,
    uploadLimit: null,
    galleryDays: 365,
    uploadWindowDays: 180,
    features: {
      videoMessage: true,
      reactions:    true,
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

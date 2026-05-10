/**
 * Plan configuration — backend copy.
 * Keep in sync with frontend/js/plans.js
 *
 * Backend uses this to enforce hard limits in route handlers and to
 * compute event expiry timestamps at creation time. Never trust client
 * claims about which plan a user is on — always read users.subscription_tier
 * from the database.
 */

export const PLANS = {
  tala: {
    id: 'tala',
    name: 'Tala',
    price: 0,
    eventLimit: 1,
    uploadLimit: 50,
    galleryDays: 7,
    uploadWindowDays: 1,
    features: {
      videoMessage: false,
      reactions:    false,
      polls:        false,
      website:      false,
      customDomain: false,
    },
  },

  sinag: {
    id: 'sinag',
    name: 'Sinag',
    price: 999,
    eventLimit: 1,
    uploadLimit: null,
    galleryDays: 30,
    uploadWindowDays: 1,
    features: {
      videoMessage: true,
      reactions:    true,
      // Live Questions & Poll is a Dalisay/Hiraya feature — kept off Sinag
      // so the trivia/quiz experience stays on the higher tiers.
      polls:        false,
      website:      false,
      customDomain: false,
    },
  },

  dalisay: {
    id: 'dalisay',
    name: 'Dalisay',
    price: 2499,
    eventLimit: 3,
    uploadLimit: null,
    galleryDays: 90,
    uploadWindowDays: 7,
    features: {
      videoMessage: true,
      reactions:    true,
      polls:        true,
      website:      true,
      customDomain: false,
    },
  },

  hiraya: {
    id: 'hiraya',
    name: 'Hiraya',
    price: 4990,
    eventLimit: 10,
    uploadLimit: null,
    galleryDays: 365,
    uploadWindowDays: 180,
    features: {
      videoMessage: true,
      reactions:    true,
      polls:        true,
      website:      true,
      customDomain: true,
    },
  },
};

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
 * Compute when uploads should stop being accepted for an event.
 */
export function uploadWindowEndFor(planId, eventDate = new Date()) {
  const plan  = resolvePlan(planId);
  const start = eventDate instanceof Date ? eventDate : new Date(eventDate);
  const end   = new Date(start);
  end.setUTCDate(end.getUTCDate() + plan.uploadWindowDays);
  return end.toISOString();
}

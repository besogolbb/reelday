/**
 * Coupon / promo-code logic — pure helpers, no DB access.
 *
 * The route layer (backend/routes/payments.js, admin.js) owns the SQL;
 * this module only normalizes codes, validates a fetched coupon row
 * against a tier/clock, and computes the discounted amount.
 *
 * Money is always in centavos (PayMongo's unit) to match PAID_TIERS.
 * The discounted amount is recomputed here on every checkout — the
 * browser never sends a price, so a tampered request can't set its own.
 */

// PayMongo rejects charges below ₱100. Never let a coupon drive the
// final price under this floor (a 100%-off code would otherwise create
// a ₱0 checkout PayMongo refuses).
export const MIN_CHARGE_CENTAVOS = 10000; // ₱100

export const DISCOUNT_TYPES = ['percent', 'amount'];

/** Canonical stored/looked-up form: trimmed, upper-cased. */
export function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

/**
 * Compute the final charge (centavos) after applying a coupon to a base
 * amount. Clamped to [MIN_CHARGE_CENTAVOS, baseAmount] — a coupon can
 * only ever reduce the price, never raise it or go below the floor.
 */
export function discountedAmount(baseAmount, coupon) {
  if (!coupon) return baseAmount;
  let final = baseAmount;
  if (coupon.discount_type === 'percent') {
    final = Math.round(baseAmount * (1 - coupon.discount_value / 100));
  } else if (coupon.discount_type === 'amount') {
    final = baseAmount - coupon.discount_value; // discount_value is centavos
  }
  return Math.max(MIN_CHARGE_CENTAVOS, Math.min(baseAmount, final));
}

/** Human-readable discount, e.g. "50% off" or "₱1,500 off". */
export function discountLabel(coupon) {
  if (!coupon) return '';
  return coupon.discount_type === 'percent'
    ? `${coupon.discount_value}% off`
    : `₱${(coupon.discount_value / 100).toLocaleString('en-PH')} off`;
}

/**
 * Returns null if the coupon is usable for `tier` right now, otherwise a
 * machine code describing why not. `tier` may be omitted to validate the
 * coupon in isolation (admin preview).
 *   not_found | inactive | expired | maxed | wrong_tier
 */
export function couponProblem(coupon, tier, now = new Date()) {
  if (!coupon) return 'not_found';
  if (!coupon.active) return 'inactive';
  if (coupon.expires_at && new Date(coupon.expires_at) < now) return 'expired';
  if (coupon.max_redemptions != null && coupon.times_redeemed >= coupon.max_redemptions) {
    return 'maxed';
  }
  if (tier && coupon.applies_to_tier && coupon.applies_to_tier !== tier) {
    return 'wrong_tier';
  }
  return null;
}

/** Friendly message for each couponProblem() code. */
export function problemMessage(problem) {
  switch (problem) {
    case 'not_found':  return 'That promo code does not exist.';
    case 'inactive':   return 'This promo code is no longer active.';
    case 'expired':    return 'This promo code has expired.';
    case 'maxed':      return 'This promo code has reached its redemption limit.';
    case 'wrong_tier': return 'This promo code does not apply to the selected plan.';
    default:           return 'This promo code is not valid.';
  }
}

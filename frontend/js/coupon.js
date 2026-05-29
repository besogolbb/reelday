/**
 * Coupon capture for admin-shared discount links (?coupon=CODE).
 *
 * A discount link is just any Reelday URL with a ?coupon= param, e.g.
 *   https://reelday.ph/?coupon=FOUNDING20
 * The buyer might land there, sign up, create an event, and only THEN
 * reach checkout — several page loads later. So on first sight we stash
 * the code in sessionStorage; every /payments/create call then attaches
 * it, and the server recomputes the discounted price (never the client).
 *
 * The server treats an unknown or wrong-tier code as "no discount"
 * (charges full price) rather than erroring, so a stale stashed code can
 * never block an unrelated checkout.
 */
const KEY = 'reelday_coupon';

/** Read ?coupon= from the URL (if any) and persist it for the session. */
export function captureCouponFromUrl() {
  try {
    const code = new URLSearchParams(location.search).get('coupon');
    if (code) {
      const clean = code.trim().toUpperCase().slice(0, 40);
      if (clean) sessionStorage.setItem(KEY, clean);
    }
  } catch { /* sessionStorage blocked (private mode) — coupon just won't persist */ }
}

/** The active coupon code for this session, or null. */
export function getActiveCoupon() {
  try { return sessionStorage.getItem(KEY) || null; } catch { return null; }
}

/** Forget the stashed coupon (e.g. after a successful upgrade). */
export function clearCoupon() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Ask the server what a code is worth for a tier — for showing
 * "₱2,990 → ₱1,490" before redirecting to PayMongo. Returns the parsed
 * JSON ({valid, label, base_peso, final_peso, ...}) or null on error.
 * `authHeader` is whatever the page already uses (string token or header obj).
 */
export async function previewCoupon(code, tier, authHeaders) {
  if (!code) return null;
  try {
    const r = await fetch(
      `/api/payments/validate-coupon?code=${encodeURIComponent(code)}&tier=${encodeURIComponent(tier)}`,
      { headers: authHeaders || {} },
    );
    return await r.json();
  } catch { return null; }
}

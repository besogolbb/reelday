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
 * Ask the server what a code is worth — for showing "₱2,990 → ₱1,490"
 * before redirecting to PayMongo. Public endpoint, so no auth needed.
 * `tier` is optional: omit it to price against the coupon's own locked
 * tier. Returns parsed JSON ({valid, label, base_peso, final_peso, ...})
 * or null on error.
 */
export async function previewCoupon(code, tier) {
  if (!code) return null;
  try {
    const q = tier ? `&tier=${encodeURIComponent(tier)}` : '';
    const r = await fetch(`/api/payments/validate-coupon?code=${encodeURIComponent(code)}${q}`);
    return await r.json();
  } catch { return null; }
}

const peso = n => '₱' + Number(n).toLocaleString('en-PH');
const TIER_NAMES = { sinag: 'Sinag', dalisay: 'Dalisay', hiraya: 'Hiraya' };

/**
 * If a coupon is active in this session, drop a slim sticky banner at the
 * top of the page showing the deal ("FOUNDING20 — Dalisay ₱2,990 →
 * ₱1,490 at checkout"). Safe to call on any page; it self-validates and
 * silently does nothing for an absent/expired/maxed code. Injects its own
 * styles once. Returns nothing.
 */
export async function renderCouponBanner() {
  const code = getActiveCoupon();
  if (!code) return;
  // Body may not exist yet if called from a <head> module — defer once.
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', renderCouponBanner, { once: true });
    return;
  }
  if (document.getElementById('reelday-coupon-banner')) return; // once per page
  const info = await previewCoupon(code);
  if (!info || !info.valid) {
    // Expired/maxed/unknown — forget it so a stale link doesn't mislead.
    if (info && info.valid === false) clearCoupon();
    return;
  }

  if (!document.getElementById('reelday-coupon-style')) {
    const st = document.createElement('style');
    st.id = 'reelday-coupon-style';
    st.textContent = `
      #reelday-coupon-banner{position:sticky;top:0;z-index:9999;display:flex;
        align-items:center;justify-content:center;gap:.5rem;flex-wrap:wrap;
        padding:.55rem 2.4rem .55rem 1rem;font:600 14px/1.3 -apple-system,"Segoe UI",Inter,sans-serif;
        color:#fff;background:linear-gradient(135deg,#ef6c1f,#f59e0b);
        box-shadow:0 2px 10px rgba(0,0,0,.12);text-align:center}
      #reelday-coupon-banner .rc-code{background:rgba(255,255,255,.22);padding:1px 9px;
        border-radius:99px;letter-spacing:.04em}
      #reelday-coupon-banner .rc-old{opacity:.75;text-decoration:line-through;font-weight:500}
      #reelday-coupon-banner .rc-new{font-weight:800}
      #reelday-coupon-banner .rc-x{position:absolute;right:.6rem;top:50%;transform:translateY(-50%);
        background:none;border:none;color:#fff;font-size:18px;line-height:1;cursor:pointer;opacity:.85}
      #reelday-coupon-banner .rc-x:hover{opacity:1}`;
    document.head.appendChild(st);
  }

  let deal;
  if (info.base_peso != null && info.final_peso != null) {
    const tier = TIER_NAMES[info.price_tier] || '';
    deal = `${tier ? tier + ' ' : ''}<span class="rc-old">${peso(info.base_peso)}</span> → <span class="rc-new">${peso(info.final_peso)}</span> at checkout`;
  } else {
    deal = `${info.label} — applies at checkout`;
  }

  const bar = document.createElement('div');
  bar.id = 'reelday-coupon-banner';
  bar.innerHTML =
    `🎟️ <span class="rc-code">${code}</span> ${deal}` +
    `<button class="rc-x" title="Dismiss" aria-label="Dismiss">×</button>`;
  bar.querySelector('.rc-x').addEventListener('click', () => bar.remove());
  document.body.prepend(bar);
}

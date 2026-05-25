# Security follow-ups (deferred from 2026-05-25 audit)

This batch landed: helmet+CSP, `events` `SELECT *` denylist (+ `password_hash`/`gcal_event_id`), `DEBUG_KEY` → header, removed `frontend/temp-*` files.

**Done 2026-05-25:** `/privacy` route + DPA-accurate guest device ID disclosure (commit 6c6e72d). Privacy policy already existed as a tab in `/terms`; added a `/privacy` redirect for discoverability and corrected §2.2 to disclose the per-browser presence ID.

These two were **intentionally not** done in the same commit because they
each touch every authed fetch and need a planned migration window.

## 1. JWT in localStorage → HttpOnly cookies

**Risk:** any XSS = full account takeover. Today the host JWT is in
`localStorage` ([frontend/js/auth.js:1-13](../frontend/js/auth.js#L1-L13)), and
the admin shared secret is in `localStorage` too
([frontend/admin.html:787](../frontend/admin.html#L787)).

**Migration plan (single PR, deploy on a quiet morning):**
1. Backend `/api/auth/login` and `/register` set
   `Set-Cookie: reelday_session=<jwt>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=…`
   in addition to returning the JWT in the response body.
2. `fastify.authenticate` decorator reads cookie first, falls back to
   `Authorization: Bearer` for one release cycle (mobile in-app browsers
   sometimes drop SameSite cookies on first POST).
3. Add `/api/auth/logout` that clears the cookie server-side.
4. CORS: add `credentials: true` and tighten `origin` to exact match
   (already exact — good).
5. Add CSRF: double-submit token (cookie + header). `@fastify/csrf-protection`.
6. Frontend `js/auth.js`: stop storing the token; just call endpoints
   with `credentials: 'include'`. Keep `getUser()` but read from a
   small `/api/auth/me` call on boot (already exists or trivial to add).
7. After 1 deploy cycle with both paths working, delete the
   `Authorization`-header fallback and `localStorage.setItem(TOKEN_KEY…)`.

**Blast radius if rushed:** logged-out users on every page until the
frontend is also redeployed. Do both atomically.

## 2. Admin panel auth (shared bearer → real account)

Today `/admin` is gated by a single `ADMIN_TOKEN` env var compared via
`timingSafeEqual` ([backend/routes/admin.js:98](../backend/routes/admin.js#L98)).
That's fine as a tripwire but has no rotation story, no per-actor audit
log, no 2FA, and if the token leaks (screenshot, log file, a stray temp
file like the one we just deleted) the only mitigation is a redeploy.

**Plan:**
- Add `users.is_admin BOOLEAN DEFAULT false` column.
- Reuse the regular JWT auth, gate `/admin/*` on `request.user.is_admin`.
- Log every admin mutation to a new `admin_audit_log` table
  (actor_user_id, action, target_id, payload_json, at).
- Optional: TOTP 2FA enforced for admin accounts only.
- Keep `ADMIN_TOKEN` as a break-glass for one release, then remove.

## 3. Privacy policy (`/privacy`) — ✅ DONE 2026-05-25 (commit 6c6e72d)

Privacy policy already lived as a tab inside `/terms`. Added a `/privacy`
301-redirect for DPA discoverability and corrected §2.2 to disclose the
per-browser presence device ID (scoped to gallery lifetime).

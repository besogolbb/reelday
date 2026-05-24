# Reelday Security Checklist — owner actions

Audit ran 2026-05-25. Code-side work is complete (24 commits on `main`).
The items below are things **only you can do** — they require access to
dashboards / accounts I don't have visibility into, or product decisions
I can't make for you.

Work through them in order. Each takes 2-20 minutes.

---

## 1. Post-deploy smoke tests  (15 min, do once)

Confirm today's fixes are actually live in production after Easypanel
finishes deploying.

- [ ] **Security headers ship.** Open `https://reelday.ph` in incognito,
      DevTools → Network → click the document request → Response Headers.
      Confirm you see:
      - `content-security-policy: …` (long string, ends with `report-uri /api/_csp-report`)
      - `strict-transport-security: max-age=31536000; includeSubDomains`
      - `x-content-type-options: nosniff`
      - `referrer-policy: strict-origin-when-cross-origin`

- [ ] **Login timing fix works.** Try logging in with a fake email
      (`nobody-real-test@reelday.ph`) and any password. The response
      should take ~300ms (not instant). Confirms bcrypt-on-missing-user
      is running. Was instant before the fix.

- [ ] **Upload type allowlist.** From DevTools Console on `/upload/<some-slug>`:
      ```js
      fetch('/api/uploads/presigned', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({slug:'<slug>', filename:'x.svg', contentType:'image/svg+xml'})
      }).then(r => r.json()).then(console.log)
      ```
      Should return `{ error: true, code: 'unsupported_type', … }`.

- [ ] **Open-redirect blocked.** Open `https://reelday.ph/login?next=https://evil.com`,
      log in. Should land on `/my-events`, NOT `evil.com`.

- [ ] **No CSP violations in normal use.** Click through `/`, `/start`,
      `/login`, `/dashboard`, `/wall/<slug>`, `/upload/<slug>` with
      Console open. Should see zero red CSP errors.

- [ ] **CSP report endpoint catches things.** From any page console:
      ```js
      fetch('/api/_csp-report', { method:'POST',
        headers:{'Content-Type':'application/csp-report'},
        body: JSON.stringify({'csp-report': {'violated-directive':'test'}}) })
      ```
      Returns 204. Then `curl -H "Authorization: Bearer <DEBUG_KEY>" https://reelday.ph/api/_errors`
      should include it under `csp_reports[]`.

---

## 2. Infrastructure I can't see  (20 min, do once)

These are the items I flagged but can't verify from code. Each needs
~5 minutes in the relevant dashboard.

### Cloudflare R2 (the photo/video bucket)

- [ ] **Object versioning ON** for `reelday-uploads`. Without it, an
      accidental `DeleteObjects` (or a compromised admin token) wipes
      a wedding gallery with no recovery. Cloudflare R2 → Bucket
      settings → Object versioning.

- [ ] **Lifecycle rule** to abort incomplete multipart uploads after 7
      days (otherwise failed transcodes accumulate as billed storage).

- [ ] **Bucket is private** — public access only via
      `R2_PUBLIC_URL` / signed URLs. Confirm `pub-XXXX.r2.dev` isn't
      world-listable.

### Postgres

- [ ] **Point-in-time recovery (PITR) enabled.** Check your provider's
      backup settings page. "Daily snapshots" is NOT PITR — you need
      WAL streaming.

- [ ] **You have personally tested a restore** at least once. Spin up
      a throwaway DB from a snapshot, confirm tables + a few rows
      come back. "Backups exist" is worthless without "I've actually
      restored from one and it worked." Schedule a quarterly drill.

- [ ] **Connection pool limits sane** — `DATABASE_URL` should include
      `?connection_limit=20` or similar so a runaway query loop can't
      eat all your connections.

### AWS (transcode Lambda)

- [ ] **IAM key for the transcode lambda** has *only* `sqs:SendMessage`
      on the queue ARN + `s3:*` on the upload prefix. Not full S3, not
      full Lambda. Check the policy attached to `AWS_ACCESS_KEY_ID`.

- [ ] **Rotate that key** if it's been the same one since you started.
      AWS keys don't expire on their own.

### Easypanel / deploy access

- [ ] **2FA enabled** on your Easypanel account.

- [ ] **Recovery plan documented** for if you lose access to Easypanel
      itself. Where's the credential? Who's the second human?

- [ ] **`.env` secrets backed up** somewhere other than Easypanel.
      1Password / Bitwarden / a sealed envelope. If Easypanel ever
      goes down, you need to redeploy elsewhere from this list:
      `JWT_SECRET`, `DATABASE_URL`, `R2_*`, `PAYMONGO_*`, `RESEND_API_KEY`,
      `WEBHOOK_SECRET`, `PAYMONGO_WEBHOOK_SECRET`, `ADMIN_TOKEN`,
      `DEBUG_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CALENDAR_*`,
      `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TRANSCODE_SQS_URL`.

### Domain / DNS

- [ ] **Domain registrar account has 2FA + a renewal alert >60 days
      before expiry.** Losing reelday.ph because nobody saw the
      renewal email is the cheapest-and-worst preventable outage.

- [ ] **DNS provider has 2FA.** A stolen DNS account = full takeover.

---

## 3. Product decisions blocking deferred security work

These three items are sitting in `docs/security-followups.md` and only
need *your* call to unblock. See that doc for each migration plan.

### `/privacy` page  (RA 10173 / PH Data Privacy Act compliance)

You're collecting names, phones, emails, and photos of attendees. PH
DPA requires a notice before collection. Decisions needed:

- [ ] **Support email** for privacy requests. Use `besogol.b@gmail.com`
      or create `privacy@reelday.ph`?
- [ ] **Retention windows** to state publicly:
      - Galleries: 7 days after `gallery_expires_at` (already in code,
        just confirm we publish this)
      - Host accounts: ? (we never auto-delete users today)
      - Guest device IDs in `presence`: ?
- [ ] **Sub-processors list** to disclose. Confirm: Cloudflare R2,
      AWS Lambda (ap-southeast-1), Resend (email), PayMongo (payments),
      Google Calendar (admin sync). Anyone else?
- [ ] **NPC complaint channel** — standard one-liner about the user's
      right to complain to the National Privacy Commission. Want me
      to draft once decisions are made?

### JWT → HttpOnly cookies

- [ ] Schedule a quiet morning to ship the migration in one PR (see
      `security-followups.md` § 1 for the 7-step plan). Risk is that
      a rushed deploy logs every user out simultaneously.

### Admin auth overhaul

- [ ] Decide: real admin user accounts with role flag + audit log, or
      keep the shared `ADMIN_TOKEN` and just rotate it quarterly?

---

## 4. Ongoing monitoring  (set up once, runs forever)

- [ ] **Weekly Lighthouse run** on `/` (mobile + desktop). Catches
      regressions when you add features. Command:
      `npx lighthouse https://reelday.ph --view` and `--view --preset=desktop`.

- [ ] **Check `/api/_errors`** weekly (or after deploys). Anything in
      `errors[]` is a 500, anything in `csp_reports[]` is either a
      new CDN to allowlist or a real XSS attempt. Authorization header:
      `Bearer <DEBUG_KEY>`.

- [ ] **R2 storage growth** — set a Cloudflare billing alert at 2x your
      current month so a leak (e.g. abandoned uploads) doesn't surprise
      you on the next bill.

- [ ] **Postgres slow-query log** — most providers turn this on for
      free. Anything over 500ms regularly is your future scaling
      problem.

---

## 5. Pre-deploy reminders  (every PR that touches frontend)

Now that the security baseline is set, keep these in mind:

- [ ] **Before adding any new external resource** (CDN, third-party
      script, font, embed), add the origin to the CSP in
      `backend/server.js` lines 140-180 first. The page will break
      otherwise.

- [ ] **Before merging any PR that touches `frontend/`,** check for
      external URLs that weren't there before:
      ```powershell
      git diff main --unified=0 -- frontend/ | Select-String -Pattern 'https?://[a-zA-Z0-9.-]+'
      ```
      Anything new gets added to CSP.

- [ ] **Never `git add -A`** in this repo. Always name files
      explicitly. The repo has a history of accidentally-tracked
      build artifacts (Lighthouse reports, demo videos). `.gitignore`
      now catches the known ones but new patterns will slip through.

- [ ] **Don't write user-supplied strings to `.innerHTML`** without
      escaping. Use the existing `escapeHtml` / `escapeWallHtml`
      helpers, or `textContent` if no HTML is needed. The frontend
      has ~120 `innerHTML =` sites; today's audit cleared the two
      that were taking guest/host input directly, but new code
      could re-introduce the pattern.

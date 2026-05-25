# Reelday Security Runbook — step-by-step

Companion to `docs/security-checklist.md`. That doc lists *what* to
check; this one gives you the exact clicks and commands for *how*.

Work through it in the order below. Each section is self-contained.
Times are for someone who's never done the task before.

---

## A — Smoke-test today's deploy  (15 min)

Goal: confirm the 24 commits from 2026-05-25 are live and behaving.

### A.1 Confirm security headers

1. Open `https://reelday.ph` in an **Incognito / Private** window.
2. Open DevTools (F12) → **Network** tab.
3. Hard-refresh (Ctrl+Shift+R).
4. Click the very first row in the network list (the `reelday.ph`
   document request itself).
5. Right pane → **Headers** → scroll to **Response Headers**.
6. Confirm each of these is present:

   | Header | Expected value (starts with) |
   |---|---|
   | `content-security-policy` | `default-src 'self';script-src 'self'…` |
   | `strict-transport-security` | `max-age=31536000; includeSubDomains` |
   | `x-content-type-options` | `nosniff` |
   | `x-frame-options` | `SAMEORIGIN` |
   | `referrer-policy` | `strict-origin-when-cross-origin` |
   | `cross-origin-resource-policy` | `cross-origin` |

If any are missing, the Easypanel deploy didn't pick up the latest
commits — check the deploy log.

### A.2 Login timing fix

1. Open `https://reelday.ph/login`.
2. Email: `nobody-real-test-12345@reelday.ph` (must not exist).
3. Password: anything.
4. Click **Log in**. Use a stopwatch or DevTools Network → Timing.
5. **Pass:** response takes ~250-400ms. Bcrypt is running even for
   missing users.
6. **Fail:** response is instant (<50ms). Timing oracle is back —
   redeploy.

### A.3 Upload type allowlist

1. Open any event upload page, e.g. `/upload/<your-event-slug>`.
2. Open DevTools Console.
3. Paste and run:
   ```js
   fetch('/api/uploads/presigned', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       slug: '<your-event-slug>',
       filename: 'attack.svg',
       contentType: 'image/svg+xml',
     }),
   }).then(r => r.json()).then(console.log)
   ```
4. **Pass:** logs `{ error: true, code: 'unsupported_type', … }`.
5. **Fail:** logs `{ uploadUrl: 'https://…', fileKey: '…' }` — the
   allowlist isn't deployed; XSS path is open.

### A.4 Open-redirect blocked

1. While logged out, visit:
   `https://reelday.ph/login?next=https://example.com`
2. Log in with a real account.
3. **Pass:** land on `https://reelday.ph/my-events`.
4. **Fail:** redirected to `example.com`.

### A.5 CSP report endpoint works

1. From any page console:
   ```js
   await fetch('/api/_csp-report', {
     method: 'POST',
     headers: { 'Content-Type': 'application/csp-report' },
     body: JSON.stringify({ 'csp-report': {
       'violated-directive': 'manual-test',
       'blocked-uri': 'https://example.com/test',
     }}),
   });
   ```
   Should return status 204.
2. From your terminal, with `DEBUG_KEY` env var set on the server:
   ```powershell
   $key = "<your DEBUG_KEY>"
   curl.exe -H "Authorization: Bearer $key" https://reelday.ph/api/_errors
   ```
3. **Pass:** response JSON has `csp_reports[]` with your test entry.
4. **Fail:** `csp_reports` empty — collector isn't deployed.

   *If you don't have `DEBUG_KEY` set:* go to Easypanel → your service
   → Environment → add `DEBUG_KEY=<long-random-string>` and redeploy.

---

## B — Cloudflare R2  (10 min)

Goal: a deleted/corrupted bucket object is recoverable.

### B.1 Enable object versioning

1. Cloudflare dashboard → **R2** (left sidebar).
2. Click your bucket (`reelday-uploads` or similar).
3. **Settings** tab → **Object versioning** section.
4. Toggle **ON**.
5. **Optional:** set a lifecycle rule under **Object lifecycle rules**
   → **Add rule** → "Delete non-current versions after 90 days" so
   versioning doesn't grow forever.

**What this buys you:** if `DELETE /api/uploads/:id` ever has a bug,
or an admin runs a mass-delete by mistake, you can list old versions
and restore. Without it, deleted objects are gone in milliseconds.

### B.2 Lifecycle rule: abort stale multipart uploads

1. Same bucket → **Settings** → **Object lifecycle rules**.
2. **Add rule**:
   - Name: `abort-stale-multipart`
   - Apply to: all objects
   - Action: **Abort multipart uploads** after **7 days**.
3. Save.

**Why:** failed transcode webhooks can leave incomplete multipart
uploads. R2 still bills you for the parts. This sweeps them.

### B.3 Confirm bucket is private

1. Open an anonymous browser tab.
2. Visit `https://pub-<your-bucket-id>.r2.dev/` directly (no path).
3. **Pass:** 404 or AccessDenied (the root isn't listable).
4. **Fail:** HTML directory listing of every uploaded photo. Disable
   the public bucket in **R2 → Bucket → Settings → Public access**
   and use `R2_PUBLIC_URL` via a custom domain instead.

---

## C — Postgres  (Hostinger VPS, self-hosted)  (45 min — biggest lift)

Your DB is on a raw IP — no managed PITR available out of the box.
You have two realistic options. Pick one.

### Option 1 — Pragmatic: `pg_dump` cron + offsite copy  (recommended)

This gives you nightly snapshots with up-to-24h data loss in worst
case. Good enough for the current scale.

1. **SSH into the VPS** that hosts Postgres.
2. Create a backup user (one-time):
   ```bash
   sudo -u postgres psql -c "CREATE USER backup WITH PASSWORD '<random-32-char>';"
   sudo -u postgres psql -c "GRANT CONNECT ON DATABASE reelday TO backup;"
   sudo -u postgres psql -d reelday -c "GRANT USAGE ON SCHEMA public TO backup;"
   sudo -u postgres psql -d reelday -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup;"
   ```
3. Create `/usr/local/bin/reelday-backup.sh`:
   ```bash
   #!/bin/bash
   set -euo pipefail
   DATE=$(date +%Y%m%d-%H%M%S)
   OUT=/var/backups/reelday/reelday-$DATE.sql.gz
   mkdir -p /var/backups/reelday
   PGPASSWORD='<the-backup-password>' pg_dump \
     -h localhost -U backup -d reelday \
     --no-owner --no-privileges \
     | gzip -9 > "$OUT"
   # Keep last 14 days locally
   find /var/backups/reelday -name 'reelday-*.sql.gz' -mtime +14 -delete
   # Upload to R2 (set up rclone first: rclone config → R2)
   rclone copy "$OUT" r2:reelday-backups/
   ```
4. `chmod +x /usr/local/bin/reelday-backup.sh`
5. Add to crontab:
   ```bash
   sudo crontab -e
   # Append:
   0 3 * * * /usr/local/bin/reelday-backup.sh >> /var/log/reelday-backup.log 2>&1
   ```
6. Run once manually to confirm: `sudo /usr/local/bin/reelday-backup.sh`
   then `ls /var/backups/reelday/` — should see the new `.sql.gz`.

### Option 2 — Real PITR via WAL archiving

Heavier setup, gives you point-in-time recovery to the second. Skip
unless you're billing-significantly more revenue. See
`postgresql.org/docs/current/continuous-archiving.html` — not
walking you through it here because the operational cost is high
and you don't need it today.

### C.1 Test the restore  (do this same week)

A backup you've never restored isn't a backup. Run a drill:

1. On the VPS (or any machine with Postgres + the backup file):
   ```bash
   sudo -u postgres createdb reelday_restore_test
   gunzip -c /var/backups/reelday/reelday-<latest>.sql.gz \
     | sudo -u postgres psql -d reelday_restore_test
   sudo -u postgres psql -d reelday_restore_test -c \
     "SELECT count(*) FROM events; SELECT count(*) FROM uploads; SELECT count(*) FROM users;"
   ```
2. Confirm the counts roughly match production.
3. Drop the test DB: `sudo -u postgres dropdb reelday_restore_test`.

Put a quarterly calendar reminder to repeat this drill.

### C.2 Connection pool sanity

1. Check your live `DATABASE_URL` in Easypanel env vars.
2. If it doesn't include `?connection_limit=` parameter, add one — see
   what Postgres is configured for:
   ```bash
   sudo -u postgres psql -c "SHOW max_connections;"
   ```
3. Cap your app at ~half of `max_connections` so leaving overhead for
   manual psql + the backup job. E.g. if `max_connections=100`:
   `postgresql://...?connection_limit=40`.

---

## D — AWS (transcode Lambda)  (10 min)

### D.1 Audit the IAM key scope

1. Sign into AWS Console → **IAM**.
2. **Users** → find the user attached to `AWS_ACCESS_KEY_ID` (probably
   named `reelday-transcoder` or similar).
3. Click the user → **Permissions** tab → review attached policies.

The policy SHOULD allow ONLY:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "sqs:SendMessage",
         "Resource": "arn:aws:sqs:ap-southeast-1:263842074067:reelday-transcode.fifo"
       },
       {
         "Effect": "Allow",
         "Action": ["s3:GetObject", "s3:PutObject"],
         "Resource": "arn:aws:s3:::<your-transcode-bucket>/*"
       },
       {
         "Effect": "Allow",
         "Action": "lambda:InvokeFunction",
         "Resource": "arn:aws:lambda:ap-southeast-1:263842074067:function:reelday-transcoder-v3-singapore"
       }
     ]
   }
   ```

**FAIL signals:**
- Policy says `"Action": "*"` or `"s3:*"` on `*` → over-privileged.
- Policy attached is `AdministratorAccess` or `AmazonS3FullAccess` →
  rotate the key + replace with the minimal policy above.

### D.2 Rotate the key

If the key is older than 12 months or has ever been pasted somewhere
risky (Slack, screenshots, an old `.env`):

1. IAM → user → **Security credentials** → **Create access key**.
2. Copy the new pair somewhere safe.
3. Update Easypanel env vars `AWS_ACCESS_KEY_ID` and
   `AWS_SECRET_ACCESS_KEY` → redeploy.
4. Confirm a video upload still transcodes (upload to a test event,
   wait ~30s, check the wall).
5. Back in IAM → user → old access key → **Deactivate** for 48h, then
   **Delete**.

---

## E — Easypanel & DNS  (15 min)

### E.1 Easypanel 2FA

1. Sign in → top-right avatar → **Account settings**.
2. **Two-factor authentication** → **Enable**.
3. Scan with Google Authenticator / 1Password / Authy.
4. **Save backup codes somewhere offline** (printed, in your password
   manager's "secure notes").

### E.2 Recovery plan written down

Create a file in your password manager called "Reelday recovery"
with:
- Easypanel login URL + email + (encrypted) password
- Cloudflare login URL + email + (encrypted) password
- AWS console URL + IAM user + (encrypted) password
- Domain registrar URL + login
- VPS root SSH key location + password to the key
- Postgres `backup` user password (for restore-from-backup scenarios)
- The list of env-var values from `docs/security-checklist.md` § 2

If you get hit by a bus or your laptop dies, this is what your
second human needs to keep the service alive for a week.

### E.3 Domain renewal alert

1. Log into your domain registrar (Namecheap / Hostinger / wherever).
2. Find `reelday.ph` → **Renewal settings**.
3. Enable **auto-renew**.
4. Set an additional email reminder **60 days before expiry**.
5. **Enable 2FA** on the registrar account itself.

### E.4 Cloudflare account 2FA

1. Cloudflare dashboard → top-right avatar → **My profile**.
2. **Authentication** tab → **Two-factor authentication** → enable.
3. Save backup codes offline.

---

## F — Ongoing monitoring  (10 min setup, runs forever)

### F.1 Lighthouse weekly

Create a recurring calendar event ("Reelday: Lighthouse check —
Monday 10am"). When it fires:
```powershell
cd "C:\Users\ADMIN\Documents\Claude Code Projects\Reelday.ph"
npx lighthouse https://reelday.ph --view
npx lighthouse https://reelday.ph --view --preset=desktop
```
Compare scores against the baseline:
- Mobile perf: was 74 on 2026-05-25
- Desktop perf: was 83
- A11y / BP / SEO: all 100

A drop >5 points = something regressed; check the recent PRs.

### F.2 Errors endpoint check after every deploy

After Easypanel finishes any deploy, in PowerShell:
```powershell
$key = "<your DEBUG_KEY>"
curl.exe -H "Authorization: Bearer $key" https://reelday.ph/api/_errors | ConvertFrom-Json
```
- `errors[]` non-empty → 500s happened, fix the root cause.
- `csp_reports[]` non-empty → either a new CDN you forgot, or
  someone tried XSS. Investigate.

### F.3 R2 billing alert

1. Cloudflare → **Billing** → **Notifications**.
2. Add notification: **R2 storage usage above 2x current month**.
3. Email yourself.

### F.4 Postgres slow-query log

1. SSH to the VPS.
2. Edit `/etc/postgresql/<version>/main/postgresql.conf`:
   ```
   log_min_duration_statement = 500   # log queries slower than 500ms
   log_destination = 'stderr'
   ```
3. `sudo systemctl restart postgresql`.
4. Watch with: `sudo tail -f /var/log/postgresql/postgresql-<version>-main.log`.

---

## G — Product decisions to unblock deferred work  (your call)

These three are sitting in `docs/security-followups.md`. Each is
gated on a decision only you can make.

### G.1 `/privacy` page — 4 questions

Reply in chat with your answers, I'll draft the page.

1. **Support contact email for privacy requests** — `besogol.b@gmail.com`
   or create `privacy@reelday.ph`?
2. **Host account retention** — we never auto-delete users today.
   State that, or commit to "delete on request within 30 days"?
3. **Guest device-ID retention** (`presence` table) — currently
   indefinite. Propose: purge after the event's `archived_at`?
4. **Sub-processors disclosure** — list these as third-party data
   handlers in the privacy notice: Cloudflare R2, AWS Lambda
   (ap-southeast-1), Resend, PayMongo, Google Calendar. Add anyone
   else?

### G.2 JWT → cookies migration

When you have a 90-minute uninterrupted block, schedule the
migration in `docs/security-followups.md` § 1. Until then, the
30-day JWT in localStorage stays as-is — not critical but the
biggest "old security debt" left.

### G.3 Admin auth overhaul

Two options:
- **A:** real user accounts with `is_admin` flag + audit log
  (security-followups.md § 2). 2-3 hours of work.
- **B:** keep `ADMIN_TOKEN`, just rotate it quarterly via a
  calendar reminder. Zero work.

Either is acceptable. Reply with A or B and I'll execute.

---

## When you finish

Each item you complete, tick the matching box in
`docs/security-checklist.md`. When all of § 1 + § 2 are ticked, the
security audit is operationally closed — you'll have moved from
"code is secure" to "code AND operations are secure," which is the
distinction that actually matters when things go wrong.

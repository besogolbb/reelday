# Reelday Handover

**Stack:** Fastify (Node) · Postgres · Cloudflare R2 · AWS Lambda (transcode) · Resend · PayMongo · Easypanel deploy · Hostinger VPS `72.61.209.165`

## Code map

| Where | What |
|---|---|
| `backend/server.js` | Entry, helmet/CSP, CORS, rate-limit, routes |
| `backend/routes/` | API. `auth`, `events`, `uploads`, `payments`, `webhooks`, `admin`, `sde`, `polls`, `reactions`, `music`, `event-site`, `contact`, `presence`, `health`, `quiz-session`, `wall-errors` |
| `backend/plugins/` | `database`, `storage` (R2), `auth` (JWT) |
| `backend/lib/` | `plans`, `videoTranscode`, `awsLambdaService`, `gcal`, `sde*`, `storageKeys` |
| `backend/jobs/` | Cron: `renewal-reminders`, `gallery-cleanup`, `sde-lambda-poller` |
| `frontend/*.html` | Pages. Inline scripts (no build step). Plain JS modules in `frontend/js/` |
| `database/schema.sql` + runtime ALTERs in `plugins/database.js` | Schema source of truth |
| `lambda/` | Remotion video render lambda code |
| `docs/` | This file, `security-runbook.md`, `security-checklist.md`, `security-followups.md`, plan docs |

## Auth model
JWT in `localStorage` (30d). `fastify.authenticate` preHandler on routes. Admin = separate `ADMIN_TOKEN` shared bearer ([backend/routes/admin.js:98](backend/routes/admin.js#L98)). Plan tiers are **event-scoped** (`events.plan` is source of truth), not user-scoped — except `hiraya` (yearly sub on user).

## Deploy
`git push origin main` → Easypanel auto-deploys. Container restart, ~1 min. Static assets cached 60s, images 30d (see [backend/server.js:170-181](backend/server.js#L170-L181)).

## Env vars (required at boot, see [server.js:42-51](backend/server.js#L42-L51))
`JWT_SECRET` (≥32 chars), `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`. Optional: `RESEND_API_KEY`, `PAYMONGO_*`, `AWS_*`, `GOOGLE_*`, `ADMIN_TOKEN`, `DEBUG_KEY`, `WEBHOOK_SECRET`.

## Recurring ops (click to add to Google Calendar)

| Task | When | Link |
|---|---|---|
| Restore Postgres backup test | Quarterly · 25th 10am PHT | [add](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reelday%3A%20Test%20Postgres%20backup%20restore&dates=20260625T020000Z%2F20260625T021500Z&details=ssh%20root%4072.61.209.165%20%E2%86%92%20export%20PGPASS%20%E2%86%92%20run%20docs%2Fsecurity-runbook.md%20%C2%A7C.1%20restore-test%20block.%20Counts%20must%20match%20production.&recur=RRULE%3AFREQ%3DMONTHLY%3BINTERVAL%3D3%3BBYMONTHDAY%3D25) |
| Lighthouse audit | Weekly · Mon 10am | [add](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reelday%3A%20Lighthouse%20audit&dates=20260601T020000Z%2F20260601T021500Z&details=npx%20lighthouse%20https%3A%2F%2Freelday.ph%20--view%20%2B%20--preset%3Ddesktop.%20Baseline%3A%20mobile%2074%2C%20desktop%2083%2C%20a11y%2FBP%2FSEO%20100.&recur=RRULE%3AFREQ%3DWEEKLY%3BBYDAY%3DMO) |
| `/api/_errors` review | Monthly · 1st 10am | [add](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reelday%3A%20Check%20%2Fapi%2F_errors&dates=20260601T020000Z%2F20260601T021000Z&details=curl%20-H%20%22Authorization%3A%20Bearer%20%3CDEBUG_KEY%3E%22%20https%3A%2F%2Freelday.ph%2Fapi%2F_errors%20%7C%20ConvertFrom-Json.%20Review%20errors%5B%5D%20%2B%20csp_reports%5B%5D.&recur=RRULE%3AFREQ%3DMONTHLY%3BBYMONTHDAY%3D1) |
| AWS IAM key rotate | Annually · Jan 15 | [add](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reelday%3A%20Rotate%20AWS%20transcode%20key&dates=20270115T020000Z%2F20270115T023000Z&details=IAM%20%E2%86%92%20user%20%E2%86%92%20Security%20credentials%20%E2%86%92%20Create%20new%20%E2%86%92%20update%20Easypanel%20env%20%E2%86%92%20deactivate%20old%20%E2%86%92%2048h%20%E2%86%92%20delete.%20See%20security-runbook.md%20%C2%A7D.2.&recur=RRULE%3AFREQ%3DYEARLY) |
| Domain renewal check | Annually · 60d pre-expiry | [add](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Reelday%3A%20Check%20reelday.ph%20renewal&dates=20260901T020000Z%2F20260901T021000Z&details=Confirm%20auto-renew%20still%20on%2C%20payment%20method%20valid%2C%202FA%20active%20on%20registrar.&recur=RRULE%3AFREQ%3DYEARLY) |

## Automated ops
- Nightly DB dump 3am UTC → `/var/backups/reelday/` (14d) → R2 `reelday-backups/` (90d). Script: `/usr/local/bin/reelday-backup.sh` on VPS.
- Gallery cleanup: 7 days post `gallery_expires_at`, R2 + uploads rows purged, `archived_at` set.
- Renewal reminders: T-30/T-7/T-0 Hiraya emails.
- SDE Lambda poller: monitors in-flight renders.
- Pending transcode reconcile on boot.

## Debugging

| Need | How |
|---|---|
| Recent 500s + CSP reports | `curl -H "Authorization: Bearer $DEBUG_KEY" https://reelday.ph/api/_errors` |
| Tail server logs | Easypanel → reelday service → Logs |
| DB shell | Easypanel → reelday-db → `>_` terminal (web pgweb/dbgate also exposed) |
| Force-restart a service | Easypanel → service → restart icon |
| SSH host | `ssh root@72.61.209.165` |
| Find Postgres container | `docker ps --filter name=reelday-db --format '{{.Names}}' \| grep -v -e _pgweb -e _dbgate` |

## Active deferred work (see `docs/security-followups.md`)

| Item | Status | Effort |
|---|---|---|
| JWT in localStorage → HttpOnly cookies | Deferred — needs coordinated migration | ~90 min |
| Admin auth: shared `ADMIN_TOKEN` → real user + audit log | Deferred — decide A (full) or B (rotate quarterly) | A: 2-3h, B: 0 |
| R2 object versioning | Skipped — not in Wrangler yet, accepted risk | revisit when Wrangler ships it |

## Operational state (as of 2026-05-25)

| Metric | Value |
|---|---|
| Lighthouse mobile | perf 74, a11y/BP/SEO 100/100/100 |
| Lighthouse desktop | perf 83, a11y/BP/SEO 100/100/100 |
| Production scale | ~100 events/month |
| R2 storage cost | ~$8/mo |
| Backup cost | ~$0.01/mo |
| Total infra cost | <$50/mo (VPS + R2 + Lambda + Resend + domains) |

## Where stuff lives (off-repo)

| Account | URL | 2FA |
|---|---|---|
| Easypanel | (your instance) | ✅ |
| Cloudflare | dash.cloudflare.com | ✅ |
| Domain registrar | (whichever you used) | ✅ |
| AWS | console.aws.amazon.com | enable if not |
| Hostinger VPS | hpanel.hostinger.com | enable if not |
| Resend | resend.com | enable if not |
| PayMongo | dashboard.paymongo.com | enable if not |
| Google Cloud (for Calendar service account) | console.cloud.google.com | enable if not |

**Recovery list** (env vars + login creds) should be in your password manager under "Reelday recovery". See `security-runbook.md` § E.2 for the canonical list.

## Onboarding a new dev — read in this order

1. `README.md` (if exists) / `PRODUCT.md`
2. This file (`HANDOVER.md`)
3. `docs/security-checklist.md` — operational state of security
4. `docs/security-runbook.md` — step-by-step for ops tasks
5. `docs/security-followups.md` — known deferred work
6. `backend/server.js` — entry point, all the wiring
7. `database/schema.sql` + `backend/plugins/database.js` ALTERs — data model

## Backup & restore (quick reference)

**Backups are automatic. Restores are manual.** Two scenarios:

### Quarterly drill — prove backups still work (10 min)

SSH in, then paste this block. Replace `<PASSWORD>` first:

```bash
ssh root@72.61.209.165
export PGPASS='<PASSWORD>'

CONTAINER=$(docker ps --filter "name=reelday-db" --format '{{.Names}}' \
  | grep -v -e _pgweb -e _dbgate | head -1)
LATEST=$(ls -t /var/backups/reelday/reelday-*.sql.gz | head -1)
echo "Drill restore: $LATEST → temp DB"

docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d reelday -c "CREATE DATABASE reelday_restore_test;"

zcat "$LATEST" | docker exec -i -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d reelday_restore_test

echo "── RESTORED ──"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" psql -U reelday -d reelday_restore_test \
  -c "SELECT 'events' t, count(*) FROM events
      UNION ALL SELECT 'uploads', count(*) FROM uploads
      UNION ALL SELECT 'users',   count(*) FROM users;"
echo "── PRODUCTION ──"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" psql -U reelday -d reelday \
  -c "SELECT 'events' t, count(*) FROM events
      UNION ALL SELECT 'uploads', count(*) FROM uploads
      UNION ALL SELECT 'users',   count(*) FROM users;"

docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d reelday -c "DROP DATABASE reelday_restore_test;"
```

✅ Counts match (±1-2 rows) → backups are valid. ❌ Counts mismatched / restore errored → investigate now, NOT during an incident.

### Real restore — production DB is corrupted / wiped

Don't panic. Worst case you've lost ≤24h of data (the gap between last backup and now).

**Step 1 — get the latest backup**
```bash
# If local copy is still there:
ls -lt /var/backups/reelday/reelday-*.sql.gz | head -1

# If local is gone (VPS died), pull from R2:
mkdir -p /tmp/restore
rclone copy r2:reelday-backups/ /tmp/restore/ --max-age 48h
ls -lt /tmp/restore/reelday-*.sql.gz | head -1
```

**Step 2 — restore over production**
```bash
export PGPASS='<PASSWORD>'
CONTAINER=$(docker ps --filter "name=reelday-db" --format '{{.Names}}' \
  | grep -v -e _pgweb -e _dbgate | head -1)
LATEST=/var/backups/reelday/<filename>.sql.gz   # or /tmp/restore/<...>

# Stop the app so it can't write during restore (Easypanel → reelday → stop)
# Then:

docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d postgres -c "DROP DATABASE reelday;"
docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d postgres -c "CREATE DATABASE reelday;"

zcat "$LATEST" | docker exec -i -e PGPASSWORD="$PGPASS" "$CONTAINER" \
  psql -U reelday -d reelday

# Re-start the app in Easypanel.
```

**Step 3 — verify**
Visit `/api/_errors` and `/` to confirm no 500s. Spot-check an event page renders.

### Where backups live

| Copy | Where | Retention |
|---|---|---|
| Local | `/var/backups/reelday/reelday-*.sql.gz` on the VPS | 14 days |
| Offsite | `r2:reelday-backups/` (Cloudflare R2) | 90 days |

Pull list of offsite copies: `rclone ls r2:reelday-backups/`

### Script + schedule

| | |
|---|---|
| Script | `/usr/local/bin/reelday-backup.sh` (mode 700, root only) |
| Schedule | `0 3 * * * /usr/local/bin/reelday-backup.sh >> /var/log/reelday-backup.log 2>&1` |
| View log | `tail -50 /var/log/reelday-backup.log` |
| Run manually | `sudo /usr/local/bin/reelday-backup.sh` |
| Check next-run | `sudo crontab -l \| grep reelday` |

## When something breaks at 1 AM

1. Easypanel → service → Logs → look for `REELDAY_500` lines
2. `curl /api/_errors` (with `DEBUG_KEY`) for the JSON dump
3. Revert: `git log --oneline | head -5` to find last good commit, `git revert <bad-sha>`, push.
4. Restore DB: see `security-runbook.md` § C.1 restore-test block (same procedure, different target DB).

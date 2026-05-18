// One-time (idempotent) Google Calendar backfill.
//
// Pushes every dated event into the shared service-account calendar and
// stamps events.gcal_event_id so future edits patch instead of duplicate.
// Safe to re-run: rows that already have a gcal_event_id are PATCHed, not
// re-inserted. Live create/edit/delete sync is handled in routes/admin.js;
// this just seeds the calendar with events that predate the integration.
//
// Usage (from repo root, with .env present):
//   node scripts/gcal-backfill.mjs
//
// Env: DATABASE_URL + the three GOOGLE_CALENDAR_* vars (see .env.example).

import 'dotenv/config';
import pg from 'pg';
import { syncEventToGcal, gcalConfigured } from '../backend/lib/gcal.js';

if (!gcalConfigured()) {
  console.error('✖ Google Calendar not configured — set GOOGLE_CALENDAR_SA_EMAIL, GOOGLE_CALENDAR_SA_PRIVATE_KEY, GOOGLE_CALENDAR_ID in .env');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('✖ DATABASE_URL is not set');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

const { rows } = await pool.query(
  `SELECT e.id, e.slug, e.couple_names, e.event_type, e.plan, e.event_date,
          e.venue, e.event_time, e.is_paid, e.is_active, e.gcal_event_id,
          usr.email AS user_email
     FROM events e
     LEFT JOIN users usr ON usr.id = e.user_id
    WHERE e.event_date IS NOT NULL
    ORDER BY e.event_date ASC`,
);

console.log(`Backfilling ${rows.length} dated event(s) into Google Calendar…`);
let ok = 0, failed = 0;

for (const ev of rows) {
  try {
    const gid = await syncEventToGcal(ev);
    if (gid && gid !== ev.gcal_event_id) {
      await pool.query('UPDATE events SET gcal_event_id = $2 WHERE id = $1', [ev.id, gid]);
    }
    ok++;
    console.log(`  ✓ ${ev.slug} → ${gid || '(unchanged)'}`);
  } catch (err) {
    failed++;
    console.error(`  ✖ ${ev.slug}: ${err.message}`);
  }
  await sleep(120); // gentle on the Calendar API quota
}

console.log(`\nDone. ${ok} synced, ${failed} failed, ${rows.length} total.`);
await pool.end();
process.exit(failed ? 1 : 0);

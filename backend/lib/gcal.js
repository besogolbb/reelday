// Google Calendar sync (service-account → a shared calendar).
//
// One service account writes events into a single calendar the admin has
// shared with it ("Make changes to events"). No per-user OAuth, no token
// refresh dance — google-auth-library mints + caches the access token.
//
// Env (all three required to enable; missing any → module is a no-op so
// dev/local and unconfigured deploys keep working unchanged):
//   GOOGLE_CALENDAR_SA_EMAIL       service account client_email
//   GOOGLE_CALENDAR_SA_PRIVATE_KEY service account private_key (PEM; \n escaped)
//   GOOGLE_CALENDAR_ID             target calendar id (…@group.calendar.google.com)
//
// All-day event on event_date. Title is just the couple/event name and
// every entry is `confirmed` — paid/active state is deliberately NOT
// surfaced on the calendar (no (UNPAID)/(INACTIVE) suffix, no tentative/
// cancelled colouring). The Reelday event id is stashed in
// extendedProperties.private so entries can be reconciled later.

import { JWT } from 'google-auth-library';

const SA_EMAIL    = process.env.GOOGLE_CALENDAR_SA_EMAIL || '';
const SA_KEY      = (process.env.GOOGLE_CALENDAR_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';
const PUBLIC_HOST = process.env.APP_PUBLIC_HOST || 'reelday.ph';

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';

export function gcalConfigured() {
  return Boolean(SA_EMAIL && SA_KEY && CALENDAR_ID);
}

let _client;
function authClient() {
  if (!_client) _client = new JWT({ email: SA_EMAIL, key: SA_KEY, scopes: SCOPES });
  return _client;
}

async function gfetch(path, init = {}) {
  const { token } = await authClient().getAccessToken();
  if (!token) throw new Error('gcal: could not obtain access token');
  const res = await fetch(`${API_BASE}/${encodeURIComponent(CALENDAR_ID)}/events${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  return res;
}

// event_date is a SQL DATE; pg may hand back a Date or a 'YYYY-MM-DD' string.
// Normalise to YYYY-MM-DD using UTC parts so an Asia/Manila box doesn't shift
// the day. All-day Calendar events use start.date / exclusive end.date.
function ymd(d) {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function nextYmd(d) {
  const dt = new Date(`${ymd(d)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return ymd(dt);
}

function eventResource(ev) {
  const planLabel = ev.plan ? ev.plan.charAt(0).toUpperCase() + ev.plan.slice(1) : 'Tala';
  const description = [
    `Type: ${ev.event_type || 'wedding'}`,
    `Plan: ${planLabel}`,
    ev.venue      ? `Venue: ${ev.venue}`      : null,
    ev.event_time ? `Time: ${ev.event_time}`  : null,
    ev.user_email ? `Owner: ${ev.user_email}` : 'Owner: (none)',
    `Slug: ${ev.slug}`,
  ].filter(Boolean).join('\n');

  return {
    summary: ev.couple_names,
    description,
    location: ev.venue || undefined,
    start: { date: ymd(ev.event_date) },
    end:   { date: nextYmd(ev.event_date) },
    status: 'confirmed',
    transparency: 'opaque',
    source: { title: 'Reelday', url: `https://${PUBLIC_HOST}/dashboard?slug=${encodeURIComponent(ev.slug)}` },
    extendedProperties: { private: { reelday_event_id: String(ev.id) } },
  };
}

// Push one event row into the shared calendar.
//   • no event_date  → if it had a calendar entry, remove it; return null
//   • has gcal_event_id → PATCH (recreate via insert if it 404/410'd away)
//   • otherwise       → insert
// Returns the calendar event id to persist on the row, or null. Throws on
// real API failures so the backfill script can report; route hooks catch it.
export async function syncEventToGcal(ev) {
  if (!gcalConfigured() || !ev) return null;

  if (!ev.event_date) {
    if (ev.gcal_event_id) await deleteGcalEvent(ev.gcal_event_id);
    return null;
  }

  const body = JSON.stringify(eventResource(ev));

  if (ev.gcal_event_id) {
    const res = await gfetch(`/${encodeURIComponent(ev.gcal_event_id)}`, { method: 'PATCH', body });
    if (res.ok) return (await res.json()).id;
    if (res.status !== 404 && res.status !== 410) {
      throw new Error(`gcal patch ${res.status}: ${await res.text()}`);
    }
    // Entry was deleted out from under us — fall through and recreate.
  }

  const res = await gfetch('', { method: 'POST', body });
  if (!res.ok) throw new Error(`gcal insert ${res.status}: ${await res.text()}`);
  return (await res.json()).id;
}

// Best-effort delete. Missing entry (404/410) is success. Throws only on
// unexpected failures so callers can log; never blocks the DB delete.
export async function deleteGcalEvent(gcalEventId) {
  if (!gcalConfigured() || !gcalEventId) return;
  const res = await gfetch(`/${encodeURIComponent(gcalEventId)}`, { method: 'DELETE' });
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new Error(`gcal delete ${res.status}: ${await res.text()}`);
}

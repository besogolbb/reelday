import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// Load local env files if present. Root first, backend second so backend/.env
// can override defaults during local development.
const rootEnv = path.join(repoRoot, '.env');
const backendEnv = path.join(repoRoot, 'backend', '.env');
if (fs.existsSync(rootEnv))    loadEnv({ path: rootEnv });
if (fs.existsSync(backendEnv)) loadEnv({ path: backendEnv, override: true });

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help === 'true') {
  console.log(`
Usage:
  npm run launch-check -- --base http://localhost:3000 --slug your-demo-slug

Options:
  --base   Base URL to probe (defaults to APP_URL or http://localhost:<PORT>)
  --slug   Optional event slug to verify /api/events/:slug returns a sane payload
  --help   Show this help
`);
  process.exit(0);
}

const baseUrl = String(
  args.base ||
  process.env.LAUNCH_CHECK_BASE_URL ||
  process.env.APP_URL ||
  `http://localhost:${process.env.PORT || 3000}`,
).replace(/\/+$/, '');
const eventSlug = String(args.slug || process.env.LAUNCH_CHECK_SLUG || '').trim();

const checks = [];
function pass(name, detail) { checks.push({ level: 'PASS', name, detail }); }
function warn(name, detail) { checks.push({ level: 'WARN', name, detail }); }
function fail(name, detail) { checks.push({ level: 'FAIL', name, detail }); }

function isPlaceholder(value = '') {
  return !value ||
    /XXXX|change-me|user:password@localhost|localhost:5432\/reelday/i.test(value);
}

function looksLikeUrl(value = '') {
  try { new URL(value); return true; } catch { return false; }
}

async function run() {
  const requiredEnv = [
    'DATABASE_URL',
    'JWT_SECRET',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'APP_PUBLIC_HOST',
  ];
  const missing = requiredEnv.filter(k => !String(process.env[k] || '').trim());
  if (missing.length) {
    fail('Required env vars', `Missing: ${missing.join(', ')}`);
  } else {
    pass('Required env vars', 'Core backend env vars are present');
  }

  if ((process.env.JWT_SECRET || '').length < 32) {
    fail('JWT secret strength', 'JWT_SECRET is missing or shorter than 32 characters');
  } else {
    pass('JWT secret strength', 'JWT secret length looks production-safe');
  }

  if (!looksLikeUrl(process.env.R2_PUBLIC_URL || '')) {
    warn('R2 public URL', 'R2_PUBLIC_URL is missing or not a valid URL');
  } else {
    pass('R2 public URL', process.env.R2_PUBLIC_URL);
  }

  if (String(process.env.PAYMONGO_SECRET_KEY || '').startsWith('sk_test_') ||
      String(process.env.PAYMONGO_PUBLIC_KEY || '').startsWith('pk_test_')) {
    warn('PayMongo keys', 'Project appears to be using test PayMongo keys');
  } else if (process.env.PAYMONGO_SECRET_KEY && process.env.PAYMONGO_PUBLIC_KEY) {
    pass('PayMongo keys', 'PayMongo keys are present and not obviously test-mode');
  } else {
    warn('PayMongo keys', 'PayMongo keys are missing');
  }

  if (isPlaceholder(process.env.RESEND_API_KEY || '')) {
    warn('Resend email', 'RESEND_API_KEY is missing or still placeholder-like');
  } else {
    pass('Resend email', 'Resend API key is present');
  }

  if (process.env.TRANSCODE_SQS_URL) {
    const transcodeMissing = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']
      .filter(k => !String(process.env[k] || '').trim());
    if (transcodeMissing.length) {
      fail('Transcode queue config', `TRANSCODE_SQS_URL is set but missing ${transcodeMissing.join(', ')}`);
    } else {
      pass('Transcode queue config', 'SQS-backed transcode env looks complete');
    }
  } else if (process.env.TRANSCODE_LAMBDA_NAME) {
    warn('Transcode queue config', 'Using direct Lambda fallback because TRANSCODE_SQS_URL is blank');
  } else {
    warn('Transcode queue config', 'No SQS or Lambda transcode target configured');
  }

  if (process.env.GOOGLE_CALENDAR_ID) {
    const gcalMissing = ['GOOGLE_CALENDAR_SA_EMAIL', 'GOOGLE_CALENDAR_SA_PRIVATE_KEY']
      .filter(k => !String(process.env[k] || '').trim());
    if (gcalMissing.length) {
      fail('Google Calendar sync', `GOOGLE_CALENDAR_ID is set but missing ${gcalMissing.join(', ')}`);
    } else {
      pass('Google Calendar sync', 'Calendar sync env looks complete');
    }
  }

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await db.connect();
    const res = await db.query('SELECT NOW() AS now, COUNT(*)::int AS n FROM events');
    pass('Postgres connection', `Connected successfully (${res.rows[0].n} events in DB)`);
  } catch (err) {
    fail('Postgres connection', err.message || String(err));
  } finally {
    try { await db.end(); } catch {}
  }

  try {
    const started = Date.now();
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      fail('HTTP health', `${baseUrl}/api/health returned ${res.status}`);
    } else {
      const json = await res.json().catch(() => null);
      const ms = Date.now() - started;
      pass('HTTP health', `${baseUrl}/api/health ok in ${ms} ms${json?.server_ms != null ? ` (server_ms=${json.server_ms})` : ''}`);
    }
  } catch (err) {
    fail('HTTP health', err.message || String(err));
  }

  if (eventSlug) {
    try {
      const res = await fetch(`${baseUrl}/api/events/${encodeURIComponent(eventSlug)}`, {
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) {
        fail('Public event payload', `/api/events/${eventSlug} returned ${res.status}`);
      } else {
        const json = await res.json();
        const event = json?.event || {};
        if (!event.slug) {
          fail('Public event payload', 'Response missing event.slug');
        } else if ('user_id' in event) {
          fail('Public event payload', 'Public event response is leaking user_id');
        } else if (!json?.plan_info?.id) {
          warn('Public event payload', 'Event loaded, but plan_info.id is missing');
        } else {
          pass('Public event payload', `Loaded slug "${event.slug}" with plan "${json.plan_info.id}" and no user_id leak`);
        }
      }
    } catch (err) {
      fail('Public event payload', err.message || String(err));
    }
  } else {
    warn('Public event payload', 'Skipped event payload probe (pass --slug <event-slug> to enable)');
  }

  const failCount = checks.filter(c => c.level === 'FAIL').length;
  const warnCount = checks.filter(c => c.level === 'WARN').length;
  const passCount = checks.filter(c => c.level === 'PASS').length;

  console.log(`\nReelday launch check\nBase URL: ${baseUrl}${eventSlug ? `\nEvent slug: ${eventSlug}` : ''}\n`);
  for (const c of checks) {
    const icon = c.level === 'PASS' ? '[PASS]' : c.level === 'WARN' ? '[WARN]' : '[FAIL]';
    console.log(`${icon} ${c.name}`);
    console.log(`       ${c.detail}`);
  }
  console.log(`\nSummary: ${passCount} passed, ${warnCount} warnings, ${failCount} failed\n`);

  process.exit(failCount ? 1 : 0);
}

run().catch(err => {
  console.error('[FAIL] launch-check crashed');
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

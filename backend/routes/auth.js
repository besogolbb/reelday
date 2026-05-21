import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Resend } from 'resend';
import { signToken } from '../plugins/auth.js';
import { buildAppUrl } from '../utils/appUrl.js';

function resend() {
  return new Resend(process.env.RESEND_API_KEY);
}

// The Resend SDK doesn't expose AbortSignal on emails.send(), so we race
// it against a timer. If Resend hangs, registration/reset still completes;
// the email failure is caught by the caller's try/catch and logged.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )),
  ]);
}

async function sendVerifyEmail(email, fullName, token, appUrl) {
  const link = `${appUrl}/verify?token=${token}`;
  await withTimeout(resend().emails.send({
    from:    'Reelday <noreply@reelday.ph>',
    to:      email,
    subject: 'Verify your Reelday account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
        <h2 style="color:#e8735a">Welcome to Reelday, ${fullName}!</h2>
        <p>Please verify your email to get started.</p>
        <a href="${link}" style="display:inline-block;background:#e8735a;color:#fff;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;margin:1rem 0">
          Verify Email
        </a>
        <p style="font-size:.85rem;color:#888">Link expires in 24 hours. If you didn't sign up, ignore this email.</p>
      </div>`,
  }), 10_000, 'Resend (verify)');
}

async function sendWelcomeEmail(email, fullName, appUrl) {
  const firstName  = (fullName || '').split(' ')[0] || 'there';
  const dashUrl    = `${appUrl}/dashboard`;
  const pricingUrl = `${appUrl}/#pricing`;
  await withTimeout(resend().emails.send({
    from:    'Reelday <noreply@reelday.ph>',
    to:      email,
    subject: `Welcome to Reelday, ${firstName}! Here's how to get started`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:1.5rem;color:#3f2318">
        <h2 style="color:#c45a3a;margin:0 0 .75rem">Kamusta, ${firstName}! 🎉</h2>
        <p style="margin:0 0 1rem;line-height:1.6">
          Your Reelday account is ready. You're on the <strong>Tala (Free)</strong> plan —
          here's what you get:
        </p>
        <table style="border-collapse:collapse;font-size:14px;width:100%;margin-bottom:1.25rem">
          <tr style="background:#faf3ec">
            <td style="padding:9px 14px">📸</td>
            <td style="padding:9px 14px">Up to <strong>25 photos</strong> per event</td>
          </tr>
          <tr>
            <td style="padding:9px 14px">⏱️</td>
            <td style="padding:9px 14px"><strong>2-day demo window</strong> — uploads open right after you create your event</td>
          </tr>
          <tr style="background:#faf3ec">
            <td style="padding:9px 14px">📅</td>
            <td style="padding:9px 14px">Uploads <strong>reopen on your event day</strong> automatically</td>
          </tr>
          <tr>
            <td style="padding:9px 14px">🖼️</td>
            <td style="padding:9px 14px">Live photo wall your guests can watch in real time</td>
          </tr>
        </table>
        <p style="margin:0 0 1.25rem;line-height:1.6">
          Ready to try it? Create your event, grab the QR code, and share it with a few guests.
        </p>
        <a href="${dashUrl}"
           style="display:inline-block;background:#c45a3a;color:#fff;text-decoration:none;
                  padding:12px 28px;border-radius:8px;font-weight:700;font-size:15px">
          Create your event →
        </a>
        <hr style="border:none;border-top:1px solid #eadbce;margin:1.75rem 0">
        <p style="margin:0 0 .5rem;font-size:13px;color:#888">Want more for your big day?</p>
        <table style="border-collapse:collapse;font-size:13px;width:100%">
          <tr>
            <td style="padding:6px 14px 6px 0;font-weight:700;color:#c45a3a;white-space:nowrap">Sinag — ₱1,490</td>
            <td style="padding:6px 0;color:#555">Unlimited photos &amp; videos · 30-day gallery · reactions</td>
          </tr>
          <tr>
            <td style="padding:6px 14px 6px 0;font-weight:700;color:#c45a3a;white-space:nowrap">Dalisay — ₱2,990</td>
            <td style="padding:6px 0;color:#555">+ Audio notes · polls · event website · Same Day Edit reel</td>
          </tr>
        </table>
        <p style="margin:1rem 0 0;font-size:13px">
          <a href="${pricingUrl}" style="color:#c45a3a">View all plans →</a>
        </p>
      </div>`,
  }), 10_000, 'Resend (welcome)');
}

async function sendResetEmail(email, token, appUrl) {
  const link = `${appUrl}/reset-password?token=${token}`;
  await withTimeout(resend().emails.send({
    from:    'Reelday <noreply@reelday.ph>',
    to:      email,
    subject: 'Reset your Reelday password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem">
        <h2 style="color:#e8735a">Password Reset</h2>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${link}" style="display:inline-block;background:#e8735a;color:#fff;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:700;margin:1rem 0">
          Reset Password
        </a>
        <p style="font-size:.85rem;color:#888">If you didn't request this, ignore this email.</p>
      </div>`,
  }), 10_000, 'Resend (reset)');
}

export default async function authRoutes(fastify) {
  // POST /api/auth/register
  fastify.post('/auth/register', async (request, reply) => {
    const { email, password, full_name, phone } = request.body ?? {};

    if (!email || !password || !full_name) {
      return reply.status(400).send({ error: true, message: 'email, password, and full_name are required' });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: true, message: 'Password must be at least 8 characters' });
    }

    const resendKey       = process.env.RESEND_API_KEY ?? '';
    const resendReady     = resendKey.length > 10 && !resendKey.startsWith('re_XXXX');
    const autoVerify      = !resendReady;
    const password_hash   = await bcrypt.hash(password, 12);
    const verification_token = resendReady ? randomBytes(32).toString('hex') : null;

    const { rows } = await fastify.db.query(
      `INSERT INTO users (email, password_hash, full_name, phone, verification_token, is_verified)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, full_name, phone, is_verified, created_at`,
      [email.toLowerCase(), password_hash, full_name, phone ?? null, verification_token, autoVerify],
    );

    if (!rows.length) {
      return reply.status(409).send({ error: true, message: 'Email already registered' });
    }

    const user = rows[0];

    if (resendReady) {
      try {
        await sendVerifyEmail(email, full_name, verification_token, buildAppUrl(request));
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to send verification email');
      }
      // Welcome email is fire-and-forget — a delivery failure here must
      // never block registration or make the verify email look broken.
      sendWelcomeEmail(email, full_name, buildAppUrl(request)).catch(err => {
        fastify.log.warn({ err: err.message }, 'Failed to send welcome email');
      });
    } else {
      fastify.log.warn(
        { email, resendKeySet: resendKey.length > 0 },
        'RESEND_API_KEY missing or placeholder — registration emails skipped, user auto-verified',
      );
    }

    // Return a token so the client can auto-login (always safe since account is active)
    const token = signToken({ id: user.id, email: user.email, full_name: user.full_name });

    return reply.status(201).send({
      message: resendReady
        ? 'Account created! Please check your email to verify.'
        : 'Account created!',
      token,
      user,
    });
  });

  // POST /api/auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      return reply.status(400).send({ error: true, message: 'email and password are required' });
    }

    const { rows } = await fastify.db.query(
      'SELECT id, email, full_name, phone, is_verified, is_active, password_hash, subscription_tier, subscription_expires_at, tala_used FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    const user = rows[0];
    if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.status(401).send({ error: true, message: 'Invalid email or password' });
    }
    // Admin can soft-deactivate a user from /admin. Treat as account-locked.
    if (user.is_active === false) {
      return reply.status(403).send({ error: true, message: 'This account has been deactivated. Contact support.' });
    }

    const token = signToken({ id: user.id, email: user.email, full_name: user.full_name });

    return {
      token,
      user: {
        id:                     user.id,
        email:                  user.email,
        full_name:              user.full_name,
        phone:                  user.phone,
        is_verified:            user.is_verified,
        subscription_tier:      user.subscription_tier,
        subscription_expires_at: user.subscription_expires_at,
        tala_used:               user.tala_used,
      },
    };
  });

  // POST /api/auth/verify-email
  fastify.post('/auth/verify-email', async (request, reply) => {
    const { token } = request.body ?? {};
    if (!token) return reply.status(400).send({ error: true, message: 'token is required' });

    const { rows } = await fastify.db.query(
      `UPDATE users SET is_verified = true, verification_token = NULL
       WHERE verification_token = $1
       RETURNING id, email, full_name`,
      [token],
    );

    if (!rows.length) {
      return reply.status(400).send({ error: true, message: 'Invalid or expired verification token' });
    }

    const user  = rows[0];
    const jwt_token = signToken({ id: user.id, email: user.email, full_name: user.full_name });

    return { message: 'Email verified!', token: jwt_token, user };
  });

  // POST /api/auth/forgot-password
  fastify.post('/auth/forgot-password', async (request, reply) => {
    const { email } = request.body ?? {};
    if (!email) return reply.status(400).send({ error: true, message: 'email is required' });

    const { rows } = await fastify.db.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    // Always return success to avoid email enumeration
    if (rows.length) {
      const reset_token   = randomBytes(32).toString('hex');
      const expires       = new Date(Date.now() + 3600_000); // 1 hour

      await fastify.db.query(
        'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
        [reset_token, expires, rows[0].id],
      );

      const appUrl = buildAppUrl(request);

      try {
        await sendResetEmail(email, reset_token, appUrl);
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to send reset email');
      }
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  });

  // POST /api/auth/reset-password
  fastify.post('/auth/reset-password', async (request, reply) => {
    const { token, password } = request.body ?? {};
    if (!token || !password) {
      return reply.status(400).send({ error: true, message: 'token and password are required' });
    }
    if (password.length < 8) {
      return reply.status(400).send({ error: true, message: 'Password must be at least 8 characters' });
    }

    const { rows } = await fastify.db.query(
      'SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token],
    );

    if (!rows.length) {
      return reply.status(400).send({ error: true, message: 'Invalid or expired reset token' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    await fastify.db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [password_hash, rows[0].id],
    );

    return { message: 'Password updated successfully.' };
  });

  // GET /api/auth/me
  fastify.get('/auth/me', { preHandler: fastify.authenticate }, async (request) => {
    const { rows } = await fastify.db.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.is_verified, u.created_at,
              u.subscription_tier, u.subscription_expires_at, u.tala_used,
              u.sinag_credits, u.dalisay_credits, u.hiraya_credits,
              json_agg(json_build_object(
                'slug',        e.slug,
                'couple_names',e.couple_names,
                'event_type',  e.event_type,
                'event_date',  e.event_date,
                'plan',        e.plan,
                'is_paid',     e.is_paid,
                'is_active',   e.is_active,
                'created_at',  e.created_at,
                'gallery_expires_at', e.gallery_expires_at,
                'archived_at',        e.archived_at,
                'upload_count', (
                  SELECT COUNT(*) FROM uploads up
                   WHERE up.event_id = e.id AND up.is_approved = true
                )
              ) ORDER BY e.created_at DESC)
              FILTER (WHERE e.id IS NOT NULL) AS events
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [request.user.id],
    );

    if (!rows.length) return { user: null, events: [] };
    const { events, ...user } = rows[0];
    return { user, events: events ?? [] };
  });

  // GET /api/auth/config — public client config for frontend
  fastify.get('/auth/config', async () => ({
    google_client_id: process.env.GOOGLE_CLIENT_ID ?? null,
  }));

  // POST /api/auth/google — verify Google ID token, sign in or register
  fastify.post('/auth/google', async (request, reply) => {
    const { credential } = request.body ?? {};
    if (!credential) {
      return reply.status(400).send({ error: true, message: 'credential is required' });
    }

    // 10s ceiling — Google's tokeninfo endpoint is normally sub-200ms,
    // but a hung socket would otherwise pin the request thread indefinitely.
    let googleRes;
    try {
      googleRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
    } catch (err) {
      fastify.log.warn({ err: err.message }, 'Google tokeninfo unreachable');
      return reply.status(503).send({ error: true, message: 'Google sign-in temporarily unavailable. Please try again.' });
    }
    if (!googleRes.ok) {
      return reply.status(401).send({ error: true, message: 'Invalid Google token' });
    }

    const payload = await googleRes.json();

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && payload.aud !== clientId) {
      return reply.status(401).send({ error: true, message: 'Token audience mismatch' });
    }

    const { sub: google_id, email, name } = payload;
    if (!email) {
      return reply.status(400).send({ error: true, message: 'Google account has no email' });
    }

    // Find existing user by google_id or email, then upsert
    const { rows } = await fastify.db.query(
      `INSERT INTO users (email, full_name, google_id, is_verified)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (email) DO UPDATE
         SET google_id   = COALESCE(users.google_id, EXCLUDED.google_id),
             is_verified = true,
             full_name   = COALESCE(users.full_name, EXCLUDED.full_name)
       RETURNING id, email, full_name, subscription_tier, subscription_expires_at, tala_used`,
      [email.toLowerCase(), name ?? email, google_id],
    );

    const user  = rows[0];
    const token = signToken({ id: user.id, email: user.email, full_name: user.full_name });

    return { token, user };
  });
}

import { Resend } from 'resend';

function resend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    )),
  ]);
}

export default async function contactRoutes(fastify) {
  // POST /api/contact — forwards a customer inquiry to admin@reelday.ph
  fastify.post('/contact', {
    config: {
      rateLimit: { max: 5, timeWindow: '10 minutes', keyGenerator: req => req.ip },
    },
  }, async (request, reply) => {
    const { name, email, subject, message } = request.body ?? {};

    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return reply.status(400).send({ error: true, message: 'Name, email, and message are required.' });
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRe.test(email)) {
      return reply.status(400).send({ error: true, message: 'Please enter a valid email address.' });
    }

    const resendKey = process.env.RESEND_API_KEY ?? '';
    if (!resendKey || resendKey.length <= 10 || resendKey.startsWith('re_XXXX')) {
      fastify.log.warn({ email, name }, 'Contact form submitted but RESEND_API_KEY not set — skipping email');
      return { success: true };
    }

    const safeSubject = (subject ?? 'General inquiry').slice(0, 100);
    const safeName    = name.slice(0, 100);
    const safeEmail   = email.slice(0, 200);
    const safeMsg     = message.slice(0, 5000);

    try {
      await withTimeout(
        resend().emails.send({
          from:     'Reelday Contact <noreply@reelday.ph>',
          to:       'admin@reelday.ph',
          reply_to: safeEmail,
          subject:  `[Contact] ${safeSubject} — from ${safeName}`,
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:2rem">
              <h2 style="color:#e8735a;margin-bottom:.5rem">New contact form submission</h2>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:1.5rem">
                <tr><td style="padding:6px 0;color:#888;width:80px">Name</td><td style="padding:6px 0;font-weight:600">${safeName}</td></tr>
                <tr><td style="padding:6px 0;color:#888">Email</td><td style="padding:6px 0"><a href="mailto:${safeEmail}">${safeEmail}</a></td></tr>
                <tr><td style="padding:6px 0;color:#888">Subject</td><td style="padding:6px 0">${safeSubject}</td></tr>
              </table>
              <div style="background:#f9f6f2;border-radius:8px;padding:1rem 1.25rem;font-size:14px;white-space:pre-wrap;line-height:1.6">${safeMsg}</div>
              <p style="font-size:12px;color:#aaa;margin-top:1.5rem">Sent via reelday.ph/contact</p>
            </div>`,
        }),
        10_000,
        'Resend (contact)',
      );
    } catch (err) {
      fastify.log.error({ err }, 'Failed to send contact email');
      return reply.status(500).send({ error: true, message: 'Failed to send message. Please try again or email us directly.' });
    }

    return { success: true };
  });
}

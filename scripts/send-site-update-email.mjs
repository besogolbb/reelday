#!/usr/bin/env node
/**
 * One-off: tell an event-website owner their site was upgraded.
 *
 * Runs ON THE SERVER (Easypanel > app > Console), where DATABASE_URL and
 * RESEND_API_KEY already exist. Looks up the owner of /e/<slug>, prints
 * exactly who would get what, and only sends with --send.
 *
 *   node scripts/send-site-update-email.mjs eds-yham          # preview only
 *   node scripts/send-site-update-email.mjs eds-yham --send   # actually send
 *   ... --html-out mail.html   also save the email HTML to a file
 *   ... --demo                 sample owner data, no database (design check; never sends)
 *
 * From noreply@reelday.ph, with Reply-To admin@reelday.ph so the host can
 * simply reply with questions.
 */
import pg from 'pg';
import { Resend } from 'resend';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const slug = args[0];
const DEMO = args.includes('--demo');
const SEND = args.includes('--send') && !DEMO;
const outIdx = args.indexOf('--html-out');
const HTML_OUT = outIdx >= 0 ? args[outIdx + 1] : null;
if (!slug || slug.startsWith('--')) {
  console.error('usage: node scripts/send-site-update-email.mjs <slug> [--send] [--html-out file] [--demo]');
  process.exit(2);
}
if (!DEMO && !process.env.DATABASE_URL) { console.error('DATABASE_URL is not set (run this on the server)'); process.exit(2); }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ev;
if (DEMO) {
  ev = { slug, couple_names: 'Eds & Yham', event_type: 'wedding', email: 'owner@example.com', full_name: 'Yham Sample', is_published: true };
} else {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `SELECT e.slug, e.couple_names, e.event_type, u.email, u.full_name,
            COALESCE(s.is_published, false) AS is_published
       FROM events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN event_sites s ON s.event_id = e.id
      WHERE e.slug = $1`,
    [slug],
  );
  await pool.end();
  if (!rows.length) { console.error(`No event with slug "${slug}"`); process.exit(1); }
  ev = rows[0];
}
if (!ev.email) { console.error('Event owner has no email on file'); process.exit(1); }

const first = (ev.full_name || '').trim().split(/\s+/)[0] || 'there';
const couple = ev.couple_names || 'your event';
const siteUrl = `https://reelday.ph/e/${encodeURIComponent(ev.slug)}`;
const editUrl = `https://reelday.ph/website-builder?event=${encodeURIComponent(ev.slug)}`;
// Same 1200x630 card Facebook shows: their cover photo cropped to their
// faces, or the site style's invitation card when there's no cover.
const previewImg = `https://reelday.ph/api/event-site/${encodeURIComponent(ev.slug)}/preview.jpg`;
const kind = ev.event_type === 'wedding' ? 'wedding website' : 'event website';
const subject = `Your ${kind} just got an upgrade`;

const points = [
  ['Your photo, front and centre', 'Your names and details now sit below your faces, readable on any photo, on phones and computers.'],
  ['Your story, beautifully laid out', 'On computers your story now reads like a magazine page, with your photo beside it.'],
  ['Easier RSVP for your guests', 'Clear labels on every field and bigger text, easy for titas and lolas too.'],
  ['Better previews on Facebook', 'When you share your link in a Facebook post, it shows your photo, names, date and venue.'],
];

const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#3f2318;line-height:1.6;background:#ffffff">
  <p style="margin:0 0 14px">Hi ${esc(first)},</p>
  <p style="margin:0 0 18px">We've been improving Reelday's event websites, and your invitation for
    <strong>${esc(couple)}</strong> got every upgrade automatically. There's nothing you need to do.</p>
  <a href="${siteUrl}" style="display:block;text-decoration:none;color:inherit;border:1px solid #eadbce;border-radius:12px;overflow:hidden;margin:0 0 22px">
    <img src="${previewImg}" width="512" alt="${esc(couple)}: your event website" style="display:block;width:100%;height:auto;border:0">
    <div style="padding:12px 16px;background:#faf3ec">
      <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a6d5f">Your event website</div>
      <div style="font-size:15px;font-weight:bold;color:#3f2318;word-break:break-all">${esc(siteUrl.replace('https://', ''))}</div>
    </div>
  </a>
  <p style="margin:0 0 10px;font-weight:bold">What's new on your website</p>
  <table style="border-collapse:collapse;width:100%;margin:0 0 18px">
    ${points.map(([t, d], i) => `<tr style="background:${i % 2 ? '#fff' : '#faf3ec'}">
      <td style="padding:10px 14px;vertical-align:top;color:#b85230;font-weight:bold">&#10003;</td>
      <td style="padding:10px 14px"><strong>${esc(t)}</strong><br><span style="color:#5a443a">${esc(d)}</span></td></tr>`).join('')}
  </table>
  <p style="margin:0 0 20px"><strong>New:</strong> you can now add your entourage (Principal Sponsors,
    Best Man, Maid of Honor and the rest) right in the editor.</p>
  <p style="margin:0 0 12px">
    <a href="${siteUrl}" style="display:inline-block;background:#b85230;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:bold">See your website</a>
  </p>
  <p style="margin:0 0 22px;font-size:14px"><a href="${editUrl}" style="color:#b85230">Edit your website</a></p>
  <p style="margin:0 0 4px">Questions or ideas? Just reply to this email.</p>
  <p style="margin:0">Reelday Admin</p>
</div>`;

const text = [
  `Hi ${first},`, '',
  `We've been improving Reelday's event websites, and your invitation for ${couple} got every upgrade automatically. There's nothing you need to do.`, '',
  `Your event website: ${siteUrl}`, '',
  "What's new on your website:",
  ...points.map(([t, d]) => `- ${t}: ${d}`), '',
  'New: you can now add your entourage (Principal Sponsors, Best Man, Maid of Honor and the rest) right in the editor.', '',
  `See your website: ${siteUrl}`,
  `Edit your website: ${editUrl}`, '',
  'Questions or ideas? Just reply to this email.', '',
  'Reelday Admin',
].join('\n');

console.log(`To:       ${ev.full_name || '(no name)'} <${ev.email}>`);
console.log(`Event:    ${couple} (${ev.slug})${ev.is_published ? '' : '  [WARNING: site is NOT published]'}`);
console.log(`Subject:  ${subject}`);
console.log(`Reply-To: admin@reelday.ph`);
console.log('');
console.log(text);

if (HTML_OUT) {
  writeFileSync(HTML_OUT, `<!doctype html><meta charset="utf-8"><title>${esc(subject)}</title><body style="margin:0;padding:20px 0;background:#f1ebe4">${html}</body>`);
  console.log('');
  console.log(`HTML saved to ${HTML_OUT}`);
}
if (!SEND) {
  console.log('');
  console.log(DEMO ? 'Demo preview. Nothing was sent.' : 'Preview only. Nothing was sent. Re-run with --send to send it.');
  process.exit(0);
}
if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY is not set'); process.exit(2); }
const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
  from: 'Reelday <noreply@reelday.ph>',
  replyTo: 'admin@reelday.ph',
  to: ev.email,
  subject,
  html,
  text,
});
if (error) { console.error('Send failed:', error); process.exit(1); }
console.log('');
console.log(`Sent. Resend id: ${data?.id}`);

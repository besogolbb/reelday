// PayMongo (and any external redirect target) needs an ABSOLUTE URL —
// scheme + host. A bare hostname like "localhost:3000" or a path like
// "/" gets treated relative to the third party's own domain on
// redirect, which is what caused the 404 at checkout.paymongo.com/9/...
// after "Return to merchant".
function isAbsoluteHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

export function buildAppUrl(request) {
  const envUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (isAbsoluteHttpUrl(envUrl)) return envUrl;

  // Fall back to the inbound request's own headers.
  const proto = (request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host  = (request.headers['x-forwarded-host'] || request.headers.host || 'reelday.ph').split(',')[0].trim();
  const inferred = `${proto}://${host}`;
  if (isAbsoluteHttpUrl(inferred)) return inferred.replace(/\/+$/, '');

  // Last-resort default — should never be hit but keeps callers honest.
  return 'https://reelday.ph';
}

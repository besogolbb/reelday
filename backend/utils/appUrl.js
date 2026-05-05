export function buildAppUrl(request) {
  const proto = (request.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host  = (request.headers['x-forwarded-host'] || request.headers.host || 'reelday.ph').split(',')[0].trim();
  return (process.env.APP_URL || `${proto}://${host}`).replace(/\/+$/, '');
}

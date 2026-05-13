import QRCode from 'qrcode';

export async function generateQR(target) {
  // Callers pass a fully-built upload URL (built from the inbound
  // request's protocol + host so the QR points at whatever public
  // origin the dashboard is being served from). Earlier this function
  // prepended APP_URL + '/upload/' itself, which doubled the URL when
  // the caller had already done that — encoding garbage like
  //   https://reelday.ph/upload/https://reelday.ph/upload/<slug>
  // into the QR. Treat the argument as the literal QR payload.
  const url = String(target || '').trim();
  if (!url) throw new Error('generateQR: empty target URL');

  const dataUrl = await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 512,
    color: {
      dark:  '#1a1a2e',
      light: '#ffffff',
    },
  });

  return dataUrl;
}

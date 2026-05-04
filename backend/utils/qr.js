import QRCode from 'qrcode';

export async function generateQR(slug) {
  const url = `${process.env.APP_URL}/upload/${slug}`;

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

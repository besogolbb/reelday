/**
 * Tiny HTTP server that serves pre-extracted video frame JPEGs to Chromium
 * during Remotion rendering. Lives only for the duration of one render.
 *
 * Why local HTTP instead of file://: Chromium's headless mode is finicky
 * about file:// in iframes/serveUrl contexts. HTTP works everywhere.
 */
import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, normalize } from 'path';

export function startFrameServer(rootDir, port = 3500) {
  const server = createServer(async (req, res) => {
    try {
      // Strip query string + normalize path; refuse traversal.
      const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const safePath = normalize(reqPath).replace(/^([\/\\])+/, '');
      if (safePath.includes('..')) {
        res.statusCode = 400;
        return res.end('bad path');
      }
      const filePath = join(rootDir, safePath);
      const st = await stat(filePath);
      if (!st.isFile()) {
        res.statusCode = 404;
        return res.end('not found');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', st.size);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');
      createReadStream(filePath).pipe(res);
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

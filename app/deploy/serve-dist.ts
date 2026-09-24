/**
 * Serves app/dist exactly like the production hosts: the headers of deploy/hosting.ts (CSP, caching, content types)
 * and the SPA fallback. Used by the e2e run (so the whole walk runs under the production CSP) and to check a build:
 *
 *   npm run build && npm run serve-dist -w app          http://localhost:4173
 *
 * PORT sets the port. With SERVE_TEST_HOOKS=1, `POST /__test/bump-sw` makes /sw.js byte-different (a comment is
 * appended), so the browser sees "a new version" (e2e test of the update toast).
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, NO_CACHE } from './hosting';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const HOOKS = process.env.SERVE_TEST_HOOKS === '1';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

/** Paths that are real files or a 404, never the SPA fallback (as the Vercel rewrite excludes them). */
const NO_FALLBACK = ['/assets/', '/icons/', '/templates/'];

let swBump = 0;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('serve-dist: app/dist missing, run `npm run build` first');
  process.exit(1);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (HOOKS && req.method === 'POST' && path === '/__test/bump-sw') {
      swBump++;
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`sw bump ${swBump}`);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (path === '/') path = '/index.html';
    const file = normalize(join(DIST, path));
    if (!file.startsWith(DIST + sep)) {
      res.writeHead(400).end();
      return;
    }
    const isFile = existsSync(file) && statSync(file).isFile();
    if (!isFile) {
      if (NO_FALLBACK.some((p) => path.startsWith(p)) || extname(path) === '.js') {
        res.writeHead(404, { ...headersFor(url.pathname), 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }
      // SPA fallback (_redirects "/* /index.html 200")
      res.writeHead(200, {
        'Content-Type': TYPES['.html'],
        'Cache-Control': NO_CACHE,
        ...headersFor(url.pathname),
      });
      if (req.method === 'HEAD') res.end();
      else createReadStream(join(DIST, 'index.html')).pipe(res);
      return;
    }
    const headers: Record<string, string> = {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      ...headersFor(path === '/index.html' && url.pathname === '/' ? '/' : path),
    };
    if (path === '/sw.js' && swBump > 0) {
      const body = Buffer.concat([await readFile(file), Buffer.from(`\n// test build ${swBump}\n`)]);
      res.writeHead(200, { ...headers, 'Content-Length': String(body.length) });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(statSync(file).size) });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  })().catch((e: unknown) => {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e));
  });
});

server.listen(PORT, () => console.log(`serve-dist: http://localhost:${PORT} (app/dist with the production headers)`));

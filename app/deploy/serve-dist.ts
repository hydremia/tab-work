/**
 * Serves app/dist exactly like the production hosts: the headers of deploy/hosting.ts (CSP, caching, content types)
 * and the SPA fallback. Used by the e2e run (so the whole walk runs under the production CSP) and to check a build:
 *
 *   npm run build && npm run serve-dist -w app          http://localhost:4173
 *
 * PORT sets the port; it listens on 127.0.0.1 only unless SERVE_HOST says otherwise (SERVE_HOST=0.0.0.0 for a phone on the
 * same network; the fake sync server has no real authentication, so never expose it). With SERVE_TEST_HOOKS=1, `POST /__test/bump-sw` makes /sw.js byte-different (a comment is
 * appended), so the browser sees "a new version" (e2e test of the update toast).
 *
 * Two-device sync e2e: DIST_DIR=dist-fake (a build with VITE_FAKE_SYNC=1) and SERVE_FAKE_SYNC=1 serve the in-memory
 * fake sync server (src/sync/fakeServer.ts, the rules of supabase/migrations/0003) under /__fake-sync/, same origin, for
 * src/sync/fakeHttp.ts. Test-only: never on a real host.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, NO_CACHE } from './hosting';
import { FakeServerError, FakeSyncServer } from '../src/sync/fakeServer';
import type { FieldChangeRow } from '../src/sync/backend';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', process.env.DIST_DIR ?? 'dist');
const PORT = Number(process.env.PORT ?? 4173);
/** Loopback only by default (a test server, never meant for the network); SERVE_HOST=0.0.0.0 to reach it from a phone. */
const HOST = process.env.SERVE_HOST ?? '127.0.0.1';
const HOOKS = process.env.SERVE_TEST_HOOKS === '1';
const FAKE_SYNC = process.env.SERVE_FAKE_SYNC === '1' ? new FakeSyncServer() : null;

async function body(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** /__fake-sync/*: the fake server's calls as JSON (errors in PostgREST's shape). */
async function fakeSync(
  sync: FakeSyncServer,
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  url: URL,
): Promise<void> {
  const json = (status: number, v: unknown) =>
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(v));
  const route = url.pathname.slice('/__fake-sync'.length);
  try {
    if (route === '/signin' && req.method === 'POST') {
      const { email } = JSON.parse((await body(req)).toString()) as { email: string };
      const u = sync.userByEmail(email) ?? sync.addUser(email);
      json(200, { id: u.id, email: u.email, name: email.split('@')[0] });
      return;
    }
    const userId = String(req.headers['x-fake-user'] ?? '');
    if (route === '/time') {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end(String(sync.serverTime()));
    } else if (route === '/push' && req.method === 'POST') {
      json(200, sync.push(userId, JSON.parse((await body(req)).toString()) as FieldChangeRow[]));
    } else if (route === '/pull') {
      json(
        200,
        sync.pull(userId, Number(url.searchParams.get('after') ?? 0), Number(url.searchParams.get('limit') ?? 500)),
      );
    } else if (route === '/photo') {
      const path = url.searchParams.get('path') ?? '';
      if (req.method === 'PUT') {
        const type = String(req.headers['content-type'] ?? 'application/octet-stream');
        sync.upload(userId, path, new Blob([await body(req)], { type }), type);
        json(200, {});
      } else if (req.method === 'DELETE') {
        sync.remove(userId, path);
        json(200, {});
      } else {
        const b = sync.download(userId, path);
        if (!b) json(404, { message: 'Object not found' });
        else res.writeHead(200, { 'Content-Type': b.type || 'image/jpeg' }).end(Buffer.from(await b.arrayBuffer()));
      }
    } else json(404, { message: 'no such fake-sync route' });
  } catch (e) {
    const err = e as FakeServerError;
    json(err instanceof FakeServerError && err.code === 'PGRST301' ? 401 : 400, {
      message: err.message,
      code: err.code ?? null,
      details: err.details ?? null,
      hint: err.hint ?? null,
    });
  }
}

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
    if (FAKE_SYNC && path.startsWith('/__fake-sync/')) {
      await fakeSync(FAKE_SYNC, req, res, url);
      return;
    }
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

server.listen(PORT, HOST, () =>
  console.log(
    `serve-dist: http://${HOST}:${PORT} (app/${process.env.DIST_DIR ?? 'dist'} with the production headers${FAKE_SYNC ? ', fake sync server' : ''})`,
  ),
);

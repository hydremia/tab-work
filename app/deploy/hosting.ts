/**
 * One definition of the static-hosting rules for the built PWA (app/dist): security headers, caching, content types
 * and the SPA fallback. `npm run hosting-config -w app` writes them out for every supported host:
 *
 *   vercel.json               (repository root; Vercel, the primary host)
 *   app/public/_headers       (Netlify and Cloudflare Pages read it from the published folder)
 *   app/public/_redirects     (idem: SPA fallback)
 *   netlify.toml              (repository root; build settings only, the rules come from _headers / _redirects)
 *
 * `deploy/serve-dist.ts` serves app/dist locally with exactly these rules (the e2e runs against it), and
 * `deploy/hosting.test.ts` fails when a written file is out of date.
 *
 * Content-Security-Policy, what the app needs and why:
 * - script-src 'self': Vite emits module scripts only (no inline script); the service worker and workbox are files.
 * - style-src 'self': one stylesheet; React sets `style` props through the CSSOM, which CSP does not restrict.
 * - img-src 'self' blob: data:: photo thumbnails / viewer are blob: URLs; data: for small inline images.
 * - connect-src 'self' + Supabase (REST / auth / storage over https, realtime over wss). The committed files allow
 *   any *.supabase.co project; `VITE_SUPABASE_URL=https://<ref>.supabase.co npm run hosting-config -w app` narrows
 *   it to one project. blob: / data: are for reading photos and generated files back (fetch of an object URL).
 * - worker-src 'self' (service worker); manifest-src 'self'; font-src 'self' (no web fonts are used).
 * - object-src 'none', base-uri 'self', form-action 'self', frame-ancestors 'none' (no framing: clickjacking).
 * Downloads use <a download> with blob: URLs, which CSP does not restrict. Sign in with Microsoft is a top-level
 * redirect to Supabase / Microsoft, not a fetch, so it needs no CSP entry.
 */

export const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export function supabaseOrigins(url = process.env.VITE_SUPABASE_URL): string[] {
  if (url) {
    const u = new URL(url);
    return [u.origin, `wss://${u.host}`];
  }
  return ['https://*.supabase.co', 'wss://*.supabase.co'];
}

export function contentSecurityPolicy(supabase = supabaseOrigins()): string {
  const d: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'"]],
    ['img-src', ["'self'", 'blob:', 'data:']],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", 'blob:', 'data:', ...supabase]],
    ['media-src', ["'self'", 'blob:']],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return d.map(([k, v]) => [k, ...v].join(' ')).join('; ');
}

/** Headers on every response. */
export function securityHeaders(supabase = supabaseOrigins()): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy(supabase),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // camera for photo capture (the file input's capture mode on some browsers); nothing else is used
    // (only features every current browser knows: unknown ones are logged as console errors)
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  };
}

export const NO_CACHE = 'public, max-age=0, must-revalidate';
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const ONE_DAY = 'public, max-age=86400';

export interface PathRule {
  /** Path pattern in _headers syntax: exact path, or a prefix ending in "/*". */
  path: string;
  headers: Record<string, string>;
}

/**
 * Per-path rules (on top of the security headers). Hashed build output is immutable; everything that decides which
 * version runs (index.html, the service worker, the manifest, the template, which has no hash in its name) is
 * revalidated on every request. The service worker precaches the template with its own revision hash anyway.
 */
export const PATH_RULES: PathRule[] = [
  { path: '/', headers: { 'Cache-Control': NO_CACHE } },
  { path: '/index.html', headers: { 'Cache-Control': NO_CACHE } },
  { path: '/sw.js', headers: { 'Cache-Control': NO_CACHE } },
  { path: '/workbox-*', headers: { 'Cache-Control': NO_CACHE } },
  {
    path: '/manifest.webmanifest',
    headers: { 'Cache-Control': NO_CACHE, 'Content-Type': 'application/manifest+json' },
  },
  { path: '/assets/*', headers: { 'Cache-Control': IMMUTABLE } },
  {
    path: '/templates/*',
    headers: {
      'Cache-Control': NO_CACHE,
      'Content-Type': XLSM_MIME,
      'Content-Disposition': 'attachment; filename="a2b TAB template rev05.xlsm"',
    },
  },
  { path: '/icons/*', headers: { 'Cache-Control': ONE_DAY } },
  { path: '/favicon.svg', headers: { 'Cache-Control': ONE_DAY } },
  { path: '/favicon.ico', headers: { 'Cache-Control': ONE_DAY } },
];

/** Whether a request path matches a rule path (exact, "/dir/*" prefix, or "/name-*" prefix). */
export function matchesRule(rulePath: string, path: string): boolean {
  if (rulePath.endsWith('*')) return path.startsWith(rulePath.slice(0, -1));
  return path === rulePath;
}

/** All headers for a path: security headers, then every matching rule in order (later rules win). */
export function headersFor(path: string, supabase = supabaseOrigins()): Record<string, string> {
  const out = { ...securityHeaders(supabase) };
  for (const r of PATH_RULES) if (matchesRule(r.path, path)) Object.assign(out, r.headers);
  return out;
}

const GENERATED = 'Generated by `npm run hosting-config -w app` from app/deploy/hosting.ts. Do not edit by hand.';

/** Netlify / Cloudflare Pages `_headers`. */
export function headersFile(supabase = supabaseOrigins()): string {
  const lines = [`# ${GENERATED}`, '/*'];
  for (const [k, v] of Object.entries(securityHeaders(supabase))) lines.push(`  ${k}: ${v}`);
  for (const r of PATH_RULES) {
    lines.push('', r.path);
    for (const [k, v] of Object.entries(r.headers)) lines.push(`  ${k}: ${v}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Netlify / Cloudflare Pages `_redirects`: SPA fallback (existing files are served first). */
export function redirectsFile(): string {
  return `# ${GENERATED}\n# SPA fallback: every route that is not a file serves index.html (200, not a redirect).\n/*    /index.html   200\n`;
}

/** Vercel `source` pattern (path-to-regexp) for a rule path. */
function vercelSource(p: string): string {
  if (p.endsWith('/*')) return `${p.slice(0, -2)}/(.*)`;
  if (p.endsWith('*')) return `${p.slice(0, -1)}(.*)`;
  return p;
}

/** vercel.json at the repository root (npm workspaces: install and build from the root). */
export function vercelJson(supabase = supabaseOrigins()): string {
  const config = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    installCommand: 'npm ci',
    buildCommand: 'npm run build',
    outputDirectory: 'app/dist',
    cleanUrls: false,
    trailingSlash: false,
    // Vercel serves existing files first, so this only catches app routes (/p/…, /new, /import)
    rewrites: [{ source: '/((?!assets/|icons/|templates/).*)', destination: '/index.html' }],
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(securityHeaders(supabase)).map(([key, value]) => ({ key, value })),
      },
      ...PATH_RULES.map((r) => ({
        source: vercelSource(r.path),
        headers: Object.entries(r.headers).map(([key, value]) => ({ key, value })),
      })),
    ],
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** netlify.toml at the repository root: build settings; headers and redirects come from _headers / _redirects. */
export function netlifyToml(): string {
  return `# ${GENERATED}
# Headers and the SPA fallback are in app/public/_headers and app/public/_redirects (copied into app/dist by the
# build); Netlify reads them from the publish folder, the same files Cloudflare Pages uses.

[build]
  base = "."
  command = "npm run build"
  publish = "app/dist"

[build.environment]
  NODE_VERSION = "22"
  # npm workspaces: install from the repository root (package-lock.json)
  NPM_FLAGS = "--no-audit --no-fund"
`;
}

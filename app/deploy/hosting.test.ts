import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hostingFiles } from './files';
import { contentSecurityPolicy, headersFor, IMMUTABLE, NO_CACHE, XLSM_MIME } from './hosting';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('hosting config', () => {
  it('committed files are up to date (npm run hosting-config -w app)', () => {
    const saved = process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    try {
      for (const [rel, text] of Object.entries(hostingFiles()))
        expect(readFileSync(join(root, rel), 'utf8'), rel).toBe(text);
    } finally {
      if (saved !== undefined) process.env.VITE_SUPABASE_URL = saved;
    }
  });

  it('caching: service worker / index / manifest revalidate, hashed assets immutable, template typed', () => {
    for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/workbox-2fbc6a65.js'])
      expect(headersFor(p)['Cache-Control'], p).toBe(NO_CACHE);
    expect(headersFor('/assets/index-abc123.js')['Cache-Control']).toBe(IMMUTABLE);
    const t = headersFor('/templates/tab-template-rev05.xlsm');
    expect(t['Content-Type']).toBe(XLSM_MIME);
    expect(t['Cache-Control']).toBe(NO_CACHE);
    expect(headersFor('/p/123/equipment')['Cache-Control']).toBeUndefined();
  });

  it('CSP: no inline script, no framing, blob/data images, Supabase connect-src (wildcard or one project)', () => {
    const csp = contentSecurityPolicy();
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' blob: data:");
    expect(csp).toContain('https://*.supabase.co wss://*.supabase.co');
    const one = contentSecurityPolicy(['https://abc.supabase.co', 'wss://abc.supabase.co']);
    expect(one).toContain("connect-src 'self' blob: data: https://abc.supabase.co wss://abc.supabase.co;");
    const h = headersFor('/');
    expect(h['Permissions-Policy']).toContain('camera=(self)');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });
});

/// <reference types="vitest/config" />
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { cspMetaTag, headersFile, supabaseOrigins } from './deploy/hosting';

/**
 * Pins the CSP's connect-src to the configured Supabase project at build time (deploy/hosting.ts cspMetaTag): a
 * <meta> policy in index.html and a dist/_headers with the project's origins. Without VITE_SUPABASE_URL (local mode)
 * nothing changes and the headers' *.supabase.co fallback applies.
 */
function pinCsp(): Plugin {
  let url = '';
  let outDir = 'dist';
  return {
    name: 'a2b-pin-csp',
    apply: 'build',
    configResolved(c) {
      url = String(c.env.VITE_SUPABASE_URL ?? '').trim();
      outDir = resolve(c.root, c.build.outDir);
    },
    transformIndexHtml(html) {
      if (!url) return html;
      return html.replace('<head>', `<head>\n    ${cspMetaTag(supabaseOrigins(url))}`);
    },
    closeBundle() {
      if (url) writeFileSync(join(outDir, '_headers'), headersFile(supabaseOrigins(url)));
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    pinCsp(),
    VitePWA({
      // "prompt": a new version waits until the user taps "Reload" in the update toast (src/pwa.ts), so an update
      // never reloads the page while someone is typing
      registerType: 'prompt',
      injectRegister: false, // registered from src/pwa.ts (virtual:pwa-register)
      // icons and favicons are precached by globPatterns below (includeAssets would list them twice)
      manifest: {
        id: '/',
        name: 'a2b TAB',
        short_name: 'TAB',
        description:
          'a2b accurate air balancing: HVAC test, adjust and balance field data entry. Works offline; exports the TAB workbook and photo / issues reports.',
        lang: 'en-US',
        dir: 'ltr',
        theme_color: '#0f4c81',
        background_color: '#f3f5f8',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // app shell + the workbook template, so export works offline
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}', 'templates/*.xlsm'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // the first install takes control right away (offline from the first visit); later versions wait for the
        // update toast (skipWaiting on request)
        clientsClaim: true,
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 600 },
  server: { port: 5173 },
  preview: { port: 4173 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 30000,
  },
});

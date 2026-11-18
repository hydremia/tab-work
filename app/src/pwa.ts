import { registerSW } from 'virtual:pwa-register';
import { prefetchOcr } from './ocrPrefetch';
import { captureInstallPrompt, markInstalled, setUpdateAvailable, setUpdateChecker } from './pwaState';

/** How often a long-running app (left open all day on a laptop) checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Service worker (offline app shell + template), update prompt, install prompt and persistent storage (iOS eviction).
 *
 * Updates: registerType "prompt" (vite.config.ts). A new version is downloaded in the background and waits; the app
 * shows "Update available — Reload" and activates it only when the user taps Reload (so a half-typed value is never
 * lost to a surprise reload). If the user never taps it, the new version starts the next time the app is opened
 * after all its windows were closed. The worker script is always fetched from the server on an update check
 * (updateViaCache 'none'), so a cached copy on a phone cannot hide a new version.
 */
export function registerPwa(): void {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', markInstalled);
  if ('serviceWorker' in navigator) {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateAvailable(() => updateSW(true)),
      onRegisteredSW: (url, registration) => {
        if (!registration) return;
        // Update checks must fetch sw.js from the server, never from the browser's HTTP cache: a phone held an old
        // worker for a whole evening and every check found "the latest" until the worker was unregistered by hand.
        // Registering the same script again only changes the registration's update-via-cache mode (and runs a check).
        void navigator.serviceWorker
          .register(url, { scope: registration.scope, updateViaCache: 'none' })
          .catch(() => undefined);
        setUpdateChecker(async () => {
          if (registration.waiting) return true;
          await registration.update();
          const w = registration.installing;
          if (w)
            await new Promise<void>((done) => {
              const t = setTimeout(done, 30_000);
              w.addEventListener('statechange', () => {
                if (w.state === 'installed' || w.state === 'redundant') {
                  clearTimeout(t);
                  done();
                }
              });
            });
          if (registration.waiting) return true;
          // still downloading after the wait (a slow connection): say so, not "the latest"
          return registration.installing ? 'installing' : false;
        });
        setInterval(() => {
          if (navigator.onLine && !registration.installing) void registration.update().catch(() => undefined);
        }, UPDATE_CHECK_MS);
        prefetchOcr();
      },
    });
  }
  if (navigator.storage?.persist) {
    void navigator.storage.persisted().then((p) => (p ? undefined : navigator.storage.persist()));
  }
}

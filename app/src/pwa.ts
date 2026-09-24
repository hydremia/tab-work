import { registerSW } from 'virtual:pwa-register';
import { captureInstallPrompt, markInstalled, setUpdateAvailable } from './pwaState';

/** How often a long-running app (left open all day on a laptop) checks for a new version. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Service worker (offline app shell + template), update prompt, install prompt and persistent storage (iOS eviction).
 *
 * Updates: registerType "prompt" (vite.config.ts). A new version is downloaded in the background and waits; the app
 * shows "Update available — Reload" and activates it only when the user taps Reload (so a half-typed value is never
 * lost to a surprise reload). If the user never taps it, the new version starts the next time the app is opened
 * after all its windows were closed.
 */
export function registerPwa(): void {
  window.addEventListener('beforeinstallprompt', captureInstallPrompt);
  window.addEventListener('appinstalled', markInstalled);
  if ('serviceWorker' in navigator) {
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => setUpdateAvailable(() => updateSW(true)),
      onRegisteredSW: (_url, registration) => {
        if (!registration) return;
        setInterval(() => {
          if (navigator.onLine && !registration.installing) void registration.update().catch(() => undefined);
        }, UPDATE_CHECK_MS);
      },
    });
  }
  if (navigator.storage?.persist) {
    void navigator.storage.persisted().then((p) => (p ? undefined : navigator.storage.persist()));
  }
}

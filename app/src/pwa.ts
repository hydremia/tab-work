import { registerSW } from 'virtual:pwa-register';

/** Service worker (offline app shell + template, auto-update) and persistent storage (iOS eviction). */
export function registerPwa(): void {
  if ('serviceWorker' in navigator) registerSW({ immediate: true });
  if (navigator.storage?.persist) {
    void navigator.storage.persisted().then((p) => (p ? undefined : navigator.storage.persist()));
  }
}

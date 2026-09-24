/**
 * PWA state shared by the UI: the install prompt (Chrome / Edge / Android `beforeinstallprompt`, the iOS
 * "Add to Home Screen" hint) and "update available" (a new service worker is waiting). A tiny external store read
 * with useSyncExternalStore; `src/pwa.ts` feeds it from the service-worker registration. No virtual-module import
 * here, so unit tests can use it directly.
 */
import { useSyncExternalStore } from 'react';

/** Chromium's install prompt event (not in the DOM typings). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

export interface PwaState {
  /** A captured install prompt: the browser can install the app now (Chrome / Edge / Android). */
  installEvent: BeforeInstallPromptEvent | null;
  /** Installed during this session (appinstalled). */
  installed: boolean;
  /** A new version of the app is downloaded and waiting. */
  needRefresh: boolean;
  /** Hidden for this session with "Later". */
  updateDismissed: boolean;
}

let state: PwaState = { installEvent: null, installed: false, needRefresh: false, updateDismissed: false };
const listeners = new Set<() => void>();
let applyUpdateFn: (() => Promise<void>) | null = null;

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
}

/** The service worker says a new version is waiting; `apply` activates it and reloads the page. */
export function setUpdateAvailable(apply: () => Promise<void>): void {
  applyUpdateFn = apply;
  set({ needRefresh: true, updateDismissed: false });
}

export async function applyUpdate(): Promise<void> {
  if (applyUpdateFn) await applyUpdateFn();
  else window.location.reload();
}

export function dismissUpdate(): void {
  set({ updateDismissed: true });
}

/** Keep the browser's install prompt for our own Install button (instead of the mini-infobar). */
export function captureInstallPrompt(e: Event): void {
  e.preventDefault();
  set({ installEvent: e as BeforeInstallPromptEvent });
}

export function markInstalled(): void {
  set({ installed: true, installEvent: null });
}

/** Show the browser's install dialog; the event can be used once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = state.installEvent;
  if (!e) return 'unavailable';
  set({ installEvent: null });
  await e.prompt();
  const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (choice.outcome === 'accepted') set({ installed: true });
  return choice.outcome;
}

/** Running as the installed app (home screen / desktop window), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone) || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
}

/** iPhone / iPad (incl. iPadOS, which reports itself as a Mac with touch). Every iOS browser can add to home screen. */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// ---------------------------------------------------------------- remembered choices (per device, best effort)
const KEY = 'a2b-tab.install-dismissed';

export function installHintDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInstallHint(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: hidden for this session only */
  }
}

/** Test helper. */
export function resetPwaState(): void {
  state = { installEvent: null, installed: false, needRefresh: false, updateDismissed: false };
  applyUpdateFn = null;
  listeners.forEach((l) => l());
}

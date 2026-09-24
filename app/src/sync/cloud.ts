/**
 * The cloud the app signs in to and syncs with: sign-in (auth) + a SyncBackend for the signed-in user.
 *
 *  - Supabase (auth/supabase.ts): when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set. "Sign in with
 *    Microsoft" = the Supabase Azure provider (company tenant only), PKCE, redirect to /auth/callback.
 *  - Fake (sync/fakeHttp.ts): only in a build with VITE_FAKE_SYNC=1 (the two-device e2e run); talks to the in-memory
 *    fake server of deploy/serve-dist.ts. Production builds contain none of it (the import is dropped at build time).
 *  - Neither: local mode (getCloud() returns null).
 *
 * Loaded lazily, so local mode never downloads the Supabase client.
 */
import { isSupabaseConfigured } from '../config';
import type { SyncBackend } from './backend';

export interface CloudUser {
  id: string;
  email: string | null;
  name?: string | null;
}

export interface CloudAuth {
  /** The persisted session's user (null: signed out). */
  getUser(): Promise<CloudUser | null>;
  /** Sign-in / sign-out / token refresh. Returns the unsubscribe function. */
  onChange(cb: (user: CloudUser | null) => void): () => void;
  /** Starts the sign-in (navigates away to Microsoft; comes back to /auth/callback). */
  signIn(): Promise<void>;
  /** Completes the sign-in on /auth/callback (exchanges the code). Throws with the provider's message on failure. */
  completeSignIn(url: string): Promise<CloudUser | null>;
  /** Ends the session on this device (local data stays). */
  signOut(): Promise<void>;
}

export interface Cloud {
  readonly kind: 'supabase' | 'fake';
  readonly auth: CloudAuth;
  backend(user: CloudUser): SyncBackend;
}

export const isFakeSync = import.meta.env.VITE_FAKE_SYNC === '1';
export const isCloudConfigured = isSupabaseConfigured || isFakeSync;

let cloudPromise: Promise<Cloud> | null = null;
let override: Cloud | null | undefined;

export function getCloud(): Promise<Cloud> | null {
  if (override !== undefined) return override ? Promise.resolve(override) : null;
  if (!isCloudConfigured) return null;
  cloudPromise ??= isFakeSync
    ? import('./fakeHttp').then((m) => m.createFakeHttpCloud())
    : import('../auth/supabase').then((m) => m.createSupabaseCloud());
  return cloudPromise;
}

/** Is sign-in / sync available in this build (or the test's cloud)? false = local mode. */
export function cloudConfigured(): boolean {
  return override !== undefined ? Boolean(override) : isCloudConfigured;
}

/** Tests: use this cloud (null: local mode; undefined: back to the configured one). */
export function setCloudForTests(c: Cloud | null | undefined): void {
  override = c;
  cloudPromise = null;
}

export const CALLBACK_PATH = '/auth/callback';

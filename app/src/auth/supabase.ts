/**
 * Supabase cloud: client created lazily and only when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set, so local
 * mode never downloads or runs the client. Sign-in is "Sign in with Microsoft" (Supabase Azure provider, company
 * tenant only: see docs/SYNC_SETUP.md), PKCE flow: Microsoft -> Supabase -> <app>/auth/callback?code=… , where the
 * callback page exchanges the code for a session (detectSessionInUrl is off so that happens exactly once). The session
 * is kept in localStorage and refreshed automatically.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';
import { CALLBACK_PATH, type Cloud, type CloudUser } from '../sync/cloud';
import { SupabaseBackend } from '../sync/supabaseBackend';

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabaseClient(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    }),
  );
  return clientPromise;
}

const toUser = (u: User | null | undefined): CloudUser | null =>
  u
    ? {
        id: u.id,
        email: u.email ?? null,
        name:
          (u.user_metadata?.full_name as string | undefined) ?? (u.user_metadata?.name as string | undefined) ?? null,
      }
    : null;

/** Error text the provider put on the callback URL (?error_description=… or #error_description=…). */
export function callbackError(url: URL): string | null {
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const d = url.searchParams.get('error_description') ?? hash.get('error_description');
  const e = url.searchParams.get('error') ?? hash.get('error');
  return d || e ? (d ?? e)!.replace(/\+/g, ' ') : null;
}

/** The Supabase cloud over a client (injectable for tests). */
export function supabaseCloud(getClient: () => Promise<SupabaseClient>): Cloud {
  return {
    kind: 'supabase',
    auth: {
      async getUser() {
        const { data } = await (await getClient()).auth.getSession();
        return toUser(data.session?.user);
      },
      onChange(cb) {
        let unsub: (() => void) | undefined;
        let stopped = false;
        void getClient().then((client) => {
          if (stopped) return;
          const { data } = client.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)));
          unsub = () => data.subscription.unsubscribe();
        });
        return () => {
          stopped = true;
          unsub?.();
        };
      },
      async signIn() {
        const client = await getClient();
        const { error } = await client.auth.signInWithOAuth({
          provider: 'azure',
          options: { scopes: 'email', redirectTo: `${window.location.origin}${CALLBACK_PATH}` },
        });
        if (error) throw error;
      },
      async completeSignIn(href) {
        const url = new URL(href);
        const err = callbackError(url);
        if (err) throw new Error(err);
        const client = await getClient();
        const code = url.searchParams.get('code');
        if (code) {
          const { data, error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
          return toUser(data.user);
        }
        // no code (e.g. the page was reloaded after the exchange): the persisted session, if any
        const { data } = await client.auth.getSession();
        return toUser(data.session?.user);
      },
      async signOut() {
        // 'local': end the session on this device only (not on the user's other devices)
        await (await getClient()).auth.signOut({ scope: 'local' });
      },
    },
    backend: () => new SupabaseBackend(getClient),
  };
}

export function createSupabaseCloud(): Cloud {
  return supabaseCloud(getSupabaseClient);
}

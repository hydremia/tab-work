/**
 * Supabase client, created lazily and only when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are set, so local
 * mode never downloads or runs the client. Sign-in is "Sign in with Microsoft" (Supabase Azure provider,
 * company tenant only: see supabase/README.md and docs/SETUP_ACCOUNTS.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

let clientPromise: Promise<SupabaseClient> | null = null;

export function getSupabase(): Promise<SupabaseClient> | null {
  if (!isSupabaseConfigured) return null;
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }),
  );
  return clientPromise;
}

export async function signInWithMicrosoft(): Promise<void> {
  const client = await getSupabase();
  if (!client) throw new Error('Supabase is not configured (local mode)');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'azure',
    options: { scopes: 'email', redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const client = await getSupabase();
  await client?.auth.signOut();
}

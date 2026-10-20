/** Build-time configuration (Vite env). Both Supabase values missing = local-only mode. */
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
/** The Entra app registration, for the one-click final report (auth/graph.ts). Both missing = that route is not offered. */
export const AZURE_CLIENT_ID = (import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined)?.trim() || '';
export const AZURE_TENANT_ID = (import.meta.env.VITE_AZURE_TENANT_ID as string | undefined)?.trim() || '';

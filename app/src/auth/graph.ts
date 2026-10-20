/**
 * A Microsoft Graph token for the signed-in user, for the one-click final report (reports/graphPdf.ts converts the
 * workbook to PDF through a temporary OneDrive file). Separate from the Supabase sign-in: Supabase keeps Microsoft's
 * token only until it expires and cannot renew it, so the app asks Microsoft itself with MSAL (the same app
 * registration with a "Single-page application" redirect URI, see docs/SYNC_SETUP.md section 4). The user connects
 * once per device ("Connect Microsoft 365": a redirect to Microsoft and back to /auth/graph); after that the token is
 * renewed silently from the cache in localStorage (a refresh token, 24 h for single-page apps unless the tenant's
 * policy says otherwise) and the user connects again when that fails. Configured by VITE_AZURE_CLIENT_ID and
 * VITE_AZURE_TENANT_ID; without them the one-click report is not offered. Scope: Files.ReadWrite.AppFolder only (the
 * app's own folder in the user's OneDrive).
 */
import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { AZURE_CLIENT_ID, AZURE_TENANT_ID } from '../config';

export const GRAPH_SCOPES = ['Files.ReadWrite.AppFolder'];
export const GRAPH_CALLBACK_PATH = '/auth/graph';
export const LOGIN_ORIGIN = 'https://login.microsoftonline.com';
const RETURN_KEY = 'graphConnectReturnTo';

export const isGraphConfigured = Boolean(AZURE_CLIENT_ID && AZURE_TENANT_ID);

export type GraphClient = Pick<
  PublicClientApplication,
  'acquireTokenRedirect' | 'acquireTokenSilent' | 'getAllAccounts' | 'handleRedirectPromise' | 'clearCache'
>;

let clientPromise: Promise<GraphClient> | null = null;
let override: GraphClient | null = null;

/** Is the Microsoft 365 connection available (configured, or a test client set)? */
export function graphAvailable(): boolean {
  return Boolean(override) || isGraphConfigured;
}

function client(): Promise<GraphClient> {
  if (override) return Promise.resolve(override);
  if (!isGraphConfigured)
    return Promise.reject(
      new Error('Microsoft 365 is not configured for this app (VITE_AZURE_CLIENT_ID / VITE_AZURE_TENANT_ID).'),
    );
  // MSAL loads on first use only (its own chunk)
  clientPromise ??= import('@azure/msal-browser').then(async ({ PublicClientApplication }) => {
    const pca = new PublicClientApplication({
      auth: {
        clientId: AZURE_CLIENT_ID,
        authority: `${LOGIN_ORIGIN}/${AZURE_TENANT_ID}`,
        // /auth/graph finishes the connection and sends the user back itself (RETURN_KEY)
        redirectUri: `${window.location.origin}${GRAPH_CALLBACK_PATH}`,
      },
      cache: { cacheLocation: 'localStorage' },
    });
    await pca.initialize();
    return pca;
  });
  return clientPromise;
}

/** Tests: use this client (null: back to the configured one). */
export function setGraphClientForTests(c: GraphClient | null): void {
  override = c;
  clientPromise = null;
}

/** The Microsoft account connected on this device: the signed-in user's when known, else the first; null: none. */
export async function graphAccount(email?: string | null): Promise<AccountInfo | null> {
  if (!graphAvailable()) return null;
  const accounts = (await client()).getAllAccounts();
  const hint = email?.trim().toLowerCase();
  return (hint ? accounts.find((a) => a.username?.toLowerCase() === hint) : undefined) ?? accounts[0] ?? null;
}

/** Connect Microsoft 365: navigates to Microsoft (consent once), back to /auth/graph, then on to `returnTo`. */
export async function connectGraph(returnTo: string, email?: string | null): Promise<void> {
  sessionStorage.setItem(RETURN_KEY, returnTo);
  const c = await client();
  await c.acquireTokenRedirect({
    scopes: GRAPH_SCOPES,
    ...(email ? { loginHint: email } : { prompt: 'select_account' }),
  });
}

/** /auth/graph: finishes the connection. Where to go next, and the account that came back (null: nothing pending). */
export async function completeGraphConnect(): Promise<{ returnTo: string; account: AccountInfo | null }> {
  const returnTo = sessionStorage.getItem(RETURN_KEY) || '/';
  sessionStorage.removeItem(RETURN_KEY);
  const result = await (await client()).handleRedirectPromise();
  return { returnTo, account: result?.account ?? null };
}

/** A Graph access token without any interaction, or null when the user has to connect (again). */
export async function getGraphToken(email?: string | null): Promise<string | null> {
  const account = await graphAccount(email);
  if (!account) return null;
  try {
    return (await (await client()).acquireTokenSilent({ scopes: GRAPH_SCOPES, account })).accessToken;
  } catch (e) {
    console.warn('Microsoft 365: silent token renewal failed; connect again', e);
    return null;
  }
}

/** Forget the Microsoft 365 connection on this device (the cached tokens). */
export async function disconnectGraph(): Promise<void> {
  if (graphAvailable()) await (await client()).clearCache();
}

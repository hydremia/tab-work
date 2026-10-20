import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completeGraphConnect,
  connectGraph,
  getGraphToken,
  graphAccount,
  graphAvailable,
  setGraphClientForTests,
  type GraphClient,
} from './graph';

const acct = (username: string): AccountInfo =>
  ({
    username,
    homeAccountId: username,
    environment: 'login.windows.net',
    tenantId: 't',
    localAccountId: username,
  }) as AccountInfo;

function fakeClient(accounts: AccountInfo[], token: string | Error = 'tok') {
  const c = {
    getAllAccounts: vi.fn(() => accounts),
    acquireTokenSilent: vi.fn(async () => {
      if (token instanceof Error) throw token;
      return { accessToken: token } as AuthenticationResult;
    }),
    acquireTokenRedirect: vi.fn(async () => undefined),
    handleRedirectPromise: vi.fn(async () => ({ account: accounts[0] ?? null }) as AuthenticationResult),
    clearCache: vi.fn(async () => undefined),
  } satisfies GraphClient;
  setGraphClientForTests(c);
  return c;
}

afterEach(() => {
  setGraphClientForTests(null);
  sessionStorage.clear();
});

describe('Microsoft 365 connection (Graph token)', () => {
  it('not configured: nothing is available and no token', async () => {
    expect(graphAvailable()).toBe(false);
    expect(await graphAccount('a@x.test')).toBeNull();
    expect(await getGraphToken('a@x.test')).toBeNull();
  });

  it('picks the signed-in account and renews the token silently', async () => {
    const c = fakeClient([acct('other@x.test'), acct('Tech@X.test')]);
    expect((await graphAccount('tech@x.test'))?.username).toBe('Tech@X.test');
    expect(await getGraphToken('tech@x.test')).toBe('tok');
    expect(c.acquireTokenSilent).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      account: expect.objectContaining({ username: 'Tech@X.test' }),
    });
  });

  it('no account, or a silent renewal that fails, means "connect": null, never a throw', async () => {
    fakeClient([]);
    expect(await getGraphToken('a@x.test')).toBeNull();
    fakeClient([acct('a@x.test')], new Error('interaction_required'));
    expect(await getGraphToken('a@x.test')).toBeNull();
  });

  it('connect remembers where to come back to and hints the account; the callback hands both back', async () => {
    const c = fakeClient([acct('a@x.test')]);
    await connectGraph('/p/1/export', 'a@x.test');
    expect(c.acquireTokenRedirect).toHaveBeenCalledWith({
      scopes: ['Files.ReadWrite.AppFolder'],
      loginHint: 'a@x.test',
    });
    const done = await completeGraphConnect();
    expect(done.returnTo).toBe('/p/1/export');
    expect(done.account?.username).toBe('a@x.test');
    // a second visit to the callback has nothing pending and goes home
    expect((await completeGraphConnect()).returnTo).toBe('/');
  });
});

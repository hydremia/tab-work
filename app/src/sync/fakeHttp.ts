/**
 * Test-only cloud (builds with VITE_FAKE_SYNC=1, used by the two-device e2e run): the in-memory FakeSyncServer runs
 * in deploy/serve-dist.ts (SERVE_FAKE_SYNC=1) under /__fake-sync/, same origin. Sign-in imitates the real redirect:
 * "Sign in" goes to /auth/callback?code=<email> (email from localStorage `tab.fakeSync.email`, default
 * tech@a2b.test) and the callback page exchanges the code for a session kept in localStorage.
 */
import { SyncError, toSyncError, type FieldChangeRow, type PushedRow, type SyncBackend } from './backend';
import { CALLBACK_PATH, type Cloud, type CloudUser } from './cloud';

const BASE = '/__fake-sync';
const SESSION_KEY = 'tab.fakeSync.session';

function readSession(): CloudUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

class FakeHttpBackend implements SyncBackend {
  constructor(private readonly user: CloudUser) {}

  private async req(what: string, path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), 'x-fake-user': this.user.id },
      });
    } catch (e) {
      throw new SyncError(`${what}: ${e instanceof Error ? e.message : String(e)}`, 'network');
    }
    if (res.status >= 400 && res.status !== 404) throw toSyncError(await res.json().catch(() => ({})), what);
    return res;
  }

  async push(rows: readonly FieldChangeRow[]): Promise<PushedRow[]> {
    const res = await this.req('push', '/push', { method: 'POST', body: JSON.stringify(rows) });
    return (await res.json()) as PushedRow[];
  }
  async pull(afterSeq: number, limit: number): Promise<FieldChangeRow[]> {
    return (await (await this.req('pull', `/pull?after=${afterSeq}&limit=${limit}`)).json()) as FieldChangeRow[];
  }
  async serverTime(): Promise<number> {
    return Number(await (await this.req('time', '/time')).text());
  }
  async uploadPhoto(path: string, blob: Blob, contentType: string): Promise<void> {
    await this.req('upload', `/photo?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: blob,
      headers: { 'content-type': contentType },
    });
  }
  async downloadPhoto(path: string): Promise<Blob | null> {
    const res = await this.req('download', `/photo?path=${encodeURIComponent(path)}`);
    return res.status === 404 ? null : res.blob();
  }
  async deletePhoto(path: string): Promise<void> {
    await this.req('delete', `/photo?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  }
}

export function createFakeHttpCloud(): Cloud {
  const listeners = new Set<(u: CloudUser | null) => void>();
  const emit = (u: CloudUser | null) => listeners.forEach((l) => l(u));
  return {
    kind: 'fake',
    auth: {
      getUser: async () => readSession(),
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      async signIn() {
        const email = localStorage.getItem('tab.fakeSync.email') || 'tech@a2b.test';
        window.location.assign(`${CALLBACK_PATH}?code=${encodeURIComponent(email)}`);
      },
      async completeSignIn(href) {
        const url = new URL(href);
        const err = url.searchParams.get('error_description');
        if (err) throw new Error(err);
        const code = url.searchParams.get('code');
        if (!code) return readSession();
        const res = await fetch(`${BASE}/signin`, { method: 'POST', body: JSON.stringify({ email: code }) });
        if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
        const user = (await res.json()) as CloudUser;
        localStorage.setItem(SESSION_KEY, JSON.stringify(user));
        emit(user);
        return user;
      },
      async signOut() {
        localStorage.removeItem(SESSION_KEY);
        emit(null);
      },
    },
    backend: (user) => new FakeHttpBackend(user),
  };
}

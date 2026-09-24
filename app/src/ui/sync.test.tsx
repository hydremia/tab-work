/**
 * jsdom: sign-in and sync UX with a mocked Supabase auth client (the real supabaseCloud() wrapper around it) and the
 * in-memory fake server as the backend: sign-in page, callback (code exchange, provider error), a persisted session,
 * first sign-in with local projects (choose what moves to the cloud), sign-out (keeps data, warns about unsynced
 * changes); the conflict UI (Attention group, unit badge, field flag, resolve); the lock toast.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { supabaseCloud } from '../auth/supabase';
import { db } from '../data/db';
import { getDeviceId } from '../data/identity';
import { addEquipment, createProject, LockedError, setField } from '../data/repo';
import type { SyncConflict } from '../data/types';
import { setCloudForTests, type Cloud } from '../sync/cloud';
import { FakeBackend } from '../sync/fakeBackend';
import { FakeSyncServer } from '../sync/fakeServer';
import { localOnlyProjects } from '../sync/outbox';
import { SyncProvider } from '../sync/SyncProvider';

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dana@a2b.com',
  user_metadata: { full_name: 'Dana Kim' },
} as unknown as User;

function mockSupabaseAuth(signedIn: boolean) {
  let session: { user: User } | null = signedIn ? { user: USER } : null;
  const listeners = new Set<(event: string, s: typeof session) => void>();
  const emit = (event: string) => listeners.forEach((l) => l(event, session));
  const auth = {
    getSession: vi.fn(async () => ({ data: { session } })),
    onAuthStateChange: vi.fn((cb: (event: string, s: typeof session) => void) => {
      listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    }),
    signInWithOAuth: vi.fn(async (_opts: unknown) => ({ data: {}, error: null })),
    exchangeCodeForSession: vi.fn(async (code: string) => {
      if (code === 'bad') return { data: { user: null, session: null }, error: new Error('invalid grant') };
      session = { user: USER };
      emit('SIGNED_IN');
      return { data: { user: USER, session }, error: null };
    }),
    signOut: vi.fn(async (_opts?: unknown) => {
      session = null;
      emit('SIGNED_OUT');
      return { error: null };
    }),
  };
  return { client: { auth } as unknown as SupabaseClient, auth };
}

let server: FakeSyncServer;
let backend: FakeBackend | null;

function useCloud(signedIn: boolean) {
  const m = mockSupabaseAuth(signedIn);
  const real = supabaseCloud(async () => m.client);
  const cloud: Cloud = {
    ...real,
    backend: (u) => (backend = new FakeBackend(server, u.id)),
  };
  setCloudForTests(cloud);
  return m.auth;
}

function renderAt(path: string) {
  window.history.pushState({}, '', path); // the callback page reads window.location
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
  return router;
}

beforeEach(() => {
  server = new FakeSyncServer();
  server.addUser(USER.email!, 'a2b', USER.id);
  backend = null;
});
afterEach(() => {
  setCloudForTests(undefined);
  vi.restoreAllMocks();
  window.history.pushState({}, '', '/');
});

describe('sign-in (mocked Supabase auth)', () => {
  it('local mode: the account page explains it, no sign-in', async () => {
    setCloudForTests(null);
    renderAt('/account');
    expect(await screen.findByTestId('account-local')).toHaveTextContent('Local mode');
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Local');
  });

  it('signed out: banner, sign-in page starts the Microsoft sign-in (Azure provider, back to /auth/callback)', async () => {
    const user = userEvent.setup();
    const auth = useCloud(false);
    renderAt('/');
    expect(await screen.findByTestId('signed-out-banner')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('signed-out-banner')).getByRole('link', { name: 'Sign in' }));
    await user.click(await screen.findByRole('button', { name: 'Sign in with Microsoft' }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: { scopes: 'email', redirectTo: `${window.location.origin}/auth/callback` },
    });
  });

  it('callback: exchanges the code, signs in and syncs (nothing local to move)', async () => {
    const auth = useCloud(false);
    const router = renderAt('/auth/callback?code=abc');
    await waitFor(() => expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent('Synced'), { timeout: 5000 });
    expect(backend!.calls.pull).toBeGreaterThan(0);
  });

  it('callback: a provider error (e.g. not assigned to the app) is shown with a way back', async () => {
    useCloud(false);
    renderAt('/auth/callback?error=access_denied&error_description=AADSTS50105%3A+user+not+assigned');
    expect(await screen.findByTestId('signin-error')).toHaveTextContent('AADSTS50105: user not assigned');
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/account');
  });

  it('callback: a failed code exchange is shown', async () => {
    useCloud(false);
    renderAt('/auth/callback?code=bad');
    expect(await screen.findByTestId('signin-error')).toHaveTextContent('invalid grant');
  });

  it('a persisted session is picked up at start (no sign-in needed), edits sync', async () => {
    useCloud(true);
    const p = await createProject({ name: 'Riverside' });
    await db.meta.put({ key: 'cloudUser', value: USER.id }); // this device was set up before
    renderAt('/account');
    expect(await screen.findByTestId('account-signed-in')).toHaveTextContent('Dana Kim');
    await waitFor(() => expect(server.record('projects', p.id)).toBeDefined());
    await waitFor(() => expect(screen.getByTestId('account-status')).toHaveTextContent('Everything synced'));
  });
});

describe('first sign-in with local projects', () => {
  it('waits for the choice, uploads the chosen projects through the normal push, keeps the rest on the device', async () => {
    const user = userEvent.setup();
    useCloud(true);
    const a = await createProject({ name: 'Alpha School' });
    const b = await createProject({ name: 'Bravo Clinic' });
    const router = renderAt('/');
    expect(await screen.findByTestId('setup-banner')).toBeInTheDocument();
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Choose projects');
    expect(backend?.calls.push ?? 0).toBe(0); // nothing moves before the choice
    await user.click(within(screen.getByTestId('setup-banner')).getByRole('link', { name: 'Choose' }));
    const list = await screen.findByTestId('cloud-setup');
    expect(list).toHaveTextContent('dana@a2b.com');
    const boxes = await within(list).findAllByTestId('cloud-setup-project');
    expect(boxes).toHaveLength(2);
    expect(list).toHaveTextContent('Alpha School');
    expect(list).toHaveTextContent('Bravo Clinic');
    await user.click(boxes[1]); // keep Bravo on this device
    await user.click(screen.getByTestId('cloud-setup-upload'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await waitFor(() => expect(server.record('projects', a.id)).toBeDefined(), { timeout: 5000 });
    expect(server.record('projects', b.id)).toBeUndefined();
    expect([...(await localOnlyProjects())]).toEqual([b.id]);
    expect((await db.meta.get('cloudUser'))?.value).toBe(USER.id);
    // later: move it from Sync & account
    await act(() => router.navigate('/account'));
    const only = await screen.findByTestId('device-only');
    expect(only).toHaveTextContent('Bravo Clinic');
    await user.click(within(only).getByRole('button', { name: 'Move to the cloud' }));
    await waitFor(() => expect(server.record('projects', b.id)).toBeDefined(), { timeout: 5000 });
  });
});

describe('sign-out', () => {
  it('warns about unsynced changes, keeps local data, stops syncing', async () => {
    const user = userEvent.setup();
    const auth = useCloud(true);
    await db.meta.put({ key: 'cloudUser', value: USER.id });
    renderAt('/account');
    await screen.findByTestId('account-signed-in');
    await waitFor(() => expect(backend).not.toBeNull());
    backend!.offline = true;
    const p = await createProject({ name: 'Offline job' });
    await setField('projects', p.id, 'info.architect', 'Lionakis');
    await waitFor(() => expect(screen.getByTestId('sync-status')).toHaveTextContent(/unsynced|Sync error/));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByTestId('sign-out'));
    expect(confirm.mock.calls[0][0]).toMatch(/changes have not synced yet\. They stay on this device/);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(await screen.findByTestId('account-signin')).toBeInTheDocument();
    expect(await db.projects.get(p.id)).toBeDefined();
    expect(await db.fieldChanges.where('synced').equals(0).count()).toBeGreaterThan(0);
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Not signed in');
  });

  it('cancel keeps the session', async () => {
    const user = userEvent.setup();
    const auth = useCloud(true);
    await db.meta.put({ key: 'cloudUser', value: USER.id });
    renderAt('/account');
    await screen.findByTestId('account-signed-in');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getByTestId('sign-out'));
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe('conflict UI', () => {
  async function withConflict() {
    const p = await createProject({ name: 'Riverside' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await setField('equipment', rtu.id, 'data.serial', 'SN-B');
    const conflict: SyncConflict = {
      id: 'c1',
      projectId: p.id,
      kind: 'field',
      table: 'equipment',
      recordId: rtu.id,
      equipmentId: rtu.id,
      field: 'data.serial',
      current: { value: 'SN-B', ts: Date.now(), userId: 'u2', deviceId: 'dev-b', local: false, changeId: 'x2' },
      other: {
        value: 'SN-A',
        ts: Date.now() - 1000,
        userId: 'local',
        deviceId: await getDeviceId(),
        local: true,
        changeId: 'x1',
      },
      status: 'open',
      detectedAt: Date.now(),
    };
    await db.conflicts.add(conflict);
    return { p, rtu };
  }

  it('Attention tab: a Conflicts group with both values; "Use" restores the other value through setField', async () => {
    const user = userEvent.setup();
    setCloudForTests(null);
    const { p, rtu } = await withConflict();
    renderAt(`/p/${p.id}/attention`);
    const group = await screen.findByTestId('attention-conflicts');
    expect(group).toHaveTextContent('Conflicts');
    expect(group).toHaveTextContent('RTU-1');
    expect(group).toHaveTextContent('Serial');
    expect(within(group).getByTestId('conflict-current')).toHaveTextContent('SN-B');
    expect(within(group).getByTestId('conflict-other')).toHaveTextContent('SN-A');
    expect(screen.getByTestId('tab-count-attention')).toHaveTextContent(/\d/);
    await user.click(within(group).getByTestId('conflict-restore'));
    await waitFor(() => expect(screen.queryByTestId('attention-conflicts')).toBeNull());
    expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-A');
    expect((await db.conflicts.get('c1'))?.resolution).toBe('restored');
    const pushed = await db.fieldChanges
      .where('synced')
      .equals(0)
      .filter((c) => c.field === 'data.serial')
      .first();
    expect(pushed?.value).toBe('SN-A'); // an ordinary edit in the outbox: it syncs
  });

  it('the unit card and the unit page show the conflict; the field is flagged; Keep closes it', async () => {
    const user = userEvent.setup();
    setCloudForTests(null);
    const { p, rtu } = await withConflict();
    const router = renderAt(`/p/${p.id}/equipment`);
    const card = await screen.findByTestId('equip-RTU-1');
    await waitFor(() => expect(within(card).getByTestId('conflict-flag')).toBeInTheDocument());
    await act(() => router.navigate(`/p/${p.id}/e/${rtu.id}`));
    const section = await screen.findByTestId('unit-conflicts');
    const field = document.querySelector('[data-field="serial"]') as HTMLElement;
    expect(within(field).getByTestId('conflict-flag')).toBeInTheDocument();
    await user.click(within(section).getByTestId('conflict-keep'));
    await waitFor(() => expect(screen.queryByTestId('unit-conflicts')).toBeNull());
    expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-B');
  });

  it('held changes (report issued elsewhere): explained, and can be discarded', async () => {
    const user = userEvent.setup();
    setCloudForTests(null);
    const p = await createProject({ name: 'Riverside' });
    await db.conflicts.add({
      id: 'h1',
      projectId: p.id,
      kind: 'held',
      table: null,
      recordId: null,
      equipmentId: null,
      field: '',
      held: { count: 3, label: 'Prelim', by: 'Kim' },
      status: 'open',
      detectedAt: Date.now(),
    });
    renderAt(`/p/${p.id}/attention`);
    const card = await screen.findByTestId('conflict-held');
    expect(card).toHaveTextContent('3 changes not synced');
    expect(card).toHaveTextContent('issued as Prelim by Kim');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(within(card).getByRole('button', { name: 'Discard them' }));
    await waitFor(() => expect(screen.queryByTestId('conflict-held')).toBeNull());
  });
});

describe('lock arriving while editing', () => {
  it('a refused save shows why instead of failing silently', async () => {
    setCloudForTests(null);
    renderAt('/');
    await screen.findByRole('heading', { name: 'Projects' });
    const ev = new Event('unhandledrejection') as Event & { reason?: unknown };
    ev.reason = new LockedError({ label: 'Prelim', revisionId: null, name: 'Kim', userId: 'u', deviceId: 'd', at: 1 });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(await screen.findByTestId('locked-toast')).toHaveTextContent(
      'Not saved: The report was issued as Prelim; unlock the project to edit.',
    );
  });
});

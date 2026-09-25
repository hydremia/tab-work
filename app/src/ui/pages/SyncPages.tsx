/**
 * Sign-in and sync pages:
 *  - /account        sync status, Sync now, sign in / sign out (keeps local data; warns about unsynced changes),
 *                    projects kept on this device only (upload later)
 *  - /auth/callback  where Microsoft (through Supabase) sends the browser back: finishes the sign-in
 *  - /cloud-setup    first sign-in on a device with local projects: choose which move to the cloud
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../../data/db';
import { countPending, localOnlyProjects } from '../../sync/outbox';
import { localProjects, useSync } from '../../sync/SyncProvider';
import { Screen } from '../components/Screen';

const when = (t: number) => new Date(t).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** Warning text for sign-out (null: nothing unsynced). */
export function signOutWarning(pending: number): string | null {
  if (!pending) return null;
  return (
    `${pending} change${pending > 1 ? 's have' : ' has'} not synced yet. ` +
    'They stay on this device and sync the next time you sign in here; until then nobody else sees them.'
  );
}

/** Confirm text for "Sign out and remove data from this device" (what is lost, if anything). */
export function removeDataWarning(pending: number, deviceOnly: number, email = ''): string {
  const lines = [
    `Sign out${email ? ` ${email}` : ''} and remove all projects, photos and settings from this device?`,
    'Use this on a shared or borrowed device. Everything that has synced stays in the cloud and comes back when you sign in again.',
  ];
  if (pending)
    lines.push(
      `WARNING: ${pending} change${pending > 1 ? 's have' : ' has'} NOT synced yet and will be lost. Cancel and tap Sync now first (when online).`,
    );
  if (deviceOnly)
    lines.push(
      `WARNING: ${deviceOnly} project${deviceOnly > 1 ? 's are' : ' is'} kept on this device only and will be lost (export ${deviceOnly > 1 ? 'them' : 'it'} or move ${deviceOnly > 1 ? 'them' : 'it'} to the cloud first).`,
    );
  return lines.join('\n\n');
}

export function AccountPage() {
  const s = useSync();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const deviceOnly = useLiveQuery(async () => {
    const ids = await localOnlyProjects();
    return (await db.projects.bulkGet([...ids])).filter((p) => p !== undefined);
  }, []);

  async function signIn() {
    setErr(null);
    setBusy(true);
    try {
      await s.signIn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  async function signOut() {
    // counted now (the live count may not be loaded yet)
    const warn = signOutWarning(await countPending(true));
    const ok = window.confirm(
      `Sign out${s.user?.email ? ` ${s.user.email}` : ''}?\n\n` +
        'Your projects stay on this device, but nothing syncs until you sign in again.' +
        (warn ? `\n\n${warn}` : ''),
    );
    if (!ok) return;
    await s.signOut();
  }
  async function signOutAndRemove() {
    const pending = await countPending(true);
    const deviceOnlyCount = (await localOnlyProjects()).size;
    const ok = window.confirm(removeDataWarning(pending, deviceOnlyCount, s.user?.email ?? ''));
    if (!ok) return;
    setBusy(true);
    await s.signOutAndRemove();
  }

  return (
    <Screen title="Sync & account" back="/">
      {s.status === 'local' ? (
        <section className="card card-pad stack" data-testid="account-local">
          <h2>Local mode</h2>
          <p>
            Everything is saved on this device only; nothing syncs. Sign-in and sync are switched on when the app is
            connected to the company&apos;s cloud (see docs/SYNC_SETUP.md). Export the workbook to share a project
            meanwhile.
          </p>
          <p className="small muted">{s.pending} changes logged on this device (they sync after the first sign-in).</p>
        </section>
      ) : !s.user ? (
        <section className="card card-pad stack" data-testid="account-signin">
          <h2>Sign in</h2>
          <p>
            Sign in with your company Microsoft account to sync projects between your devices and with the team. Your
            projects on this device stay here either way.
          </p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void signIn()}>
            Sign in with Microsoft
          </button>
          {err && (
            <div className="callout" data-tone="red" role="alert">
              Sign-in failed: {err}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="card card-pad stack" data-testid="account-signed-in">
            <h2>Signed in</h2>
            <p>
              <b>{s.user.name || s.user.email}</b>
              {s.user.name && s.user.email ? <span className="muted"> · {s.user.email}</span> : null}
            </p>
            <dl className="kv">
              <dt>Status</dt>
              <dd data-testid="account-status">
                {s.status === 'setup'
                  ? 'Waiting: choose which projects move to the cloud'
                  : s.status === 'offline'
                    ? 'Offline — syncs when you reconnect'
                    : s.status === 'error'
                      ? `Sync error: ${s.error}`
                      : s.status === 'syncing'
                        ? 'Syncing…'
                        : s.pending
                          ? `${s.pending} change${s.pending > 1 ? 's' : ''} not synced yet`
                          : 'Everything synced'}
              </dd>
              <dt>Last sync</dt>
              <dd>{s.lastSyncAt ? when(s.lastSyncAt) : '—'}</dd>
            </dl>
            <div className="row-actions">
              {s.status === 'setup' ? (
                <Link className="btn btn-primary" to="/cloud-setup">
                  Choose projects
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="sync-now"
                  disabled={!s.online || s.status === 'syncing'}
                  onClick={() => void s.syncNow()}
                >
                  Sync now
                </button>
              )}
              <button type="button" className="btn" data-testid="sign-out" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </section>
          <section className="card card-pad stack" data-testid="shared-device">
            <h2>Shared device?</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Signing out keeps your projects on this device. On a shared or borrowed device, remove them as well: what
              has synced comes back when you sign in again.
            </p>
            <button
              type="button"
              className="btn btn-danger"
              data-testid="sign-out-remove"
              disabled={busy}
              onClick={() => void signOutAndRemove()}
            >
              Sign out and remove data from this device
            </button>
          </section>
          {deviceOnly && deviceOnly.length > 0 && (
            <section className="card card-pad stack" data-testid="device-only">
              <h2>On this device only</h2>
              <p className="small muted">These projects are not uploaded; nobody else sees them.</p>
              <ul className="plain-list">
                {deviceOnly.map((p) => (
                  <li key={p.id} className="row-actions">
                    <span className="grow">{p.name}</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void s.uploadProject(p.id).then(() => s.syncNow())}
                    >
                      Move to the cloud
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </Screen>
  );
}

export function AuthCallbackPage() {
  const s = useSync();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    s.completeSignIn(window.location.href).then(
      (u) => {
        if (!u) setErr('No sign-in in progress.');
        // the provider picks up the new session and decides whether /cloud-setup is needed
        else nav('/', { replace: true });
      },
      (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
    );
  }, [s, nav]);
  return (
    <Screen title="Signing in" back="/">
      {err ? (
        <section className="card card-pad stack" data-testid="signin-error">
          <h2>Sign-in didn&apos;t finish</h2>
          <p role="alert">{err}</p>
          <p className="small muted">
            If this keeps happening, ask your Microsoft 365 admin whether your account may use the TAB App.
          </p>
          <Link className="btn btn-primary" to="/account">
            Try again
          </Link>
        </section>
      ) : (
        <p className="muted">Finishing sign-in…</p>
      )}
    </Screen>
  );
}

export function CloudSetupPage() {
  const s = useSync();
  const nav = useNavigate();
  const list = useLiveQuery(() => localProjects(), [s.user?.id]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set((list ?? []).map((p) => p.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  async function finish(ids: string[]) {
    await s.finishOnboarding(ids);
    nav('/', { replace: true });
  }
  if (!s.user) {
    return (
      <Screen title="Move projects to the cloud" back="/">
        <p>
          Sign in first. <Link to="/account">Sign in</Link>
        </p>
      </Screen>
    );
  }
  return (
    <Screen title="Move projects to the cloud" back="/">
      <section className="card card-pad stack" data-testid="cloud-setup">
        <h2>Your projects on this device</h2>
        <p>
          You are signed in as <b>{s.user.email ?? s.user.name}</b>. Choose the projects to upload: they sync to the
          company&apos;s cloud and the rest of the team sees them. Unticked projects stay on this device only (you can
          move them later from <i>Sync &amp; account</i>).
        </p>
        {!list ? (
          <p className="muted">Loading…</p>
        ) : !list.length ? (
          <p className="muted">No local projects: nothing to move.</p>
        ) : (
          <ul className="plain-list">
            {list.map((p) => (
              <li key={p.id}>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={chosen.has(p.id)}
                    onChange={() => toggle(p.id)}
                    data-testid="cloud-setup-project"
                  />
                  <span>
                    <b>{p.name || 'Untitled project'}</b>
                    <span className="small muted"> · {p.changes} saved changes</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="cloud-setup-upload"
            disabled={!list}
            onClick={() => void finish([...chosen])}
          >
            {chosen.size ? `Upload ${chosen.size} project${chosen.size > 1 ? 's' : ''}` : 'Continue without uploading'}
          </button>
          {chosen.size > 0 && (
            <button type="button" className="btn" onClick={() => void finish([])}>
              Keep all on this device
            </button>
          )}
        </div>
      </section>
    </Screen>
  );
}

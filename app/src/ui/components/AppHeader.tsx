import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useSync, type SyncStatus } from '../../sync/SyncProvider';
import { IconBack, IconCloudCheck, IconCloudOff, IconCloudUp, IconDevice } from './Icons';

export function SyncIndicator() {
  const s = useSync();
  const text: Record<SyncStatus, string> = {
    local: 'Local',
    'signed-out': 'Not signed in',
    offline: s.pending ? `Offline · ${s.pending} unsynced` : 'Offline',
    syncing: 'Syncing…',
    synced: 'Synced',
    pending: `${s.pending} unsynced`,
    error: 'Sync error',
  };
  const icon =
    s.status === 'local' || s.status === 'signed-out' ? (
      <IconDevice size={16} />
    ) : s.status === 'offline' || s.status === 'error' ? (
      <IconCloudOff size={16} />
    ) : s.status === 'synced' ? (
      <IconCloudCheck size={16} />
    ) : (
      <IconCloudUp size={16} />
    );
  const title =
    s.status === 'local'
      ? `Local mode: saved on this device only (${s.pending} changes logged). ${s.online ? 'Online' : 'Offline'}.`
      : (s.error ?? text[s.status]);
  return (
    <span className="sync-pill" data-status={s.status} title={title} role="status" data-testid="sync-status">
      {icon}
      {text[s.status]}
      {s.status === 'local' && (s.online ? <span className="hide-sm"> mode</span> : <span> · offline</span>)}
    </span>
  );
}

export function AppHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string;
  subtitle?: string;
  back?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        {back ? (
          <Link to={back} className="icon-btn" aria-label="Back">
            <IconBack size={24} />
          </Link>
        ) : (
          <span className="icon-btn" aria-hidden>
            <img src="/favicon.svg" alt="" width={28} height={28} />
          </span>
        )}
        <div className="title">
          {title}
          {subtitle && <small>{subtitle}</small>}
        </div>
        {actions}
        <SyncIndicator />
      </div>
    </header>
  );
}

/** Local-mode / offline / sign-in banner under the header. */
export function ModeBanner() {
  const s = useSync();
  if (s.status === 'local') {
    return (
      <div className="banner" data-testid="local-banner">
        <div className="banner-inner">
          <IconDevice size={16} />
          <span>
            <b>Local mode</b> — not signed in / not syncing. Saved on this device only{s.online ? '' : ' · offline'}.
          </span>
        </div>
      </div>
    );
  }
  if (s.status === 'signed-out') {
    return (
      <div className="banner" data-tone="warn">
        <div className="banner-inner">
          <span>Not signed in: changes are saved on this device and sync after you sign in.</span>
          <button className="btn btn-primary" onClick={() => void s.signIn()}>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }
  if (!s.online) {
    return (
      <div className="banner" data-tone="warn">
        <div className="banner-inner">
          <IconCloudOff size={16} />
          <span>Offline — changes are saved on this device and sync when you reconnect.</span>
        </div>
      </div>
    );
  }
  return null;
}

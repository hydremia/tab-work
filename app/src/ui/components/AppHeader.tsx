import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { DeviceNameBanner, useDeviceName } from './DeviceName';
import { useSync, type SyncStatus } from '../../sync/SyncProvider';
import { IconBack, IconCloudCheck, IconCloudOff, IconCloudUp, IconDevice, IconUser } from './Icons';

export function SyncIndicator() {
  const s = useSync();
  const text: Record<SyncStatus, string> = {
    local: 'Local',
    'signed-out': 'Not signed in',
    setup: 'Choose projects',
    paused: s.pending ? `Paused · ${s.pending} not sent` : 'Sync paused',
    offline: s.pending ? `Offline · ${s.pending} unsynced` : 'Offline',
    syncing: 'Syncing…',
    synced: 'Synced',
    pending: `${s.pending} unsynced`,
    error: 'Sync error',
  };
  const icon =
    s.status === 'local' || s.status === 'signed-out' || s.status === 'setup' ? (
      <IconDevice size={16} />
    ) : s.status === 'offline' || s.status === 'error' || s.status === 'paused' ? (
      <IconCloudOff size={16} />
    ) : s.status === 'synced' ? (
      <IconCloudCheck size={16} />
    ) : (
      <IconCloudUp size={16} />
    );
  const title =
    s.status === 'local'
      ? `Local mode: saved on this device only (${s.pending} changes logged). ${s.online ? 'Online' : 'Offline'}.`
      : s.status === 'paused'
        ? 'Sync paused on this device: changes are saved here and not sent until you sync or resume.'
        : (s.error ?? text[s.status]);
  return (
    <Link
      to="/account"
      className="sync-pill"
      data-status={s.status}
      title={title}
      role="status"
      aria-label={`${text[s.status]}: sync and account`}
      data-testid="sync-status"
    >
      {icon}
      {s.status === 'synced' ? <span className="hide-sm">{text.synced}</span> : text[s.status]}
      {s.status === 'local' && (s.online ? <span className="hide-sm"> mode</span> : <span> · offline</span>)}
    </Link>
  );
}

/** "Dana Kim" → "DK", "dana@a2b.com" → "D". */
export function initials(name: string): string {
  const words = name
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** The account button: who is signed in (initials), sign-in / sign-out and this device's name, on Sync & account. */
export function AccountButton() {
  const s = useSync();
  const deviceName = useDeviceName();
  const who = s.user ? s.user.name || s.user.email || 'Signed in' : null;
  // a dot when something needs doing: sign in, or name this device
  const needs = s.status === 'signed-out' || (Boolean(s.user) && deviceName === '');
  if (s.status === 'local') return null; // no accounts in local mode: the Local pill explains it
  const label = who
    ? `Account: ${who}${deviceName ? ` · ${deviceName}` : ' · this device has no name'}`
    : 'Account: not signed in';
  return (
    <Link to="/account" className="account-btn" aria-label={label} title={label} data-testid="account-button">
      {who ? (
        <span className="account-initials">{initials(who) || <IconUser size={18} />}</span>
      ) : (
        <IconUser size={20} />
      )}
      {needs && <span className="account-dot" aria-hidden />}
    </Link>
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
        <AccountButton />
      </div>
    </header>
  );
}

/** Local-mode / offline / sign-in banner under the header. */
export function ModeBanner() {
  const s = useSync();
  const { pathname } = useLocation();
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
      <div className="banner" data-tone="warn" data-testid="signed-out-banner">
        <div className="banner-inner">
          <span>Not signed in: changes are saved on this device and sync after you sign in.</span>
          <Link className="btn btn-primary" to="/account">
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  if (s.status === 'setup' && pathname !== '/cloud-setup') {
    return (
      <div className="banner" data-tone="warn" data-testid="setup-banner">
        <div className="banner-inner">
          <span>Signed in. Choose which projects on this device move to the cloud before syncing starts.</span>
          <Link className="btn btn-primary" to="/cloud-setup">
            Choose
          </Link>
        </div>
      </div>
    );
  }
  if (s.status === 'paused' && s.pending > 0 && s.pausedSince && s.pausedLong) {
    return (
      <div className="banner" data-tone="warn" data-testid="paused-banner">
        <div className="banner-inner">
          <IconCloudOff size={16} />
          <span>
            Sync has been paused since {new Date(s.pausedSince).toLocaleDateString()}: {s.pending} change
            {s.pending > 1 ? 's are' : ' is'} not backed up or shared yet.
          </span>
          <button type="button" className="btn btn-primary" onClick={() => void s.setPaused(false)}>
            Resume sync
          </button>
        </div>
      </div>
    );
  }
  if (!s.online && s.status !== 'paused') {
    return (
      <div className="banner" data-tone="warn">
        <div className="banner-inner">
          <IconCloudOff size={16} />
          <span>Offline — changes are saved on this device and sync when you reconnect.</span>
        </div>
      </div>
    );
  }
  return <DeviceNameBanner />;
}

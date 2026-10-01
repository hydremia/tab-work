import { useState } from 'react';
import { APP_BUILD } from '../../buildInfo';
import {
  applyUpdate,
  checkForUpdate,
  type UpdateCheck,
  dismissInstallHint,
  dismissUpdate,
  installHintDismissed,
  isIos,
  isStandalone,
  promptInstall,
  usePwa,
} from '../../pwaState';
import { IconInstall, IconRefresh, IconShare } from './Icons';

/**
 * "Install app" card (project list). Chrome / Edge / Android: shown when the browser offers installation
 * (beforeinstallprompt), with an Install button. iPhone / iPad: a short "Share → Add to Home Screen" hint, because
 * iOS has no install prompt. Hidden in the installed app; "Not now" is remembered on the device.
 */
export function InstallPrompt() {
  const pwa = usePwa();
  const [dismissed, setDismissed] = useState(installHintDismissed);
  if (dismissed || pwa.installed || isStandalone()) return null;
  const close = () => {
    dismissInstallHint();
    setDismissed(true);
  };
  const ios = !pwa.installEvent && isIos();
  if (!pwa.installEvent && !ios) return null;
  return (
    <section className="card card-pad install-card" data-testid="install-prompt" aria-labelledby="install-h">
      <div className="install-head">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="install-icon" />
        <h2 id="install-h">Install a2b TAB on this device</h2>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        {ios ? (
          <p className="small" data-testid="install-ios-hint">
            Tap <IconShare size={16} className="inline-icon" /> <b>Share</b> in Safari's toolbar, then{' '}
            <b>Add to Home Screen</b>. Always open the app from the home-screen icon: it keeps its own data and works
            with no signal.
          </p>
        ) : (
          <p className="small">
            Opens full screen from the home screen or Start menu and works with no signal. Your projects stay as they
            are.
          </p>
        )}
        <div className="row" style={{ gap: 8 }}>
          {!ios && (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="install-app"
              onClick={() => void promptInstall()}
            >
              <IconInstall size={18} /> Install app
            </button>
          )}
          <button type="button" className="btn" data-testid="install-dismiss" onClick={close}>
            {ios ? 'Got it' : 'Not now'}
          </button>
        </div>
      </div>
    </section>
  );
}

/** "Update available — Reload" toast (a new service worker is waiting). */
export function UpdateToast() {
  const pwa = usePwa();
  const [busy, setBusy] = useState(false);
  if (!pwa.needRefresh || pwa.updateDismissed) return null;
  return (
    <div className="toast" role="status" data-testid="update-toast">
      <span className="toast-text">
        <IconRefresh size={18} className="inline-icon" /> <b>Update available.</b> Reload to use the new version; your
        entries are saved.
      </span>
      <span className="toast-actions">
        <button type="button" className="btn btn-ghost" data-testid="update-later" onClick={dismissUpdate}>
          Later
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          data-testid="update-reload"
          onClick={() => {
            setBusy(true);
            void applyUpdate();
          }}
        >
          {busy ? 'Reloading…' : 'Reload'}
        </button>
      </span>
    </div>
  );
}

const CHECK_TEXT: Record<UpdateCheck, string> = {
  available: 'A new version is ready: tap Reload in the message at the bottom.',
  current: 'This is the latest version.',
  offline: 'Offline: connect to check for updates.',
  unsupported: 'Updates are checked when the app is opened from its web address.',
};

/** The app's version and "Check for updates" (project list). */
export function AppVersion() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UpdateCheck | null>(null);
  const check = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkForUpdate());
    } catch {
      setResult('offline');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="small muted stack" style={{ alignItems: 'center', gap: 6, marginTop: 8 }} data-testid="app-version">
      <span>
        a2b TAB · version <span data-testid="app-build">{APP_BUILD}</span>
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={() => void check()}
        data-testid="check-update"
      >
        <IconRefresh size={16} /> {busy ? 'Checking…' : 'Check for updates'}
      </button>
      {result && (
        <span role="status" data-testid="check-update-result">
          {CHECK_TEXT[result]}
        </span>
      )}
    </div>
  );
}

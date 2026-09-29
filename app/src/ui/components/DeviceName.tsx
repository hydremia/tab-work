/**
 * The device's name ("Phone", "Laptop", …): every change carries it, so the history reads "Tech One · Phone" on all
 * devices (0007). Asked for by a banner while signed in without one, editable on Sync & account.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../data/db';
import { setDeviceName } from '../../data/identity';
import { useSync } from '../../sync/SyncProvider';

const SUGGESTIONS = ['Phone', 'Tablet', 'Laptop', 'Desktop'];

/** This device's name ('' when not given; undefined while loading). */
export function useDeviceName(): string | undefined {
  return useLiveQuery(async () => {
    const row = await db.meta.get('deviceName');
    return typeof row?.value === 'string' ? row.value : '';
  }, []);
}

export function DeviceNameForm({ current, compact = false }: { current: string; compact?: boolean }) {
  const [value, setValue] = useState(current);
  const save = (v: string) => {
    if (v.trim()) void setDeviceName(v);
  };
  return (
    <form
      className="device-name-form"
      data-testid="device-name-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(value);
      }}
    >
      <input
        className="input"
        aria-label="Device name"
        placeholder="e.g. Isaac's phone"
        maxLength={40}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={!value.trim() || value.trim() === current}>
        Save
      </button>
      {!compact && (
        <span className="device-name-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="btn btn-ghost btn-sm" onClick={() => setValue(s)}>
              {s}
            </button>
          ))}
        </span>
      )}
    </form>
  );
}

/** Banner while signed in and this device has no name. */
export function DeviceNameBanner() {
  const s = useSync();
  const name = useDeviceName();
  if (!s.user || name === undefined || name) return null;
  return (
    <div className="banner" data-tone="warn" data-testid="device-name-banner">
      <div className="banner-inner device-name-banner">
        <span>
          <b>Name this device</b> so everyone&apos;s history shows who changed what, and where (e.g. “Tech One ·
          Phone”).
        </span>
        <DeviceNameForm current="" />
      </div>
    </div>
  );
}

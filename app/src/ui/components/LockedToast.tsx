/**
 * An edit refused because the project's report was issued (locked) — typically when another device issued it while
 * this one had the form open: the lock arrives with a pull, the form turns read-only, and a value typed just before
 * cannot be saved. Inputs save without awaiting (`void setField(...)`), so the refusal surfaces as an unhandled
 * rejection; this catches LockedError there and says what happened instead of failing silently.
 */
import { useEffect, useState } from 'react';

export function LockedToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined;
      if (r?.name !== 'LockedError') return;
      e.preventDefault();
      setMsg(`Not saved: ${r.message ?? 'the project is locked.'}`);
    };
    window.addEventListener('unhandledrejection', onReject);
    return () => window.removeEventListener('unhandledrejection', onReject);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 8000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="toast" role="alert" data-testid="locked-toast">
      <span className="toast-text">{msg}</span>
      <div className="toast-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setMsg(null)}>
          OK
        </button>
      </div>
    </div>
  );
}

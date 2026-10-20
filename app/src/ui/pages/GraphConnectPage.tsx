/**
 * /auth/graph: Microsoft sends the browser back here after "Connect Microsoft 365" (auth/graph.ts, for the one-click
 * final report). Finishes the connection and returns to the page that started it.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { completeGraphConnect } from '../../auth/graph';
import { Screen } from '../components/Screen';

export function GraphConnectPage() {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    completeGraphConnect().then(
      ({ returnTo, account }) => nav(account ? returnTo : '/', { replace: true }),
      (e: unknown) => setErr(e instanceof Error ? e.message : String(e)),
    );
  }, [nav]);
  return (
    <Screen title="Connecting Microsoft 365" back="/">
      {err ? (
        <section className="card card-pad stack" data-testid="graph-connect-error">
          <h2>The connection didn&apos;t finish</h2>
          <p role="alert">{err}</p>
          <p className="small muted">
            If this keeps happening, ask your Microsoft 365 admin whether the TAB App may use a folder in your OneDrive
            for the PDF conversion (permission <i>Files.ReadWrite.AppFolder</i>, see the setup guide, section 4.5).
          </p>
          <Link className="btn btn-primary" to="/">
            Back to projects
          </Link>
        </section>
      ) : (
        <p className="muted">Finishing the Microsoft 365 connection…</p>
      )}
    </Screen>
  );
}

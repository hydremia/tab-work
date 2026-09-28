/**
 * QR equipment tags (tags/tags.ts):
 *  - TagsPage   /p/:projectId/tags   pick units, preview, download a PDF of 2 in. labels to print and stick on units;
 *  - TagPage    /t/:projectId/:unitId what a scanned tag opens: the unit's page, or why it can't be shown here;
 *  - ScanPage   /scan                scan a tag with the camera in the app (BarcodeDetector where the browser has it,
 *                                    else jsQR on camera frames; loaded only here).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { db } from '../../data/db';
import { useEquipmentList, useProject } from '../../data/hooks';
import type { Equipment } from '../../data/types';
import { EQUIPMENT_TYPES, equipmentType } from '../../domain/equipmentTypes';
import { downloadFile } from '../../reports/generate';
import { useSync } from '../../sync/SyncProvider';
import { parseTagUrl, qrSvg, tagsPdf, tagUrl } from '../../tags/tags';
import { Screen } from '../components/Screen';

const origin = () => window.location.origin;

function QrPreview({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => qrSvg(url), [url]);
  return (
    <figure className="tag-preview" data-testid="tag-preview">
      <span
        className="tag-qr"
        role="img"
        aria-label={`QR code for ${label}`}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <figcaption>
        <b>{label}</b>
      </figcaption>
    </figure>
  );
}

export function TagsPage() {
  const { projectId } = useParams();
  const project = useProject(projectId);
  const units = useEquipmentList(projectId);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const sorted = useMemo(() => {
    const order = new Map(EQUIPMENT_TYPES.map((t, i) => [t.key, i]));
    return [...(units ?? [])].sort((a, b) => (order.get(a.type) ?? 0) - (order.get(b.type) ?? 0) || a.slot - b.slot);
  }, [units]);
  if (project === null) return <Navigate to="/" replace />;
  if (!project || !units) return <Screen title="QR tags">Loading…</Screen>;
  const chosen = sorted.filter((u) => !off.has(u.id));
  const toggle = (u: Equipment) => {
    const next = new Set(off);
    if (next.has(u.id)) next.delete(u.id);
    else next.add(u.id);
    setOff(next);
  };
  const download = async () => {
    setBusy(true);
    try {
      const bytes = await tagsPdf(
        chosen.map((u) => ({
          url: tagUrl(origin(), project.id, u.id),
          designation: u.designation || equipmentType(u.type).label,
          typeLabel: equipmentType(u.type).label,
          project: project.name,
        })),
      );
      downloadFile(bytes, `${project.name.replace(/[\\/:*?"<>|]+/g, '-')} - QR tags.pdf`, 'application/pdf');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title="QR tags" subtitle={project.name} back={`/p/${project.id}/equipment`}>
      <section className="card card-pad stack">
        <p className="small muted" style={{ margin: 0 }}>
          A 2 in. label per unit: print on plain paper and cut, or on 2 in. square label sheets (12 per Letter page),
          and stick it on the unit. Scanning it with a phone camera, or with <b>Scan tag</b> in the app, opens the
          unit&apos;s page. Print at 100% (no “fit to page”).
        </p>
        {sorted.length === 0 ? (
          <p className="muted">No units yet.</p>
        ) : (
          <>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOff(new Set())}>
                All
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOff(new Set(sorted.map((u) => u.id)))}
              >
                None
              </button>
            </div>
            <ul className="tag-list">
              {sorted.map((u) => (
                <li key={u.id}>
                  <label>
                    <input type="checkbox" checked={!off.has(u.id)} onChange={() => toggle(u)} /> <b>{u.designation}</b>{' '}
                    <span className="small muted">{equipmentType(u.type).label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !chosen.length}
              onClick={() => void download()}
              data-testid="tags-download"
            >
              Download PDF ({chosen.length} label{chosen.length === 1 ? '' : 's'})
            </button>
          </>
        )}
      </section>
      {chosen.length > 0 && (
        <section className="card card-pad stack" aria-label="Preview">
          <h2>Preview</h2>
          <div className="tag-grid">
            {chosen.slice(0, 3).map((u) => (
              <QrPreview key={u.id} url={tagUrl(origin(), project.id, u.id)} label={u.designation} />
            ))}
          </div>
        </section>
      )}
    </Screen>
  );
}

/** What a scanned tag opens. */
export function TagPage() {
  const { projectId, unitId } = useParams();
  const { status } = useSync();
  const found = useLiveQuery(
    async () => ({
      key: `${projectId}/${unitId}`,
      project: projectId ? ((await db.projects.get(projectId)) ?? null) : null,
      unit: unitId ? ((await db.equipment.get(unitId)) ?? null) : null,
    }),
    [projectId, unitId],
  );
  // (the previous tag's result until this one's query has run)
  if (!found || found.key !== `${projectId}/${unitId}`) return <Screen title="Equipment tag">Loading…</Screen>;
  if (found.unit && found.unit.projectId === projectId) return <Navigate to={`/p/${projectId}/e/${unitId}`} replace />;
  return (
    <Screen title="Equipment tag" back="/">
      <section className="card card-pad stack" data-testid="tag-missing">
        <h2>{found.project ? 'This unit is not in the project any more' : 'This project is not on this device'}</h2>
        <p style={{ margin: 0 }}>
          {found.project ? (
            <>
              The tag belongs to <b>{found.project.name}</b>, but its unit was deleted.{' '}
              <Link to={`/p/${projectId}/equipment`}>Open the project</Link>.
            </>
          ) : status === 'local' ? (
            'Tags open projects that are on this device. In local mode each device has its own projects: open the tag on the device the project is on, or import its workbook here.'
          ) : (
            'It may not have synced yet: tap the status pill → Sync now, then scan again. If it still does not open, the project was deleted or belongs to another organization.'
          )}
        </p>
      </section>
    </Screen>
  );
}

type Detector = { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> };

/** Scan a tag with the camera. */
export function ScanPage() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('This browser cannot use the camera here. Scan the tag with the phone’s Camera app instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      } catch {
        setError(
          'The camera is not available (permission denied or in use). Scan the tag with the phone’s Camera app instead.',
        );
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => undefined);
      const BD = (window as unknown as { BarcodeDetector?: new (o: object) => Detector }).BarcodeDetector;
      const detector = BD ? new BD({ formats: ['qr_code'] }) : null;
      const jsQR = detector ? null : (await import('jsqr')).default;
      const tick = async () => {
        if (stopped) return;
        let text: string | null = null;
        if (v.videoWidth) {
          if (detector) text = (await detector.detect(v).catch(() => []))[0]?.rawValue ?? null;
          else if (jsQR) {
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight * w) / v.videoWidth);
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, w, h);
            text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h)?.data ?? null;
          }
        }
        const tag = text ? parseTagUrl(text) : null;
        if (tag) {
          stopped = true;
          navigate(`/t/${tag.projectId}/${tag.unitId}`);
          return;
        }
        if (text) setSeen(text);
        timer = setTimeout(() => void tick(), 250);
      };
      void tick();
    };
    void start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [navigate]);
  return (
    <Screen title="Scan tag" back="/">
      <section className="card card-pad stack">
        {error ? (
          <p className="callout" data-tone="amber" role="alert" data-testid="scan-error">
            {error}
          </p>
        ) : (
          <>
            <video ref={video} className="scan-video" playsInline muted aria-label="Camera" />
            <p className="small muted" style={{ margin: 0 }}>
              Point the camera at a unit&apos;s QR tag.
            </p>
          </>
        )}
        {seen && (
          <p className="small" data-testid="scan-other">
            That code is not a TAB App tag ({seen.length > 60 ? `${seen.slice(0, 59)}…` : seen}).
          </p>
        )}
      </section>
    </Screen>
  );
}

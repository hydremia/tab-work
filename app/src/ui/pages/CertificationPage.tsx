/**
 * /certification: the organization's certification profile. The certified professional's name, number and expiration
 * (new projects start with them) and the stamp and signature images that every export places on the workbook's
 * Certification sheet (stamp box, signature line). Stored once and shared with the team when signed in.
 */
import { useRef, useState } from 'react';
import { useCertProfile, useCertProfileConflicts } from '../../data/hooks';
import { certDefaults, ensureCertProfile, setCertImage, setField } from '../../data/repo';
import type { CertProfile, StoredImage } from '../../data/types';
import { CERT_KEYS } from '../../domain/certification';
import { processCertImage } from '../../certification/images';
import { ConflictList } from '../components/Conflicts';
import { IconTrash, IconUpload } from '../components/Icons';
import { DateInput, TextInput } from '../components/inputs';
import { Screen } from '../components/Screen';

type Kind = 'stamp' | 'signature';

const KIND_TEXT: Record<Kind, { title: string; where: string; tip: string }> = {
  stamp: {
    title: 'Stamp',
    where: 'Placed in the stamp box of the Certification sheet, centred.',
    tip: 'A scan or photo of the stamp, cropped close. A PNG with a transparent background prints best.',
  },
  signature: {
    title: 'Signature',
    where: 'Placed on the signature line of the Certification sheet, over the signer’s name.',
    tip: 'Draw it here with a finger or stylus, or pick a scan (dark ink on white or transparent).',
  },
};

async function editProfile(key: keyof Pick<CertProfile, 'cpName' | 'certNumber' | 'expiration'>, value: string) {
  const p = await ensureCertProfile();
  await setField('certProfiles', p.id, key, value);
}

/** Draw a signature (pointer events on a canvas; transparent background, dark ink). */
function SignaturePad({ onSave, onCancel }: { onSave: (b: Blob) => Promise<void>; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [busy, setBusy] = useState(false);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const ctx = () => {
    const x = canvas.current!.getContext('2d')!;
    x.lineWidth = 5;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.strokeStyle = '#0b1a4a';
    return x;
  };
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="signature-pad">
      <canvas
        ref={canvas}
        width={900}
        height={300}
        className="signature-canvas"
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          drawing.current = true;
          const p = point(e);
          const x = ctx();
          x.beginPath();
          x.moveTo(p.x, p.y);
          x.lineTo(p.x + 0.1, p.y + 0.1);
          x.stroke();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = point(e);
          const x = ctx();
          x.lineTo(p.x, p.y);
          x.stroke();
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <div className="row-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            const c = canvas.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
          }}
        >
          Clear
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={empty || busy}
          data-testid="signature-pad-save"
          onClick={() => {
            setBusy(true);
            canvas.current!.toBlob(async (b) => {
              try {
                if (b) await onSave(b);
              } finally {
                setBusy(false);
              }
            }, 'image/png');
          }}
        >
          Use this signature
        </button>
      </div>
    </div>
  );
}

function ImageCard({ kind, image }: { kind: Kind; image: StoredImage | null }) {
  const [error, setError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const t = KIND_TEXT[kind];
  const save = async (blob: Blob) => {
    setError(null);
    setBusy(true);
    try {
      await setCertImage(kind, await processCertImage(blob, kind));
      setDrawing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card card-pad stack" aria-labelledby={`cert-${kind}-h`} data-testid={`cert-${kind}`}>
      <h2 id={`cert-${kind}-h`}>{t.title}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {t.where} {t.tip}
      </p>
      {image ? (
        <div className="cert-image-preview">
          <img src={image.dataUrl} alt={`${t.title} image`} data-testid={`cert-${kind}-img`} />
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }} data-testid={`cert-${kind}-none`}>
          No {kind} yet: exports leave the {kind === 'stamp' ? 'stamp box' : 'signature line'} for Excel.
        </p>
      )}
      {drawing ? (
        <SignaturePad onSave={save} onCancel={() => setDrawing(false)} />
      ) : (
        <div className="row-actions">
          {kind === 'signature' && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setDrawing(true)}>
              Draw signature
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
            <IconUpload size={16} /> {image ? 'Replace' : 'Choose'} picture
          </button>
          {image && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              data-testid={`cert-${kind}-remove`}
              onClick={() => {
                if (window.confirm(`Remove the ${kind}? Later exports will not have it.`))
                  void setCertImage(kind, null);
              }}
            >
              <IconTrash size={16} /> Remove
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/*"
            hidden
            aria-label={`${t.title} picture`}
            data-testid={`cert-${kind}-file`}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void save(f);
            }}
          />
        </div>
      )}
      {error && (
        <div className="callout" data-tone="red" role="alert">
          {error}
        </div>
      )}
    </section>
  );
}

export function CertificationPage() {
  const profile = useCertProfile();
  const conflicts = useCertProfileConflicts();
  const defaults = certDefaults(profile ?? undefined);
  const value = {
    cpName: profile?.cpName ?? defaults[CERT_KEYS.cpName],
    certNumber: profile?.certNumber ?? defaults[CERT_KEYS.number],
    expiration: profile?.expiration ?? defaults[CERT_KEYS.expiration],
  };
  return (
    <Screen title="Certification" back="/">
      {conflicts && conflicts.length > 0 && (
        <section className="card card-pad stack" data-testid="cert-conflicts">
          <h2>Sync conflicts</h2>
          <ConflictList conflicts={conflicts} />
        </section>
      )}
      <section className="card card-pad stack" aria-labelledby="cp-h" data-testid="cert-profile">
        <h2 id="cp-h">Certified professional</h2>
        <p className="small muted" style={{ margin: 0 }}>
          New projects start with these lines on their Certification sheet (each project can change its own on the Info
          tab). The stamp and signature below go on <b>every export</b>. Shared with the team when you are signed in.
        </p>
        {profile !== undefined && (
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="cp-name">
                NEBB certified professional
              </label>
              <TextInput id="cp-name" value={value.cpName} onCommit={(v) => void editProfile('cpName', v.trim())} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="cp-number">
                Certification number
              </label>
              <TextInput
                id="cp-number"
                value={value.certNumber}
                onCommit={(v) => void editProfile('certNumber', v.trim())}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="cp-exp">
                Expiration date
              </label>
              <DateInput
                id="cp-exp"
                value={value.expiration}
                onCommit={(v) => void editProfile('expiration', v ?? '')}
              />
            </div>
          </div>
        )}
      </section>
      {profile !== undefined && (
        <>
          <ImageCard kind="stamp" image={profile?.stamp ?? null} />
          <ImageCard kind="signature" image={profile?.signature ?? null} />
        </>
      )}
    </Screen>
  );
}

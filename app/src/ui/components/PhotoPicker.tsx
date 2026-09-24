import { useState, type DragEvent, type ReactNode } from 'react';
import type { PhotoTarget } from '../../data/repo';
import { savePhotoFile } from '../../photos/capture';
import { IconCamera, IconUpload } from './Icons';

/** Process + store picked files one at a time; exposes progress and the last error for the UI. */
export function usePhotoSaver(projectId: string) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save(files: readonly File[], target: PhotoTarget, opts: { replace?: boolean } = {}) {
    if (!files.length) return;
    setError(null);
    const errors: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setBusy(files.length > 1 ? `Processing ${i + 1} of ${files.length}…` : 'Processing…');
      try {
        await savePhotoFile(projectId, files[i], target, opts);
      } catch (e) {
        errors.push(`${files.length > 1 ? `${files[i].name}: ` : ''}${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setBusy(null);
    if (errors.length) setError(errors.join('\n'));
  }
  return { busy, error, save, clearError: () => setError(null) };
}

const imageFiles = (list: FileList | null | undefined) =>
  [...(list ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|hei[cf]|webp|gif)$/i.test(f.name));

/**
 * "Take photo" (opens the camera on phones: capture="environment") and "Choose" (camera roll / file picker,
 * optionally several). The library input carries `label` as its accessible name, the camera input `${label} (camera)`.
 */
export function PhotoPicker({
  label,
  onFiles,
  multiple = false,
  takeText = 'Take photo',
  chooseText = 'Choose',
  disabled = false,
  compact = false,
}: {
  label: string;
  /** Icon-only buttons (narrow photo slots); the text stays for screen readers and as a tooltip. */
  compact?: boolean;
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  takeText?: string;
  chooseText?: string;
  disabled?: boolean;
}) {
  return (
    <div className="photo-picker">
      <label className="btn file-btn picker-camera" aria-disabled={disabled} title={takeText}>
        <IconCamera size={18} /> {compact ? <span className="visually-hidden">{takeText}</span> : takeText}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          aria-label={`${label} (camera)`}
          disabled={disabled}
          onChange={(e) => {
            onFiles(imageFiles(e.target.files));
            e.target.value = '';
          }}
        />
      </label>
      <label className="btn file-btn" aria-disabled={disabled} title={chooseText}>
        <IconUpload size={18} /> {compact ? <span className="visually-hidden">{chooseText}</span> : chooseText}
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          aria-label={label}
          disabled={disabled}
          onChange={(e) => {
            onFiles(imageFiles(e.target.files));
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/** Wraps content in a drop target for image files (desktop drag & drop). */
export function DropZone({
  onFiles,
  children,
  hint = 'or drop photos here',
}: {
  onFiles: (files: File[]) => void;
  children: ReactNode;
  hint?: string;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    onFiles(imageFiles(e.dataTransfer.files));
  };
  return (
    <div
      className="drop-zone"
      data-over={over || undefined}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {children}
      <span className="drop-hint small muted">{hint}</span>
    </div>
  );
}

export function SaverStatus({
  busy,
  error,
  onDismiss,
}: {
  busy: string | null;
  error: string | null;
  onDismiss: () => void;
}) {
  if (busy)
    return (
      <div className="small muted" role="status" data-testid="photo-busy">
        {busy}
      </div>
    );
  if (error)
    return (
      <div className="callout" data-tone="red" role="alert" data-testid="photo-error">
        <div style={{ whiteSpace: 'pre-line' }}>{error}</div>
        <button type="button" className="link-btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  return null;
}

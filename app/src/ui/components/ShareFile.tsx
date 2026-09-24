import { useMemo, useState } from 'react';
import { IconDownload, IconShare } from './Icons';

/**
 * After an export: "Share…" through the Web Share API (navigator.share with files: the phone's share sheet, e.g.
 * straight to Dropbox), where the browser can share this file type; otherwise "Download again" (the file was already
 * downloaded once). iOS Safari shares any file; Chrome on Android shares PDFs but not .xlsm / .zip files, so there
 * the download (and Dropbox → Upload) stays the way.
 */
export function canShareFile(file: File): boolean {
  try {
    return (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

export function ShareFile({
  bytes,
  fileName,
  mime,
  onDownload,
  testId = 'share-file',
}: {
  bytes: Uint8Array;
  fileName: string;
  mime: string;
  /** Fallback: download the file again. */
  onDownload: () => void;
  testId?: string;
}) {
  const file = useMemo(() => new File([bytes as BlobPart], fileName, { type: mime }), [bytes, fileName, mime]);
  const shareable = useMemo(() => canShareFile(file), [file]);
  const [note, setNote] = useState<string | null>(null);

  async function share() {
    setNote(null);
    try {
      await navigator.share({ files: [file], title: fileName });
    } catch (e) {
      // AbortError: the user closed the share sheet
      if (e instanceof Error && e.name === 'AbortError') return;
      setNote('Sharing did not work on this device; the file was downloaded instead.');
      onDownload();
    }
  }

  return (
    <div className="row" style={{ gap: 8, marginTop: 8 }}>
      {shareable ? (
        <button type="button" className="btn btn-primary" data-testid={testId} onClick={() => void share()}>
          <IconShare size={18} /> Share…
        </button>
      ) : (
        <button type="button" className="btn" data-testid={`${testId}-download`} onClick={onDownload}>
          <IconDownload size={18} /> Download again
        </button>
      )}
      {shareable && <span className="small muted">Send it to Dropbox, Files, Mail … from the share sheet.</span>}
      {note && (
        <span className="small" role="status">
          {note}
        </span>
      )}
    </div>
  );
}

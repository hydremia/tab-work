import { useEffect, useMemo } from 'react';

/** Thumbnail of a stored Blob (object URL revoked on unmount); a placeholder while the file is not on the device. */
export function PhotoThumb({ blob, alt }: { blob: Blob | null | undefined; alt: string }) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (!url)
    return (
      <span className="photo-pending" role="img" aria-label={`${alt} (downloading)`}>
        Downloading…
      </span>
    );
  return <img src={url} alt={alt} loading="lazy" />;
}

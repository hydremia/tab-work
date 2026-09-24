import { useEffect, useMemo } from 'react';

/** Thumbnail of a stored Blob (object URL revoked on unmount). */
export function PhotoThumb({ blob, alt }: { blob: Blob; alt: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={alt} loading="lazy" />;
}

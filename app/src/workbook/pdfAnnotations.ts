/**
 * The markup annotations of a plan page (pdf.js): the text boxes a tech labels outlets with ("3A", "1RA", "D1B") and
 * the shapes drawn round each system (polygons, ink strokes, rectangles, highlights), on the upright page in points
 * with y downwards, the frame of the plan's devices. The app's own markup (reports/planMarkup.ts) reads back the same
 * way, so a sheet marked in the app or in Bluebeam / Acrobat / Drawboard imports alike (domain/markupImport.ts).
 */

export interface MarkupLabel {
  text: string;
  /** the box's centre and box, points, y downwards */
  x: number;
  y: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  /** the text colour (#rrggbb), else the annotation colour, else null */
  color: string | null;
}

export interface MarkupShape {
  kind: 'polygon' | 'ink' | 'rect' | 'highlight';
  /** the outline, points, y downwards (an ink stroke: its points; a highlight: the hull of its quads) */
  points: [number, number][];
  color: string | null;
}

export interface PageAnnotations {
  labels: MarkupLabel[];
  shapes: MarkupShape[];
}

const hex = (c: ArrayLike<number> | null | undefined): string | null =>
  c && c.length >= 3 ? `#${[c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : null;

/** The labels and shapes of one page. */
export async function readPlanAnnotations(bytes: Uint8Array, pageNo: number): Promise<PageAnnotations> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNo);
    const view = page.getViewport({ scale: 1 });
    const pt = (x: number, y: number): [number, number] => {
      const [vx, vy] = view.convertToViewportPoint(x, y);
      return [vx, vy];
    };
    const rectPts = (r: ArrayLike<number>): [number, number][] =>
      [pt(r[0], r[1]), pt(r[2], r[1]), pt(r[2], r[3]), pt(r[0], r[3])] as [number, number][];
    const annots = (await page.getAnnotations({ intent: 'display' })) as Record<string, unknown>[];
    const labels: MarkupLabel[] = [];
    const shapes: MarkupShape[] = [];
    for (const a of annots) {
      const subtype = String(a.subtype ?? '');
      const rect = a.rect as ArrayLike<number> | undefined;
      const color = hex(a.color as ArrayLike<number> | null);
      if (subtype === 'FreeText') {
        const text = String(
          (a.contentsObj as { str?: string } | undefined)?.str ??
            (Array.isArray(a.textContent) ? (a.textContent as string[]).join(' ') : ''),
        ).trim();
        if (!text || !rect) continue;
        const da = a.defaultAppearanceData as { fontColor?: ArrayLike<number> } | undefined;
        const pts = rectPts(rect);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
        labels.push({
          text,
          x: (box.x0 + box.x1) / 2,
          y: (box.y0 + box.y1) / 2,
          box,
          color: hex(da?.fontColor) ?? (color && color !== '#ffffff' ? color : null),
        });
      } else if (subtype === 'Polygon' || subtype === 'PolyLine') {
        const v = a.vertices as ArrayLike<number> | null;
        if (!v || v.length < 6) continue;
        const points: [number, number][] = [];
        for (let i = 0; i + 1 < v.length; i += 2) points.push(pt(v[i], v[i + 1]));
        shapes.push({ kind: 'polygon', points, color: hex(a.interiorColor as ArrayLike<number> | null) ?? color });
      } else if (subtype === 'Ink') {
        const lists = (a.inkLists as ArrayLike<number>[] | undefined) ?? [];
        for (const l of lists) {
          const points: [number, number][] = [];
          // pdf.js gives a flat list or point objects depending on the version
          if (typeof l[0] === 'number') for (let i = 0; i + 1 < l.length; i += 2) points.push(pt(l[i], l[i + 1]));
          else for (const q of l as unknown as { x: number; y: number }[]) points.push(pt(q.x, q.y));
          if (points.length >= 3) shapes.push({ kind: 'ink', points, color });
        }
      } else if (subtype === 'Square') {
        if (rect)
          shapes.push({
            kind: 'rect',
            points: rectPts(rect),
            color: hex(a.interiorColor as ArrayLike<number> | null) ?? color,
          });
      } else if (subtype === 'Highlight') {
        const q = a.quadPoints as ArrayLike<number> | null;
        const points: [number, number][] = [];
        if (q) for (let i = 0; i + 1 < q.length; i += 2) points.push(pt(q[i], q[i + 1]));
        else if (rect) points.push(...rectPts(rect));
        if (points.length >= 3) shapes.push({ kind: 'highlight', points: hull(points), color });
      }
    }
    page.cleanup();
    return { labels, shapes };
  } finally {
    await task.destroy();
  }
}

/** Convex hull (monotone chain), for a highlight's quads. */
export function hull(points: readonly [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

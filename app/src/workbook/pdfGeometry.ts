/**
 * The vector geometry of PDF pages (pdf.js operator list): every stroked or filled path as polylines, on the upright
 * page in points with y downwards (the same frame as the plan's words in domain/planDevices.ts). For the plan reader
 * (ROADMAP §7.3): the diffuser symbols the tags point at, the leaders from a tag to its symbol, duct outlines.
 *
 * pdf.js hands the content stream back as operators; a path arrives as one `constructPath` op whose data is the
 * compact DrawOPS list (moveTo / lineTo / curveTo / quadraticCurveTo / closePath with coordinates in the current
 * user space). The current transformation matrix is tracked here (save / restore / transform / form XObjects) and
 * the viewport transform brings a rotated sheet upright. Curves are flattened to a few segments: symbols and ducts
 * are straight-edged, and an arc only needs its extent.
 */

export interface PlanPath {
  /** polyline points on the upright page, points, y downwards */
  pts: [number, number][];
  closed: boolean;
  /** how it was painted */
  paint: 'stroke' | 'fill' | 'fillStroke';
  /** stroke width in page points (0 for a filled path) */
  lineWidth: number;
  /** bounding box */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PdfPageGeometry {
  page: number;
  width: number;
  height: number;
  paths: PlanPath[];
}

/** Drawing sets can be long: pages read at most. */
export const MAX_GEOMETRY_PAGES = 50;
/** A page's paths at most (a dense plan has tens of thousands; past this the rest is left out). */
export const MAX_PATHS = 400_000;

type Matrix = [number, number, number, number, number, number];

const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
/** the scale a matrix applies to lengths (geometric mean of its axes) */
const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;

// pdf.js OPS / DrawOPS codes (stable across versions; checked against pdfjs-dist 6.x)
const OP = {
  setLineWidth: 2,
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
} as const;
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;

const paintOf = (fn: number): PlanPath['paint'] | null => {
  switch (fn) {
    case OP.stroke:
    case OP.closeStroke:
      return 'stroke';
    case OP.fill:
    case OP.eoFill:
      return 'fill';
    case OP.fillStroke:
    case OP.eoFillStroke:
    case OP.closeFillStroke:
    case OP.closeEOFillStroke:
      return 'fillStroke';
    default:
      return null; // endPath (a clip), unknown
  }
};

/** A compact DrawOPS list into polylines in the given frame (one per subpath). */
export function pathsFromDrawOps(
  data: ArrayLike<number>,
  ctm: Matrix,
  paint: PlanPath['paint'],
  lineWidth: number,
): PlanPath[] {
  const out: PlanPath[] = [];
  let pts: [number, number][] = [];
  let closed = false;
  let cur: [number, number] = [0, 0];
  const flush = () => {
    if (pts.length >= 2 || (pts.length === 1 && closed)) {
      let x0 = Infinity,
        y0 = Infinity,
        x1 = -Infinity,
        y1 = -Infinity;
      for (const [x, y] of pts) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      out.push({ pts, closed, paint, lineWidth, x0, y0, x1, y1 });
    }
    pts = [];
    closed = false;
  };
  const bezier = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]) => {
    // 4 segments: enough for a symbol's arc; the extent stays within a fraction of a point
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
  };
  for (let i = 0; i < data.length;) {
    switch (data[i++]) {
      case DRAW.moveTo: {
        flush();
        cur = [data[i++], data[i++]];
        pts.push(apply(ctm, cur[0], cur[1]));
        break;
      }
      case DRAW.lineTo: {
        cur = [data[i++], data[i++]];
        pts.push(apply(ctm, cur[0], cur[1]));
        break;
      }
      case DRAW.curveTo: {
        const p1 = apply(ctm, data[i++], data[i++]);
        const p2 = apply(ctm, data[i++], data[i++]);
        const x = data[i++];
        const y = data[i++];
        const p0 = apply(ctm, cur[0], cur[1]);
        cur = [x, y];
        bezier(p0, p1, p2, apply(ctm, x, y));
        break;
      }
      case DRAW.quadraticCurveTo: {
        const q = apply(ctm, data[i++], data[i++]);
        const x = data[i++];
        const y = data[i++];
        const p0 = apply(ctm, cur[0], cur[1]);
        const p3 = apply(ctm, x, y);
        cur = [x, y];
        bezier(
          p0,
          [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])],
          [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])],
          p3,
        );
        break;
      }
      case DRAW.closePath:
        closed = true;
        if (pts.length) cur = [cur[0], cur[1]];
        flush();
        break;
      default:
        return out; // unknown op: stop rather than mis-read the rest
    }
  }
  flush();
  return out;
}

/**
 * The geometry of the pages of a PDF (1-based page numbers in `only`, else the first MAX_GEOMETRY_PAGES). Lazy-loads
 * pdf.js like workbook/pdfText.ts; parses in its worker in the browser.
 */
export async function readPdfGeometry(
  bytes: Uint8Array,
  only?: readonly number[],
  maxPages = MAX_GEOMETRY_PAGES,
): Promise<{ pages: PdfPageGeometry[]; pageCount: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  // a copy: pdf.js transfers the buffer to its worker, and the caller may read the same bytes again (text, then geometry)
  const task = pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const wanted = only ? only.filter((n) => n >= 1 && n <= doc.numPages) : [];
    const numbers = only
      ? wanted.slice(0, maxPages)
      : Array.from({ length: Math.min(doc.numPages, maxPages) }, (_, i) => i + 1);
    const pages: PdfPageGeometry[] = [];
    for (const n of numbers) {
      const page = await doc.getPage(n);
      const view = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const base = view.transform as Matrix; // PDF user space -> upright page, y downwards
      const stack: { ctm: Matrix; lineWidth: number }[] = [];
      let ctm: Matrix = base;
      let lineWidth = 1;
      const paths: PlanPath[] = [];
      for (let i = 0; i < ops.fnArray.length && paths.length < MAX_PATHS; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i] as unknown[];
        switch (fn) {
          case OP.save:
            stack.push({ ctm, lineWidth });
            break;
          case OP.restore: {
            const s = stack.pop();
            if (s) ({ ctm, lineWidth } = s);
            break;
          }
          case OP.transform:
            ctm = mul(args as unknown as Matrix, ctm);
            break;
          case OP.setLineWidth:
            lineWidth = Number(args[0]) || 0;
            break;
          case OP.paintFormXObjectBegin: {
            stack.push({ ctm, lineWidth });
            const m = args[0] as Matrix | null;
            if (m && m.length === 6) ctm = mul(m, ctm);
            break;
          }
          case OP.paintFormXObjectEnd: {
            const s = stack.pop();
            if (s) ({ ctm, lineWidth } = s);
            break;
          }
          case OP.constructPath: {
            const paint = paintOf(Number(args[0]));
            const data = (args[1] as (ArrayLike<number> | null)[] | undefined)?.[0];
            if (!paint || !data) break;
            const lw = paint === 'fill' ? 0 : lineWidth * scaleOf(ctm);
            for (const p of pathsFromDrawOps(data, ctm, paint, lw)) paths.push(p);
            break;
          }
          default:
            break;
        }
      }
      pages.push({ page: n, width: view.width, height: view.height, paths });
      page.cleanup();
    }
    return { pages, pageCount: doc.numPages };
  } finally {
    await task.destroy();
  }
}

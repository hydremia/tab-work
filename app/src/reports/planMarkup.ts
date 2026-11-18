/**
 * The marked-up plan (ROADMAP §7.3, the plan from steps 2 and 3 as the report graphic): a copy of the drawing file
 * with, on the sheet's page, each system as a filled polygon in its colour at half opacity and each device labelled
 * ("1A", "1RB", "D1C") in that colour. Written as real PDF annotations (Polygon and FreeText, with appearance
 * streams so every viewer shows them), the way the a2b markups are made today, so a tech can keep editing them in
 * their PDF app; `flatten` draws them into the page instead, for a report appendix.
 *
 * Systems read from the tech's own markup (Import markup, `source: 'markup'`) are not drawn: their highlights and tags
 * are already in the drawing file, which goes through as it is (its annotations kept) rather than tagged twice.
 */
import { PDFDocument, PDFString, rgb, StandardFonts, type PDFFont, type PDFPage, type PDFRef } from 'pdf-lib';
import type { Equipment, PlanSheet } from '../data/types';
import { fromMarkup, systemLabel } from '../domain/planSystems';

const hex = (c: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim());
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 0.5, 0.6];
};

const LABEL_SIZE = 12;
const FILL_ALPHA = 0.5;
const LABEL_PAD = 2;

interface Mark {
  polygon: [number, number][];
  color: [number, number, number];
  labels: { x: number; y: number; text: string }[];
  name: string;
}

/**
 * The marks of a sheet: polygons in page points (y downwards) with each device's label at its place, for the systems
 * lassoed in the app (a system from the tech's markup is already on the drawing).
 */
export function sheetMarks(sheet: PlanSheet, equipment: readonly Pick<Equipment, 'id' | 'designation'>[]): Mark[] {
  const byKey = new Map(sheet.devices.map((d) => [d.key, d]));
  return sheet.systems
    .filter((s) => !fromMarkup(s))
    .map((s) => ({
      polygon: s.polygon,
      color: hex(s.color),
      name: `${equipment.find((e) => e.id === s.equipmentId)?.designation ?? s.prefix} ${s.table}`,
      labels: s.deviceKeys.flatMap((k, i) => {
        const d = byKey.get(k);
        return d ? [{ x: d.x, y: d.y, text: systemLabel(s, i) }] : [];
      }),
    }));
}

/** A label's box (PDF user space, y up) beside its device: right of the marker, vertically centred. */
function labelBox(font: PDFFont, pageHeight: number, l: { x: number; y: number; text: string }) {
  const w = font.widthOfTextAtSize(l.text, LABEL_SIZE) + 2 * LABEL_PAD;
  const h = LABEL_SIZE + 2 * LABEL_PAD;
  const x = l.x + 9;
  const y = pageHeight - l.y - h / 2;
  return { x, y, w, h };
}

/** Polygon annotation with an appearance stream (filled at half opacity, outlined). */
function addPolygon(doc: PDFDocument, page: PDFPage, m: Mark, pageHeight: number) {
  const ctx = doc.context;
  const pts = m.polygon.map(([x, y]) => [x, pageHeight - y] as const);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const [r, g, b] = m.color;
  const gs = ctx.obj({ Type: 'ExtGState', CA: FILL_ALPHA, ca: FILL_ALPHA });
  const ops = [
    '/GS gs',
    `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
    `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} RG`,
    '1 w',
    ...pts.map(([x, y], i) => `${x.toFixed(2)} ${y.toFixed(2)} ${i === 0 ? 'm' : 'l'}`),
    'h B',
  ].join('\n');
  const ap = ctx.stream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: rect,
    Resources: ctx.obj({ ExtGState: ctx.obj({ GS: gs }) }),
  });
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'Polygon',
    Rect: rect,
    Vertices: pts.flatMap(([x, y]) => [x, y]),
    C: [r, g, b],
    IC: [r, g, b],
    CA: FILL_ALPHA,
    F: 4,
    T: PDFString.of('a2b TAB App'),
    Subj: PDFString.of('Polygon'),
    Contents: PDFString.of(m.name),
    AP: ctx.obj({ N: ctx.register(ap) }),
  });
  page.node.addAnnot(ctx.register(annot));
}

/** FreeText annotation: the label in the system's colour on a white box, with its appearance stream. */
function addLabel(
  doc: PDFDocument,
  page: PDFPage,
  font: PDFFont,
  fontRef: PDFRef,
  color: [number, number, number],
  pageHeight: number,
  l: { x: number; y: number; text: string },
) {
  const ctx = doc.context;
  const { x, y, w, h } = labelBox(font, pageHeight, l);
  const [r, g, b] = color;
  const da = `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg /Helv ${LABEL_SIZE} Tf`;
  const ops = [
    '1 1 1 rg',
    `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} RG`,
    '0.8 w',
    `0.4 0.4 ${(w - 0.8).toFixed(2)} ${(h - 0.8).toFixed(2)} re B`,
    'BT',
    `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`,
    `/Helv ${LABEL_SIZE} Tf`,
    `${LABEL_PAD} ${(LABEL_PAD + LABEL_SIZE * 0.22).toFixed(2)} Td`,
    `(${l.text.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj`,
    'ET',
  ].join('\n');
  const ap = ctx.stream(ops, {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, w, h],
    Resources: ctx.obj({ Font: ctx.obj({ Helv: fontRef }) }),
  });
  const annot = ctx.obj({
    Type: 'Annot',
    Subtype: 'FreeText',
    Rect: [x, y, x + w, y + h],
    Contents: PDFString.of(l.text),
    DA: PDFString.of(da),
    C: [1, 1, 1],
    F: 4,
    T: PDFString.of('a2b TAB App'),
    Subj: PDFString.of('Text Box'),
    AP: ctx.obj({ N: ctx.register(ap) }),
  });
  page.node.addAnnot(ctx.register(annot));
}

/**
 * The drawing file with the sheet's systems marked on its page. `flatten` draws the marks into the page content
 * instead of adding annotations (for a report appendix); `onlyPage` keeps just that page.
 */
export async function planMarkupPdf(
  sheet: PlanSheet,
  equipment: readonly Pick<Equipment, 'id' | 'designation'>[],
  opts: { flatten?: boolean; onlyPage?: boolean } = {},
): Promise<Uint8Array> {
  const marks = sheetMarks(sheet, equipment);
  if (!sheet.pdf) throw new Error(`The drawing ${sheet.fileName} has not been downloaded on this device yet.`);
  const src = await PDFDocument.load(sheet.pdf, { ignoreEncryption: true });
  let doc = src;
  let page = src.getPage(sheet.page - 1);
  if (opts.onlyPage) {
    doc = await PDFDocument.create();
    [page] = await doc.copyPages(src, [sheet.page - 1]);
    doc.addPage(page);
  }
  const font = await doc.embedFont(StandardFonts.Helvetica);
  // the sheet's points are on the upright page; the page's own box and rotation are mapped by pdf-lib's drawing
  // for the flattened form, and by the annotation /Rect for the annotations, both in the unrotated user space
  const { width: pw, height: ph } = page.getSize();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const toUser = (x: number, y: number): [number, number] => {
    // upright (y down) → unrotated user space (y up)
    if (rot === 90) return [y, x];
    if (rot === 180) return [pw - x, y];
    if (rot === 270) return [pw - y, ph - x];
    return [x, ph - y];
  };
  const upright = (sheet.width === pw && sheet.height === ph) || rot === 90 || rot === 270;
  if (!upright) throw new Error('The sheet does not match the page it was read from.');
  // map every point to the unrotated frame, then treat it as "y downwards from the top" of a page `H` high
  const H = rot === 90 || rot === 270 ? pw : ph;
  const mapped = marks.map((m) => ({
    ...m,
    polygon: m.polygon.map(([x, y]) => {
      const [ux, uy] = toUser(x, y);
      return [ux, H - uy] as [number, number];
    }),
    labels: m.labels.map((l) => {
      const [ux, uy] = toUser(l.x, l.y);
      return { ...l, x: ux, y: H - uy };
    }),
  }));
  if (opts.flatten) {
    for (const m of mapped) {
      const [r, g, b] = m.color;
      page.drawSvgPath(`M ${m.polygon.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`, {
        x: 0,
        y: H,
        color: rgb(r, g, b),
        opacity: FILL_ALPHA,
        borderColor: rgb(r, g, b),
        borderWidth: 1,
      });
      for (const l of m.labels) {
        const { x, y, w, h } = labelBox(font, H, l);
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          color: rgb(1, 1, 1),
          borderColor: rgb(r, g, b),
          borderWidth: 0.8,
        });
        page.drawText(l.text, {
          x: x + LABEL_PAD,
          y: y + LABEL_PAD + LABEL_SIZE * 0.22,
          size: LABEL_SIZE,
          font,
          color: rgb(r, g, b),
        });
      }
    }
  } else {
    for (const m of mapped) {
      addPolygon(doc, page, m, H);
      for (const l of m.labels) addLabel(doc, page, font, font.ref, m.color, H, l);
    }
  }
  doc.setModificationDate(new Date());
  return doc.save();
}

/**
 * QR equipment tags: a label per unit (QR code + designation + type + project) printed from the Equipment tab and
 * stuck on the unit. The QR code holds a link to the app, `<origin>/t/<projectId>/<unitId>`: scanning it with a phone
 * camera (or with *Scan tag* in the app) opens that unit's page. The `/t/` route (TagPage) explains when the project
 * is not on the device (yet).
 *
 * Labels: 2 in. squares, 3 across and 4 down on a US Letter page, with light cut guides (works on plain paper; also
 * lines up with 2 in. square label sheets that use 1/2 in. side margins and 3/4 in. gaps).
 */
import qrcode from 'qrcode-generator';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';

export const TAG_PATH = '/t';

export function tagUrl(origin: string, projectId: string, unitId: string): string {
  return `${origin.replace(/\/$/, '')}${TAG_PATH}/${projectId}/${unitId}`;
}

/** The project and unit of a scanned tag link (any origin: a tag printed from a preview deploy still opens). */
export function parseTagUrl(text: string): { projectId: string; unitId: string } | null {
  const m = /\/t\/([0-9a-fA-F-]{36})\/([0-9a-fA-F-]{36})\/?(?:[?#].*)?$/.exec(text.trim());
  return m ? { projectId: m[1], unitId: m[2] } : null;
}

/** QR modules (true = dark), error correction M. */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** An SVG of the QR code (quiet zone of 4 modules), for the screen. */
export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  const n = m.length + 8;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => dark && (d += `M${c + 4} ${r + 4}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export interface TagLabel {
  url: string;
  designation: string;
  /** e.g. "RTU / AHU / DOAS" */
  typeLabel: string;
  project: string;
}

const IN = 72;
export const TAG_LAYOUT = {
  size: 2 * IN,
  cols: 3,
  rows: 4,
  left: 0.5 * IN,
  top: 0.75 * IN,
  gapX: 0.75 * IN,
  gapY: 0.5 * IN,
} as const;

function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** A PDF of labels (Letter pages, 12 per page). */
export async function tagsPdf(labels: readonly TagLabel[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Equipment QR tags');
  doc.setCreator('a2b TAB App');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const L = TAG_LAYOUT;
  const perPage = L.cols * L.rows;
  for (let i = 0; i < labels.length; i += perPage) {
    const page = doc.addPage([8.5 * IN, 11 * IN]);
    labels.slice(i, i + perPage).forEach((t, k) => {
      const col = k % L.cols;
      const row = Math.floor(k / L.cols);
      const x = L.left + col * (L.size + L.gapX);
      const yTop = 11 * IN - L.top - row * (L.size + L.gapY);
      // cut guide
      page.drawRectangle({
        x,
        y: yTop - L.size,
        width: L.size,
        height: L.size,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
        borderDashArray: [2, 2],
      });
      // QR code: centred, leaving room for three text lines below
      const m = qrMatrix(t.url);
      const qrSide = L.size - 44;
      const cell = qrSide / m.length;
      const qx = x + (L.size - qrSide) / 2;
      const qy = yTop - 6 - qrSide;
      m.forEach((r, ri) =>
        r.forEach((dark, ci) => {
          if (dark)
            page.drawRectangle({
              x: qx + ci * cell,
              y: qy + (m.length - 1 - ri) * cell,
              width: cell + 0.05,
              height: cell + 0.05,
              color: rgb(0, 0, 0),
            });
        }),
      );
      const w = L.size - 12;
      const line = (text: string, font: PDFFont, size: number, y: number) => {
        const s = fit(text, font, size, w);
        page.drawText(s, { x: x + (L.size - font.widthOfTextAtSize(s, size)) / 2, y, size, font, color: rgb(0, 0, 0) });
      };
      line(t.designation, bold, 11, qy - 13);
      line(t.typeLabel, regular, 7, qy - 23);
      line(t.project, regular, 7, qy - 32);
    });
  }
  return doc.save();
}

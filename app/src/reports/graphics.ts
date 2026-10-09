/**
 * Graphics appendix PDF (ROADMAP §7.1): the figures of reports/graphicsModel.ts drawn with pdf-lib (vector, so they
 * print sharp), a title block and page numbers like the Issues / Photo reports. Delivered next to the workbook.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { EquipmentTypeKey } from '../domain/equipmentTypes';
import type { XCell } from '../domain/staticProfile';
import type { DiagramKind } from '../domain/unitDiagram';
import { sanitizer } from './pdf';
import type {
  BarsFigure,
  Figure,
  GraphicsModel,
  ProfileFigure,
  PumpFigure,
  Summary,
  TraverseFigure,
} from './graphicsModel';

const W = 612;
const H = 792;
const MX = 42;
const TOP = 40;
const BOTTOM = 44;
const CW = W - 2 * MX;
const INK = rgb(0.1, 0.12, 0.15);
const MUTED = rgb(0.42, 0.46, 0.52);
const RULE = rgb(0.82, 0.85, 0.88);
/** e2s steel blue #4A7EC0 (the e2s website) */
const BRAND = rgb(0.29, 0.494, 0.753);
/** e2s green, darkened for text on white (#4A9A2E; the website's #6AB23E is the bar colour) */
const GREEN = rgb(0.29, 0.604, 0.18);
const RED = rgb(0.72, 0.16, 0.12);
const BAND = rgb(0.9, 0.93, 0.96);
const BOX = rgb(0.87, 0.92, 0.97);

export interface GraphicsHeader {
  firm: string;
  label: string;
  reportDate: string;
  address?: string;
}

const num = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined || !Number.isFinite(x)
    ? '—'
    : x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const cellText = (v: XCell) =>
  typeof v === 'number' ? num(v, 2) : v === null || v === undefined || v === '' ? '' : String(v);

/** Height a figure takes on the page (heading included). */
export function figureHeight(f: Figure): number {
  switch (f.kind) {
    case 'profile':
      return f.diagram.notes.length ? 316 : 296;
    case 'traverse':
      return 280;
    case 'pump':
      return 250;
    default:
      return 44 + Math.max(1, f.rows.length) * 15 + 18;
  }
}

/** Splits long outlet / valve tables into figures that fit on a page. */
export function paginateFigures(figs: readonly Figure[], rowsPerFigure = 38): Figure[] {
  const out: Figure[] = [];
  for (const f of figs) {
    if ((f.kind === 'outlets' || f.kind === 'valves') && f.rows.length > rowsPerFigure) {
      for (let i = 0; i < f.rows.length; i += rowsPerFigure)
        out.push({
          ...f,
          table: `${f.table} (${i + 1}–${Math.min(i + rowsPerFigure, f.rows.length)})`,
          rows: f.rows.slice(i, i + rowsPerFigure),
        });
    } else out.push(f);
  }
  return out;
}

/** A run of pages about one thing: the summary, or one unit's (or traverse's) figures. */
export interface FigureGroup {
  /** 'summary', or the unit's type and designation */
  key: string;
  unit: string | null;
  type: EquipmentTypeKey | null;
  /** 0-based first page and page count in the rendered PDF */
  firstPage: number;
  pageCount: number;
}

export interface GraphicsOptions {
  /**
   * For the final report (reports/assemble.ts): the summary and each unit's figures start on a page of their own, with
   * a slim running head instead of the title block and no page numbers (the assembled report numbers its pages).
   */
  inline?: boolean;
  /** Outlet / valve charts (inline only; the appendix always has them). */
  outletCharts?: boolean;
}

export async function renderGraphicsPdf(
  model: GraphicsModel,
  header: GraphicsHeader,
  now = new Date(),
  opts: GraphicsOptions = {},
): Promise<{ bytes: Uint8Array; pages: number; groups: FigureGroup[] }> {
  const inline = Boolean(opts.inline);
  const doc = await PDFDocument.create();
  doc.setTitle(`Graphics Appendix${header.label ? ` ${header.label}` : ''} - ${model.projectName}`, {
    showInWindowTitleBar: true,
  });
  doc.setAuthor(header.firm);
  doc.setCreator('a2b TAB App');
  doc.setProducer('a2b TAB App (pdf-lib)');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = sanitizer(regular);
  const text = (p: PDFPage, s: string, x: number, y: number, size = 8, font: PDFFont = regular, color: RGB = INK) =>
    p.drawText(clean(s), { x, y, size, font, color });
  const tw = (s: string, size = 8, font: PDFFont = regular) => font.widthOfTextAtSize(clean(s), size);
  const center = (p: PDFPage, s: string, cx: number, y: number, size = 8, font: PDFFont = regular, color: RGB = INK) =>
    text(p, s, cx - tw(s, size, font) / 2, y, size, font, color);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let groupTitle = '';
  let y = 0; // current top (from the top edge)
  const Y = (top: number) => H - top;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = TOP;
    if (inline) {
      text(page, model.projectName, MX, Y(y + 8), 8, regular, MUTED);
      const head = `Graphics · ${groupTitle}`;
      text(page, head, W - MX - tw(head, 8, bold), Y(y + 8), 8, bold, BRAND);
      page.drawLine({ start: { x: MX, y: Y(y + 13) }, end: { x: W - MX, y: Y(y + 13) }, thickness: 0.8, color: BRAND });
      y += 24;
    } else if (pages.length === 1) {
      text(page, header.firm, MX, Y(y + 12), 11, bold, BRAND);
      page.drawLine({ start: { x: MX, y: Y(y + 18) }, end: { x: W - MX, y: Y(y + 18) }, thickness: 1.2, color: BRAND });
      text(page, 'Graphics Appendix', MX, Y(y + 44), 20, bold);
      text(page, model.projectName, MX, Y(y + 62), 13, bold);
      text(
        page,
        [header.address, `Report date: ${header.reportDate}`, header.label && `Report: ${header.label}`]
          .filter(Boolean)
          .join(' · '),
        MX,
        Y(y + 78),
        9.5,
        regular,
        MUTED,
      );
      text(
        page,
        'Figures drawn from the values in the TAB report workbook; the workbook is the report of record.',
        MX,
        Y(y + 92),
        8.5,
        regular,
        MUTED,
      );
      y += 108;
    }
  };
  const heading = (title: string, sub: string) => {
    text(page, title, MX, Y(y + 12), 11, bold);
    text(page, sub, MX + tw(title, 11, bold) + 8, Y(y + 12), 8.5, regular, MUTED);
    page.drawLine({ start: { x: MX, y: Y(y + 17) }, end: { x: W - MX, y: Y(y + 17) }, thickness: 0.6, color: RULE });
  };

  // ------------------------------------------------------------------ figures
  const line = (x1: number, y1: number, x2: number, y2: number, t = 0.8, color: RGB = INK, dash?: number[]) =>
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness: t,
      color,
      ...(dash ? { dashArray: dash } : {}),
    });
  const arrow = (x1: number, yy: number, x2: number, t = 1, color: RGB = INK) => {
    const d = x2 > x1 ? 1 : -1;
    line(x1, yy, x2, yy, t, color);
    line(x2 - 5 * d, yy + 3, x2, yy, t, color);
    line(x2 - 5 * d, yy - 3, x2, yy, t, color);
  };
  const WARM = rgb(0.8, 0.4, 0.1);
  /** A component drawn inside its section of the cabinet (x, bottom y, width, height in PDF units). */
  const drawComponent = (kind: DiagramKind, name: string, x: number, yb: number, w: number, h: number) => {
    const cx = x + w / 2;
    const cy = yb + h / 2;
    const coil = (color: RGB) => {
      for (let i = 0; i < 6; i++)
        line(x + w * 0.28 + i * (w * 0.09), yb + 5, x + w * 0.28 + i * (w * 0.09), yb + h - 5, 0.6, color);
      for (let j = 0; j < 4; j++)
        page.drawCircle({
          x: cx,
          y: yb + 9 + (j * (h - 18)) / 3,
          size: 2.2,
          color: rgb(1, 1, 1),
          borderColor: color,
          borderWidth: 0.7,
        });
    };
    const pleats = (color: RGB, n = 7) => {
      const px = x + w * 0.3;
      const pw = w * 0.4;
      for (let i = 0; i < n; i++) {
        const y1 = yb + 6 + ((h - 12) * i) / n;
        const y2 = yb + 6 + ((h - 12) * (i + 1)) / n;
        line(i % 2 ? px + pw : px, y1, i % 2 ? px : px + pw, y2, 0.8, color);
      }
    };
    if (kind === 'filter') pleats(BRAND);
    else if (kind === 'finalFilter') {
      pleats(BRAND, 9);
      line(x + w * 0.24, yb + 5, x + w * 0.24, yb + h - 5, 0.5, BRAND);
    } else if (kind === 'coil') coil(BRAND);
    else if (kind === 'reheat') coil(WARM);
    else if (kind === 'burner')
      for (let i = 0; i < 3; i++) {
        const fx = x + w * (0.3 + i * 0.2);
        const fy = yb + 8;
        page.drawSvgPath(
          `M ${fx - 5} ${-fy} Q ${fx - 6} ${-(fy + 12)} ${fx} ${-(fy + 22)} Q ${fx + 6} ${-(fy + 12)} ${fx + 5} ${-fy} Z`,
          { x: 0, y: 0, color: rgb(0.98, 0.72, 0.35), borderColor: WARM, borderWidth: 0.6 },
        );
      }
    else if (kind === 'heat')
      // heat exchanger tubes
      for (let j = 0; j < 3; j++) {
        const ty = yb + 10 + (j * (h - 20)) / 2;
        page.drawSvgPath(
          `M ${x + w * 0.22} ${-ty} Q ${x + w * 0.36} ${-(ty + 5)} ${x + w * 0.5} ${-ty} Q ${x + w * 0.64} ${-(ty - 5)} ${x + w * 0.78} ${-ty}`,
          { x: 0, y: 0, borderColor: WARM, borderWidth: 1 },
        );
      }
    else if (kind === 'wheel' && name.toLowerCase().startsWith('core')) {
      page.drawSvgPath(
        `M ${cx} ${-(yb + 5)} L ${x + w * 0.8} ${-cy} L ${cx} ${-(yb + h - 5)} L ${x + w * 0.2} ${-cy} Z`,
        { x: 0, y: 0, color: BOX, borderColor: BRAND, borderWidth: 0.8 },
      );
      line(x + w * 0.35, cy - h * 0.2, x + w * 0.65, cy + h * 0.2, 0.5, BRAND);
      line(x + w * 0.35, cy + h * 0.2, x + w * 0.65, cy - h * 0.2, 0.5, BRAND);
    } else if (kind === 'wheel' || kind === 'desiccant') {
      const rx = w * 0.14;
      const ry = h * 0.4;
      page.drawEllipse({
        x: cx,
        y: cy,
        xScale: rx,
        yScale: ry,
        color: kind === 'desiccant' ? rgb(0.96, 0.93, 0.86) : BOX,
        borderColor: kind === 'desiccant' ? rgb(0.55, 0.42, 0.2) : BRAND,
        borderWidth: 0.8,
      });
      if (kind === 'desiccant')
        // honeycomb media: rows across the wheel face
        for (let i = 1; i < 6; i++) {
          const yy = cy - ry + (2 * ry * i) / 6;
          const half = rx * Math.sqrt(1 - ((yy - cy) / ry) ** 2);
          line(cx - half, yy, cx + half, yy, 0.4, rgb(0.55, 0.42, 0.2));
        }
      line(cx, cy - ry, cx, cy + ry, 0.5, kind === 'desiccant' ? rgb(0.55, 0.42, 0.2) : BRAND);
    } else if (kind === 'fan') {
      const r = Math.min(w, h) * 0.34;
      page.drawCircle({ x: cx, y: cy, size: r + 3, borderColor: BRAND, borderWidth: 1 });
      page.drawCircle({ x: cx, y: cy, size: r * 0.3, color: BRAND });
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        line(
          cx + Math.cos(a) * r * 0.35,
          cy + Math.sin(a) * r * 0.35,
          cx + Math.cos(a + 0.5) * r,
          cy + Math.sin(a + 0.5) * r,
          1,
          BRAND,
        );
      }
    } else if (kind === 'inlet' || kind === 'damper')
      // louvers / dampers
      for (let i = 0; i < 5; i++) {
        const ly = yb + 7 + (i * (h - 14)) / 4;
        line(x + w * 0.3, ly - 3, x + w * 0.7, ly + 3, 1, MUTED);
      }
    else
      page.drawRectangle({
        x: x + w * 0.25,
        y: yb + h * 0.25,
        width: w * 0.5,
        height: h * 0.5,
        borderColor: MUTED,
        borderWidth: 0.7,
      });
  };

  const nice = (span: number) => {
    const raw = span / 4;
    const p = 10 ** Math.floor(Math.log10(raw || 1));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  };
  /** Words wrapped to lines of a width. */
  const wrap = (s: string, width: number, size: number, font: PDFFont = regular) => {
    const out: string[] = [];
    let cur = '';
    for (const word of s.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && tw(next, size, font) > width) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  /** A line cut to a width with an ellipsis. */
  const fit = (s: string, width: number, size: number, font: PDFFont = regular) => {
    if (tw(s, size, font) <= width) return s;
    let t = s;
    while (t.length > 1 && tw(`${t}…`, size, font) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };

  const drawProfile = (f: ProfileFigure, top: number) => {
    const p = f.profile;
    const d = f.diagram;
    const title = `${f.unit} — static pressure profile`;
    heading(
      title,
      fit(`${f.makeModel || f.typeLabel} · in. w.g. · airflow left to right`, CW - tw(title, 11, bold) - 8, 8.5),
    );
    // where the component order comes from
    const src = f.library
      ? `Component order: ${f.library.name} (unit library, ${f.library.confidence}${f.library.source ? ` · ${f.library.source}` : ''})`
      : `Component order: the workbook's ${f.typeLabel} strip (no unit library entry for this make and model)`;
    text(page, fit(src, CW, 6.8), MX, Y(top + 26), 6.8, regular, MUTED);
    const sections = d.sections;
    // cabinet: the sections in airflow order, then the discharge duct
    const cabX = MX + 22;
    const ductW = 46;
    const cabW = CW - 22 - ductW - 8;
    const secW = cabW / sections.length;
    const cabTop = top + 58;
    const cabH = 58;
    const yb = Y(cabTop + cabH);
    page.drawRectangle({
      x: cabX,
      y: yb,
      width: cabW,
      height: cabH,
      color: rgb(0.975, 0.98, 0.99),
      borderColor: INK,
      borderWidth: 1.2,
    });
    const dx = cabX + cabW;
    page.drawRectangle({
      x: dx,
      y: yb + cabH * 0.25,
      width: ductW,
      height: cabH * 0.5,
      color: rgb(0.975, 0.98, 0.99),
      borderColor: INK,
      borderWidth: 1,
    });
    arrow(MX, yb + cabH / 2, cabX - 3, 1.2, MUTED);
    arrow(dx + ductW + 2, yb + cabH / 2, W - MX, 1.2, MUTED);
    text(page, 'SA', dx + ductW / 2 - 5, yb + cabH * 0.25 - 10, 7, bold, MUTED);
    sections.forEach((s, i) => {
      const x = cabX + i * secW;
      if (i > 0) line(x, yb, x, yb + cabH, 0.6, RULE);
      if (s.optional)
        page.drawRectangle({
          x: x + 3,
          y: yb + 3,
          width: secW - 6,
          height: cabH - 6,
          borderColor: MUTED,
          borderWidth: 0.5,
          borderDashArray: [2, 2],
        });
      drawComponent(s.kind, s.name, x, yb, secW, cabH);
      let size = 7.5;
      while (size > 5.5 && tw(s.name, size, bold) > secW - 4) size -= 0.5;
      center(page, fit(s.name, secW - 2, size, bold), x + secW / 2, Y(cabTop + cabH + 10), size, bold);
      if (s.optional) center(page, '(option)', x + secW / 2, Y(cabTop + cabH + 18), 6.3, regular, MUTED);
    });
    // taps: the inlet and each section's leaving side; the discharge in the duct
    const tapX = (t: (typeof d.taps)[number]) => (t.inDuct ? dx + ductW / 2 : cabX + (t.station + 1) * secW);
    const shown = d.taps
      .map((t, i) => ({ t, i, x: tapX(t), v: typeof t.value === 'number' ? t.value : null, txt: cellText(t.value) }))
      .filter((q) => q.txt !== '');
    // ΔP of each span between measured taps; across several sections one bracket
    for (const sp of d.spans) {
      const x0 = tapX(d.taps[sp.from]);
      const x1 = tapX(d.taps[sp.to]);
      const by = Y(cabTop + cabH + 29);
      const value = `${sp.fan ? 'rise' : 'ΔP'} ${num(sp.dp, 2)}`;
      if (sp.across.length <= 1) center(page, value, (x0 + x1) / 2, by, 7.5, regular, MUTED);
      else {
        line(x0 + 4, by + 8, x1 - 4, by + 8, 0.6, MUTED);
        line(x0 + 4, by + 8, x0 + 4, by + 11, 0.6, MUTED);
        line(x1 - 4, by + 8, x1 - 4, by + 11, 0.6, MUTED);
        const long = `${value} across ${sp.across.join(' · ')}`;
        const lab = tw(long, 7.5) <= x1 - x0 + 16 ? long : value;
        center(page, lab, (x0 + x1) / 2, by, 7.5, regular, MUTED);
      }
    }
    // callouts: the tap's name on this unit and its reading, on a leader from the casing
    let right = -Infinity;
    for (const q of shown) {
      const tapY = q.t.inDuct ? yb + cabH * 0.75 : yb + cabH;
      page.drawCircle({ x: q.x, y: tapY, size: 2.6, color: RED });
      const name = q.t.name.replace(/ leaving$/, ' lvg').toLowerCase();
      const bw = Math.max(tw(name, 5.8), tw(q.txt, 8.5, bold)) + 10;
      let bx = q.x - bw / 2;
      if (bx < right + 3) bx = right + 3;
      bx = Math.min(bx, W - MX - bw);
      right = bx + bw;
      const boxB = Y(cabTop - 8);
      line(q.x, tapY + 2.6, q.x, boxB, 0.6, RED);
      if (q.x < bx + 4 || q.x > bx + bw - 4) line(q.x, boxB, bx + bw / 2, boxB, 0.6, RED);
      page.drawRectangle({
        x: bx,
        y: boxB,
        width: bw,
        height: 21,
        color: rgb(1, 1, 1),
        borderColor: RED,
        borderWidth: 0.7,
      });
      center(page, name, bx + bw / 2, boxB + 13.5, 5.8, regular, RED);
      center(page, q.txt, bx + bw / 2, boxB + 3.5, 8.5, bold, INK);
    }

    // chart: static at each tap, in airflow order
    const pts = shown.filter((q): q is typeof q & { v: number } => q.v !== null);
    const chTop = cabTop + cabH + 40;
    const chH = 84;
    const axX = MX + 22;
    if (pts.length) {
      const lo0 = Math.min(0, ...pts.map((q) => q.v));
      const hi0 = Math.max(0, ...pts.map((q) => q.v));
      const step = nice(hi0 - lo0 || 1);
      const lo = Math.floor(lo0 / step) * step;
      const hi = Math.ceil(hi0 / step) * step || step;
      const yOf = (v: number) => Y(chTop + chH - ((v - lo) / (hi - lo)) * chH);
      // suction (below 0) and discharge (above 0) bands
      page.drawRectangle({
        x: axX,
        y: yOf(lo),
        width: W - MX - axX,
        height: yOf(0) - yOf(lo),
        color: rgb(0.93, 0.96, 0.99),
      });
      page.drawRectangle({
        x: axX,
        y: yOf(0),
        width: W - MX - axX,
        height: yOf(hi) - yOf(0),
        color: rgb(0.995, 0.965, 0.92),
      });
      for (let v = lo; v <= hi + 1e-9; v += step) {
        const yy = yOf(v);
        line(axX, yy, W - MX, yy, Math.abs(v) < 1e-9 ? 0.9 : 0.3, Math.abs(v) < 1e-9 ? INK : RULE);
        const lab = num(Math.abs(v) < 1e-9 ? 0 : v, step < 1 ? 2 : 1);
        text(page, lab, axX - 4 - tw(lab, 6.5), yy - 2.2, 6.5, regular, MUTED);
      }
      text(page, 'in. w.g.', MX - 10, yOf(hi) + 6, 6.5, bold, MUTED);
      text(page, 'discharge (+)', axX + 4, yOf(hi) - 8, 6.5, regular, rgb(0.6, 0.4, 0.1));
      text(page, 'suction (−)', axX + 4, yOf(lo) + 3, 6.5, regular, BRAND);
      // the section boundaries, faint, so the line reads against the cabinet above
      for (let i = 1; i <= sections.length; i++)
        line(cabX + i * secW, yOf(lo), cabX + i * secW, yOf(hi), 0.3, RULE, [2, 2]);
      for (let j = 1; j < pts.length; j++) line(pts[j - 1].x, yOf(pts[j - 1].v), pts[j].x, yOf(pts[j].v), 1.6, BRAND);
      for (const q of pts) {
        page.drawCircle({ x: q.x, y: yOf(q.v), size: 3, color: rgb(1, 1, 1), borderColor: BRAND, borderWidth: 1.4 });
        const lab = num(q.v, 2);
        const above = q.v >= 0;
        const lx = q.x + 4 + tw(lab, 7, bold) > W - MX ? q.x - 4 - tw(lab, 7, bold) : q.x + 4;
        text(page, lab, lx, yOf(q.v) + (above ? 4 : -9), 7, bold, INK);
      }
      // fan rise (TSP): the span that holds the fan
      const fanSpan = d.spans.find((s) => s.fan);
      if (fanSpan && p.tsp !== null) {
        const a = d.taps[fanSpan.from];
        const b = d.taps[fanSpan.to];
        const vIn = a.value as number;
        const vOut = b.value as number;
        const fx = tapX(b) - 16;
        line(fx, yOf(vIn), fx, yOf(vOut), 1, RED);
        line(fx - 3, yOf(vOut) - 4, fx, yOf(vOut), 1, RED);
        line(fx + 3, yOf(vOut) - 4, fx, yOf(vOut), 1, RED);
        const t = `TSP ${num(p.tsp, 2)}`;
        text(page, t, fx - tw(t, 7.5, bold) - 4, (yOf(vIn) + yOf(vOut)) / 2 - 3, 7.5, bold, RED);
      }
    }
    // notes: where the drawing departs from the workbook strip
    wrap(d.notes.join(' '), CW, 6.8)
      .slice(0, 3)
      .forEach((l, i) => text(page, l, MX, Y(chTop + chH + 60 + i * 9), 6.8, regular, rgb(0.6, 0.4, 0.1)));
    // results: TSP, ESP against design (gauge), unit dP
    const ry = chTop + chH + 14;
    const tile = (x: number, w: number, title: string, value: string, note = '', tone: RGB = INK) => {
      page.drawRectangle({
        x,
        y: Y(ry + 34),
        width: w,
        height: 34,
        color: rgb(0.97, 0.975, 0.98),
        borderColor: RULE,
        borderWidth: 0.6,
      });
      text(page, title, x + 6, Y(ry + 10), 6.5, bold, MUTED);
      text(page, value, x + 6, Y(ry + 24), 11, bold, tone);
      if (note) text(page, note, x + 6 + tw(value, 11, bold) + 5, Y(ry + 24), 7, regular, MUTED);
    };
    const esp = p.esp;
    const ratio = esp !== null && f.designEsp ? esp / f.designEsp : null;
    const espTone = ratio === null ? INK : Math.abs(ratio - 1) <= 0.1 ? GREEN : rgb(0.75, 0.45, 0.02);
    tile(MX, 120, 'FAN TOTAL STATIC (TSP)', `${num(p.tsp, 2)} in.`);
    tile(
      MX + 128,
      200,
      'EXTERNAL STATIC (ESP) · band = design ±10 %',
      `${num(esp, 2)} in.`,
      f.designEsp !== null ? `design ${num(f.designEsp, 2)}${ratio !== null ? ` · ${num(ratio * 100)} %` : ''}` : '',
      espTone,
    );
    tile(MX + 336, CW - 336, 'UNIT dP (INLET TO FAN)', `${num(p.unitDp, 2)} in.`);
    // ESP gauge in its tile
    if (esp !== null && f.designEsp) {
      const gx = MX + 134;
      const gw = 188;
      const gy = Y(ry + 31);
      const max = Math.max(esp, f.designEsp) * 1.3;
      page.drawRectangle({ x: gx, y: gy, width: gw, height: 5, color: rgb(0.9, 0.91, 0.93) });
      page.drawRectangle({
        x: gx + (f.designEsp * 0.9 * gw) / max,
        y: gy,
        width: (f.designEsp * 0.2 * gw) / max,
        height: 5,
        color: rgb(0.78, 0.9, 0.8),
      });
      page.drawRectangle({ x: gx, y: gy + 1.2, width: (esp * gw) / max, height: 2.6, color: espTone });
      line(gx + (f.designEsp * gw) / max, gy - 1.5, gx + (f.designEsp * gw) / max, gy + 6.5, 1.2, INK);
    }
  };

  /** Sequential velocity colour: t 0 (slowest) → light, 1 (fastest) → dark. */
  const velColor = (t: number) => {
    const u = Math.max(0, Math.min(1, t));
    // pale steel blue -> deep steel blue #28518A
    return rgb(0.93 - 0.773 * u, 0.955 - 0.637 * u, 0.99 - 0.449 * u);
  };
  const onColor = (t: number) => (t > 0.55 ? rgb(1, 1, 1) : INK);

  const drawTraverse = (f: TraverseFigure, top: number) => {
    const fo = f.flatOval;
    const nums = [...f.readings.flat(), ...(fo?.ends ?? [])].filter((v): v is number => v !== null);
    heading(
      `${f.unit} — duct traverse`,
      fo
        ? `${f.sizeText} · flat part ${f.positions.length} x ${f.depths.length} points + ${fo.ends.length} on the ends (NEBB 6.3.3h) · fpm`
        : `${f.sizeText} ${f.round ? 'round · 2 diameters' : 'rectangular'} · ${f.round ? `${f.positions.length} points per diameter` : `${f.positions.length} x ${f.depths.length} points`} · fpm`,
    );
    const avg = f.average;
    const vmin = nums.length ? Math.min(...nums) : 0;
    const vmax = nums.length ? Math.max(...nums) : 1;
    const tOf = (v: number) => (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5);
    const flagged = (v: number) => avg !== null && Math.abs(v / avg - 1) > 0.25;
    const panelTop = top + 30;
    const panelW = 250;
    let lgTop = top + 252;
    const dim = f.positions.length ? f.positions.at(-1)! + f.positions[0] : 1; // duct width / diameter, in.

    if (!f.round) {
      const nW = f.positions.length;
      const nH = f.depths.length;
      const Hin = f.depths.length ? f.depths.at(-1)! + f.depths[0] : 1;
      const aspect = dim / Math.max(1, Hin);
      let gw = panelW - 30;
      let gh = gw / aspect;
      if (gh > 150) {
        gh = 150;
        gw = gh * aspect;
      }
      const x0 = MX + 24 + (panelW - 30 - gw) / 2;
      const gtop = panelTop + 18;
      // dimension lines
      const dy = Y(gtop - 8);
      line(x0, dy, x0 + gw, dy, 0.5, MUTED);
      line(x0, dy - 3, x0, dy + 3, 0.5, MUTED);
      line(x0 + gw, dy - 3, x0 + gw, dy + 3, 0.5, MUTED);
      center(page, `${num(dim, 1)} in.`, x0 + gw / 2, dy + 3, 7, regular, MUTED);
      const dxl = x0 - 10;
      line(dxl, Y(gtop), dxl, Y(gtop + gh), 0.5, MUTED);
      text(page, `${num(Hin, 1)} in.`, dxl - 4 - tw(`${num(Hin, 1)} in.`, 7), Y(gtop + gh / 2) - 3, 7, regular, MUTED);
      lgTop = gtop + gh + 18;
      // a flat oval: the flat part between two half circles of diameter H (the cells fill the flat part)
      const endR = fo ? gh / 2 : 0;
      const faceX = x0 + endR;
      const faceW = gw - 2 * endR;
      const face = rgb(0.97, 0.97, 0.97);
      if (fo) {
        page.drawCircle({
          x: x0 + endR,
          y: Y(gtop + endR),
          size: endR,
          color: face,
          borderColor: INK,
          borderWidth: 1.4,
        });
        page.drawCircle({
          x: x0 + gw - endR,
          y: Y(gtop + endR),
          size: endR,
          color: face,
          borderColor: INK,
          borderWidth: 1.4,
        });
        page.drawRectangle({ x: faceX, y: Y(gtop + gh), width: faceW, height: gh, color: face });
        line(faceX, Y(gtop), faceX + faceW, Y(gtop), 1.4, INK);
        line(faceX, Y(gtop + gh), faceX + faceW, Y(gtop + gh), 1.4, INK);
        line(faceX, Y(gtop), faceX, Y(gtop + gh), 0.5, MUTED, [2, 2]);
        line(faceX + faceW, Y(gtop), faceX + faceW, Y(gtop + gh), 0.5, MUTED, [2, 2]);
        line(x0, Y(gtop + endR), x0 + gw, Y(gtop + endR), 0.5, MUTED, [3, 2]);
        // the end points on the horizontal axis
        const dotR = Math.max(2.2, Math.min(4.6, endR / 4));
        fo.ends.forEach((v, i) => {
          const x = x0 + (fo.endPositions[i] / dim) * gw;
          const yy = Y(gtop + endR);
          if (v === null) {
            page.drawCircle({ x, y: yy, size: 2, color: MUTED });
            return;
          }
          page.drawCircle({
            x,
            y: yy,
            size: dotR,
            color: velColor(tOf(v)),
            borderColor: flagged(v) ? RED : INK,
            borderWidth: flagged(v) ? 1.4 : 0.4,
          });
        });
      } else
        page.drawRectangle({
          x: x0,
          y: Y(gtop + gh),
          width: gw,
          height: gh,
          color: face,
          borderColor: INK,
          borderWidth: 1.4,
        });
      const cw = faceW / nW;
      const chh = gh / nH;
      for (let r = 0; r < nH; r++)
        for (let k = 0; k < nW; k++) {
          const v = f.readings[r]?.[k] ?? null;
          const x = faceX + k * cw;
          const yb = Y(gtop + (r + 1) * chh);
          if (v !== null) {
            const t = tOf(v);
            page.drawRectangle({ x: x + 0.8, y: yb + 0.8, width: cw - 1.6, height: chh - 1.6, color: velColor(t) });
            if (flagged(v))
              page.drawRectangle({
                x: x + 1.5,
                y: yb + 1.5,
                width: cw - 3,
                height: chh - 3,
                borderColor: RED,
                borderWidth: 1.4,
              });
            const fs = Math.min(8, cw / 3.4, chh / 2.2);
            center(page, num(v), x + cw / 2, yb + chh / 2 - fs / 3, fs, flagged(v) ? bold : regular, onColor(t));
          } else center(page, '·', x + cw / 2, yb + chh / 2 - 3, 8, regular, MUTED);
        }
      // flow into the page
      const sx = x0 + gw + 12;
      page.drawCircle({ x: sx, y: Y(gtop + 8), size: 5, borderColor: MUTED, borderWidth: 0.7 });
      line(sx - 3.2, Y(gtop + 8) - 3.2, sx + 3.2, Y(gtop + 8) + 3.2, 0.7, MUTED);
      line(sx - 3.2, Y(gtop + 8) + 3.2, sx + 3.2, Y(gtop + 8) - 3.2, 0.7, MUTED);
    } else {
      const R = 74;
      const cx = MX + 24 + (panelW - 30) / 2;
      const cyy = Y(panelTop + 14 + R);
      page.drawCircle({ x: cx, y: cyy, size: R, color: rgb(0.97, 0.97, 0.97), borderColor: INK, borderWidth: 1.4 });
      // equal-area rings (the points sit at their centroids) and the two diameters
      const rings = Math.max(1, Math.round(f.positions.length / 2));
      for (let i = 1; i < rings; i++)
        page.drawCircle({
          x: cx,
          y: cyy,
          size: R * Math.sqrt(i / rings),
          borderColor: RULE,
          borderWidth: 0.5,
          borderDashArray: [2, 2],
        });
      line(cx - R, cyy, cx + R, cyy, 0.5, MUTED, [3, 2]);
      line(cx, cyy - R, cx, cyy + R, 0.5, MUTED, [3, 2]);
      text(page, 'A', cx + R + 4, cyy - 3, 8, bold, MUTED);
      text(page, 'B', cx - 3, cyy + R + 4, 8, bold, MUTED);
      // dot size: the points near the wall sit close together
      const gaps = f.positions.slice(1).map((pp, k) => ((pp - f.positions[k]) / dim) * 2 * R);
      const dotR = Math.max(2.2, Math.min(4.6, (Math.min(...gaps, 99) / 2) * 0.95));
      f.readings.slice(0, 2).forEach((axis, a) =>
        axis.forEach((v, k) => {
          const off = (f.positions[k] / dim - 0.5) * 2 * R;
          const x = a === 0 ? cx + off : cx;
          const yy = a === 0 ? cyy : cyy - off;
          if (v === null) {
            page.drawCircle({ x, y: yy, size: 2, color: MUTED });
            return;
          }
          page.drawCircle({
            x,
            y: yy,
            size: dotR,
            color: velColor(tOf(v)),
            borderColor: flagged(v) ? RED : INK,
            borderWidth: flagged(v) ? 1.4 : 0.4,
          });
        }),
      );
      center(page, `${num(dim, 1)} in. dia`, cx, cyy - R - 12, 7, regular, MUTED);
      // readings table: one row per diameter, cells coloured like the dots
      const tTop = panelTop + 14 + 2 * R + 20;
      const n = f.positions.length;
      const cwid = Math.min(24, (panelW - 20) / n);
      f.readings.slice(0, 2).forEach((axis, a) => {
        const ry = Y(tTop + 12 + a * 13);
        text(page, a === 0 ? 'A' : 'B', MX + 2, ry + 3, 7.5, bold, MUTED);
        axis.forEach((v, k) => {
          const x = MX + 14 + k * cwid;
          if (v !== null)
            page.drawRectangle({
              x,
              y: ry,
              width: cwid - 1,
              height: 12,
              color: velColor(tOf(v)),
              borderColor: flagged(v) ? RED : undefined,
              borderWidth: flagged(v) ? 1 : 0,
            });
          center(
            page,
            v === null ? '·' : num(v),
            x + cwid / 2,
            ry + 3.5,
            Math.min(6.5, cwid / 3.3),
            regular,
            v === null ? MUTED : onColor(tOf(v)),
          );
        });
      });
      Array.from({ length: n }, (_, k) =>
        center(page, String(k + 1), MX + 14 + k * cwid + cwid / 2, Y(tTop + 1), 5.5, regular, MUTED),
      );
      lgTop = tTop + 44;
    }

    // colour scale
    const lgX = MX + 24;
    const lgW = panelW - 60;
    for (let i = 0; i < 40; i++)
      page.drawRectangle({
        x: lgX + (i * lgW) / 40,
        y: Y(lgTop + 7),
        width: lgW / 40 + 0.3,
        height: 7,
        color: velColor(i / 39),
      });
    text(page, `${num(vmin)}`, lgX, Y(lgTop + 16), 6.5, regular, MUTED);
    text(page, `${num(vmax)} fpm`, lgX + lgW - tw(`${num(vmax)} fpm`, 6.5), Y(lgTop + 16), 6.5, regular, MUTED);
    if (avg !== null) {
      const ax = lgX + tOf(avg) * lgW;
      line(ax, Y(lgTop + 9), ax, Y(lgTop - 2), 1, INK);
      center(page, `avg ${num(avg)}`, ax, Y(lgTop - 1) + 1, 6.5, bold);
    }
    text(page, 'red outline: more than 25 % from the average', lgX, Y(lgTop + 26), 6.5, regular, RED);

    // velocity profile chart: velocity across the duct, one line per diameter / depth row
    const px = MX + panelW + 34;
    const pw = W - MX - px - 4;
    const ptop = panelTop + 6;
    const ph = 120;
    const series = f.round ? f.readings.slice(0, 2) : f.readings;
    // a flat oval's end points: one more line, at their positions across the whole duct
    const endSeries = fo ? fo.ends.map((v, i) => ({ x: fo.endPositions[i], v })) : [];
    const vhi = Math.max(1, vmax) * 1.1;
    const vlo = Math.max(0, Math.min(vmin * 0.85, avg ?? vmin));
    const step = nice(vhi - vlo);
    const lo = Math.floor(vlo / step) * step;
    const hi = Math.ceil(vhi / step) * step;
    const Xp = (inch: number) => px + (inch / dim) * pw;
    const Yv = (v: number) => Y(ptop + ph - ((v - lo) / (hi - lo)) * ph);
    page.drawRectangle({ x: px, y: Yv(lo), width: pw, height: Yv(hi) - Yv(lo), borderColor: RULE, borderWidth: 0.6 });
    for (let v = lo; v <= hi + 1e-9; v += step) {
      line(px, Yv(v), px + pw, Yv(v), 0.3, RULE);
      text(page, num(v), px - 4 - tw(num(v), 6.5), Yv(v) - 2.2, 6.5, regular, MUTED);
    }
    text(page, 'fpm', px - 18, Yv(hi) + 6, 6.5, bold, MUTED);
    center(
      page,
      f.round ? 'position across the diameter (in.)' : 'position across the width (in.)',
      px + pw / 2,
      Yv(lo) - 20,
      6.5,
      regular,
      MUTED,
    );
    for (const pos of f.positions)
      text(page, num(pos, 1), Xp(pos) - tw(num(pos, 1), 5.5) / 2, Yv(lo) - 9, 5.5, regular, MUTED);
    if (avg !== null) {
      line(px, Yv(avg), px + pw, Yv(avg), 0.8, INK, [4, 2]);
      text(page, `avg ${num(avg)}`, px + pw - tw(`avg ${num(avg)}`, 6.5, bold) - 2, Yv(avg) + 3, 6.5, bold);
    }
    const palette = [
      BRAND,
      rgb(0.85, 0.45, 0.1),
      rgb(0.2, 0.55, 0.3),
      rgb(0.55, 0.3, 0.6),
      rgb(0.1, 0.55, 0.65),
      rgb(0.6, 0.5, 0.15),
      rgb(0.7, 0.2, 0.35),
      MUTED,
    ];
    series.forEach((row, si) => {
      const c = palette[si % palette.length];
      const ptsS = row
        .map((v, k) => ({ x: Xp(f.positions[k]), v }))
        .filter((q): q is { x: number; v: number } => q.v !== null);
      for (let j = 1; j < ptsS.length; j++) line(ptsS[j - 1].x, Yv(ptsS[j - 1].v), ptsS[j].x, Yv(ptsS[j].v), 1.2, c);
      for (const q of ptsS) page.drawCircle({ x: q.x, y: Yv(q.v), size: 1.8, color: c });
      // legend
      const lx = px + 4 + si * 44;
      const ly = Y(ptop - 4);
      line(lx, ly + 2, lx + 10, ly + 2, 1.4, c);
      const lab = f.round ? `dia. ${si === 0 ? 'A' : 'B'}` : `row ${si + 1}`;
      text(page, lab, lx + 13, ly, 6.5, regular, INK);
    });
    if (endSeries.length) {
      const c = palette[series.length % palette.length];
      const half = endSeries.length / 2;
      for (const side of [endSeries.slice(0, half), endSeries.slice(half)]) {
        const pts = side.filter((q): q is { x: number; v: number } => q.v !== null);
        for (let j = 1; j < pts.length; j++)
          line(Xp(pts[j - 1].x), Yv(pts[j - 1].v), Xp(pts[j].x), Yv(pts[j].v), 1.2, c, [2, 1.5]);
        for (const q of pts) page.drawCircle({ x: Xp(q.x), y: Yv(q.v), size: 1.8, color: c });
      }
      const lx = px + 4 + series.length * 44;
      const ly = Y(ptop - 4);
      line(lx, ly + 2, lx + 10, ly + 2, 1.4, c, [2, 1.5]);
      text(page, 'ends', lx + 13, ly, 6.5, regular, INK);
    }

    // results
    const vp = (v: number) => (v / 4005) ** 2;
    const maxVp = nums.length ? Math.max(...nums.map(vp)) : 0;
    const above = nums.filter((v) => vp(v) >= 0.1 * maxVp).length;
    const share = nums.length ? above / nums.length : null;
    const cov = f.cov;
    const verdict = cov === null ? '' : cov <= 0.1 ? 'even' : cov <= 0.2 ? 'acceptable' : 'uneven: check the location';
    const pct = f.cfm !== null && f.design ? (f.cfm / f.design) * 100 : null;
    const rows2: [string, string, RGB][] = [
      [fo ? 'Average velocity (by area)' : 'Average velocity', `${num(avg)} fpm`, INK],
      [
        'Airflow',
        `${num(f.cfm)} CFM${f.design ? ` · design ${num(f.design)}${pct !== null ? ` (${num(pct)} %)` : ''}` : ''}`,
        pct !== null && Math.abs(pct / 100 - 1) > 0.1 ? RED : INK,
      ],
      ['Spread (CoV)', cov === null ? '—' : `${num(cov * 100)} % · ${verdict}`, cov !== null && cov > 0.2 ? RED : INK],
      ['Min / max', `${num(vmin)} / ${num(vmax)} fpm`, INK],
      [
        'Readings ≥ 1/10 of max VP',
        share === null
          ? '—'
          : `${above} of ${nums.length} (${num(share * 100)} %) ${share >= 0.75 ? '· OK' : '· under 75 %: poor location'}`,
        share !== null && share < 0.75 ? RED : GREEN,
      ],
      // the conditions at the traverse point (NEBB: report the duct static pressure and the air temperature)
      [
        'Duct static pressure',
        typeof f.ductStatic === 'number' ? `${num(f.ductStatic, 2)} in. w.g.` : (f.ductStatic ?? 'not recorded'),
        f.ductStatic === null ? MUTED : INK,
      ],
      [
        'Air temperature',
        typeof f.temperature === 'number'
          ? `${num(f.temperature, Number.isInteger(f.temperature) ? 0 : 1)} °F`
          : (f.temperature ?? 'not recorded'),
        f.temperature === null ? MUTED : INK,
      ],
    ];
    const rTop = ptop + ph + 34;
    rows2.forEach(([k, v, c], i) => {
      text(page, k, px, Y(rTop + i * 12), 7, regular, MUTED);
      text(page, v, px + 104, Y(rTop + i * 12), 7.5, bold, c);
    });
  };

  /** The appendix's first figure: where the project stands (tiles, per-type table, building balance). */
  const drawSummary = (sm: Summary, top: number): number => {
    heading('Summary', `measured values against design · tolerance ±${num(sm.tolerance * 100)} %`);
    const tiles: [string, string, string, RGB][] = [
      [
        'UNITS COMPLETE',
        `${sm.complete} / ${sm.units}`,
        sm.units ? `${num((sm.complete / sm.units) * 100)} %` : '',
        INK,
      ],
      [
        'LINES WITHIN TOLERANCE',
        `${sm.within} / ${sm.lines}`,
        sm.lines ? `${num((sm.within / sm.lines) * 100)} %` : 'no readings yet',
        sm.lines && sm.within < sm.lines ? rgb(0.75, 0.45, 0.02) : GREEN,
      ],
      [
        'OPEN DEFICIENCIES',
        `${sm.openIssues.new + sm.openIssues.existing}`,
        `${sm.openIssues.new} new · ${sm.openIssues.existing} existing · ${sm.closedIssues} closed`,
        sm.openIssues.new + sm.openIssues.existing ? RED : GREEN,
      ],
      [
        'STATIC PROFILES / TRAVERSES',
        `${sm.profiles.count} / ${sm.traverses.count}`,
        `${sm.profiles.espWithin} of ${sm.profiles.espWithDesign} ESP within ±10 % · ${sm.traverses.uneven} uneven traverse${sm.traverses.uneven === 1 ? '' : 's'}`,
        INK,
      ],
    ];
    const tw4 = (CW - 3 * 8) / 4;
    tiles.forEach(([t, v, n, c], i) => {
      const x = MX + i * (tw4 + 8);
      page.drawRectangle({
        x,
        y: Y(top + 30 + 50),
        width: tw4,
        height: 50,
        color: rgb(0.97, 0.975, 0.98),
        borderColor: RULE,
        borderWidth: 0.6,
      });
      text(page, t, x + 7, Y(top + 30 + 12), 6.3, bold, MUTED);
      text(page, v, x + 7, Y(top + 30 + 30), 15, bold, c);
      const words = n.split(' ');
      let l1 = '';
      let l2 = '';
      for (const w of words) {
        if (!l2 && tw(`${l1} ${w}`, 6.3) < tw4 - 12) l1 = l1 ? `${l1} ${w}` : w;
        else l2 = l2 ? `${l2} ${w}` : w;
      }
      text(page, l1, x + 7, Y(top + 30 + 40), 6.3, regular, MUTED);
      if (l2) text(page, l2, x + 7, Y(top + 30 + 47), 6.3, regular, MUTED);
    });
    // per-type table
    let yy = top + 96;
    const cols = [MX, MX + 150, MX + 210, MX + 270, MX + 350, MX + 440];
    ['Equipment', 'Units', 'Complete', 'Lines measured', 'Within tolerance', ''].forEach((h, i) =>
      text(page, h, cols[i], Y(yy + 8), 7, bold, MUTED),
    );
    line(MX, Y(yy + 12), MX + 440, Y(yy + 12), 0.5, RULE);
    yy += 14;
    for (const t of sm.types) {
      text(page, t.label, cols[0], Y(yy + 8), 8);
      text(page, String(t.units), cols[1], Y(yy + 8), 8);
      text(page, String(t.complete), cols[2], Y(yy + 8), 8);
      text(page, t.lines ? String(t.lines) : '—', cols[3], Y(yy + 8), 8);
      if (t.lines) {
        const share = t.within / t.lines;
        text(
          page,
          `${t.within} (${num(share * 100)} %)`,
          cols[4],
          Y(yy + 8),
          8,
          bold,
          share < 1 ? rgb(0.75, 0.45, 0.02) : GREEN,
        );
        const bw = 80;
        page.drawRectangle({ x: cols[4] + 52, y: Y(yy + 8), width: bw, height: 6, color: rgb(0.9, 0.91, 0.93) });
        page.drawRectangle({
          x: cols[4] + 52,
          y: Y(yy + 8),
          width: bw * share,
          height: 6,
          color: share < 1 ? rgb(0.9, 0.65, 0.2) : GREEN,
        });
      } else text(page, '—', cols[4], Y(yy + 8), 8, regular, MUTED);
      yy += 12;
    }
    // building balance: OA and exhaust, design vs actual (and the engineer's air balance)
    yy += 12;
    text(page, 'Building balance', MX, Y(yy + 9), 9.5, bold);
    text(
      page,
      'CFM · OA = RTU OA + MAUs + ERV supply + other OA rows; exhaust = fans + small fans 1-30 + ERV exhaust',
      MX + 92,
      Y(yy + 9),
      6.8,
      regular,
      MUTED,
    );
    yy += 16;
    const b = sm.balance;
    const rowsB: [string, number | null, number | null, number | null][] = [
      ['Outside air', b.oaDesign, b.oaActual, sm.airBalance.oa],
      ['Exhaust', b.exhaustDesign, b.exhaustActual, sm.airBalance.exhaust],
    ];
    const maxB = Math.max(1, ...rowsB.flatMap((r) => [r[1] ?? 0, r[2] ?? 0, r[3] ?? 0]));
    const bx = MX + 80;
    const bw = 300;
    rowsB.forEach(([label, d, a, ab], i) => {
      const ry = yy + i * 30;
      text(page, label, MX, Y(ry + 12), 8, bold);
      page.drawRectangle({
        x: bx,
        y: Y(ry + 9),
        width: ((d ?? 0) / maxB) * bw,
        height: 8,
        color: rgb(0.8, 0.86, 0.93),
      });
      page.drawRectangle({ x: bx, y: Y(ry + 19), width: ((a ?? 0) / maxB) * bw, height: 8, color: BRAND });
      text(page, `design ${num(d)}`, bx + ((d ?? 0) / maxB) * bw + 4, Y(ry + 8), 7, regular, MUTED);
      text(page, `actual ${num(a)}`, bx + ((a ?? 0) / maxB) * bw + 4, Y(ry + 18), 7, bold, INK);
      if (ab !== null) {
        const x = bx + (ab / maxB) * bw;
        line(x, Y(ry + 22), x, Y(ry - 1), 1, RED, [2, 1.5]);
        text(page, `air balance ${num(ab)}`, x + 3, Y(ry - 1), 6.3, regular, RED);
      }
    });
    yy += 62;
    const netD = b.designBalance;
    const netA = b.actualBalance;
    const sign = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${num(v)}`);
    text(
      page,
      `Net (OA − exhaust): design ${sign(netD)} · actual ${sign(netA)}${sm.airBalance.net !== null ? ` · air balance ${sign(sm.airBalance.net)}` : ''} CFM${netA !== null ? (netA >= 0 ? ' (positive)' : ' (negative)') : ''}`,
      MX,
      Y(yy + 8),
      8,
      bold,
    );
    if (sm.pressures.length)
      text(
        page,
        `Measured pressures: ${sm.pressures.map((p) => `${p.label} ${typeof p.dp === 'number' ? `${num(p.dp, 3)} in. w.g.` : p.dp}`).join(' · ')}`,
        MX,
        Y(yy + 20),
        7.5,
        regular,
        MUTED,
      );
    return yy + 30 - top;
  };

  const drawBars = (f: BarsFigure, top: number) => {
    heading(
      `${f.unit} — ${f.table}`,
      `design vs ${f.kind === 'valves' ? 'final' : 'actual'} ${f.unitLabel}, band = design ±${num(f.tolerance * 100)} %`,
    );
    const labelW = 70;
    const pctW = 44;
    const x0 = MX + labelW;
    const bw = CW - labelW - pctW;
    const max = Math.max(1, ...f.rows.flatMap((r) => [(r.design ?? 0) * (1 + f.tolerance), r.actual ?? 0])) * 1.05;
    const sx = (v: number) => x0 + (v / max) * bw;
    f.rows.forEach((r, i) => {
      const yt = top + 26 + i * 15;
      const yb = Y(yt + 11);
      text(page, r.label.slice(0, 14), MX, yb + 2, 7.5);
      if (r.design !== null && r.design > 0) {
        page.drawRectangle({
          x: sx(r.design * (1 - f.tolerance)),
          y: yb - 1,
          width: sx(r.design * (1 + f.tolerance)) - sx(r.design * (1 - f.tolerance)),
          height: 12,
          color: BAND,
        });
        page.drawLine({
          start: { x: sx(r.design), y: yb - 2 },
          end: { x: sx(r.design), y: yb + 12 },
          thickness: 1.2,
          color: INK,
        });
      }
      if (r.actual !== null) {
        const ok = r.design !== null && r.design > 0 && Math.abs(r.actual / r.design - 1) <= f.tolerance + 1e-9;
        page.drawRectangle({
          x: x0,
          y: yb + 2,
          width: Math.max(0.5, sx(r.actual) - x0),
          height: 6,
          color: r.design ? (ok ? GREEN : RED) : MUTED,
        });
        if (r.design)
          text(
            page,
            `${num((r.actual / r.design) * 100)} %`,
            W - MX - pctW + 6,
            yb + 2,
            7.5,
            ok ? regular : bold,
            ok ? INK : RED,
          );
      }
    });
    const yl = Y(top + 26 + f.rows.length * 15 + 12);
    text(page, `0`, x0, yl, 7, regular, MUTED);
    text(page, `${num(max)} ${f.unitLabel}`, x0 + bw - tw(`${num(max)} ${f.unitLabel}`, 7), yl, 7, regular, MUTED);
    text(
      page,
      'Black line = design; bar = measured (green inside the band, red outside)',
      x0 + 60,
      yl,
      7,
      regular,
      MUTED,
    );
  };

  const drawPump = (f: PumpFigure, top: number) => {
    heading(`${f.unit} — pump operating point`, 'flow (GPM) vs head (ft w.g.)');
    const px = MX + 40;
    const pw = 300;
    const ph = 170;
    const ptop = top + 34;
    const curve = f.curve ?? [];
    const maxQ = Math.max(1, f.designGpm ?? 0, f.actualGpm ?? 0, ...curve.map((p) => p.gpm / 1.3)) * 1.3;
    const maxHd =
      Math.max(1, f.designHead ?? 0, f.finalHead ?? 0, f.shutoffHead ?? 0, ...curve.map((p) => p.head)) * 1.2;
    const X = (q: number) => px + (q / maxQ) * pw;
    const Yh = (h: number) => Y(ptop + ph - (h / maxHd) * ph);
    page.drawLine({ start: { x: px, y: Yh(0) }, end: { x: px + pw, y: Yh(0) }, thickness: 0.8, color: INK });
    page.drawLine({ start: { x: px, y: Yh(0) }, end: { x: px, y: Yh(maxHd) }, thickness: 0.8, color: INK });
    for (let k = 1; k <= 4; k++) {
      text(page, num((maxQ * k) / 4), X((maxQ * k) / 4) - 8, Yh(0) - 10, 7, regular, MUTED);
      text(page, num((maxHd * k) / 4), px - 26, Yh((maxHd * k) / 4) - 3, 7, regular, MUTED);
    }
    text(page, 'GPM', px + pw + 6, Yh(0) - 3, 7.5, bold);
    text(page, 'ft', px - 4, Yh(maxHd) + 6, 7.5, bold);
    for (let i = 1; i < curve.length; i++)
      page.drawLine({
        start: { x: X(curve[i - 1].gpm), y: Yh(curve[i - 1].head) },
        end: { x: X(curve[i].gpm), y: Yh(curve[i].head) },
        thickness: 1.4,
        color: BRAND,
        opacity: 0.55,
      });
    if (f.designGpm !== null && f.designHead !== null) {
      page.drawCircle({ x: X(f.designGpm), y: Yh(f.designHead), size: 4, borderColor: INK, borderWidth: 1.2 });
      text(page, 'design', X(f.designGpm) - 6 - tw('design', 7.5), Yh(f.designHead) + 4, 7.5);
    }
    if (f.actualGpm !== null && f.finalHead !== null) {
      page.drawCircle({ x: X(f.actualGpm), y: Yh(f.finalHead), size: 4, color: BRAND });
      text(page, 'operating', X(f.actualGpm) + 6, Yh(f.finalHead) - 9, 7.5, bold, BRAND);
    }
    if (f.shutoffHead !== null) {
      page.drawCircle({ x: X(0), y: Yh(f.shutoffHead), size: 3, color: MUTED });
      text(page, 'shut-off', X(0) + 6, Yh(f.shutoffHead) + 2, 7.5, regular, MUTED);
    }
    const lx = px + pw + 30;
    const lines = [
      `Design ${num(f.designGpm)} GPM @ ${num(f.designHead, 1)} ft`,
      `Operating ${num(f.actualGpm)} GPM @ ${num(f.finalHead, 1)} ft`,
      `Shut-off head ${num(f.shutoffHead, 1)} ft`,
      f.designGpm && f.actualGpm ? `Flow ${num((f.actualGpm / f.designGpm) * 100)} % of design` : '',
    ].filter(Boolean);
    lines.forEach((l, i) => text(page, l, lx, Y(ptop + 12 + i * 14), 9, i < 2 ? bold : regular));
    const noteY = ptop + 12 + lines.length * 14 + 4;
    if (curve.length) {
      text(page, `Curve: ${f.curveName ?? 'pump library'}`, lx, Y(noteY), 7, regular, MUTED);
      if (f.impeller !== null)
        text(
          page,
          `impeller ${num(f.impeller, 2)} in. (est. from the shut-off head)`,
          lx,
          Y(noteY + 9),
          7,
          regular,
          MUTED,
        );
    } else {
      text(page, 'Pick the pump in the pump-curve', lx, Y(noteY), 7, regular, MUTED);
      text(page, 'library to draw its curve here.', lx, Y(noteY + 9), 7, regular, MUTED);
    }
  };

  const draw = (f: Figure) => {
    const h = figureHeight(f);
    if (y + h > H - BOTTOM) newPage();
    if (f.kind === 'profile') drawProfile(f, y);
    else if (f.kind === 'traverse') drawTraverse(f, y);
    else if (f.kind === 'pump') drawPump(f, y);
    else drawBars(f, y);
    y += h + 12;
  };

  if (inline) {
    const groups: FigureGroup[] = [];
    const start = (key: string, title: string, unit: string | null, type: EquipmentTypeKey | null) => {
      groupTitle = title;
      newPage();
      groups.push({ key, unit, type, firstPage: pages.length - 1, pageCount: 0 });
    };
    const close = () => {
      const g = groups[groups.length - 1];
      if (g) g.pageCount = pages.length - g.firstPage;
    };
    if (model.summary && model.summary.units) {
      start('summary', 'Summary', null, null);
      drawSummary(model.summary, y);
      close();
    }
    const figs = paginateFigures(
      model.figures.filter((f) => opts.outletCharts || (f.kind !== 'outlets' && f.kind !== 'valves')),
    );
    let key = '';
    for (const f of figs) {
      const k = `${f.type ?? ''}|${f.unit}`;
      if (k !== key) {
        close();
        key = k;
        start(k, f.unit, f.unit, f.type ?? null);
      }
      draw(f);
    }
    close();
    return { bytes: pages.length ? await doc.save() : new Uint8Array(), pages: pages.length, groups };
  }

  newPage();
  if (model.summary && model.summary.units) y += drawSummary(model.summary, y) + 14;
  const figs = paginateFigures(model.figures);
  if (!figs.length)
    text(
      page,
      'No figures yet: enter static profiles, traverse readings, outlet or valve readings, or pump tests.',
      MX,
      Y(y + 14),
      10,
      regular,
      MUTED,
    );
  for (const f of figs) draw(f);
  pages.forEach((p, i) => {
    const s = `${model.projectName} · Graphics Appendix · Page ${i + 1} of ${pages.length}`;
    p.drawText(clean(s), { x: W / 2 - tw(s, 7.5) / 2, y: 22, size: 7.5, font: regular, color: MUTED });
  });
  return { bytes: await doc.save(), pages: pages.length, groups: [] };
}

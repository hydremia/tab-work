/**
 * Graphics appendix PDF (ROADMAP §7.1): the figures of reports/graphicsModel.ts drawn with pdf-lib (vector, so they
 * print sharp), a title block and page numbers like the Issues / Photo reports. Delivered next to the workbook.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { XCell } from '../domain/staticProfile';
import { sanitizer } from './pdf';
import type { BarsFigure, Figure, GraphicsModel, ProfileFigure, PumpFigure, TraverseFigure } from './graphicsModel';

const W = 612;
const H = 792;
const MX = 42;
const TOP = 40;
const BOTTOM = 44;
const CW = W - 2 * MX;
const INK = rgb(0.1, 0.12, 0.15);
const MUTED = rgb(0.42, 0.46, 0.52);
const RULE = rgb(0.82, 0.85, 0.88);
const BRAND = rgb(0.06, 0.29, 0.5);
const GREEN = rgb(0.09, 0.47, 0.25);
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
      return 232;
    case 'traverse':
      return 260;
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

export async function renderGraphicsPdf(
  model: GraphicsModel,
  header: GraphicsHeader,
  now = new Date(),
): Promise<{ bytes: Uint8Array; pages: number }> {
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
  let y = 0; // current top (from the top edge)
  const Y = (top: number) => H - top;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = TOP;
    if (pages.length === 1) {
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
  const drawProfile = (f: ProfileFigure, top: number) => {
    const p = f.profile;
    heading(`${f.unit} — static pressure profile`, `${f.typeLabel} · in. w.g., airflow left to right`);
    // stations: inlet, each present component, discharge
    const comps = p.labels.map((l, k) => ({ label: l, k })).filter((c) => !p.absent[c.k]);
    const boxes = [{ label: p.inlet || 'Inlet', k: -1 }, ...comps];
    const bw = Math.min(74, ((CW - 20) / boxes.length) * 0.62);
    const gap = (CW - boxes.length * bw) / (boxes.length + 1);
    const by = top + 34;
    boxes.forEach((b, i) => {
      const x = MX + gap + i * (bw + gap);
      page.drawRectangle({
        x,
        y: Y(by + 30),
        width: bw,
        height: 30,
        color: b.k < 0 ? rgb(0.95, 0.95, 0.95) : BOX,
        borderColor: BRAND,
        borderWidth: 0.8,
      });
      center(page, b.label, x + bw / 2, Y(by + 19), 8.5, bold);
      if (b.k >= 0 && p.dp[b.k] !== null)
        center(page, `ΔP ${num(p.dp[b.k], 2)}`, x + bw / 2, Y(by + 44), 8, regular, MUTED);
      // static after this station (the inlet: entering static of component 1)
      const s = b.k < 0 ? p.strip[0] : p.strip[b.k + 1];
      const sx = x + bw + gap / 2;
      page.drawLine({
        start: { x: x + bw, y: Y(by + 15) },
        end: { x: x + bw + gap - 4, y: Y(by + 15) },
        thickness: 0.8,
        color: INK,
      });
      page.drawLine({
        start: { x: x + bw + gap - 8, y: Y(by + 12) },
        end: { x: x + bw + gap - 4, y: Y(by + 15) },
        thickness: 0.8,
        color: INK,
      });
      page.drawLine({
        start: { x: x + bw + gap - 8, y: Y(by + 18) },
        end: { x: x + bw + gap - 4, y: Y(by + 15) },
        thickness: 0.8,
        color: INK,
      });
      if (cellText(s)) center(page, cellText(s), sx, Y(by + 8), 8.5, bold);
    });
    // trace: static at each station
    const pts = boxes
      .map((b, i) => ({
        i,
        v:
          typeof (b.k < 0 ? p.strip[0] : p.strip[b.k + 1]) === 'number'
            ? ((b.k < 0 ? p.strip[0] : p.strip[b.k + 1]) as number)
            : null,
      }))
      .filter((q): q is { i: number; v: number } => q.v !== null);
    const cy = top + 96;
    const ch = 90;
    if (pts.length) {
      const lo = Math.min(0, ...pts.map((q) => q.v));
      const hi = Math.max(0, ...pts.map((q) => q.v));
      const span = hi - lo || 1;
      const yOf = (v: number) => Y(cy + ch - ((v - lo) / span) * ch);
      const xOf = (i: number) => MX + gap + i * (bw + gap) + bw + gap / 2;
      page.drawLine({ start: { x: MX, y: yOf(0) }, end: { x: W - MX, y: yOf(0) }, thickness: 0.5, color: RULE });
      text(page, '0', MX - 10, yOf(0) - 3, 7, regular, MUTED);
      for (let j = 1; j < pts.length; j++)
        page.drawLine({
          start: { x: xOf(pts[j - 1].i), y: yOf(pts[j - 1].v) },
          end: { x: xOf(pts[j].i), y: yOf(pts[j].v) },
          thickness: 1.2,
          color: BRAND,
        });
      for (const q of pts) page.drawCircle({ x: xOf(q.i), y: yOf(q.v), size: 2.4, color: BRAND });
    }
    const esp = p.esp;
    const espTxt =
      f.designEsp !== null && esp !== null
        ? `ESP ${num(esp, 2)} vs design ${num(f.designEsp, 2)} (${num((esp / f.designEsp) * 100)} %)`
        : `ESP ${num(esp, 2)}`;
    text(
      page,
      `Fan TSP ${num(p.tsp, 2)} · ${espTxt} · unit ΔP inlet → fan ${num(p.unitDp, 2)}`,
      MX,
      Y(top + 206),
      9,
      bold,
    );
  };

  const shade = (ratio: number) => {
    // 0.5 → light, 1.5 → dark
    const t = Math.max(0, Math.min(1, (ratio - 0.5) / 1));
    return rgb(0.9 - 0.62 * t, 0.94 - 0.5 * t, 0.98 - 0.35 * t);
  };
  const drawTraverse = (f: TraverseFigure, top: number) => {
    heading(
      `${f.unit} — duct traverse`,
      `${f.sizeText} · ${f.round ? 'round, 2 axes' : `${f.positions.length} x ${f.depths.length} points`} · fpm`,
    );
    const avg = f.average;
    const boxTop = top + 30;
    const maxH = 176;
    const flagged = (v: number) => avg !== null && Math.abs(v / avg - 1) > 0.25;
    if (!f.round) {
      const nW = f.positions.length;
      const nH = f.depths.length;
      const aspect = (f.positions.at(-1)! + f.positions[0]) / Math.max(1, f.depths.at(-1)! + f.depths[0]);
      let gw = Math.min(360, maxH * aspect);
      let gh = gw / aspect;
      if (gh > maxH) {
        gh = maxH;
        gw = gh * aspect;
      }
      const x0 = MX + 10;
      page.drawRectangle({ x: x0, y: Y(boxTop + gh), width: gw, height: gh, borderColor: INK, borderWidth: 1 });
      for (let r = 0; r < nH; r++)
        for (let k = 0; k < nW; k++) {
          const v = f.readings[r][k];
          const cw = gw / nW;
          const chh = gh / nH;
          const x = x0 + k * cw;
          const yb = Y(boxTop + (r + 1) * chh);
          if (v !== null && avg)
            page.drawRectangle({
              x: x + 1,
              y: yb + 1,
              width: cw - 2,
              height: chh - 2,
              color: shade(v / avg),
              borderColor: flagged(v) ? RED : undefined,
              borderWidth: flagged(v) ? 1.2 : 0,
            });
          center(
            page,
            v === null ? '·' : num(v),
            x + cw / 2,
            yb + chh / 2 - 3,
            Math.min(8, cw / 3.2),
            v !== null && flagged(v) ? bold : regular,
          );
        }
    } else {
      const R = 92;
      const cx = MX + 10 + R;
      const cyy = Y(boxTop + R + 4);
      page.drawCircle({ x: cx, y: cyy, size: R, borderColor: INK, borderWidth: 1 });
      const D = f.positions.length ? Math.max(...f.positions) + Math.min(...f.positions) : 1;
      f.readings.slice(0, 2).forEach((axis, a) => {
        axis.forEach((v, k) => {
          const off = (f.positions[k] / D - 0.5) * 2 * R;
          const x = a === 0 ? cx + off : cx;
          const yy = a === 0 ? cyy : cyy - off;
          if (v !== null && avg)
            page.drawCircle({
              x,
              y: yy,
              size: 7,
              color: shade(v / avg),
              borderColor: flagged(v) ? RED : BRAND,
              borderWidth: flagged(v) ? 1.2 : 0.4,
            });
          center(page, v === null ? '·' : num(v), x, yy - 2, 5, v !== null && flagged(v) ? bold : regular);
        });
      });
    }
    const lx = MX + 372;
    const lines = [
      `Average ${num(avg)} fpm`,
      `Spread (CoV) ${f.cov === null ? '—' : `${num(f.cov * 100)} %`}`,
      `CFM ${num(f.cfm)} vs design ${num(f.design)}`,
      'Red: over 25 % from the average',
      'Darker = faster',
    ];
    lines.forEach((l, i) =>
      text(page, l, lx, Y(boxTop + 12 + i * 14), i < 3 ? 9 : 7.5, i < 3 ? bold : regular, i < 3 ? INK : MUTED),
    );
    if (f.round)
      f.readings
        .slice(0, 2)
        .forEach((axis, i) =>
          text(
            page,
            `Axis ${i === 0 ? 'A' : 'B'}: ${axis.map((v) => (v === null ? '·' : num(v))).join('  ')}`,
            lx,
            Y(boxTop + 12 + (6 + i) * 14),
            7.5,
          ),
        );
    if (f.cov !== null && f.cov > 0.2)
      text(page, 'Uneven: check the location', lx, Y(boxTop + 12 + 5 * 14 + 4), 7.5, bold, RED);
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
    const maxQ = Math.max(1, f.designGpm ?? 0, f.actualGpm ?? 0) * 1.3;
    const maxHd = Math.max(1, f.designHead ?? 0, f.finalHead ?? 0, f.shutoffHead ?? 0) * 1.2;
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
    text(page, 'The pump curve is drawn once the', lx, Y(ptop + 12 + 4 * 14 + 4), 7, regular, MUTED);
    text(page, 'pump-curve library has this pump.', lx, Y(ptop + 12 + 4 * 14 + 13), 7, regular, MUTED);
  };

  newPage();
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
  for (const f of figs) {
    const h = figureHeight(f);
    if (y + h > H - BOTTOM) newPage();
    if (f.kind === 'profile') drawProfile(f, y);
    else if (f.kind === 'traverse') drawTraverse(f, y);
    else if (f.kind === 'pump') drawPump(f, y);
    else drawBars(f, y);
    y += h + 12;
  }
  pages.forEach((p, i) => {
    const s = `${model.projectName} · Graphics Appendix · Page ${i + 1} of ${pages.length}`;
    p.drawText(clean(s), { x: W / 2 - tw(s, 7.5) / 2, y: 22, size: 7.5, font: regular, color: MUTED });
  });
  return { bytes: await doc.save(), pages: pages.length };
}

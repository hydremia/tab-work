/**
 * Report layout math (pure; no pdf-lib, no DOM). All sizes in PDF points (1/72 in). US Letter portrait.
 *
 * Page: margins, a running header (project name | report label) and footer (firm | Page X of Y). Content flows as
 * blocks (headings, text blocks, photo rows) top to bottom; `flow()` assigns each block a page and a position.
 * Photo grids: 2 per page = 1 column x 2 rows, 4 = 2 x 2, 6 = 2 x 3. The row height is chosen so a page always
 * holds that many rows even when every row starts a new group (each row reserves room for one group heading), so
 * "4 per page" is a maximum that a page reaches whenever a group fills it.
 */

export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN_X = 42;
export const MARGIN_TOP = 36;
export const MARGIN_BOTTOM = 32;
export const HEADER_H = 30;
export const FOOTER_H = 22;
export const CONTENT_W = PAGE_W - 2 * MARGIN_X;
/** Top of the content area (distance from the top edge of the page). */
export const CONTENT_TOP = MARGIN_TOP + HEADER_H;
export const CONTENT_H = PAGE_H - MARGIN_TOP - HEADER_H - MARGIN_BOTTOM - FOOTER_H;

export const GROUP_HEAD_H = 26;
export const ROW_GAP = 10;
export const COL_GAP = 14;
/** Label line + up to CAPTION_LINES caption lines under each photo. */
export const LABEL_SIZE = 9.5;
export const CAPTION_SIZE = 8.5;
export const CAPTION_LINES = 3;
export const LINE_GAP = 2;

export type PerPage = 2 | 4 | 6;
export const PER_PAGE_OPTIONS: readonly PerPage[] = [2, 4, 6];

export function gridOf(perPage: PerPage): { cols: number; rows: number } {
  return perPage === 2 ? { cols: 1, rows: 2 } : perPage === 4 ? { cols: 2, rows: 2 } : { cols: 2, rows: 3 };
}

export interface CellBox {
  /** Cell size. */
  w: number;
  h: number;
  /** Image box inside the cell (above the label and caption). */
  imgW: number;
  imgH: number;
  /** Height below the image for the label + caption lines. */
  textH: number;
}

export function textBlockHeight(lines: number): number {
  return LABEL_SIZE + LINE_GAP + 3 + lines * (CAPTION_SIZE + LINE_GAP);
}

/** Size of one photo cell (and its row height) for a grid density. */
export function cellBox(perPage: PerPage): CellBox {
  const { cols, rows } = gridOf(perPage);
  const w = (CONTENT_W - (cols - 1) * COL_GAP) / cols;
  // worst case per page: rows x (heading + row) with a gap after every block but the last
  const h = (CONTENT_H - rows * GROUP_HEAD_H - (2 * rows - 1) * ROW_GAP) / rows;
  const textH = textBlockHeight(CAPTION_LINES);
  return { w, h, imgW: w, imgH: h - textH - 4, textH };
}

/** Largest W x H box with the image's aspect that fits in boxW x boxH (never distorts), centred. */
export function fitContain(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
): { w: number; h: number; dx: number; dy: number } {
  if (!(imgW > 0 && imgH > 0)) return { w: boxW, h: boxH, dx: 0, dy: 0 };
  const s = Math.min(boxW / imgW, boxH / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { w, h, dx: (boxW - w) / 2, dy: (boxH - h) / 2 };
}

/** Pixel long edge worth embedding for a box (about 200 dpi, at most 1600 px). */
export function embedEdgePx(boxW: number, boxH: number, dpi = 200): number {
  return Math.min(1600, Math.ceil((Math.max(boxW, boxH) * dpi) / 72));
}

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export interface FlowBlock {
  height: number;
  /** Keep on the same page as the next block (headings). */
  keepWithNext?: boolean;
  /** Always start a new page (unless the page is still empty). */
  breakBefore?: boolean;
  /** Extra height drawn above this block when it has to start a new page (a "continued" heading). */
  continuationH?: number;
}

export interface Placement {
  page: number;
  /** Distance from the top of the content area. */
  top: number;
  /** A "continued" heading is drawn at top - continuationH. */
  continued: boolean;
}

/**
 * Place blocks on pages. `firstPageOffset` is space already used at the top of page 1 (title block).
 * `gap` is the space after each block. A block taller than a page is placed at the top of its own page.
 */
export function flow(blocks: readonly FlowBlock[], firstPageOffset = 0, gap = ROW_GAP, pageH = CONTENT_H): Placement[] {
  const out: Placement[] = [];
  let page = 0;
  let y = firstPageOffset;
  let pageEmpty = true;
  const newPage = () => {
    page++;
    y = 0;
    pageEmpty = true;
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.breakBefore && !pageEmpty) newPage();
    // a heading goes with the next block: need room for both
    let need = b.height;
    if (b.keepWithNext && blocks[i + 1]) need += gap + blocks[i + 1].height;
    if (y + need > pageH + 0.01 && !(pageEmpty && y === 0)) newPage();
    let continued = false;
    if (pageEmpty && y === 0 && page > 0 && b.continuationH) {
      continued = true;
      y += b.continuationH;
    }
    out.push({ page, top: y, continued });
    y += b.height + gap;
    pageEmpty = false;
  }
  return out;
}

export function pageCount(placements: readonly Placement[], minimum = 1): number {
  return Math.max(minimum, ...placements.map((p) => p.page + 1));
}

/**
 * Greedy word wrap with a width function (font metrics injected, so this is testable without a font).
 * Newlines are kept; words longer than the line are split. At most maxLines (last line gets an ellipsis).
 */
export function wrapText(text: string, width: (s: string) => number, maxWidth: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let cur = '';
    for (let word of words) {
      while (width(word) > maxWidth && word.length > 1) {
        // hard-split a long word
        if (cur) {
          lines.push(cur);
          cur = '';
        }
        let k = word.length - 1;
        while (k > 1 && width(word.slice(0, k)) > maxWidth) k--;
        lines.push(word.slice(0, k));
        word = word.slice(k);
      }
      const next = cur ? `${cur} ${word}` : word;
      if (width(next) <= maxWidth) cur = next;
      else {
        lines.push(cur);
        cur = word;
      }
    }
    if (cur) lines.push(cur);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && width(`${last}…`) > maxWidth) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last.trimEnd()}…`;
    return kept;
  }
  return lines;
}

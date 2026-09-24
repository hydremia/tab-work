import { describe, expect, it } from 'vitest';
import {
  CONTENT_H,
  CONTENT_W,
  COL_GAP,
  GROUP_HEAD_H,
  PER_PAGE_OPTIONS,
  ROW_GAP,
  cellBox,
  chunk,
  embedEdgePx,
  fitContain,
  flow,
  gridOf,
  pageCount,
  wrapText,
  type FlowBlock,
  type PerPage,
} from './layout';

/** Blocks of a photo report: heading + rows per group. */
function photoBlocks(
  groups: number[],
  perPage: PerPage,
): { blocks: FlowBlock[]; kinds: ('h' | 'r')[]; rowPhotos: number[] } {
  const cell = cellBox(perPage);
  const { cols } = gridOf(perPage);
  const blocks: FlowBlock[] = [];
  const kinds: ('h' | 'r')[] = [];
  const rowPhotos: number[] = [];
  for (const n of groups) {
    blocks.push({ height: GROUP_HEAD_H, keepWithNext: true });
    kinds.push('h');
    rowPhotos.push(0);
    for (const row of chunk(Array.from({ length: n }), cols)) {
      blocks.push({ height: cell.h, continuationH: GROUP_HEAD_H + ROW_GAP });
      kinds.push('r');
      rowPhotos.push(row.length);
    }
  }
  return { blocks, kinds, rowPhotos };
}

const photosPerPage = (groups: number[], perPage: PerPage, offset = 0) => {
  const { blocks, rowPhotos } = photoBlocks(groups, perPage);
  const pl = flow(blocks, offset);
  const out: number[] = Array(pageCount(pl)).fill(0);
  pl.forEach((p, k) => (out[p.page] += rowPhotos[k]));
  return out;
};

describe('report layout', () => {
  it('grids: 2 = 1x2, 4 = 2x2, 6 = 2x3; cells fill the content width', () => {
    expect(gridOf(2)).toEqual({ cols: 1, rows: 2 });
    expect(gridOf(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridOf(6)).toEqual({ cols: 2, rows: 3 });
    for (const n of PER_PAGE_OPTIONS) {
      const c = cellBox(n);
      const { cols, rows } = gridOf(n);
      expect(cols * c.w + (cols - 1) * COL_GAP).toBeCloseTo(CONTENT_W, 6);
      // worst case: every row starts a new group (heading + row), gaps between all blocks
      expect(rows * (GROUP_HEAD_H + c.h) + (2 * rows - 1) * ROW_GAP).toBeLessThanOrEqual(CONTENT_H + 1e-6);
      expect(c.imgH).toBeGreaterThan(100);
    }
  });

  it('4 per page: full pages hold 4 photos; a new group starts on the same page when it fits', () => {
    expect(photosPerPage([8], 4)).toEqual([4, 4]);
    expect(photosPerPage([4, 4], 4)).toEqual([4, 4]);
    expect(photosPerPage([2, 2, 2, 2], 4)).toEqual([4, 4]); // two groups per page
    expect(photosPerPage([3, 1, 2], 4)).toEqual([3, 3]); // 3 photos = 2 rows; then 1 + 2 on page 2
  });

  it('never more than N per page, for every density', () => {
    for (const n of PER_PAGE_OPTIONS) {
      for (const groups of [[1, 1, 1, 1, 1, 1, 1], [7, 3, 9], [20], [2, 5, 1, 6, 6]]) {
        const pages = photosPerPage(groups, n);
        expect(Math.max(...pages)).toBeLessThanOrEqual(n);
        expect(pages.reduce((a, b) => a + b, 0)).toBe(groups.reduce((a, b) => a + b, 0));
      }
    }
    expect(photosPerPage([12], 6)).toEqual([6, 6]);
    expect(photosPerPage([4], 2)).toEqual([2, 2]);
  });

  it('a title block on page 1 leaves room for fewer rows there', () => {
    expect(photosPerPage([200], 4, 123)).toEqual([2, ...Array(49).fill(4), 2]);
  });

  it('headings stay with their first row; continued groups get a heading on the next page', () => {
    const { blocks, kinds } = photoBlocks([2, 2, 6], 4);
    const pl = flow(blocks);
    kinds.forEach((k, i) => {
      if (k === 'h') expect(pl[i + 1].page).toBe(pl[i].page);
    });
    const continued = pl.filter((p) => p.continued);
    expect(continued.length).toBe(1);
    expect(continued[0].top).toBe(GROUP_HEAD_H + ROW_GAP);
  });

  it('breakBefore starts a new page unless the page is empty; oversized blocks get their own page', () => {
    const pl = flow([{ height: 50 }, { height: 50, breakBefore: true }, { height: CONTENT_H * 1.5 }, { height: 10 }]);
    expect(pl.map((p) => p.page)).toEqual([0, 1, 2, 3]);
    expect(flow([{ height: 10, breakBefore: true }])[0]).toEqual({ page: 0, top: 0, continued: false });
  });

  it('fitContain keeps the aspect ratio and centres', () => {
    const f = fitContain(4000, 3000, 200, 200);
    expect(f.w / f.h).toBeCloseTo(4 / 3, 6);
    expect(f).toMatchObject({ w: 200, dx: 0 });
    expect(f.dy).toBeCloseTo(25, 6);
    const p = fitContain(1500, 2000, 260, 240);
    expect(p.h).toBe(240);
    expect(p.w).toBeCloseTo(180, 6);
    expect(p.dx).toBeCloseTo(40, 6);
    expect(embedEdgePx(260, 240)).toBe(723);
    expect(embedEdgePx(2000, 100)).toBe(1600);
  });

  it('wrapText: words, newlines, long words, ellipsis', () => {
    const w = (s: string) => s.length; // 1 unit per character
    expect(wrapText('the quick brown fox jumps', w, 10)).toEqual(['the quick', 'brown fox', 'jumps']);
    expect(wrapText('line one\nline two', w, 20)).toEqual(['line one', 'line two']);
    expect(wrapText('abcdefghijklmnop', w, 5)).toEqual(['abcde', 'fghij', 'klmno', 'p']);
    expect(wrapText('aa bb cc dd ee ff', w, 5, 2)).toEqual(['aa bb', 'cc d…']);
    expect(wrapText('', w, 5)).toEqual([]);
  });
});

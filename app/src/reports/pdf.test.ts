import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { Equipment, Issue } from '../data/types';
import { makeJpeg, makePng } from '../test/images';
import { buildReportModel, formatReportDate, reportFileName, type ReportInput, type ReportPhotoMeta } from './model';
import { renderReportPdf, type ImageLoader } from './pdf';

const hasPdftotext = spawnSync('pdftotext', ['-v']).status === 0;
function pdfText(bytes: Uint8Array): string {
  const dir = mkdtempSync(join(tmpdir(), 'rpt-'));
  const f = join(dir, 'r.pdf');
  writeFileSync(f, bytes);
  return spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
}

const T0 = 1_760_000_000_000;
const eq = (id: string, designation: string, type = 'rtu', isExisting = false) =>
  ({ id, designation, type, isExisting }) as Pick<Equipment, 'id' | 'type' | 'designation' | 'isExisting'>;
const issue = (
  id: string,
  kind: Issue['kind'],
  number: number,
  remark: string,
  equipmentId: string | null,
  status: Issue['status'] = 'Open',
): Issue => ({
  id,
  projectId: 'p',
  kind,
  number,
  remark,
  status,
  comments: kind === 'new' ? 'Contractor notified 9/20.' : '',
  equipmentId,
  createdAt: T0,
  updatedAt: T0,
});
let seq = 0;
const photo = (p: Partial<ReportPhotoMeta> & Pick<ReportPhotoMeta, 'category'>): ReportPhotoMeta => ({
  id: `ph${++seq}`,
  projectId: 'p',
  equipmentId: null,
  issueId: null,
  caption: '',
  createdAt: T0 + seq,
  order: seq,
  mimeType: 'image/jpeg',
  width: 80,
  height: 60,
  ...p,
});

function fixture(): ReportInput {
  seq = 0;
  const equipment = [eq('e1', 'RTU-1'), eq('e2', 'RTU-2'), eq('e3', 'EF-1', 'fan', true)];
  const issues = [
    issue('i1', 'new', 1, 'Belt worn on RTU-1; replace. Supply fan ΔP high ≥ 1.2 in. w.g. 🙂', 'e1'),
    issue('i2', 'new', 2, 'Balancing damper for S-4 missing.', null, 'Closed'),
    issue('i3', 'existing', 1, 'Existing EF-1 motor noisy.', 'e3'),
  ];
  const photos = [
    photo({ category: 'unit', equipmentId: 'e1', caption: 'RTU-1 from the north' }),
    photo({ category: 'tag', equipmentId: 'e1' }),
    photo({ category: 'oa_damper', equipmentId: 'e1', width: 60, height: 80 }),
    photo({ category: 'unit', equipmentId: 'e2' }),
    photo({ category: 'unit', equipmentId: 'e3' }),
    photo({ category: 'other', caption: 'Mechanical room overview' }),
    photo({ category: 'cover' }),
    photo({ category: 'deficiency', issueId: 'i1', caption: 'Worn belt' }),
    photo({ category: 'deficiency', issueId: 'i1' }),
    photo({ category: 'deficiency', issueId: 'i3', mimeType: 'image/png' }),
  ];
  return {
    project: {
      name: 'Riverside Medical Office',
      info: { address: '1450 Riverside Dr, Sacramento, CA', reportDate: '2026-09-24' },
    },
    equipment,
    issues,
    photos,
    typeOrder: ['rtu', 'mau', 'erv', 'fan'],
    typeLabel: (t) => (t === 'rtu' ? 'Packaged rooftop unit' : 'Exhaust fan'),
  };
}

const JPG = makeJpeg(80, 60, (x) => [x * 3, 120, 200 - x * 2]);
const PNG = makePng(40, 40, [30, 160, 60]);
const loader =
  (input: ReportInput): ImageLoader =>
  async (id) => {
    const p = input.photos.find((x) => x.id === id);
    if (!p) return null;
    return p.mimeType === 'image/png' ? { bytes: PNG, type: 'png' } : { bytes: JPG, type: 'jpg' };
  };

describe('report model', () => {
  it('Photo Report: groups by unit in type order, then General; deficiency photos under their unit; no cover', () => {
    const input = fixture();
    const m = buildReportModel(input, { kind: 'photos', label: 'Rev 1' });
    expect(m.photoGroups.map((g) => g.title)).toEqual(['RTU-1', 'RTU-2', 'EF-1', 'General']);
    expect(m.photoGroups[0].photos.map((p) => p.label)).toEqual([
      'RTU-1 · Unit',
      'RTU-1 · Tag / label',
      'RTU-1 · OA damper',
      'Photo N-1.1',
      'Photo N-1.2',
    ]);
    expect(m.photoGroups[0].subtitle).toBe('RTU-1 – Packaged rooftop unit');
    expect(m.photoGroups[2].subtitle).toBe('EF-1 – Exhaust fan (existing)');
    expect(m.photoGroups[2].photos.map((p) => p.label)).toEqual(['EF-1 · Unit', 'Photo E-1.1']);
    // deficiency caption falls back to the issue remark
    expect(m.photoGroups[0].photos[4].caption).toMatch(/^Issue N-1: Belt worn/);
    expect(m.photoGroups[3].photos.map((p) => p.label)).toEqual(['General 1']);
    expect(m.reportDate).toBe('September 24, 2026');
    const without = buildReportModel(input, { kind: 'photos', label: '', includeDeficiency: false });
    expect(without.photoGroups[0].photos).toHaveLength(3);
  });

  it('Issues Report: New and Existing sections, separately numbered; either alone', () => {
    const input = fixture();
    const all = buildReportModel(input, { kind: 'issues', label: 'Rev 1' });
    expect(all.issueSections.map((s) => [s.title, s.issues.map((i) => i.label)])).toEqual([
      ['New Equipment', ['N-1', 'N-2']],
      ['Existing Equipment', ['E-1']],
    ]);
    expect(all.issueSections[0].issues[0].photos.map((p) => p.label)).toEqual(['Photo N-1.1', 'Photo N-1.2']);
    expect(all.issueSections[0].issues[1].equipment).toBe('General');
    expect(all.photoGroups).toEqual([]);
    const onlyNew = buildReportModel(input, { kind: 'issues', label: '', issueKinds: ['new'] });
    expect(onlyNew.issueSections.map((s) => s.kind)).toEqual(['new']);
    expect(onlyNew.title).toBe('Issues Report - New Equipment');
    // combined: issues + photo groups without deficiency photos
    const combined = buildReportModel(input, { kind: 'combined', label: '' });
    expect(combined.photoGroups[0].photos).toHaveLength(3);
    expect(combined.title).toBe('Issues and Photo Report');
  });

  it('file names and dates', () => {
    const d = new Date(2026, 8, 24);
    expect(reportFileName('Riverside: MOB', 'photos', 'Rev 1', undefined, d)).toBe(
      'Riverside- MOB - Photo Report Rev 1 2026-09-24.pdf',
    );
    expect(reportFileName('X', 'issues', '', ['existing'], d)).toBe('X - Issues Report (Existing) 2026-09-24.pdf');
    expect(reportFileName('X', 'zip', 'Prelim', undefined, d)).toBe('X - Photos Prelim 2026-09-24.zip');
    expect(formatReportDate('2026-01-05')).toBe('January 5, 2026');
  });
});

describe('report PDF', () => {
  it('Photo Report: valid PDF, page count from the layout, labels and header text', async () => {
    const input = fixture();
    const model = buildReportModel(input, { kind: 'photos', label: 'Rev 1', perPage: 4 });
    const progress: number[] = [];
    const { bytes, pages } = await renderReportPdf(model, {
      loadImage: loader(input),
      onProgress: (d) => progress.push(d),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(pages);
    // RTU-1 (5 photos: 3 rows) needs 2 pages after the title; RTU-2, EF-1, General follow
    expect(pages).toBe(4);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe('Photo Report Rev 1 - Riverside Medical Office');
    expect(progress.at(-1)).toBe(9);
    if (hasPdftotext) {
      const t = pdfText(bytes);
      for (const s of [
        'a2b accurate air balancing, llc',
        'Photo Report',
        'Riverside Medical Office',
        '1450 Riverside Dr, Sacramento, CA',
        'September 24, 2026',
        'RTU-1 · Unit',
        'Photo N-1.1',
        'Photo E-1.1',
        'RTU-1 (continued)',
        'General 1',
        'Mechanical room overview',
        'Page 1 of 4',
        'Page 4 of 4',
      ])
        expect(t, s).toContain(s);
    }
  });

  it('Issues Report (New only) and combined report', async () => {
    const input = fixture();
    const onlyNew = buildReportModel(input, { kind: 'issues', label: 'Rev 1', issueKinds: ['new'] });
    const r1 = await renderReportPdf(onlyNew, { loadImage: loader(input) });
    expect((await PDFDocument.load(r1.bytes)).getPageCount()).toBe(r1.pages);
    const combined = buildReportModel(input, { kind: 'combined', label: 'Final' });
    const r2 = await renderReportPdf(combined, { loadImage: loader(input) });
    expect(r2.pages).toBeGreaterThan(r1.pages);
    if (hasPdftotext) {
      const t1 = pdfText(r1.bytes);
      expect(t1).toContain('Issue N-1');
      expect(t1).toContain('Issue N-2');
      expect(t1).toContain('CLOSED');
      expect(t1).toContain('Contractor notified 9/20.');
      expect(t1).toContain('Photo N-1.2');
      expect(t1).toContain('Balancing damper for S-4 missing.');
      // characters outside the PDF standard font are replaced, not dropped silently or crashing
      expect(t1).toContain('Supply fan dP high >= 1.2 in. w.g. ?');
      expect(t1).not.toContain('Existing Equipment');
      expect(t1).not.toContain('E-1');
      const t2 = pdfText(r2.bytes);
      expect(t2).toContain('Existing Equipment');
      expect(t2).toContain('Issue E-1');
      expect(t2).toContain('RTU-2 · Unit');
      expect(t2).toContain(`Page ${r2.pages} of ${r2.pages}`);
    }
  });

  it('a missing image is drawn as a placeholder', async () => {
    const input = fixture();
    const model = buildReportModel(input, { kind: 'photos', label: '' });
    const { bytes } = await renderReportPdf(model, {
      loadImage: async () => ({ bytes: new Uint8Array([1, 2, 3]), type: 'jpg' }),
    });
    if (hasPdftotext) expect(pdfText(bytes)).toContain('Image not available');
  });

  it('200 photos at 4 per page: 51 pages, one image at a time', async () => {
    seq = 0;
    const input: ReportInput = {
      ...fixture(),
      issues: [],
      equipment: [eq('e1', 'RTU-1')],
      photos: Array.from({ length: 200 }, (_, k) =>
        photo({ category: 'other', equipmentId: 'e1', caption: `Photo ${k + 1}` }),
      ),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const t = Date.now();
    const { bytes, pages } = await renderReportPdf(buildReportModel(input, { kind: 'photos', label: 'Rev 1' }), {
      loadImage: async () => {
        maxInFlight = Math.max(maxInFlight, ++inFlight);
        await Promise.resolve();
        inFlight--;
        return { bytes: JPG, type: 'jpg' };
      },
    });
    expect(pages).toBe(51);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(51);
    expect(maxInFlight).toBe(1);
    expect(Date.now() - t).toBeLessThan(30_000);
  });
});

/**
 * Browser entry points of the report exports (lazy-loaded by the Export tab, so pdf-lib and JSZip are only
 * downloaded when a report is made; both are precached by the service worker, so this works offline).
 */
import JSZip from 'jszip';
import { db } from '../data/db';
import type { IssueKind, Photo } from '../data/types';
import { EQUIPMENT_TYPES } from '../domain/equipmentTypes';
import { downscaleForReport } from '../photos/process';
import { zipEntryNames } from '../photos/labels';
import type { PerPage } from './layout';
import { buildReportModel, reportFileName, type ReportInput, type ReportKind, type ReportPhotoMeta } from './model';
import { renderReportPdf, type ImageLoader } from './pdf';

export interface ReportRequest {
  kind: ReportKind;
  label: string;
  issueKinds?: IssueKind[];
  perPage?: PerPage;
  includeDeficiency?: boolean;
}

export interface ReportResult {
  bytes: Uint8Array;
  fileName: string;
  pages: number;
  photos: number;
}

const meta = ({ blob: _b, thumb: _t, ...m }: Photo): ReportPhotoMeta => m;

export async function loadReportInput(projectId: string): Promise<ReportInput> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');
  const [equipment, issues, photos] = await Promise.all([
    db.equipment.where('projectId').equals(projectId).toArray(),
    db.issues.where('projectId').equals(projectId).toArray(),
    // metadata only; each image is read when it is drawn
    db.photos
      .where('projectId')
      .equals(projectId)
      .toArray()
      .then((ps) => ps.map(meta)),
  ]);
  return {
    project,
    equipment,
    issues,
    photos,
    typeOrder: EQUIPMENT_TYPES.map((t) => t.key),
    typeLabel: (t) => EQUIPMENT_TYPES.find((x) => x.key === t)?.label ?? t,
  };
}

/** Reads one photo from IndexedDB and downscales it for the page (one image in memory at a time). */
export const browserImageLoader: ImageLoader = async (photoId, maxEdge) => {
  const p = await db.photos.get(photoId);
  if (!p) return null;
  const r = await downscaleForReport(p.blob, maxEdge);
  return { bytes: r.bytes, type: 'jpg' };
};

export async function generateReport(
  projectId: string,
  req: ReportRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<ReportResult> {
  const input = await loadReportInput(projectId);
  const model = buildReportModel(input, {
    kind: req.kind,
    label: req.label,
    issueKinds: req.issueKinds,
    perPage: req.perPage,
    includeDeficiency: req.includeDeficiency,
  });
  const { bytes, pages } = await renderReportPdf(model, { loadImage: browserImageLoader, onProgress });
  return {
    bytes,
    fileName: reportFileName(input.project.name, req.kind, req.label, req.issueKinds),
    pages,
    photos:
      model.photoGroups.reduce((m, g) => m + g.photos.length, 0) +
      model.issueSections.reduce((m, s) => m + s.issues.reduce((k, i) => k + i.photos.length, 0), 0),
  };
}

/** Zip of every stored photo of the project (the stored images, EXIF stripped, long edge <= 2000 px). */
export async function generatePhotoZip(
  projectId: string,
  label: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ReportResult> {
  const input = await loadReportInput(projectId);
  const names = zipEntryNames(input.photos, input.equipment, input.issues);
  const zip = new JSZip();
  const ids = [...names.keys()];
  for (const [k, id] of ids.entries()) {
    const p = await db.photos.get(id);
    if (!p) continue;
    // JPEG is already compressed: store, don't deflate
    zip.file(names.get(id)!, p.blob, {
      binary: true,
      compression: 'STORE',
      date: new Date(p.capturedAt ?? p.createdAt),
    });
    onProgress?.(k + 1, ids.length);
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return { bytes, fileName: reportFileName(input.project.name, 'zip', label), pages: 0, photos: ids.length };
}

export function downloadFile(bytes: Uint8Array, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

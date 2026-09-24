/** Browser export: load the bundled template, fill it with the project's data, download the .xlsm. */
import { exportWorkbookWithReport, type ExportReport } from '@a2b/workbook';
import { cropCoverPhotoBrowser } from '@a2b/workbook/browser';
import { db } from '../data/db';
import { toProjectData } from './adapter';
import { loadBundle } from './bundle';

export const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/tab-template-rev05.xlsm`;
export const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export async function loadTemplate(url = TEMPLATE_URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the workbook template (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function exportFileName(projectName: string, date = new Date()): string {
  const safe =
    projectName
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim() || 'Project';
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${safe} - TAB Report ${d}.xlsm`;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  report: ExportReport;
  warnings: string[];
}

export async function exportProject(projectId: string, template?: Uint8Array): Promise<ExportResult> {
  const bundle = await loadBundle(projectId);
  const { data, warnings } = toProjectData(bundle);
  const cover = (await db.photos.where('[projectId+category]').equals([projectId, 'cover']).toArray())[0];
  const { bytes, report } = await exportWorkbookWithReport(template ?? (await loadTemplate()), data, {
    coverPhoto: cover ? new Uint8Array(await cover.blob.arrayBuffer()) : undefined,
    cropCoverPhoto: cropCoverPhotoBrowser,
  });
  return { bytes, fileName: exportFileName(bundle.project.name), report, warnings };
}

export function downloadBytes(bytes: Uint8Array, fileName: string, mime = XLSM_MIME): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

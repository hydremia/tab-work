/**
 * Browser export: fill the workbook with the project's data, record the export as a revision, download the .xlsm.
 *
 * The workbook written into is the project's base workbook (the last re-imported issued report, decision F1) when
 * there is one and it is still a revision-05 workbook; otherwise the bundled blank template. Onto a base, the app's
 * input cells are first reset to the template's values (so values removed in the app are cleared), then written;
 * everything else in the issued workbook (hand formatting, widths, heights, notes in other cells) stays.
 */
import {
  checkTemplateCompatibility,
  exportWorkbookWithReport,
  importWorkbook,
  type ExportReport,
  type RevisionMarker,
} from '@a2b/workbook';
import { cropCoverPhotoBrowser } from '@a2b/workbook/browser';
import { db } from '../data/db';
import type { Revision } from '../data/types';
import { uuid } from '../data/uuid';
import { APP_SECTIONS, toProjectData } from './adapter';
import { loadBundle } from './bundle';
import { getBaseWorkbook, listRevisions, newRevisionBase, saveRevision, suggestLabel } from './revisions';

export const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/tab-template-rev05.xlsm`;
export const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export async function loadTemplate(url = TEMPLATE_URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the workbook template (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function exportFileName(projectName: string, label = '', date = new Date()): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  const safe = clean(projectName) || 'Project';
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const l = clean(label);
  return `${safe} - TAB Report ${l ? `${l} ` : ''}${d}.xlsm`;
}

export interface ExportOptions {
  /** Revision label (Prelim, Rev 1 ...); default: the suggestion. */
  label?: string;
  /** Blank template bytes (default: fetched from the app bundle / service-worker cache). */
  template?: Uint8Array;
  /** false: ignore the base workbook and use the blank template. */
  useBase?: boolean;
}

export interface ExportResult {
  bytes: Uint8Array;
  fileName: string;
  report: ExportReport;
  warnings: string[];
  revision: Revision;
  /** Written onto the previously issued workbook (its name), or undefined for the blank template. */
  baseFileName?: string;
}

export async function exportProject(projectId: string, opts: ExportOptions = {}): Promise<ExportResult> {
  const bundle = await loadBundle(projectId);
  const { data, warnings } = toProjectData(bundle);
  const cover = (await db.photos.where('[projectId+category]').equals([projectId, 'cover']).toArray())[0];
  const coverPhoto = cover ? new Uint8Array(await cover.blob.arrayBuffer()) : undefined;
  const template = opts.template ?? (await loadTemplate());
  const label = opts.label?.trim() || suggestLabel(await listRevisions(projectId));
  const revisionId = uuid();
  const marker: RevisionMarker = { projectId, revisionId, label, exportedAt: new Date().toISOString() };
  const common = { coverPhoto, cropCoverPhoto: cropCoverPhotoBrowser, marker };

  let out: { bytes: Uint8Array; report: ExportReport } | undefined;
  let baseFileName: string | undefined;
  const base = opts.useBase === false ? undefined : await getBaseWorkbook(projectId);
  if (base) {
    const baseBytes = new Uint8Array(await base.blob.arrayBuffer());
    const compat = await checkTemplateCompatibility(baseBytes, template);
    const fallback = `Exported onto the blank template instead, so hand formatting from ${base.fileName} is not carried forward.`;
    if (!compat.ok) {
      warnings.push(
        `The previously issued workbook is not a revision 05 workbook any more (${compat.problems.join('; ')}). ${fallback}`,
      );
    } else {
      try {
        out = await exportWorkbookWithReport(baseBytes, data, {
          ...common,
          reset: { template, sections: APP_SECTIONS },
        });
        baseFileName = base.fileName;
      } catch (e) {
        warnings.push(
          `Could not write into the previously issued workbook (${e instanceof Error ? e.message : String(e)}). ${fallback}`,
        );
      }
    }
  }
  out ??= await exportWorkbookWithReport(template, data, common);

  // baseline: the values as the workbook holds them (read back from the file), the "base" of a later re-import
  const baseline = await importWorkbook(out.bytes);
  const fileName = exportFileName(bundle.project.name, label);
  const revision: Revision = {
    ...newRevisionBase(projectId),
    id: revisionId,
    kind: 'export',
    label,
    fileName,
    size: out.bytes.length,
    bytes: new Blob([out.bytes as BlobPart], { type: XLSM_MIME }),
    baseline,
    onBase: baseFileName !== undefined,
  };
  await saveRevision(revision);
  return { bytes: out.bytes, fileName, report: out.report, warnings, revision, baseFileName };
}

export function downloadBytes(bytes: Uint8Array | Blob, fileName: string, mime = XLSM_MIME): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

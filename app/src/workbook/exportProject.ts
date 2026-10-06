/**
 * Browser export: fill the workbook with the project's data, record the export as a revision, download the .xlsm.
 *
 * The workbook written into is the project's base workbook (the last re-imported issued report, decision F1) when
 * there is one and it is still a copy of its template revision; otherwise the bundled blank template (revision 07).
 * A rev 05 / 06 base is re-issued in its own layout (TEMPLATE_MAP_06, checked and reset against the bundled rev 06
 * template), so an issued rev 06 report's follow-up keeps its pages; what only rev 07 has a place for is reported as a
 * warning. Onto a base, the app's input cells are first reset to the template's values (so values removed in the app
 * are cleared), then written; everything else in the issued workbook (hand formatting, widths, heights, notes in
 * other cells) stays. The certification profile's stamp and signature are placed on the Certification sheet every time.
 */
import {
  checkTemplateCompatibility,
  exportWorkbookWithReport,
  HYDRONIC_MAP,
  importWorkbook,
  mapForRevision,
  TEMPLATE_MAP,
  workbookRevision,
  type ExportReport,
  type RevisionMarker,
} from '@a2b/workbook';
import { cropCoverPhotoBrowser } from '@a2b/workbook/browser';
import { db } from '../data/db';
import { getCertProfile, lockProject } from '../data/repo';
import { certImagesOf } from '../certification/images';
import type { Revision } from '../data/types';
import { uuid } from '../data/uuid';
import { APP_SECTIONS, toProjectData } from './adapter';
import { loadBundle } from './bundle';
import { getBaseWorkbook, listRevisions, newRevisionBase, saveRevision, suggestLabel } from './revisions';

export const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/tab-template-rev07.xlsm`;
/** The revision 06 template: the rev 05 / 06 layout, for re-issuing onto an issued rev 05 / 06 workbook. */
export const TEMPLATE_06_URL = `${import.meta.env.BASE_URL}templates/tab-template-rev06.xlsm`;
export const HYDRONIC_TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/tab-hydronic-h01.xlsm`;
export const XLSM_MIME = 'application/vnd.ms-excel.sheet.macroEnabled.12';

export async function loadTemplate(url = TEMPLATE_URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the workbook template (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export function exportFileName(projectName: string, label = '', date = new Date(), kind = 'TAB Report'): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  const safe = clean(projectName) || 'Project';
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const l = clean(label);
  return `${safe} - ${kind} ${l ? `${l} ` : ''}${d}.xlsm`;
}

export interface ExportOptions {
  /** Revision label (Prelim, Rev 1 ...); default: the suggestion. */
  label?: string;
  /** Blank template bytes (default: fetched from the app bundle / service-worker cache). */
  template?: Uint8Array;
  /** Revision 06 template bytes, for a rev 05 / 06 base workbook (default: fetched like the template). */
  template06?: Uint8Array;
  /** false: ignore the base workbook and use the blank template. */
  useBase?: boolean;
  /**
   * Issue the report: after the export is saved as a revision, the project is locked at it (edits are refused until
   * it is unlocked for follow-up).
   */
  issue?: boolean;
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
  const warnings: string[] = [];
  const cover = (await db.photos.where('[projectId+category]').equals([projectId, 'cover']).toArray())[0];
  const coverPhoto = cover?.blob ? new Uint8Array(await cover.blob.arrayBuffer()) : undefined;
  const template = opts.template ?? (await loadTemplate());
  const label = opts.label?.trim() || suggestLabel(await listRevisions(projectId));
  const revisionId = uuid();
  const marker: RevisionMarker = { projectId, revisionId, label, exportedAt: new Date().toISOString() };
  // the certification profile's stamp and signature, on every export
  const certImages = certImagesOf(await getCertProfile());
  // tolerance colours on the % of design cells (green within the project's tolerance, red outside)
  const common = {
    coverPhoto,
    cropCoverPhoto: cropCoverPhotoBrowser,
    marker,
    certImages,
    toleranceColors: bundle.project.tolerance,
    // unused units, pages and empty rows hidden, so the workbook prints clean without the Print Report macro
    hideUnused: true,
  };

  let out: { bytes: Uint8Array; report: ExportReport } | undefined;
  let baseFileName: string | undefined;
  const base = opts.useBase === false ? undefined : await getBaseWorkbook(projectId);
  if (base) {
    const baseBytes = new Uint8Array(await base.blob.arrayBuffer());
    // the base keeps its own layout: a rev 05 / 06 report is re-issued as rev 05 / 06
    const rev = await workbookRevision(baseBytes).catch(() => TEMPLATE_MAP.revision);
    const map = mapForRevision(rev);
    const fallback = `Exported onto the blank revision ${TEMPLATE_MAP.revision} template instead, so hand formatting from ${base.fileName} is not carried forward.`;
    try {
      const baseTemplate = map === TEMPLATE_MAP ? template : (opts.template06 ?? (await loadTemplate(TEMPLATE_06_URL)));
      const compat = await checkTemplateCompatibility(baseBytes, baseTemplate, map);
      if (!compat.ok) {
        warnings.push(
          `The previously issued workbook is not a revision ${rev} workbook any more (${compat.problems.join('; ')}). ${fallback}`,
        );
      } else {
        const onBase = toProjectData(bundle, 'air', map);
        out = await exportWorkbookWithReport(baseBytes, onBase.data, {
          ...common,
          map,
          reset: { template: baseTemplate, sections: APP_SECTIONS },
        });
        baseFileName = base.fileName;
        if (map !== TEMPLATE_MAP)
          warnings.push(
            `Re-issued onto ${base.fileName}, a revision ${rev} workbook (its pages and hand formatting kept). “Use the blank template instead” exports a revision ${TEMPLATE_MAP.revision} workbook.`,
          );
        warnings.push(...onBase.warnings);
      }
    } catch (e) {
      out = undefined;
      warnings.push(
        `Could not write into the previously issued workbook (${e instanceof Error ? e.message : String(e)}). ${fallback}`,
      );
    }
  }
  if (!out) {
    const fresh = toProjectData(bundle);
    warnings.push(...fresh.warnings);
    out = await exportWorkbookWithReport(template, fresh.data, common);
  }
  for (const sk of out.report.certImages?.skipped ?? [])
    warnings.push(`The ${sk.kind} from the certification profile was not placed: ${sk.reason}.`);

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
    ...(opts.issue ? { issued: true } : {}),
  };
  await saveRevision(revision);
  if (opts.issue) await lockProject(projectId, label, revisionId);
  return { bytes: out.bytes, fileName, report: out.report, warnings, revision, baseFileName };
}

export interface HydronicExportResult {
  bytes: Uint8Array;
  fileName: string;
  report: ExportReport;
  warnings: string[];
}

/**
 * The hydronic workbook (H01): pumps, valve systems, plant, flow readings and the shared report pages, written into
 * the blank hydronic template. Not recorded as a revision and not re-importable yet (the airside export keeps the
 * issue / lock workflow); the cover photo and the certification profile's stamp and signature are placed as on the
 * airside workbook.
 */
export async function exportHydronic(
  projectId: string,
  opts: { label?: string; template?: Uint8Array } = {},
): Promise<HydronicExportResult> {
  const bundle = await loadBundle(projectId);
  const { data, warnings } = toProjectData(bundle, 'hydronic');
  const cover = (await db.photos.where('[projectId+category]').equals([projectId, 'cover']).toArray())[0];
  const coverPhoto = cover?.blob ? new Uint8Array(await cover.blob.arrayBuffer()) : undefined;
  const template = opts.template ?? (await loadTemplate(HYDRONIC_TEMPLATE_URL));
  const certImages = certImagesOf(await getCertProfile());
  const out = await exportWorkbookWithReport(template, data, {
    map: HYDRONIC_MAP,
    coverPhoto,
    cropCoverPhoto: cropCoverPhotoBrowser,
    certImages,
    toleranceColors: bundle.project.tolerance,
  });
  for (const sk of out.report.certImages?.skipped ?? [])
    warnings.push(`The ${sk.kind} from the certification profile was not placed: ${sk.reason}.`);
  const fileName = exportFileName(bundle.project.name, opts.label?.trim() ?? '', new Date(), 'Hydronic TAB Report');
  return { bytes: out.bytes, fileName, report: out.report, warnings };
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

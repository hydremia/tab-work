/**
 * Reading a schedule file for "Import schedule" (browser; lazy-loaded with the workbook library):
 *  - .csv / .tsv / .txt: parsed like a paste;
 *  - .xlsx / .xlsm / .xls-as-xlsx: every sheet as a grid; when the file is a TAB workbook, also its
 *    {Equipment Data Entry} rows (only that section is read);
 *  - .pdf (drawings, submittals) and photos of schedules: the tables rebuilt from their grid lines and text
 *    (workbook/pdfSchedules.ts; text recognition where a page has no text layer), one "sheet" per table, with the
 *    unit type its title suggests.
 */
import {
  assertFileSize,
  hasScheduleSection,
  readScheduleSection,
  readSheetRows,
  type ScheduleRow,
} from '@a2b/workbook';
import type { EquipmentTypeKey } from '../domain/equipmentTypes';
import { EQUIPMENT_TYPES } from '../domain/equipmentTypes';
import type { FoundTable, Progress } from './pdfSchedules';
import { parseDelimited, type Grid } from '../domain/scheduleImport';

export interface ScheduleFile {
  fileName: string;
  sheets: {
    name: string;
    rows: Grid;
    type?: EquipmentTypeKey | null;
    /** read by text recognition (a drawing without text, a photo): check the values */
    ocr?: boolean;
    /** cells text recognition was unsure of: [row index in `rows`, column] */
    lowConfidence?: [number, number][];
  }[];
  /** The {Equipment Data Entry} rows by equipment type when the file is a TAB workbook. */
  schedule: Record<string, ScheduleRow[]> | null;
}

export async function readScheduleFile(file: File, progress?: Progress): Promise<ScheduleFile> {
  assertFileSize(file.size); // workbooks are also checked before inflating (@a2b/workbook zipLimits)
  if (/\.(jpe?g|png|webp)$/i.test(file.name) || /^image\/(jpeg|png|webp)$/.test(file.type))
    return imageSchedules(file, progress);
  if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
    return {
      fileName: file.name,
      sheets: [{ name: file.name, rows: parseDelimited(await file.text()) }],
      schedule: null,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfSchedules(file.name, bytes, progress);
  const sheets = await readSheetRows(bytes);
  const schedule = (await hasScheduleSection(bytes)) ? await readScheduleSection(bytes) : null;
  return { fileName: file.name, sheets: sheets.filter((s) => s.rows.length), schedule };
}

/** Only the {Equipment Data Entry} section of a TAB workbook. */
export async function readWorkbookSchedule(file: File): Promise<Record<string, ScheduleRow[]>> {
  assertFileSize(file.size);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(await hasScheduleSection(bytes)))
    throw new Error('this is not a TAB workbook (no {Equipment Data Entry} sheet)');
  return readScheduleSection(bytes);
}

async function pdfSchedules(fileName: string, bytes: Uint8Array, progress?: Progress): Promise<ScheduleFile> {
  const { readPdfSchedules } = await import('./pdfSchedules');
  const { tables, ocrPages } = await readPdfSchedules(
    bytes,
    EQUIPMENT_TYPES.map((t) => t.key),
    progress,
  );
  if (!tables.length)
    throw new Error(
      ocrPages
        ? 'no schedule tables were found (the drawing has no text layer and text recognition found no tables)'
        : 'no schedule tables were found in this PDF',
    );
  return { fileName, sheets: sheetsOf(tables), schedule: null };
}

async function imageSchedules(file: File, progress?: Progress): Promise<ScheduleFile> {
  const { readImageSchedules } = await import('./pdfSchedules');
  const tables = await readImageSchedules(
    file,
    EQUIPMENT_TYPES.map((t) => t.key),
    progress,
  );
  if (!tables.length) throw new Error('no schedule table was found in this photo');
  return { fileName: file.name, sheets: sheetsOf(tables), schedule: null };
}

function sheetsOf(tables: FoundTable[]): ScheduleFile['sheets'] {
  return tables.map((t, i) => ({
    name: `p. ${t.page} · ${t.title ?? `table ${i + 1}`}${t.ocr ? ' (text recognition)' : ''}`,
    rows: t.rows,
    type: t.type,
    ...(t.ocr ? { ocr: true, lowConfidence: t.lowConfidence } : {}),
  }));
}

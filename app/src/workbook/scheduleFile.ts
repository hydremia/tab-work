/**
 * Reading a schedule file for "Import schedule" (browser; lazy-loaded with the workbook library):
 *  - .csv / .tsv / .txt: parsed like a paste;
 *  - .xlsx / .xlsm / .xls-as-xlsx: every sheet as a grid; when the file is a TAB workbook, also its
 *    {Equipment Data Entry} rows (only that section is read).
 */
import {
  assertFileSize,
  hasScheduleSection,
  readScheduleSection,
  readSheetRows,
  type ScheduleRow,
} from '@a2b/workbook';
import { parseDelimited, type Grid } from '../domain/scheduleImport';

export interface ScheduleFile {
  fileName: string;
  sheets: { name: string; rows: Grid }[];
  /** The {Equipment Data Entry} rows by equipment type when the file is a TAB workbook. */
  schedule: Record<string, ScheduleRow[]> | null;
}

export async function readScheduleFile(file: File): Promise<ScheduleFile> {
  assertFileSize(file.size); // workbooks are also checked before inflating (@a2b/workbook zipLimits)
  if (/\.(csv|tsv|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
    return {
      fileName: file.name,
      sheets: [{ name: file.name, rows: parseDelimited(await file.text()) }],
      schedule: null,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
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

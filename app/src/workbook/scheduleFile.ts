/**
 * Reading a schedule file for "Import schedule" (browser; lazy-loaded with the workbook library):
 *  - .csv / .tsv / .txt: parsed like a paste;
 *  - .xlsx / .xlsm / .xls-as-xlsx: every sheet as a grid; when the file is a TAB workbook, also its
 *    {Equipment Data Entry} rows (only that section is read);
 *  - .pdf (drawings, submittals): the schedule tables rebuilt from the text (domain/pdfTables.ts), one "sheet" per
 *    table, with the unit type its title suggests. Scanned PDFs have no text (OCR is not built).
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
import { pdfTables } from '../domain/pdfTables';
import { parseDelimited, type Grid } from '../domain/scheduleImport';

export interface ScheduleFile {
  fileName: string;
  sheets: { name: string; rows: Grid; type?: EquipmentTypeKey | null }[];
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
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return readPdfSchedules(file.name, bytes);
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

async function readPdfSchedules(fileName: string, bytes: Uint8Array): Promise<ScheduleFile> {
  const { readPdfText } = await import('./pdfText');
  const { pages } = await readPdfText(bytes);
  if (!pages.some((p) => p.items.some((it) => it.str.trim())))
    throw new Error('this PDF has no text (a scan?): only PDFs made from CAD / Revit / Word can be read');
  const tables = pdfTables(
    pages,
    EQUIPMENT_TYPES.map((t) => t.key),
  );
  if (!tables.length) throw new Error('no schedule tables were found in this PDF');
  return {
    fileName,
    sheets: tables.map((t, i) => ({
      name: `p. ${t.page} · ${t.title ?? `table ${i + 1}`}`,
      rows: t.rows,
      type: t.type,
    })),
    schedule: null,
  };
}

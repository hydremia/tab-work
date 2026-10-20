/**
 * The exported .xlsm as the .xlsx that Microsoft Graph converts to PDF (Graph's PDF conversion takes xlsx, not xlsm):
 * the VBA project removed, with its content type and relationship, and the data-entry sheets hidden, as the Print
 * Report macro prints every visible sheet except those whose name starts with "{" (hidden sheets are not printed).
 * Every cell, formula and print setting stays as the export wrote it (print areas, manual page breaks, fit to page,
 * print titles, headers and footers, hidden rows): the export already lays the report out without the macro.
 */
import JSZip from 'jszip';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLSM_MAIN = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const XLSX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const VBA_REL = 'http://schemas.microsoft.com/office/2006/relationships/vbaProject';

export interface PdfWorkbook {
  bytes: Uint8Array;
  /** The sheets hidden for the PDF (the "{…}" data-entry sheets), by name. */
  hidden: string[];
  /** Whether a VBA project was removed. */
  vbaRemoved: boolean;
}

/** The sheets whose name starts with "{" are the workbook's data entry; the report never prints them. */
export const isDataEntrySheet = (name: string): boolean => name.startsWith('{');

export async function workbookForPdf(xlsm: Uint8Array): Promise<PdfWorkbook> {
  const zip = await JSZip.loadAsync(xlsm);
  const text = async (path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`Not a workbook: ${path} is missing.`);
    return f.async('string');
  };

  // 1. the VBA project, its relationship and its content type
  const vbaRemoved = Boolean(zip.file('xl/vbaProject.bin'));
  zip.remove('xl/vbaProject.bin');
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const rels = await text(relsPath);
  zip.file(relsPath, rels.replace(new RegExp(`<Relationship [^>]*Type="${VBA_REL}"[^>]*/>`), ''));
  let ct = await text('[Content_Types].xml');
  ct = ct.replace(`ContentType="${XLSM_MAIN}"`, `ContentType="${XLSX_MAIN}"`);
  ct = ct.replace(/<Override PartName="\/xl\/vbaProject\.bin"[^>]*\/>/, '');
  // the .bin default names the VBA project; drop it unless other .bin parts remain (printer settings keep theirs)
  if (!Object.keys(zip.files).some((p) => p.endsWith('.bin')))
    ct = ct.replace(/<Default Extension="bin" ContentType="application\/vnd\.ms-office\.vbaProject"\/>/, '');
  zip.file('[Content_Types].xml', ct);

  // 2. the data-entry sheets hidden; the first (visible) sheet active, so no hidden sheet is the selected one
  const wbPath = 'xl/workbook.xml';
  let wb = await text(wbPath);
  const hidden: string[] = [];
  const hiddenIds: string[] = [];
  wb = wb.replace(/<sheet\b[^>]*\/>/g, (tag) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? '';
    if (!isDataEntrySheet(name)) return tag;
    hidden.push(name.replace(/&amp;/g, '&'));
    const rid = /\br:id="([^"]*)"/.exec(tag)?.[1];
    if (rid) hiddenIds.push(rid);
    if (/\bstate="/.test(tag)) return tag.replace(/\bstate="[^"]*"/, 'state="hidden"');
    return tag.replace(/\/>$/, ' state="hidden"/>');
  });
  wb = wb.replace(/\bactiveTab="\d+"/, 'activeTab="0"');
  zip.file(wbPath, wb);
  for (const rid of hiddenIds) {
    const target = new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] ?? '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const f = zip.file(path);
    if (!f) continue;
    const xml = await f.async('string');
    if (/\btabSelected="1"/.test(xml)) zip.file(path, xml.replace(/\s*\btabSelected="1"/g, ''));
  }

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: XLSX_MIME });
  return { bytes, hidden, vbaRemoved };
}

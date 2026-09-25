/**
 * Size limits for workbooks picked by a user (import, re-import, schedule import, base workbook): a .xlsm / .xlsx is
 * a zip, and a small file can inflate to gigabytes ("zip bomb"). Checked BEFORE anything is inflated: the file size,
 * then the uncompressed sizes the zip's central directory declares, entry by entry and in total (what JSZip would
 * inflate). JSZip compares each entry's inflated size with the declared one once it is inflated and fails on a
 * mismatch, so a header that lies is an error, not silently accepted (it can still use memory while it inflates).
 *
 * A revision 05 workbook is ~4 MB (~30 MB uncompressed), so the limits leave plenty of room.
 */
import JSZip from 'jszip';

export const MAX_WORKBOOK_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_WORKBOOK_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
/** No single part of a workbook comes near this (the largest sheet of revision 05 is ~5 MB). */
export const MAX_WORKBOOK_ENTRY_BYTES = 100 * 1024 * 1024;
export const MAX_WORKBOOK_ENTRIES = 5000;

export interface ZipLimits {
  maxFileBytes?: number;
  maxUncompressedBytes?: number;
  maxEntryBytes?: number;
  maxEntries?: number;
}

export class WorkbookTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookTooLargeError';
  }
}

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** File size check only (before the bytes are even read): throws WorkbookTooLargeError. */
export function assertFileSize(size: number, limits: ZipLimits = {}): void {
  const max = limits.maxFileBytes ?? MAX_WORKBOOK_FILE_BYTES;
  if (size > max)
    throw new WorkbookTooLargeError(`The file is ${mb(size)}; workbooks larger than ${mb(max)} are not accepted.`);
}

/**
 * Reads the zip's central directory (no inflating) and throws WorkbookTooLargeError when the file, an entry or the
 * total declared uncompressed size is over the limits, or when the directory can't be read (not a zip, ZIP64).
 * Returns the total declared uncompressed size.
 */
export function assertZipWithinLimits(bytes: Uint8Array, limits: ZipLimits = {}): number {
  assertFileSize(bytes.length, limits);
  const maxTotal = limits.maxUncompressedBytes ?? MAX_WORKBOOK_UNCOMPRESSED_BYTES;
  const maxEntry = limits.maxEntryBytes ?? MAX_WORKBOOK_ENTRY_BYTES;
  const maxEntries = limits.maxEntries ?? MAX_WORKBOOK_ENTRIES;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // end of central directory record: signature 0x06054b50, within the last 22 + 65535 bytes (comment)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new WorkbookTooLargeError('This file is not a workbook (no zip directory found).');
  const count = dv.getUint16(eocd + 10, true);
  const dirSize = dv.getUint32(eocd + 12, true);
  const dirOffset = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || dirOffset === 0xffffffff)
    throw new WorkbookTooLargeError('ZIP64 workbooks are not accepted.');
  if (count > maxEntries)
    throw new WorkbookTooLargeError(`The workbook has ${count} parts; more than ${maxEntries} are not accepted.`);
  if (dirOffset + dirSize > bytes.length)
    throw new WorkbookTooLargeError('The workbook is damaged (zip directory out of range).');
  let p = dirOffset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50)
      throw new WorkbookTooLargeError('The workbook is damaged (bad zip directory entry).');
    const size = dv.getUint32(p + 24, true);
    if (size === 0xffffffff) throw new WorkbookTooLargeError('ZIP64 workbooks are not accepted.');
    if (size > maxEntry)
      throw new WorkbookTooLargeError(`A part of the workbook inflates to ${mb(size)}; the limit is ${mb(maxEntry)}.`);
    total += size;
    if (total > maxTotal)
      throw new WorkbookTooLargeError(`The workbook inflates to more than ${mb(maxTotal)}; it is not accepted.`);
    p += 46 + dv.getUint16(p + 28, true) + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return total;
}

/** JSZip.loadAsync after the limit check (every user-supplied workbook goes through this). */
export async function loadWorkbookZip(bytes: Uint8Array, limits: ZipLimits = {}): Promise<JSZip> {
  assertZipWithinLimits(bytes, limits);
  return JSZip.loadAsync(bytes);
}

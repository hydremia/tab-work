import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { importWorkbook } from './importWorkbook.js';
import { readSheetRows } from './schedule.js';
import { templateBytes } from './testTemplate.js';
import { assertFileSize, assertZipWithinLimits, MAX_WORKBOOK_FILE_BYTES, WorkbookTooLargeError } from './zipLimits.js';

async function zipOf(files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const z = new JSZip();
  for (const [k, v] of Object.entries(files)) z.file(k, v);
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('workbook size limits (checked before inflating)', () => {
  it('the template passes and declares its real uncompressed size', () => {
    const total = assertZipWithinLimits(templateBytes());
    expect(total).toBeGreaterThan(templateBytes().length);
    expect(total).toBeLessThan(100 * 1024 * 1024);
  });

  it('rejects a file over the file-size limit', () => {
    expect(() => assertFileSize(MAX_WORKBOOK_FILE_BYTES + 1)).toThrow(WorkbookTooLargeError);
    expect(() => assertFileSize(MAX_WORKBOOK_FILE_BYTES)).not.toThrow();
  });

  it('rejects a small file that would inflate past the total / per-entry limit', async () => {
    const bomb = await zipOf({ 'a.xml': new Uint8Array(3 * 1024 * 1024), 'b.xml': new Uint8Array(3 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(64 * 1024); // zeros compress ~1000:1
    expect(() => assertZipWithinLimits(bomb, { maxUncompressedBytes: 5 * 1024 * 1024 })).toThrow(/inflates to more/);
    expect(() => assertZipWithinLimits(bomb, { maxEntryBytes: 2 * 1024 * 1024 })).toThrow(/part of the workbook/);
    expect(() => assertZipWithinLimits(bomb, { maxEntries: 1 })).toThrow(/2 parts/);
  });

  it('the importers refuse over-limit files and non-zips with a clear error', async () => {
    await expect(importWorkbook(new TextEncoder().encode('not a zip at all'))).rejects.toBeInstanceOf(
      WorkbookTooLargeError,
    );
    const huge = await zipOf({ 'x.xml': new Uint8Array(210 * 1024 * 1024) });
    await expect(readSheetRows(huge)).rejects.toThrow(/inflates to/);
  }, 60_000);
});

/**
 * Node-only helper: recalculate a workbook with LibreOffice (headless, private profile that forces "always
 * recalculate" on load) and read the computed cell values. Used by the *.recalc.test.ts cross-checks, which are
 * skipped where `soffice` is not installed (CI).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { cellValue, listSheets, loadSharedStrings, parseCells, readText } from '@a2b/workbook';

export const hasSoffice = (): boolean => spawnSync('sh', ['-c', 'command -v soffice']).status === 0;

export type SheetValue = string | number | boolean | null;

/** Writes `bytes`, recalculates them with LibreOffice and returns a reader for the computed values. */
export async function recalc(bytes: Uint8Array): Promise<(sheet: string, ref: string) => Promise<SheetValue>> {
  const dir = mkdtempSync(join(tmpdir(), 'recalc-'));
  const profile = mkdtempSync(join(tmpdir(), 'lo-profile-'));
  try {
    const input = join(dir, 'in.xlsm');
    writeFileSync(input, bytes);
    mkdirSync(join(profile, 'user'), { recursive: true });
    writeFileSync(
      join(profile, 'user', 'registrymodifications.xcu'),
      `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`,
    );
    const outDir = join(dir, 'out');
    mkdirSync(outDir);
    const r = spawnSync(
      'soffice',
      [
        `-env:UserInstallation=file://${profile}`,
        '--headless',
        '--calc',
        '--convert-to',
        'xlsm:Calc MS Excel 2007 VBA XML',
        '--outdir',
        outDir,
        input,
      ],
      { encoding: 'utf8', timeout: 600_000 },
    );
    const out = join(outDir, 'in.xlsm');
    if (!existsSync(out)) throw new Error(`LibreOffice recalculation failed: ${r.stdout} ${r.stderr}`);
    const zip = await JSZip.loadAsync(readFileSync(out));
    const sheets = await listSheets(zip);
    const sst = await loadSharedStrings(zip);
    const cache = new Map<string, ReturnType<typeof parseCells>>();
    return async (sheet, ref) => {
      if (!cache.has(sheet)) {
        const info = sheets.find((s) => s.name === sheet);
        if (!info) throw new Error(`no sheet ${sheet}`);
        cache.set(sheet, parseCells(await readText(zip, info.part)));
      }
      return cellValue(cache.get(sheet)!.get(ref), sst) as SheetValue;
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(profile, { recursive: true, force: true });
  }
}

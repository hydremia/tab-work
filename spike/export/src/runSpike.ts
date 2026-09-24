/**
 * Phase 0 export spike runner:  npm run spike
 *
 * Exports sample/project.json into the rev 05 template, then verifies the result and prints a PASS/FAIL
 * report (also written to out/spike-report.md and out/spike-report.json):
 *   a. package: zip integrity, untouched parts byte-identical, VBA, validations / names / conditional
 *      formats, drawing and cover photo, XML well-formed, row / cell order; map audit (every mapped cell of
 *      the first and last block is a writable input) and stale-cached-value stripping
 *   b. LibreOffice recalculation: 0 error cells, computed results vs independent expectations
 *   c. round trip: import(export) == input; import(LibreOffice re-save, shared strings) differences
 *   d. safety: formula cell, hidden merged cell, bad list value, text in a number field are rejected
 *   e. renders the Cover Page and the RTU-1 page to PNG (LibreOffice PDF + pdftoppm)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import jpeg from 'jpeg-js';
import { XMLValidator } from 'fast-xml-parser';
import { bytesEqual, exportWorkbookWithReport, FormulaCellError, MapError, ValidationError } from './exportWorkbook.js';
import { diff, importWorkbookWithReport, normalizeProject } from './importWorkbook.js';
import { cellValue, listSheets, loadSharedStrings, parseCells, parseRels, RawCell, readText } from './ooxml.js';
import { drawingPictures } from './coverPhoto.js';
import { Layout, NOTATIONS, sequenceCells, tableRows, TEMPLATE_MAP, TemplateMap } from './templateMap.js';
import { expectations, Expected } from './expectations.js';
import { makeTestPhoto, TEST_PHOTO_PATH } from './makeTestPhoto.js';
import type { Cell, LayoutData, ProjectData, UnitData } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPO = join(ROOT, '..', '..');
const OUT = join(ROOT, 'out');
const TEMPLATE = join(REPO, '05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm');

type Status = 'PASS' | 'FAIL' | 'INFO' | 'SKIP';
interface Result { section: string; check: string; status: Status; detail: string }
const results: Result[] = [];
const rec = (section: string, check: string, ok: boolean | Status, detail = '') => {
  const status: Status = typeof ok === 'string' ? ok : ok ? 'PASS' : 'FAIL';
  results.push({ section, check, status, detail });
  console.log(`${status.padEnd(4)}  [${section}] ${check}${detail ? ` - ${detail}` : ''}`);
};
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;

// ------------------------------------------------------------------------------------------ helpers
async function zipParts(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const z = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const m = new Map<string, Uint8Array>();
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) m.set(n, await z.files[n].async('uint8array'));
  return m;
}
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const close = (a: unknown, e: Expected) => {
  if (e === null) return a === null || a === '';
  if (typeof e === 'number') return typeof a === 'number' && Math.abs(a - e) <= 1e-6 * Math.max(1, Math.abs(e));
  return a === e;
};
const fmt = (v: unknown) => (typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6) : JSON.stringify(v));

function which(cmd: string): boolean { return spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0; }

/** LibreOffice headless conversion with a private profile that forces "always recalculate" on load. */
function soffice(input: string, filter: string, outdir: string): string {
  const profile = mkdtempSync(join(tmpdir(), 'lo-profile-'));
  mkdirSync(join(profile, 'user'), { recursive: true });
  writeFileSync(join(profile, 'user', 'registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
  mkdirSync(outdir, { recursive: true });
  const r = spawnSync('soffice', [`-env:UserInstallation=file://${profile}`, '--headless', '--calc', '--convert-to', filter, '--outdir', outdir, input],
    { encoding: 'utf8', timeout: 600_000 });
  rmSync(profile, { recursive: true, force: true });
  const ext = filter.split(':')[0];
  const out = join(outdir, basename(input).replace(/\.[^.]+$/, `.${ext}`));
  if (!existsSync(out)) throw new Error(`soffice --convert-to ${filter} failed: ${r.stdout} ${r.stderr}`);
  return out;
}

class Book {
  private cells = new Map<string, Map<string, RawCell>>();
  private constructor(private zip: JSZip, private sheets: { name: string; part: string }[], private sst: string[]) {}
  static async open(bytes: Uint8Array) {
    const zip = await JSZip.loadAsync(bytes);
    return new Book(zip, await listSheets(zip), await loadSharedStrings(zip));
  }
  sheetNames() { return this.sheets.map((s) => s.name); }
  async sheet(name: string) {
    if (!this.cells.has(name)) this.cells.set(name, parseCells(await readText(this.zip, this.sheets.find((s) => s.name === name)!.part)));
    return this.cells.get(name)!;
  }
  async value(sheet: string, ref: string) { return cellValue((await this.sheet(sheet)).get(ref), this.sst); }
  async errorCells(): Promise<string[]> {
    const out: string[] = [];
    for (const s of this.sheets) {
      for (const c of (await this.sheet(s.name)).values()) {
        const v = cellValue(c, this.sst);
        if (c.t === 'e' || (typeof v === 'string' && /^(#(VALUE!|DIV\/0!|REF!|NAME\?|N\/A|NUM!|NULL!)|Err:\d+)/.test(v))) out.push(`${s.name}!${c.ref}=${v}`);
      }
    }
    return out;
  }
}

/** A project that fills every mapped input of block 1 and of the last block (map audit). */
async function fullFillProject(map: TemplateMap, template: Uint8Array): Promise<ProjectData> {
  const book = await Book.open(template);
  const wbXml = await readText(await JSZip.loadAsync(template), 'xl/workbook.xml');
  const listFirst = async (name: string): Promise<string | number> => {
    const ref = new RegExp(`<definedName name="${name.replace('.', '\\.')}">'([^']+)'!\\$([A-Z]+)\\$(\\d+):`).exec(wbXml)!;
    let v = await book.value(ref[1], `${ref[2]}${ref[3]}`);
    if (v === 'SF') v = await book.value(ref[1], `${ref[2]}${Number(ref[3]) + 1}`);
    return v as string | number;
  };
  let n = 0;
  const val = async (d: { type: string; list?: string; values?: readonly (string | number)[] }): Promise<Cell> => {
    n++;
    if (d.type === 'number') return n % 7 === 0 ? NOTATIONS[n % 3] : n + 0.25;
    if (d.type === 'date') return `2026-0${1 + (n % 9)}-1${n % 10}`;
    if (d.type === 'list') return d.values ? d.values[n % d.values.length] : await listFirst(d.list!);
    return `txt ${n} <&> "q"`;
  };
  const layout = async (def: Layout) => {
    const out: LayoutData = {};
    for (const fd of def.fields ?? []) (out.fields ??= {})[fd.key] = await val(fd);
    for (const td of def.tables ?? []) {
      const rows: Record<string, Cell>[] = [];
      for (const r of tableRows(td)) {
        const rec: Record<string, Cell> = {};
        for (const c of td.columns) if (!r.omit.includes(c.col)) rec[c.key] = await val(c);
        rows.push(rec);
      }
      (out.tables ??= {})[td.key] = rows;
    }
    for (const ld of def.lines ?? []) (out.lines ??= {})[ld.key] = ld.cells.map((_, i) => `line ${i + 1} ${n++}`);
    for (const sd of def.sequences ?? []) (out.sequences ??= {})[sd.key] = await Promise.all(sequenceCells(sd).map(() => val({ type: sd.type })));
    for (const cd of def.columnTables ?? []) {
      const items: Record<string, Cell>[] = [];
      for (const _c of cd.cols) { const r: Record<string, Cell> = {}; for (const fd of cd.fields) r[fd.key] = await val(fd); items.push(r); }
      (out.columnTables ??= {})[cd.key] = items;
    }
    return out;
  };
  const p: ProjectData = { templateRevision: map.revision, sections: {}, equipment: {} };
  for (const s of map.sections) p.sections[s.key] = await layout(s);
  for (const e of map.equipment) {
    const units: UnitData[] = [];
    for (const slot of [1, e.capacity]) {
      const u: UnitData = { slot, ...(await layout(e.block)) };
      if (e.ede) { u.schedule = {}; for (const fd of e.ede.fields) u.schedule[fd.key] = await val(fd); }
      units.push(u);
    }
    p.equipment[e.key] = units;
  }
  return p;
}

// ------------------------------------------------------------------------------------------ main
async function main() {
  mkdirSync(OUT, { recursive: true });
  const template = new Uint8Array(readFileSync(TEMPLATE));
  const project: ProjectData = JSON.parse(readFileSync(join(ROOT, 'sample', 'project.json'), 'utf8'));
  if (!existsSync(TEST_PHOTO_PATH)) writeFileSync(TEST_PHOTO_PATH, makeTestPhoto());
  const photo = new Uint8Array(readFileSync(join(ROOT, 'sample', project.coverPhoto ?? 'cover-photo.jpg')));
  const outName = `${project.name ?? 'Project'} - TAB Report.xlsm`;
  const outPath = join(OUT, outName);

  console.log(`Template: ${basename(TEMPLATE)}\nExporting sample/project.json -> out/${outName}`);
  const te = Date.now();
  const { bytes, report } = await exportWorkbookWithReport(template, project, { coverPhoto: photo });
  const exportMs = Date.now() - te;
  writeFileSync(outPath, bytes);
  rec('export', 'exportWorkbook completed', true,
    `${exportMs} ms; ${report.cellsWritten} cells written (${report.cellsCreated} created), ${report.cellsCleared} cleared; ${(bytes.length / 1e6).toFixed(2)} MB`);
  for (const w of report.warnings) rec('export', 'warning', 'INFO', w);

  // ================================================================================ a. package
  const S = 'a package';
  const before = await zipParts(template);
  let after: Map<string, Uint8Array>;
  try { after = await zipParts(bytes); rec(S, 'zip opens, every part inflates, CRC-32 checked (JSZip)', true, `${after.size} parts`); }
  catch (e) { rec(S, 'zip integrity (JSZip)', false, String(e)); throw e; }
  if (which('unzip')) {
    const r = spawnSync('unzip', ['-tq', outPath], { encoding: 'utf8' });
    rec(S, 'zip integrity (unzip -t)', r.status === 0, r.stdout.trim());
  }
  const changed = [...after.keys()].filter((k) => before.has(k) && !bytesEqual(before.get(k)!, after.get(k)!));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const identical = [...before.keys()].filter((k) => after.has(k) && bytesEqual(before.get(k)!, after.get(k)!));
  rec(S, 'untouched parts byte-identical to the template', identical.length + changed.length + removed.length === before.size,
    `${identical.length} of ${before.size} parts identical; changed ${changed.length}: ${changed.join(', ')}; added: ${added.join(', ')}; removed: ${removed.join(', ')}`);
  const allowedChanged = (k: string) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k) || k === 'xl/drawings/_rels/drawing1.xml.rels';
  rec(S, 'only worksheet XML and the cover drawing rels changed', changed.every(allowedChanged), changed.filter((k) => !allowedChanged(k)).join(', '));
  rec(S, 'export report lists the same changed parts', JSON.stringify(changed.sort()) === JSON.stringify([...report.changedParts].sort()));
  for (const k of ['xl/vbaProject.bin', 'xl/workbook.xml', 'xl/styles.xml', '[Content_Types].xml', 'xl/drawings/drawing1.xml', 'xl/ctrlProps/ctrlProp1.xml']) {
    rec(S, `${k} byte-identical`, !!after.get(k) && bytesEqual(before.get(k)!, after.get(k)!));
  }
  const vml = [...before.keys()].filter((k) => k.endsWith('.vml') || k.startsWith('xl/media/image') && k !== 'xl/media/image8.png');
  rec(S, 'header-logo VML drawings and other media byte-identical', vml.every((k) => after.get(k) && bytesEqual(before.get(k)!, after.get(k)!)), `${vml.length} parts`);

  const sheetsT = await listSheets(await JSZip.loadAsync(template));
  let dv0 = 0, dv1 = 0, cf0 = 0, cf1 = 0, mc0 = 0, mc1 = 0;
  for (const s of sheetsT) {
    const a = text(before.get(s.part)!), b = text(after.get(s.part)!);
    dv0 += count(a, /<dataValidation\b/g); dv1 += count(b, /<dataValidation\b/g);
    cf0 += count(a, /<conditionalFormatting\b/g); cf1 += count(b, /<conditionalFormatting\b/g);
    mc0 += count(a, /<mergeCell\b/g); mc1 += count(b, /<mergeCell\b/g);
  }
  const dn0 = count(text(before.get('xl/workbook.xml')!), /<definedName\b/g), dn1 = count(text(after.get('xl/workbook.xml')!), /<definedName\b/g);
  rec(S, 'data validations unchanged', dv0 === dv1, `${dv1} (template ${dv0})`);
  rec(S, 'conditional-format blocks unchanged', cf0 === cf1, `${cf1} (template ${cf0})`);
  rec(S, 'merged ranges unchanged', mc0 === mc1, `${mc1} (template ${mc0})`);
  rec(S, 'defined names unchanged', dn0 === dn1, `${dn1} (template ${dn0})`);
  rec(S, 'calcPr fullCalcOnLoad="1" kept', /<calcPr\b[^>]*fullCalcOnLoad="1"/.test(text(after.get('xl/workbook.xml')!)));
  let cached = 0, formulas = 0;
  for (const s of sheetsT) for (const m of text(before.get(s.part)!).matchAll(/<f\b[^>]*?(?:\/>|>[^<]*<\/f>)(<v>[^<]*<\/v>)?/g)) { formulas++; if (m[1] && m[1] !== '<v></v>') cached++; }
  rec(S, 'template has no stale cached formula values (verified)', cached === 0, `${formulas} formula cells, ${cached} with a cached value; export stripped ${report.cachedValuesStripped}`);

  // XML well-formedness and order of rows / cells in every changed XML part
  for (const k of changed.filter((x) => /\.(xml|rels)$/.test(x))) {
    const xml = text(after.get(k)!);
    const v = XMLValidator.validate(xml);
    let orderOk = true, detail = '';
    if (k.startsWith('xl/worksheets/')) {
      let lastRow = 0;
      for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const r = Number(m[1]);
        if (r <= lastRow) { orderOk = false; detail = `row ${r} after ${lastRow}`; break; }
        lastRow = r;
        let lastCol = 0;
        for (const c of (m[2] ?? '').matchAll(/<c r="([A-Z]+)(\d+)"/g)) {
          const col = [...c[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
          if (Number(c[2]) !== r || col <= lastCol) { orderOk = false; detail = `cell ${c[1]}${c[2]} in row ${r}`; break; }
          lastCol = col;
        }
      }
    }
    rec(S, `${k}: well-formed XML, rows / cells in order`, v === true && orderOk, v === true ? detail : JSON.stringify(v));
  }

  // drawing + photo
  const d1 = text(after.get('xl/drawings/drawing1.xml')!);
  const pics = drawingPictures(d1);
  const rels = parseRels(text(after.get('xl/drawings/_rels/drawing1.xml.rels')!));
  const relOf = (name: string) => rels.find((r) => r.id === pics.find((p) => p.name === name)?.embed)?.target;
  rec(S, 'drawing1 still has the a2b logo, the family logo and the Project Photo', pics.length === 3
    && relOf('Picture 1') === '../media/image1.png' && relOf('Picture 2') === '../media/image2.jpeg' && relOf('Project Photo') === `../media/${basename(report.coverPhoto!.part)}`,
    pics.map((p) => `${p.name} -> ${relOf(p.name)}`).join('; '));
  const newPhoto = after.get(report.coverPhoto!.part)!;
  const ct = text(after.get('[Content_Types].xml')!);
  let jpegOk = false, jpegDetail = '';
  try {
    const img = jpeg.decode(newPhoto, { useTArray: true });
    const aspect = img.width / img.height;
    jpegOk = newPhoto[0] === 0xff && newPhoto[1] === 0xd8 && Math.abs(aspect / report.coverPhoto!.boxAspect - 1) < 0.005
      && /<Default Extension="jpeg" ContentType="image\/jpeg"\/>/.test(ct) && report.coverPhoto!.part.endsWith('.jpeg');
    jpegDetail = `${report.coverPhoto!.part}: ${img.width}x${img.height} JPEG (${(newPhoto.length / 1024).toFixed(0)} KB), aspect ${aspect.toFixed(4)}; box ${report.coverPhoto!.boxAspect.toFixed(4)} from ${report.coverPhoto!.boxDetail}; source ${report.coverPhoto!.srcWidth}x${report.coverPhoto!.srcHeight}`;
  } catch (e) { jpegDetail = String(e); }
  rec(S, 'cover photo part is a valid JPEG at the box aspect ratio, .jpeg content type registered', jpegOk, jpegDetail);
  const orphan = removed.includes('xl/media/image8.png') && ![...after.keys()].some((k) => k.endsWith('.rels') && text(after.get(k)!).includes('image8.png'));
  rec(S, 'old placeholder image8.png removed, no relationship points at it (no orphan / dangling part)', orphan);

  // map audit: every mapped cell of block 1 and of the last block is a writable input and round-trips
  try {
    const full = await fullFillProject(TEMPLATE_MAP, template);
    const r = await exportWorkbookWithReport(template, full);
    const back = await importWorkbookWithReport(r.bytes);
    const d = diff(normalizeProject(full), normalizeProject(back.project));
    rec(S, 'map audit: every mapped input of block 1 and of the last block is writable (no formula / hidden merged cell) and round-trips',
      d.length === 0, `${r.report.cellsWritten} cells written across ${TEMPLATE_MAP.equipment.length} equipment types + ${TEMPLATE_MAP.sections.length} sections; ${d.length} differences ${d.slice(0, 5).join('; ')}`);
  } catch (e) { rec(S, 'map audit (fill every mapped input of block 1 and the last block)', false, String(e)); }

  // stale cached values are stripped when present (template variant with one cached value)
  {
    const z = await JSZip.loadAsync(template);
    const part = sheetsT.find((s) => s.name === 'RTUs')!.part;
    const xml = await readText(z, part);
    z.file(part, xml.replace(/(<c r="K9"[^>]*>)(<f>[^<]*<\/f>)<v><\/v>/, '$1$2<v>999</v>'));
    const variant = await z.generateAsync({ type: 'uint8array' });
    const r = await exportWorkbookWithReport(variant, { templateRevision: '05', sections: {}, equipment: {} });
    const k9 = /<c r="K9"[^>]*>(<f>[^<]*<\/f>)<v>([^<]*)<\/v>/.exec(await readText(await JSZip.loadAsync(r.bytes), part));
    rec(S, 'a stale cached formula value (injected into RTUs!K9) is removed on export', r.report.cachedValuesStripped === 1 && k9?.[2] === '');
  }

  // ================================================================================ c1. round trip (own export)
  const C = 'c round trip';
  const imp = await importWorkbookWithReport(bytes);
  const d1f = diff(normalizeProject(project), normalizeProject(imp.project));
  rec(C, 'importWorkbook(export) deep-equals the input project (all mapped fields)', d1f.length === 0, d1f.slice(0, 10).join('; '));

  // ================================================================================ b. LibreOffice
  const B = 'b LibreOffice';
  let resaved: string | undefined;
  if (!which('soffice')) rec(B, 'LibreOffice available', 'SKIP', 'soffice not on PATH');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'spike-'));
    const tl = Date.now();
    try {
      resaved = soffice(outPath, 'xlsm:Calc MS Excel 2007 VBA XML', tmp);
      const kept = join(OUT, 'LibreOffice re-save.xlsm');
      copyFileSync(resaved, kept); resaved = kept;
      rec(B, 'LibreOffice loads the export, recalculates (forced) and re-saves it as .xlsm', true, `${((Date.now() - tl) / 1000).toFixed(1)} s -> out/${basename(kept)}`);
    } catch (e) { rec(B, 'LibreOffice recalculation', false, String(e)); }
    rmSync(tmp, { recursive: true, force: true });
  }
  if (resaved) {
    const lo = await Book.open(new Uint8Array(readFileSync(resaved)));
    const errs = await lo.errorCells();
    rec(B, 'error cells in the whole recalculated workbook', errs.length === 0, `${errs.length} ${errs.slice(0, 8).join(', ')}`);
    const exps = expectations(project);
    let pass = 0;
    const fails: string[] = [];
    for (const e of exps) {
      const got = await lo.value(e.sheet, e.ref);
      if (close(got, e.expected)) pass++;
      else fails.push(`${e.sheet}!${e.ref} ${e.label}: got ${fmt(got)}, expected ${fmt(e.expected)}`);
    }
    rec(B, 'computed results match independent expectations', fails.length === 0, `${pass}/${exps.length}${fails.length ? ' | ' + fails.join(' | ') : ''}`);
    for (const e of exps.filter((x) => /hood final total|small fan 21|PSP CFM =|corrected FLA|TSP|OA design total|exhaust design total|cover/.test(x.label))) {
      rec(B, `  ${e.sheet}!${e.ref} ${e.label}`, close(await lo.value(e.sheet, e.ref), e.expected) ? 'PASS' : 'FAIL', `= ${fmt(await lo.value(e.sheet, e.ref))}`);
    }
    // sample designations gone, placeholders replaced
    const ede = await Promise.all([65].map((r) => lo.value('{Equipment Data Entry}', `B${r}`)));
    rec(B, 'unused sample designation ERV-1 cleared; placeholders replaced', ede[0] === null
      && (await lo.value('{Project Information}', 'E2')) === project.sections.projectInfo.fields!.projectName, `EDE B65=${fmt(ede[0])}`);

    // ============================================================================ c2. round trip via LibreOffice re-save
    const imp2 = await importWorkbookWithReport(new Uint8Array(readFileSync(resaved)));
    const d2 = diff(normalizeProject(project), normalizeProject(imp2.project));
    const hasSst = (await JSZip.loadAsync(readFileSync(resaved))).file('xl/sharedStrings.xml') !== null;
    rec(C, `import of the LibreOffice re-save (${hasSst ? 'sharedStrings.xml' : 'inline strings'}) equals the input`, d2.length === 0 ? 'PASS' : 'INFO',
      d2.length ? `${d2.length} differences: ${d2.slice(0, 12).join('; ')}` : 'no differences (numbers, dates, text, notations)');
    const loParts = await zipParts(new Uint8Array(readFileSync(resaved)));
    const vba0 = before.get('xl/vbaProject.bin')!, vba1 = loParts.get('xl/vbaProject.bin');
    rec(C, 'note: LibreOffice re-save is NOT a faithful stand-in for Excel', 'INFO',
      `vbaProject.bin ${vba0.length} -> ${vba1?.length ?? 'missing'} bytes, parts ${before.size} -> ${loParts.size}; test only, never ship a LibreOffice-saved file`);
  }

  // ================================================================================ d. safety
  const D = 'd safety';
  const cloneMap = (): TemplateMap => structuredClone(TEMPLATE_MAP) as TemplateMap;
  const tiny = (fields: Record<string, Cell>): ProjectData => ({ templateRevision: '05', sections: {}, equipment: { rtu: [{ slot: 1, fields }] } });
  const expectThrow = async (name: string, cls: new (...a: never[]) => Error, fn: () => Promise<unknown>) => {
    try { await fn(); rec(D, name, false, 'no error thrown'); }
    catch (e) { rec(D, name, e instanceof cls, `${(e as Error).name}: ${(e as Error).message}`); }
  };
  await expectThrow('map entry pointing at a formula cell (RTUs K9, total design) is rejected', FormulaCellError, async () => {
    const m = cloneMap();
    (m.equipment[0].block.fields as { key: string; col: string; row: number; type: string }[]).push({ key: 'badTotal', col: 'K', row: 5, type: 'number' });
    return exportWorkbookWithReport(template, tiny({ badTotal: 1234 }), { map: m });
  });
  await expectThrow('writing into a formula cell via a table row (first return row Design CFM) is rejected', FormulaCellError, async () => {
    const m = cloneMap();
    const t = m.equipment[0].block.tables!.find((x) => x.key === 'return')!;
    (t as unknown as { segments: unknown[] }).segments = [{ row: 42, count: 2 }];
    return exportWorkbookWithReport(template, { templateRevision: '05', sections: {}, equipment: { rtu: [{ slot: 1, tables: { return: [{ designCfm: 5 }] } }] } }, { map: m });
  });
  await expectThrow('map entry pointing inside a merged range (RTUs E10 under D10:G10) is rejected', MapError, async () => {
    const m = cloneMap();
    (m.equipment[0].block.fields as { key: string; col: string; row: number; type: string }[]).push({ key: 'hidden', col: 'E', row: 6, type: 'text' });
    return exportWorkbookWithReport(template, tiny({ hidden: 'x' }), { map: m });
  });
  await expectThrow('value not in the dropdown list (Drive.Type = "Chain") is rejected', ValidationError, async () =>
    exportWorkbookWithReport(template, tiny({ driveType: 'Chain' })));
  await expectThrow('free text in a numeric field ("about 5") is rejected (only N/A notations allowed)', ValidationError, async () =>
    exportWorkbookWithReport(template, tiny({ fla: 'about 5' })));
  await expectThrow('unknown field key is rejected', MapError, async () => exportWorkbookWithReport(template, tiny({ colour: 'red' })));

  // ================================================================================ e. render
  const E = 'e render';
  if (!which('soffice')) rec(E, 'render', 'SKIP', 'soffice not available');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'spike-pdf-'));
    try {
      const pdf = soffice(outPath, 'pdf', tmp);
      const pdfOut = join(OUT, outName.replace(/\.xlsm$/, '.pdf'));
      copyFileSync(pdf, pdfOut);
      if (!which('pdftoppm') || !which('pdftotext')) rec(E, 'PNG pages', 'SKIP', `PDF written to out/${basename(pdfOut)}; install poppler-utils for PNGs`);
      else {
        const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdfOut], { encoding: 'utf8' }))?.[1] ?? 0);
        let rtuPage = 0;
        for (let pg = 1; pg <= pages && !rtuPage; pg++) {
          const t = execFileSync('pdftotext', ['-f', String(pg), '-l', String(pg), '-layout', pdfOut, '-'], { encoding: 'utf8' });
          if (/Static Pressure Profile/.test(t) && /RTU-1/.test(t)) rtuPage = pg;
        }
        const png = (pg: number, name: string) => {
          execFileSync('pdftoppm', ['-f', String(pg), '-l', String(pg), '-r', '110', '-png', '-singlefile', pdfOut, join(OUT, name)]);
          return `out/${name}.png`;
        };
        const cover = png(1, 'cover-page');
        const rtu = rtuPage ? png(rtuPage, 'rtu-1-page') : 'not found';
        rec(E, 'Cover Page and RTU-1 page rendered', !!rtuPage, `${pages}-page PDF out/${basename(pdfOut)}; ${cover}; ${rtu} (PDF page ${rtuPage})`);
      }
    } catch (e) { rec(E, 'render', false, String(e)); }
    rmSync(tmp, { recursive: true, force: true });
  }

  // ================================================================================ report
  const fails = results.filter((r) => r.status === 'FAIL');
  const summary = `${results.filter((r) => r.status === 'PASS').length} PASS, ${fails.length} FAIL, ${results.filter((r) => r.status === 'INFO').length} INFO, ${results.filter((r) => r.status === 'SKIP').length} SKIP (${elapsed()})`;
  console.log(`\n${fails.length ? 'SPIKE FAILED' : 'SPIKE PASSED'}: ${summary}`);
  const md = ['# Export spike report', '', `Template: \`${basename(TEMPLATE)}\` · ${new Date().toISOString()}`, '', `**${fails.length ? 'FAILED' : 'PASSED'}**: ${summary}`, '',
    '| Section | Check | Result | Detail |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.section} | ${r.check.trim()} | ${r.status} | ${r.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)].join('\n');
  writeFileSync(join(OUT, 'spike-report.md'), md + '\n');
  writeFileSync(join(OUT, 'spike-report.json'), JSON.stringify({ summary, exportReport: report, results }, null, 2));
  process.exitCode = fails.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 2; });

/**
 * Minimal OOXML (SpreadsheetML) helpers that work on the raw XML strings of a package loaded with JSZip.
 * No DOM, no Node APIs: the same code runs in the browser.
 */
import JSZip from 'jszip';

// ------------------------------------------------------------------------------------------ refs
export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export function splitRef(ref: string): { col: string; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad cell reference ${ref}`);
  return { col: m[1], row: Number(m[2]) };
}

// ------------------------------------------------------------------------------------------ XML text
// XML 1.0 forbids most control characters; Excel refuses the file if they appear.
// eslint-disable-next-line no-control-regex -- stripping XML-invalid control characters is the point
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
export function xmlEscape(s: string): string {
  return s.replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
export function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e];
  });
}
export function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]) : undefined;
}

// ------------------------------------------------------------------------------------------ package parts
export async function readText(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`package part ${path} not found`);
  return f.async('string');
}
export function relsPathFor(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}
/** Resolve a relationship Target against the part that owns the .rels file. */
export function resolveTarget(basePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = basePart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
export interface Rel { id: string; type: string; target: string; external: boolean; tag: string }
export function parseRels(xml: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*\/?>/g)].map((m) => ({
    id: attr(m[0], 'Id')!,
    type: attr(m[0], 'Type')!,
    target: attr(m[0], 'Target')!,
    external: attr(m[0], 'TargetMode') === 'External',
    tag: m[0],
  }));
}

export interface SheetInfo { name: string; part: string; index: number }
/** Sheet name -> worksheet part, resolved through workbook.xml and its rels (never hard-coded sheetN). */
export async function listSheets(zip: JSZip): Promise<SheetInfo[]> {
  const rootRels = parseRels(await readText(zip, '_rels/.rels'));
  const wbRel = rootRels.find((r) => r.type.endsWith('/officeDocument'));
  const wbPart = wbRel ? resolveTarget('', wbRel.target) : 'xl/workbook.xml';
  const wb = await readText(zip, wbPart);
  const rels = parseRels(await readText(zip, relsPathFor(wbPart)));
  const byId = new Map(rels.map((r) => [r.id, r]));
  return [...wb.matchAll(/<sheet\b[^>]*\/?>/g)].map((m, index) => {
    const rid = attr(m[0], 'r:id')!;
    const rel = byId.get(rid);
    if (!rel) throw new Error(`workbook.xml: sheet ${attr(m[0], 'name')} has no relationship ${rid}`);
    return { name: attr(m[0], 'name')!, part: resolveTarget(wbPart, rel.target), index };
  });
}
export async function workbookPart(zip: JSZip): Promise<string> {
  const rootRels = parseRels(await readText(zip, '_rels/.rels'));
  const wbRel = rootRels.find((r) => r.type.endsWith('/officeDocument'));
  return wbRel ? resolveTarget('', wbRel.target) : 'xl/workbook.xml';
}

export interface DefinedName { name: string; localSheetId?: number; ref: string }
export function parseDefinedNames(workbookXml: string): DefinedName[] {
  return [...workbookXml.matchAll(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g)].map((m) => {
    const lsi = attr(m[0], 'localSheetId');
    return { name: attr(m[0], 'name')!, localSheetId: lsi === undefined ? undefined : Number(lsi), ref: xmlUnescape(m[2]) };
  });
}

// ------------------------------------------------------------------------------------------ cells
export interface RawCell {
  ref: string;
  col: string;
  row: number;
  /** Opening tag attributes. */
  s?: string;
  t?: string;
  formula?: string;
  v?: string;
  inline?: string;
}
const CELL_RE = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const T_RE = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;

export function parseCellTag(attrs: string, body: string | undefined): RawCell {
  const tag = `<c${attrs}>`;
  const ref = attr(tag, 'r');
  if (!ref) throw new Error(`cell without r attribute: ${tag}`);
  const { col, row } = splitRef(ref);
  const cell: RawCell = { ref, col, row, s: attr(tag, 's'), t: attr(tag, 't') };
  if (body) {
    const fm = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
    if (fm) cell.formula = xmlUnescape(fm[1] ?? '');
    const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
    if (vm) cell.v = xmlUnescape(vm[1]);
    const im = /<is>([\s\S]*?)<\/is>/.exec(body);
    if (im) cell.inline = [...im[1].matchAll(T_RE)].map((t) => xmlUnescape(t[1] ?? '')).join('');
  }
  return cell;
}

/** All cells of a worksheet (one regex pass). */
export function parseCells(sheetXml: string): Map<string, RawCell> {
  const out = new Map<string, RawCell>();
  const sd = sheetDataRange(sheetXml);
  const body = sheetXml.slice(sd.innerStart, sd.innerEnd);
  for (const m of body.matchAll(CELL_RE)) {
    const cell = parseCellTag(m[1], m[2]);
    out.set(cell.ref, cell);
  }
  return out;
}

export function sheetDataRange(xml: string): { start: number; innerStart: number; innerEnd: number; end: number; selfClosing: boolean } {
  const open = /<sheetData\b[^>]*?(\/?)>/.exec(xml);
  if (!open) throw new Error('worksheet has no <sheetData>');
  if (open[1] === '/') {
    const e = open.index + open[0].length;
    return { start: open.index, innerStart: e, innerEnd: e, end: e, selfClosing: true };
  }
  const close = xml.indexOf('</sheetData>', open.index);
  return { start: open.index, innerStart: open.index + open[0].length, innerEnd: close, end: close + 12, selfClosing: false };
}

export async function loadSharedStrings(zip: JSZip): Promise<string[]> {
  const wbPart = await workbookPart(zip);
  const rels = parseRels(await readText(zip, relsPathFor(wbPart)));
  const rel = rels.find((r) => r.type.endsWith('/sharedStrings'));
  if (!rel) return [];
  const xml = await readText(zip, resolveTarget(wbPart, rel.target));
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(T_RE)].map((t) => xmlUnescape(t[1] ?? '')).join(''));
}

/** The typed value of a cell: number, string, boolean, or null (blank). Errors come back as "#VALUE!" etc. */
export function cellValue(cell: RawCell | undefined, sst: string[]): number | string | boolean | null {
  if (!cell) return null;
  switch (cell.t) {
    case 'inlineStr': return cell.inline ?? null;
    case 's': return cell.v === undefined || cell.v === '' ? null : sst[Number(cell.v)];
    case 'str': return cell.v === undefined ? null : cell.v;
    case 'b': return cell.v === undefined || cell.v === '' ? null : cell.v === '1';
    case 'e': return cell.v ?? null;
    default:
      if (cell.v === undefined || cell.v === '') return cell.inline ?? null;
      return Number(cell.v);
  }
}

// ------------------------------------------------------------------------------------------ styles
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
/** Set of cellXfs indexes whose number format is a date/time format. */
export function dateStyleIds(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*\/?>/g)) custom.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') ?? '');
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  const out = new Set<number>();
  [...xfs.matchAll(/<xf\b[^>]*?(?:\/>|>)/g)].forEach((m, i) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (BUILTIN_DATE_FMTS.has(id)) out.add(i);
    else if (custom.has(id)) {
      const code = custom.get(id)!.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
      if (/[dmy]/i.test(code)) out.add(i);
    }
  });
  return out;
}

// ------------------------------------------------------------------------------------------ dates
const EPOCH = Date.UTC(1899, 11, 30);
export function isoToSerial(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) throw new Error(`invalid date: ${iso}`);
  return Math.round((t - EPOCH) / 86400000);
}
export function serialToIso(serial: number): string {
  return new Date(EPOCH + Math.round(serial) * 86400000).toISOString().slice(0, 10);
}
export function isoToUs(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'];
/** "2026-12-31" -> "December 31, 2026" (the Certification sheet's expiration line). */
export function isoToLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
/** "December 31, 2026" / "Dec 31 2026" -> "2026-12-31" (null when not such a date). */
export function longToIso(s: string): string | null {
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[1].toLowerCase()) && m[1].length >= 3);
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
export function usToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

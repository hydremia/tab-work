/**
 * A formula calculator for the TAB workbook: evaluates every formula of a filled workbook the way Excel does, so the
 * app can know the printed values without Excel (the exported file carries no calculated values; Excel computes them
 * on open). It implements the functions the templates use (IF, IFERROR, ISTEXT, OR, AND, NOT, INDEX, MATCH, MOD, INT,
 * SUM, SUMPRODUCT, COUNT, AVERAGE, MIN, MAX, N, ROUND, ROUNDUP, SQRT, ABS, PI, TEXT) with Excel's rules:
 *
 *   - a blank cell is 0 in arithmetic, "" in text and comparisons; a formula that returns a blank cell shows 0;
 *   - text in arithmetic is converted when it reads as a number, else #VALUE!; errors propagate;
 *   - comparisons: numbers < text < logicals, text case-insensitive; numbers equal to 15 significant digits, and a
 *     sum or difference that cancels to within that precision is 0 (as Excel and LibreOffice do);
 *   - SUM / COUNT / AVERAGE / MIN / MAX / OR / AND skip text and logicals inside ranges;
 *   - a range used as a single value takes the cell in the formula's own row or column (implicit intersection);
 *     inside SUMPRODUCT ranges are arrays, so --(P7:P86<>"") works.
 *
 * Cells are evaluated in dependency order (no deep recursion over long reference chains). An unknown function
 * gives #NAME? for that cell only. Checked against LibreOffice cell by cell (calc.recalc.test.ts in the app).
 */
import type JSZip from 'jszip';
import { colNumber, parseFormula, refsOf, type Node } from './formula.js';
import { listSheets, loadSharedStrings, numToCol, parseCells, readText, splitRef, type RawCell } from './ooxml.js';

export class XlError {
  constructor(readonly code: string) {}
  toString(): string {
    return this.code;
  }
}
const ERR = {
  value: new XlError('#VALUE!'),
  div0: new XlError('#DIV/0!'),
  na: new XlError('#N/A'),
  ref: new XlError('#REF!'),
  name: new XlError('#NAME?'),
  num: new XlError('#NUM!'),
};
const errOf = (code: string) => Object.values(ERR).find((e) => e.code === code) ?? new XlError(code);

/** A cell value: number, text, logical, blank (null) or an error. */
export type Scalar = number | string | boolean | null | XlError;
interface Range {
  kind: 'range';
  sheet: string;
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}
interface Arr {
  kind: 'array';
  rows: Scalar[][];
}
type Value = Scalar | Range | Arr;

const isErr = (v: unknown): v is XlError => v instanceof XlError;
const isRange = (v: Value): v is Range => typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'range';
const isArr = (v: Value): v is Arr => typeof v === 'object' && v !== null && 'kind' in v && v.kind === 'array';

// ------------------------------------------------------------------------------------------ numbers

/** Equal to 15 significant digits (Excel / LibreOffice compare and cancel at that precision). */
function approxEqual(a: number, b: number): boolean {
  if (a === b) return true;
  if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) return false;
  return Math.abs(a - b) < Math.abs(a) * 2 ** -48;
}
/** a + b, 0 when the two cancel to within the precision (LibreOffice approxAdd). */
function add(a: number, b: number): number {
  if (((a < 0 && b > 0) || (a > 0 && b < 0)) && approxEqual(a, -b)) return 0;
  return a + b;
}
/** x * 10^d without binary drift (1.005 -> 100.5). */
function shift(x: number, d: number): number {
  const [m, e] = x.toExponential().split('e');
  return Number(`${m}e${Number(e) + d}`);
}
/** Excel ROUND: half away from zero, on the value as shown to 15 digits. */
export function roundHalfAway(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x;
  const d = Math.trunc(digits);
  const s = Math.abs(Number(x.toPrecision(15)));
  const r = shift(Math.round(shift(s, d)), -d);
  return x < 0 ? -r : r;
}
function roundUp(x: number, digits: number): number {
  const d = Math.trunc(digits);
  const s = shift(Math.abs(Number(x.toPrecision(15))), d);
  const near = Math.round(s);
  const r = shift(approxEqual(s, near) || s === near ? near : Math.ceil(s), -d);
  return x < 0 ? -r : r;
}

/** A number as Excel's General format writes it in text (up to 15 significant digits). */
export function numberText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) {
    const [m, e] = n.toExponential(14).split('e');
    const mant = m.replace(/\.?0+$/, '');
    const exp = Number(e);
    return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(Number(n.toPrecision(15)));
}

/** TEXT(x, fmt) for the plain numeric formats ("0", "0.00", "#,##0.0"); anything else: General. */
function textFormat(x: Scalar, fmt: string): Scalar {
  if (isErr(x)) return x;
  const n = typeof x === 'number' ? x : x === null ? 0 : typeof x === 'string' ? textToNumber(x) : null;
  if (n === null) return typeof x === 'string' ? x : scalarText(x);
  const m = /^(#,##)?0(?:\.(0+))?$/.exec(fmt.trim());
  if (!m) return numberText(n);
  const dec = m[2]?.length ?? 0;
  const r = roundHalfAway(n, dec);
  let s = Math.abs(r).toFixed(dec);
  if (m[1]) s = s.replace(/^(\d+)/, (w) => w.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  return (r < 0 && Number(s.replace(/,/g, '')) !== 0 ? '-' : '') + s;
}

function textToNumber(s: string): number | null {
  const t = s.trim();
  const m = /^([-+]?)(\d[\d,]*\.?\d*|\.\d+)(?:[eE]([-+]?\d+))?(%?)$/.exec(t);
  if (!m || (m[2].includes(',') && !/^\d{1,3}(,\d{3})*(\.\d*)?$/.test(m[2]))) return null;
  let n = Number(`${m[1]}${m[2].replace(/,/g, '')}${m[3] !== undefined ? `e${m[3]}` : ''}`);
  if (m[4]) n /= 100;
  return Number.isFinite(n) ? n : null;
}

function scalarText(v: Scalar): string {
  if (v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return numberText(v);
  return String(v);
}

// ------------------------------------------------------------------------------------------ workbook

export interface CalcSheet {
  name: string;
  /** Cells by A1 reference: a constant value, or a formula (without "="). */
  cells: Map<string, { value?: Scalar; formula?: string }>;
}

interface CellSlot {
  value: Scalar;
  formula?: string;
  ast?: Node | null;
  state: 0 | 1 | 2; // 0 not evaluated, 1 evaluating, 2 done
  row: number;
  col: number;
  sheet: string;
}

export interface CalcBook {
  /** The value of a cell (a formula's result, or the constant). */
  value(sheet: string, ref: string): Scalar;
  /** Formula cells whose formula the calculator could not parse (left as #NAME?). */
  unsupported: { sheet: string; ref: string; formula: string; error: string }[];
  /** Number of formulas evaluated. */
  formulas: number;
}

const key = (row: number, col: number) => row * 20000 + col;

export function calculate(sheets: readonly CalcSheet[]): CalcBook {
  const book = new Map<string, Map<number, CellSlot>>();
  const maxRow = new Map<string, number>();
  const upper = new Map<string, string>();
  const unsupported: CalcBook['unsupported'] = [];
  for (const s of sheets) {
    const m = new Map<number, CellSlot>();
    let mr = 0;
    for (const [ref, c] of s.cells) {
      const { col, row } = splitRef(ref);
      const cn = colNumber(col);
      mr = Math.max(mr, row);
      m.set(key(row, cn), {
        value: c.formula !== undefined ? null : (c.value ?? null),
        formula: c.formula,
        state: c.formula !== undefined ? 0 : 2,
        row,
        col: cn,
        sheet: s.name,
      });
    }
    book.set(s.name, m);
    maxRow.set(s.name, mr);
    upper.set(s.name.toUpperCase(), s.name);
  }
  const sheetName = (name: string | undefined, current: string) =>
    name === undefined ? current : (upper.get(name.toUpperCase()) ?? null);

  function astOf(slot: CellSlot): Node | null {
    if (slot.ast !== undefined) return slot.ast;
    try {
      slot.ast = parseFormula(slot.formula!);
    } catch (e) {
      slot.ast = null;
      unsupported.push({
        sheet: slot.sheet,
        ref: `${numToCol(slot.col)}${slot.row}`,
        formula: slot.formula!,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return slot.ast;
  }

  /** Formula cells a formula reads (whole columns limited to the sheet's last row). */
  function precedents(slot: CellSlot): CellSlot[] {
    const ast = astOf(slot);
    if (!ast) return [];
    const out: CellSlot[] = [];
    for (const r of refsOf(ast)) {
      const sn = sheetName(r.sheet, slot.sheet);
      if (!sn) continue;
      const cells = book.get(sn)!;
      const r2 = Math.min(r.r2, maxRow.get(sn)!);
      const size = (r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
      if (size > 4096) {
        for (const c of cells.values())
          if (c.state === 0 && c.row >= r.r1 && c.row <= r2 && c.col >= r.c1 && c.col <= r.c2) out.push(c);
        continue;
      }
      for (let row = r.r1; row <= r2; row++)
        for (let col = r.c1; col <= r.c2; col++) {
          const c = cells.get(key(row, col));
          if (c && c.formula !== undefined) out.push(c);
        }
    }
    return out;
  }

  /** Evaluates the formula cells under `start` in dependency order, without recursion. */
  function settle(start: CellSlot) {
    const stack: { slot: CellSlot; deps: CellSlot[] | null; i: number }[] = [{ slot: start, deps: null, i: 0 }];
    start.state = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      top.deps ??= precedents(top.slot);
      if (top.i < top.deps.length) {
        const d = top.deps[top.i++];
        if (d.state === 0) {
          d.state = 1;
          stack.push({ slot: d, deps: null, i: 0 });
        }
        continue; // a cell already evaluating is a circular reference: it reads as 0 (Excel's warning case)
      }
      stack.pop();
      evaluateCell(top.slot);
    }
  }

  function evaluateCell(slot: CellSlot) {
    const ast = astOf(slot);
    let v: Scalar;
    if (!ast) v = ERR.name;
    else {
      const r = evalNode(ast, { sheet: slot.sheet, row: slot.row, col: slot.col, array: false });
      v = toScalar(r, { sheet: slot.sheet, row: slot.row, col: slot.col, array: false });
      if (v === null) v = 0; // =A1 with A1 blank shows 0
    }
    slot.value = v;
    slot.state = 2;
  }

  function cellAt(sheet: string, row: number, col: number): Scalar {
    const c = book.get(sheet)?.get(key(row, col));
    if (!c) return null;
    if (c.state === 0) settle(c);
    return c.state === 2 ? c.value : 0;
  }

  // -------------------------------------------------------------------------------------- evaluation
  interface Ctx {
    sheet: string;
    row: number;
    col: number;
    /** Inside SUMPRODUCT: ranges in operators are arrays. */
    array: boolean;
  }

  function rangeRows(r: Range): Scalar[][] {
    const r2 = Math.min(r.r2, maxRow.get(r.sheet) ?? 0);
    const out: Scalar[][] = [];
    for (let row = r.r1; row <= Math.max(r2, r.r1); row++) {
      const line: Scalar[] = [];
      for (let col = r.c1; col <= r.c2; col++) line.push(row <= r2 ? cellAt(r.sheet, row, col) : null);
      out.push(line);
    }
    return out;
  }
  /** Every value of a range or array, row by row. */
  function* each(v: Range | Arr): Generator<Scalar> {
    if (isArr(v)) {
      for (const line of v.rows) yield* line;
      return;
    }
    const r2 = Math.min(v.r2, maxRow.get(v.sheet) ?? 0);
    for (let row = v.r1; row <= r2; row++) for (let col = v.c1; col <= v.c2; col++) yield cellAt(v.sheet, row, col);
  }

  /** A range as one value: its only cell, or the cell in the formula's row / column. */
  function toScalar(v: Value, ctx: Ctx): Scalar {
    if (isArr(v)) {
      const x = v.rows[0]?.[0];
      return x === undefined ? null : x;
    }
    if (!isRange(v)) return v;
    if (v.r1 === v.r2 && v.c1 === v.c2) return cellAt(v.sheet, v.r1, v.c1);
    if (v.c1 === v.c2 && ctx.row >= v.r1 && ctx.row <= v.r2) return cellAt(v.sheet, ctx.row, v.c1);
    if (v.r1 === v.r2 && ctx.col >= v.c1 && ctx.col <= v.c2) return cellAt(v.sheet, v.r1, ctx.col);
    return ERR.value;
  }

  function toNumber(v: Scalar): number | XlError {
    if (v === null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isErr(v)) return v;
    return textToNumber(v) ?? ERR.value;
  }
  function toBool(v: Scalar): boolean | XlError {
    if (v === null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (isErr(v)) return v;
    const u = v.toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    return ERR.value;
  }

  function compare(a: Scalar, b: Scalar): number {
    // blanks take the other side's type
    if (a === null) a = typeof b === 'number' ? 0 : typeof b === 'boolean' ? false : '';
    if (b === null) b = typeof a === 'number' ? 0 : typeof a === 'boolean' ? false : '';
    const rank = (x: Scalar) => (typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (typeof a === 'number' && typeof b === 'number') return approxEqual(a, b) ? 0 : a < b ? -1 : 1;
    if (typeof a === 'string' && typeof b === 'string') {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x === y ? 0 : x < y ? -1 : 1;
    }
    return Number(a) - Number(b);
  }

  function binaryScalar(op: string, a: Scalar, b: Scalar): Scalar {
    if (isErr(a)) return a;
    if (isErr(b)) return b;
    if (op === '&') return scalarText(a) + scalarText(b);
    if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
      const c = compare(a, b);
      return op === '='
        ? c === 0
        : op === '<>'
          ? c !== 0
          : op === '<'
            ? c < 0
            : op === '>'
              ? c > 0
              : op === '<='
                ? c <= 0
                : c >= 0;
    }
    const x = toNumber(a);
    if (isErr(x)) return x;
    const y = toNumber(b);
    if (isErr(y)) return y;
    switch (op) {
      case '+':
        return add(x, y);
      case '-':
        return add(x, -y);
      case '*':
        return x * y;
      case '/':
        return y === 0 ? ERR.div0 : x / y;
      case '^': {
        if (x === 0 && y === 0) return ERR.num;
        const r = x ** y;
        return Number.isFinite(r) ? r : ERR.num;
      }
    }
    return ERR.value;
  }

  /** An operand as an array (inside SUMPRODUCT) or a single value. */
  function operand(v: Value, ctx: Ctx): Scalar | Arr {
    if (isArr(v)) return v;
    if (isRange(v)) {
      if (ctx.array && !(v.r1 === v.r2 && v.c1 === v.c2)) return { kind: 'array', rows: rangeRows(v) };
      return toScalar(v, ctx);
    }
    return v;
  }
  function broadcast(a: Scalar | Arr, b: Scalar | Arr, f: (x: Scalar, y: Scalar) => Scalar): Scalar | Arr {
    if (!isArr(a) && !isArr(b)) return f(a, b);
    const rows = Math.max(isArr(a) ? a.rows.length : 1, isArr(b) ? b.rows.length : 1);
    const cols = Math.max(isArr(a) ? (a.rows[0]?.length ?? 0) : 1, isArr(b) ? (b.rows[0]?.length ?? 0) : 1);
    const at = (v: Scalar | Arr, r: number, c: number): Scalar => {
      if (!isArr(v)) return v;
      const rr = v.rows.length === 1 ? 0 : r;
      const cc = v.rows[0]?.length === 1 ? 0 : c;
      const x = v.rows[rr]?.[cc];
      return x === undefined ? ERR.na : x;
    };
    const out: Scalar[][] = [];
    for (let r = 0; r < rows; r++) {
      const line: Scalar[] = [];
      for (let c = 0; c < cols; c++) line.push(f(at(a, r, c), at(b, r, c)));
      out.push(line);
    }
    return { kind: 'array', rows: out };
  }

  function evalNode(n: Node, ctx: Ctx): Value {
    switch (n.k) {
      case 'num':
        return n.v;
      case 'str':
        return n.v;
      case 'bool':
        return n.v;
      case 'err':
        return errOf(n.v);
      case 'missing':
        return null;
      case 'ref': {
        const sheet = sheetName(n.sheet, ctx.sheet);
        if (!sheet) return ERR.ref;
        return { kind: 'range', sheet, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 };
      }
      case 'span': {
        // A1:INDEX(…): the box around two references on one sheet
        const l = evalNode(n.l, ctx);
        const r = evalNode(n.r, ctx);
        if (isErr(l)) return l;
        if (isErr(r)) return r;
        if (!isRange(l) || !isRange(r) || l.sheet !== r.sheet) return ERR.value;
        return {
          kind: 'range',
          sheet: l.sheet,
          r1: Math.min(l.r1, r.r1),
          c1: Math.min(l.c1, r.c1),
          r2: Math.max(l.r2, r.r2),
          c2: Math.max(l.c2, r.c2),
        };
      }
      case 'neg':
        return broadcast(operand(evalNode(n.e, ctx), ctx), 0, (x) => {
          const v = toNumber(x);
          return isErr(v) ? v : -v;
        });
      case 'pct':
        return broadcast(operand(evalNode(n.e, ctx), ctx), 0, (x) => {
          const v = toNumber(x);
          return isErr(v) ? v : v / 100;
        });
      case 'bin':
        return broadcast(operand(evalNode(n.l, ctx), ctx), operand(evalNode(n.r, ctx), ctx), (x, y) =>
          binaryScalar(n.op, x, y),
        );
      case 'call':
        return call(n.name, n.args, ctx);
    }
  }

  const scalarArg = (n: Node | undefined, ctx: Ctx): Scalar =>
    n === undefined ? null : toScalar(evalNode(n, ctx), ctx);
  const numArg = (n: Node | undefined, ctx: Ctx): number | XlError => toNumber(scalarArg(n, ctx));

  /** The numbers of the arguments: typed values coerced, numbers only from ranges (SUM, COUNT …). */
  function numbers(args: Node[], ctx: Ctx, countText = false): number[] | XlError {
    const out: number[] = [];
    for (const a of args) {
      if (a.k === 'missing') continue;
      const v = evalNode(a, ctx);
      if (isRange(v) || isArr(v)) {
        for (const x of each(v)) {
          if (isErr(x)) return x;
          if (typeof x === 'number') out.push(x);
        }
        continue;
      }
      if (isErr(v)) return v;
      if (v === null) continue;
      if (typeof v === 'string') {
        const n = textToNumber(v);
        if (n === null) {
          if (countText) continue;
          return ERR.value;
        }
        out.push(n);
      } else out.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    return out;
  }
  function logicals(args: Node[], ctx: Ctx): boolean[] | XlError {
    const out: boolean[] = [];
    for (const a of args) {
      const v = evalNode(a, ctx);
      if (isRange(v) || isArr(v)) {
        for (const x of each(v)) {
          if (isErr(x)) return x;
          if (typeof x === 'number') out.push(x !== 0);
          else if (typeof x === 'boolean') out.push(x);
        }
        continue;
      }
      const b = toBool(v);
      if (isErr(b)) return b;
      out.push(b);
    }
    return out.length ? out : ERR.value;
  }

  function call(name: string, args: Node[], ctx: Ctx): Value {
    switch (name) {
      case 'IF': {
        const c = toBool(scalarArg(args[0], ctx));
        if (isErr(c)) return c;
        const pick = c ? args[1] : args[2];
        if (pick === undefined) return c ? 0 : false;
        if (pick.k === 'missing') return 0;
        return evalNode(pick, ctx);
      }
      case 'IFERROR': {
        const v = toScalar(evalNode(args[0], ctx), ctx);
        if (isErr(v)) return args[1] === undefined || args[1].k === 'missing' ? 0 : evalNode(args[1], ctx);
        return v;
      }
      case 'ISTEXT':
        return typeof scalarArg(args[0], ctx) === 'string';
      case 'NOT': {
        const b = toBool(scalarArg(args[0], ctx));
        return isErr(b) ? b : !b;
      }
      case 'OR':
      case 'AND': {
        const l = logicals(args, ctx);
        if (isErr(l)) return l;
        return name === 'OR' ? l.some(Boolean) : l.every(Boolean);
      }
      case 'N': {
        const v = scalarArg(args[0], ctx);
        if (isErr(v)) return v;
        return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0;
      }
      case 'INDEX': {
        const v = evalNode(args[0], ctx);
        const r = numArg(args[1], ctx);
        if (isErr(r)) return r;
        const hasCol = args[2] !== undefined && args[2].k !== 'missing';
        const c = hasCol ? numArg(args[2], ctx) : 1;
        if (isErr(c)) return c;
        let row = Math.trunc(r);
        let col = Math.trunc(c);
        if (isRange(v)) {
          const height = v.r2 - v.r1 + 1;
          const width = v.c2 - v.c1 + 1;
          if (!hasCol && height === 1 && width > 1) [row, col] = [1, row];
          if (row < 1 || col < 1 || row > height || col > width) return ERR.ref;
          return {
            kind: 'range',
            sheet: v.sheet,
            r1: v.r1 + row - 1,
            c1: v.c1 + col - 1,
            r2: v.r1 + row - 1,
            c2: v.c1 + col - 1,
          };
        }
        if (isArr(v)) {
          const x = v.rows[row - 1]?.[col - 1];
          return x === undefined ? ERR.ref : x;
        }
        return row <= 1 && col <= 1 ? v : ERR.ref;
      }
      case 'MATCH': {
        const look = scalarArg(args[0], ctx);
        if (isErr(look)) return look;
        const v = evalNode(args[1], ctx);
        const t = args[2] === undefined || args[2].k === 'missing' ? 1 : numArg(args[2], ctx);
        if (isErr(t)) return t;
        const list: Scalar[] = isRange(v) || isArr(v) ? [...each(v)] : [v];
        if (look === null) return ERR.na;
        if (t === 0) {
          const i = list.findIndex(
            (x) => x !== null && !isErr(x) && compare(x, look) === 0 && typeof x === typeof look,
          );
          return i < 0 ? ERR.na : i + 1;
        }
        let found = -1;
        for (let i = 0; i < list.length; i++) {
          const x = list[i];
          if (x === null || isErr(x) || typeof x !== typeof look) continue;
          const c = compare(x, look);
          if (t > 0 ? c <= 0 : c >= 0) found = i;
          else break;
        }
        return found < 0 ? ERR.na : found + 1;
      }
      case 'MOD': {
        const a = numArg(args[0], ctx);
        if (isErr(a)) return a;
        const d = numArg(args[1], ctx);
        if (isErr(d)) return d;
        if (d === 0) return ERR.div0;
        const r = a - d * Math.floor(a / d);
        return approxEqual(r, d) ? 0 : r;
      }
      case 'INT': {
        const a = numArg(args[0], ctx);
        if (isErr(a)) return a;
        const near = Math.round(a);
        return approxEqual(a, near) ? near : Math.floor(a);
      }
      case 'ABS': {
        const a = numArg(args[0], ctx);
        return isErr(a) ? a : Math.abs(a);
      }
      case 'SQRT': {
        const a = numArg(args[0], ctx);
        if (isErr(a)) return a;
        return a < 0 ? ERR.num : Math.sqrt(a);
      }
      case 'PI':
        return Math.PI;
      case 'ROUND':
      case 'ROUNDUP': {
        const a = numArg(args[0], ctx);
        if (isErr(a)) return a;
        const d = args[1] === undefined ? 0 : numArg(args[1], ctx);
        if (isErr(d)) return d;
        return name === 'ROUND' ? roundHalfAway(a, d) : roundUp(a, d);
      }
      case 'SUM': {
        const xs = numbers(args, ctx);
        return isErr(xs) ? xs : xs.reduce((t, x) => add(t, x), 0);
      }
      case 'COUNT': {
        let n = 0;
        for (const a of args) {
          if (a.k === 'missing') continue;
          const v = evalNode(a, ctx);
          if (isRange(v) || isArr(v)) {
            for (const x of each(v)) if (typeof x === 'number') n++;
          } else if (typeof v === 'number' || typeof v === 'boolean') n++;
          else if (typeof v === 'string' && textToNumber(v) !== null) n++;
        }
        return n;
      }
      case 'AVERAGE': {
        const xs = numbers(args, ctx);
        if (isErr(xs)) return xs;
        return xs.length ? xs.reduce((t, x) => add(t, x), 0) / xs.length : ERR.div0;
      }
      case 'MIN':
      case 'MAX': {
        const xs = numbers(args, ctx);
        if (isErr(xs)) return xs;
        return xs.length ? (name === 'MIN' ? Math.min(...xs) : Math.max(...xs)) : 0;
      }
      case 'SUMPRODUCT': {
        const arrs: Scalar[][][] = [];
        for (const a of args) {
          const v = evalNode(a, { ...ctx, array: true });
          arrs.push(isRange(v) ? rangeRows(v) : isArr(v) ? v.rows : [[v]]);
        }
        if (!arrs.length) return ERR.value;
        const h = arrs[0].length;
        const w = arrs[0][0]?.length ?? 0;
        if (arrs.some((m) => m.length !== h || (m[0]?.length ?? 0) !== w)) return ERR.value;
        let total = 0;
        for (let r = 0; r < h; r++)
          for (let c = 0; c < w; c++) {
            let p = 1;
            for (const m of arrs) {
              const x = m[r][c];
              if (isErr(x)) return x;
              p *= typeof x === 'number' ? x : 0;
            }
            total = add(total, p);
          }
        return total;
      }
      case 'TEXT':
        return textFormat(scalarArg(args[0], ctx), scalarText(scalarArg(args[1], ctx)));
    }
    return ERR.name;
  }

  // every formula, in dependency order
  let formulas = 0;
  for (const cells of book.values())
    for (const c of cells.values())
      if (c.formula !== undefined) {
        formulas++;
        if (c.state === 0) settle(c);
      }

  return {
    value(sheet, ref) {
      const { col, row } = splitRef(ref);
      const sn = sheetName(sheet, sheet);
      return sn ? (book.get(sn)?.get(key(row, colNumber(col)))?.value ?? null) : null;
    },
    unsupported,
    formulas,
  };
}

/** The sheets of a workbook file, ready for `calculate` (constants typed; formulas without their cached values). */
export async function readCalcSheets(zip: JSZip): Promise<CalcSheet[]> {
  const sst = await loadSharedStrings(zip);
  const out: CalcSheet[] = [];
  for (const s of await listSheets(zip)) {
    const cells = new Map<string, { value?: Scalar; formula?: string }>();
    for (const [ref, c] of parseCells(await readText(zip, s.part))) {
      if (c.formula !== undefined && c.formula !== '') cells.set(ref, { formula: c.formula });
      else {
        const v = constant(c, sst);
        if (v !== null) cells.set(ref, { value: v });
      }
    }
    out.push({ name: s.name, cells });
  }
  return out;
}

function constant(c: RawCell, sst: string[]): Scalar {
  switch (c.t) {
    case 'inlineStr':
      return c.inline ?? null;
    case 's':
      return c.v === undefined || c.v === '' ? null : (sst[Number(c.v)] ?? null);
    case 'str':
      return c.v ?? null;
    case 'b':
      return c.v === undefined || c.v === '' ? null : c.v === '1';
    case 'e':
      return c.v ? errOf(c.v) : null;
    default:
      if (c.v === undefined || c.v === '') return c.inline ?? null;
      return Number(c.v);
  }
}

/** Calculates a workbook file: every formula evaluated from its typed values. */
export async function calculateWorkbook(zip: JSZip): Promise<CalcBook> {
  return calculate(await readCalcSheets(zip));
}

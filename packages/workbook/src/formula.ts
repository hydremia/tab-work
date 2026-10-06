/**
 * Excel formula parser for the template's formulas (calc.ts evaluates them). It covers what the a2b templates use:
 * numbers, strings ("" escapes), TRUE / FALSE, error literals, cell / range / whole-column references with an
 * optional sheet ('{Dropdowns}'!$J:$J, Fans!C5), function calls with empty arguments (IF(A1,,"x")), unary + / -,
 * postfix %, and ^ * / + - & = <> < > <= >= with Excel's precedence (negation binds tighter than ^, ^ is
 * left-associative). Whitespace between tokens is ignored (no intersection operator).
 */

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'err'; v: string }
  | { k: 'missing' }
  /** A cell or a range: rows / columns 1-based; a whole column has r1 = 1, r2 = Infinity. */
  | { k: 'ref'; sheet?: string; r1: number; c1: number; r2: number; c2: number; cell: boolean }
  | { k: 'neg'; e: Node }
  | { k: 'pct'; e: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }
  /** The range operator between two reference expressions (D11:INDEX(M11:M18,N10)). */
  | { k: 'span'; l: Node; r: Node }
  | { k: 'call'; name: string; args: Node[] };

export function colNumber(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'err'; v: string }
  | { t: 'ref'; node: Extract<Node, { k: 'ref' }> }
  | { t: 'fn'; v: string }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string };

const SHEET = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!`;
const CELL = String.raw`\$?([A-Z]{1,3})\$?(\d+)`;
const COLS = String.raw`\$?([A-Z]{1,3}):\$?([A-Z]{1,3})(?![0-9A-Za-z(])`;
const REF_RE = new RegExp(`^(?:${SHEET})?(?:${CELL}(?::${CELL})?|${COLS})`);
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ERRORS = ['#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#REF!', '#VALUE!'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      for (;;) {
        if (j >= src.length) throw new Error(`unterminated string in ${src}`);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (ch === '#') {
      const e = ERRORS.find((x) => rest.toUpperCase().startsWith(x));
      if (!e) throw new Error(`unknown error literal in ${src}`);
      out.push({ t: 'err', v: e });
      i += e.length;
      continue;
    }
    const ref = REF_RE.exec(rest);
    if (ref && (ref[3] || ref[7])) {
      const sheet = ref[1] !== undefined ? ref[1].replace(/''/g, "'") : ref[2];
      let node: Extract<Node, { k: 'ref' }>;
      if (ref[3]) {
        const c1 = colNumber(ref[3]);
        const r1 = Number(ref[4]);
        const c2 = ref[5] ? colNumber(ref[5]) : c1;
        const r2 = ref[6] ? Number(ref[6]) : r1;
        node = {
          k: 'ref',
          sheet,
          r1: Math.min(r1, r2),
          c1: Math.min(c1, c2),
          r2: Math.max(r1, r2),
          c2: Math.max(c1, c2),
          cell: !ref[5],
        };
      } else {
        const c1 = colNumber(ref[7]);
        const c2 = colNumber(ref[8]);
        node = { k: 'ref', sheet, r1: 1, c1: Math.min(c1, c2), r2: Infinity, c2: Math.max(c1, c2), cell: false };
      }
      // a function name that looks like a cell (LOG10() …) is not a reference
      if (src[i + ref[0].length] !== '(') {
        out.push({ t: 'ref', node });
        i += ref[0].length;
        continue;
      }
    }
    const num = NUM_RE.exec(rest);
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (word) {
      const after = src.slice(i + word[0].length).trimStart();
      if (after.startsWith('(')) out.push({ t: 'fn', v: word[0].toUpperCase().replace(/^_XLFN\./, '') });
      else out.push({ t: 'name', v: word[0] });
      i += word[0].length;
      continue;
    }
    const op = ['<>', '<=', '>='].find((o) => rest.startsWith(o)) ?? ch;
    if (!'+-*/^&=<>%(),:'.includes(op[0])) throw new Error(`unexpected "${ch}" in ${src}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

const COMPARE = new Set(['=', '<>', '<', '>', '<=', '>=']);

/** Parses one formula (without the leading "="). Throws on syntax the templates do not use. */
export function parseFormula(src: string): Node {
  const toks = tokenize(src.startsWith('=') ? src.slice(1) : src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => {
    const t = toks[p];
    return t !== undefined && t.t === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}" in ${src}`);
    p++;
  };

  function binary(next: () => Node, ops: (v: string) => boolean): Node {
    let l = next();
    for (;;) {
      const t = peek();
      if (!t || t.t !== 'op' || !ops(t.v)) return l;
      p++;
      l = { k: 'bin', op: t.v, l, r: next() };
    }
  }
  const compare = (): Node => binary(concat, (v) => COMPARE.has(v));
  const concat = (): Node => binary(additive, (v) => v === '&');
  const additive = (): Node => binary(mult, (v) => v === '+' || v === '-');
  const mult = (): Node => binary(power, (v) => v === '*' || v === '/');
  const power = (): Node => binary(unary, (v) => v === '^');
  function unary(): Node {
    if (isOp('-')) {
      p++;
      return { k: 'neg', e: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    let e = span();
    while (isOp('%')) {
      p++;
      e = { k: 'pct', e };
    }
    return e;
  }
  /** The range operator binds tighter than anything else (a literal A1:B2 is one token already). */
  function span(): Node {
    let l = primary();
    while (isOp(':')) {
      p++;
      l = { k: 'span', l, r: primary() };
    }
    return l;
  }
  function primary(): Node {
    const t = toks[p++];
    if (!t) throw new Error(`unexpected end of ${src}`);
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return { k: 'str', v: t.v };
      case 'err':
        return { k: 'err', v: t.v };
      case 'ref':
        return t.node;
      case 'name': {
        const u = t.v.toUpperCase();
        if (u === 'TRUE' || u === 'FALSE') return { k: 'bool', v: u === 'TRUE' };
        throw new Error(`defined names are not supported (${t.v}) in ${src}`);
      }
      case 'fn': {
        expect('(');
        const args: Node[] = [];
        if (isOp(')')) {
          p++;
          return { k: 'call', name: t.v, args };
        }
        for (;;) {
          args.push(isOp(',') || isOp(')') ? { k: 'missing' } : compare());
          if (isOp(',')) {
            p++;
            continue;
          }
          expect(')');
          return { k: 'call', name: t.v, args };
        }
      }
      case 'op':
        if (t.v === '(') {
          const e = compare();
          expect(')');
          return e;
        }
    }
    throw new Error(`unexpected token in ${src}`);
  }
  const node = compare();
  if (p < toks.length) throw new Error(`unexpected trailing tokens in ${src}`);
  return node;
}

/** Every reference in a formula (for the dependency order). */
export function refsOf(node: Node, out: Extract<Node, { k: 'ref' }>[] = []): Extract<Node, { k: 'ref' }>[] {
  switch (node.k) {
    case 'ref':
      out.push(node);
      break;
    case 'neg':
    case 'pct':
      refsOf(node.e, out);
      break;
    case 'bin':
      refsOf(node.l, out);
      refsOf(node.r, out);
      break;
    case 'span': {
      // the cells between the two ends count too (the box is only known when evaluated): the box of every
      // reference on either side, per sheet
      const inner = [...refsOf(node.l), ...refsOf(node.r)];
      out.push(...inner);
      for (const sheet of new Set(inner.map((r) => r.sheet))) {
        const same = inner.filter((r) => r.sheet === sheet);
        out.push({
          k: 'ref',
          sheet,
          r1: Math.min(...same.map((r) => r.r1)),
          c1: Math.min(...same.map((r) => r.c1)),
          r2: Math.max(...same.map((r) => r.r2)),
          c2: Math.max(...same.map((r) => r.c2)),
          cell: false,
        });
      }
      break;
    }
    case 'call':
      for (const a of node.args) refsOf(a, out);
      break;
  }
  return out;
}

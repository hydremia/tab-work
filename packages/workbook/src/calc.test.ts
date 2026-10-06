import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { calculate, numberText, readCalcSheets, roundHalfAway, XlError, type Scalar } from './calc.js';
import { parseFormula } from './formula.js';

/** One sheet "S" with the given constants and formulas; returns a reader of S's values. */
function sheet(cells: Record<string, Scalar | `=${string}`>) {
  const m = new Map<string, { value?: Scalar; formula?: string }>();
  for (const [ref, v] of Object.entries(cells))
    m.set(ref, typeof v === 'string' && v.startsWith('=') ? { formula: v.slice(1) } : { value: v });
  const book = calculate([
    { name: 'S', cells: m },
    { name: '{Other}', cells: new Map([['A1', { value: 'x' }]]) },
  ]);
  return (ref: string) => {
    const v = book.value('S', ref);
    return v instanceof XlError ? v.code : v;
  };
}

describe('formula parser', () => {
  it('references, sheets, whole columns, escaped quotes, empty arguments, precedence', () => {
    expect(parseFormula("INDEX('{Dropdowns}'!$J:$J,MATCH(A1&\"|\"&B2,'{Dropdowns}'!$H:$H,0))")).toMatchObject({
      k: 'call',
      args: [
        { k: 'ref', sheet: '{Dropdowns}', c1: 10, r1: 1, r2: Infinity },
        { k: 'call', name: 'MATCH' },
      ],
    });
    expect(parseFormula('A1&""" x "&B1')).toMatchObject({ k: 'bin', op: '&', l: { k: 'bin', r: { v: '" x ' } } });
    expect(parseFormula('IF(A1,,"x")')).toMatchObject({ args: [{ k: 'ref' }, { k: 'missing' }, { k: 'str' }] });
    // negation binds tighter than ^; * before +; & after +; comparison last
    expect(parseFormula('-2^2')).toMatchObject({ k: 'bin', op: '^', l: { k: 'neg' } });
    expect(parseFormula('1+2*3&4=5')).toMatchObject({ k: 'bin', op: '=', l: { k: 'bin', op: '&' } });
    expect(parseFormula('D11:INDEX(M11:M18,2)')).toMatchObject({ k: 'span' });
  });
});

describe('formula calculator (Excel semantics)', () => {
  it('blank cells: 0 in arithmetic, "" in comparisons; a formula pointing at a blank shows 0', () => {
    const v = sheet({ A2: '=A1+1', A3: '=A1=""', A4: '=A1=0', A5: '=A1', A6: '=A1&"x"', A7: '=ISTEXT(A1)' });
    expect([v('A2'), v('A3'), v('A4'), v('A5'), v('A6'), v('A7')]).toEqual([1, true, true, 0, 'x', false]);
  });

  it('text: numbers in text convert in arithmetic, other text is #VALUE!; "" is text', () => {
    const v = sheet({ A1: '12', B1: 'N/A', C1: '=""', A2: '=A1*2', B2: '=B1*2', C2: '=ISTEXT(C1)', D2: '=C1*1' });
    expect([v('A2'), v('B2'), v('C2'), v('D2')]).toEqual([24, '#VALUE!', true, '#VALUE!']);
  });

  it('comparisons: case-insensitive text, numbers < text < logicals, 15-digit equality and cancellation', () => {
    const v = sheet({
      A1: '="Round"="ROUND"',
      A2: '=5<"a"',
      A3: '="z"<TRUE',
      A4: '=0.1+0.2=0.3',
      A5: '=0.1+0.2-0.3',
      A6: '=IF(1.1-1.2+0.1=0,"zero","not")',
    });
    expect([v('A1'), v('A2'), v('A3'), v('A4'), v('A5'), v('A6')]).toEqual([true, true, true, true, 0, 'zero']);
  });

  it('IF / IFERROR / OR / AND / NOT, errors propagate', () => {
    const v = sheet({
      B1: 3,
      B2: 'text',
      A1: '=IF(B1>2,"big")',
      A2: '=IF(B1>5,"big")',
      A3: '=IFERROR(1/0,"div")',
      A4: '=OR(B1:B2>2)',
      A5: '=OR(B1:B2)',
      A6: '=AND(B1=3,NOT(B1=4))',
      A7: '=1/0+1',
      A8: '=OR("x")',
    });
    expect([v('A1'), v('A2'), v('A3'), v('A5'), v('A6'), v('A7'), v('A8')]).toEqual([
      'big',
      false,
      'div',
      true,
      true,
      '#DIV/0!',
      '#VALUE!',
    ]);
  });

  it('SUM / COUNT / AVERAGE / MIN / MAX skip text and blanks in ranges; AVERAGE of nothing is #DIV/0!', () => {
    const v = sheet({
      B1: 2,
      B2: 'N/A',
      B4: 4,
      A1: '=SUM(B1:B4)',
      A2: '=COUNT(B1:B4)',
      A3: '=AVERAGE(B1:B4)',
      A4: '=AVERAGE(C1:C3)',
      A5: '=MIN(B1:B4)+MAX(B1:B4)',
      A6: '=MAX(C1:C3)',
      A7: '=SUM("3",TRUE)',
    });
    expect([v('A1'), v('A2'), v('A3'), v('A4'), v('A5'), v('A6'), v('A7')]).toEqual([6, 2, 3, '#DIV/0!', 6, 0, 4]);
  });

  it('INDEX / MATCH (exact, case-insensitive; approximate), whole columns on another sheet', () => {
    const v = sheet({
      D1: 'RTU',
      D2: 'MAU',
      D3: 'ERV',
      E1: 1,
      E2: 2,
      E3: 3,
      F1: 10,
      F2: 20,
      F3: 30,
      A1: '=INDEX(E1:E3,MATCH("mau",D1:D3,0))',
      A2: '=MATCH(25,F1:F3,1)',
      A3: '=IFERROR(INDEX($E:$E,MATCH("VAV",$D:$D,0)),"none")',
      A4: '=INDEX(D1:F3,3,2)',
      A5: "=INDEX('{Other}'!A:A,1)",
      A6: '=INDEX(E1:E3,5)',
    });
    expect([v('A1'), v('A2'), v('A3'), v('A4'), v('A5'), v('A6')]).toEqual([2, 2, 'none', 3, 'x', '#REF!']);
  });

  it('SUMPRODUCT with --(range<>""), the Building Balance exclusion total', () => {
    const v = sheet({
      C1: 100,
      C2: 200,
      C3: 300,
      P2: 'Excl.',
      A1: '=SUM(C1:C3)-SUMPRODUCT(--(P1:P3<>""),C1:C3)',
      A2: '=SUMPRODUCT(C1:C3,C1:C3)',
      A3: '=SUMPRODUCT(C1:C3,C1:C2)',
    });
    expect([v('A1'), v('A2'), v('A3')]).toEqual([400, 140000, '#VALUE!']);
  });

  it('ROUND half away from zero (decimal-exact), ROUNDUP, INT, MOD, SQRT, N, TEXT, PI, ^', () => {
    const v = sheet({
      B1: 'N/A',
      A1: '=ROUND(2.5,0)',
      A2: '=ROUND(-2.5,0)',
      A3: '=ROUND(1.005,2)',
      A4: '=ROUNDUP((30-12)/6,0)',
      A5: '=ROUNDUP(2.01,0)',
      A6: '=INT(-2.5)',
      A7: '=MOD(-7,3)',
      A8: '=SQRT(-1)',
      A9: '=N(B1)+N(5)',
      A10: '=TEXT(1.005-0.5,"0.00")',
      A11: '="Δ "&TEXT(-0.004,"0.00")',
      A12: '=ROUND(PI()*(12/2)^2/144,3)',
      A13: '=MOD(7,0)',
    });
    expect([v('A1'), v('A2'), v('A3'), v('A4'), v('A5'), v('A6'), v('A7'), v('A8'), v('A9')]).toEqual([
      3,
      -3,
      1.01,
      3,
      3,
      -3,
      2,
      '#NUM!',
      5,
    ]);
    expect([v('A10'), v('A11'), v('A12'), v('A13')]).toEqual(['0.51', 'Δ 0.00', 0.785, '#DIV/0!']);
  });

  it('the range operator between computed ends; implicit intersection of a range used as one value', () => {
    const v = sheet({
      D1: 1,
      E1: 2,
      F1: 3,
      G1: 4,
      N1: 3,
      A1: '=AVERAGE(D1:INDEX(D1:G1,N1))',
      B3: 7,
      B4: 8,
      A4: '=B3:B5*2',
      A9: '=B3:B5*2',
    });
    expect([v('A1'), v('A4'), v('A9')]).toEqual([2, 16, '#VALUE!']);
  });

  it('long reference chains are evaluated in order, without deep recursion', () => {
    const cells: Record<string, Scalar | `=${string}`> = { A1: 1 };
    for (let r = 2; r <= 20000; r++) cells[`A${r}`] = `=A${r - 1}+1`;
    expect(sheet(cells)('A20000')).toBe(20000);
  });

  it('numbers as text (General), and ROUND on binary edge cases', () => {
    expect([numberText(3), numberText(0.1 + 0.2), numberText(1 / 3), numberText(1e20), numberText(-0.5)]).toEqual([
      '3',
      '0.3',
      '0.333333333333333',
      '1E+20',
      '-0.5',
    ]);
    expect([roundHalfAway(2.675, 2), roundHalfAway(1e-7, 3), roundHalfAway(-1.005, 2)]).toEqual([2.68, 0, -1.01]);
  });
});

describe('every template formula is understood', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const templates = readdirSync(root).filter((f) => /^(0[5-9]|H\d\d) - .*\.xlsm$/.test(f));
  it.each(templates)(
    '%s: every formula parses and evaluates',
    async (name) => {
      const zip = await JSZip.loadAsync(readFileSync(`${root}${name}`));
      const book = calculate(await readCalcSheets(zip));
      expect(book.unsupported).toEqual([]);
      expect(book.formulas).toBeGreaterThan(100);
    },
    60_000,
  );
});

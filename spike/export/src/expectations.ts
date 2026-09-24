/**
 * Expected results of the workbook formulas for a project, computed independently in TypeScript from the
 * project data and the NEBB / Evergreen formulas (never read from the workbook). Constants that live in
 * the template's {Dropdowns} sheet are restated here from the Evergreen worksheet (and the rev 04 test).
 */
import { anchorRow, isoToSerial, TEMPLATE_MAP } from '@a2b/workbook';
import type { Cell, ProjectData } from '@a2b/workbook';

const Q = 52; // continuation page offset

export type Expected = number | string | null;
export interface Expectation { sheet: string; ref: string; expected: Expected; label: string }

const num = (v: Cell | undefined): number | null => (typeof v === 'number' ? v : null);
const sum = (xs: (number | null)[]) => { const n = xs.filter((x): x is number => x !== null); return n.length ? n.reduce((a, b) => a + b, 0) : null; };
const avg = (xs: (number | null)[]) => { const n = xs.filter((x): x is number => x !== null); return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null; };
const mul = (a: number | null, b: number | null) => (a === null || b === null ? null : a * b);
const ratio = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const round = (x: number | null, d = 0) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Evergreen constants (tb-worksheet-evergreen): PSP K by width, Captrate 16x20 free area and K. */
const PSP_K: Record<number, number> = { 12: 0.88 };
const HOOD_FILTER: Record<string, { area: number; k: number }> = { 'Captrate (VelGrid)|16" x 20"': { area: 1.73, k: 1.34 } };

export function expectations(p: ProjectData): Expectation[] {
  const out: Expectation[] = [];
  const add = (sheet: string, ref: string, expected: Expected, label: string) => out.push({ sheet, ref, expected, label });
  const anchor = (key: string, slot: number) => anchorRow(TEMPLATE_MAP.equipment.find((e) => e.key === key)!.block.anchor, slot);
  const units = (key: string) => p.equipment[key] ?? [];
  const pi = p.sections.projectInfo?.fields ?? {};

  // ---- cover page and page headers
  add('Cover Page', 'G32', pi.projectName as string, 'cover PROJECT NAME');
  add('Cover Page', 'G34', pi.address as string, 'cover PROJECT ADDRESS');
  add('Cover Page', 'G36', isoToSerial(pi.reportDate as string), 'cover REPORT DATE (date serial)');
  add('Cover Page', 'G38', pi.mechanicalContractor as string, 'cover mechanical contractor line');
  add('RTUs', 'D2', pi.projectName as string, 'RTUs page header project');

  // ---- outlet table helper
  const outletTotals = (rows: Record<string, Cell>[] = []) => ({
    design: sum(rows.map((r) => num(r.designCfm))),
    final: sum(rows.map((r) => mul(num(r.finalVel), num(r.ak)))),
    initial: sum(rows.map((r) => mul(num(r.initialVel), num(r.ak)))),
  });

  // ---- RTUs
  const oaDesign: Record<string, number | null> = {}, oaFinal: Record<string, number | null> = {};
  for (const u of units('rtu')) {
    const P = anchor('rtu', u.slot), f = u.fields ?? {}, s = u.schedule ?? {};
    const name = `${s.designation}`;
    const sup = outletTotals(u.tables?.supply);
    const oa = u.tables?.oa?.[0];
    const oaD = oa ? num(oa.designCfm) : null;
    const oaF = oa ? mul(num(oa.finalVel), num(oa.ak)) : null;
    oaDesign[name] = oaD && oaD !== 0 ? oaD : null; oaFinal[name] = oaF;
    add('RTUs', `D${P}`, s.designation as string, `${name} system name from data entry`);
    add('RTUs', `K${P + 5}`, sup.design, `${name} total design CFM (sum of outlet design)`);
    add('RTUs', `L${P + 5}`, sup.final, `${name} total final CFM (sum VEL x Ak)`);
    add('RTUs', `M${P + 5}`, ratio(sup.final, sup.design), `${name} % of design`);
    add('RTUs', `K${P + 6}`, oaDesign[name], `${name} OA design`);
    add('RTUs', `L${P + 6}`, oaF, `${name} OA final`);
    if (sup.design !== null) add('RTUs', `K${P + 7}`, sup.design - (oaD ?? 0), `${name} return design = total - OA`);
    // first page outlet rows
    (u.tables?.supply ?? []).slice(0, 10).forEach((r, i) => {
      const row = P + 29 + i;
      const fin = mul(num(r.finalVel), num(r.ak));
      add('RTUs', `L${row}`, fin, `${name} ${r.no} final CFM`);
      const h = num(r.designCfm);
      add('RTUs', `M${row}`, h ? ratio(fin ?? mul(num(r.initialVel), num(r.ak)), h) : null, `${name} ${r.no} %`);
    });
    (u.tables?.supply ?? []).slice(10).forEach((r, i) => add('RTUs', `L${P + 56 + i}`, mul(num(r.finalVel), num(r.ak)), `${name} ${r.no} final CFM (continuation page)`));
    // motor
    const volts = [num(f.volts1), num(f.volts2), num(f.volts3)], amps = [num(f.amps1), num(f.amps2), num(f.amps3)];
    const vNp = num(s.voltage), fla = num(f.fla);
    add('RTUs', `D${P + 14}`, vNp !== null && fla !== null && volts[0] !== null ? vNp / avg(volts)! * fla : null, `${name} corrected FLA = V nameplate / V avg x FLA`);
    const bhp = s.phase === '1-phase'
      ? (volts[0] !== null && amps[0] !== null ? 0.8 * 0.9 * volts[0] * amps[0] / 746 : null)
      : (avg(volts) !== null && avg(amps) !== null ? avg(volts)! * avg(amps)! * 0.8 * 0.9 * 1.732 / 746 : null);
    add('RTUs', `G${P + 14}`, bhp, `${name} estimated BHP (${s.phase})`);
    // static profile
    const lv = [f.spLeaving1, f.spLeaving2, f.spLeaving3, f.spLeaving4, f.spLeaving5];
    let ent: Cell | undefined = f.spEntering;
    const entering: (Cell | undefined)[] = [ent];
    for (let k = 0; k < 4; k++) { ent = lv[k] !== undefined && lv[k] !== null ? lv[k] : ent; entering.push(ent); }
    const fanIn = num(entering[4] ?? null), fanOut = num(lv[4] ?? null), inlet = num(f.spEntering ?? null);
    add('RTUs', `E${P + 25}`, fanOut !== null && fanIn !== null ? fanOut - fanIn : null, `${name} fan TSP`);
    add('RTUs', `I${P + 25}`, fanOut !== null && inlet !== null ? fanOut - inlet : null, `${name} ESP`);
    add('RTUs', `M${P + 25}`, fanIn !== null && inlet !== null ? fanIn - inlet : null, `${name} unit dP inlet -> fan`);
    add('RTUs', `L${P + 8}`, fanOut !== null && inlet !== null ? fanOut - inlet : null, `${name} unit ESP actual = profile ESP`);
    add('RTUs', `K${P + 8}`, (s.unitEsp ?? null) as Expected, `${name} unit ESP design (data entry, notation shows)`);
    add('RTUs', `L${P + 9}`, (f.fanRpmFinal ?? null) as Expected, `${name} fan RPM actual`);
  }

  // ---- MAUs (PSP)
  const mauTotals: { name: string; design: number | null; actual: number | null }[] = [];
  for (const u of units('mau')) {
    const P = anchor('mau', u.slot), f = u.fields ?? {}, name = `${u.schedule?.designation}`;
    const vels = (u.sequences?.pspVelocities ?? []).map((v) => num(v));
    const L = num(f.pspLength), W = num(f.pspWidth), b = num(f.pspBlanks) ?? 0;
    const K = W !== null ? PSP_K[W] ?? null : null;
    const psp = L !== null && W !== null && K !== null && avg(vels) !== null ? avg(vels)! * (L - 2 - 2 * b) * W * K / 144 : null;
    add('MAUs', `M${P + Q + 3}`, K, `${name} PSP K-factor for ${W}" width`);
    add('MAUs', `E${P + Q + 6}`, psp, `${name} PSP CFM = avg VEL x (L - 2 - 2 blanks) x W x K / 144`);
    add('MAUs', `K${P + Q + 6}`, psp !== null && L ? psp / (L / 12) : null, `${name} PSP CFM / ft`);
    const design = num(f.designCfmOverride) ?? outletTotals(u.tables?.supply).design;
    const actual = f.method === 'PSP' ? psp : outletTotals(u.tables?.supply).final;
    add('MAUs', `E${P + Q + 19}`, f.method === 'PSP' ? psp : null, `${name} method total CFM`);
    add('MAUs', `K${P + 5}`, design, `${name} total design (override)`);
    add('MAUs', `L${P + 5}`, actual, `${name} total actual = method (${f.method})`);
    add('MAUs', `M${P + 5}`, ratio(actual, design), `${name} %`);
    mauTotals.push({ name, design, actual });
  }

  // ---- Fans
  const fanTotals: { design: number | null; actual: number | null }[] = [];
  for (const u of units('fan')) {
    const P = anchor('fan', u.slot), f = u.fields ?? {}, name = `${u.schedule?.designation}`;
    const t = outletTotals(u.tables?.outlets);
    add('Fans', `K${P + 5}`, t.design, `${name} total design`);
    add('Fans', `L${P + 5}`, t.final, `${name} total final`);
    const inlet = num(f.spEntering ?? null), out5 = num(f.spLeaving5 ?? null);
    if (inlet !== null && out5 !== null) add('Fans', `E${P + 25}`, out5 - inlet, `${name} EF TSP (inlet passes through absent components)`);
    fanTotals.push({ design: t.design, actual: t.final });
  }

  // ---- Small fans
  const small: Record<number, { name: string; design: number | null; final: number | null }> = {};
  for (const u of units('smallFan')) {
    const P = anchor('smallFan', u.slot), name = `${u.schedule?.designation}`;
    const t = outletTotals(u.tables?.outlets);
    add('Small Fans', `D${P}`, name, `small fan ${u.slot} name`);
    add('Small Fans', `K${P + 4}`, t.design, `${name} total design`);
    add('Small Fans', `L${P + 4}`, t.final, `${name} total final`);
    small[u.slot] = { name, design: t.design, final: t.final };
  }

  // ---- VAVs
  for (const u of units('vav')) {
    const P = anchor('vav', u.slot), name = `${u.schedule?.designation}`, s = u.schedule ?? {};
    const t = outletTotals(u.tables?.outlets);
    add('VAVs', `L${P + 5}`, (s.designMaxCfm ?? null) as Expected, `${name} max design`);
    add('VAVs', `M${P + 5}`, t.final, `${name} max actual = outlet final total`);
    add('VAVs', `H${P + 19}`, t.design, `${name} outlet design total`);
    add('VAVs', `L${P + 6}`, (s.designMinCfm ?? null) as Expected, `${name} min design (notation shows)`);
    add('VAVs', `D${P + 2}`, (s.terminalType ?? null) as Expected, `${name} terminal type`);
  }

  // ---- Hoods (Evergreen Captrate)
  const hoodTotals: { design: number | null; actual: number | null }[] = [];
  for (const u of units('hood')) {
    const P = anchor('hood', u.slot), f = u.fields ?? {}, name = `${u.schedule?.designation}`;
    const rows = u.tables?.filters ?? [];
    let init = 0, fin = 0, anyInit = false, anyFin = false;
    rows.forEach((r, i) => {
      const c = HOOD_FILTER[`${f.filterType}|${r.size}`];
      const ai = avg([num(r.init1), num(r.init2), num(r.init3)]), af = avg([num(r.final1), num(r.final2), num(r.final3)]);
      add('Hoods', `J${P + 6 + i}`, ai, `${name} filter ${i + 1} initial VEL (avg of P:R)`);
      add('Hoods', `L${P + 6 + i}`, af, `${name} filter ${i + 1} final VEL (avg of S:U)`);
      if (ai !== null) { init += ai * c.area * c.k; anyInit = true; }
      if (af !== null) { fin += af * c.area * c.k; anyFin = true; }
    });
    const design = num(u.schedule?.designCfm);
    add('Hoods', `D${P + 18}`, anyInit ? init : null, `${name} initial total CFM`);
    add('Hoods', `F${P + 18}`, anyFin ? fin : null, `${name} final total CFM (Captrate 16x20: sum VEL x 1.73 x 1.34)`);
    add('Hoods', `H${P + 18}`, ratio(anyFin ? fin : null, design), `${name} % of design`);
    add('Hoods', `F${P + 19}`, ratio(anyFin ? fin : null, num(u.schedule?.lengthFt)), `${name} CFM per ft`);
    hoodTotals.push({ design, actual: anyFin ? fin : null });
  }

  // ---- Traverses
  for (const u of units('traverse')) {
    const T = anchor('traverse', u.slot), f = u.fields ?? {}, name = `T-${u.slot}`;
    const w = num(f.width), h = num(f.height), liner = num(f.liner) ?? 0;
    const ak = f.shape === 'Round' ? round(Math.PI * ((w! - 2 * liner) / 2) ** 2 / 144, 3) : round((w! - 2 * liner) * (h! - 2 * liner) / 144, 3);
    const readings = (u.sequences?.readings ?? []).map((v) => num(v));
    const vel = round(avg(readings));
    const nW = f.shape === 'Round' ? (w! <= 9 ? 6 : w! <= 12 ? 8 : 10) : (w! < 12 ? 2 : Math.min(10, Math.max(3, Math.ceil(w! / 6))));
    const nH = f.shape === 'Round' ? 2 : (h! < 12 ? 2 : Math.min(8, Math.max(3, Math.ceil(h! / 6))));
    add('Traverses', `H${T + 2}`, ak, `${name} Ak (ft2)`);
    add('Traverses', `L${T + 2}`, vel, `${name} final avg VEL from quick entry`);
    add('Traverses', `M${T + 2}`, round(mul(vel, ak)), `${name} final CFM = VEL x Ak`);
    add('Traverses', `K${T + 2}`, round(mul(num(f.initialVel ?? null), ak)), `${name} initial CFM`);
    add('Traverses', `M${T + 4}`, f.shape === 'Round' ? `${nW} x 2 axes` : `${nW} x ${nH}`, `${name} point layout`);
    add('Traverses', `N${T + 6}`, nW * nH, `${name} point count`);
  }

  // ---- Building Balance
  const rtuNames = units('rtu').map((u) => `${u.schedule?.designation}`);
  units('rtu').forEach((u) => {
    const r = 7 + u.slot - 1, n = `${u.schedule?.designation}`;
    add('Building Balance', `C${r}`, oaDesign[n], `${n} OA design`);
    add('Building Balance', `E${r}`, oaFinal[n], `${n} OA actual`);
  });
  units('mau').forEach((u, i) => add('Building Balance', `C${47 + u.slot - 1}`, mauTotals[i].design, `${mauTotals[i].name} design`));
  units('fan').forEach((u, i) => {
    add('Building Balance', `I${7 + u.slot - 1}`, fanTotals[i].design, `fan ${u.slot} design`);
    add('Building Balance', `K${7 + u.slot - 1}`, fanTotals[i].actual, `fan ${u.slot} actual`);
  });
  for (const [slotS, sf] of Object.entries(small)) {
    const slot = Number(slotS);
    const r = slot <= 20 ? 67 + slot - 1 : 47 + slot - 21;
    add('Building Balance', `H${r}`, sf.name, `small fan ${slot} listed (row ${r})`);
    add('Building Balance', `I${r}`, sf.design, `small fan ${slot} design`);
    add('Building Balance', `K${r}`, sf.final, `small fan ${slot} actual`);
  }
  const oaDesTot = sum([...rtuNames.map((n) => oaDesign[n]), ...mauTotals.map((m) => m.design)]);
  const oaActTot = sum([...rtuNames.map((n) => oaFinal[n]), ...mauTotals.map((m) => m.actual)]);
  const exDesTot = sum([...fanTotals.map((x) => x.design), ...Object.values(small).map((x) => x.design)]);
  const exActTot = sum([...fanTotals.map((x) => x.actual), ...Object.values(small).map((x) => x.final)]);
  add('Building Balance', 'C87', oaDesTot, 'OA design total');
  add('Building Balance', 'E87', oaActTot, 'OA actual total');
  add('Building Balance', 'I87', exDesTot, 'exhaust design total (incl. small fan 21 in row 47)');
  add('Building Balance', 'K87', exActTot, 'exhaust actual total');
  add('Building Balance', 'H89', (oaDesTot ?? 0) - (exDesTot ?? 0), 'design building balance');
  add('Building Balance', 'H91', (oaActTot ?? 0) - (exActTot ?? 0), 'actual building balance');
  const bp = p.sections.buildingBalance?.tables?.pressures ?? [];
  bp.forEach((r, i) => add('Building Balance', `H${97 + i}`, (r.dp ?? null) as Expected, `pressure row ${i + 1} dP`));

  // ---- Equipment Summary (RTU lines and hood line), tolerance
  const tol = num(p.sections.equipmentSummary?.fields?.tolerance ?? null) ?? 0.1;
  add('Equipment Summary', 'E5', tol, 'tolerance');
  for (const u of units('rtu')) {
    const r = 9 + u.slot - 1, t = outletTotals(u.tables?.supply);
    add('Equipment Summary', `B${r}`, `${u.schedule?.designation}`, `summary line ${u.schedule?.designation}`);
    add('Equipment Summary', `D${r}`, t.design, `summary ${u.schedule?.designation} design`);
    add('Equipment Summary', `E${r}`, t.final, `summary ${u.schedule?.designation} actual`);
    const ok = t.design && t.final !== null ? (Math.abs(t.final / t.design - 1) > tol ? 'Check' : 'OK') : null;
    add('Equipment Summary', `M${r}`, ok, `summary ${u.schedule?.designation} status`);
  }
  units('hood').forEach((u, i) => {
    const r = 154 + u.slot - 1, h = hoodTotals[i];
    add('Equipment Summary', `E${r}`, h.actual, `summary ${u.schedule?.designation} actual`);
    add('Equipment Summary', `M${r}`, h.design && h.actual !== null ? (Math.abs(h.actual / h.design - 1) > tol ? 'Check' : 'OK') : null, `summary ${u.schedule?.designation} status`);
  });

  // ---- Summary sheets show the issues (the print rows are the input cells themselves)
  for (const [key, sheet] of [['issuesNew', 'Summary - New'], ['issuesExisting', 'Summary - (E)']] as const) {
    (p.sections[key]?.tables?.issues ?? []).forEach((r, i) => {
      add(sheet, `C${13 + i}`, r.remark as string, `${sheet} #${r.no} remark`);
      add(sheet, `J${13 + i}`, r.status as string, `${sheet} #${r.no} status`);
    });
  }
  return out;
}

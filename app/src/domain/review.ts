/**
 * Report check (ROADMAP §7.4): deterministic checks a reviewer makes before a report is issued, as one checklist.
 * Pure: the same inputs always give the same result, no AI involved.
 *
 * It builds on the Attention list (tolerance, open issues, design discrepancies, motor amps / BHP, photos,
 * calibration, capacity: summarized here with a link) and adds the report-level checks:
 *
 *   report      NEBB 5.2: narrative; TAB and report dates (report not before the test); certification lines, not
 *               expired at the report date, signed and dated on a final report; stamp / signature images; at least
 *               one calibrated instrument listed
 *   units       every unit complete; reviewed before a final report; no two units of a type with one designation;
 *               no repeated outlet / valve numbers in a table
 *   remarks     every unit with a reading out of tolerance explains it (a remark on the unit or an issue linked to it)
 *   electrical  measured voltage within ±10 % of the rated voltage; voltage imbalance at most 2 % (NEMA MG 1)
 *   values      readings outside plausible ranges (a typo such as 85 in. w.g. or 25 000 fpm)
 *   hydronic    NEBB 9.4 / 9.5: a wide-open valve per system, memory stops set, pumps and valve systems named alike,
 *               the VFD setpoint of a VFD pump's system recorded
 *
 * Every threshold is in REVIEW_THRESHOLDS so a2b can tune them.
 */
import type { AirflowRow, CertProfile, Equipment, Instrument, Issue, Project } from '../data/types';
import { formatNumber, formatPercent } from './calc';
import { certValue, CERT_KEYS } from './certification';
import type { Completion } from './completion';
import { EQUIPMENT_TYPES } from './equipmentTypes';
import { calibrationExempt, calibrationExpired } from './instruments';
import type { AttentionGroup, AttentionItem } from './attention';
import { ATTENTION_GROUPS } from './attention';
import { xlNum } from './staticProfile';

export const REVIEW_THRESHOLDS = {
  /** Measured voltage within ± this fraction of the rated (schedule) voltage. */
  voltageBand: 0.1,
  /** Voltage imbalance limit: max deviation from the average / average (NEMA MG 1: derate above 1 %, 5 % max). */
  voltageImbalance: 0.02,
  /** Plausible ranges (a reading outside is flagged "check the value"). */
  maxStaticInWg: 10,
  maxVelocityFpm: 5000,
  maxRpm: 5000,
  maxPsi: 300,
};

/** `accepted`: a "Check" line a reviewer accepted (its findings unchanged since). */
export type CheckStatus = 'pass' | 'warn' | 'accepted' | 'fail' | 'na';

export interface CheckFinding {
  text: string;
  /** App path relative to the project (e/<id>, info#…, attention, issues …). */
  to?: string;
}

export interface ReviewCheck {
  key: string;
  group: 'report' | 'units' | 'remarks' | 'electrical' | 'values' | 'hydronic' | 'attention';
  title: string;
  /** NEBB clause or source. */
  ref?: string;
  status: CheckStatus;
  /** Shown when the check passes or does not apply. */
  note?: string;
  findings: CheckFinding[];
  /** Who accepted the findings and when (status `accepted`). */
  accepted?: CheckAcceptance;
}

export interface ReviewInput {
  project: Project;
  equipment: readonly Equipment[];
  rows: readonly AirflowRow[];
  issues: readonly Issue[];
  instruments: readonly Instrument[];
  completions: ReadonlyMap<string, Completion>;
  attention?: readonly AttentionItem[];
  /** The organization's certification profile (stamp / signature images); undefined: not checked. */
  certProfile?: CertProfile | null;
  /**
   * Checking a workbook file (another tech's or firm's report) rather than an app project: what a file cannot tell
   * (unit completeness with photos, reviews, the Attention tab's photo items) is left out.
   */
  fromFile?: boolean;
}

export interface ReviewResult {
  checks: ReviewCheck[];
  fail: number;
  warn: number;
  accepted: number;
  pass: number;
}

const unitTo = (e: Equipment, section?: string) => `e/${e.id}${section ? `#sec-${section}` : ''}`;
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const isoDate = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;

function check(
  key: string,
  group: ReviewCheck['group'],
  title: string,
  findings: CheckFinding[],
  opts: { ref?: string; severity?: 'warn' | 'fail'; na?: boolean; note?: string } = {},
): ReviewCheck {
  const status: CheckStatus = opts.na ? 'na' : findings.length ? (opts.severity ?? 'warn') : 'pass';
  return { key, group, title, ref: opts.ref, status, note: opts.note, findings };
}

export function reviewProject(input: ReviewInput): ReviewResult {
  const { project, equipment, rows, issues, instruments, completions } = input;
  const final = project.reportKind === 'final';
  const T = REVIEW_THRESHOLDS;
  const checks: ReviewCheck[] = [];
  const typeOrder = (e: Equipment) => EQUIPMENT_TYPES.findIndex((t) => t.key === e.type);
  const units = [...equipment].sort((a, b) => typeOrder(a) - typeOrder(b) || a.slot - b.slot);

  // ------------------------------------------------------------------ report (NEBB 5.2)
  checks.push(
    check(
      'narrative',
      'report',
      'Narrative of the system set-up',
      text(project.info.narrative) ? [] : [{ text: 'The narrative is empty.', to: 'info' }],
      { ref: 'NEBB 5.2.4' },
    ),
  );
  const tabDate = isoDate(project.info.tabDate);
  const reportDate = isoDate(project.info.reportDate);
  const dateFindings: CheckFinding[] = [];
  if (!tabDate) dateFindings.push({ text: 'No TAB date.', to: 'info' });
  if (!reportDate) dateFindings.push({ text: 'No report date.', to: 'info' });
  if (tabDate && reportDate && reportDate < tabDate)
    dateFindings.push({ text: `Report date ${reportDate} is before the TAB date ${tabDate}.`, to: 'info' });
  checks.push(check('dates', 'report', 'TAB and report dates', dateFindings, { ref: 'NEBB 5.2.1 / 5.2.5' }));

  const certFindings: CheckFinding[] = [];
  for (const [k, label] of [
    [CERT_KEYS.cpName, 'certified professional'],
    [CERT_KEYS.number, 'certification number'],
    [CERT_KEYS.expiration, 'expiration date'],
  ] as const)
    if (!text(certValue(project, k))) certFindings.push({ text: `No ${label}.`, to: 'info#cert-h' });
  const expiry = isoDate(certValue(project, CERT_KEYS.expiration));
  const onDate = reportDate ?? tabDate;
  if (expiry && onDate && expiry < onDate)
    certFindings.push({
      text: `The certification expired ${expiry}, before the report date ${onDate}.`,
      to: 'info#cert-h',
    });
  if (final) {
    if (!text(project.info[CERT_KEYS.signature]))
      certFindings.push({ text: 'A final report needs the signature line.', to: 'info#cert-h' });
    if (!text(project.info[CERT_KEYS.date]))
      certFindings.push({ text: 'A final report needs the certification date.', to: 'info#cert-h' });
  }
  if (input.certProfile !== undefined) {
    if (!input.certProfile?.stamp)
      certFindings.push({ text: 'No stamp image in the certification profile.', to: '/certification' });
    if (!input.certProfile?.signature)
      certFindings.push({ text: 'No signature image in the certification profile.', to: '/certification' });
  }
  checks.push(
    check('certification', 'report', 'Certification', certFindings, {
      ref: 'NEBB 5.2.2',
      severity: final && certFindings.length ? 'fail' : 'warn',
    }),
  );

  const listed = instruments.filter((i) => text(i.type) || text(i.model) || text(i.serial));
  const instFindings: CheckFinding[] = [];
  if (!listed.length && units.length)
    instFindings.push({ text: 'No instrument is listed on the Calibration sheet.', to: 'info#cal-h' });
  for (const i of listed) {
    const name = [i.type, i.model, i.serial && `SN ${i.serial}`].filter(Boolean).join(' ');
    const exempt = calibrationExempt(i);
    if (exempt && !isoDate(i.calibrationDate)) continue;
    if (!isoDate(i.calibrationDate)) instFindings.push({ text: `${name}: no calibration date.`, to: 'info#cal-h' });
    else if (tabDate && isoDate(i.calibrationDate)! > tabDate)
      instFindings.push({ text: `${name}: calibrated after the TAB date.`, to: 'info#cal-h' });
    else if (!exempt && calibrationExpired(i.calibrationDate, project.info.tabDate))
      instFindings.push({ text: `${name}: calibrated more than 12 months before the TAB date.`, to: 'info#cal-h' });
  }
  checks.push(check('instruments', 'report', 'Instruments and calibration', instFindings, { ref: 'NEBB 5.2.6' }));

  // ------------------------------------------------------------------ units
  const incomplete = units.filter((e) => {
    const c = completions.get(e.id);
    return c && !c.complete;
  });
  if (!input.fromFile)
    checks.push(
      check(
        'complete',
        'units',
        'Every unit complete',
        incomplete.map((e) => {
          const c = completions.get(e.id)!;
          // a red unit with every item entered is complete: its issues / tolerance are on the report
          const why = !c.started
            ? 'not started'
            : `${c.missing.length} item${c.missing.length === 1 ? '' : 's'} missing`;
          return { text: `${e.designation}: ${why}.`, to: unitTo(e) };
        }),
        { severity: final ? 'fail' : 'warn', na: !units.length, note: units.length ? undefined : 'No units yet.' },
      ),
    );
  if (final && !input.fromFile) {
    const unreviewed = units.filter((e) => completions.get(e.id)?.complete && !e.review);
    checks.push(
      check(
        'reviewed',
        'units',
        'Units reviewed before the final report',
        unreviewed.map((e) => ({ text: `${e.designation} is complete but not reviewed.`, to: unitTo(e) })),
      ),
    );
  }
  const dup: CheckFinding[] = [];
  for (const t of EQUIPMENT_TYPES) {
    const seen = new Map<string, Equipment>();
    for (const e of units.filter((x) => x.type === t.key)) {
      const k = e.designation.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) dup.push({ text: `Two ${t.plural}: ${e.designation}.`, to: unitTo(e) });
      else seen.set(k, e);
    }
  }
  for (const e of units) {
    const byTable = new Map<string, Map<string, number>>();
    for (const r of rows.filter((x) => x.equipmentId === e.id)) {
      const no = text(r.data.no);
      if (!no) continue;
      const m = byTable.get(r.table) ?? new Map<string, number>();
      m.set(no, (m.get(no) ?? 0) + 1);
      byTable.set(r.table, m);
    }
    for (const [table, m] of byTable)
      for (const [no, n] of m)
        if (n > 1) dup.push({ text: `${e.designation}: ${table} row No. ${no} appears ${n} times.`, to: unitTo(e) });
  }
  checks.push(check('duplicates', 'units', 'Unique designations and row numbers', dup, { ref: 'NEBB 5.2.5' }));

  // ------------------------------------------------------------------ remarks
  const unexplained: CheckFinding[] = [];
  for (const e of units) {
    const c = completions.get(e.id);
    if (!c?.outOfTolerance.length) continue;
    const hasRemark = Boolean(text(e.data.remarks));
    // an issue linked to the unit, or a Summary remark that names it ("RTU-1: …", as the export writes them)
    const tag = e.designation.trim().toLowerCase();
    const hasIssue = issues.some(
      (i) => i.equipmentId === e.id || (tag !== '' && i.remark.trim().toLowerCase().startsWith(`${tag}:`)),
    );
    if (!hasRemark && !hasIssue)
      unexplained.push({
        text: `${e.designation}: ${c.outOfTolerance.length} reading${c.outOfTolerance.length > 1 ? 's' : ''} out of tolerance (${c.outOfTolerance
          .slice(0, 3)
          .map((o) => `${o.label} ${formatPercent(o.ratio)}`)
          .join(', ')}${c.outOfTolerance.length > 3 ? ' …' : ''}) and no remark or issue explains it.`,
        to: unitTo(e, 'remarks'),
      });
  }
  checks.push(
    check('explained', 'remarks', 'Out-of-tolerance readings explained', unexplained, {
      ref: 'NEBB 5.2.4 (deficiencies noted)',
    }),
  );

  // ------------------------------------------------------------------ electrical
  const elec: CheckFinding[] = [];
  for (const e of units) {
    const volts = [e.data.volts1, e.data.volts2, e.data.volts3]
      .map((v) => xlNum(v))
      .filter((v): v is number => v !== null);
    if (!volts.length) continue;
    const rated = xlNum(e.data.voltage);
    if (rated !== null && rated > 0) {
      const off = volts.filter((v) => Math.abs(v / rated - 1) > T.voltageBand);
      if (off.length)
        elec.push({
          text: `${e.designation}: measured ${off.map((v) => `${formatNumber(v)} V`).join(', ')} is outside ±${Math.round(T.voltageBand * 100)} % of the rated ${formatNumber(rated)} V.`,
          to: unitTo(e, 'motor'),
        });
    }
    if (volts.length >= 2) {
      const avg = volts.reduce((a, b) => a + b, 0) / volts.length;
      const imbalance = Math.max(...volts.map((v) => Math.abs(v - avg))) / avg;
      if (avg > 0 && imbalance > T.voltageImbalance + 1e-9)
        elec.push({
          text: `${e.designation}: voltage imbalance ${formatNumber(imbalance * 100, 1)} % (limit ${Math.round(T.voltageImbalance * 100)} %).`,
          to: unitTo(e, 'motor'),
        });
    }
  }
  checks.push(check('voltage', 'electrical', 'Voltage and phase balance', elec, { ref: 'NEBB 6.9 / NEMA MG 1' }));

  // ------------------------------------------------------------------ values
  const odd: CheckFinding[] = [];
  const staticKey = (k: string) => /^sp(Entering|Leaving)/.test(k) || k === 'unitEsp';
  const rpmKey = (k: string) => /rpm/i.test(k);
  const psiKey = (k: string) => /(Suction|Discharge)$|standingPsi/.test(k);
  for (const e of units) {
    for (const [k, v] of Object.entries(e.data)) {
      const n = xlNum(v);
      if (n === null) continue;
      if (staticKey(k) && Math.abs(n) > T.maxStaticInWg)
        odd.push({
          text: `${e.designation}: static pressure ${formatNumber(n, 2)} in. w.g. — check the value.`,
          to: unitTo(e),
        });
      else if (rpmKey(k) && n > T.maxRpm)
        odd.push({ text: `${e.designation}: ${formatNumber(n)} RPM — check the value.`, to: unitTo(e) });
      else if (psiKey(k) && Math.abs(n) > T.maxPsi)
        odd.push({ text: `${e.designation}: ${formatNumber(n)} psi — check the value.`, to: unitTo(e) });
    }
    for (const r of rows.filter((x) => x.equipmentId === e.id)) {
      for (const k of ['initialVel', 'finalVel', 'velocity'] as const) {
        const n = xlNum(r.data[k]);
        if (n !== null && (n < 0 || n > T.maxVelocityFpm))
          odd.push({
            text: `${e.designation} ${r.table} ${text(r.data.no) || 'row'}: velocity ${formatNumber(n)} fpm — check the value.`,
            to: unitTo(e),
          });
      }
      for (const k of ['designCfm', 'designGpm', 'finalGpm', 'initialGpm'] as const) {
        const n = xlNum(r.data[k]);
        if (n !== null && n < 0)
          odd.push({ text: `${e.designation} ${r.table} ${text(r.data.no) || 'row'}: negative ${k}.`, to: unitTo(e) });
      }
    }
  }
  checks.push(check('values', 'values', 'Readings in a plausible range', odd));

  // ------------------------------------------------------------------ hydronic (NEBB 9.4 / 9.5)
  const systems = units.filter((e) => e.type === 'valveSystem');
  const pumps = units.filter((e) => e.type === 'pump');
  if (systems.length || pumps.length) {
    const hyd: CheckFinding[] = [];
    const same = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase() && text(a) !== '';
    for (const s of systems) {
      const vr = rows.filter((r) => r.equipmentId === s.id && r.table === 'valves');
      const finals = vr.filter((r) => xlNum(r.data.finalGpm) !== null);
      if (finals.length && !vr.some((r) => text(r.data.wideOpen)))
        hyd.push({
          text: `${s.designation}: no valve recorded wide open (NEBB 9.4: one wide-open path).`,
          to: unitTo(s, 'valves'),
        });
      if (finals.length === vr.length && vr.length && text(s.data.memoryStops) !== 'Yes')
        hyd.push({
          text: `${s.designation}: memory stops / valve marking not recorded as done.`,
          to: unitTo(s, 'final'),
        });
      if (!pumps.some((p) => same(p.data.system, s.designation)))
        hyd.push({
          text: `${s.designation}: no pump names this system (the System Summary adds pumps by system name).`,
          to: unitTo(s),
        });
    }
    for (const p of pumps) {
      const sys = systems.find((s) => same(p.data.system, s.designation));
      if (text(p.data.system) && !sys)
        hyd.push({
          text: `${p.designation}: its system "${text(p.data.system)}" has no valve system page.`,
          to: unitTo(p),
        });
      if (!text(p.data.system)) hyd.push({ text: `${p.designation}: no system named.`, to: unitTo(p, 'identity') });
      if (p.data.pumpType === 'VFD' && sys && !text(sys.data.vfdSetpoint))
        hyd.push({
          text: `${sys.designation}: VFD pump ${p.designation}, but no VFD / ΔP setpoint recorded (NEBB 9.5.3).`,
          to: unitTo(sys),
        });
    }
    checks.push(check('hydronic', 'hydronic', 'Hydronic systems', hyd, { ref: 'NEBB 9.4 / 9.5' }));
  }

  // ------------------------------------------------------------------ attention summary
  if (input.attention) {
    const byGroup = new Map<AttentionGroup, number>();
    for (const a of input.attention)
      if (!(input.fromFile && a.group === 'photos')) byGroup.set(a.group, (byGroup.get(a.group) ?? 0) + 1);
    // design discrepancies and motor checks are for the reviewer only: nothing about them is printed on the report
    const reviewOnly = (g: AttentionGroup) => g === 'design' || g === 'motor';
    const summary = (keep: (g: AttentionGroup) => boolean) =>
      ATTENTION_GROUPS.filter((g) => keep(g.key) && byGroup.get(g.key)).map((g) => ({
        text: `${g.title}: ${byGroup.get(g.key)}`,
        to: 'attention',
      }));
    checks.push(
      check(
        'attention',
        'attention',
        'Needs-attention list',
        summary((g) => !reviewOnly(g)),
        {
          note: 'Nothing else on the Attention tab.',
        },
      ),
    );
    checks.push(
      check('reviewOnly', 'attention', 'Design discrepancies and motor checks (review only)', summary(reviewOnly), {
        note: 'None. These are for the reviewer and are not printed on the report.',
      }),
    );
  }

  for (const c of checks) {
    if (c.status !== 'warn') continue;
    const a = checkAcceptance(project.info, c);
    if (a) {
      c.status = 'accepted';
      c.accepted = a;
    }
  }

  return {
    checks,
    fail: checks.filter((c) => c.status === 'fail').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    accepted: checks.filter((c) => c.status === 'accepted').length,
    pass: checks.filter((c) => c.status === 'pass').length,
  };
}

// ------------------------------------------------------------------ acceptances
/**
 * A reviewer can accept a "Check" (warning) line: stored as project info `accept_<check key>` (a JSON string: who,
 * when and a fingerprint of the findings), synced like any project field. The acceptance holds while the findings
 * are the same; any change of them (a new discrepancy, a different count) shows the line as "Check" again. A
 * "Must fix" line is never accepted.
 */
export interface CheckAcceptance {
  name: string;
  at: number;
  /** Fingerprint of the findings when accepted (findingsFingerprint). */
  fp: string;
}

export const acceptanceKey = (checkKey: string) => `accept_${checkKey}`;

/** A short, stable fingerprint of a check's findings (their texts in order). */
export function findingsFingerprint(c: Pick<ReviewCheck, 'findings'>): string {
  let h = 5381;
  for (const ch of c.findings.map((f) => f.text).join('\n')) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${c.findings.length}-${h.toString(16)}`;
}

/** The acceptance of a check that still matches its findings, else null. */
export function checkAcceptance(info: Project['info'], c: ReviewCheck): CheckAcceptance | null {
  const raw = info[acceptanceKey(c.key)];
  if (typeof raw !== 'string') return null;
  try {
    const a = JSON.parse(raw) as Partial<CheckAcceptance>;
    if (typeof a.fp !== 'string' || a.fp !== findingsFingerprint(c)) return null;
    return { name: typeof a.name === 'string' ? a.name : '', at: typeof a.at === 'number' ? a.at : 0, fp: a.fp };
  } catch {
    return null;
  }
}

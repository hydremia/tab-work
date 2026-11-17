/**
 * Air devices (diffusers, registers, grilles) from a mechanical plan's text layer (ROADMAP §7.3 step 2; pure: no PDF
 * library). Engineers tag outlets in two common ways, and both are stacks of short centred lines:
 *
 *   stacked   12"x8"        the neck size, the device type and the design airflow on their own lines, in any
 *             SR1           order, sometimes with "(TYP 5)" (five identical devices share the tag) above or below
 *             290 CFM
 *
 *   hexagon   S1            the type over the CFM inside a hexagon (the neck size comes from the air device
 *             565           schedule, by type and CFM)
 *
 * A stack is a device tag when it has a type line and a size or a CFM line. The type must look like an air device
 * mark (S1, SD-2, RG1, EG1 …): equipment marks (RTU-1, EF-2, FCU-4 …) and plan-note callouts (a bare number) are not
 * devices, and a bare number under a type counts as CFM only when it is a plausible airflow. The air device schedule's
 * types, when known, settle the doubtful ones. Every device keeps its position (points, y downwards) so the user can
 * see it on the sheet, lasso a system's devices and have them lettered.
 */
import { pageWords, type PdfPageText } from './pdfTables';

export interface PlanDevice {
  /** page number (1-based) */
  page: number;
  /** the tag's centre on the upright page, points, y downwards */
  x: number;
  y: number;
  /** the tag's box */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** device type mark as written (S1, SD2, RG-1) */
  type: string;
  /** neck size as written (12"x8", 8"Ø, 14"R), null for a hexagon tag */
  size: string | null;
  /** design airflow, null when the tag has none (a return grille sized by the duct) */
  cfm: number | null;
  /** devices this tag stands for: "(TYP 5)" → 5, else 1 */
  count: number;
  /** "(TYP)" without a number: the tag is typical of others the plan does not count */
  typical: boolean;
  /** the lines of the tag, top to bottom */
  lines: string[];
  /** why the type was accepted: on the schedule, or by its shape */
  typeMatch: 'known' | 'pattern';
}

export interface PlanDevicesResult {
  devices: PlanDevice[];
  /** devices per type, most frequent first */
  types: { type: string; count: number; devices: number; match: 'known' | 'pattern' }[];
}

/** Equipment marks that are not air devices even when stacked over a number (RTU-1 / 2 in a hexagon, CDF / 14 …). */
const EQUIPMENT_PREFIXES = new Set([
  'RTU',
  'AHU',
  'MAU',
  'MUA',
  'DOAS',
  'ERV',
  'HRV',
  'EF',
  'SF',
  'RF',
  'TF',
  'KEF',
  'FCU',
  'VAV',
  'CAV',
  'FPB',
  'VRF',
  'HP',
  'WSHP',
  'CU',
  'ACU',
  'ACCU',
  'CDF',
  'DF',
  'UH',
  'CUH',
  'EUH',
  'BC',
  'BCU',
  'HWP',
  'CHWP',
  'CWP',
  'CH',
  'CT',
  'DHU',
  'HV',
  'FC',
  'ACR',
  'ACRB',
  'EDH',
  'VFD',
  'MD',
  'FD',
  'FSD',
  'BDD',
  'VD',
  'MEP',
]);
/** Air device marks by shape: S1, S-4, SD1, SR-2, RG1, EG1, TG2, LD1, A, B1 … */
const DEVICE_RE = /^([A-Z]{1,3})-?(\d{1,2})?([A-Z])?$/;
const SIZE_RE =
  /^(?:\d{1,2}(?:\.\d)?["”]?\s*[xX×]\s*\d{1,2}(?:\.\d)?["”]?|\d{1,2}(?:\.\d)?["”]?\s*(?:Ø|∅|ø|DIA\.?|RD\.?|R|D)|Ø\s*\d{1,2}["”]?)$/;
const CFM_WORD_RE = /^(\d{1,3}(?:,\d{3})?|\d{2,5})\s*CFM$/i;
const NUMBER_RE = /^\d{1,3}(?:,\d{3})?$|^\d{2,5}$/;
const TYP_RE = /^\(?\s*(?:TYP\.?(?:\s*OF)?\s*(\d{1,2})|(\d{1,2})\s*TYP\.?)\s*\)?$/i;
const TYP_PLAIN_RE = /^\(?\s*TYP\.?\s*\)?$/i;
/** note callouts ("7", "2") and sheet references are small numbers; design airflows start higher */
const MIN_BARE_CFM = 40;
const MAX_CFM = 60000;

type Kind = 'type' | 'size' | 'cfm' | 'number' | 'typ' | 'typical' | 'other';

interface Line {
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  h: number;
  kind: Kind;
  used: boolean;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function classify(text: string, known: ReadonlySet<string>): Kind {
  const t = norm(text).toUpperCase();
  if (TYP_RE.test(t)) return 'typ';
  if (TYP_PLAIN_RE.test(t)) return 'typical';
  if (SIZE_RE.test(t)) return 'size';
  if (CFM_WORD_RE.test(t)) return 'cfm';
  if (NUMBER_RE.test(t)) return 'number';
  if (known.has(t.replace(/\s|-/g, ''))) return 'type';
  const m = DEVICE_RE.exec(t);
  if (m && !EQUIPMENT_PREFIXES.has(m[1])) return 'type';
  return 'other';
}

/** Same-line boxes with a small gap → one line of text ("290" + "CFM" → "290 CFM"). */
function mergeLines(words: ReturnType<typeof pageWords>): Omit<Line, 'kind' | 'used'>[] {
  const ws = [...words].filter((w) => w.text.trim()).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const out: Omit<Line, 'kind' | 'used'>[] = [];
  for (const w of ws) {
    const h = Math.max(1, w.y1 - w.y0);
    const prev = out[out.length - 1];
    const sameLine =
      prev &&
      Math.min(prev.y1, w.y1) - Math.max(prev.y0, w.y0) > 0.5 * Math.min(prev.h, h) &&
      w.x0 - prev.x1 < 0.7 * h &&
      w.x0 - prev.x1 > -0.3 * h;
    if (sameLine) {
      prev.text = `${prev.text} ${w.text.trim()}`;
      prev.x1 = Math.max(prev.x1, w.x1);
      prev.y0 = Math.min(prev.y0, w.y0);
      prev.y1 = Math.max(prev.y1, w.y1);
      prev.cx = (prev.x0 + prev.x1) / 2;
      prev.h = prev.y1 - prev.y0;
    } else out.push({ text: w.text.trim(), x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, cx: (w.x0 + w.x1) / 2, h });
  }
  return out;
}

const cfmOf = (t: string): number | null => {
  const n = Number(norm(t).replace(/,|cfm/gi, '').trim());
  return Number.isFinite(n) && n > 0 && n <= MAX_CFM ? n : null;
};

/**
 * The air devices tagged on a page. `knownTypes` are the air device schedule's marks (S1, SD-2 …) when the user has
 * imported it: they are accepted as types whatever their shape, and a doubtful mark that is not on it is left out
 * when the list is non-empty and the stack has no size line.
 */
export function planDevices(page: PdfPageText, knownTypes: readonly string[] = []): PlanDevicesResult {
  const known = new Set(knownTypes.map((t) => t.toUpperCase().replace(/\s|-/g, '')));
  const lines: Line[] = mergeLines(pageWords(page))
    // tag text is small; titles, room names and the title block are larger and never part of a stack
    .filter((l) => l.h <= 16)
    .map((l) => ({ ...l, kind: classify(l.text, known), used: false }));
  lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

  const devices: PlanDevice[] = [];
  for (const start of lines) {
    if (start.used || start.kind === 'other' || start.kind === 'number') continue;
    // a stack grows downward from its top line: centred within half a line height, gaps under a line height
    const stack: Line[] = [start];
    let last = start;
    for (;;) {
      const next = lines.find(
        (l) =>
          !l.used &&
          !stack.includes(l) &&
          l.kind !== 'other' &&
          l.y0 >= last.y0 &&
          l.y0 - last.y1 < 0.9 * Math.max(last.h, l.h) &&
          l.y0 - last.y1 > -0.3 * Math.min(last.h, l.h) &&
          Math.abs(l.cx - last.cx) < 0.6 * Math.max(last.h, l.h) + 0.15 * Math.max(last.x1 - last.x0, l.x1 - l.x0),
      );
      if (!next || stack.length >= 5) break;
      stack.push(next);
      last = next;
    }
    const typeLine = stack.find((l) => l.kind === 'type');
    if (!typeLine) continue;
    const sizeLine = stack.find((l) => l.kind === 'size');
    const cfmLine = stack.find((l) => l.kind === 'cfm');
    // a bare number is the CFM only right under / over the type (the hexagon tag) and when it is a plausible airflow
    const numberLine = cfmLine
      ? undefined
      : stack.find((l, i) => {
          if (l.kind !== 'number') return false;
          const n = cfmOf(l.text);
          const adjacent = Math.abs(i - stack.indexOf(typeLine)) === 1;
          return n !== null && n >= MIN_BARE_CFM && (adjacent || Boolean(sizeLine));
        });
    if (!sizeLine && !cfmLine && !numberLine) continue;
    const typeText = norm(typeLine.text).toUpperCase();
    const typeMatch: PlanDevice['typeMatch'] = known.has(typeText.replace(/\s|-/g, '')) ? 'known' : 'pattern';
    // with a schedule in hand, a mark it does not list needs a size line to count (a hexagon "CDF / 140" does not);
    // so does a mark without a number (a damper "MD", a letter), which is rarely a device type
    if (typeMatch === 'pattern' && !sizeLine && (known.size || !/\d/.test(typeText))) continue;
    const typ = stack.find((l) => l.kind === 'typ');
    const typical = stack.some((l) => l.kind === 'typical');
    const members = stack.filter(
      (l) => l === typeLine || l === sizeLine || l === cfmLine || l === numberLine || l === typ || l.kind === 'typical',
    );
    for (const l of members) l.used = true;
    const x0 = Math.min(...members.map((l) => l.x0));
    const x1 = Math.max(...members.map((l) => l.x1));
    const y0 = Math.min(...members.map((l) => l.y0));
    const y1 = Math.max(...members.map((l) => l.y1));
    const typMatch = typ ? TYP_RE.exec(norm(typ.text).toUpperCase()) : null;
    const count = typMatch ? Number(typMatch[1] ?? typMatch[2]) : 1;
    devices.push({
      page: page.page,
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      box: { x0, y0, x1, y1 },
      type: typeText,
      size: sizeLine ? norm(sizeLine.text).replace(/”/g, '"') : null,
      cfm: cfmLine ? cfmOf(cfmLine.text) : numberLine ? cfmOf(numberLine.text) : null,
      count: count > 0 ? count : 1,
      typical,
      lines: members.sort((a, b) => a.y0 - b.y0).map((l) => norm(l.text)),
      typeMatch,
    });
  }

  const byType = new Map<string, { type: string; count: number; devices: number; match: 'known' | 'pattern' }>();
  for (const d of devices) {
    const t = byType.get(d.type) ?? { type: d.type, count: 0, devices: 0, match: d.typeMatch };
    t.count += d.count;
    t.devices += 1;
    byType.set(d.type, t);
  }
  return {
    devices,
    types: [...byType.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
  };
}

/** Design airflow of a set of devices (each tag counted `count` times); null when none has one. */
export function devicesCfm(devices: readonly Pick<PlanDevice, 'cfm' | 'count'>[]): number | null {
  let total = 0;
  let any = false;
  for (const d of devices)
    if (d.cfm !== null) {
      total += d.cfm * d.count;
      any = true;
    }
  return any ? total : null;
}

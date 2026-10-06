/**
 * Spelling over the text that prints on the report: the narrative, the Building Balance notes and pressure remarks,
 * each unit's remarks, area served, location and final settings, the airflow lines' areas, and the issues (remark and
 * comments). Pure: the dictionary is passed in as `isWord` (ui/components/SpellingCheck.tsx loads Hunspell en-US with
 * nspell), so this runs the same in tests.
 *
 * Left out on purpose: acronyms and tags (all capitals, or with digits: CFM, RTU-1, 8x8), words under 3 letters,
 * the trade words below, the project's designations and the words a reviewer ignored for this project
 * (`info.spellIgnore`, one per line).
 */
import type { AirflowRow, Equipment, Issue, Project } from '../data/types';
import { AIR_BALANCE_KEYS } from './airBalance';
import { PRESSURE_KEYS } from './projectCompletion';

/** Trade and manufacturer words the general dictionary lacks (compared in lower case). */
export const TRADE_WORDS: ReadonlySet<string> = new Set(
  [
    'airflow airflows ductwork balometer balometers manometer micromanometer anemometer pitot sheave sheaves',
    'rooftop setpoint setpoints louver louvers louvered diffuser diffusers grille grilles plenum plenums',
    'rebalance rebalanced rebalancing unbalanced prelim makeup kitchenette vestibule vestibules dishwasher',
    'interlock interlocked interlocks economizer economizers enthalpy psychrometer hygrometer tachometer',
    'multimeter backdraft backdraught recirculation recirc exfiltration infiltration',
    'captiveaire greenheck trane carrier lennox daikin aaon york loren cook westinghouse evergreen velgrid telco',
    'intertek shortridge alnor fluke testo dwyer belimo honeywell siemens johnson ruskin titus nailor krueger',
    'baldor marathon regal emerson weg leeson yaskawa danfoss munters multiflex desiccant',
    'dehumidification dehumidify dehumidified dehumidifier dehumidifiers humidification',
  ]
    .join(' ')
    .split(/\s+/),
);

export interface SpellPlace {
  label: string;
  /** App path relative to the project. */
  to: string;
}

export interface SpellFinding {
  word: string;
  places: SpellPlace[];
}

export interface SpellInput {
  project: Pick<Project, 'info'>;
  equipment: readonly Pick<Equipment, 'id' | 'designation' | 'data'>[];
  rows: readonly Pick<AirflowRow, 'equipmentId' | 'data'>[];
  issues: readonly Pick<Issue, 'id' | 'remark' | 'comments'>[];
}

/** The project's ignored words (lower case). */
export function ignoredWords(info: Readonly<Record<string, unknown>>): Set<string> {
  const v = info.spellIgnore;
  return new Set(
    typeof v === 'string'
      ? v
          .split(/[\n,]+/)
          .map((w) => w.trim().toLowerCase())
          .filter(Boolean)
      : [],
  );
}

/** `spellIgnore` with one more word. */
export function withIgnored(info: Readonly<Record<string, unknown>>, word: string): string {
  const words = [...ignoredWords(info)];
  const w = word.trim().toLowerCase();
  if (w && !words.includes(w)) words.push(w);
  return words.sort().join('\n');
}

/** The words of a text worth checking (see the module comment). */
export function wordsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)) {
    for (let part of m[0].split('-')) {
      part = part.replace(/['’](s|d|ll|re|ve|t)?$/i, '').replace(/^['’]+/, '');
      // acronyms, also in the plural (VFDs, PSPs)
      if (part.length < 3 || /\d/.test(part) || part.replace(/s$/, '') === part.replace(/s$/, '').toUpperCase())
        continue;
      out.push(part);
    }
  }
  return out;
}

/** The texts that print, with where each one is edited. */
function sources(input: SpellInput): { text: string; place: SpellPlace }[] {
  const out: { text: string; place: SpellPlace }[] = [];
  const add = (v: unknown, label: string, to: string) => {
    if (typeof v === 'string' && v.trim()) out.push({ text: v, place: { label, to } });
  };
  const info = input.project.info;
  add(info.narrative, 'Narrative', 'info');
  add(info[AIR_BALANCE_KEYS.excludedNote], 'Building Balance note', 'info');
  for (const k of [PRESSURE_KEYS.buildingRemarks, PRESSURE_KEYS.kitchenRemarks, PRESSURE_KEYS.spareRemarks])
    add(info[k], 'Building pressure remarks', 'info');
  for (const e of input.equipment) {
    const to = `e/${e.id}`;
    add(e.data.remarks, `${e.designation} remarks`, `${to}#sec-remarks`);
    add(e.data.areaServed, `${e.designation} area served`, to);
    add(e.data.location, `${e.designation} location`, to);
    add(e.data.finalSettings, `${e.designation} final settings`, to);
  }
  const tag = new Map(input.equipment.map((e) => [e.id, e]));
  for (const r of input.rows) {
    const e = tag.get(r.equipmentId);
    if (e) add(r.data.area, `${e.designation} airflow lines`, `e/${e.id}`);
  }
  for (const i of input.issues) {
    add(i.remark, 'Issue', `issues#issue-${i.id}`);
    add(i.comments, 'Issue comments', `issues#issue-${i.id}`);
  }
  return out;
}

/** The misspelled words, most places first, each place listed once. */
export function checkSpelling(input: SpellInput, isWord: (w: string) => boolean): SpellFinding[] {
  const ignore = ignoredWords(input.project.info);
  const tags = new Set(input.equipment.flatMap((e) => wordsOf(e.designation).map((w) => w.toLowerCase())));
  const known = new Map<string, boolean>();
  const found = new Map<string, SpellFinding>();
  for (const s of sources(input)) {
    for (const w of wordsOf(s.text)) {
      const lower = w.toLowerCase();
      if (TRADE_WORDS.has(lower) || ignore.has(lower) || tags.has(lower)) continue;
      let ok = known.get(w);
      if (ok === undefined) {
        ok = isWord(w);
        known.set(w, ok);
      }
      if (ok) continue;
      const f = found.get(lower) ?? { word: w, places: [] };
      if (!f.places.some((p) => p.label === s.place.label && p.to === s.place.to)) f.places.push(s.place);
      found.set(lower, f);
    }
  }
  return [...found.values()].sort((a, b) => b.places.length - a.places.length || a.word.localeCompare(b.word));
}

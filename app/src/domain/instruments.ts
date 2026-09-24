/**
 * Instruments picked on unit / traverse / hood pages vs. the project's Calibration list (pure).
 *
 * The unit pages pick an instrument *kind* from the workbook's lists (Airflow.Instrument, Traverse.Instrument,
 * Hood.Instrument: "Flow Hood", "Manometer/Pitot Tube", "Evergreen VelGrid" …); the Calibration sheet lists the
 * actual meters ("Balometer – Evergreen Telemetry Three Pounder", "Digital Micromanometer" …). A kind is covered
 * when a calibration row matches its pattern (type, manufacturer and model text). Kinds that are not a
 * calibrated meter (DDC / controller reading, "Other") need no row. Readings imply meters too: volts / amps a
 * multimeter, RPM a tachometer, static pressures a manometer.
 */
import type { Equipment, Instrument } from '../data/types';
import { isBlank } from './conditions';

export interface InstrumentNeed {
  /** What was picked / measured ("Flow Hood", "Voltage / amperage readings"). */
  label: string;
  /** Calibration row this needs, in words ("a flow hood / balometer"). */
  meter: string;
  pattern: RegExp;
}

const FLOW_HOOD: Omit<InstrumentNeed, 'label'> = {
  meter: 'a flow hood (balometer)',
  pattern: /balometer|flow ?hood|capture ?hood|air ?data|three pounder/i,
};
const MANOMETER: Omit<InstrumentNeed, 'label'> = {
  meter: 'a (micro)manometer',
  pattern: /manometer|pvf|velgrid|airfoil|pressure (meter|gauge)/i,
};
const HOT_WIRE: Omit<InstrumentNeed, 'label'> = {
  meter: 'a hot-wire (thermal) anemometer',
  pattern: /hot[- ]?wire|thermal anemometer|thermo-?anemometer/i,
};
const VANE: Omit<InstrumentNeed, 'label'> = { meter: 'a rotating vane anemometer', pattern: /vane|rotating/i };
const MULTIMETER: Omit<InstrumentNeed, 'label'> = {
  meter: 'a voltage / amperage meter',
  pattern: /multimeter|volt|amp|clamp/i,
};
const TACHOMETER: Omit<InstrumentNeed, 'label'> = { meter: 'a tachometer', pattern: /tach/i };

/** Instrument list values -> the calibration row they need (null: none needed). */
const KIND_NEEDS: Record<string, Omit<InstrumentNeed, 'label'> | null> = {
  // Airflow.Instrument
  'Flow Hood': FLOW_HOOD,
  'Velocity Grid': MANOMETER,
  'Pitot Traverse': MANOMETER,
  'Hot Wire Anemometer': HOT_WIRE,
  'Rotating Vane Anemometer': VANE,
  'DDC / Controller Reading': null,
  'Other (see remarks)': null,
  // Traverse.Instrument
  'Manometer/Velocity Matrix': MANOMETER,
  'Manometer/Pitot Tube': MANOMETER,
  'Manometer/Airfoil': MANOMETER,
  'Other Velocity Meter': null,
  'Other Instrument': null,
  // Hood.Instrument (Evergreen VelGrid / Airfoil read on the Evergreen micromanometer)
  'Evergreen VelGrid': MANOMETER,
  'Evergreen Airfoil': MANOMETER,
};

export const INSTRUMENT_FIELDS = ['instrument', 'exhaustInstrument'] as const;

/** The calibration row an instrument picked on a unit page needs (null: none, or not a known kind). */
export function needFor(kind: unknown): InstrumentNeed | null {
  if (typeof kind !== 'string' || !kind.trim()) return null;
  const n = KIND_NEEDS[kind.trim()];
  return n ? { label: kind.trim(), ...n } : null;
}

const rowText = (i: Pick<Instrument, 'type' | 'manufacturer' | 'model'>) => `${i.type} ${i.manufacturer} ${i.model}`;

/** Calibration rows that cover a need (a row counts once it has a type, manufacturer or model). */
export function matchingRows<T extends Pick<Instrument, 'type' | 'manufacturer' | 'model'>>(
  need: InstrumentNeed,
  instruments: readonly T[],
): T[] {
  return instruments.filter((i) => rowText(i).trim() !== '' && need.pattern.test(rowText(i)));
}

/** Warning text for an instrument picked on a unit page with no calibration row; null when covered / not needed. */
export function pickerWarning(
  kind: unknown,
  instruments: readonly Pick<Instrument, 'type' | 'manufacturer' | 'model'>[],
): string | null {
  const need = needFor(kind);
  if (!need || matchingRows(need, instruments).length) return null;
  return `No calibration row for ${need.meter}: add it under Info → Instruments (Calibration sheet).`;
}

/** Meters implied by readings entered on a unit (volts / amps, RPM, static pressures). */
export function impliedNeeds(e: Pick<Equipment, 'data'>): InstrumentNeed[] {
  const has = (re: RegExp) => Object.entries(e.data).some(([k, v]) => re.test(k) && !isBlank(v));
  const out: InstrumentNeed[] = [];
  if (has(/^(volts[123]|amps[123]?)$/)) out.push({ label: 'Voltage / amperage readings', ...MULTIMETER });
  if (has(/^(motorRpm|fanRpm)(Initial|Final|Actual)$/)) out.push({ label: 'RPM readings', ...TACHOMETER });
  if (has(/^(spEntering|spLeaving\d|ductStatic|espActual|supplyDpActual|exhaustDpActual)$/))
    out.push({ label: 'Static pressure readings', ...MANOMETER });
  return out;
}

/** Months between a calibration date and the TAB date (ISO dates); null when either is missing / not a date. */
export function calibrationAgeMonths(calibrationDate: string, tabDate: unknown): number | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(calibrationDate) || typeof tabDate !== 'string' || !iso.test(tabDate)) return null;
  const [cy, cm, cd] = calibrationDate.split('-').map(Number);
  const [ty, tm, td] = tabDate.split('-').map(Number);
  return (ty - cy) * 12 + (tm - cm) + (td - cd) / 31;
}

/** "More than 12 months before the TAB date" (REQUIRED_FIELDS.md, Calibration). */
export function calibrationExpired(calibrationDate: string, tabDate: unknown): boolean {
  const m = calibrationAgeMonths(calibrationDate, tabDate);
  return m !== null && m > 12;
}

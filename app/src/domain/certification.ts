/**
 * Certification sheet (docs/REQUIRED_FIELDS.md "Project level"), stored as project fields `info.cert*` so they sync,
 * diff and re-import like the other project fields:
 *
 *   certCpName      C30  "NEBB Certified Professional:  <name>"   optional (defaults to the template's CP)
 *   certNumber      C32  "Certification Number:  <number>"          optional (idem)
 *   certExpiration  C34  "Expiration Date: <Month d, yyyy>"        optional (idem); flagged when before the report
 *   certSignature   I53  signature line (the signer's name)         required on a FINAL report; automatic N/A on a
 *   certDate        I56  date line                                  prelim (exported as "N/A", read back as automatic)
 *
 * The stamp box (C51:G56) has no picture placeholder in the template, so the stamp / signature image is placed in
 * Excel (no image in the app). The firm lines (C36, C37) are fixed template text.
 */
import { DEFAULT_CERTIFICATION } from '@a2b/workbook/map';
import type { FieldValue, Project } from '../data/types';
import type { ItemResult } from './completion';
import { isBlank } from './conditions';
import type { FieldSpec } from './specs';

export const CERT_KEYS = {
  cpName: 'certCpName',
  number: 'certNumber',
  expiration: 'certExpiration',
  signature: 'certSignature',
  date: 'certDate',
} as const;

export const CERT_INFO_KEYS: readonly string[] = Object.values(CERT_KEYS);

/** Template defaults of the certified professional's lines (an absent project value means the default). */
export const CERT_DEFAULTS: Readonly<Record<string, string>> = {
  [CERT_KEYS.cpName]: DEFAULT_CERTIFICATION.cpName,
  [CERT_KEYS.number]: DEFAULT_CERTIFICATION.certNumber,
  [CERT_KEYS.expiration]: DEFAULT_CERTIFICATION.expiration,
};

export const CERT_LABELS: Record<string, string> = {
  [CERT_KEYS.cpName]: 'NEBB certified professional',
  [CERT_KEYS.number]: 'Certification number',
  [CERT_KEYS.expiration]: 'Certification expiration date',
  [CERT_KEYS.signature]: 'Certification signature',
  [CERT_KEYS.date]: 'Certification date',
};

export const CERT_FIELDS: readonly FieldSpec[] = [
  { key: CERT_KEYS.cpName, label: 'NEBB certified professional', input: 'text', required: false },
  { key: CERT_KEYS.number, label: 'Certification number', input: 'text', required: false },
  { key: CERT_KEYS.expiration, label: 'Expiration date', input: 'date', required: false },
  {
    key: CERT_KEYS.signature,
    label: 'Signature (signed by)',
    input: 'text',
    hint: 'The name on the signature line. A stamp or signature image is placed in Excel.',
  },
  { key: CERT_KEYS.date, label: 'Date', input: 'date' },
];

/** Signature and date are automatically N/A on a preliminary report. */
export const CERT_PRELIM_REASON = 'preliminary report';
const SIGNED = new Set<string>([CERT_KEYS.signature, CERT_KEYS.date]);

/** The value the app shows and exports: the project value, or the template default for the CP lines. */
export function certValue(project: Pick<Project, 'info'>, key: string): FieldValue {
  const v = project.info[key];
  if (v === undefined && key in CERT_DEFAULTS) return CERT_DEFAULTS[key];
  return v ?? null;
}

/** Completion state of each certification field (signature / date: required on final, automatic N/A on prelim). */
export function certificationStates(
  project: Pick<Project, 'info' | 'naState' | 'reportKind'>,
): Record<string, ItemResult> {
  const out: Record<string, ItemResult> = {};
  for (const f of CERT_FIELDS) {
    const v = certValue(project, f.key);
    const mark = project.naState.fields[f.key];
    if (!isBlank(v)) out[f.key] = { state: 'value' };
    else if (mark) out[f.key] = { state: 'na', notation: mark.notation, reason: mark.reason };
    else if (SIGNED.has(f.key) && project.reportKind !== 'final')
      out[f.key] = { state: 'auto-na', notation: 'N/A', reason: CERT_PRELIM_REASON };
    else out[f.key] = { state: SIGNED.has(f.key) ? 'missing' : 'optional' };
  }
  return out;
}

/** The certification has expired before the report / TAB date (or today when neither is set). */
export function certificationExpired(project: Pick<Project, 'info'>, today = new Date()): boolean {
  const exp = certValue(project, CERT_KEYS.expiration);
  if (typeof exp !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) return false;
  const ref = [project.info.reportDate, project.info.tabDate].find(
    (d): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d),
  );
  return exp < (ref ?? today.toISOString().slice(0, 10));
}

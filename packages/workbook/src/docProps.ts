/**
 * Revision marker: a few custom document properties (docProps/custom.xml) that tell the app which project and which
 * exported revision a workbook came from. Excel keeps custom properties when it saves (File > Info > Properties >
 * Advanced > Custom shows them); LibreOffice keeps them as user-defined properties. Nothing on the sheets changes.
 *
 * Writing touches three small parts only: docProps/custom.xml (created, or our properties replaced inside it while any
 * other custom properties are kept), the package's root _rels/.rels (a relationship to it) and [Content_Types].xml (an
 * Override for it). The last two are only changed when the part is new.
 */
import type JSZip from 'jszip';
import { attr, parseRels, readText, xmlEscape, xmlUnescape } from './ooxml.js';

export interface RevisionMarker {
  projectId: string;
  revisionId: string;
  /** "Prelim", "Rev 1" ... (information only). */
  label?: string;
  /** ISO timestamp of the export (information only). */
  exportedAt?: string;
}

export const MARKER_PREFIX = 'a2bTab.';
const NAMES: Record<keyof RevisionMarker, string> = {
  projectId: `${MARKER_PREFIX}projectId`,
  revisionId: `${MARKER_PREFIX}revisionId`,
  label: `${MARKER_PREFIX}revisionLabel`,
  exportedAt: `${MARKER_PREFIX}exportedAt`,
};

const CUSTOM_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties';
const CUSTOM_CT = 'application/vnd.openxmlformats-officedocument.custom-properties+xml';
const FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}';
const NS =
  'xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
  'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"';

async function customPart(zip: JSZip): Promise<string | undefined> {
  if (!zip.file('_rels/.rels')) return undefined;
  const rel = parseRels(await readText(zip, '_rels/.rels')).find((r) => r.type === CUSTOM_REL);
  return rel ? rel.target.replace(/^\//, '') : undefined;
}

/** All custom document properties as name -> text value. */
export async function readCustomProperties(zip: JSZip): Promise<Record<string, string>> {
  const part = await customPart(zip);
  const out: Record<string, string> = {};
  if (!part || !zip.file(part)) return out;
  const xml = await readText(zip, part);
  for (const m of xml.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
    const name = attr(`<p${m[1]}>`, 'name');
    const v = /<vt:[a-zA-Z0-9]+>([\s\S]*?)<\/vt:[a-zA-Z0-9]+>/.exec(m[2]);
    if (name !== undefined) out[name] = v ? xmlUnescape(v[1]) : '';
  }
  return out;
}

export async function readRevisionMarker(zip: JSZip): Promise<RevisionMarker | null> {
  const p = await readCustomProperties(zip);
  const projectId = p[NAMES.projectId];
  const revisionId = p[NAMES.revisionId];
  if (!projectId || !revisionId) return null;
  const m: RevisionMarker = { projectId, revisionId };
  if (p[NAMES.label]) m.label = p[NAMES.label];
  if (p[NAMES.exportedAt]) m.exportedAt = p[NAMES.exportedAt];
  return m;
}

/** Write (or replace) the marker properties, keeping every other custom property. */
export async function writeRevisionMarker(zip: JSZip, marker: RevisionMarker): Promise<void> {
  const props = (Object.keys(NAMES) as (keyof RevisionMarker)[])
    .filter((k) => marker[k] !== undefined && marker[k] !== '')
    .map((k) => [NAMES[k], String(marker[k])] as const);
  let part = await customPart(zip);
  let kept: string[] = [];
  let pid = 1;
  if (part && zip.file(part)) {
    const xml = await readText(zip, part);
    for (const m of xml.matchAll(/<property\b([^>]*)>[\s\S]*?<\/property>/g)) {
      const name = attr(`<p${m[1]}>`, 'name') ?? '';
      pid = Math.max(pid, Number(attr(`<p${m[1]}>`, 'pid') ?? 1));
      if (!name.startsWith(MARKER_PREFIX)) kept.push(m[0]);
    }
  } else {
    part = 'docProps/custom.xml';
    kept = [];
    const rels = await readText(zip, '_rels/.rels');
    const ids = new Set(parseRels(rels).map((r) => r.id));
    let n = ids.size + 1;
    while (ids.has(`rId${n}`)) n++;
    zip.file(
      '_rels/.rels',
      rels.replace(
        '</Relationships>',
        `<Relationship Id="rId${n}" Type="${CUSTOM_REL}" Target="docProps/custom.xml"/></Relationships>`,
      ),
    );
    const ct = await readText(zip, '[Content_Types].xml');
    if (!ct.includes('PartName="/docProps/custom.xml"')) {
      zip.file(
        '[Content_Types].xml',
        ct.replace('</Types>', `<Override PartName="/docProps/custom.xml" ContentType="${CUSTOM_CT}"/></Types>`),
      );
    }
  }
  const ours = props.map(
    ([name, value]) =>
      `<property fmtid="${FMTID}" pid="${++pid}" name="${xmlEscape(name)}"><vt:lpwstr>${xmlEscape(value)}</vt:lpwstr></property>`,
  );
  zip.file(
    part,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties ${NS}>${kept.join('')}${ours.join('')}</Properties>`,
  );
}

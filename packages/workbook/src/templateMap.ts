/**
 * Template map for the a2b TAB workbook, revision 05 (`05 - a2b_Blank_TAB_Workbook 9-23-26.xlsm`).
 *
 * Everything the exporter and importer know about the template lives here as DATA:
 *  - sheets are referred to by NAME; the XML part is resolved at run time through
 *    xl/workbook.xml + xl/_rels/workbook.xml.rels (never a hard-coded sheetN.xml);
 *  - repeating unit blocks are described by an anchor formula (row of block n);
 *  - every input is a field (column + row offset from the anchor, type, list);
 *  - outlet tables, remark lines, reading grids and column tables are generic shapes.
 *
 * Source: docs/WORKBOOK_ANALYSIS.md (rev 04 layout, same in rev 05) + checks against the rev 05 XML.
 * Still to add: the 20 spare OA rows on Building Balance and Certification (more entries, not more code).
 */

export const TEMPLATE_REVISION = '05';

/** Notations accepted in any numeric/date/list field (Abbreviations legend). Written as text. */
export const NOTATIONS = ['N/A', 'Not Avail.', 'Not Acc.'] as const;

export type FieldType = 'number' | 'text' | 'date' | 'list';

export interface FieldDef {
  key: string;
  /** Column letter(s), e.g. "D". */
  col: string;
  /** Absolute row for single-sheet sections, row offset from the anchor row P for blocks. */
  row: number;
  type: FieldType;
  /** Defined name of a dropdown list in the template (values are read from the template itself). */
  list?: string;
  /** Inline list (a data-validation literal such as "Open,Closed"). */
  values?: readonly (string | number)[];
  /** Template placeholder text/value: cleared on export when the project has no value, ignored on import. */
  placeholder?: string | number;
  /** Value the template ships with in every block (e.g. unit type "RTU"). Ignored when detecting used slots. */
  preset?: string;
  /** Like `preset`, but different in every block: `{n}` is the block number (traverse point label "T-{n}"). */
  slotPreset?: string;
  /** Values the importer treats as blank (e.g. the "SF" header text used as a placeholder). */
  blankValues?: readonly string[];
  label?: string;
}

/** A run of table rows: `count` rows starting at `row`, `stride` rows apart (default 1). */
export interface Segment {
  row: number;
  count: number;
  stride?: number;
  /** Columns that are formulas on a given row of this segment (index inside the segment -> columns). */
  omit?: Readonly<Record<number, readonly string[]>>;
}

export interface ColumnDef {
  key: string;
  col: string;
  type: FieldType;
  list?: string;
  values?: readonly (string | number)[];
  /** The template has no <c> for this column: a created cell copies the style of this column's cell in the row. */
  styleFrom?: string;
}

/** Row table (outlets, filters, issues, instruments ...). Data: array of row records, in order. */
export interface TableDef {
  key: string;
  segments: readonly Segment[];
  columns: readonly ColumnDef[];
}

/** Free-text lines (remarks). Data: string[] in order. */
export interface LinesDef {
  key: string;
  cells: readonly { col: string; row: number }[];
  /**
   * Paged blocks only: the lines belong to the block at this position on its page (0-based), rows relative to
   * that block's anchor. Used for the remark box a page shares between its hoods / traverses.
   */
  pagePosition?: number;
}

/** A grid of single readings filled in reading order (traverse quick entry, PSP velocities). Data: array. */
export interface SequenceDef {
  key: string;
  type: 'number' | 'text';
  row: number;
  rows: number;
  cols: readonly string[];
  /** colMajor: down the first column, then the next (traverse quick entry). rowMajor: across, then down. */
  order: 'rowMajor' | 'colMajor';
}

/** Items laid out one per column (MAU filter grid: size row + velocity row). Data: array of records. */
export interface ColumnTableDef {
  key: string;
  cols: readonly string[];
  fields: readonly { key: string; row: number; type: FieldType; list?: string }[];
}

export interface Layout {
  fields?: readonly FieldDef[];
  tables?: readonly TableDef[];
  lines?: readonly LinesDef[];
  sequences?: readonly SequenceDef[];
  columnTables?: readonly ColumnTableDef[];
}

export type Anchor =
  | { kind: 'linear'; first: number; stride: number }
  /** `perPage` blocks on pages of `pageRows` rows; block k on a page starts at page start + offsets[k]. */
  | { kind: 'paged'; first: number; pageRows: number; offsets: readonly number[] };

/** Anchor row P of block n (1-based). */
export function anchorRow(a: Anchor, n: number): number {
  if (a.kind === 'linear') return a.first + a.stride * (n - 1);
  const per = a.offsets.length;
  return a.first + a.pageRows * Math.floor((n - 1) / per) + a.offsets[(n - 1) % per];
}

/** Position of block n on its page (0-based; always 0 for linear anchors). */
export function pagePosition(a: Anchor, n: number): number {
  return a.kind === 'linear' ? 0 : (n - 1) % a.offsets.length;
}

/** Preset value of a field in block n (`preset`, or `slotPreset` with {n} replaced). */
export function fieldPreset(fd: FieldDef, n: number): string | undefined {
  return fd.slotPreset !== undefined ? fd.slotPreset.replace('{n}', String(n)) : fd.preset;
}

/** The block layout as it applies to block n: page-position lines are kept only for their position. */
export function blockLayout(def: EquipmentDef, n: number): Layout {
  const pos = pagePosition(def.block.anchor, n);
  const lines = def.block.lines?.filter((l) => l.pagePosition === undefined || l.pagePosition === pos);
  return { ...def.block, lines };
}

export interface SheetSection extends Layout {
  key: string;
  sheet: string;
}

export interface EdeDef {
  sheet: string;
  firstRow: number;
  /** Sample designation pre-filled in the first row of the section (cleared on export if slot 1 is unused). */
  sampleDesignation?: string;
  fields: readonly Omit<FieldDef, 'row'>[];
}

export interface EquipmentDef {
  key: string;
  label: string;
  capacity: number;
  /** Row n of the {Equipment Data Entry} section feeds block n. */
  ede?: EdeDef;
  block: Layout & { sheet: string; anchor: Anchor };
}

export interface TemplateMap {
  revision: string;
  sections: readonly SheetSection[];
  equipment: readonly EquipmentDef[];
  /** Cover photo picture: sheet, and the drawing picture's name (xdr:cNvPr/@name). */
  coverPhoto: { sheet: string; pictureName: string };
}

// ------------------------------------------------------------------------------------------ helpers
const EDE = '{Equipment Data Entry}';
const f = (key: string, col: string, row: number, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  key, col, row, type, ...extra,
});
const c = (key: string, col: string, type: FieldType, extra: Partial<ColumnDef> = {}): ColumnDef => ({ key, col, type, ...extra });
const cols = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let x = from.charCodeAt(0); x <= to.charCodeAt(0); x++) out.push(String.fromCharCode(x));
  return out;
};

/** Outlet table columns shared by every unit sheet (G, J, L, M are formulas). */
const OUTLET_COLUMNS: readonly ColumnDef[] = [
  c('no', 'B', 'text'),
  c('area', 'C', 'text'),
  // D (Type) has no <c> element on any outlet row of the template (quirk): borrow the Size cell's style
  c('type', 'D', 'text', { styleFrom: 'E' }),
  c('size', 'E', 'text'),
  c('ak', 'F', 'number'),
  c('designCfm', 'H', 'number'),
  c('initialVel', 'I', 'number'),
  c('finalVel', 'K', 'number'),
];

/** EDE columns B-Q of the RTU / MAU / fan sections. */
const EDE_UNIT_FIELDS: readonly Omit<FieldDef, 'row'>[] = [
  { key: 'designation', col: 'B', type: 'text' },
  { key: 'areaServed', col: 'C', type: 'text' },
  { key: 'location', col: 'D', type: 'text' },
  { key: 'manufacturer', col: 'E', type: 'text' },
  { key: 'model', col: 'F', type: 'text' },
  { key: 'hp', col: 'G', type: 'number' },
  { key: 'unitEsp', col: 'H', type: 'number' },
  { key: 'fanRpm', col: 'I', type: 'number' },
  { key: 'motorSheave', col: 'J', type: 'text' },
  { key: 'fanPulley', col: 'K', type: 'text' },
  { key: 'belts', col: 'L', type: 'text' },
  { key: 'cToC', col: 'M', type: 'text' },
  { key: 'voltage', col: 'N', type: 'number' },
  // Must be typed exactly: the BHP formula tests C17="1-phase". EDE has no dropdowns, so the list is inline.
  { key: 'phase', col: 'O', type: 'list', values: ['1-phase', '3-phase'] },
  { key: 'designTotalCfm', col: 'P', type: 'number' },
  { key: 'designOaCfm', col: 'Q', type: 'number' },
];

/** Data block rows +2 ... +26 shared by RTUs / MAUs / ERVs / Fans. */
function unitDataFields(unitTypePreset: string, withOaDamper: boolean): FieldDef[] {
  return [
    f('driveType', 'D', 2, 'list', { list: 'Drive.Type' }),
    f('rotationDesign', 'G', 2, 'text'),
    f('rotationActual', 'J', 2, 'text'),
    f('sheaveBore', 'M', 2, 'text'),
    f('serial', 'D', 6, 'text'),
    f('filters', 'L', 10, 'text'),
    f('motorManufacturer', 'D', 11, 'text'),
    f('motorRpm', 'F', 12, 'number'),
    // G+12 holds the text "SF" as a placeholder; the list's first entry is that header. Treat as blank.
    f('serviceFactor', 'G', 12, 'list', { list: 'Service.Factors2', preset: 'SF', blankValues: ['SF'] }),
    f('fla', 'E', 13, 'number'),
    f('frame', 'G', 13, 'text'),
    f('volts1', 'E', 15, 'number'), f('volts2', 'F', 15, 'number'), f('volts3', 'G', 15, 'number'),
    f('finalSettings', 'L', 15, 'text'),
    f('amps1', 'E', 16, 'number'), f('amps2', 'F', 16, 'number'), f('amps3', 'G', 16, 'number'),
    f('motorRpmInitial', 'K', 17, 'number'), f('motorRpmFinal', 'L', 17, 'number'),
    f('fanRpmInitial', 'K', 18, 'number'), f('fanRpmFinal', 'L', 18, 'number'),
    f('vsdInitial', 'K', 19, 'number'), f('vsdFinal', 'L', 19, 'number'),
    f('spEntering', 'C', 20, 'number'),
    ...(withOaDamper ? [f('oaDamper', 'L', 20, 'text')] : []),
    // Leaving static after components 1-5 (unit-type dependent: RTU = Filter, -, Coil, Heat, Fan).
    f('spLeaving1', 'C', 21, 'number'), f('spLeaving2', 'D', 21, 'number'), f('spLeaving3', 'E', 21, 'number'),
    f('spLeaving4', 'F', 21, 'number'), f('spLeaving5', 'G', 21, 'number'),
    f('unitType', 'D', 22, 'list', { list: 'Unit.Type', preset: unitTypePreset }),
    f('instrument', 'D', 26, 'list', { list: 'Airflow.Instrument' }),
    f('akNotes', 'I', 26, 'text'),
  ];
}

const Q = 52; // continuation page offset (Q = P + 52)

// ------------------------------------------------------------------------------------------ the map
export const TEMPLATE_MAP: TemplateMap = {
  revision: TEMPLATE_REVISION,
  coverPhoto: { sheet: 'Cover Page', pictureName: 'Project Photo' },

  sections: [
    {
      key: 'projectInfo',
      sheet: '{Project Information}',
      fields: [
        f('projectName', 'E', 2, 'text', { placeholder: '{ProjectCode}' }),
        f('address', 'E', 3, 'text', { placeholder: '{Address}' }),
        f('architect', 'E', 4, 'text', { placeholder: 'Architect Firm' }),
        f('mechanicalEngineer', 'E', 5, 'text', { placeholder: 'Mechanical Eng.' }),
        f('electricalEngineer', 'E', 6, 'text', { placeholder: 'Electrical Eng.' }),
        f('generalContractor', 'E', 7, 'text', { placeholder: 'General Con.' }),
        f('mechanicalContractor', 'E', 8, 'text', { placeholder: 'Mechanical Con.' }),
        f('tabDate', 'E', 11, 'date', { placeholder: 46132 /* 2026-04-20 sample date */ }),
        f('technicians', 'E', 12, 'text', { placeholder: 'TBD' }),
        f('projectManager', 'E', 13, 'text', { placeholder: 'TBD' }),
        f('reportDate', 'E', 14, 'date'),
      ],
      tables: [
        {
          key: 'blueprints',
          segments: [{ row: 17, count: 9 }],
          // E17:E25 have a General (text) style in the template, so revision dates are written as text.
          columns: [c('sheet', 'B', 'text'), c('revisionDate', 'E', 'date')],
        },
      ],
    },
    { key: 'narrative', sheet: 'Narrative', fields: [f('text', 'C', 12, 'text')] },
    {
      key: 'issuesNew',
      sheet: 'Summary - New',
      tables: [{
        key: 'issues',
        segments: [{ row: 13, count: 50 }],
        columns: [c('no', 'B', 'number'), c('remark', 'C', 'text'), c('status', 'J', 'list', { values: ['Open', 'Closed'] }),
          c('comments', 'K', 'text')],
      }],
    },
    {
      key: 'issuesExisting',
      sheet: 'Summary - (E)',
      tables: [{
        key: 'issues',
        segments: [{ row: 13, count: 50 }],
        columns: [c('no', 'B', 'number'), c('remark', 'C', 'text'), c('status', 'J', 'list', { values: ['Open', 'Closed'] }),
          c('comments', 'K', 'text')],
      }],
    },
    {
      key: 'calibration',
      sheet: 'Calibration',
      tables: [{
        key: 'instruments',
        // 8 slots of 3-row merges; the export REPLACES the list (unused slots, incl. the 7 pre-loaded a2b
        // instruments, are cleared). The app pre-loads those instruments into new projects instead.
        segments: [{ row: 13, count: 8, stride: 3 }],
        columns: [c('type', 'B', 'text'), c('manufacturer', 'E', 'text'), c('model', 'G', 'text'),
          c('serial', 'J', 'text'), c('calibrationDate', 'L', 'date')],
      }],
    },
    {
      key: 'buildingBalance',
      sheet: 'Building Balance',
      tables: [{
        key: 'pressures',
        segments: [{ row: 97, count: 3 }],
        columns: [c('testSpace', 'B', 'text'), c('referenceSpace', 'E', 'text'), c('dp', 'H', 'number'), c('remarks', 'K', 'text')],
      }],
      lines: [{ key: 'notes', cells: [{ col: 'B', row: 102 }, { col: 'B', row: 103 }, { col: 'B', row: 104 }] }],
    },
    { key: 'equipmentSummary', sheet: 'Equipment Summary', fields: [f('tolerance', 'E', 5, 'number')] },
  ],

  equipment: [
    // ------------------------------------------------------------------------------ RTUs
    {
      key: 'rtu', label: 'RTU / AHU / DOAS', capacity: 40,
      ede: { sheet: EDE, firstRow: 7, sampleDesignation: 'RTU-1', fields: EDE_UNIT_FIELDS },
      block: {
        sheet: 'RTUs',
        anchor: { kind: 'linear', first: 4, stride: 104 },
        fields: unitDataFields('RTU', true),
        tables: [
          { key: 'supply', columns: OUTLET_COLUMNS, segments: [{ row: 29, count: 10 }, { row: Q + 4, count: 38 }] },
          // First return row: Design CFM (H) and Final CFM (L) are formulas (Total - OA).
          { key: 'return', columns: OUTLET_COLUMNS, segments: [{ row: 42, count: 2, omit: { 0: ['H'] } }, { row: Q + 45, count: 4 }] },
          { key: 'oa', columns: OUTLET_COLUMNS, segments: [{ row: 47, count: 1 }] },
        ],
        lines: [{
          key: 'remarks',
          cells: [{ col: 'D', row: 48 }, { col: 'B', row: 49 }, { col: 'B', row: 50 }, { col: 'D', row: Q + 50 }, { col: 'B', row: Q + 51 }],
        }],
      },
    },
    // ------------------------------------------------------------------------------ MAUs
    {
      key: 'mau', label: 'MAU / supply fan', capacity: 10,
      ede: { sheet: EDE, firstRow: 52, sampleDesignation: 'MUA-1', fields: EDE_UNIT_FIELDS },
      block: {
        sheet: 'MAUs',
        anchor: { kind: 'linear', first: 4, stride: 104 },
        fields: [
          ...unitDataFields('MAU', false),
          f('pspLength', 'D', Q + 3, 'number'),
          f('pspWidth', 'G', Q + 3, 'list', { list: 'PSP.Width' }),
          f('pspBlanks', 'J', Q + 3, 'number'),
          f('profileHousing', 'D', Q + 15, 'number'),
          f('profilePressure', 'H', Q + 15, 'number'),
          f('method', 'E', Q + 18, 'list', { list: 'Airflow.Method' }),
          f('designCfmOverride', 'K', Q + 18, 'number'),
          f('methodRemarks', 'K', Q + 19, 'text'),
        ],
        sequences: [{ key: 'pspVelocities', type: 'number', row: Q + 4, rows: 2, cols: cols('D', 'M'), order: 'rowMajor' }],
        columnTables: [{
          key: 'filterGrid', cols: cols('C', 'M'),
          fields: [{ key: 'size', row: Q + 9, type: 'list', list: 'Hood.FilterSize' }, { key: 'velocity', row: Q + 10, type: 'number' }],
        }],
        tables: [{ key: 'supply', columns: OUTLET_COLUMNS, segments: [{ row: 29, count: 16 }, { row: Q + 25, count: 22 }] }],
        lines: [{
          key: 'remarks',
          cells: [{ col: 'D', row: 47 }, { col: 'B', row: 48 }, { col: 'B', row: 49 }, { col: 'B', row: 50 },
            { col: 'D', row: Q + 49 }, { col: 'B', row: Q + 50 }],
        }],
      },
    },
    // ------------------------------------------------------------------------------ ERVs
    {
      key: 'erv', label: 'ERV / heat recovery', capacity: 10,
      ede: {
        sheet: EDE, firstRow: 65, sampleDesignation: 'ERV-1',
        fields: [
          ...EDE_UNIT_FIELDS.filter((x) => x.col < 'P'),
          { key: 'designSupplyCfm', col: 'P', type: 'number' }, { key: 'designExhaustCfm', col: 'Q', type: 'number' },
          { key: 'designSupplyDp', col: 'R', type: 'number' }, { key: 'designExhaustDp', col: 'S', type: 'number' },
        ],
      },
      block: {
        sheet: 'ERVs',
        anchor: { kind: 'linear', first: 4, stride: 104 },
        fields: [
          ...unitDataFields('ERV', false),
          f('supplyDpActual', 'L', 7, 'number'), f('exhaustDpActual', 'L', 8, 'number'),
          f('exhaustInstrument', 'D', 36, 'list', { list: 'Airflow.Instrument' }), f('exhaustAkNotes', 'I', 36, 'text'),
        ],
        tables: [
          { key: 'supply', columns: OUTLET_COLUMNS, segments: [{ row: 29, count: 6 }, { row: Q + 4, count: 18 }] },
          { key: 'exhaust', columns: OUTLET_COLUMNS, segments: [{ row: 39, count: 6 }, { row: Q + 26, count: 18 }] },
        ],
        lines: [{
          key: 'remarks',
          cells: [{ col: 'D', row: 47 }, { col: 'B', row: 48 }, { col: 'B', row: 49 }, { col: 'D', row: Q + 46 }, { col: 'B', row: Q + 47 }],
        }],
      },
    },
    // ------------------------------------------------------------------------------ Fans
    {
      key: 'fan', label: 'Exhaust / transfer / kitchen exhaust fan', capacity: 40,
      ede: { sheet: EDE, firstRow: 81, sampleDesignation: 'EF-1', fields: EDE_UNIT_FIELDS },
      block: {
        sheet: 'Fans',
        anchor: { kind: 'linear', first: 4, stride: 104 },
        fields: unitDataFields('EF', false),
        tables: [{ key: 'outlets', columns: OUTLET_COLUMNS, segments: [{ row: 29, count: 16 }, { row: Q + 4, count: 40 }] }],
        lines: [{
          key: 'remarks',
          cells: [{ col: 'D', row: 47 }, { col: 'B', row: 48 }, { col: 'B', row: 49 }, { col: 'B', row: 50 },
            { col: 'D', row: Q + 46 }, { col: 'B', row: Q + 47 }, { col: 'B', row: Q + 48 }, { col: 'B', row: Q + 49 }],
        }],
      },
    },
    // ------------------------------------------------------------------------------ Small fans
    {
      key: 'smallFan', label: 'Small exhaust fan (< 1/6 hp)', capacity: 40,
      ede: {
        sheet: EDE, firstRow: 233, sampleDesignation: 'EF-S1',
        fields: [
          { key: 'designation', col: 'B', type: 'text' }, { key: 'areaServed', col: 'C', type: 'text' },
          { key: 'location', col: 'D', type: 'text' }, { key: 'manufacturer', col: 'E', type: 'text' },
          { key: 'model', col: 'F', type: 'text' }, { key: 'hp', col: 'G', type: 'number' },
          { key: 'voltage', col: 'H', type: 'number' }, { key: 'phase', col: 'I', type: 'list', values: ['1-phase', '3-phase'] },
          { key: 'designCfm', col: 'J', type: 'number' },
        ],
      },
      block: {
        sheet: 'Small Fans',
        anchor: { kind: 'linear', first: 4, stride: 24 },
        fields: [
          f('serial', 'D', 5, 'text'), f('espDesign', 'K', 5, 'number'), f('espActual', 'L', 5, 'number'),
          f('fanRpmDesign', 'K', 6, 'number'), f('fanRpmActual', 'L', 6, 'number'),
          f('speedDesign', 'K', 7, 'text'), f('speedActual', 'L', 7, 'text'),
          f('amps', 'K', 8, 'number'),
          f('instrument', 'D', 9, 'list', { list: 'Airflow.Instrument' }), f('finalSettings', 'K', 9, 'text'),
        ],
        tables: [{ key: 'outlets', columns: OUTLET_COLUMNS, segments: [{ row: 12, count: 6 }] }],
        lines: [{ key: 'remarks', cells: [{ col: 'D', row: 19 }, { col: 'B', row: 20 }] }],
      },
    },
    // ------------------------------------------------------------------------------ VAVs
    {
      key: 'vav', label: 'VAV / fan-powered terminal', capacity: 80,
      ede: {
        sheet: EDE, firstRow: 150, sampleDesignation: 'VAV-1',
        fields: [
          { key: 'designation', col: 'B', type: 'text' }, { key: 'areaServed', col: 'C', type: 'text' },
          { key: 'location', col: 'D', type: 'text' }, { key: 'manufacturer', col: 'E', type: 'text' },
          { key: 'model', col: 'F', type: 'text' }, { key: 'inletSize', col: 'G', type: 'number' },
          { key: 'terminalType', col: 'H', type: 'text' }, { key: 'designMaxCfm', col: 'I', type: 'number' },
          { key: 'designMinCfm', col: 'J', type: 'number' }, { key: 'heatingCfm', col: 'K', type: 'number' },
          { key: 'fanCfm', col: 'L', type: 'number' }, { key: 'ddcAddress', col: 'M', type: 'text' },
        ],
      },
      block: {
        sheet: 'VAVs',
        anchor: { kind: 'linear', first: 4, stride: 26 },
        fields: [
          f('instrument', 'L', 2, 'list', { list: 'Airflow.Instrument' }),
          f('serial', 'D', 6, 'text'), f('minCfmActual', 'M', 6, 'number'),
          f('fanCfmActual', 'M', 7, 'number'),
          f('calibrationFactor', 'L', 9, 'number'),
          f('ddcMaxMin', 'D', 10, 'text'), f('heatingCfmActual', 'M', 10, 'number'),
        ],
        tables: [{ key: 'outlets', columns: OUTLET_COLUMNS, segments: [{ row: 13, count: 6 }] }],
        lines: [{ key: 'remarks', cells: [{ col: 'D', row: 20 }, { col: 'B', row: 21 }] }],
      },
    },
    // ------------------------------------------------------------------------------ Hoods
    {
      key: 'hood', label: 'Kitchen hood', capacity: 20,
      ede: {
        sheet: EDE, firstRow: 126, sampleDesignation: 'H-1',
        fields: [
          { key: 'designation', col: 'B', type: 'text' }, { key: 'areaServed', col: 'C', type: 'text' },
          { key: 'location', col: 'D', type: 'text' }, { key: 'manufacturer', col: 'E', type: 'text' },
          { key: 'designCfm', col: 'F', type: 'number' }, { key: 'kefInterlock', col: 'G', type: 'text' },
          { key: 'model', col: 'H', type: 'text' }, { key: 'lengthFt', col: 'I', type: 'number' },
        ],
      },
      block: {
        sheet: 'Hoods',
        anchor: { kind: 'paged', first: 4, pageRows: 49, offsets: [0, 21] },
        fields: [
          f('associatedFan', 'E', 6, 'text'), f('serial', 'E', 11, 'text'), f('hoodType', 'E', 12, 'text'),
          f('filterManufacturer', 'E', 13, 'text'),
          f('filterType', 'E', 14, 'list', { list: 'Hood.FilterType' }),
          f('instrument', 'E', 15, 'list', { list: 'Hood.Instrument' }),
        ],
        tables: [{
          key: 'filters',
          segments: [{ row: 6, count: 14 }],
          // Every velocity goes into P-U (J/L are averages). VelGrid types: 1 reading (P / S).
          columns: [c('size', 'I', 'list', { list: 'Hood.FilterSize' }),
            c('init1', 'P', 'number'), c('init2', 'Q', 'number'), c('init3', 'R', 'number'),
            c('final1', 'S', 'number'), c('final2', 'T', 'number'), c('final3', 'U', 'number')],
        }],
        lines: [
          { key: 'technicianNotes', cells: [{ col: 'P', row: 1 }, { col: 'P', row: 2 }, { col: 'P', row: 3 }] },
          // One 5-line remark box per page (page start S: D S+43, B S+44 ... S+47), shared by the page's two hoods:
          // the first hood on the page gets lines 1-3, the second lines 4-5 (rows relative to each hood's anchor).
          { key: 'remarks', pagePosition: 0, cells: [{ col: 'D', row: 43 }, { col: 'B', row: 44 }, { col: 'B', row: 45 }] },
          { key: 'remarks', pagePosition: 1, cells: [{ col: 'B', row: 25 }, { col: 'B', row: 26 }] },
        ],
      },
    },
    // ------------------------------------------------------------------------------ Traverses
    {
      key: 'traverse', label: 'Duct traverse', capacity: 48,
      block: {
        sheet: 'Traverses',
        anchor: { kind: 'paged', first: 5, pageRows: 49, offsets: [0, 15, 30] },
        fields: [
          // B+2 is a typed label pre-filled "T-1" ... "T-48" in the template (not a formula)
          f('designation', 'B', 2, 'text', { slotPreset: 'T-{n}' }),
          f('areaServed', 'C', 2, 'text'), f('designCfm', 'I', 2, 'number'), f('initialVel', 'J', 2, 'number'),
          f('instrument', 'D', 3, 'list', { list: 'Traverse.Instrument' }),
          f('ductStatic', 'K', 3, 'number'), f('temperature', 'M', 3, 'number'),
          f('shape', 'D', 4, 'list', { list: 'Duct.Shape' }),
          f('width', 'G', 4, 'number'), f('height', 'I', 4, 'number'), f('liner', 'K', 4, 'number'),
        ],
        // Quick entry: reading k goes to column P + floor((k-1)/10), row T + 6 + ((k-1) mod 10). Never the grid.
        sequences: [{ key: 'readings', type: 'number', row: 6, rows: 10, cols: cols('P', 'W'), order: 'colMajor' }],
        // One 3-line remark box per page (page start S: D S+45, B S+46, B S+47), one line per traverse on the page.
        lines: [
          { key: 'remarks', pagePosition: 0, cells: [{ col: 'D', row: 45 }] },
          { key: 'remarks', pagePosition: 1, cells: [{ col: 'B', row: 31 }] },
          { key: 'remarks', pagePosition: 2, cells: [{ col: 'B', row: 17 }] },
        ],
      },
    },
  ],
};

/** Cells of a sequence in reading order (relative rows). */
export function sequenceCells(s: SequenceDef): { col: string; row: number }[] {
  const out: { col: string; row: number }[] = [];
  if (s.order === 'colMajor') {
    for (const col of s.cols) for (let r = 0; r < s.rows; r++) out.push({ col, row: s.row + r });
  } else {
    for (let r = 0; r < s.rows; r++) for (const col of s.cols) out.push({ col, row: s.row + r });
  }
  return out;
}

/** Absolute (relative to anchor) row of every row in a table, with the columns that must be skipped. */
export function tableRows(t: TableDef): { row: number; omit: readonly string[] }[] {
  const out: { row: number; omit: readonly string[] }[] = [];
  for (const seg of t.segments) {
    for (let i = 0; i < seg.count; i++) out.push({ row: seg.row + i * (seg.stride ?? 1), omit: seg.omit?.[i] ?? [] });
  }
  return out;
}

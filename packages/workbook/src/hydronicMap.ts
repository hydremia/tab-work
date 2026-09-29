/**
 * Template map for the a2b HYDRONIC TAB workbook, revision H01 (`H01 - a2b_Blank_Hydronic_Workbook 9-29-26.xlsm`,
 * built from the airside revision 05 by tools/build_hydronic.py; layout in docs/HYDRONIC_REQUIREMENTS.md §5).
 *
 * Same engine and shapes as the airside map (exportWorkbook / importWorkbook take it as `map`): the shared report
 * sections (project information, narrative, remarks, calibration, certification, cover photo, stamp / signature)
 * are the airside definitions, unchanged; the hydronic sheets are new.
 */
import {
  TEMPLATE_MAP,
  type ColumnDef,
  type EdeDef,
  type EquipmentDef,
  type FieldDef,
  type FieldType,
  type LinesDef,
  type SheetSection,
  type TemplateMap,
} from './templateMap.js';

export const HYDRONIC_REVISION = 'H01';
/** File name of the hydronic template (at the repository root). */
export const HYDRONIC_TEMPLATE_FILE_NAME = 'H01 - a2b_Blank_Hydronic_Workbook 9-29-26.xlsm';

const HDE = '{Hydronic Data Entry}';
const f = (key: string, col: string, row: number, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  key,
  col,
  row,
  type,
  ...extra,
});
const c = (key: string, col: string, type: FieldType, extra: Partial<ColumnDef> = {}): ColumnDef => ({
  key,
  col,
  type,
  ...extra,
});
/** The fan page's remark box: header row r (value in D), then two full lines. */
const remarks = (r: number): LinesDef => ({
  key: 'remarks',
  cells: [
    { col: 'D', row: r },
    { col: 'B', row: r + 1 },
    { col: 'B', row: r + 2 },
  ],
});

/** Airside sections the hydronic workbook shares (same sheets, same cells). */
const SHARED = ['projectInfo', 'narrative', 'issuesNew', 'issuesExisting', 'calibration', 'certification'];

export const PUMP_EDE: EdeDef = {
  sheet: HDE,
  firstRow: 7,
  sampleDesignation: 'P-1',
  fields: [
    { key: 'designation', col: 'B', type: 'text' },
    { key: 'service', col: 'C', type: 'text' },
    { key: 'system', col: 'D', type: 'text' },
    { key: 'location', col: 'E', type: 'text' },
    { key: 'manufacturer', col: 'F', type: 'text' },
    { key: 'model', col: 'G', type: 'text' },
    { key: 'designGpm', col: 'H', type: 'number' },
    { key: 'designHead', col: 'I', type: 'number' },
    { key: 'connectedLoadGpm', col: 'J', type: 'number' },
    { key: 'hp', col: 'K', type: 'number' },
    { key: 'rpm', col: 'L', type: 'number' },
    { key: 'impeller', col: 'M', type: 'number' },
    { key: 'voltage', col: 'N', type: 'number' },
    // the BHP formula (copied from the fan page) tests "1-phase"
    { key: 'phase', col: 'O', type: 'list', values: ['1-phase', '3-phase'] },
    { key: 'pumpType', col: 'P', type: 'list', list: 'Pump.Type' },
  ],
};

const PUMP: EquipmentDef = {
  key: 'pump',
  label: 'Pump',
  capacity: 20,
  ede: PUMP_EDE,
  block: {
    sheet: 'Pumps',
    // two per page: 26-row blocks from row 4 ("Pump" in B)
    anchor: { kind: 'linear', first: 4, stride: 26 },
    fields: [
      f('flowMethod', 'L', 2, 'list', { list: 'Flow.Method' }),
      f('serial', 'D', 6, 'text'),
      f('actualGpm', 'L', 5, 'number'),
      f('actualRpm', 'L', 7, 'number'),
      f('actualImpeller', 'L', 8, 'number'),
      f('motorManufacturer', 'D', 12, 'text'),
      f('motorRpm', 'F', 13, 'number'),
      f('serviceFactor', 'G', 13, 'list', { list: 'Service.Factors2', preset: 'SF', blankValues: ['SF'] }),
      f('fla', 'E', 14, 'number'),
      f('frame', 'G', 14, 'text'),
      f('volts1', 'E', 16, 'number'),
      f('volts2', 'F', 16, 'number'),
      f('volts3', 'G', 16, 'number'),
      f('amps1', 'E', 17, 'number'),
      f('amps2', 'F', 17, 'number'),
      f('amps3', 'G', 17, 'number'),
      f('vfd', 'E', 18, 'text'),
      f('finalSetpoints', 'E', 19, 'text'),
      // pump test, psi at the gauges (head in ft is a formula: (discharge - suction) x 2.31 / SG + elevation)
      f('standingPsi', 'K', 13, 'number'),
      f('shutoffSuction', 'K', 14, 'number'),
      f('shutoffDischarge', 'L', 14, 'number'),
      f('wideOpenSuction', 'K', 15, 'number'),
      f('wideOpenDischarge', 'L', 15, 'number'),
      f('finalSuction', 'K', 16, 'number'),
      f('finalDischarge', 'L', 16, 'number'),
      f('specificGravity', 'L', 17, 'number'),
      f('gaugeElevation', 'L', 18, 'number'),
      f('meterGpm', 'L', 19, 'number'),
    ],
    lines: [remarks(21)],
  },
};

const VALVE_SYSTEM: EquipmentDef = {
  // one Valves page = one system: its header and 38 valve rows
  key: 'valveSystem',
  label: 'Balancing valves (system page)',
  capacity: 25,
  block: {
    sheet: 'Valves',
    anchor: { kind: 'linear', first: 4, stride: 52 },
    fields: [
      f('system', 'D', 0, 'text'),
      f('service', 'I', 0, 'text'),
      f('pumps', 'D', 2, 'text'),
      f('instrument', 'H', 2, 'text'),
      f('dpUnits', 'M', 2, 'list', { list: 'DP.Units' }),
      f('method', 'D', 3, 'list', { list: 'Balance.Method' }),
      f('memoryStops', 'L', 3, 'list', { list: 'Yes.No' }),
    ],
    tables: [
      {
        key: 'valves',
        segments: [{ row: 6, count: 38 }],
        columns: [
          c('no', 'B', 'text'),
          c('tag', 'C', 'text'),
          c('serves', 'D', 'text'),
          c('makeModel', 'E', 'text'),
          c('size', 'F', 'text'),
          c('type', 'G', 'list', { list: 'Valve.Type' }),
          c('designGpm', 'H', 'number'),
          c('initialGpm', 'I', 'number'),
          c('setting', 'J', 'number'),
          c('dp', 'K', 'number'),
          c('finalGpm', 'L', 'number'),
          c('wideOpen', 'N', 'list', { list: 'Wide.Open' }),
        ],
      },
    ],
    lines: [remarks(47)],
  },
};

const PLANT_COLUMNS: readonly ColumnDef[] = [
  c('unit', 'B', 'text'),
  c('type', 'C', 'list', { list: 'Plant.Type' }),
  c('service', 'D', 'text'),
  c('manufacturer', 'E', 'text'),
  c('model', 'F', 'text'),
  c('serial', 'G', 'text'),
  c('circuit', 'H', 'list', { list: 'Circuit' }),
  c('designGpm', 'I', 'number'),
  c('designDp', 'J', 'number'),
  c('actualGpm', 'K', 'number'),
  c('actualDp', 'L', 'number'),
  c('method', 'N', 'list', { list: 'Flow.Method' }),
];

const HYDRONIC_SECTIONS: SheetSection[] = [
  {
    key: 'systemSummary',
    sheet: 'System Summary',
    tables: [
      {
        key: 'systems',
        segments: [{ row: 7, count: 30 }],
        columns: [
          c('system', 'B', 'text'),
          c('service', 'D', 'text'),
          c('pumps', 'E', 'text'),
          c('vfdSetpoint', 'M', 'text'),
        ],
      },
    ],
  },
  {
    key: 'plant',
    sheet: 'Plant Equipment',
    fields: [
      f('dpUnits', 'D', 5, 'list', { list: 'DP.Units' }),
      f('instrument', 'F', 5, 'text'),
      f('dpUnits2', 'D', 57, 'list', { list: 'DP.Units' }),
      f('instrument2', 'F', 57, 'text'),
    ],
    tables: [
      {
        key: 'circuits',
        segments: [
          { row: 8, count: 40 },
          { row: 60, count: 40 },
        ],
        columns: PLANT_COLUMNS,
      },
    ],
    lines: [
      {
        key: 'remarks',
        cells: [
          { col: 'D', row: 49 },
          { col: 'B', row: 50 },
          { col: 'B', row: 51 },
          { col: 'D', row: 101 },
          { col: 'B', row: 102 },
          { col: 'B', row: 103 },
        ],
      },
    ],
  },
  {
    key: 'flowMeasurements',
    sheet: 'Flow Measurements',
    fields: [f('instrument', 'D', 5, 'text')],
    tables: [
      {
        key: 'readings',
        segments: [{ row: 8, count: 24 }],
        columns: [
          c('no', 'B', 'text'),
          c('system', 'C', 'text'),
          c('location', 'D', 'text'),
          c('pipeSize', 'E', 'text'),
          c('pipeMaterial', 'F', 'text'),
          c('wallThickness', 'G', 'number'),
          c('transducer', 'H', 'text'),
          c('configuration', 'I', 'text'),
          c('spacing', 'J', 'text'),
          c('designGpm', 'K', 'number'),
          c('measuredGpm', 'L', 'number'),
          c('notes', 'N', 'text'),
        ],
      },
    ],
    lines: [remarks(33)],
  },
];

export const HYDRONIC_MAP: TemplateMap = {
  revision: HYDRONIC_REVISION,
  coverPhoto: TEMPLATE_MAP.coverPhoto,
  certImages: TEMPLATE_MAP.certImages,
  sections: [...TEMPLATE_MAP.sections.filter((s) => SHARED.includes(s.key)), ...HYDRONIC_SECTIONS],
  equipment: [PUMP, VALVE_SYSTEM],
};

/** Dropdown lists added to {Dropdowns} for the hydronic sheets (`lists.test.ts` checks them against the template). */
export const HYDRONIC_LISTS = {
  'Pump.Type': ['Constant speed', 'VFD', 'Integrated variable speed'],
  'Flow.Method': ['Calibrated valve', 'Flow meter', 'Pump curve', 'Equipment ΔP', 'Ultrasonic', 'Heat transfer'],
  'DP.Units': ['psi', 'ft w.g.'],
  'Valve.Type': ['F', 'A', 'S'],
  'Balance.Method': ['Proportional', 'Stepwise', 'Other'],
  'Yes.No': ['Yes', 'No', 'N/A'],
  'Plant.Type': [
    'Chiller (water-cooled)',
    'Chiller (air-cooled)',
    'Cooling tower',
    'Hot-water boiler',
    'Heat exchanger (water-water)',
    'Heat exchanger (steam-water)',
  ],
  Circuit: ['Evaporator', 'Condenser', 'Primary', 'Secondary', 'Water'],
  'Wide.Open': ['✓'],
} as const;

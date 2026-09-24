/**
 * Dropdown lists of the revision 05 template ({Dropdowns} named ranges), for building forms without opening
 * the template. The exporter still validates against the template's own lists; `lists.test.ts` checks that
 * these copies match the template.
 */
export const TEMPLATE_LISTS = {
  'Drive.Type': ['Belt', 'Direct', 'ECM'],
  'Unit.Type': ['RTU', 'DOAS', 'MAU', 'ERV', 'EF'],
  /** First entry "SF" is the column header / placeholder, not a value. */
  'Service.Factors2': ['SF 1.0', 'SF 1.15', 'SF 1.25', 'SF 1.35', 'SF 1.5'],
  'Airflow.Instrument': [
    'Flow Hood',
    'Velocity Grid',
    'Pitot Traverse',
    'Hot Wire Anemometer',
    'Rotating Vane Anemometer',
    'DDC / Controller Reading',
    'Other (see remarks)',
  ],
  'Traverse.Instrument': [
    'Manometer/Velocity Matrix',
    'Manometer/Pitot Tube',
    'Manometer/Airfoil',
    'Rotating Vane Anemometer',
    'Hot Wire Anemometer',
    'Other Velocity Meter',
    'Other Instrument',
  ],
  'Airflow.Method': ['Outlets', 'PSP', 'Filter Grid', 'Profile Pressure'],
  'PSP.Width': [6, 9, 10, 12, 14, 16, 18, 20, 24],
  'Duct.Shape': ['Rectangular', 'Round'],
  'Hood.FilterType': [
    'Baffle (VelGrid)',
    'Captrate (VelGrid)',
    'Condensate Baffle (Airfoil)',
    'HVC / Slot (Airfoil)',
    'Supply Filter (VelGrid)',
  ],
  'Hood.Instrument': ['Evergreen VelGrid', 'Evergreen Airfoil', 'Other (see remarks)'],
  /** Stored exactly as these strings (the constants table is keyed by "type|size"). */
  'Hood.FilterSize': [
    'No Filter',
    '10" x 16"',
    '10" x 20"',
    '12" x 12"',
    '12" x 16"',
    '12" x 20"',
    '12" x 24"',
    '16" x 16"',
    '16" x 20"',
    '16" x 25"',
    '20" x 20"',
    '20" x 25"',
    '24" x 24"',
    '20" x 16"',
    '16" Wide',
    '20" Wide',
  ],
} as const satisfies Record<string, readonly (string | number)[]>;

export const PHASES = ['1-phase', '3-phase'] as const;

/**
 * Static pressure profile components 1-5 by unit type ({Dropdowns} unit-type table). null = "—" (component
 * greyed out on the sheet; the app treats its leaving static as automatically N/A).
 */
export const UNIT_TYPE_COMPONENTS: Record<string, readonly (string | null)[]> = {
  RTU: ['Filter', null, 'Coil', 'Heat', 'Fan'],
  DOAS: ['Filter', 'Wheel', 'Coil', 'Heat', 'Fan'],
  MAU: ['Filter', null, 'Burner', null, 'Fan'],
  ERV: ['Filter', 'Core', null, null, 'Fan'],
  EF: [null, null, null, null, 'Fan'],
};

/** Inlet label of the static-profile strip by unit type ({Dropdowns} AI2:AI6, first column of the table). */
export const UNIT_TYPE_INLETS: Record<string, string> = {
  RTU: 'RA / OA',
  DOAS: 'OA',
  MAU: 'OA',
  ERV: 'OA / EA',
  EF: 'Inlet',
};

/** The 7 a2b instruments pre-loaded on the template's Calibration sheet (pre-loaded into new projects). */
export const DEFAULT_INSTRUMENTS = [
  {
    type: 'Balometer',
    manufacturer: 'Evergreen Telemetry',
    model: 'Three Pounder',
    serial: '2400180B',
    calibrationDate: '2024-03-14',
  },
  {
    type: 'Digital Micromanometer',
    manufacturer: 'Evergreen Telemetry',
    model: 'S-PVF-1',
    serial: '1700164',
    calibrationDate: '2025-11-21',
  },
  {
    type: 'Laser Tachometer',
    manufacturer: 'Extech',
    model: '461920',
    serial: '230222432',
    calibrationDate: '2025-10-21',
  },
  {
    type: 'Voltage/Amperage Multimeter',
    manufacturer: 'Fluke',
    model: '902FC',
    serial: '669100839MV',
    calibrationDate: '2025-12-11',
  },
  {
    type: 'Digital Temperature Tester',
    manufacturer: 'Fluke',
    model: '52 Series II',
    serial: '32310370WS',
    calibrationDate: '2025-10-27',
  },
  {
    type: 'Humidity Tester',
    manufacturer: 'Fluke',
    model: '971 Temperature / Humidity Tester',
    serial: '54081271',
    calibrationDate: '2025-01-31',
  },
  {
    type: 'Hydronic Pressure Measurement',
    manufacturer: 'Evergreen Telemetry',
    model: 'S-DP-250',
    serial: '2400187B',
    calibrationDate: '2025-11-20',
  },
] as const;

/**
 * CaptiveAire / Evergreen filter constants ({Dropdowns} H2:K50, key "type|size"): free area (ft²) and K-factor.
 * CFM per filter = velocity x free area x K. A pair that is not in this table gives 0 CFM in the workbook.
 * Note: the template's row 45 key cell holds the source note instead of "Supply Filter (VelGrid)|24" x 24"", so
 * that pair has no constants in revision 05 (it is left out here, and the app does not offer it).
 */
export interface FilterConstant {
  type: string;
  size: string;
  area: number;
  k: number;
}
const FC = (type: string, size: string, area: number, k: number): FilterConstant => ({ type, size, area, k });
export const FILTER_CONSTANTS: readonly FilterConstant[] = [
  FC('Baffle (VelGrid)', '10" x 16"', 0.78, 1.28),
  FC('Captrate (VelGrid)', '10" x 16"', 0.78, 1.34),
  FC('Baffle (VelGrid)', '10" x 20"', 0.99, 1.28),
  FC('Captrate (VelGrid)', '10" x 20"', 0.99, 1.34),
  FC('Baffle (VelGrid)', '12" x 12"', 0.69, 1.28),
  FC('Captrate (VelGrid)', '12" x 12"', 0.69, 1.34),
  FC('Baffle (VelGrid)', '12" x 16"', 0.97, 1.28),
  FC('Captrate (VelGrid)', '12" x 16"', 0.97, 1.34),
  FC('Baffle (VelGrid)', '12" x 20"', 1.25, 1.28),
  FC('Captrate (VelGrid)', '12" x 20"', 1.25, 1.34),
  FC('Baffle (VelGrid)', '12" x 24"', 1.52, 1.28),
  FC('Captrate (VelGrid)', '12" x 24"', 1.52, 1.34),
  FC('Baffle (VelGrid)', '16" x 16"', 1.35, 1.28),
  FC('Captrate (VelGrid)', '16" x 16"', 1.35, 1.34),
  FC('Baffle (VelGrid)', '16" x 20"', 1.73, 1.28),
  FC('Captrate (VelGrid)', '16" x 20"', 1.73, 1.34),
  FC('Baffle (VelGrid)', '16" x 25"', 2.22, 1.28),
  FC('Captrate (VelGrid)', '16" x 25"', 2.22, 1.34),
  FC('Baffle (VelGrid)', '20" x 20"', 2.23, 1.28),
  FC('Captrate (VelGrid)', '20" x 20"', 2.23, 1.34),
  FC('Baffle (VelGrid)', '20" x 25"', 2.85, 1.28),
  FC('Captrate (VelGrid)', '20" x 25"', 2.85, 1.34),
  FC('Baffle (VelGrid)', '24" x 24"', 3.36, 1.28),
  FC('Captrate (VelGrid)', '24" x 24"', 3.36, 1.34),
  FC('Condensate Baffle (Airfoil)', '10" x 16"', 0.131, 1),
  FC('Condensate Baffle (Airfoil)', '10" x 20"', 0.196, 1),
  FC('Condensate Baffle (Airfoil)', '12" x 16"', 0.131, 1),
  FC('Condensate Baffle (Airfoil)', '12" x 20"', 0.196, 1),
  FC('Condensate Baffle (Airfoil)', '16" x 16"', 0.131, 1),
  FC('Condensate Baffle (Airfoil)', '16" x 20"', 0.196, 1),
  FC('Condensate Baffle (Airfoil)', '20" x 16"', 0.262, 1),
  FC('Condensate Baffle (Airfoil)', '20" x 20"', 0.349, 1),
  FC('HVC / Slot (Airfoil)', '16" Wide', 0.2402, 1),
  FC('HVC / Slot (Airfoil)', '20" Wide', 0.3027, 1),
  FC('Supply Filter (VelGrid)', '12" x 12"', 0.69, 1.35),
  FC('Supply Filter (VelGrid)', '12" x 16"', 0.97, 1.35),
  FC('Supply Filter (VelGrid)', '12" x 20"', 1.25, 1.35),
  FC('Supply Filter (VelGrid)', '12" x 24"', 1.52, 1.35),
  FC('Supply Filter (VelGrid)', '16" x 16"', 1.36, 1.35),
  FC('Supply Filter (VelGrid)', '16" x 20"', 1.75, 1.35),
  FC('Supply Filter (VelGrid)', '16" x 25"', 2.24, 1.35),
  FC('Supply Filter (VelGrid)', '20" x 20"', 2.25, 1.35),
  FC('Supply Filter (VelGrid)', '20" x 25"', 2.88, 1.35),
  FC('Baffle (VelGrid)', 'No Filter', 0, 0),
  FC('Captrate (VelGrid)', 'No Filter', 0, 0),
  FC('Condensate Baffle (Airfoil)', 'No Filter', 0, 0),
  FC('HVC / Slot (Airfoil)', 'No Filter', 0, 0),
  FC('Supply Filter (VelGrid)', 'No Filter', 0, 0),
];

/** The filter type the MAU filter grid always uses (the grid formulas look up "Supply Filter (VelGrid)|size"). */
export const MAU_FILTER_GRID_TYPE = 'Supply Filter (VelGrid)';

/** Filter sizes that have constants for a filter type, in Hood.FilterSize list order ("No Filter" first). */
export function filterSizesFor(type: string): string[] {
  const have = new Set(FILTER_CONSTANTS.filter((c) => c.type === type).map((c) => c.size));
  return TEMPLATE_LISTS['Hood.FilterSize'].filter((s) => have.has(s));
}

/** PSP K-factor by plenum width in inches ({Dropdowns} R2:S10): 6-12" = 0.88, 14-24" = 0.95. */
export const PSP_K: readonly (readonly [width: number, k: number])[] = [
  [6, 0.88],
  [9, 0.88],
  [10, 0.88],
  [12, 0.88],
  [14, 0.95],
  [16, 0.95],
  [18, 0.95],
  [20, 0.95],
  [24, 0.95],
];

/**
 * Direct-fired burner profile pressure curve ({Dropdowns} U2:Z12, restored in revision 05): CFM by profile
 * pressure (in. w.g.) for housing sizes 1-5. The workbook interpolates linearly between the 0.05 steps.
 */
export const PROFILE_CURVE = {
  pressures: [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65],
  /** cfm[housing - 1][pressure index] */
  cfm: [
    [697.15, 805.62, 1166.76, 1779.53, 2036.25, 2291.85, 2450.196, 2655.768, 2797.446, 2958.57, 3139.14],
    [2035.5, 2400, 2718.6, 3000, 3346.5, 4000, 5209.5, 5600, 5778.75, 6300, 6589.5],
    [1740.9, 1908.9, 2289, 4036.2, 4676.7, 4845, 4979.1, 5159.7, 6913.2, 7919.1, 8820],
    [3037.188, 3537.504, 3931.944, 4444.716, 4795.56, 6439.752, 6769.836, 6873.636, 7500, 13562.508, 16000],
    [4212.45, 9500, 12730.5, 15000, 17008.5, 19200, 20976, 21800, 22287, 23500, 24598.5],
  ],
} as const;

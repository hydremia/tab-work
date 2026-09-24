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

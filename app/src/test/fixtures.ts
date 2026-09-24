/** A small but complete sample project (RTU, VAV, a fan, issues) for adapter and round-trip tests. */
import { emptyNaState, type AirflowRow, type Equipment, type Issue, type NaState, type Project } from '../data/types';
import type { ProjectBundle } from '../workbook/adapter';

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const now = 1_790_000_000_000;

export function sampleBundle(): ProjectBundle {
  n = 0;
  const project: Project = {
    id: id(),
    name: 'Riverside Medical Office',
    scopeProfile: 'full',
    customScope: {},
    tolerance: 0.1,
    reportKind: 'prelim',
    info: {
      address: '1450 Riverside Dr, Sacramento, CA',
      architect: 'Lionakis',
      mechanicalEngineer: 'Capital Engineering',
      mechanicalContractor: 'Air Systems <North> Inc.',
      tabDate: '2026-09-15',
      technicians: 'J. Alvarez, M. Chen',
      projectManager: 'R. Singh',
      reportDate: '2026-09-23',
      narrative: 'Three RTUs and VAVs.\nAll balanced within ±10 %.',
      bbBuildingDp: 0.03,
      bbBuildingRemarks: 'Doors closed, all units running',
      bbKitchenDp: -0.02,
      bbSpareTest: 'Suite 101',
      bbSpareRef: 'Corridor',
      bbSpareDp: 0.01,
      bbNotes: 'Measured at 2 pm.\nWind calm.',
    },
    blueprints: [{ sheet: 'M-101 Floor plan', revisionDate: '2026-06-12' }],
    naState: { sections: {}, fields: { electricalEngineer: { notation: 'N/A' } } },
    templateRevision: '05',
    createdAt: now,
    updatedAt: now,
  };
  const eq = (
    type: Equipment['type'],
    designation: string,
    slot: number,
    data: Equipment['data'],
    na = emptyNaState(),
  ): Equipment => ({
    id: id(),
    projectId: project.id,
    type,
    designation,
    slot,
    isExisting: false,
    data,
    naState: na,
    createdAt: now,
    updatedAt: now,
  });
  const rtu = eq(
    'rtu',
    'RTU-1',
    1,
    {
      areaServed: 'Lobby',
      location: 'Roof',
      manufacturer: 'Carrier',
      model: '48FC',
      hp: 3,
      unitEsp: 0.8,
      fanRpm: 1100,
      voltage: 460,
      phase: '3-phase',
      designTotalCfm: 1000,
      designOaCfm: 200,
      unitType: 'RTU',
      serial: '4719G',
      motorManufacturer: 'WEG',
      motorRpm: 1725,
      serviceFactor: 'SF 1.15',
      fla: 4.8,
      frame: '182T',
      volts1: 468,
      volts2: 465,
      volts3: 470,
      amps1: 3.9,
      amps2: 4.1,
      amps3: 4,
      driveType: 'Belt',
      motorSheave: '1VP44',
      fanPulley: 'AK74',
      belts: 'A42',
      cToC: '14 1/4',
      sheaveBore: '7/8 / 1',
      rotationDesign: 'CW',
      rotationActual: 'CW',
      hasFilters: 'Yes',
      filters: '2" pleated 16x20 x 4',
      finalSettings: 'Sheave 2.5 turns open',
      motorRpmFinal: 1742,
      fanRpmFinal: 1105,
      hasVfd: 'No',
      oaDamper: '35 % open',
      spEntering: -0.35,
      spLeaving1: -0.55,
      spLeaving3: -0.95,
      spLeaving4: -1.05,
      spLeaving5: 0.72,
      instrument: 'Flow Hood',
      remarks: 'Belt replaced.\nSecond remark line.',
    },
    { sections: {}, fields: { fla: { notation: 'Not Avail.' } } },
  );
  delete rtu.data.fla; // FLA marked Not Avail. instead
  const vav = eq('vav', 'VAV-101', 1, {
    areaServed: 'Suite 101',
    location: 'Ceiling',
    manufacturer: 'Titus',
    model: 'DESV',
    inletSize: 8,
    terminalType: 'Pressure Independent',
    designMaxCfm: 400,
    designMinCfm: 150,
    ddcAddress: 'AV-101',
    serial: 'T-7788',
    calibrationFactor: 1.02,
    ddcMaxMin: '400 / 150',
    minCfmActual: 155,
    instrument: 'Flow Hood',
  });
  const fan = eq('fan', 'EF-1', 3, { areaServed: 'Restrooms', unitType: 'EF' });
  const row = (
    e: Equipment,
    table: string,
    order: number,
    data: AirflowRow['data'],
    na: AirflowRow['na'] = {},
  ): AirflowRow => ({
    id: id(),
    projectId: project.id,
    equipmentId: e.id,
    table,
    order,
    data,
    na,
    createdAt: now,
    updatedAt: now,
  });
  const rows = [
    row(rtu, 'supply', 1, {
      no: 'S-1',
      area: 'Lobby',
      type: 'CD',
      size: '24x24',
      ak: 1,
      designCfm: 500,
      initialVel: 480,
      finalVel: 505,
    }),
    row(rtu, 'supply', 2, {
      no: 'S-2',
      area: 'Lobby',
      type: 'CD',
      size: '24x24',
      ak: 1,
      designCfm: 500,
      finalVel: 470,
    }),
    row(
      rtu,
      'oa',
      1,
      { no: 'OA-1', area: 'Hood', type: 'OA', size: '36x18', ak: 4.5, designCfm: 200 },
      { finalVel: { notation: 'Not Acc.' } },
    ),
    row(vav, 'outlets', 1, {
      no: '1',
      area: 'Suite 101',
      type: 'CD',
      size: '12x12',
      ak: 1,
      designCfm: 200,
      finalVel: 195,
    }),
    row(vav, 'outlets', 2, {
      no: '2',
      area: 'Suite 101',
      type: 'CD',
      size: '12x12',
      ak: 1,
      designCfm: 200,
      finalVel: 210,
    }),
  ];
  const issue = (
    kind: Issue['kind'],
    number: number,
    remark: string,
    equipmentId: string | null,
    status: Issue['status'] = 'Open',
  ): Issue => ({
    id: id(),
    projectId: project.id,
    kind,
    number,
    remark,
    status,
    comments: '',
    equipmentId,
    createdAt: now,
    updatedAt: now,
  });
  const issues = [
    issue('new', 1, 'belt worn; replaced during TAB.', rtu.id, 'Closed'),
    issue('new', 2, 'Ceiling access blocked at corridor.', null),
    issue('existing', 1, 'damper actuator seized.', vav.id),
  ];
  const instruments = [
    {
      id: id(),
      projectId: project.id,
      order: 0,
      type: 'Balometer',
      manufacturer: 'Evergreen Telemetry',
      model: 'Three Pounder',
      serial: '2400180B',
      calibrationDate: '2026-03-14',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const extra = moreUnits(project.id, eq, row);
  return {
    project,
    equipment: [rtu, vav, fan, ...extra.equipment],
    rows: [...rows, ...extra.rows],
    issues,
    instruments,
  };
}

/** Motor / drive / RPM / static data every big unit sheet shares (direct drive, no VFD, filters). */
const unitCommon = (unitType: string): Equipment['data'] => ({
  unitType,
  serial: `SN-${unitType}`,
  motorManufacturer: 'Baldor',
  motorRpm: 1750,
  serviceFactor: 'SF 1.15',
  fla: 6.2,
  frame: '184T',
  volts1: 207,
  volts2: 209,
  volts3: 208,
  amps1: 5.1,
  amps2: 5.3,
  amps3: 5.2,
  driveType: 'Direct',
  rotationDesign: 'CW',
  rotationActual: 'CW',
  hasFilters: 'Yes',
  filters: '2" pleated 20x20 x 6',
  finalSettings: 'ECM dial 7',
  motorRpmFinal: 1748,
  fanRpmFinal: 1748,
  hasVfd: 'No',
  spEntering: -0.2,
  spLeaving1: -0.35,
  spLeaving2: -0.5,
  spLeaving3: -0.6,
  spLeaving5: 0.55,
});

type Eq = (
  type: Equipment['type'],
  designation: string,
  slot: number,
  data: Equipment['data'],
  na?: NaState,
) => Equipment;
type Row = (e: Equipment, table: string, order: number, data: AirflowRow['data'], na?: AirflowRow['na']) => AirflowRow;
const outlet = (no: string, designCfm: number, finalVel: number, ak = 1): AirflowRow['data'] => ({
  no,
  area: 'Area',
  type: 'CD',
  size: '24x24',
  ak,
  designCfm,
  finalVel,
});
const seq = (key: string, vals: readonly number[]) =>
  Object.fromEntries(vals.map((v, i) => [`${key}_${i + 1}`, v])) as Equipment['data'];
const sched = (manufacturer: string, extra: Equipment['data'] = {}): Equipment['data'] => ({
  manufacturer,
  model: 'M-1',
  hp: 2,
  fanRpm: 1750,
  voltage: 208,
  phase: '3-phase',
  ...extra,
});

/** One fully filled unit of every other type, with N/A cases (explicit, automatic, per reading, per table). */
function moreUnits(_projectId: string, eq: Eq, row: Row): { equipment: Equipment[]; rows: AirflowRow[] } {
  const rows: AirflowRow[] = [];
  // MAU-1: PSP (one reading Not Acc.), design CFM override
  const psp = [300, 305, 310, 295, 290, 300, 315, 305, 298, 302, 296, 304, 310, 300, 292, 308, 301, 299, 303, 297];
  const mau1 = eq(
    'mau',
    'MAU-1',
    1,
    {
      areaServed: 'Kitchen',
      location: 'Roof',
      ...sched('CaptiveAire', { unitEsp: 0.6, designTotalCfm: 2100 }),
      ...unitCommon('MAU'),
      spLeaving2: null,
      spLeaving4: null,
      method: 'PSP',
      designCfmOverride: 2100,
      methodRemarks: 'Read with Evergreen VelGrid',
      pspLength: 96,
      pspWidth: 12,
      pspBlanks: 1,
      ...seq('pspVelocities', psp),
      pspVelocities_7: null,
      remarks: 'Burner tuned.',
    },
    { sections: {}, fields: { pspVelocities_7: { notation: 'Not Acc.' } } },
  );
  // MAU-2: filter grid (one velocity Not Avail.); MAU-3: profile pressure; MAU-4: outlets
  const mau2 = eq('mau', 'MAU-2', 2, {
    areaServed: 'Dining',
    location: 'Roof',
    ...sched('Greenheck', { unitEsp: 0.5, designTotalCfm: 1500 }),
    ...unitCommon('MAU'),
    spLeaving2: null,
    spLeaving4: null,
    method: 'Filter Grid',
    designCfmOverride: 1500,
  });
  rows.push(
    row(mau2, 'filterGrid', 1, { size: '16" x 20"', velocity: 400 }),
    row(mau2, 'filterGrid', 2, { size: '12" x 24"', velocity: 300 }),
    row(mau2, 'filterGrid', 3, { size: '16" x 20"' }, { velocity: { notation: 'Not Avail.' } }),
  );
  const mau3 = eq('mau', 'MAU-3', 3, {
    areaServed: 'Warehouse',
    location: 'Roof',
    ...sched('Reznor', { unitEsp: 0.4, designTotalCfm: 6500 }),
    ...unitCommon('MAU'),
    spLeaving2: null,
    spLeaving4: null,
    method: 'Profile Pressure',
    designCfmOverride: 6500,
    profileHousing: 2,
    profilePressure: 0.65,
  });
  const mau4 = eq('mau', 'MAU-4', 10, {
    areaServed: 'Lab',
    location: 'Roof',
    ...sched('Captive', { unitEsp: 0.5, designTotalCfm: 800 }),
    ...unitCommon('MAU'),
    spLeaving2: null,
    spLeaving4: null,
    method: 'Outlets',
    instrument: 'Flow Hood',
  });
  rows.push(row(mau4, 'supply', 1, outlet('S-1', 400, 390)), row(mau4, 'supply', 2, outlet('S-2', 400, 410)));

  // ERV-1: supply + exhaust tables, an exhaust inlet with Ak Not Avail., exhaust ΔP design N/A
  const erv = eq(
    'erv',
    'ERV-1',
    1,
    {
      areaServed: 'Offices',
      location: 'Mech room',
      ...sched('RenewAire', { designSupplyCfm: 1000, designExhaustCfm: 950, designSupplyDp: 0.35 }),
      ...unitCommon('ERV'),
      spLeaving3: null,
      spLeaving4: null,
      supplyDpActual: 0.33,
      exhaustDpActual: 0.41,
      instrument: 'Flow Hood',
      exhaustInstrument: 'Flow Hood',
    },
    { sections: {}, fields: { designExhaustDp: { notation: 'N/A' } } },
  );
  rows.push(
    row(erv, 'supply', 1, outlet('S-1', 500, 490)),
    row(erv, 'supply', 2, outlet('S-2', 500, 520)),
    row(erv, 'exhaust', 1, outlet('E-1', 500, 480)),
    row(erv, 'exhaust', 2, { ...outlet('E-2', 450, 460), ak: null }, { ak: { notation: 'Not Avail.' } }),
  );

  // EF-2: 1-phase (legs 2 and 3 automatically N/A), EF static profile (fan only)
  const fanData = {
    areaServed: 'Restrooms',
    location: 'Roof',
    ...sched('Greenheck', { unitEsp: 0.5, phase: '1-phase', voltage: 115, designTotalCfm: 600 }),
    ...unitCommon('EF'),
    volts2: null,
    volts3: null,
    amps2: null,
    amps3: null,
    spLeaving1: null,
    spLeaving2: null,
    spLeaving3: null,
    hasFilters: 'No',
    filters: null,
    instrument: 'Flow Hood',
  };
  const fan2 = eq('fan', 'EF-2', 1, fanData);
  rows.push(
    row(fan2, 'outlets', 1, outlet('E-1', 200, 330, 0.6)),
    row(fan2, 'outlets', 2, outlet('E-2', 200, 330, 0.6)),
    row(fan2, 'outlets', 3, outlet('E-3', 200, 350, 0.6)),
  );

  // EF-S1 (R6 short form, some optional data), EF-S21 (Building Balance rows 47-56)
  const sf1 = eq('smallFan', 'EF-S1', 1, {
    areaServed: 'Toilet 101',
    location: 'Ceiling',
    manufacturer: 'Broan',
    model: 'L150',
    serial: 'BR-5521',
    amps: 0.9,
    hp: 0.05,
    voltage: 115,
    phase: '1-phase',
    speedDesign: 'High',
    designCfm: 110,
    instrument: 'Flow Hood',
  });
  const sf21 = eq('smallFan', 'EF-S21', 21, {
    areaServed: 'Toilet 221',
    location: 'Ceiling',
    manufacturer: 'Panasonic',
    model: 'FV-0511VQ1',
    serial: 'PN-88213',
    amps: 0.4,
    designCfm: 90,
    instrument: 'Flow Hood',
  });
  rows.push(row(sf1, 'outlets', 1, outlet('1', 110, 104)), row(sf21, 'outlets', 1, outlet('1', 90, 95)));

  // H-1: Captrate (VelGrid) 5 x 16" x 20" -> 2049.29 CFM final; H-2: Condensate Baffle (Airfoil), a No Filter row
  const hood = (designation: string, slot: number, filterType: string, extra: Equipment['data'] = {}) =>
    eq('hood', designation, slot, {
      areaServed: 'Kitchen',
      location: 'Cook line',
      manufacturer: 'CaptiveAire',
      designCfm: 2000,
      lengthFt: 8,
      associatedFan: 'KEF-1',
      model: '5424ND-2-PSP-F',
      serial: 'CA-2024-5512',
      hoodType: 'Type I',
      filterManufacturer: 'CaptiveAire',
      filterType,
      instrument: 'Evergreen VelGrid',
      ...extra,
    });
  const h1 = hood('H-1', 1, 'Captrate (VelGrid)', {
    technicianNotes: 'Grease filters cleaned before test.',
    remarks: 'Hood balanced.\nLights out on the left side.',
  });
  [177, 187, 183, 175, 162].forEach((v, i) =>
    rows.push(row(h1, 'filters', i + 1, { size: '16" x 20"', init1: 170 + i, final1: v })),
  );
  const h2 = hood('H-2', 2, 'Condensate Baffle (Airfoil)', {
    designCfm: 500,
    instrument: 'Evergreen Airfoil',
    remarks: 'Two-line box.',
  });
  rows.push(
    row(h2, 'filters', 1, { size: '16" x 20"', final1: 900, final2: 910, final3: 920 }),
    row(h2, 'filters', 2, { size: '20" x 20"', final1: 880, final2: 890 }, { final3: { notation: 'Not Acc.' } }),
    row(h2, 'filters', 3, { size: 'No Filter' }),
  );

  // T-1: 24" x 12" rectangular, 12 readings (one N/A); T-2: 10" round (height automatically N/A); T-3: initial only
  const trav = (designation: string, slot: number, data: Equipment['data'], na?: NaState) =>
    eq(
      'traverse',
      designation,
      slot,
      {
        instrument: 'Manometer/Pitot Tube',
        ductStatic: 0.45,
        temperature: 55,
        ...data,
      },
      na,
    );
  const t1 = trav(
    'T-1',
    1,
    {
      areaServed: 'RTU-1 supply main',
      designCfm: 1000,
      shape: 'Rectangular',
      width: 24,
      height: 12,
      liner: 0,
      ...seq('readings', [480, 484, 488, 492, 496, 500, 504, 508, 512, 516, 520, 524]),
      readings_2: null,
      remarks: 'Straight run 6 ft.',
    },
    { sections: {}, fields: { readings_2: { notation: 'N/A' } } },
  );
  const t2 = trav('T-2', 2, {
    areaServed: 'EF-2 discharge',
    designCfm: 350,
    shape: 'Round',
    width: 10,
    ...seq('readings', [600, 600, 600, 600, 600, 600, 600, 600, 620, 620, 620, 620, 620, 620, 620, 620]),
    remarks: 'One line.',
  });
  const t3 = trav('T-3', 3, {
    areaServed: 'Transfer duct',
    designCfm: 200,
    shape: 'Rectangular',
    width: 10,
    height: 8,
    initialVel: 360,
  });
  const equipment = [mau1, mau2, mau3, mau4, erv, fan2, sf1, sf21, h1, h2, t1, t2, t3];
  // null = "not entered": drop the keys, as the app stores them after an import
  const strip = (d: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(d)) if (v === null) delete d[k];
  };
  equipment.forEach((e) => strip(e.data));
  rows.forEach((r) => strip(r.data));
  return { equipment, rows };
}

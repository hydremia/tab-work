import { describe, expect, it } from 'vitest';
import { exportWorkbook } from './exportWorkbook.js';
import { readScheduleSection, readSheetRows, hasScheduleSection } from './schedule.js';
import { TEMPLATE_MAP } from './templateMap.js';
import { templateBytes } from './testTemplate.js';

describe('schedule readers', () => {
  it('the blank template has no schedule rows (the sample designations alone are not units)', async () => {
    expect(await hasScheduleSection(templateBytes())).toBe(true);
    expect(await readScheduleSection(templateBytes())).toEqual({});
  });

  it('reads only the {Equipment Data Entry} rows of a filled workbook', async () => {
    const bytes = await exportWorkbook(templateBytes(), {
      templateRevision: TEMPLATE_MAP.revision,
      sections: {},
      equipment: {
        rtu: [
          {
            slot: 1,
            schedule: { designation: 'RTU-1', manufacturer: 'Carrier', hp: 3, phase: '3-phase', voltage: 460 },
            fields: { serial: 'SN-1' },
          },
          { slot: 3, schedule: { designation: 'RTU-3', designTotalCfm: 2400 } },
        ],
        vav: [{ slot: 1, schedule: { designation: 'VAV-1', designMaxCfm: 600, ddcAddress: '3001' } }],
      },
    });
    const s = await readScheduleSection(bytes);
    expect(s.rtu).toEqual([
      {
        slot: 1,
        values: { designation: 'RTU-1', manufacturer: 'Carrier', hp: 3, phase: '3-phase', voltage: 460 },
      },
      { slot: 3, values: { designation: 'RTU-3', designTotalCfm: 2400 } },
    ]);
    // the block's serial number is not part of the schedule
    expect(JSON.stringify(s)).not.toContain('SN-1');
    expect(s.vav).toEqual([{ slot: 1, values: { designation: 'VAV-1', designMaxCfm: 600, ddcAddress: '3001' } }]);
    expect(s.mau).toBeUndefined();
  });

  it('readSheetRows returns every sheet as a dense grid of values', async () => {
    const bytes = await exportWorkbook(templateBytes(), {
      templateRevision: TEMPLATE_MAP.revision,
      sections: {},
      equipment: { rtu: [{ slot: 2, schedule: { designation: 'RTU-2', hp: 5 } }] },
    });
    const sheets = await readSheetRows(bytes);
    const ede = sheets.find((x) => x.name === '{Equipment Data Entry}')!;
    expect(ede).toBeDefined();
    const row = ede.rows.find((r) => r[1] === 'RTU-2')!;
    expect(row[6]).toBe(5);
    expect(ede.rows.every((r) => r.length === ede.rows[0].length)).toBe(true);
  });
});

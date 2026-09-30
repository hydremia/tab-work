/** A unit's scope from a schedule: scope column values, phrases in other cells, "(E)" tags, airflow-only sections. */
import { describe, expect, it } from 'vitest';
import { buildPreview } from './scheduleImport';
import { airflowOnlySections, designationScope, scopeOf, tableScope } from './unitScope';

describe('scope of a schedule row', () => {
  it('a scope / status column', () => {
    const cases: [string, string | null][] = [
      ['NEW', 'new'],
      ['N', 'new'],
      ['New - replaces existing EF-3', 'new'],
      ['EXISTING', 'existing'],
      ['E', 'existing'],
      ['(E)', 'existing'],
      ['EXISTING TO REMAIN', 'existing'],
      ['Relocated', 'existing'],
      ['EXISTING TO BE REMOVED', 'removed'],
      ['REMOVE AND CAP', 'removed'],
      ['Remove & cap', 'removed'],
      ['DEMO', 'removed'],
      ['Abandon in place', 'removed'],
      ['Removed', 'removed'],
      ['SEE NOTE 3', null],
      ['', null],
    ];
    for (const [text, want] of cases) expect([text, scopeOf(text, 'column')]).toEqual([text, want]);
  });

  it('other cells: only unmistakable phrases', () => {
    expect(scopeOf('REMOVE AND CAP', 'cell')).toBe('removed');
    expect(scopeOf('EXISTING TO REMAIN', 'cell')).toBe('existing');
    expect(scopeOf('EXISTING KITCHEN', 'cell')).toBeNull();
    expect(scopeOf('REPLACES EXISTING EF-3', 'cell')).toBeNull();
    expect(scopeOf('NEW', 'cell')).toBeNull();
    expect(scopeOf('REMOVABLE FILTER', 'cell')).toBeNull();
    expect(scopeOf(1200, 'cell')).toBeNull();
  });

  it('"(E)" / "(N)" before the tag', () => {
    expect(designationScope('(E) RTU-5')).toEqual({ designation: 'RTU-5', scope: 'existing' });
    expect(designationScope('(N)EF-2')).toEqual({ designation: 'EF-2', scope: 'new' });
    expect(designationScope('(R) EF-17')).toEqual({ designation: 'EF-17', scope: 'removed' });
    expect(designationScope('EF-2')).toEqual({ designation: 'EF-2', scope: null });
  });

  it('airflow only: the sections without airflow data', () => {
    expect(airflowOnlySections('fan')).toEqual(['unit', 'motor', 'drive', 'misc', 'rpm', 'static']);
    expect(airflowOnlySections('rtu')).toContain('motor');
    expect(airflowOnlySections('rtu')).not.toContain('design');
  });
});

describe('scope in the schedule preview', () => {
  it('removed rows are skipped (even with text in number columns), existing flagged, "(E)" stripped', () => {
    const p = buildPreview({
      type: 'fan',
      rows: [
        ['EF-1', 'HOOD H-1', null, '1,890', 'EXISTING TO REMAIN'],
        ['EF-2', 'HOOD H-2', '1.5', '2,300', null],
        ['EF-17', 'SIGN ROOM', 'REMOVE AND CAP', null, null],
        ['(E) EF-30', 'TOILET', '0.25', '150', null],
      ],
      mapping: ['designation', 'areaServed', 'hp', 'designTotalCfm', null],
      existing: [],
    });
    expect(p.rows.map((r) => [r.designation, r.action, r.scope, r.errors])).toEqual([
      ['EF-1', 'create', 'existing', []],
      ['EF-2', 'create', null, []],
      ['EF-17', 'skip', 'removed', []],
      ['EF-30', 'create', 'existing', []],
    ]);
    expect(p.rows[2].warnings[0]).toMatch(/Removed \(REMOVE AND CAP\)/);
    expect([p.create, p.skip, p.removed, p.existing]).toEqual([3, 1, 1, 2]);
    // removed rows take no slot
    expect(p.rows[3].slot).toBe(3);
  });

  it('a scope column maps by its header and wins over the row text', () => {
    const p = buildPreview({
      type: 'rtu',
      rows: [
        ['RTU-1', 'NEW', 'REPLACES EXISTING RTU'],
        ['RTU-2', 'E', null],
        ['RTU-3', 'maybe', null],
      ],
      mapping: ['designation', 'scope', 'areaServed'],
      existing: [],
    });
    expect(p.rows.map((r) => r.scope)).toEqual(['new', 'existing', null]);
    expect(p.rows[2].warnings[0]).toMatch(/Scope: "maybe"/);
  });
});

describe('scope: more drawings (Redmond)', () => {
  it('"DEMO KITCHEN" is a room; "DEMO EXISTING" is removed', () => {
    expect(scopeOf('DEMO KITCHEN - H-8', 'cell')).toBeNull();
    expect(scopeOf('DEMO EXISTING', 'cell')).toBe('removed');
    expect(scopeOf('DEMO EXISTING', 'column')).toBe('removed');
    expect(scopeOf('DEMO', 'column')).toBe('removed');
  });

  it("a table's scope from its title or a note in it", () => {
    expect(tableScope('EXISTING FAN SCHEDULE')).toBe('existing');
    expect(tableScope('NEW DEDICATED OUTSIDE AIR UNIT SCHEDULE')).toBe('new');
    expect(tableScope('FAN SCHEDULE')).toBeNull();
    expect(
      tableScope('ROOFTOP UNIT SCHEDULE', [['NOTES SHOWN FOR REFERENCE ONLY. ALL EQUIPMENT IS EXISTING TO REMAIN.']]),
    ).toBe('existing');
  });
});

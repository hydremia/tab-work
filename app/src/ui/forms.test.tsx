import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import {
  addAirflowRow,
  addEquipment,
  addIssue,
  addLibraryInstrument,
  createProject,
  getCertProfile,
  setCertImage,
  setField,
  setFields,
} from '../data/repo';
import { SyncProvider } from '../sync/SyncProvider';
import type { ScheduleFile } from '../workbook/scheduleFile';

// a drawing with several schedules (what readScheduleFile rebuilds from a PDF): fans, MAUs, the air balance and a
// space-by-space ventilation table
const DRAWING: ScheduleFile = {
  fileName: 'M3.0.pdf',
  schedule: null,
  sheets: [
    {
      name: 'p.1 FAN SCHEDULE',
      type: 'fan',
      rows: [
        ['UNIT NO.', 'SERVICE', 'CFM', 'REMARKS'],
        ['EF-1', 'HOOD H-1', '1,890', 'EXISTING TO REMAIN'],
        ['EF-2', 'HOOD H-2', '2,300', null],
        ['EF-17', 'SIGN ROOM', 'REMOVE AND CAP', null],
      ],
    },
    {
      name: 'p.1 MAKE-UP AIR UNIT SCHEDULE',
      type: 'mau',
      rows: [
        ['UNIT', 'SERVICE', 'CFM'],
        ['MAU-9', 'HOOD H-2', null],
      ],
    },
    {
      name: 'p.1 VENTILATION CALCULATION',
      rows: [
        ['UNIT', 'OSA (CFM)', 'UNIT', 'EXHAUST (CFM)'],
        ['MAU-9', '3,352', 'EF-1', '1,890'],
        ['RTU-7', '500', 'EF-2', '2,000'],
        ['TOTAL', '3,852', 'TOTAL', '3,890'],
      ],
    },
    {
      name: 'p.1 VENTILATION SCHEDULE',
      rows: [
        ['ROOM', 'AREA (SF)', 'OCCUPANCY', 'Voz'],
        ['SALES', '12,000', '180', '2,790'],
      ],
    },
  ],
};
vi.mock('../workbook/scheduleFile', async (orig) => {
  const real = await orig<typeof import('../workbook/scheduleFile')>();
  return {
    ...real,
    readScheduleFile: (f: File, progress?: (m: string) => void) =>
      f.name === 'M3.0.pdf' ? Promise.resolve(DRAWING) : real.readScheduleFile(f, progress),
  };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
  return router;
}
const fieldEl = (key: string) => document.querySelector(`[data-field="${key}"]`) as HTMLElement | null;
const picker = (key: string) => fieldEl(key)!.querySelector('select.select') as HTMLSelectElement;
const sectionHeading = (name: string) => screen.queryByRole('heading', { level: 2, name });

describe('MAU form (jsdom): supply airflow method switching', () => {
  it('shows only the chosen method, keeps the other methods’ values and restores them when switching back', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const mau = await addEquipment(p.id, 'mau', 'MAU-1');
    await setFields('equipment', mau.id, {
      'data.method': 'PSP',
      'data.pspLength': 48,
      'data.pspWidth': 12,
      'data.pspBlanks': 0,
      'data.pspVelocities_1': 800,
      'data.pspVelocities_2': 820,
    });
    renderAt(`/p/${p.id}/e/${mau.id}`);
    expect(
      // the first render loads the lazy unit page chunk: slow when the whole suite runs in parallel
      await screen.findByRole('heading', { level: 2, name: 'PSP (perforated supply plenum)' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(sectionHeading('Filter grid')).toBeNull();
    expect(sectionHeading('Burner profile pressure')).toBeNull();
    // PSP live calc: avg 810 fpm x (48 - 2) x 12 x 0.88 / 144
    const psp = await screen.findByTestId('calc-psp');
    expect(psp).toHaveTextContent('2,732 CFM');

    await user.selectOptions(picker('method'), 'Filter Grid');
    await waitFor(async () => expect((await db.equipment.get(mau.id))?.data.method).toBe('Filter Grid'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Filter grid' })).toBeInTheDocument();
    expect(sectionHeading('PSP (perforated supply plenum)')).toBeNull();
    // the PSP values stay in the app (not counted, exported as N/A) ...
    const kept = await db.equipment.get(mau.id);
    expect(kept?.data).toMatchObject({ pspLength: 48, pspVelocities_1: 800 });
    // ... outlet rows become optional with a non-Outlets method (the section folds)
    expect(screen.getByText(/Outlet rows are optional with this method/)).toBeInTheDocument();

    await user.click(screen.getByTestId('add-filterGrid'));
    await waitFor(async () => expect(await db.airflowRows.where('equipmentId').equals(mau.id).count()).toBe(1));

    await user.selectOptions(picker('method'), 'PSP');
    expect(
      // the first render loads the lazy unit page chunk: slow when the whole suite runs in parallel
      await screen.findByRole('heading', { level: 2, name: 'PSP (perforated supply plenum)' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(fieldEl('pspLength')!).getByRole('textbox')).toHaveValue('48'));
    expect(sectionHeading('Filter grid')).toBeNull();
  });
});

describe('Hood form (jsdom)', () => {
  it('VelGrid filters take one reading (2-3 automatically N/A), totals live; Airfoil asks for three', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const hood = await addEquipment(p.id, 'hood', 'H-1');
    await setFields('equipment', hood.id, {
      'data.filterType': 'Captrate (VelGrid)',
      'data.designCfm': 1400,
      'data.lengthFt': 10,
    });
    await addAirflowRow(hood, 'filters', { size: '16" x 20"', init1: 300, final1: 300 });
    await addAirflowRow(hood, 'filters', { size: '16" x 20"', init1: 300, final1: 300 });
    renderAt(`/p/${p.id}/e/${hood.id}`);
    const row = await screen.findByTestId('row-filters-0');
    // 300 fpm x 1.73 ft² x 1.34 = 695.46 CFM per filter, two filters
    await waitFor(() => expect(screen.getByTestId('hood-final')).toHaveTextContent('1,390.92'));
    expect(screen.getByTestId('row-auto-filters-0')).toHaveTextContent('VelGrid: one reading');
    expect(within(row).queryByLabelText(/Initial 2$/)).toBeNull();

    await user.selectOptions(picker('filterType'), 'Condensate Baffle (Airfoil)');
    await waitFor(async () =>
      expect((await db.equipment.get(hood.id))?.data.filterType).toBe('Condensate Baffle (Airfoil)'),
    );
    await waitFor(() =>
      expect(within(screen.getByTestId('row-filters-0')).getByLabelText(/Initial 2$/)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('row-auto-filters-0')).toBeNull();

    // the hood instrument picker: the 7 pre-loaded instruments cover the Evergreen meters; removing them flags it
    await user.selectOptions(picker('instrument'), 'Evergreen Airfoil');
    await waitFor(async () => expect((await db.equipment.get(hood.id))?.data.instrument).toBe('Evergreen Airfoil'));
    expect(screen.queryByTestId('warning-instrument')).toBeNull();
    await db.instruments.clear();
    expect(await screen.findByTestId('warning-instrument')).toHaveTextContent(
      /No calibration row for a \(micro\)manometer/,
    );
  });
});

describe('Duplicate, needs attention, building pressures (jsdom)', () => {
  it('duplicates a VAV with the next designation and slot, rows without readings', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const vav = await addEquipment(p.id, 'vav', 'VAV-12');
    await setField('equipment', vav.id, 'data.designMaxCfm', 600);
    await addAirflowRow(vav, 'outlets', { no: 'S-1', ak: 0.5, designCfm: 600, finalVel: 1180 });
    const router = renderAt(`/p/${p.id}/e/${vav.id}`);
    await user.click(await screen.findByTestId('duplicate-open'));
    expect(screen.getByLabelText('New designation')).toHaveValue('VAV-13');
    expect(screen.getByText(/VAVs slot 2 in the workbook/)).toBeInTheDocument();
    await user.click(screen.getByTestId('duplicate-create'));
    await waitFor(() => expect(router.state.location.pathname).not.toContain(vav.id));
    const copy = (await db.equipment.toArray()).find((e) => e.designation === 'VAV-13')!;
    expect(copy).toMatchObject({ slot: 2, data: { designMaxCfm: 600 } });
    const rows = await db.airflowRows.where('equipmentId').equals(copy.id).toArray();
    expect(rows.map((r) => r.data)).toEqual([{ no: 'S-1', ak: 0.5, designCfm: 600 }]);
  });

  it('needs-attention tab: count badge and grouped, linked items', async () => {
    const p = await createProject({ name: 'Job', tabDate: '2026-09-15' });
    const vav = await addEquipment(p.id, 'vav', 'VAV-1');
    await setFields('equipment', vav.id, { 'data.designMaxCfm': 300, 'data.instrument': 'Flow Hood' });
    await addAirflowRow(vav, 'outlets', { no: 'S-1', ak: 1, designCfm: 300, finalVel: 200 });
    await addIssue(p.id, { remark: 'Damper stuck', equipmentId: vav.id });
    renderAt(`/p/${p.id}/attention`);
    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('tab-count-attention')).toHaveTextContent('4'));
    expect(
      within(screen.getByTestId('attention-tolerance')).getByText(/Outlets S-1: 67 % of design/),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('attention-issues')).getByText('Damper stuck')).toBeInTheDocument();
    expect(within(screen.getByTestId('attention-photos')).getByText(/Missing: Unit \/ tag/)).toBeInTheDocument();
    const cal = within(screen.getByTestId('attention-calibration'));
    expect(cal.getByText(/calibrated 2024-03-14, more than 12 months before the TAB date/)).toBeInTheDocument();
    expect(cal.getByRole('link')).toHaveAttribute('href', `/p/${p.id}/info#cal-h`);
  });

  it('building pressures on Project Info: kitchen N/A without hoods, values saved through setField', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    renderAt(`/p/${p.id}/info`);
    const card = await screen.findByTestId('building-pressures');
    expect(within(card).getByText(/Kitchen vs Dining is automatically N\/A/)).toBeInTheDocument();
    const kitchen = card.querySelector('[data-field="bbKitchenDp"]')!;
    expect(kitchen).toHaveAttribute('data-state', 'auto-na');
    const building = card.querySelector('[data-field="bbBuildingDp"]') as HTMLElement;
    await user.type(within(building).getByRole('textbox'), '0.02');
    await user.tab();
    await waitFor(async () => expect((await db.projects.get(p.id))?.info.bbBuildingDp).toBe(0.02));
    const outbox = await db.fieldChanges.filter((c) => c.field === 'info.bbBuildingDp').toArray();
    expect(outbox).toHaveLength(1);
    // with a hood the kitchen row is required
    await addEquipment(p.id, 'hood', 'H-1');
    await waitFor(() =>
      expect(card.querySelector('[data-field="bbKitchenDp"]')).toHaveAttribute('data-state', 'missing'),
    );
    expect(screen.getByTestId('project-completion')).toHaveTextContent('Kitchen vs Dining ΔP');
  });
});

describe('Certification, other OA, instrument library (jsdom)', () => {
  it('certification: template CP prefilled, signature / date auto N/A on prelim, required on final', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    renderAt(`/p/${p.id}/info`);
    const card = await screen.findByTestId('certification');
    expect(within(card).getByLabelText('NEBB certified professional')).toHaveValue('Isaac Rochester');
    expect(card.querySelector('[data-field="certSignature"]')).toHaveAttribute('data-state', 'auto-na');
    await user.selectOptions(screen.getByLabelText('Report'), 'final');
    await waitFor(() =>
      expect(card.querySelector('[data-field="certSignature"]')).toHaveAttribute('data-state', 'missing'),
    );
    expect(screen.getByTestId('project-completion')).toHaveTextContent('Certification signature');
    await user.type(
      within(card.querySelector('[data-field="certSignature"]') as HTMLElement).getByRole('textbox'),
      'Dana Smith',
    );
    await user.tab();
    await waitFor(async () => expect((await db.projects.get(p.id))?.info.certSignature).toBe('Dana Smith'));
    // an expiration before the report date is flagged
    await setFields('projects', p.id, { 'info.certExpiration': '2026-01-31', 'info.reportDate': '2026-09-24' });
    expect(await within(card).findByTestId('warning-certExpiration')).toHaveTextContent(/expires before/);
  });

  it('certification profile: CP lines for new projects, stamp / signature previews, Info card says what exports get', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/certification');
    const cp = await screen.findByTestId('cert-profile');
    const name = await within(cp).findByLabelText('NEBB certified professional');
    expect(name).toHaveValue('Isaac Rochester'); // template default until edited
    expect(await db.certProfiles.count()).toBe(0); // nothing stored just by looking
    await user.clear(name);
    await user.type(name, 'Dana Kim');
    await user.tab();
    await waitFor(async () => expect((await getCertProfile())?.cpName).toBe('Dana Kim'));
    expect(screen.getByTestId('cert-stamp-none')).toBeInTheDocument();
    const img = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 10, type: 'png' as const };
    await setCertImage('stamp', img);
    expect(await screen.findByTestId('cert-stamp-img')).toHaveAttribute('src', img.dataUrl);
    await user.click(screen.getByRole('button', { name: 'Draw signature' }));
    expect(screen.getByTestId('signature-pad')).toBeInTheDocument();
    expect(screen.getByTestId('signature-pad-save')).toBeDisabled(); // nothing drawn yet
    await user.click(screen.getByTestId('cert-stamp-remove'));
    await waitFor(async () => expect((await getCertProfile())?.stamp).toBeNull());
    // a new project starts with the profile's CP; its Info card says where the images come from
    await setCertImage('signature', img);
    const p = await createProject({ name: 'Job' });
    cleanup();
    renderAt(`/p/${p.id}/info`);
    const card = await screen.findByTestId('certification');
    expect(within(card).getByLabelText('NEBB certified professional')).toHaveValue('Dana Kim');
    await waitFor(() =>
      expect(within(card).getByTestId('cert-images-line')).toHaveTextContent('Stamp: none · Signature image: yes'),
    );
  });

  it('other outside air: add rows, % of design, total; removing a row shifts the rows below up', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    renderAt(`/p/${p.id}/info`);
    const card = await screen.findByTestId('other-oa');
    await user.click(within(card).getByTestId('add-oa-row'));
    const row1 = await within(card).findByTestId('oa-row-1');
    await user.type(within(row1).getByLabelText('Unit / source'), 'Transfer grille');
    await user.type(within(row1).getByLabelText('Design'), '400');
    await user.type(within(row1).getByLabelText('Actual'), '380');
    await user.tab();
    await waitFor(async () => expect((await db.projects.get(p.id))?.info.bbOa1Actual).toBe(380));
    await waitFor(() => expect(row1).toHaveTextContent('95 % of design'));
    await setFields('projects', p.id, { 'info.bbOa2Unit': 'Relief', 'info.bbOa2Design': 100 });
    await waitFor(() =>
      expect(within(card).getByTestId('oa-total')).toHaveTextContent('design 500 CFM · actual 380 CFM'),
    );
    await user.click(within(row1).getByRole('button', { name: 'Remove row 1' }));
    await waitFor(async () => {
      const info = (await db.projects.get(p.id))!.info;
      expect([info.bbOa1Unit, info.bbOa1Design, info.bbOa1Actual, info.bbOa2Unit, info.bbOa2Design]).toEqual([
        'Relief',
        100,
        null,
        null,
        null,
      ]);
    });
  });

  it('instrument library: pick into the project, the copy is linked; a library edit offers "Update from library"', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    await db.instruments.where('projectId').equals(p.id).delete();
    const lib = await addLibraryInstrument({
      type: 'Digital Micromanometer',
      manufacturer: 'Evergreen Telemetry',
      model: 'S-PVF-1',
      serial: '1700164',
      calibrationDate: '2025-11-21',
    });
    renderAt(`/p/${p.id}/info`);
    const pick = await screen.findByTestId('library-pick');
    await within(pick).findByRole('option', { name: /Micromanometer/ });
    await user.selectOptions(within(pick).getByLabelText('Instrument from the library'), lib.id);
    await user.click(within(pick).getByRole('button', { name: 'Add from library' }));
    expect(await screen.findByTestId('lib-linked')).toHaveTextContent('In the library');
    await setField('libraryInstruments', lib.id, 'calibrationDate', '2026-09-20');
    expect(await screen.findByTestId('lib-differs')).toHaveTextContent('The library has calibration 2026-09-20');
    await user.click(screen.getByTestId('lib-update'));
    await waitFor(async () =>
      expect((await db.instruments.where('projectId').equals(p.id).first())?.calibrationDate).toBe('2026-09-20'),
    );
  });

  it('library page: add, edit, usage count; the unit page shows a slot move note until dismissed', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    renderAt('/library');
    await user.click(await screen.findByRole('button', { name: /Add the template.s 7 a2b instruments/ }));
    await waitFor(async () => expect(await db.libraryInstruments.count()).toBe(7));
    expect(await screen.findAllByTestId('lib-item')).toHaveLength(7);
    expect(screen.getAllByTestId('lib-expired').length).toBeGreaterThan(0); // the 2024 balometer
    const a = await addEquipment(p.id, 'rtu', 'RTU-1');
    const b = await addEquipment(p.id, 'rtu', 'RTU-2');
    await setFields('equipment', b.id, { slot: 3, slotMove: { from: 2, to: 3, otherId: a.id } });
    render(<></>);
    const router = createMemoryRouter(routes, { initialEntries: [`/p/${p.id}/e/${b.id}`] });
    render(
      <SyncProvider>
        <RouterProvider router={router} />
      </SyncProvider>,
    );
    const note = await screen.findByTestId('slot-move-note');
    expect(note).toHaveTextContent('Moved from workbook slot 2 to slot 3 because another device used slot 2 for RTU-1');
    await user.click(within(note).getByRole('button', { name: 'OK' }));
    await waitFor(async () => expect((await db.equipment.get(b.id))?.slotMove).toBeNull());
  });
});

describe('Schedule import page (jsdom)', () => {
  it('paste -> columns mapped by header -> preview with an invalid row -> import creates the valid units', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    await addEquipment(p.id, 'vav', 'VAV-1');
    renderAt(`/p/${p.id}/schedule?type=vav`);
    const paste = await screen.findByLabelText('Schedule rows');
    await user.click(paste);
    await user.paste(
      'Tag\tMax CFM\tMin CFM\tDDC Address\nVAV-1\t600\t150\t3001\nVAV-2\t450\t120\t3002\nVAV-3\tabc\t100\t3003\n',
    );
    expect(await screen.findByTestId('preview-summary-vav')).toHaveTextContent('1 new, 1 updated, 1 skipped');
    expect(screen.getByTestId('map-col-1')).toHaveValue('designMaxCfm');
    expect(screen.getByText('Design max CFM: "abc" is not a number')).toBeInTheDocument();
    await user.click(screen.getByTestId('schedule-import'));
    expect(await screen.findByTestId('schedule-done')).toHaveTextContent('1 unit created, 1 updated.');
    const vavs = (await db.equipment.where('projectId').equals(p.id).toArray()).sort((a, b) => a.slot - b.slot);
    expect(vavs.map((e) => [e.designation, e.data.designMaxCfm, e.data.ddcAddress])).toEqual([
      ['VAV-1', 600, '3001'],
      ['VAV-2', 450, '3002'],
    ]);
  });
});

describe('Schedule import: every table of a drawing in one go (jsdom)', () => {
  it('unit tables by type, removed rows left out, existing airflow only, the air balance checked and kept', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    renderAt(`/p/${p.id}/schedule`);
    await user.click(await screen.findByRole('button', { name: 'File (CSV, Excel, PDF, photo)' }));
    await user.upload(screen.getByLabelText('Schedule file'), new File(['x'], 'M3.0.pdf', { type: 'application/pdf' }));
    const picks = await screen.findAllByTestId('table-pick');
    expect(picks.map((x) => x.getAttribute('data-kind'))).toEqual(['units', 'units', 'airBalance', 'spaces']);
    expect(within(picks[3]).getByRole('checkbox')).not.toBeChecked();
    expect(await screen.findByTestId('preview-summary-fan')).toHaveTextContent(
      '2 new, 0 updated, 1 skipped (1 removed / capped) · 1 existing',
    );
    expect(screen.getByTestId('preview-summary-mau')).toHaveTextContent('1 new');
    expect(screen.getAllByTestId('scope-chip').map((c) => c.textContent)).toEqual(['Existing', 'Removed']);
    const ab = screen.getByTestId('air-balance');
    expect(
      within(ab)
        .getAllByTestId('ab-row')
        .map((r) => r.getAttribute('data-status')),
    ).toEqual(['blank', 'match', 'missing', 'differs']);
    await user.click(within(screen.getByTestId('existing-scope')).getByRole('button', { name: 'Airflow only' }));
    await user.click(screen.getByTestId('schedule-import'));
    expect(await screen.findByTestId('schedule-done')).toHaveTextContent(
      '3 units created, 0 updated; 1 removed unit left out; air balance kept, 1 design CFM filled, 1 existing unit added.',
    );
    const all = await db.equipment.where('projectId').equals(p.id).toArray();
    const by = (d: string) => all.find((e) => e.designation === d)!;
    expect(all.map((e) => e.designation).sort()).toEqual(['EF-1', 'EF-2', 'MAU-9', 'RTU-7']);
    expect([by('EF-1').isExisting, by('EF-2').isExisting, by('RTU-7').isExisting]).toEqual([true, false, true]);
    expect(by('EF-1').naState.sections.motor).toMatchObject({ notation: 'N/A' });
    expect(by('MAU-9').data.designTotalCfm).toBe(3352);
    expect(by('EF-2').data.designTotalCfm).toBe(2300); // differs from the air balance: left as scheduled
    expect(by('RTU-7').data.designOaCfm).toBe(500);
    const info = (await db.projects.get(p.id))!.info;
    expect([info.abOaDesign, info.abExhaustDesign, info.abNet]).toEqual([3852, 3890, -38]);
  });
});

describe('Existing unit: airflow only (jsdom)', () => {
  it('marks the non-airflow sections N/A in one go and back', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const ef = await addEquipment(p.id, 'fan', 'EF-1', true);
    renderAt(`/p/${p.id}/e/${ef.id}`);
    const box = await screen.findByTestId('airflow-only');
    await user.click(within(box).getByRole('button', { name: 'Airflow only' }));
    await waitFor(async () =>
      expect(Object.keys((await db.equipment.get(ef.id))!.naState.sections).sort()).toEqual([
        'drive',
        'misc',
        'motor',
        'rpm',
        'static',
        'unit',
      ]),
    );
    expect(await within(box).findByRole('button', { name: 'Airflow only', pressed: true })).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'Airflow only' }));
    await waitFor(async () =>
      expect(Object.values((await db.equipment.get(ef.id))!.naState.sections).every((m) => m === null)).toBe(true),
    );
  });
});

describe('PM dashboard (jsdom)', () => {
  it('lists every project with stage, units, issues; filter and search', async () => {
    const user = userEvent.setup();
    const a = await createProject({ name: 'Riverside Medical', address: '12 River Rd' });
    await addEquipment(a.id, 'rtu', 'RTU-1');
    await addEquipment(a.id, 'rtu', 'RTU-2');
    await addIssue(a.id, { remark: 'Damper stuck' });
    await createProject({ name: 'Airport Annex' });
    renderAt('/dashboard');
    await waitFor(() => expect(screen.getAllByTestId('dash-row')).toHaveLength(2));
    const river = screen.getAllByTestId('dash-row').find((r) => r.textContent?.includes('Riverside'))!;
    expect(river).toHaveAttribute('data-stage', 'in-progress');
    expect(within(river).getByTestId('dash-units')).toHaveTextContent('0/2 complete · 0 reviewed');
    expect(river).toHaveTextContent('RTUs 0/2');
    expect(river).toHaveTextContent('1 open issue');
    expect(within(river).getByTestId('dash-export')).toHaveTextContent('Never exported');
    expect(screen.getByTestId('dash-totals')).toHaveTextContent('2 projects · 0/2 units complete');
    await user.selectOptions(screen.getByLabelText('Show'), 'empty');
    await waitFor(() => expect(screen.getAllByTestId('dash-row')).toHaveLength(1));
    expect(screen.getByTestId('dash-row')).toHaveTextContent('Airport Annex');
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await user.type(screen.getByLabelText('Search projects'), 'river rd');
    await waitFor(() => expect(screen.getAllByTestId('dash-row')).toHaveLength(1));
    expect(screen.getByTestId('dash-row')).toHaveTextContent('Riverside Medical');
  });
});

describe('Grid entry (jsdom)', () => {
  it('toggles to a spreadsheet grid (remembered), edits save, Enter goes one row down, back to cards', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    const r1 = await addAirflowRow(rtu, 'supply', { no: 'S-1', designCfm: 400 });
    await addAirflowRow(rtu, 'supply', { no: 'S-2', designCfm: 300 });
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    await user.click(await screen.findByTestId('grid-toggle-supply'));
    const grid = await screen.findByTestId('grid-supply');
    expect(localStorage.getItem('tab.gridEntry')).toBe('1');
    const cell = within(grid).getByLabelText('Supply outlets row 1 Final VEL');
    await user.click(cell);
    await user.type(cell, '410{Enter}');
    expect(document.activeElement).toBe(within(grid).getByLabelText('Supply outlets row 2 Final VEL'));
    await waitFor(async () => expect((await db.airflowRows.get(r1.id))?.data.finalVel).toBe(410));
    await waitFor(() => expect(within(grid).getByLabelText('Supply outlets row 1 Final VEL')).toHaveValue('410'));
    await user.click(screen.getByTestId('grid-toggle-supply'));
    expect(screen.queryByTestId('grid-supply')).toBeNull();
    expect(localStorage.getItem('tab.gridEntry')).toBe('0');
  });
});

describe('QR tags (jsdom)', () => {
  it('tags page: units listed and chosen, PDF downloaded; a scanned tag opens its unit or says why not', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Riverside' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await addEquipment(p.id, 'fan', 'EF-1');
    const created: Blob[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => (created.push(b), 'blob:x');
    const router = renderAt(`/p/${p.id}/tags`);
    await waitFor(() => expect(screen.getAllByTestId('tag-preview')).toHaveLength(2));
    await user.click(screen.getByRole('checkbox', { name: /EF-1/ }));
    expect(screen.getByTestId('tags-download')).toHaveTextContent('Download PDF (1 label)');
    await user.click(screen.getByTestId('tags-download'));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].type).toBe('application/pdf');
    URL.createObjectURL = origCreate;
    // scanning opens the unit
    await act(() => router.navigate(`/t/${p.id}/${rtu.id}`));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${p.id}/e/${rtu.id}`));
    // a tag of a project that is not on this device
    await act(() => router.navigate('/t/aaaaaaaa-0000-4000-8000-000000000009/bbbbbbbb-0000-4000-8000-000000000009'));
    expect(await screen.findByTestId('tag-missing')).toHaveTextContent('This project is not on this device');
  });
});

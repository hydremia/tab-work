import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addAirflowRow, addEquipment, addIssue, createProject, setField, setFields } from '../data/repo';
import { SyncProvider } from '../sync/SyncProvider';

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
      await screen.findByRole('heading', { level: 2, name: 'PSP (perforated supply plenum)' }),
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
      await screen.findByRole('heading', { level: 2, name: 'PSP (perforated supply plenum)' }),
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

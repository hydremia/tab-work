/** jsdom: review sign-off (blue), the report-lock banner and read-only forms, unlock, the History views. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addEquipment, createProject, lockProject, markReviewed, setField } from '../data/repo';
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

async function greenUnit() {
  const p = await createProject({ name: 'Riverside' });
  const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
  await setField('equipment', rtu.id, 'naState.equipment', { notation: 'N/A' });
  return { p, rtu };
}

afterEach(() => vi.restoreAllMocks());

describe('review sign-off (jsdom)', () => {
  it('a green unit is marked reviewed (blue); the list shows "1/1 complete, 1 reviewed"', async () => {
    const user = userEvent.setup();
    const { p, rtu } = await greenUnit();
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    const btn = await screen.findByTestId('mark-reviewed');
    expect(btn).toBeDisabled(); // a reviewer name is needed
    await user.type(screen.getByLabelText('Reviewer name'), 'Dana');
    await user.click(btn);
    expect(await screen.findByTestId('review-status')).toHaveTextContent('Reviewed by Dana');
    expect(screen.getAllByTestId('status-badge')[0]).toHaveAttribute('data-color', 'blue');
    expect((await db.equipment.get(rtu.id))?.review?.name).toBe('Dana');
  });

  it('Previous / Next step through the units in list order; "Mark reviewed & next" opens the next unreviewed', async () => {
    const user = userEvent.setup();
    const { p, rtu } = await greenUnit();
    const mau = await addEquipment(p.id, 'mau', 'MAU-1');
    const rtu2 = await addEquipment(p.id, 'rtu', 'RTU-2');
    await markReviewed(rtu.id, 'Dana'); // already reviewed: skipped by "& next"
    await setField('equipment', rtu2.id, 'naState.equipment', { notation: 'N/A' });
    const router = renderAt(`/p/${p.id}/e/${rtu.id}`);
    const stepper = await screen.findByTestId('unit-stepper');
    expect(stepper).toHaveTextContent('1 of 3'); // RTU-1, RTU-2, MAU-1 (by type, then slot)
    expect(within(stepper).queryByTestId('prev-unit')).toBeNull();
    await user.click(within(stepper).getByTestId('next-unit'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${p.id}/e/${rtu2.id}`));
    expect(await screen.findByTestId('unit-stepper')).toHaveTextContent('2 of 3');
    expect(screen.getByLabelText('Reviewer name')).toHaveValue('Dana'); // remembered from the last review
    await user.click(screen.getByTestId('mark-reviewed-next'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${p.id}/e/${mau.id}`));
    expect((await db.equipment.get(rtu2.id))?.review?.name).toBe('Dana');
  });

  it('Export → Report check: a "Check" line is accepted (blue, by whom) and cleared', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Riverside' });
    await addEquipment(p.id, 'rtu', 'RTU-1'); // not started: "Every unit complete" is a Check on a prelim
    renderAt(`/p/${p.id}/export`);
    const line = await screen.findByTestId('check-complete');
    await waitFor(() => expect(line).toHaveAttribute('data-status', 'warn'));
    await user.type(within(line).getByLabelText('Reviewer name'), 'Isaac');
    await user.click(within(line).getByTestId('accept-complete'));
    await waitFor(() => expect(screen.getByTestId('check-complete')).toHaveAttribute('data-status', 'accepted'));
    expect(screen.getByTestId('accepted-complete')).toHaveTextContent('Accepted by Isaac');
    expect(screen.getByTestId('report-check-summary')).toHaveTextContent('1 accepted');
    await user.click(within(screen.getByTestId('accepted-complete')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByTestId('check-complete')).toHaveAttribute('data-status', 'warn'));
  });

  it('the equipment list shows blue cards and the reviewed rollup', async () => {
    const { p, rtu } = await greenUnit();
    await markReviewed(rtu.id, 'Dana');
    renderAt(`/p/${p.id}/equipment`);
    const card = await screen.findByTestId('equip-RTU-1');
    await waitFor(() => expect(card).toHaveAttribute('data-color', 'blue'));
    expect(card).toHaveTextContent('Reviewed');
    expect(screen.getByTestId('rollup-rtu')).toHaveTextContent('RTUs 1/1 complete, 1 reviewed');
  });

  it('a unit that is not complete offers no review', async () => {
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    expect(await screen.findByTestId('review-status')).toHaveTextContent('once every required item is entered');
    expect(screen.queryByTestId('mark-reviewed')).toBeNull();
  });
});

describe('report lock (jsdom)', () => {
  it('locked: banner on the unit page, the form is read-only; Unlock (confirmed) makes it editable again', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Riverside' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await lockProject(p.id, 'Prelim', null);
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    const banner = await screen.findByTestId('lock-banner');
    expect(banner).toHaveTextContent(/Issued as Prelim on .+ — unlock to edit/);
    expect(screen.getByTestId('unit-form')).toBeDisabled();
    const serial = (await screen.findByText('Serial number', { selector: 'label' })).closest('.field') as HTMLElement;
    expect(within(serial).getByRole('textbox')).toBeDisabled();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(within(banner).getByTestId('unlock'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatch(/next export will be suggested as Prelim/);
    expect((await db.projects.get(p.id))?.lock).toBeTruthy(); // declined: still locked
    await user.click(within(banner).getByTestId('unlock'));
    await waitFor(() => expect(screen.queryByTestId('lock-banner')).toBeNull());
    expect(screen.getByTestId('unit-form')).not.toBeDisabled();
    expect((await db.projects.get(p.id))?.lock).toBeNull();
  });

  it('locked project tabs: banner, no Add / Import on Equipment, Export shows the issued state, re-import blocked', async () => {
    const { p } = await greenUnit();
    renderAt(`/p/${p.id}/export`);
    const issue = await screen.findByTestId('issue-report');
    await waitFor(() => expect(issue).toHaveTextContent('Issue report as Prelim'));
    expect(screen.getByTestId('reimport-link')).toBeInTheDocument();
    await lockProject(p.id, 'Prelim', null);
    expect(await screen.findByTestId('issued-state')).toHaveTextContent('Issued as Prelim');
    expect(screen.queryByTestId('issue-report')).toBeNull();
    expect(screen.getByTestId('reimport-locked')).toBeInTheDocument();
    expect(screen.getByTestId('lock-banner')).toBeInTheDocument();
  });

  it('the equipment list hides Add / Import while locked; the import screen is blocked with Unlock', async () => {
    const { p } = await greenUnit();
    await lockProject(p.id, 'Rev 1', null);
    const router = renderAt(`/p/${p.id}/equipment`);
    await screen.findByTestId('equip-RTU-1');
    expect(screen.queryByTestId('add-equipment')).toBeNull();
    expect(screen.queryByTestId('import-schedule')).toBeNull();
    await router.navigate(`/import?into=${p.id}`);
    expect(await screen.findByTestId('import-blocked')).toBeInTheDocument();
    expect(screen.getByTestId('lock-banner')).toHaveTextContent('Issued as Rev 1');
    expect(screen.queryByLabelText('Workbook file')).toBeNull();
  });
});

describe('history (jsdom)', () => {
  it('the History tab lists changes old → new with readable labels, and events; the filter narrows it', async () => {
    const user = userEvent.setup();
    const { p, rtu } = await greenUnit();
    await setField('equipment', rtu.id, 'data.serial', 'SN-1');
    await setField('equipment', rtu.id, 'data.serial', 'SN-2');
    await markReviewed(rtu.id, 'Dana');
    await setField('projects', p.id, 'info.architect', 'Lionakis');
    await lockProject(p.id, 'Prelim', null);
    renderAt(`/p/${p.id}/history`);
    const list = await screen.findByTestId('history-list');
    const lines = within(list)
      .getAllByTestId('history-line')
      .map((l) => l.textContent);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Report issued and locked as Prelim',
        'Architect: blank → Lionakis',
        'Marked reviewed by Dana',
        'Serial number: SN-1 → SN-2',
        'Serial number: blank → SN-1',
        'Whole unit N/A: blank → N/A',
      ]),
    );
    await user.selectOptions(screen.getByLabelText('Unit'), 'project');
    await waitFor(() =>
      expect(
        within(screen.getByTestId('history-list'))
          .getAllByTestId('history-line')
          .map((l) => l.textContent),
      ).not.toContain('Serial number: SN-1 → SN-2'),
    );
  });

  it('the unit page has its own History section', async () => {
    const user = userEvent.setup();
    const { p, rtu } = await greenUnit();
    await setField('equipment', rtu.id, 'data.serial', 'SN-1');
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    await user.click(await screen.findByTestId('unit-history-toggle'));
    const section = screen.getByTestId('unit-history');
    await waitFor(() => expect(within(section).getAllByTestId('history-line').length).toBeGreaterThanOrEqual(3));
    expect(section).toHaveTextContent('Serial number: blank → SN-1');
    expect(section).toHaveTextContent('Added RTU-1');
  });
});

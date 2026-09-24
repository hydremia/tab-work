import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addAirflowRow, addEquipment, createProject } from '../data/repo';
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

describe('UI (jsdom)', () => {
  it('project list shows local mode and the project cards with their progress', async () => {
    const p = await createProject({ name: 'Riverside', address: '1 Main St', tabDate: '2026-09-15' });
    await addEquipment(p.id, 'rtu', 'RTU-1');
    renderAt('/');
    expect(await screen.findByText('Riverside')).toBeInTheDocument();
    expect(screen.getByTestId('local-banner')).toHaveTextContent('Local mode');
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Local');
    expect(await screen.findByText('0 of 1 units complete')).toBeInTheDocument();
    expect(screen.getByText(/TAB Sep 15, 2026/)).toBeInTheDocument();
  });

  it('create project form creates the project and opens Project Info', async () => {
    const user = userEvent.setup();
    const router = renderAt('/new');
    await user.type(await screen.findByLabelText(/Project name/), 'New Job');
    await user.click(screen.getByRole('button', { name: /Airflow Only/ }));
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/p\/.+\/info$/));
    const [p] = await db.projects.toArray();
    expect(p).toMatchObject({ name: 'New Job', scopeProfile: 'airflow' });
  });

  it('RTU form: typing saves through setField, the N/A menu replaces the input, live CFM / %', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const rtu = await addEquipment(p.id, 'rtu', 'RTU-1');
    await addAirflowRow(rtu, 'supply', { no: 'S-1', ak: 0.5, designCfm: 200 });
    renderAt(`/p/${p.id}/e/${rtu.id}`);
    const serial = (await screen.findByText('Serial number', { selector: 'label' })).closest('.field') as HTMLElement;
    await user.type(within(serial).getByRole('textbox'), 'SN-1');
    await user.tab();
    await waitFor(async () => expect((await db.equipment.get(rtu.id))?.data.serial).toBe('SN-1'));
    const outbox = await db.fieldChanges.filter((c) => c.recordId === rtu.id).toArray();
    expect(outbox.some((c) => c.field === 'data.serial' && c.value === 'SN-1' && c.synced === 0)).toBe(true);

    await user.selectOptions(screen.getByLabelText('FLA: mark N/A'), 'Not Avail.');
    expect(await screen.findByTestId('na-fla')).toHaveTextContent('Not Avail.');
    expect((await db.equipment.get(rtu.id))?.naState.fields.fla).toEqual({ notation: 'Not Avail.' });

    await user.type(screen.getByLabelText('Supply outlets row 1 Final VEL'), '420');
    await user.tab();
    const row = await screen.findByTestId('row-supply-0');
    await waitFor(() => expect(row).toHaveTextContent('final 210'));
    expect(row).toHaveTextContent('105 %');

    // direct drive: the sheave fields collapse to "Auto N/A"
    await user.selectOptions(
      screen.getByLabelText('Drive type', { exact: false, selector: 'select.select' }),
      'Direct',
    );
    await waitFor(() =>
      expect(document.querySelector('[data-field="belts"]')).toHaveAttribute('data-state', 'auto-na'),
    );
  });
});

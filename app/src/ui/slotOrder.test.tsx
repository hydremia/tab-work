/** Workbook order on the unit page: Move up / down swaps slots with the neighbour of the same type. */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addEquipment, createProject } from '../data/repo';
import { SyncProvider } from '../sync/SyncProvider';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
}

describe('workbook order (jsdom)', () => {
  it('Move up swaps the slots of H-1 (added last) and its neighbour; the first unit cannot move up', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const h2 = await addEquipment(p.id, 'hood', 'H-2');
    const h3 = await addEquipment(p.id, 'hood', 'H-3');
    const h1 = await addEquipment(p.id, 'hood', 'H-1');
    await addEquipment(p.id, 'rtu', 'RTU-1'); // another type: not in the hoods' order
    expect([h2.slot, h3.slot, h1.slot]).toEqual([1, 2, 3]);
    renderAt(`/p/${p.id}/e/${h1.id}`);
    // the unit page is the heaviest screen: give its first render time under a loaded full-suite run
    expect(await screen.findByTestId('slot-order-text', {}, { timeout: 5000 })).toHaveTextContent(
      'slot 3 of 20: 3 of 3',
    );
    expect(screen.getByTestId('slot-down')).toBeDisabled();
    await user.click(screen.getByTestId('slot-up'));
    await waitFor(async () => expect((await db.equipment.get(h1.id))?.slot).toBe(2));
    expect((await db.equipment.get(h3.id))?.slot).toBe(3);
    await waitFor(() => expect(screen.getByTestId('slot-order-text')).toHaveTextContent('slot 2 of 20: 2 of 3'));
    await user.click(screen.getByTestId('slot-up'));
    await waitFor(async () => expect((await db.equipment.get(h1.id))?.slot).toBe(1));
    expect((await db.equipment.get(h2.id))?.slot).toBe(2);
    await waitFor(() => expect(screen.getByTestId('slot-up')).toBeDisabled());
    // the RTU kept its slot
    expect((await db.equipment.filter((e) => e.type === 'rtu').first())?.slot).toBe(1);
  });
});

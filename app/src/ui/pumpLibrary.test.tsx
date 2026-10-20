/**
 * The pump-curve editor on /library: two saves in one gesture (the points textarea's blur, then the click that blurred
 * it) must compose, not overwrite each other with the curves of the last render.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addLibraryPump } from '../data/repo';
import { SyncProvider } from '../sync/SyncProvider';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
}

describe('pump library (jsdom)', () => {
  it('typing points and clicking "Add impeller curve" in one go keeps the points and adds the curve', async () => {
    const user = userEvent.setup();
    const p = await addLibraryPump({ make: 'Test', model: 'TP', curves: [{ impeller: 8, points: [] }] });
    renderAt('/library');
    const item = await screen.findByTestId('pump-lib-item');
    const pts = within(item).getByLabelText('Points (GPM ft)');
    await user.click(pts);
    await user.type(pts, '0 60{enter}150 52');
    // the click blurs the textarea (save 1: the points) and adds a curve (save 2) before the live query re-rendered
    await user.click(within(item).getByTestId('add-pump-curve'));
    await waitFor(async () => expect((await db.libraryPumps.get(p.id))?.curves).toHaveLength(2));
    const saved = (await db.libraryPumps.get(p.id))!.curves!;
    expect(saved[0]).toEqual({
      impeller: 8,
      points: [
        { gpm: 0, head: 60 },
        { gpm: 150, head: 52 },
      ],
    });
    expect(saved[1]).toEqual({ impeller: 0, points: [] });
    await waitFor(() => expect(within(item).getAllByTestId('pump-curve')).toHaveLength(2));
  });

  it('removing a curve right after editing another keeps that edit', async () => {
    const user = userEvent.setup();
    const p = await addLibraryPump({
      make: 'Test',
      model: 'TP',
      curves: [
        { impeller: 8, points: [] },
        { impeller: 9, points: [{ gpm: 0, head: 76 }] },
      ],
    });
    renderAt('/library');
    const item = await screen.findByTestId('pump-lib-item');
    const pts = within(item).getAllByLabelText('Points (GPM ft)')[0];
    await user.click(pts);
    await user.type(pts, '0 60');
    await user.click(within(item).getByRole('button', { name: 'Remove the 9″ curve' }));
    await waitFor(async () => expect((await db.libraryPumps.get(p.id))?.curves).toHaveLength(1));
    expect((await db.libraryPumps.get(p.id))!.curves![0]).toEqual({ impeller: 8, points: [{ gpm: 0, head: 60 }] });
  });
});

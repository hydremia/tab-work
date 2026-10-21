/**
 * Review actions on the unit page: accept an out-of-tolerance line with a reason (red → amber, the unit green),
 * withdraw it, and turn an open issue into an observation without leaving the unit.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { addAirflowRow, addEquipment, addIssue, createProject, setFields } from '../data/repo';
import { SyncProvider } from '../sync/SyncProvider';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('accepted deviations and issue demotion on the unit page (jsdom)', () => {
  it('Accept… asks for a reason, turns the line amber and the status green; Withdraw makes it red again', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const e = await addEquipment(p.id, 'rtu', 'RTU-1');
    // an outlet at 120 % of design (Ak 1, design 500 CFM, final VEL 600)
    const row = await addAirflowRow(e, 'supply', { no: 'S-1', ak: 1, designCfm: 500, finalVel: 600 });
    renderAt(`/p/${p.id}/e/${e.id}`);
    const callout = await screen.findByTestId('tolerance-callout');
    expect(callout).toHaveTextContent('Supply outlets S-1 (120 %)');
    // no reason = no acceptance
    vi.spyOn(window, 'prompt').mockReturnValueOnce('   ');
    vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    await user.click(within(callout).getByTestId(`accept-${row.id}`));
    expect(window.alert).toHaveBeenCalled();
    expect((await db.equipment.get(e.id))?.accepted?.[row.id]).toBeFalsy();
    // with a reason
    vi.spyOn(window, 'prompt').mockReturnValueOnce('within ±20 % per the engineer, email 10/18');
    await user.click(within(callout).getByTestId(`accept-${row.id}`));
    await waitFor(async () =>
      expect((await db.equipment.get(e.id))?.accepted?.[row.id]).toMatchObject({
        ratio: 1.2,
        reason: 'within ±20 % per the engineer, email 10/18',
      }),
    );
    const accepted = await screen.findByTestId('accepted-callout');
    expect(accepted).toHaveTextContent('Supply outlets S-1 (120 %): within ±20 % per the engineer, email 10/18');
    expect(screen.queryByTestId('tolerance-callout')).toBeNull();
    // the % chip is amber (accepted), not red
    await waitFor(() => expect(document.querySelector('.pct[data-ok="accepted"]')).toBeTruthy());
    expect(document.querySelector('.pct[data-ok="false"]')).toBeNull();
    // a changed reading makes the acceptance stale: red again, with the Accept button back
    await setFields('airflowRows', row.id, { 'data.finalVel': 650 });
    await screen.findByTestId('tolerance-callout');
    expect(screen.queryByTestId('accepted-callout')).toBeNull();
    await setFields('airflowRows', row.id, { 'data.finalVel': 600 });
    await screen.findByTestId('accepted-callout');
    // withdraw
    await user.click(screen.getByTestId(`withdraw-${row.id}`));
    await waitFor(async () => expect((await db.equipment.get(e.id))?.accepted?.[row.id]).toBeNull());
    await screen.findByTestId('tolerance-callout');
  });

  it('an open issue on the unit can be closed or made an observation from the unit page', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const e = await addEquipment(p.id, 'rtu', 'RTU-1');
    const a = await addIssue(p.id, { kind: 'new', equipmentId: e.id, remark: 'Damper stuck' });
    const b = await addIssue(p.id, { kind: 'new', equipmentId: e.id, remark: 'Filters dirty' });
    renderAt(`/p/${p.id}/e/${e.id}`);
    const box = await screen.findByTestId('unit-issues');
    expect(box).toHaveTextContent('2 open issues');
    await user.click(within(box).getByTestId(`issue-observe-${a.id}`));
    await waitFor(async () => expect((await db.issues.get(a.id))?.issueType).toBe('observation'));
    await waitFor(() => expect(screen.getByTestId('unit-issues')).toHaveTextContent('1 open issue'));
    await user.click(within(screen.getByTestId('unit-issues')).getByTestId(`issue-close-${b.id}`));
    await waitFor(async () => expect((await db.issues.get(b.id))?.status).toBe('Closed'));
    await waitFor(() => expect(screen.queryByTestId('unit-issues')).toBeNull());
  });
});

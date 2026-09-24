/**
 * jsdom: install prompt (Chrome / Edge / Android and the iOS hint), update toast, export status and the export reminder
 * when leaving a project, Share… after an export (and the download fallback), custom scope for every type.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../App';
import { db } from '../data/db';
import { exportStatus } from '../data/exportStatus';
import { addEquipment, createProject, setField } from '../data/repo';
import type { Revision } from '../data/types';
import { captureInstallPrompt, resetPwaState, setUpdateAvailable } from '../pwaState';
import { SyncProvider } from '../sync/SyncProvider';
import { newRevisionBase, saveRevision } from '../workbook/revisions';
import { exportStateText } from './components/ExportReminder';
import { ShareFile } from './components/ShareFile';

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SyncProvider>
      <RouterProvider router={router} />
    </SyncProvider>,
  );
  return router;
}

async function recordExport(projectId: string, label = 'Prelim') {
  const rev: Revision = {
    ...newRevisionBase(projectId),
    id: crypto.randomUUID(),
    kind: 'export',
    label,
    fileName: `Job - TAB Report ${label}.xlsm`,
    size: 10,
    bytes: null,
    baseline: null,
  };
  await saveRevision(rev);
}

function fakeInstallEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(async () => undefined);
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

beforeEach(() => {
  resetPwaState();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('install prompt', () => {
  it('Chrome / Android: the captured prompt shows "Install app"; installing hides the card', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByTestId('install-prompt')).toBeNull(); // nothing to offer yet
    const e = fakeInstallEvent();
    act(() => captureInstallPrompt(e));
    expect(e.defaultPrevented).toBe(true);
    await user.click(await screen.findByTestId('install-app'));
    expect(e.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('install-prompt')).toBeNull());
  });

  it('iPhone: "Share → Add to Home Screen" hint; "Got it" is remembered', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    );
    renderAt('/');
    expect(await screen.findByTestId('install-ios-hint')).toHaveTextContent('Add to Home Screen');
    expect(screen.queryByTestId('install-app')).toBeNull();
    await user.click(screen.getByTestId('install-dismiss'));
    expect(screen.queryByTestId('install-prompt')).toBeNull();
    expect(localStorage.getItem('a2b-tab.install-dismissed')).toBe('1');
  });

  it('a dismissed hint stays hidden', async () => {
    localStorage.setItem('a2b-tab.install-dismissed', '1');
    renderAt('/');
    await screen.findByRole('heading', { name: 'Projects' });
    act(() => captureInstallPrompt(fakeInstallEvent()));
    expect(screen.queryByTestId('install-prompt')).toBeNull();
  });
});

describe('update toast', () => {
  it('"Update available": Reload activates the new version, Later hides it', async () => {
    const user = userEvent.setup();
    const apply = vi.fn(async () => undefined);
    renderAt('/');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByTestId('update-toast')).toBeNull();
    act(() => setUpdateAvailable(apply));
    expect(await screen.findByTestId('update-toast')).toHaveTextContent('Update available');
    await user.click(screen.getByTestId('update-reload'));
    expect(apply).toHaveBeenCalledTimes(1);
    act(() => setUpdateAvailable(apply));
    await user.click(await screen.findByTestId('update-later'));
    expect(screen.queryByTestId('update-toast')).toBeNull();
  });
});

describe('export status and reminder', () => {
  it('counts saved changes since the last export', async () => {
    const p = await createProject({ name: 'Job' });
    const s0 = await exportStatus(p.id);
    expect(s0.lastExportAt).toBeNull();
    expect(s0.changesSince).toBeGreaterThan(0); // the project and its default instruments
    expect(exportStateText(s0)).toMatch(/^Not exported yet · \d+ changes$/);
    await recordExport(p.id);
    const s1 = await exportStatus(p.id);
    expect(s1.changesSince).toBe(0);
    expect(exportStateText(s1)).toMatch(/^Last exported .+ \(Prelim\) · no changes since$/);
    await setField('projects', p.id, 'info.architect', 'Lionakis');
    await setField('projects', p.id, 'info.architect', 'Lionakis Inc.');
    expect((await exportStatus(p.id)).changesSince).toBe(2);
  });

  it('project card and Export tab show the state', async () => {
    const p = await createProject({ name: 'Job' });
    renderAt('/');
    expect(await screen.findByTestId('project-export-state')).toHaveTextContent('Not exported yet');
    expect(screen.getByTestId('project-export-state')).toHaveAttribute('data-tone', 'amber');
    await recordExport(p.id, 'Rev 1');
    await waitFor(() => expect(screen.getByTestId('project-export-state')).toHaveTextContent('(Rev 1) · no changes'));
  });

  it('leaving a project with unexported changes asks first: Leave / Go to Export / not today', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const router = renderAt(`/p/${p.id}/equipment`);
    await screen.findByRole('heading', { name: 'Equipment' });
    await screen.findByTestId('export-reminder-armed');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByTestId('export-reminder')).toHaveTextContent('Export before you leave?');
    await user.click(screen.getByTestId('export-reminder-export'));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${p.id}/export`));
    await waitFor(() => expect(screen.queryByTestId('export-reminder')).toBeNull());
    // leaving anyway
    await screen.findByTestId('export-reminder-armed');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(await screen.findByTestId('export-reminder-leave'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });

  it('"Don\'t remind me again today" and a fresh export both skip the reminder; moving inside the project never asks', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job' });
    const router = renderAt(`/p/${p.id}/equipment`);
    await screen.findByRole('heading', { name: 'Equipment' });
    await user.click(screen.getByRole('link', { name: 'Info' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/p/${p.id}/info`));
    expect(screen.queryByTestId('export-reminder')).toBeNull();
    await screen.findByTestId('export-reminder-armed');
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await user.click(await screen.findByTestId('export-reminder-snooze'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    await act(() => router.navigate(`/p/${p.id}/equipment`));
    await screen.findByRole('heading', { name: 'Equipment' });
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));

    const q = await createProject({ name: 'Exported' });
    await recordExport(q.id);
    await act(() => router.navigate(`/p/${q.id}/equipment`));
    await screen.findByRole('heading', { name: 'Equipment' });
    await user.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.queryByTestId('export-reminder')).toBeNull();
  });
});

describe('Share… after an export', () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);

  it('shares the file through the Web Share API where the browser can share it', async () => {
    const user = userEvent.setup();
    const share = vi.fn(async (_d: ShareData) => undefined);
    Object.assign(navigator, { share, canShare: () => true });
    try {
      const dl = vi.fn();
      render(<ShareFile bytes={bytes} fileName="Job - Photo Report.pdf" mime="application/pdf" onDownload={dl} />);
      await user.click(screen.getByTestId('share-file'));
      const file = share.mock.calls[0][0].files![0];
      expect(file.name).toBe('Job - Photo Report.pdf');
      expect(file.type).toBe('application/pdf');
      expect(dl).not.toHaveBeenCalled();
    } finally {
      Object.assign(navigator, { share: undefined, canShare: undefined });
    }
  });

  it('falls back to "Download again" where files can\'t be shared', async () => {
    const user = userEvent.setup();
    const dl = vi.fn();
    render(
      <ShareFile
        bytes={bytes}
        fileName="Job - TAB Report.xlsm"
        mime="application/vnd.ms-excel.sheet.macroEnabled.12"
        onDownload={dl}
      />,
    );
    expect(screen.queryByTestId('share-file')).toBeNull();
    await user.click(screen.getByTestId('share-file-download'));
    expect(dl).toHaveBeenCalledTimes(1);
  });
});

describe('custom scope (Info)', () => {
  it('lists every equipment type and switches a MAU section off', async () => {
    const user = userEvent.setup();
    const p = await createProject({ name: 'Job', scopeProfile: 'custom' });
    await addEquipment(p.id, 'mau', 'MAU-1');
    renderAt(`/p/${p.id}/info`);
    for (const t of ['rtu', 'mau', 'erv', 'fan', 'smallFan', 'vav', 'hood', 'traverse'])
      expect(await screen.findByTestId(`scope-${t}`)).toBeInTheDocument();
    const mau = screen.getByTestId('scope-mau');
    await user.click(mau.querySelector('summary')!);
    const chip = Array.from(mau.querySelectorAll('button')).find((b) => b.textContent === 'Static pressure profile')!;
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    await waitFor(async () => expect((await db.projects.get(p.id))?.customScope.mau?.static).toBe(false));
    await waitFor(() => expect(screen.getByTestId('scope-mau')).toHaveTextContent('1 of'));
  });
});

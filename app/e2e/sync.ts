/**
 * E2E: two devices syncing through the fake cloud (a build with VITE_FAKE_SYNC=1, served by deploy/serve-dist.ts with
 * SERVE_FAKE_SYNC=1: the in-memory server with the rules of supabase/migrations/0003), each device its own browser
 * context (own IndexedDB):
 *   device A (Alice): a project imported while signed out -> Sync & account -> Sign in (redirect to /auth/callback)
 *   -> "Move projects to the cloud" lists it -> Upload -> Synced. Device B (Bob): signs in, the project arrives.
 *   Both go offline and change RTU-1's serial (A first, then B) -> A reconnects, then B, then A syncs again ->
 *   the later value (B's) is on both; both show the conflict: badge on the unit card, the flagged field, the
 *   Attention tab's Conflicts group with both values -> A restores its value ("Use …") -> B gets it, B's conflict
 *   is settled. Both add an RTU offline (same workbook slot) -> after syncing, the later one is in the next slot on
 *   both devices with a note. Sign-out on B warns about nothing (all synced) and keeps the project; A signs out and
 *   removes the data from the device (project list empty).
 * Screenshot: docs/screenshots/29-conflict.png (A's Attention tab).
 */
import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';

type Check = (name: string, ok: boolean, detail?: string) => void;

const field = (page: Page, key: string) => page.locator(`[data-field="${key}"] input`).first();

async function device(browser: Browser, email: string) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
  });
  await context.addInitScript(`localStorage.setItem('tab.fakeSync.email', ${JSON.stringify(email)});`);
  const page = await context.newPage();
  const errors: string[] = [];
  const dialogs: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // going offline makes the sync's fetches fail: expected, not a page error
    if (m.type() === 'error' && !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::/i.test(m.text()))
      errors.push(m.text());
  });
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  return { context, page, errors, dialogs };
}

/** Wait until the status pill says Synced (after a reload, which also starts a sync). */
async function synced(page: Page, reload = false) {
  if (reload) await page.reload();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sync-status"]')?.textContent?.trim() === 'Synced',
    null,
    { timeout: 20_000 },
  );
}

async function signIn(page: Page, base: string) {
  await page.goto(`${base}/account`);
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/callback') && !u.pathname.startsWith('/account'), {
    timeout: 15_000,
  });
}

async function offlineEdit(ctx: BrowserContext, page: Page, value: string) {
  await ctx.setOffline(true);
  await page.waitForFunction(() =>
    /offline/i.test(document.querySelector('[data-testid="sync-status"]')?.textContent ?? ''),
  );
  await field(page, 'serial').fill(value);
  await field(page, 'serial').blur();
  await page.waitForTimeout(500);
}

export async function syncFlow(
  browser: Browser,
  base: string,
  workbookFile: string,
  docShots: string,
  check: Check,
  shots: string,
) {
  const A = await device(browser, 'alice@a2b.test');
  const B = await device(browser, 'bob@a2b.test');
  try {
    // ------------------------------------------------ A: local project, then first sign-in moves it to the cloud
    await A.page.goto(`${base}/import`);
    const signedOut = await A.page
      .getByTestId('signed-out-banner')
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
    check('fake cloud build: signed out at first (banner)', signedOut);
    await A.page.locator('input[aria-label="Workbook file"]').setInputFiles(workbookFile);
    await A.page.getByTestId('import-create').click();
    await A.page.getByTestId('equip-RTU-1').waitFor();
    const projectPath = new URL(A.page.url()).pathname.replace(/\/equipment$/, '');
    await signIn(A.page, base);
    await A.page.getByTestId('setup-banner').waitFor();
    await A.page.getByTestId('setup-banner').getByRole('link', { name: 'Choose' }).click();
    const setup = A.page.getByTestId('cloud-setup');
    await setup.waitFor();
    const listed = await setup.innerText();
    await A.page.screenshot({ path: join(shots, 'sync-cloud-setup.png') });
    check(
      'first sign-in lists the local project to move to the cloud',
      /Riverside Medical Office/.test(listed) && (await A.page.getByTestId('cloud-setup-project').count()) === 1,
      listed.replace(/\s+/g, ' ').slice(0, 160),
    );
    await A.page.getByTestId('cloud-setup-upload').click();
    await synced(A.page);
    check('A: uploaded through the normal push (pill: Synced)', true);

    // ------------------------------------------------ B signs in, gets the project
    await signIn(B.page, base);
    await synced(B.page);
    await B.page.getByTestId('project-card').first().waitFor({ timeout: 15_000 });
    check(
      'B: the project arrives after sign-in',
      /Riverside Medical Office/.test(await B.page.getByTestId('project-card').first().innerText()),
    );

    // ------------------------------------------------ both offline, same field
    for (const d of [A, B]) {
      await d.page.goto(`${base}${projectPath}/equipment`);
      await d.page.getByTestId('equip-RTU-1').click();
      await d.page.waitForURL(/\/e\//);
      await field(d.page, 'serial').waitFor();
    }
    const unitUrl = A.page.url();
    await offlineEdit(A.context, A.page, 'SN-ALICE');
    await offlineEdit(B.context, B.page, 'SN-BOB');
    await A.context.setOffline(false);
    await synced(A.page);
    await B.context.setOffline(false);
    await synced(B.page);
    await synced(A.page, true); // A pulls B's later edit
    const aVal = await field(A.page, 'serial').inputValue();
    const bVal = await field(B.page, 'serial').inputValue();
    check('later edit wins on both devices', aVal === 'SN-BOB' && bVal === 'SN-BOB', `A ${aVal}, B ${bVal}`);
    const flagA = await A.page.locator('[data-field="serial"] [data-testid="conflict-flag"]').count();
    await A.page.getByTestId('unit-conflicts').scrollIntoViewIfNeeded();
    await A.page.screenshot({ path: join(shots, 'sync-unit-conflict.png') });
    await A.page.locator('[data-field="serial"]').scrollIntoViewIfNeeded();
    await A.page.screenshot({ path: join(shots, 'sync-field-flag.png') });
    await B.page.reload();
    await B.page.getByTestId('unit-conflicts').waitFor({ timeout: 10_000 });
    check(
      'both devices flag the field and list the conflict on the unit page',
      flagA === 1 && (await A.page.getByTestId('unit-conflicts').isVisible()),
    );

    // ------------------------------------------------ A: the Attention tab, restore A's value
    await A.page.goto(`${base}${projectPath}/equipment`);
    const cardFlag = await A.page
      .getByTestId('equip-RTU-1')
      .getByTestId('conflict-flag')
      .waitFor({ timeout: 10_000 })
      .then(
        () => 1,
        () => 0,
      );
    await A.page.goto(`${base}${projectPath}/attention`);
    const group = A.page.getByTestId('attention-conflicts');
    await group.waitFor();
    const text = await group.innerText();
    check(
      'Attention tab: Conflicts group with both values; unit card badge',
      cardFlag === 1 && /RTU-1/.test(text) && /SN-BOB/.test(text) && /SN-ALICE/.test(text) && /This device/.test(text),
      text.replace(/\s+/g, ' ').slice(0, 200),
    );
    await group.scrollIntoViewIfNeeded();
    await A.page.screenshot({ path: join(docShots, '29-conflict.png') });
    await group.getByTestId('conflict-restore').click();
    await group.waitFor({ state: 'detached' });
    await synced(A.page);
    await B.page.goto(unitUrl);
    await synced(B.page, true);
    await field(B.page, 'serial').waitFor();
    const restored = await field(B.page, 'serial').inputValue();
    check(
      'resolve: A restores its value -> synced to B, B’s conflict settled',
      restored === 'SN-ALICE' && (await B.page.getByTestId('unit-conflicts').count()) === 0,
      `B serial ${restored}`,
    );

    // ------------------------------------------------ both offline add a unit: the same workbook slot, resolved on pull
    for (const d of [A, B]) {
      await d.page.goto(`${base}${projectPath}/add`);
      await d.page.locator('#eq-designation').waitFor();
    }
    await A.context.setOffline(true);
    await B.context.setOffline(true);
    const addUnit = async (d: typeof A, name: string) => {
      await d.page.locator('#eq-designation').fill(name);
      await d.page.getByRole('button', { name: `Add ${name}` }).click();
      await d.page.waitForURL(/\/e\//);
      return d.page.url();
    };
    await addUnit(A, 'RTU-A');
    const bUnitUrl = await addUnit(B, 'RTU-B');
    await A.context.setOffline(false);
    await synced(A.page);
    await B.context.setOffline(false);
    await synced(B.page);
    await synced(A.page, true);
    await B.page.goto(bUnitUrl);
    const noteB = await B.page.getByTestId('slot-move-note').innerText({ timeout: 10_000 });
    await A.page.goto(bUnitUrl);
    const noteA = await A.page.getByTestId('slot-move-note').innerText({ timeout: 10_000 });
    await A.page.goto(`${base}${projectPath}/attention`);
    await A.page.getByTestId('tab-count-attention').waitFor();
    const collisionListed = await A.page
      .locator('[data-testid="attention-item"]', { hasText: 'both use slot' })
      .count();
    check(
      'slot collision: both devices added RTU in slot 3 offline -> the later push moved to slot 4 on both, with a note',
      /Moved from workbook slot 3 to slot 4 because another device used slot 3 for RTU-A/.test(noteB) &&
        noteA === noteB &&
        collisionListed === 0,
      `${noteB} / ${noteA} / listed ${collisionListed}`,
    );
    await B.page.goto(bUnitUrl);
    await B.page.getByTestId('slot-move-note').scrollIntoViewIfNeeded();
    await B.page.screenshot({ path: join(shots, 'sync-slot-move.png') });

    // ------------------------------------------------ sign-out keeps the data
    await B.page.goto(`${base}/account`);
    await B.page.getByTestId('account-signed-in').waitFor();
    await B.page.screenshot({ path: join(shots, 'sync-account.png') });
    await B.page.getByTestId('sign-out').click();
    await B.page.getByTestId('account-signin').waitFor();
    await B.page.goto(base);
    check(
      'sign-out: confirmed, the project stays on the device, "Not signed in"',
      B.dialogs.some((d) => /Sign out/.test(d) && !/not synced yet/.test(d)) &&
        (await B.page.getByTestId('project-card').count()) === 1 &&
        /Not signed in/.test(await B.page.getByTestId('sync-status').innerText()),
    );
    // ------------------------------------------------ A: sign out and remove the data (shared device)
    await A.page.goto(`${base}/account`);
    await A.page.getByTestId('account-signed-in').waitFor();
    await A.page.getByTestId('sign-out-remove').click();
    await A.page.waitForURL((u) => u.pathname === '/', { timeout: 15_000 });
    await A.page.getByText('No projects yet').waitFor({ timeout: 15_000 });
    const dbs = await A.page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    check(
      'sign out and remove data: warned, signed out, no projects left, then the app works (fresh database)',
      A.dialogs.some((d) => /remove all projects, photos and settings/.test(d)) &&
        (await A.page.getByTestId('project-card').count()) === 0 &&
        /Not signed in/.test(await A.page.getByTestId('sync-status').innerText()),
      `${A.dialogs.at(-1)?.slice(0, 120)} / dbs ${dbs.join(',')}`,
    );
    check(
      'sync e2e: no page errors',
      A.errors.length + B.errors.length === 0,
      [...A.errors, ...B.errors].slice(0, 3).join(' | '),
    );
  } finally {
    await A.context.close();
    await B.context.close();
  }
}

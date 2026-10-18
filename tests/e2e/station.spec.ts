import { test, expect } from '@playwright/test';

test('city, selections, keyboard attention, and every asset work without remote requests', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).hostname !== '127.0.0.1'
    )
      externalRequests.push(request.url());
  });
  await page.goto('/?demo');
  // Home is the active-sessions view: only projects with sessions, each with its helpers.
  await expect(
    page.getByRole('heading', { name: 'Active sessions' }),
  ).toBeVisible();
  // Eleven sessions plus two subagent helper figures.
  await expect(page.locator('[data-model-ready]')).toHaveCount(13, {
    timeout: 30_000,
  });
  await expect(page.locator('canvas')).toBeVisible();
  // Eight projects with sessions and one folder outside every repository.
  await expect(page.locator('.site-label')).toHaveCount(9);
  await expect(page.locator('.session-bubble')).toHaveCount(11);
  await expect(page.locator('.helper-chip')).toHaveCount(18);
  await expect(
    page.locator('.helper-chip.active', { hasText: 'Blender' }),
  ).toBeVisible();
  await expect(
    page.locator('.session-bubble', {
      hasText: 'Waiting on Blender · execute_blender_code',
    }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('sessions.png'),
    fullPage: true,
  });
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.plot-label')).toHaveCount(15);
  await expect(page.locator('[data-model-ready]')).toHaveCount(11);
  await page.screenshot({
    path: testInfo.outputPath('city.png'),
    fullPage: true,
  });
  await page.getByLabel('Select repository').selectOption('rust-indexer');
  await expect(
    page.getByRole('heading', { name: 'rust-indexer', exact: true }),
  ).toBeVisible();
  await page.locator('.plot-label').filter({ hasText: 'docs-portal' }).click();
  await expect(
    page.getByRole('heading', { name: 'docs-portal', exact: true }),
  ).toBeVisible();
  // Every demo repository carries a rule-based assessment.
  await expect(
    page.getByRole('heading', { name: /^Established Score \d+\/100$/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Focus\b/ }).click();
  // N walks through the sessions that need you, in order.
  await page.locator('#main').focus();
  await page.keyboard.press('n');
  await expect(
    page.getByRole('heading', { name: 'Cursor · nabi-station 78b3' }),
  ).toBeVisible();
  await page.locator('#main').focus();
  await page.keyboard.press('n');
  await expect(
    page.getByRole('heading', { name: 'Claude Code · refunds' }),
  ).toBeVisible();
  await expect(
    page.getByText('Inferred · low confidence', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.helper-row')).toHaveCount(2);
  // Example recommendations, labelled as such, with a copyable fix prompt.
  await page.getByLabel('Select repository').selectOption('nabi-station');
  await expect(page.locator('.recommendations-card')).toContainText(
    'demo example',
  );
  await page.getByRole('button', { name: 'Open recommendations' }).click();
  const dialog = page.getByRole('dialog', { name: 'nabi-station' });
  await expect(dialog.locator('.improvement')).toHaveCount(4);
  await expect(dialog).toContainText('Example recommendations for the demo');
  await expect(
    dialog.getByRole('button', { name: 'Copy fix prompt' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('recommendations.png'),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page
    .getByRole('button', { name: 'Asset gallery', exact: true })
    .click();
  await expect(page.locator('[data-model-ready]')).toHaveCount(3);
  await page.getByLabel('Animation clip').selectOption('walk');
  await expect(page.locator('[data-animation="walk"]')).toHaveCount(3);
  await page.screenshot({
    path: testInfo.outputPath('characters.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Helpers', exact: true }).click();
  await expect(page.locator('.gallery-label')).toHaveCount(13);
  await expect(page.locator('[data-model-ready]')).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath('helpers.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Buildings', exact: true }).click();
  await page.getByRole('slider', { name: 'Building tier' }).fill('4');
  await expect(page.getByText('Landmark', { exact: true })).toBeVisible();
  // One showcase building per style.
  await expect(page.locator('.gallery-label')).toHaveCount(8);
  await page.screenshot({
    path: testInfo.outputPath('buildings.png'),
    fullPage: true,
  });
  // Regression: repeated gallery transitions must clean up every projected DOM label.
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.locator('[data-model-ready]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.plot-label')).toHaveCount(15);
  await expect(page.locator('.gallery-label')).toHaveCount(0);
  await expect(page.locator('[data-model-ready]')).toHaveCount(11);
  await page
    .getByRole('button', { name: 'Active sessions', exact: true })
    .click();
  await expect(page.locator('.plot-label')).toHaveCount(0);
  await expect(page.locator('.helper-chip')).toHaveCount(18);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('scrolling on a workspace label still zooms the city', async ({
  page,
}) => {
  await page.goto('/?demo');
  await page.getByRole('checkbox', { name: 'Reduced motion' }).check();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  const label = page.locator('.plot-label', { hasText: 'docs-portal' });
  await expect(label).toBeVisible();
  const box = await label.boundingBox();
  expect(box).not.toBeNull();
  // The name itself is the hit target, not a layer stretched over the city.
  expect(box!.width).toBeLessThan(180);
  expect(box!.height).toBeLessThan(40);
  const canvas = page.locator('canvas');
  const before = await canvas.screenshot();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -700);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const after = await canvas.screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await label.click();
  await expect(
    page.getByRole('heading', { name: 'docs-portal', exact: true }),
  ).toBeVisible();
});

test('mobile navigation and system reduced-motion preference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?demo');
  await expect(
    page.getByRole('checkbox', { name: 'Reduced motion' }),
  ).toBeChecked();
  await page.getByLabel('Select repository').selectOption('docs-portal');
  await expect(
    page.getByRole('heading', { name: 'docs-portal', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('without a daemon the city shows no invented data', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Not connected to the Nabi daemon' }),
  ).toBeVisible();
  await expect(page.locator('.plot-label')).toHaveCount(0);
  await expect(page.locator('.repo-button')).toHaveCount(0);
  await expect(page.getByText('D:/work')).toHaveCount(0);
  await expect(page.getByText('nabi-station')).toHaveCount(0);
});

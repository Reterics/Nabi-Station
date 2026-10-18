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
  // Five sessions plus one subagent helper figure.
  await expect(page.locator('[data-model-ready]')).toHaveCount(6, {
    timeout: 30_000,
  });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.site-label')).toHaveCount(4);
  await expect(page.locator('.session-bubble')).toHaveCount(5);
  await expect(page.locator('.helper-chip')).toHaveCount(9);
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
  await expect(page.locator('.plot-label')).toHaveCount(6);
  await expect(page.locator('[data-model-ready]')).toHaveCount(5);
  await page.screenshot({
    path: testInfo.outputPath('city.png'),
    fullPage: true,
  });
  await page.getByLabel('Select repository').selectOption('forge-engine');
  await expect(
    page.getByRole('heading', { name: 'forge-engine', exact: true }),
  ).toBeVisible();
  await page.locator('.plot-label').filter({ hasText: 'field-notes' }).click();
  await expect(
    page.getByRole('heading', { name: 'field-notes', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Focus\b/ }).click();
  await page.locator('#main').focus();
  await page.keyboard.press('n');
  await expect(
    page.getByRole('heading', { name: 'Claude Code', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Reported state', { exact: true })).toBeVisible();
  await expect(page.locator('.helper-row')).toHaveCount(2);
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
  await expect(page.locator('.gallery-label')).toHaveCount(6);
  await page.screenshot({
    path: testInfo.outputPath('buildings.png'),
    fullPage: true,
  });
  // Regression: repeated gallery transitions must clean up every projected DOM label.
  await page.getByRole('button', { name: 'Characters', exact: true }).click();
  await expect(page.locator('[data-model-ready]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await expect(page.locator('.plot-label')).toHaveCount(6);
  await expect(page.locator('.gallery-label')).toHaveCount(0);
  await expect(page.locator('[data-model-ready]')).toHaveCount(5);
  await page
    .getByRole('button', { name: 'Active sessions', exact: true })
    .click();
  await expect(page.locator('.plot-label')).toHaveCount(0);
  await expect(page.locator('.helper-chip')).toHaveCount(9);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
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
  await page.getByLabel('Select repository').selectOption('field-notes');
  await expect(
    page.getByRole('heading', { name: 'field-notes', exact: true }),
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
  await expect(page.getByText('D:/workspace')).toHaveCount(0);
  await expect(page.getByText('nabi-station')).toHaveCount(0);
});

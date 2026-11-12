import { expect, test, type Page } from '@playwright/test';

/** Numeric style drafts live in the "Schriftgröße" popover of the selection toolbar (#37, #40). */
async function fontSizeField(page: Page) {
  if (!await page.getByRole('group', { name: 'Schriftgröße' }).isVisible()) await page.getByRole('button', { name: /^Schriftgröße/ }).click();
  return page.getByRole('spinbutton', { name: 'Schriftgröße', exact: true });
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 480, height: 720 }]) {
  test(`feedback keeps draft recovery and dismiss controls reachable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(300, 260); await page.mouse.down();
    await page.mouse.move(420, 350); await page.mouse.up();
    const size = await fontSizeField(page);
    await expect(size).toHaveValue('20');

    // A real invalid domain command retains its draft and displays a notice.
    // Both controls must remain usable without dismissing the notice first.
    await size.fill('-1');
    await expect(size).toHaveValue('-1');
    await page.keyboard.press('Tab');
    await expect(size).toHaveValue('-1');
    await expect(size).not.toHaveAttribute('placeholder', 'Verschieden');
    const notice = page.getByRole('region', { name: 'Meldungen' }).locator('.notice');
    await expect(notice).toBeVisible();
    const recovery = page.locator('.property-draft');
    await expect(recovery).toBeVisible();
    const noticeBounds = await notice.boundingBox();
    const recoveryBounds = await recovery.boundingBox();
    expect(noticeBounds!.y + noticeBounds!.height).toBeLessThanOrEqual(recoveryBounds!.y);
    await page.screenshot({ path: testInfo.outputPath('draft-feedback.png') });
    await recovery.getByRole('button', { name: 'Verwerfen', exact: true }).click();
    await expect(recovery).not.toBeVisible();
    await expect(size).toHaveValue('20');
    await page.getByRole('button', { name: 'Meldung schließen', exact: true }).click();
    await expect(notice).not.toBeVisible();
    await expect(page.locator('[data-render-state=document][data-kind=rectangle]')).toHaveCount(1);
  });
}

test('a shared style draft replaces a mixed value and commits to both elements', async ({ page }) => {
  await page.goto('/');
  for (const [x, width] of [[300, 120], [600, 180]] as const) {
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(x, 260); await page.mouse.down();
    await page.mouse.move(x + width, 350); await page.mouse.up();
  }
  await expect(page.locator('[data-render-state=document][data-kind=rectangle]')).toHaveCount(2);
  // The second rectangle is still selected; give it a different font size so the values are mixed.
  await page.getByRole('button', { name: /^Schriftgröße/ }).click();
  await page.getByRole('button', { name: /^Groß/ }).click();
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('ControlOrMeta+a');
  const size = await fontSizeField(page);
  await expect(size).toHaveAttribute('placeholder', 'Verschieden');
  await size.fill('24');
  await expect(size).toHaveValue('24');
  await expect(size).not.toHaveAttribute('placeholder', 'Verschieden');
  await page.keyboard.press('Tab');
  await expect(page.locator('.property-draft')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Schriftgröße: 24 px' })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(size).toHaveAttribute('placeholder', 'Verschieden');
});

test('hints appear at the bottom right above the minimap, replace a repeated one and leave after three seconds (#166)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(300, 260); await page.mouse.down();
  await page.mouse.move(420, 350); await page.mouse.up();
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  const notices = page.getByRole('region', { name: 'Meldungen' }).locator('.notice');
  await page.keyboard.press(`${modifier}+C`);
  await expect(notices).toHaveCount(1);
  const shownAt = Date.now();
  // The same message again replaces the visible one.
  await page.keyboard.press(`${modifier}+C`);
  await expect(notices).toHaveCount(1);
  const notice = await notices.boundingBox();
  const minimap = await page.getByTestId('minimap').boundingBox();
  expect(notice).not.toBeNull(); expect(minimap).not.toBeNull();
  // Right aligned with the minimap and directly above it.
  expect(Math.abs((notice!.x + notice!.width) - (minimap!.x + minimap!.width))).toBeLessThanOrEqual(1);
  expect(notice!.y + notice!.height).toBeLessThanOrEqual(minimap!.y);
  expect(minimap!.y - (notice!.y + notice!.height)).toBeLessThanOrEqual(12);
  expect(notice!.x).toBeGreaterThan(1280 / 2);
  // Hovering holds the hint; leaving restarts the three seconds.
  await notices.hover();
  await page.waitForTimeout(3400);
  await expect(notices).toHaveCount(1);
  await page.mouse.move(200, 500);
  await page.waitForTimeout(2000);
  await expect(notices).toHaveCount(1);
  await expect(notices).toHaveCount(0, { timeout: 2500 });
  expect(Date.now() - shownAt).toBeGreaterThan(6000);
});

test('without a minimap hints rest above the bottom bar on the right', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 720 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(200, 260); await page.mouse.down();
  await page.mouse.move(320, 350); await page.mouse.up();
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+C`);
  const notice = page.getByRole('region', { name: 'Meldungen' }).locator('.notice');
  await expect(notice).toHaveCount(1);
  await expect(page.getByTestId('minimap')).toBeHidden();
  const box = await notice.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(700 - 12 + 1);
  expect(box!.x + box!.width).toBeGreaterThan(700 - 20);
  // Above the bottom bar (inset + bar height + gap).
  expect(box!.y + box!.height).toBeLessThanOrEqual(720 - 76 + 1);
  await expect(notice).toHaveCount(0, { timeout: 4500 });
});

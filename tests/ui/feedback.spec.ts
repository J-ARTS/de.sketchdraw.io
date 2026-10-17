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

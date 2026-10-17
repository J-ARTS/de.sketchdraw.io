import { expect, test, type Page } from '@playwright/test';

/** Geometry fields live in the "Position und Größe" popover of the selection toolbar (#37). */
async function geometry(page: Page) {
  if (!await page.getByRole('group', { name: 'Position und Größe' }).isVisible()) await page.getByRole('button', { name: 'Position und Größe' }).click();
}

for (const viewport of [{ width: 1280, height: 900 }, { width: 480, height: 720 }]) {
  test(`feedback keeps draft recovery and dismiss controls reachable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(300, 260); await page.mouse.down();
    await page.mouse.move(420, 350); await page.mouse.up();
    await geometry(page);
    const width = page.getByRole('spinbutton', { name: 'Breite', exact: true });
    await expect(width).toHaveValue('120');

    // A real invalid domain command retains its draft and displays a notice.
    // Both controls must remain usable without dismissing the notice first.
    await width.fill('-1');
    await expect(width).toHaveValue('-1');
    await page.keyboard.press('Tab');
    await expect(width).toHaveValue('-1');
    await expect(width).not.toHaveAttribute('placeholder', 'Verschieden');
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
    await expect(width).toHaveValue('120');
    await page.getByRole('button', { name: 'Meldung schließen', exact: true }).click();
    await expect(notice).not.toBeVisible();
    await expect(page.locator('[data-render-state=document][data-kind=rectangle]')).toHaveCount(1);
  });
}

test('a shared geometry draft replaces only its mixed field and commits to both elements', async ({ page }) => {
  await page.goto('/');
  for (const [x, width] of [[300, 120], [600, 180]] as const) {
    await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
    await page.mouse.move(x, 260); await page.mouse.down();
    await page.mouse.move(x + width, 350); await page.mouse.up();
  }
  await expect(page.locator('[data-render-state=document][data-kind=rectangle]')).toHaveCount(2);
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('ControlOrMeta+a');
  await geometry(page);
  const width = page.getByRole('spinbutton', { name: 'Breite', exact: true });
  const x = page.getByRole('spinbutton', { name: 'X', exact: true });
  await expect(width).toHaveAttribute('placeholder', 'Verschieden');
  await expect(x).toHaveAttribute('placeholder', 'Verschieden');
  await width.fill('200');
  await expect(width).toHaveValue('200');
  await expect(width).not.toHaveAttribute('placeholder', 'Verschieden');
  await expect(x).toHaveAttribute('placeholder', 'Verschieden');
  await page.keyboard.press('Tab');
  await expect(page.locator('.property-draft')).not.toBeVisible();
  expect(await page.locator('[data-render-state=document][data-kind=rectangle] > g > rect').evaluateAll(elements => elements.map(element => element.getAttribute('width')))).toEqual(['200', '200']);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(width).toHaveAttribute('placeholder', 'Verschieden');
});

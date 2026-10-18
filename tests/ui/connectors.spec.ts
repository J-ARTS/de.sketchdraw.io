import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function rectangle(page: Page, x: number, y = 300) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 150, y + 100, { steps: 6 }); await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a connector binds two elements and exposes the FigJam-style controls', async ({ page }) => {
  await rectangle(page, 220); await rectangle(page, 700, 460);
  const shapes = page.locator('.whiteboard-canvas [data-kind=rectangle]');
  await expect(shapes).toHaveCount(2);

  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(300, 350); await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 });
  await expect(page.getByTestId('connector-source-highlight')).toBeVisible();
  await expect(page.getByTestId('connector-target-highlight')).toBeVisible();
  await page.mouse.up();

  const connector = page.locator('.whiteboard-canvas [data-kind=connector]');
  await expect(connector).toHaveCount(1);
  const path = connector.locator('path').last();
  const paint = connector.locator(':scope > g').first();
  await expect(path).toHaveAttribute('marker-end', /line-arrow/);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  for (const name of ['Farbe', 'Linie', 'Text hinzufügen oder bearbeiten']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Linienform:/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Startpunkt:/ })).toBeVisible();
  await expect(bar.getByRole('button', { name: /^Endpunkt:/ })).toBeVisible();

  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
  await page.getByRole('group', { name: 'Farbe', exact: true }).getByRole('button', { name: 'Linie Rot' }).click();
  await expect(paint).toHaveAttribute('stroke', '#e5533a');
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Gebogen' }).click();
  await expect(path).toHaveAttribute('d', /C/);
  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Rechtwinklig' }).click();
  await expect(bar.getByRole('button', { name: 'Linienform: Rechtwinklig' })).toBeVisible();
  const routeHandles = page.locator('[data-testid^="connector-handle-"]');
  await expect(routeHandles).toHaveCount(4);
  const bend = page.getByTestId('connector-handle-1');
  const bendBox = (await bend.boundingBox())!;
  const beforeRoute = await path.getAttribute('d');
  await page.mouse.move(bendBox.x + bendBox.width / 2, bendBox.y + bendBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(bendBox.x + bendBox.width / 2 + 36, bendBox.y + bendBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => path.getAttribute('d')).not.toBe(beforeRoute);
  await expect(routeHandles).toHaveCount(4);

  await bar.getByRole('button', { name: /^Startpunkt:/ }).click();
  await page.getByRole('group', { name: 'Startpunkt' }).getByRole('button', { name: 'Kreis' }).click();
  await expect(path).toHaveAttribute('marker-start', /circle/);

  await bar.getByRole('button', { name: /^Endpunkt:/ }).click();
  await page.getByRole('group', { name: 'Endpunkt' }).getByRole('button', { name: 'Raute' }).click();
  await expect(path).toHaveAttribute('marker-end', /diamond/);

  await bar.getByRole('button', { name: 'Linie', exact: true }).click();
  await page.getByRole('group', { name: 'Linie', exact: true }).getByRole('button', { name: 'Gestrichelt' }).click();
  await expect(paint).toHaveAttribute('stroke-dasharray', '8 6');
  await page.getByRole('group', { name: 'Linie', exact: true }).getByRole('button', { name: 'Linienstärke Dick' }).click();
  await expect(paint).toHaveAttribute('stroke-width', '4');

  await bar.getByRole('button', { name: 'Text hinzufügen oder bearbeiten' }).click();
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('API-Aufruf');
  await expect(bar).toBeVisible();
  await editor.press('ControlOrMeta+Enter');
  await expect(connector.locator('text').filter({ hasText: 'API-Aufruf' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const code = await page.getByTestId('diagram-code').inputValue();
  expect(code).toContain('"connectorRouting":"elbowed"');
  expect(code).toContain('"startMarker":"circle"');
  expect(code).toContain('"endMarker":"diamond"');
  expect(code).toContain('"from"'); expect(code).toContain('"to"');
});

test('free and self connections are rejected without adding an element', async ({ page }) => {
  await rectangle(page, 350);
  const connectors = page.locator('.whiteboard-canvas [data-kind=connector]');
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(700, 600); await page.mouse.down(); await page.mouse.move(760, 640); await page.mouse.up();
  await expect(connectors).toHaveCount(0);

  await page.mouse.move(390, 340); await page.mouse.down(); await page.mouse.move(450, 370, { steps: 4 }); await page.mouse.up();
  await expect(connectors).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Meldungen' }).getByText(/anderes Element/)).toBeVisible();
});

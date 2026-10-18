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
  await rectangle(page, 220); await rectangle(page, 700, 460); await rectangle(page, 1000, 300);
  const shapes = page.locator('.whiteboard-canvas [data-kind=rectangle]');
  await expect(shapes).toHaveCount(3);
  const sourceId = await shapes.nth(0).getAttribute('data-element-id');
  const targetId = await shapes.nth(1).getAttribute('data-element-id');

  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(300, 350);
  await expect(page.getByTestId('whiteboard-canvas')).toHaveAttribute('data-connector-dock-target', sourceId!);
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${sourceId}"] [data-testid="connector-dock-point"]`)).toHaveCount(4);
  await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 });
  await expect(page.getByTestId('connector-source-highlight')).toBeVisible();
  await expect(page.getByTestId('connector-target-highlight')).toBeVisible();
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${sourceId}"] [data-testid="connector-dock-point"]`)).toHaveCount(4);
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${targetId}"] [data-testid="connector-dock-point"]`)).toHaveCount(4);
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
  const endpointHandles = page.locator('[data-testid^="connector-endpoint-handle-"]');
  const segmentHandles = page.locator('[data-testid^="connector-segment-handle-"]');
  await expect(endpointHandles).toHaveCount(2);
  await expect(segmentHandles).toHaveCount(3);
  const middleSegment = page.getByTestId('connector-segment-handle-1');
  await expect(middleSegment).toHaveAttribute('data-orientation', 'vertical');
  const bendBox = (await middleSegment.boundingBox())!;
  await page.mouse.click(600, 700);
  await expect(segmentHandles).toHaveCount(0);
  await page.mouse.move(bendBox.x + bendBox.width / 2 + 1, bendBox.y + bendBox.height / 2);
  await expect(segmentHandles).toHaveCount(3);
  await page.mouse.move(bendBox.x + bendBox.width / 2, bendBox.y + bendBox.height / 2);
  await expect(middleSegment).toHaveAttribute('data-hovered', 'true');
  await expect(page.getByTestId('whiteboard-canvas')).toHaveCSS('cursor', 'ew-resize');
  const beforeRoute = await path.getAttribute('d');
  await page.mouse.down();
  await page.mouse.move(bendBox.x + bendBox.width / 2 + 36, bendBox.y + bendBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => path.getAttribute('d')).not.toBe(beforeRoute);
  await expect(segmentHandles).toHaveCount(3);

  const firstSegment = page.getByTestId('connector-segment-handle-0');
  const firstBox = (await firstSegment.boundingBox())!;
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
  await expect(firstSegment).toHaveAttribute('data-hovered', 'true');
  await expect(page.getByTestId('whiteboard-canvas')).toHaveCSS('cursor', 'ns-resize');
  await page.mouse.down();
  await page.mouse.move(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2 - 42, { steps: 4 });
  await page.mouse.up();
  await expect(segmentHandles).toHaveCount(5);

  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Gerade' }).click();
  await expect(segmentHandles).toHaveCount(0);
  await expect(endpointHandles).toHaveCount(2);
  const straightPath = await path.getAttribute('d');
  expect(straightPath).not.toMatch(/[CQ]/);
  expect(straightPath?.match(/\bL\b/g)).toHaveLength(1);

  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Gebogen' }).click();
  await expect(page.locator('[data-testid^="connector-control-handle-"]')).toHaveCount(2);

  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Rechtwinklig' }).click();
  await expect(segmentHandles).toHaveCount(3);

  const thirdShape = shapes.nth(2);
  const thirdId = await thirdShape.getAttribute('data-element-id');
  const thirdBox = (await thirdShape.boundingBox())!;
  const endHandle = page.getByTestId('connector-endpoint-handle-end');
  const endBox = (await endHandle.boundingBox())!;
  await page.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y + thirdBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('connector-target-highlight')).toBeHidden();

  // The same endpoint can move to another side of its current element.
  let reboundBox = (await endHandle.boundingBox())!;
  await page.mouse.move(reboundBox.x + reboundBox.width / 2, reboundBox.y + reboundBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(thirdBox.x + thirdBox.width / 2, thirdBox.y, { steps: 8 });
  await page.mouse.up();
  reboundBox = (await endHandle.boundingBox())!;
  expect(Math.abs(reboundBox.y + reboundBox.height / 2 - thirdBox.y)).toBeLessThan(8);

  // Dragging the endpoint onto its opposite element must not create a self-connection.
  const firstShapeBox = (await shapes.first().boundingBox())!;
  await page.mouse.move(reboundBox.x + reboundBox.width / 2, reboundBox.y + reboundBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstShapeBox.x + firstShapeBox.width / 2, firstShapeBox.y + firstShapeBox.height / 2, { steps: 8 });
  await expect(page.getByTestId('connector-target-highlight')).toBeHidden();
  await page.mouse.up();

  await bar.getByRole('button', { name: /^Startpunkt:/ }).click();
  const startChoices = page.getByRole('group', { name: 'Startpunkt' });
  await expect(startChoices.getByRole('button')).toHaveCount(12);
  await startChoices.getByRole('button', { name: 'Null oder eins' }).click();
  await expect(path).toHaveAttribute('marker-start', /zero-or-one/);

  await bar.getByRole('button', { name: /^Endpunkt:/ }).click();
  await page.getByRole('group', { name: 'Endpunkt' }).getByRole('button', { name: 'Eins oder viele' }).click();
  await expect(path).toHaveAttribute('marker-end', /one-or-many/);

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
  expect(code).toContain('"startMarker":"zero-or-one"');
  expect(code).toContain('"endMarker":"one-or-many"');
  expect(code).toContain('"from"'); expect(code).toContain('"to"');
  expect(code).toContain(`"elementId":"${thirdId}"`);
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

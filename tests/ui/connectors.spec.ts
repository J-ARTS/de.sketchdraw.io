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
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${sourceId}"] [data-testid="connector-dock-point"]`)).toHaveCount(12);
  await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 });
  await expect(page.getByTestId('connector-source-highlight')).toBeVisible();
  await expect(page.getByTestId('connector-target-highlight')).toBeVisible();
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${sourceId}"] [data-testid="connector-dock-point"]`)).toHaveCount(12);
  await expect(page.locator(`[data-testid="connector-dock-points"][data-element-id="${targetId}"] [data-testid="connector-dock-point"]`)).toHaveCount(12);
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
  // Moving an outer segment adds short stubs at both ends; those get no handle of their own (#endpoint-grab).
  await expect(segmentHandles).toHaveCount(3);

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
  await expect(startChoices.getByRole('button')).toHaveCount(14);
  await startChoices.getByRole('button', { name: 'Gefüllter Kreis' }).click();
  await expect(path).toHaveAttribute('marker-start', /solid-circle/);
  await expect(connector.locator('marker[id$="-solid-circle"] circle')).toHaveAttribute('fill', '#e5533a');

  await bar.getByRole('button', { name: /^Endpunkt:/ }).click();
  const endChoices = page.getByRole('group', { name: 'Endpunkt' });
  await endChoices.getByRole('button', { name: 'Gefülltes Dreieck' }).click();
  await expect(path).toHaveAttribute('marker-end', /solid-triangle/);
  await expect(connector.locator('marker[id$="-solid-triangle"] path')).toHaveAttribute('fill', '#e5533a');

  await bar.getByRole('button', { name: /^Startpunkt:/ }).click();
  await startChoices.getByRole('button', { name: 'Null oder eins' }).click();
  await expect(path).toHaveAttribute('marker-start', /zero-or-one/);

  await bar.getByRole('button', { name: /^Endpunkt:/ }).click();
  await endChoices.getByRole('button', { name: 'Eins oder viele' }).click();
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

test('arrows can be drawn freely, from or to a shape, and snap to twelve dock points', async ({ page }) => {
  await rectangle(page, 350);
  const connectors = page.locator('.whiteboard-canvas [data-kind=connector]');
  const connect = async (from: [number, number], to: [number, number]) => {
    await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
    await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 6 }); await page.mouse.up();
  };

  // Completely free: neither end touches a shape.
  await connect([700, 600], [900, 650]);
  await expect(connectors).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Meldungen' }).locator('.notice')).toHaveCount(0);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(bar.getByRole('button', { name: /^Linienform:/ })).toBeVisible();

  // Free end: docks at the start shape only; free start: docks at the end shape only.
  await connect([420, 330], [650, 200]);
  await expect(connectors).toHaveCount(2);
  await connect([850, 250], [430, 350]);
  await expect(connectors).toHaveCount(3);

  // Twelve dock points per shape while connecting, three per side.
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(420, 340);
  const docks = page.locator('[data-testid="connector-dock-points"] [data-testid="connector-dock-point"]');
  await expect(docks).toHaveCount(12);
  for (const side of ['top', 'right', 'bottom', 'left']) await expect(docks.and(page.locator(`[data-side=${side}]`))).toHaveCount(3);
});

test('connectors default to right-angled lines and remember the chosen type and arrowhead', async ({ page }) => {
  await rectangle(page, 220); await rectangle(page, 700, 460);
  const connect = async () => {
    await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
    await page.mouse.move(300, 350); await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 }); await page.mouse.up();
  };
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });

  // The tool offers its line types; right-angled is the default.
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  const options = page.getByTestId('connector-options');
  await expect(options).toBeVisible();
  await expect(options.getByRole('button', { name: 'Linienform Rechtwinklig' })).toHaveAttribute('aria-pressed', 'true');
  await expect(options.getByRole('button', { name: 'Pfeilspitze Gefüllter Kreis' })).toBeVisible();
  await expect(options.getByRole('button', { name: 'Pfeilspitze Gefülltes Dreieck' })).toBeVisible();
  await page.keyboard.press('Escape');
  await connect();
  await expect(bar.getByRole('button', { name: 'Linienform: Rechtwinklig' })).toBeVisible();

  // Picking another type in the tool applies to the next connector...
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await options.getByRole('button', { name: 'Linienform Gebogen' }).click();
  await options.getByRole('button', { name: 'Pfeilspitze Gefülltes Dreieck' }).click();
  await expect(options.getByRole('button', { name: 'Linienform Gebogen' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.mouse.click(900, 200);
  await connect();
  await expect(bar.getByRole('button', { name: 'Linienform: Gebogen' })).toBeVisible();
  await expect(page.locator('.whiteboard-canvas [data-kind=connector]').last().locator('path').last()).toHaveAttribute('marker-end', /solid-triangle/);

  // ...and changing a selected connector's type becomes the new default as well, also after a reload.
  await bar.getByRole('button', { name: 'Linienform: Gebogen' }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Gerade' }).click();
  await page.reload(); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await expect(page.getByTestId('connector-options').getByRole('button', { name: 'Linienform Gerade' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('connector-options').getByRole('button', { name: 'Pfeilspitze Gefülltes Dreieck' })).toHaveAttribute('aria-pressed', 'true');
});


test('an endpoint stays grabbable next to its stub, can move to another dock point and can be detached', async ({ page }) => {
  await rectangle(page, 220); await rectangle(page, 700, 460);
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(300, 350); await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 }); await page.mouse.up();
  const connector = page.locator('.whiteboard-canvas [data-kind=connector]');
  await expect(connector).toHaveCount(1);
  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  await connector.locator('path').last().click({ force: true });

  // The 24 px stub next to each endpoint gets no handle: only the endpoints (and long segments) are shown.
  const endHandle = page.getByTestId('connector-endpoint-handle-end');
  await expect(endHandle).toBeVisible();
  const stubHandles = page.locator('[data-testid^="connector-segment-handle-"]');
  const handleCount = await stubHandles.count();
  for (let index = 0; index < handleCount; index += 1) {
    const box = (await stubHandles.nth(index).boundingBox())!;
    const end = (await endHandle.boundingBox())!;
    expect(Math.hypot(box.x + box.width / 2 - (end.x + end.width / 2), box.y + box.height / 2 - (end.y + end.height / 2))).toBeGreaterThan(24);
  }

  // Re-placing: drag the end to another dock point of the same shape (right side, upper slot).
  const shape = (await page.locator('.whiteboard-canvas [data-kind=rectangle]').nth(1).boundingBox())!;
  const grab = (await endHandle.boundingBox())!;
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2); await page.mouse.down();
  await page.mouse.move(shape.x + shape.width, shape.y + shape.height * 0.25, { steps: 8 }); await page.mouse.up();
  const moved = (await endHandle.boundingBox())!;
  expect(Math.abs(moved.x + moved.width / 2 - (shape.x + shape.width))).toBeLessThan(8);
  expect(Math.abs(moved.y + moved.height / 2 - (shape.y + shape.height * 0.25))).toBeLessThan(8);

  // Detaching: dropping the end on empty canvas leaves it free where it was dropped.
  await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2); await page.mouse.down();
  await page.mouse.move(1000, 650, { steps: 8 }); await page.mouse.up();
  const freed = (await endHandle.boundingBox())!;
  expect(Math.abs(freed.x + freed.width / 2 - 1000)).toBeLessThan(8);
  expect(Math.abs(freed.y + freed.height / 2 - 650)).toBeLessThan(8);
  await expect(page.getByTestId('connector-target-highlight')).toBeHidden();
});

test('a segment dragged out and back into line merges again without extra segment handles', async ({ page }) => {
  await rectangle(page, 220); await rectangle(page, 700, 460);
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(300, 350);
  await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 }); await page.mouse.up();
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: /^Linienform:/ }).click();
  await page.getByRole('group', { name: 'Linienform' }).getByRole('button', { name: 'Rechtwinklig' }).click();
  const path = page.locator('.whiteboard-canvas [data-kind=connector] path').last();
  const segmentHandles = page.locator('[data-testid^="connector-segment-handle-"]');
  await expect(segmentHandles).toHaveCount(3);
  // The path is stored relative to the element box, which moves with the bends: compare the shape from its first point.
  const shape = async () => {
    const numbers = ((await path.getAttribute('d')) ?? '').match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    return numbers.map((value, index) => Math.round(value - numbers[index % 2]!));
  };
  const original = await shape();
  const originalPath = await path.getAttribute('d');

  // Pull the first segment away: stubs and extra bends appear.
  const first = (await page.getByTestId('connector-segment-handle-0').boundingBox())!;
  const fx = first.x + first.width / 2; const fy = first.y + first.height / 2;
  await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx, fy - 90, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => path.getAttribute('d')).not.toBe(originalPath);

  // Drop the moved segment back within a few pixels of the old line: it snaps in and the route is the original again.
  let moved: { x: number; y: number } | null = null;
  for (const handle of await segmentHandles.all()) {
    if ((await handle.getAttribute('data-orientation')) !== 'horizontal') continue;
    const box = (await handle.boundingBox())!;
    if (Math.abs(box.y + box.height / 2 - (fy - 90)) < 6) moved = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  expect(moved).not.toBeNull();
  await page.mouse.move(moved!.x, moved!.y); await page.mouse.down(); await page.mouse.move(moved!.x, fy + 3, { steps: 8 }); await page.mouse.up();
  await expect.poll(shape).toEqual(original);
  await expect(segmentHandles).toHaveCount(3);
});

test('a connector can use an animated dashed line', async ({ page }) => {
  await rectangle(page, 220); await rectangle(page, 700, 460);
  await page.getByRole('button', { name: 'Verbindung', exact: true }).click();
  await page.mouse.move(300, 350);
  await page.mouse.down(); await page.mouse.move(775, 510, { steps: 8 }); await page.mouse.up();
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Linie', exact: true }).click();
  await page.getByRole('button', { name: 'Animiert', exact: true }).click();
  const connector = page.locator('.whiteboard-canvas [data-kind=connector]');
  await expect(connector.locator(':scope > g').first()).toHaveClass(/dash-animated/);
  await expect(connector.locator(':scope > g').first()).toHaveAttribute('stroke-dasharray', '8 6');
  await expect.poll(() => connector.locator(':scope > g').first().evaluate((element) => getComputedStyle(element).animationName)).toMatch(/sd-dash-flow/);
});

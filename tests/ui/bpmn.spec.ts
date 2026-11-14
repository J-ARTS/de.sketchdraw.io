import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
});

async function library(page: Page): Promise<Locator> {
  const panel = page.getByTestId('shape-library-sidebar');
  if (!(await panel.count())) { await page.getByTestId('more-shapes').click(); await page.getByTestId('open-diagram-library-bpmn').click(); }
  return panel;
}
const box = async (locator: Locator) => (await locator.boundingBox())!;

test('the BPMN library draws events with their borders and symbols and activities with type symbols and markers (#196)', async ({ page }) => {
  const panel = await library(page);
  await expect(panel.getByRole('button', { name: 'Start: Nachricht' })).toBeVisible();
  for (const name of ['Zwischenereignis', 'Nachricht senden', 'Ende: Fehler', 'Benutzeraufgabe', 'Serviceaufgabe', 'Teilprozess', 'Aufrufaktivität', 'Mehrfachinstanz (parallel)', 'Ereignisbasiertes Gateway', 'Pool mit drei Bahnen']) {
    await expect(panel.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
  const canvas = page.locator('.whiteboard-canvas');
  await panel.getByRole('button', { name: 'Nachricht senden', exact: true }).click();
  const event = canvas.locator('[data-kind="ellipse"]');
  // An intermediate event has a second ring, and a throwing event a filled symbol.
  await expect(event.getByTestId('bpmn-inner-ring')).toHaveCount(1);
  expect(await event.getByTestId('bpmn-icon').locator('path').first().getAttribute('fill')).not.toBe('none');
  await panel.getByRole('button', { name: 'Teilprozess', exact: true }).click();
  await expect(canvas.locator('[data-kind="rectangle"]').getByTestId('bpmn-marker')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Benutzeraufgabe', exact: true }).click();
  await expect(canvas.locator('[data-kind="rectangle"]').getByTestId('bpmn-icon')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('a pool has a vertical title strip, its lanes fill it, follow its size and take elements in like groups (#196)', async ({ page }) => {
  const panel = await library(page);
  await panel.getByRole('button', { name: 'Pool mit drei Bahnen', exact: true }).dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 520, y: 480 } });
  await panel.getByRole('button', { name: 'Aufgabe', exact: true }).dragTo(page.getByTestId('whiteboard-canvas'), { targetPosition: { x: 480, y: 480 } });
  await panel.getByRole('button', { name: 'Formen schließen' }).click();
  const canvas = page.locator('.whiteboard-canvas');
  const containers = canvas.locator('[data-kind="container"]');
  await expect(containers).toHaveCount(4);
  const pool = containers.nth(0);
  const lanes = [containers.nth(1), containers.nth(2), containers.nth(3)];
  // Titles run bottom to top in a strip at the left edge.
  await expect(pool.getByTestId('swimlane-title')).toHaveText('Pool');
  const title = await box(pool.getByTestId('swimlane-title'));
  expect(title.height).toBeGreaterThan(title.width);
  const frame = await box(pool.locator('rect').first());
  for (const lane of lanes) {
    const laneBox = await box(lane.locator('rect').first());
    expect(Math.abs(laneBox.x - (frame.x + 32))).toBeLessThanOrEqual(2);
    expect(Math.abs(laneBox.x + laneBox.width - (frame.x + frame.width))).toBeLessThanOrEqual(2);
  }

  // The task was dropped into the middle lane: it belongs to it, so moving the pool by a lane takes it along.
  const task = canvas.locator('[data-kind="rectangle"]');
  const taskBefore = await box(task);
  await page.mouse.click(720, 160);
  const middle = await box(lanes[1]!.locator('rect').first());
  await page.mouse.move(middle.x + 16, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + 16 + 60, middle.y + middle.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const taskAfter = await box(task);
  expect(Math.round(taskAfter.x - taskBefore.x)).toBe(60);
  expect(Math.round(taskAfter.y - taskBefore.y)).toBe(40);
  const moved = await box(pool.locator('rect').first());
  expect(Math.round(moved.x - frame.x)).toBe(60);

  // Select the pool by its title strip and drag its lower right corner: all lanes follow the width.
  await page.mouse.click(720, 160);
  await page.mouse.click(moved.x + 10, moved.y + 20);
  const handle = await box(page.locator('[data-handle=se]'));
  await page.mouse.move(handle.x + 5, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 5 + 180, handle.y + 5 + 90, { steps: 8 });
  await page.mouse.up();
  const wide = await box(pool.locator('rect').first());
  expect(Math.abs(wide.width - moved.width - 180)).toBeLessThanOrEqual(3);
  let bottom = 0;
  for (const lane of lanes) {
    const laneBox = await box(lane.locator('rect').first());
    expect(Math.abs(laneBox.x + laneBox.width - (wide.x + wide.width))).toBeLessThanOrEqual(2);
    bottom = Math.max(bottom, laneBox.y + laneBox.height);
  }
  expect(Math.abs(bottom - (wide.y + wide.height))).toBeLessThanOrEqual(2);

  // "Add lane" appends a fourth lane and makes the pool taller.
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Bahn hinzufügen' }).click();
  await expect(containers).toHaveCount(5);
  await expect(containers.nth(4).getByTestId('swimlane-title')).toHaveText('Bahn 4');
  const taller = await box(pool.locator('rect').first());
  expect(taller.height).toBeGreaterThan(wide.height + 50);

  // One undo step each.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(containers).toHaveCount(4);
  await page.keyboard.press('ControlOrMeta+z');
  expect(Math.abs((await box(pool.locator('rect').first())).width - moved.width)).toBeLessThanOrEqual(1);
});

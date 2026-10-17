import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #36: shapes resize but do not rotate on canvas; quick connect creates a connected copy.
const shapes = '.whiteboard-canvas [data-kind=rectangle]';
const arrows = '.whiteboard-canvas [data-kind=connector]';

async function drawRectangle(page: Page) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(350, 220); await page.mouse.down(); await page.mouse.move(550, 360, { steps: 8 }); await page.mouse.up();
  await expect(page.locator(shapes)).toHaveCount(1);
}

async function documentCode(page: Page) {
  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  const text = await page.getByTestId('diagram-code').inputValue();
  await page.getByRole('button', { name: 'Codeansicht schließen' }).click();
  return text;
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a selected shape offers resize handles and quick connect but no rotate handle', async ({ page }) => {
  await drawRectangle(page);
  await expect(page.locator('[data-handle]')).toHaveCount(4);
  await expect(page.locator('[data-handle=rotate]')).toHaveCount(0);
  for (const side of ['top', 'right', 'bottom', 'left']) await expect(page.getByTestId(`quick-connect-${side}`)).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  const se = await page.locator('[data-handle=se]').boundingBox();
  await page.mouse.move(se!.x + 5, se!.y + 5); await page.mouse.down(); await page.mouse.move(610, 400, { steps: 4 }); await page.mouse.up();
  await expect(page.locator(`${shapes} > g > rect`)).toHaveAttribute('width', '260');
});

test('hovering previews and clicking creates a same-sized copy with an arrow in one undo step', async ({ page }) => {
  await drawRectangle(page);
  const sourceId = await page.locator(shapes).first().getAttribute('data-element-id');
  const right = page.getByRole('button', { name: 'Verbundene Form rechts hinzufügen' });
  await right.hover(); await expect(page.getByTestId('quick-connect-preview')).toBeVisible();
  await page.mouse.move(700, 600); await expect(page.getByTestId('quick-connect-preview')).toHaveCount(0);
  await right.click();
  await expect(page.locator(shapes)).toHaveCount(2); await expect(page.locator(arrows)).toHaveCount(1);
  await expect(page.getByTestId('quick-connect-preview')).toHaveCount(0);
  const copy = page.locator(shapes).nth(1);
  await expect(copy).toHaveAttribute('transform', /^translate\(630 220\)/);
  await expect(copy.locator('> g > rect')).toHaveAttribute('width', '200');
  const ids = await page.locator(shapes).evaluateAll(nodes => nodes.map(node => node.getAttribute('data-element-id')));
  const copyId = ids.find(id => id !== sourceId)!;
  const code = await documentCode(page);
  expect(code).toContain(`"from":{"anchor":{"x":1,"y":0.5},"elementId":"${sourceId}"}`);
  expect(code).toContain(`"to":{"anchor":{"x":0,"y":0.5},"elementId":"${copyId}"}`);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator(shapes)).toHaveCount(1); await expect(page.locator(arrows)).toHaveCount(0);
});

test('repeated quick connects fan out instead of overlapping and work from the keyboard', async ({ page }) => {
  await drawRectangle(page);
  await page.getByTestId('quick-connect-right').click();
  await page.mouse.click(370, 240); // reselect the original; canvas elements themselves ignore pointer events
  await page.getByTestId('quick-connect-right').focus();
  await expect(page.getByTestId('quick-connect-preview')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator(shapes)).toHaveCount(3); await expect(page.locator(arrows)).toHaveCount(2);
  const boxes = await page.locator(shapes).evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect()).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
  const [, first, second] = boxes;
  expect(second!.x).toBeCloseTo(first!.x, 0);
  expect(Math.abs(second!.y - first!.y)).toBeGreaterThanOrEqual(first!.h);
});

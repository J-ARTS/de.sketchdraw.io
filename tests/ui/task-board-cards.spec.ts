import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #105 task cards with cover, menu, assignee and due date; #106 pointer drag with placeholder and tilted card.
async function openBoard(page: Page) {
  await page.getByTestId('page-switcher').click(); await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board'); await expect(board).toBeVisible();
  return board;
}
async function createTask(page: Page, title: string, extra: { type?: string; due?: string; assignee?: string } = {}) {
  await page.getByRole('button', { name: 'Neue Aufgabe' }).click();
  const dialog = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill(title);
  await dialog.getByRole('textbox', { name: 'Beschreibung' }).fill(`${title} beschreiben`);
  if (extra.type) await dialog.getByRole('combobox', { name: 'Typ' }).selectOption({ label: extra.type });
  if (extra.due) await dialog.getByLabel('Fällig am').fill(extra.due);
  if (extra.assignee) await dialog.getByRole('combobox', { name: 'Zugewiesen an' }).fill(extra.assignee);
  await dialog.getByRole('button', { name: 'Aufgabe erstellen' }).click();
  await expect(dialog).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a task card shows its cover, bold title, menu, due date and assignee and edits them', async ({ page }) => {
  const board = await openBoard(page);
  await createTask(page, 'Make a new Post', { type: 'Design', due: '2099-10-25', assignee: 'Jeremy Teichmann' });
  const card = board.locator('.task-card').filter({ hasText: 'Make a new Post' });
  await expect(card).toHaveAttribute('data-type', 'design');
  await expect(card.locator('.cover-type')).toHaveText('Design');
  await expect(card.locator('.card-open strong')).toHaveCSS('font-weight', '700');
  await expect(card.locator('time')).toHaveText('25.10.2099');
  await expect(card.locator('.avatar')).toContainText('JT');
  await expect(card).toContainText('Zugewiesen an Jeremy Teichmann');
  await expect(card.getByRole('button', { name: /verschieben$/ })).toHaveCount(0); // no ← / → arrows any more
  expect((await new AxeBuilder({ page }).include('[data-testid=task-board]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await card.getByRole('button', { name: 'Aktionen für Make a new Post' }).click();
  const menu = page.getByRole('menu', { name: 'Aktionen für Make a new Post' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await menu.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await expect(dialog.getByRole('combobox', { name: 'Typ' })).toHaveValue('design');
  await expect(dialog.getByLabel('Fällig am')).toHaveValue('2099-10-25');
  await dialog.getByRole('combobox', { name: 'Zugewiesen an' }).fill('');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(card.locator('.avatar')).toHaveCount(0);

  await card.getByRole('button', { name: 'Aktionen für Make a new Post' }).click();
  await page.getByRole('menuitem', { name: 'Löschen' }).click();
  await expect(board.locator('.task-card')).toHaveCount(0);
});

test('dragging a task leaves a dashed placeholder, tilts the card and drops it into another column', async ({ page }) => {
  const board = await openBoard(page);
  await createTask(page, 'Erste Aufgabe'); await createTask(page, 'Zweite Aufgabe');
  const todo = board.locator('[data-status="todo"]'); const review = board.locator('[data-status="review"]');
  const card = todo.locator('.task-card').filter({ hasText: 'Erste Aufgabe' });
  const from = (await card.boundingBox())!; const to = (await review.boundingBox())!;
  await page.mouse.move(from.x + 40, from.y + 140); await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 120, { steps: 12 });
  await expect(todo.locator('.task-item.drag-source')).toHaveCount(1);
  await expect(todo.locator('.task-item.drag-source')).toHaveCSS('border-top-style', 'dashed');
  const ghost = board.locator('.drag-ghost');
  await expect(ghost).toBeVisible();
  expect(await ghost.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  await expect(ghost.locator('.task-card')).toHaveCSS('border-top-left-radius', '18px');
  await expect(review).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(review).toContainText('Erste Aufgabe');
  await expect(board.locator('.drag-ghost')).toHaveCount(0);

  // Escape cancels a drag in progress.
  const second = todo.locator('.task-card').filter({ hasText: 'Zweite Aufgabe' });
  const box = (await second.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 140); await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 200, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(todo).toContainText('Zweite Aufgabe');
  await expect(board.locator('.drag-ghost')).toHaveCount(0);
});

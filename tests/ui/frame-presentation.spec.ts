import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('frames appear as ordered slides and can be presented with keyboard navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.mouse.move(260, 230); await page.mouse.down(); await page.mouse.move(740, 500); await page.mouse.up();

  const frame = page.locator('.whiteboard-canvas [data-kind="frame"]').first();
  const sidebar = page.getByTestId('frame-sidebar');
  await expect(frame).toBeVisible();
  await expect(frame.getByTestId('frame-label')).toContainText('Folie 1');
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText('Folie 1', { exact: true })).toBeVisible();

  await sidebar.getByText('Folie 1', { exact: true }).dblclick();
  const name = sidebar.getByRole('textbox', { name: 'Folienname' });
  await name.fill('Einführung'); await name.press('Enter');
  await expect(frame.getByTestId('frame-label')).toContainText('Einführung');

  await sidebar.getByRole('button', { name: 'Präsentieren' }).click();
  const presenter = page.getByRole('dialog', { name: 'Presenter Mode' });
  await expect(presenter).toBeVisible();
  await expect(presenter.getByText('Einführung', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(presenter.getByText('1 / 1')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(presenter).toHaveCount(0);

  await sidebar.getByRole('button', { name: 'Folienleiste schließen' }).click();
  await expect(sidebar).toHaveCount(0);
});

test('speaker notes per slide are edited in the slide bar and shown only in the presenter view', async ({ page }) => {
  await page.getByRole('button', { name: 'Frame', exact: true }).click();
  await page.mouse.move(260, 230); await page.mouse.down(); await page.mouse.move(740, 500); await page.mouse.up();
  const sidebar = page.getByTestId('frame-sidebar');
  await expect(sidebar).toBeVisible();

  await sidebar.getByText('Notizen', { exact: true }).click();
  const notes = sidebar.getByRole('textbox', { name: 'Notizen zur Folie' });
  await notes.fill('Begrüßung und Agenda');
  await notes.blur();
  await expect(sidebar.locator('.has-notes')).toBeVisible();

  // Notes never appear on the canvas or in the normal presentation.
  await expect(page.getByTestId('whiteboard-canvas')).not.toContainText('Begrüßung');
  await sidebar.getByRole('button', { name: 'Präsentieren', exact: true }).click();
  const presenter = page.getByRole('dialog', { name: 'Presenter Mode' });
  await expect(presenter).toBeVisible();
  await expect(page.getByTestId('presenter-notes')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The presenter view shows and edits the notes of the current slide.
  await sidebar.getByTestId('present-with-notes').click();
  const panel = page.getByTestId('presenter-notes');
  await expect(panel.getByRole('textbox', { name: 'Notizen zur Folie' })).toHaveValue('Begrüßung und Agenda');
  const field = panel.getByRole('textbox', { name: 'Notizen zur Folie' });
  await field.click();
  await field.press('End');
  await page.keyboard.type(' – Punkt 2');
  await page.keyboard.press('Escape');
  await expect(presenter).toBeVisible();
  await page.getByTestId('presenter-notes-toggle').click();
  await expect(page.getByTestId('presenter-notes')).toHaveCount(0);
  await page.getByTestId('presenter-notes-toggle').click();
  await expect(page.getByTestId('presenter-notes').getByRole('textbox')).toHaveValue('Begrüßung und Agenda – Punkt 2');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(presenter).toHaveCount(0);
});

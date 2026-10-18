import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a sticky note is created from the upper toolbar and exposes FigJam-style editing controls', async ({ page }) => {
  await page.getByRole('button', { name: 'Notiz', exact: true }).click();
  await page.mouse.click(430, 300);

  const note = page.locator('.whiteboard-canvas [data-kind="sticky-note"]').first();
  const editor = page.getByTestId('canvas-text-editor');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(note).toHaveCount(1);
  await expect(note.getByTestId('sticky-note-surface')).toHaveAttribute('width', '240');
  await expect(note.getByTestId('sticky-note-surface')).toHaveAttribute('height', '240');
  await expect(note.getByTestId('sticky-note-surface')).toHaveAttribute('fill', '#aeeebd');
  await expect(note.getByTestId('sticky-note-author')).toContainText('Lokaler Benutzer');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('placeholder', 'Schreib etwas, @erwähne jemanden');
  await expect(bar).toBeVisible();

  const noteBox = (await note.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThan(noteBox.y);
  for (const name of ['Farbe', 'Schriftart', 'Fett', 'Durchgestrichen', 'Dokumentationslink', 'Aufzählung', 'Autor bearbeiten']) {
    await expect(bar.getByRole('button', { name })).toBeVisible();
  }
  await expect(bar.getByRole('button', { name: 'Linie' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Textausrichtung' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Dokumentationslink' })).toBeDisabled();
  await expect(bar.getByRole('button', { name: 'Autor bearbeiten' })).toBeDisabled();

  await editor.fill('Plan\nReview');
  await bar.getByRole('button', { name: 'Fett' }).click();
  await bar.getByRole('button', { name: 'Durchgestrichen' }).click();
  await bar.getByRole('button', { name: 'Aufzählung' }).click();
  await bar.getByRole('button', { name: 'Schriftart' }).click();
  await page.getByRole('button', { name: 'Roboto (Sans Serif)', exact: true }).click();
  await expect(editor).toHaveCSS('font-weight', '700');
  await expect(editor).toHaveCSS('text-decoration-line', 'line-through');
  await expect(editor).toHaveCSS('font-family', /Roboto Variable/);
  await editor.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  await expect(note.locator('text').filter({ hasText: '• Plan' })).toHaveCount(1);
  await expect(page.locator('[data-handle]')).toHaveCount(5);
  await expect(page.locator('[data-handle="rotate"]')).toBeVisible();

  await bar.getByRole('button', { name: 'Autor bearbeiten' }).click();
  const author = page.getByRole('textbox', { name: 'Autor' });
  await author.fill('Jeremy Teichmann'); await author.press('Enter'); await page.keyboard.press('Escape');
  await expect(note.getByTestId('sticky-note-author')).toContainText('Jeremy Teichmann');

  await bar.getByRole('button', { name: 'Dokumentationslink' }).click();
  const link = page.getByRole('textbox', { name: 'Link', exact: true });
  await link.fill('https://example.com/note'); await link.press('Enter');
  await expect(page.getByRole('button', { name: 'Link öffnen ↗' })).toBeVisible();
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: 'Farbe' }).click();
  const colors = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(colors.getByRole('button', { name: 'Keine Füllung' })).toHaveCount(0);
  await colors.getByRole('button', { name: 'Füllung Hellgrün' }).click();
  await expect(note.getByTestId('sticky-note-surface')).toHaveAttribute('fill', '#d6f2d6');
  await page.keyboard.press('Escape');

  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await expect(page.getByTestId('quick-connect-right')).toBeVisible();
  await page.getByTestId('quick-connect-right').click();
  await expect(page.locator('.whiteboard-canvas [data-kind="sticky-note"]')).toHaveCount(2);
  await expect(page.locator('.whiteboard-canvas [data-kind="connector"]')).toHaveCount(1);
});

test('a sticky note creates one linked task and the task board returns to its source', async ({ page }) => {
  await page.getByRole('button', { name: 'Notiz', exact: true }).click();
  await page.mouse.click(430, 300);

  const editor = page.getByTestId('canvas-text-editor');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await editor.fill('Release planen\nInstaller prüfen');
  await bar.getByRole('button', { name: 'Aufgabe erstellen' }).click();

  await expect(editor).toHaveCount(0);
  const duplicateGuard = bar.getByRole('button', { name: 'Aufgabe bereits erstellt' });
  await expect(duplicateGuard).toBeVisible();
  await expect(duplicateGuard).toBeDisabled();

  await page.getByTestId('page-switcher').click();
  await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board');
  await expect(board).toBeVisible();
  await expect(board).toContainText('Release planen');
  await expect(board).toContainText('Installer prüfen');

  await board.getByRole('button', { name: 'Notiz öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' })).toBeVisible();
  await expect(page.locator('.whiteboard-canvas [data-kind="sticky-note"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

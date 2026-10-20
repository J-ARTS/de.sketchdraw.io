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
  for (const name of ['Farbe', 'Schriftfarbe', 'Schriftart', 'Fett', 'Durchgestrichen', 'Link zum Text', 'Aufzählung', 'Autor bearbeiten']) {
    await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(bar.getByRole('button', { name: 'Linie' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Textausrichtung' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Link zum Text' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Autor bearbeiten' })).toBeEnabled();

  await editor.fill('Plan\nReview');
  await bar.getByRole('button', { name: 'Fett' }).click();
  await bar.getByRole('button', { name: 'Durchgestrichen' }).click();
  await editor.press('ControlOrMeta+A');
  await bar.getByRole('button', { name: 'Aufzählung' }).click();
  await expect(editor).toHaveValue('• Plan\n• Review');
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

  await bar.getByRole('button', { name: 'Farbe', exact: true }).click();
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

  await page.getByTestId('workspace-menu-button').click();
  await page.getByTestId('workspace-menu-tasks').click();
  const board = page.getByTestId('task-board');
  await expect(board).toBeVisible();
  await expect(board).toContainText('Release planen');
  await expect(board).toContainText('Installer prüfen');

  await board.locator('.task-card').filter({ hasText: 'Release planen' }).getByRole('button', { name: /^Aktionen für/ }).click();
  await page.getByRole('menuitem', { name: 'Notiz öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' })).toBeVisible();
  await expect(page.locator('.whiteboard-canvas [data-kind="sticky-note"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('the bullet list applies only to the selected lines and the author can be edited while typing', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('n');
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(640, 540, { steps: 6 }); await page.mouse.up();
  await page.mouse.dblclick(520, 420);
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('Hello\nWorld\nTest');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  // Select only "World" and make that line a list item.
  await editor.evaluate((element) => { (element as HTMLTextAreaElement).setSelectionRange(6, 11); });
  await bar.getByRole('button', { name: 'Aufzählung' }).click();
  await expect(editor).toHaveValue('Hello\n• World\nTest');
  await expect(bar.getByRole('button', { name: 'Aufzählung' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Aufzählung' }).click();
  await expect(editor).toHaveValue('Hello\nWorld\nTest');

  // The author button stays available while the text is edited and the author is committed with the text.
  await bar.getByRole('button', { name: 'Autor bearbeiten' }).click();
  const author = page.getByRole('textbox', { name: 'Autor' });
  await author.fill('Jeremy'); await author.press('Enter');
  await editor.focus();
  await editor.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('sticky-note-author')).toContainText('Jeremy');
});

test('a link can be put on the selected words, edited and removed again', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('n');
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.move(640, 540, { steps: 6 }); await page.mouse.up();
  await page.mouse.dblclick(520, 420);
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('Hello Test link');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const linkButton = bar.getByRole('button', { name: 'Link zum Text' });

  // Without a selection there is nothing to link.
  await editor.evaluate((element) => { (element as HTMLTextAreaElement).setSelectionRange(2, 2); });
  await linkButton.click();
  await expect(page.getByRole('button', { name: 'Link setzen' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // Select "Test" and link it.
  await editor.evaluate((element) => { (element as HTMLTextAreaElement).setSelectionRange(6, 10); });
  await linkButton.click();
  const input = page.getByRole('textbox', { name: 'Link zum markierten Text' });
  await input.fill('javascript:alert(1)'); await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('gültige Webadresse');
  await input.fill('example.com/docs'); await input.press('Enter');
  await expect(editor).toBeFocused();
  await editor.press('ControlOrMeta+Enter');
  const link = page.locator('[data-text-link]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveText('Test');
  await expect(link).toHaveAttribute('data-text-link', 'https://example.com/docs');

  // Ctrl/Cmd+click on the linked word opens the address.
  const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await link.click({ modifiers: ['ControlOrMeta'] });
  const opened = await popup;
  expect(opened?.url() ?? '').toContain('example.com/docs');
  await opened?.close();

  // Editing keeps the link on its word; the link under the caret can be changed and removed.
  await page.mouse.dblclick(520, 330);
  await editor.evaluate((element) => { const field = element as HTMLTextAreaElement; field.setSelectionRange(0, 0); });
  await editor.press('Home');
  await page.keyboard.type('Oh ');
  await editor.evaluate((element) => { (element as HTMLTextAreaElement).setSelectionRange(10, 10); });
  await linkButton.click();
  await expect(page.getByRole('textbox', { name: 'Link zum markierten Text' })).toHaveValue('https://example.com/docs');
  await page.getByRole('button', { name: 'Link entfernen' }).click();
  await editor.press('ControlOrMeta+Enter');
  await expect(page.locator('[data-text-link]')).toHaveCount(0);
  await expect(page.locator('.whiteboard-canvas [data-kind="sticky-note"]')).toContainText('Oh Hello Test link');
});

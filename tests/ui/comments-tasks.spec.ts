import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the task board creates, edits, moves and deletes a standalone task', async ({ page }) => {
  await page.getByTestId('page-switcher').click();
  await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board');
  const createButton = board.getByRole('button', { name: 'Neue Aufgabe' });
  const closeButton = board.getByRole('button', { name: 'Aufgabenboard schließen' });

  await expect(closeButton).toBeVisible();
  await expect(board.getByRole('button', { name: 'Zur Zeichenfläche' })).toHaveCount(0);
  const createBox = await createButton.boundingBox();
  expect(createBox).not.toBeNull();
  expect(createBox!.y).toBeGreaterThan(700);

  await createButton.click();
  let dialog = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await expect(dialog.getByRole('textbox', { name: 'Titel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(createButton).toBeFocused();

  await createButton.click();
  dialog = page.getByRole('dialog', { name: 'Neue Aufgabe' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('   ');
  await dialog.getByRole('button', { name: 'Aufgabe erstellen' }).click();
  await expect(dialog).toContainText('Bitte gib einen Titel ein.');
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Release vorbereiten');
  await dialog.getByRole('textbox', { name: 'Beschreibung' }).fill('Installer und Hinweise prüfen');
  await dialog.getByRole('button', { name: 'Aufgabe erstellen' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(createButton).toBeFocused();
  const todo = board.locator('[data-status="todo"]');
  await expect(todo).toContainText('Release vorbereiten');
  await expect(todo).toContainText('Installer und Hinweise prüfen');

  await todo.locator('.card-open').filter({ hasText: 'Release vorbereiten' }).click();
  dialog = page.getByRole('dialog', { name: 'Aufgabe bearbeiten' });
  await dialog.getByRole('textbox', { name: 'Titel' }).fill('Release veröffentlichen');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(todo).toContainText('Release veröffentlichen');

  const card = todo.locator('.task-card').filter({ hasText: 'Release veröffentlichen' });
  await card.getByRole('button', { name: /^Aktionen für/ }).click(); // the card menu replaced the ← / → buttons (#105)
  await page.getByRole('menuitem', { name: 'Nach „In Arbeit“ verschieben' }).click();
  const doing = board.locator('[data-status="doing"]');
  await expect(doing).toContainText('Release veröffentlichen');
  await doing.locator('.card-open').filter({ hasText: 'Release veröffentlichen' }).click();
  await page.getByRole('dialog', { name: 'Aufgabe bearbeiten' }).getByRole('button', { name: 'Löschen' }).click();
  await expect(board).not.toContainText('Release veröffentlichen');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await closeButton.click();
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('comments support pins, replies, editing, sidebar focus and a linked task board', async ({ page }) => {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(300, 210); await page.mouse.down(); await page.mouse.move(520, 350); await page.mouse.up();

  await page.getByRole('button', { name: 'Kommentar', exact: true }).click();
  await page.mouse.click(410, 280);
  const composer = page.getByRole('textbox', { name: 'Kommentar' });
  await expect(composer).toBeVisible(); await composer.fill('API-Vertrag bitte prüfen');
  await page.getByRole('button', { name: 'Senden' }).click();

  const pin = page.getByRole('button', { name: /Kommentar von Lokaler Benutzer öffnen/ });
  await expect(pin).toBeVisible(); await pin.hover();
  await expect(page.getByRole('tooltip')).toContainText('API-Vertrag bitte prüfen');
  await expect(page.getByTestId('comment-sidebar')).toBeVisible();
  await expect(page.getByTestId('comment-thread')).toBeVisible();

  const reply = page.getByRole('textbox', { name: 'Auf Kommentar antworten' });
  await reply.fill('Ist mit dem Diagramm abgeglichen.'); await reply.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('comment-thread')).toContainText('Ist mit dem Diagramm abgeglichen.');
  await page.getByTestId('comment-thread').getByRole('button', { name: 'Bearbeiten' }).first().click();
  const edit = page.getByRole('textbox', { name: /Kommentar von Lokaler Benutzer bearbeiten/ });
  await edit.fill('API- und P2P-Vertrag bitte prüfen'); await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByTestId('comment-thread')).toContainText('API- und P2P-Vertrag bitte prüfen');

  await page.getByRole('button', { name: 'Weitere Kommentaraktionen' }).click();
  await page.getByRole('menuitem', { name: 'Aufgabe erstellen' }).click();
  await page.getByTestId('page-switcher').click(); await page.getByTestId('task-board-entry').click();
  const board = page.getByTestId('task-board'); await expect(board).toBeVisible();
  await expect(board).toContainText('API- und P2P-Vertrag bitte prüfen');
  await board.getByRole('button', { name: /^Aktionen für/ }).click();
  await page.getByRole('menuitem', { name: 'Nach „In Arbeit“ verschieben' }).click();
  await expect(board.locator('[data-status="doing"]')).toContainText('API- und P2P-Vertrag bitte prüfen');

  await board.getByRole('button', { name: /^Aktionen für/ }).click();
  await page.getByRole('menuitem', { name: 'Kommentar öffnen' }).click();
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await expect(page.getByTestId('comment-thread')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('a comment can target a stable table cell', async ({ page }) => {
  await page.getByRole('button', { name: 'Tabelle', exact: true }).click(); await page.mouse.click(380, 280);
  await page.getByRole('button', { name: 'Kommentar', exact: true }).click();
  await page.getByRole('button', { name: 'Kommentar an Zelle 1, 1 anheften' }).click();
  await page.getByRole('textbox', { name: 'Kommentar' }).fill('Zelle mit Verantwortlichem ergänzen');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('comment-sidebar')).toContainText('Tabelle · Zelle 1/1');
});

test('a comment marker can be placed freely or select an element as its target', async ({ page }) => {
  await page.getByRole('button', { name: 'Kommentar', exact: true }).click();
  await page.mouse.click(700, 420);

  const draftPin = page.getByTestId('comment-draft-pin');
  await expect(draftPin).toBeVisible();
  const freeDraftBox = await draftPin.boundingBox();
  expect(freeDraftBox).not.toBeNull();
  expect(freeDraftBox!.x + freeDraftBox!.width / 2).toBeCloseTo(700, 0);
  expect(freeDraftBox!.y + freeDraftBox!.height / 2).toBeCloseTo(420, 0);
  await page.getByRole('textbox', { name: 'Kommentar' }).fill('Freier Canvas-Kommentar');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('comment-sidebar')).toContainText('Zeichenfläche');

  await page.getByRole('button', { name: 'Kommentar schließen' }).click();
  await page.getByRole('button', { name: 'Kommentarleiste schließen' }).click();
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(300, 210); await page.mouse.down(); await page.mouse.move(520, 350); await page.mouse.up();
  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  await page.mouse.click(650, 480);
  await expect(page.getByTestId('properties-panel')).toBeHidden();

  await page.getByRole('button', { name: 'Kommentar', exact: true }).click();
  await page.mouse.click(410, 280);
  await expect(page.getByTestId('comment-draft-pin')).toBeVisible();
  await expect(page.getByTestId('properties-panel')).toBeVisible();
  await page.getByRole('textbox', { name: 'Kommentar' }).fill('Kommentar am ausgewählten Element');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('comment-sidebar')).not.toContainText('Gelöschtes Ziel');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

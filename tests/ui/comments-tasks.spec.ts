import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
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
  await board.getByRole('button', { name: /weiter verschieben/ }).click();
  await expect(board.locator('[data-status="doing"]')).toContainText('API- und P2P-Vertrag bitte prüfen');

  await board.getByRole('button', { name: 'Kommentar öffnen' }).click();
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

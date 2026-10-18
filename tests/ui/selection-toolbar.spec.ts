import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #37: properties live in a floating toolbar above the selection.
async function drawRectangle(page: Page, from = [350, 300], to = [550, 420]) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(from[0]!, from[1]!); await page.mouse.down(); await page.mouse.move(to[0]!, to[1]!, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('the toolbar floats centered above the selection and edits style through popovers', async ({ page }) => {
  await expect(page.getByRole('toolbar', { name: 'Eigenschaften' })).toHaveCount(0);
  await drawRectangle(page);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const box = (await bar.boundingBox())!;
  expect(box.y + box.height).toBeLessThan(300);
  expect(Math.abs(box.x + box.width / 2 - 450)).toBeLessThan(4);

  await bar.getByRole('button', { name: 'Farbe' }).click();
  const color = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(color).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await color.getByRole('button', { name: 'Füllung Hellrot' }).click();
  await expect(color.getByRole('button', { name: 'Füllung Hellrot' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0); await expect(bar.getByRole('button', { name: 'Farbe' })).toBeFocused();

  await bar.getByRole('button', { name: /^Schriftgröße/ }).click();
  await page.getByRole('button', { name: /^Groß/ }).click();
  await expect(bar.getByRole('button', { name: 'Schriftgröße: Groß' })).toBeVisible();

  // Label, description and arrange actions were removed from the toolbar; deleting uses the keyboard.
  await expect(bar.getByRole('button', { name: 'Komponenteneinstellungen' })).toHaveCount(0);
  await page.getByTestId('whiteboard-canvas').focus(); await page.keyboard.press('Delete');
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(0);
  await expect(bar).toHaveCount(0);
});

test('the toolbar stays usable while editing text, keeps the draft and commits text plus style once', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 720 });
  await drawRectangle(page, [180, 330], [300, 420]);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(480);
  const buttonCount = await bar.getByRole('button').count();
  await bar.getByRole('button', { name: 'Text bearbeiten' }).click();
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeVisible();
  await editor.fill('Entwurf');

  // The bar stays visible and anchored above the selected shape; document-level actions remain visible but disabled.
  await expect(bar).toBeVisible();
  const editBox = (await bar.boundingBox())!;
  expect(editBox.x).toBeGreaterThanOrEqual(0); expect(editBox.x + editBox.width).toBeLessThanOrEqual(480);
  expect(editBox.y + editBox.height).toBeLessThanOrEqual(330);
  await expect(bar.getByRole('button')).toHaveCount(buttonCount);
  for (const name of ['Form ändern', 'Text bearbeiten', 'Dokumentationslink']) {
    const action = bar.getByRole('button', { name });
    await expect(action).toBeVisible(); await expect(action).toBeDisabled();
  }
  await expect(bar.getByRole('button', { name: 'Text bearbeiten' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('button', { name: 'Form ändern' })).toHaveAttribute('title', /nicht verfügbar/);
  for (const name of ['Farbe', 'Linie', 'Schriftart', 'Textausrichtung']) await expect(bar.getByRole('button', { name })).toBeEnabled();

  // Font family updates the inline editor immediately without ending the draft.
  await bar.getByRole('button', { name: 'Schriftart' }).click();
  await page.getByRole('button', { name: 'Scribbled', exact: true }).click();
  await expect(editor).toHaveCSS('font-family', /Caveat Variable/);
  await expect(editor).toHaveValue('Entwurf');
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle] text')).toHaveCount(0);

  // Alignment too.
  await bar.getByRole('button', { name: 'Textausrichtung' }).click();
  await page.getByRole('button', { name: 'Rechts', exact: true }).click();
  await expect(editor.locator('xpath=ancestor::div[contains(@class,"text-edit-wrap")]')).toHaveCSS('text-align', 'right');
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // The editor can be focused again to keep typing, then text and style commit together.
  await editor.click(); await page.keyboard.press('End'); await page.keyboard.type(' mehr');
  await expect(editor).toHaveValue('Entwurf mehr');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  const text = page.locator('.whiteboard-canvas [data-kind=rectangle] text');
  await expect(text).toContainText('Entwurf mehr');
  await expect(text).toHaveCSS('font-family', /Caveat Variable/);
  await expect(text).toHaveAttribute('text-anchor', 'end');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Text bearbeiten' })).toBeEnabled();
  await expect(bar.getByRole('button')).toHaveCount(buttonCount);

  // One undo reverts text and style together.
  await page.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(text).toHaveCount(0);
});

test('line and color popovers set fill mode, stroke style, width and custom colors', async ({ page }) => {
  await drawRectangle(page);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const shape = page.locator('.whiteboard-canvas [data-kind=rectangle] > g');

  await bar.getByRole('button', { name: 'Farbe' }).click();
  const color = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(color.getByRole('button', { name: 'Keine Füllung' })).toHaveAttribute('aria-pressed', 'true');
  await color.getByRole('button', { name: 'Füllung Rot' }).click();
  await expect(shape).toHaveAttribute('fill', '#e5533a');
  await expect(color.getByRole('button', { name: 'Füllung', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await color.getByRole('button', { name: 'Transparent' }).click();
  await expect(shape).toHaveAttribute('fill', '#e5533a4d');
  await color.getByRole('button', { name: 'Füllung: eigene Farbe' }).click();
  await expect(page.getByRole('slider', { name: 'Sättigung und Helligkeit' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('textbox', { name: 'Hex-Farbwert' }).fill('#123456'); await page.keyboard.press('Enter');
  await expect(shape).toHaveAttribute('fill', '#1234564d');
  await page.keyboard.press('Escape');

  await bar.getByRole('button', { name: 'Linie' }).click();
  const line = page.getByRole('group', { name: 'Linie', exact: true });
  await expect(line.getByRole('button', { name: 'Durchgezogen' })).toHaveAttribute('aria-pressed', 'true');
  await line.getByRole('button', { name: 'Gestrichelt' }).click();
  await expect(shape).toHaveAttribute('stroke-dasharray', '8 6');
  await line.getByRole('button', { name: 'Linienstärke Dick' }).click();
  await expect(shape).toHaveAttribute('stroke-width', '4');
  await line.getByRole('button', { name: 'Kontur Blau' }).click();
  await expect(shape).toHaveAttribute('stroke', '#5aabf7');
  await line.getByRole('button', { name: 'Keine', exact: true }).click();
  await expect(shape).toHaveAttribute('stroke', 'transparent');
  await line.getByRole('button', { name: 'Durchgezogen' }).click();
  await expect(shape).toHaveAttribute('stroke', '#5aabf7');
});

test('the shape picker swaps shapes, keeps connections, filters by search and undoes in one step', async ({ page }) => {
  await drawRectangle(page);
  await page.getByTestId('quick-connect-right').click();
  await page.mouse.click(370, 320); // reselect the original rectangle
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(bar.getByRole('button', { name: 'Position und Größe' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Form ändern' }).click();
  const picker = page.getByRole('group', { name: 'Form ändern' });
  await expect(picker.getByRole('button', { name: 'Quadrat' })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByRole('searchbox', { name: 'Form suchen' })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.keyboard.type('zylinder');
  await expect(picker.getByRole('group', { name: 'Formen' }).getByRole('button')).toHaveText(['', '']);
  await expect(picker.getByRole('button', { name: 'Zylinder', exact: true })).not.toHaveAttribute('aria-disabled');
  await picker.getByRole('searchbox', { name: 'Form suchen' }).fill('');
  await picker.getByRole('button', { name: 'Kreis' }).click();

  await expect(page.locator('.whiteboard-canvas [data-shape-variant=circle]')).toHaveCount(1);
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(2);
  await expect(page.locator('.whiteboard-canvas [data-kind=connector]')).toHaveCount(1);
  const ellipseId = await page.locator('.whiteboard-canvas [data-shape-variant=circle]').getAttribute('data-element-id');
  await page.getByTestId('workspace-menu-button').click(); await page.getByRole('menuitemcheckbox', { name: 'Code', exact: true }).click();
  expect(await page.getByTestId('diagram-code').inputValue()).toContain(`"elementId":"${ellipseId}"`);
  await page.getByRole('button', { name: 'Codeansicht schließen' }).click();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('.whiteboard-canvas [data-shape-variant=circle]')).toHaveCount(0);
  await expect(page.locator('.whiteboard-canvas [data-shape-variant=square]')).toHaveCount(2);
});

test('an open popover stays above the shape even when the bar is pushed below the selection', async ({ page }) => {
  // A selection near the top edge leaves no room above, so the bar flips below the shape (#38).
  await drawRectangle(page, [350, 110], [550, 210]);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const shape = page.locator('.whiteboard-canvas [data-kind=rectangle]');
  await bar.getByRole('button', { name: 'Farbe' }).click();
  const color = page.getByRole('group', { name: 'Farbe', exact: true });
  await expect(color).toBeVisible();

  // The popover's bottom edge sits 8 px above the higher of the bar and the shape's top edge, so it
  // can never overlap the selected rectangle — regardless of whether the bar is above or below it.
  const anchored = async (expectBarBelow: boolean) => {
    const barBox = (await bar.boundingBox())!;
    const shapeBox = (await shape.boundingBox())!;
    const popoverBox = (await color.boundingBox())!;
    if (expectBarBelow) expect(barBox.y).toBeGreaterThan(shapeBox.y + shapeBox.height);
    const anchorTop = Math.min(barBox.y, shapeBox.y); // the upper of the two anchors governs
    const popoverBottom = popoverBox.y + popoverBox.height;
    expect(popoverBottom).toBeLessThanOrEqual(shapeBox.y + 1); // never covers the shape
    expect(Math.abs(popoverBottom - (anchorTop - 8))).toBeLessThan(3);
    return barBox.y;
  };
  const initialBarY = await anchored(true);

  // Zoom out over the canvas: the selection shrinks and the bar may jump back above the shape.
  await page.mouse.move(450, 160);
  await page.keyboard.down('Control');
  for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await bar.boundingBox())!.y).not.toBe(initialBarY);
  await expect(color).toBeVisible();
  const zoomedBarY = await anchored(false);

  // Pan the viewport: the popover re-computes and stays above whichever anchor is now higher.
  await page.mouse.wheel(0, -80);
  await expect.poll(async () => (await bar.boundingBox())!.y).not.toBe(zoomedBarY);
  await expect(color).toBeVisible();
  await anchored(false);

  // Focus and keyboard dismissal remain intact after the viewport changes.
  await page.keyboard.press('Escape');
  await expect(color).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Farbe' })).toBeFocused();
});

test('shape text is edited in place without a box or buttons and commits like the canvas', async ({ page }) => {
  await drawRectangle(page);
  await page.keyboard.press('Enter');
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(editor).toHaveCSS('text-align', 'center');
  await expect(page.getByRole('button', { name: 'Übernehmen', exact: true })).toHaveCount(0);
  await editor.pressSequentially('Hallo');
  const shape = (await page.locator('.whiteboard-canvas [data-kind=rectangle]').boundingBox())!;
  const box = (await editor.boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - (shape.y + shape.height / 2))).toBeLessThan(4);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await page.mouse.click(700, 600); // clicking the canvas commits
  await expect(editor).toHaveCount(0);
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle] text')).toHaveText('Hallo');
  await page.mouse.click(450, 360); await page.keyboard.press('Enter');
  await editor.press('End'); await editor.press('Enter'); await editor.pressSequentially('Welt');
  await editor.press('ControlOrMeta+Enter');
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle] tspan')).toHaveText(['Hallo', 'Welt']);
});

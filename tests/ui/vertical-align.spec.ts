import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #296: text stands at the top, in the middle or at the bottom of its element; new elements start centred.
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

async function drawRectangle(page: Page, text: string) {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(360, 300); await page.mouse.down(); await page.mouse.move(560, 440, { steps: 8 }); await page.mouse.up();
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await page.getByTestId('canvas-text-editor').fill(text);
  await page.keyboard.press('Escape');
  await expect(page.locator('.whiteboard-canvas [data-kind=rectangle] text')).toHaveCount(1);
}
/** Top and bottom of the drawn text and of its shape, in screen pixels. */
async function textInShape(page: Page) {
  const shape = (await page.locator('.whiteboard-canvas [data-kind=rectangle] rect, .whiteboard-canvas [data-kind=rectangle] path').first().boundingBox())!;
  const text = (await page.locator('.whiteboard-canvas [data-kind=rectangle] text').boundingBox())!;
  return { top: text.y - shape.y, bottom: shape.y + shape.height - (text.y + text.height), text };
}

test('the alignment offers top, middle and bottom, and the text moves there', async ({ page }) => {
  await drawRectangle(page, 'Dienst');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Textausrichtung' }).click();
  const across = page.getByRole('group', { name: 'Waagerechte Ausrichtung' });
  const down = page.getByRole('group', { name: 'Senkrechte Ausrichtung' });
  await expect(across.getByRole('button')).toHaveCount(3);
  await expect(down.getByRole('button')).toHaveCount(3);
  // A new shape starts centred, across and down.
  await expect(across.getByRole('button', { name: 'Zentriert' })).toHaveAttribute('aria-pressed', 'true');
  await expect(down.getByRole('button', { name: 'Mittig' })).toHaveAttribute('aria-pressed', 'true');
  const middle = await textInShape(page);
  expect(Math.abs(middle.top - middle.bottom)).toBeLessThan(6);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await down.getByRole('button', { name: 'Unten' }).click();
  await expect(down.getByRole('button', { name: 'Unten' })).toHaveAttribute('aria-pressed', 'true');
  const low = await textInShape(page);
  expect(low.bottom).toBeLessThan(12);
  expect(low.top).toBeGreaterThan(80);

  await down.getByRole('button', { name: 'Oben' }).click();
  const high = await textInShape(page);
  expect(high.top).toBeLessThan(12);
  expect(high.bottom).toBeGreaterThan(80);

  // One step back returns the text to the bottom.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+z');
  expect((await textInShape(page)).bottom).toBeLessThan(12);
});

test('the text is edited where it stands', async ({ page }) => {
  await drawRectangle(page, 'Dienst');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  for (const name of ['Unten', 'Oben', 'Mittig']) {
    await bar.getByRole('button', { name: 'Textausrichtung' }).click();
    await page.getByRole('group', { name: 'Senkrechte Ausrichtung' }).getByRole('button', { name }).click();
    await page.keyboard.press('Escape');
    const drawn = (await textInShape(page)).text;
    await bar.getByRole('button', { name: 'Text bearbeiten' }).click();
    const editor = (await page.getByTestId('canvas-text-editor').boundingBox())!;
    // Same line: the middle of the editor is the middle of the drawn text (glyph box and line box differ by a few pixels).
    expect(Math.abs(editor.y + editor.height / 2 - (drawn.y + drawn.height / 2)), name).toBeLessThan(5);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('canvas-text-editor')).toHaveCount(0);
  }
});

test('text typed on the canvas starts centred around the click', async ({ page }) => {
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.mouse.click(520, 360);
  const editor = page.getByTestId('canvas-text-editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('xpath=ancestor::div[contains(@class,"text-edit-wrap")]')).toHaveCSS('text-align', 'center');
  const field = (await editor.boundingBox())!;
  expect(Math.abs(field.x + field.width / 2 - 520)).toBeLessThan(2);
  await editor.fill('Notiz am Rand');
  await page.keyboard.press('Escape');
  const text = (await page.locator('.whiteboard-canvas [data-kind=text] text').boundingBox())!;
  expect(Math.abs(text.x + text.width / 2 - 520)).toBeLessThan(3);

  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Textausrichtung' }).click();
  await expect(page.getByRole('group', { name: 'Waagerechte Ausrichtung' }).getByRole('button', { name: 'Zentriert' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('group', { name: 'Senkrechte Ausrichtung' }).getByRole('button', { name: 'Mittig' })).toHaveAttribute('aria-pressed', 'true');
});

test('a group has a title line and no vertical alignment; dark and English follow', async ({ page }) => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, theme: 'dark', language: 'en' }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(360, 300); await page.mouse.down(); await page.mouse.move(560, 440, { steps: 8 }); await page.mouse.up();
  const bar = page.getByRole('toolbar', { name: 'Properties' });
  await bar.getByRole('button', { name: 'Text alignment' }).click();
  const down = page.getByRole('group', { name: 'Vertical alignment' });
  for (const name of ['Top', 'Middle', 'Bottom']) await expect(down.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Horizontal alignment' }).getByRole('button', { name: 'Left-aligned' })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Grouping gives a container: its title stays in the title line.
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+g');
  await expect(page.locator('.whiteboard-canvas [data-kind=container]')).toHaveCount(1);
  await bar.getByRole('button', { name: 'Text alignment' }).click();
  await expect(page.getByRole('group', { name: 'Horizontal alignment' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Vertical alignment' })).toHaveCount(0);
});

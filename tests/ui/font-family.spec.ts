import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// #43: four selectable fonts, rendered identically by canvas text and inline editor.
const FONTS = [
  { value: 'sans', label: 'Inter (Serifenlos)', family: /Inter Variable/ },
  { value: 'roboto', label: 'Roboto (Sans Serif)', family: /Roboto Variable/ },
  { value: 'scribbled', label: 'Scribbled', family: /Caveat Variable/ },
  { value: 'mono', label: 'JetBrains Mono (Monospace)', family: /JetBrains Mono Variable/ },
] as const;

test('font popover offers four labelled options and renders each real font', async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/'); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Text', exact: true }).click(); await page.mouse.click(500, 400);
  const editor = page.getByTestId('canvas-text-editor');
  await editor.fill('Hamburgefonts'); await editor.press('ControlOrMeta+Enter');
  const text = page.locator('[data-kind=text] text');
  await expect(text).toContainText('Hamburgefonts');
  await expect(text).toHaveCSS('font-family', /Inter Variable/);

  await page.getByRole('button', { name: 'Auswahl', exact: true }).click();
  const spot = (await text.boundingBox())!; await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  const widths = new Set<number>();
  for (const font of FONTS) {
    await bar.getByRole('button', { name: 'Schriftart' }).click();
    const group = page.locator('.choices[aria-label="Schriftart"]');
    await expect(group.getByRole('button')).toHaveCount(4);
    if (font.value === 'sans') expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    // Every preview uses its own real font.
    for (const other of FONTS) await expect(group.locator(`[data-font=${other.value}] .font-sample`)).toHaveCSS('font-family', other.family);
    await group.getByRole('button', { name: font.label, exact: true }).click();
    await expect(text).toHaveCSS('font-family', font.family);
    // Popover may close after choosing: reopen to verify the active state.
    if ((await group.count()) === 0) await bar.getByRole('button', { name: 'Schriftart' }).click();
    await expect(group.getByRole('button', { name: font.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const other of FONTS.filter(o => o.value !== font.value)) await expect(group.getByRole('button', { name: other.label, exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('font-glyph')).toHaveCSS('font-family', font.family);
    await page.keyboard.press('Escape');
    await expect(text).toHaveCSS('font-family', font.family);
    await page.evaluate(() => document.fonts.ready);
    widths.add(Math.round((await text.boundingBox())!.width));
  }
  expect(widths.size).toBe(4);

  // Persisted in the element style: the inline editor uses the same mapping.
  { const b = (await text.boundingBox())!; await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2); }
  await expect(editor).toHaveCSS('font-family', /JetBrains Mono Variable/);
});

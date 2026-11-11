import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function change(page: Page, detail: Record<string, unknown>) {
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent('dropdown-fixture', { detail })), detail);
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/tests/ui/fixtures/custom-dropdowns.html');
  await expect(page.getByRole('dialog', { name: 'Dropdown fixture' })).toBeVisible();
});

test('select-only keyboard skips disabled choices, cancels with Escape and lets Tab leave', async ({ page }) => {
  const field = page.getByRole('combobox', { name: 'Format', exact: true });
  await expect(field).toContainText('SVG');
  await field.press('ArrowDown');
  const list = page.getByRole('listbox', { name: 'Format', exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: 'Unavailable' })).toHaveAttribute('aria-disabled', 'true');
  await field.press('ArrowDown'); await field.press('Enter');
  await expect(field).toContainText('draw.io'); await expect(field).toBeFocused();
  await field.press('ArrowDown'); await field.press('End'); await field.press('Escape');
  await expect(field).toContainText('draw.io'); await expect(list).toHaveCount(0);
  await expect(page.getByRole('dialog')).toBeVisible();
  await field.press('ArrowDown'); await field.press('Tab');
  await expect(list).toHaveCount(0); await expect(field).not.toBeFocused();
  await field.focus(); await field.press('m');
  await expect(field).toContainText('Mermaid (Flowchart)');
});

test('unknown, removed and disabled values never masquerade as the first option', async ({ page }) => {
  const field = page.getByRole('combobox', { name: 'Format', exact: true });
  await change(page, { value: 'unknown' }); await expect(field).toContainText('Choose format');
  await field.click();
  await change(page, { options: [{ value: 'last', label: 'Last option' }] });
  await field.press('ArrowDown'); await field.press('Enter');
  await expect(page.getByTestId('selected-value')).toHaveText('last');
  await field.click(); await change(page, { disabled: true });
  await expect(field).toBeDisabled(); await expect(page.getByRole('listbox')).toHaveCount(0);
  await change(page, { disabled: false, options: [] });
  await expect(field).toContainText('Choose format'); await field.press('ArrowDown');
  await expect(field).not.toHaveAttribute('aria-activedescendant', /.+/);
});

test('editable suggestions preserve arbitrary input, text editing and form focus', async ({ page }) => {
  const field = page.getByRole('combobox', { name: 'Assignee', exact: true });
  await field.fill('Ada');
  const list = page.getByRole('listbox', { name: 'Assignee', exact: true });
  await expect(list.getByRole('option', { name: 'Ada Lovelace' })).toBeVisible();
  await list.getByRole('option', { name: 'Ada Lovelace' }).click();
  await expect(field).toHaveValue('Ada Lovelace'); await expect(field).toBeFocused();
  await field.fill('Ada');
  await expect(list).toBeVisible();
  await field.fill('New colleague'); await field.press('Home'); await field.press('ArrowRight');
  await expect(field).toHaveValue('New colleague');
  await expect(list).toHaveCount(0);
  await page.getByTestId('outside').click();
  await expect(page.getByTestId('assignee-value')).toHaveText('New colleague');
  await expect(page.getByTestId('outside')).toBeFocused();
  await expect(page.locator('select,datalist')).toHaveCount(0);
});

test('custom options stay above clipped modal content in both themes and narrow viewports', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const field = page.getByRole('combobox', { name: 'Format', exact: true });
  for (const theme of ['light', 'dark']) {
    await change(page, { theme }); await field.click();
    const list = page.getByRole('listbox', { name: 'Format', exact: true });
    await expect(list).toBeVisible();
    await list.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const rect = (await list.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(360);
    expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(640);
    const option = list.getByRole('option', { name: 'Mermaid (Flowchart)' });
    await expect(option).toBeInViewport();
    const hit = await option.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    expect(hit).toBe(true);
    expect((await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`dropdown-${theme}.png`) });
    await option.click(); await expect(field).toContainText('Mermaid (Flowchart)');
  }
});

test('a short viewport keeps the scrollable list inside its available space', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 240 });
  await page.getByRole('combobox', { name: 'Format', exact: true }).click();
  const list = page.getByRole('listbox', { name: 'Format', exact: true });
  await expect(list).toBeVisible();
  await list.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const rect = (await list.boundingBox())!;
  expect(rect.y).toBeGreaterThanOrEqual(8);
  expect(rect.y + rect.height).toBeLessThanOrEqual(232);
  await list.getByRole('option', { name: 'Mermaid (Flowchart)' }).click();
  await expect(page.getByTestId('selected-value')).toHaveText('mermaid');
});

test('disabling the active option in place moves focus to an enabled choice', async ({ page }) => {
  const field = page.getByRole('combobox', { name: 'Format', exact: true });
  await field.click();
  await change(page, { disableOption: 'svg' });
  const active = await field.getAttribute('aria-activedescendant');
  await expect(page.locator(`[id="${active}"]`)).not.toHaveAttribute('aria-disabled', 'true');
  await field.press('Enter');
  await expect(field).toContainText('draw.io');
});

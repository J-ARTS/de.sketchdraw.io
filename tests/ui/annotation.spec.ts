import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('an annotation provides structured rich-text editing and remains searchable as a shape', async ({ page }) => {
  await page.getByRole('button', { name: 'Annotation', exact: true }).click();
  await page.mouse.click(390, 250);

  const annotation = page.locator('.whiteboard-canvas [data-kind="annotation"]').first();
  const editor = page.getByTestId('annotation-editor');
  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await expect(annotation).toHaveCount(1);
  await expect(annotation.getByTestId('annotation-surface')).toHaveAttribute('width', '520');
  await expect(annotation.getByTestId('annotation-surface')).toHaveAttribute('height', '320');
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  await expect(bar).toBeVisible();

  for (const name of ['Absatz', 'Überschrift 1', 'Überschrift 2', 'Überschrift 3', 'Überschrift 4', 'Fett', 'Kursiv', 'Unterstrichen', 'Textfarbe', 'Aufzählung', 'Nummerierte Liste', 'Zitat']) {
    await expect(name === 'Textfarbe' ? bar.getByLabel(name) : bar.getByRole('button', { name })).toBeVisible();
  }

  await editor.evaluate((element) => {
    element.innerHTML = '<h1>Synchronization Orchestration</h1><p>Pipeline scheduled to execute.</p><p>Safe structured content</p><p>Editable by humans and agents</p><p>Everything remains understandable.</p>';
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });
  await editor.evaluate((element) => {
    const heading = element.querySelector('h1')!;
    const selection = window.getSelection()!;
    const range = document.createRange(); range.selectNodeContents(heading);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await bar.getByRole('button', { name: 'Überschrift 2' }).click();
  await expect(editor.locator('h2')).toContainText('Synchronization Orchestration');
  await bar.getByRole('button', { name: 'Überschrift 1' }).click();
  await expect(editor.locator('h1')).toContainText('Synchronization Orchestration');
  await bar.getByRole('button', { name: 'Absatz' }).click();
  await expect(editor.locator('p').first()).toContainText('Synchronization Orchestration');
  await bar.getByRole('button', { name: 'Überschrift 1' }).click();
  await expect(editor.locator('h1')).toContainText('Synchronization Orchestration');
  await editor.evaluate((element) => {
    const paragraph = element.querySelectorAll('p')[0]!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await bar.getByRole('button', { name: 'Fett' }).click();
  await bar.getByRole('button', { name: 'Kursiv' }).click();
  await bar.getByRole('button', { name: 'Unterstrichen' }).click();
  await bar.getByLabel('Textfarbe').fill('#e5533a');
  await expect(editor.locator('b,strong')).toContainText('Pipeline scheduled to execute.');
  await expect(editor.locator('i,em')).toContainText('Pipeline scheduled to execute.');
  await expect(editor.locator('u')).toContainText('Pipeline scheduled to execute.');

  await editor.evaluate((element) => {
    const paragraph = element.querySelectorAll('p')[1]!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await bar.getByRole('button', { name: 'Aufzählung' }).click();
  const bulletList = editor.locator('ul');
  await expect(bulletList.locator('li')).toContainText('Safe structured content');
  await expect.poll(() => bulletList.evaluate((element) => getComputedStyle(element).listStyleType)).toBe('disc');

  await editor.evaluate((element) => {
    const paragraph = Array.from(element.querySelectorAll('p')).find((candidate) => candidate.textContent?.includes('Editable by humans and agents'))!;
    const selection = window.getSelection()!;
    const range = document.createRange(); range.selectNodeContents(paragraph);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await bar.getByRole('button', { name: 'Nummerierte Liste' }).click();
  const numberedList = editor.locator('ol');
  await expect(numberedList.locator('li')).toContainText('Editable by humans and agents');
  await expect.poll(() => numberedList.evaluate((element) => getComputedStyle(element).listStyleType)).toBe('decimal');

  await editor.evaluate((element) => {
    const paragraph = Array.from(element.querySelectorAll('p')).find((candidate) => candidate.textContent?.includes('Everything remains understandable.'))!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await bar.getByRole('button', { name: 'Zitat' }).click();
  await expect(editor.locator('blockquote')).toContainText('Everything remains understandable.');

  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await editor.press('ControlOrMeta+Enter');
  await expect(editor).toHaveCount(0);
  await expect(annotation.locator('.annotation-body h1')).toContainText('Synchronization Orchestration');
  await expect(annotation.locator('.annotation-body .block-bullet')).toContainText('Safe structured content');
  await expect(annotation.locator('.annotation-body .block-numbered')).toContainText('Editable by humans and agents');
  await expect(annotation.locator('.annotation-body blockquote')).toContainText('Everything remains understandable.');

  const annotationBox = (await annotation.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  expect(barBox.y + barBox.height).toBeLessThan(annotationBox.y);

  await page.getByTestId('more-shapes').click();
  const sidebar = page.getByTestId('shape-library-sidebar');
  await sidebar.getByRole('searchbox', { name: 'Formen durchsuchen' }).fill('Annotation');
  await expect(sidebar.getByRole('button', { name: 'Annotation', exact: true })).toBeVisible();
});

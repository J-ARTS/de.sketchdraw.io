import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const CODE = 'sequenceDiagram\n    participant Client\n    participant Dienst\n    Client->>Dienst: Anfrage\n    Dienst-->>Client: Antwort\n';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
});

/** A sequence diagram with its code panel open; returns the panel and the code field. */
async function openCode(page: Page): Promise<{ panel: Locator; code: Locator }> {
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-sequence').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.getByRole('button', { name: 'Beispiel: Anfrage und Antwort', exact: true }).click();
  await library.getByRole('button', { name: 'Formen schließen' }).click();
  await page.getByRole('toolbar', { name: 'Eigenschaften' }).getByRole('button', { name: 'Elementaktionen' }).click();
  await page.getByRole('button', { name: 'Mermaid-Code anzeigen' }).click();
  const panel = page.getByRole('complementary', { name: 'Mermaid-Code' });
  const code = panel.getByRole('textbox', { name: 'Mermaid-Code des Diagramms' });
  await expect(code).toHaveValue(CODE);
  await code.focus();
  return { panel, code };
}
const selection = (code: Locator) => code.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd));
const head = (page: Page, name: string) => page.locator('.whiteboard-canvas [data-sequence-role="head"]').filter({ hasText: name });

test('Ctrl+F searches the code: hits are counted, marked and visited in turn (#245)', async ({ page }) => {
  const { panel, code } = await openCode(page);
  await expect(panel.getByTestId('find-bar')).toHaveCount(0);

  // The selected word becomes the search text; the search starts at the cursor.
  await code.evaluate((el: HTMLTextAreaElement, text) => { const at = el.value.indexOf('Dienst', text.indexOf('->>')); el.setSelectionRange(at, at + 6); }, CODE);
  await page.keyboard.press('ControlOrMeta+f');
  const bar = panel.getByRole('search', { name: 'Suchen' });
  const query = bar.getByRole('textbox', { name: 'Suchen' });
  await expect(query).toBeFocused();
  await expect(query).toHaveValue('Dienst');
  await expect(bar.getByTestId('find-count')).toHaveText('2/3');
  await expect(bar.getByRole('status')).toHaveText('Treffer 2 von 3');
  const marks = panel.getByTestId('diagram-code-marks').locator('mark');
  await expect(marks).toHaveCount(3);
  await expect(marks.nth(1)).toHaveAttribute('data-current', 'true');

  // The marks lie on the text: the current one sits where the field has that word.
  const mark = (await marks.nth(1).boundingBox())!;
  const field = (await code.boundingBox())!;
  const style = await code.evaluate((el) => { const css = getComputedStyle(el); return { line: parseFloat(css.lineHeight), top: parseFloat(css.paddingTop) + parseFloat(css.borderTopWidth) }; });
  expect(Math.abs(mark.y - (field.y + style.top + 3 * style.line))).toBeLessThan(style.line / 2);

  // Enter goes on, Shift+Enter back, both around the ends; the buttons do the same.
  await page.keyboard.press('Enter');
  await expect(bar.getByTestId('find-count')).toHaveText('3/3');
  await page.keyboard.press('Enter');
  await expect(bar.getByTestId('find-count')).toHaveText('1/3');
  await page.keyboard.press('Shift+Enter');
  await expect(bar.getByTestId('find-count')).toHaveText('3/3');
  await bar.getByRole('button', { name: 'Vorheriger Treffer' }).click();
  await expect(bar.getByTestId('find-count')).toHaveText('2/3');
  await bar.getByRole('button', { name: 'Nächster Treffer' }).click();
  await expect(bar.getByTestId('find-count')).toHaveText('3/3');
  await expect(query).toHaveValue('Dienst');

  // Options narrow the search.
  // A new search text is looked for from where the search stands: the last line here.
  await query.fill('client');
  await expect(bar.getByTestId('find-count')).toHaveText('3/3');
  await bar.getByRole('button', { name: 'Groß-/Kleinschreibung beachten' }).click();
  await expect(bar.getByRole('button', { name: 'Groß-/Kleinschreibung beachten' })).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByTestId('find-count')).toHaveText('0/0');
  await expect(bar.getByRole('status')).toHaveText('Keine Treffer');
  await expect(bar.getByRole('button', { name: 'Nächster Treffer' })).toBeDisabled();
  await bar.getByRole('button', { name: 'Groß-/Kleinschreibung beachten' }).click();
  await query.fill('an');
  await expect(bar.getByTestId('find-count')).toHaveText(/^\d\/4$/);
  await bar.getByRole('button', { name: 'Nur ganze Wörter' }).click();
  await expect(bar.getByTestId('find-count')).toHaveText('0/0');
  await bar.getByRole('button', { name: 'Nur ganze Wörter' }).click();
  await bar.getByRole('button', { name: 'Regulärer Ausdruck' }).click();
  await query.fill('participant (\\w+)$');
  await expect(bar.getByTestId('find-count')).toHaveText('1/2');
  await query.fill('participant (');
  await expect(bar.getByTestId('find-note')).toHaveText('Der reguläre Ausdruck ist nicht lesbar.');
  await expect(query).toHaveAttribute('aria-invalid', 'true');
  await expect(panel.getByTestId('diagram-code-marks')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include('[data-testid="diagram-code-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Escape closes the search; the cursor is back in the code, on the hit the search stood on.
  await query.fill('Antwort');
  await bar.getByRole('button', { name: 'Regulärer Ausdruck' }).click();
  await expect(bar.getByTestId('find-count')).toHaveText('1/1');
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('find-bar')).toHaveCount(0);
  await expect(code).toBeFocused();
  expect(await selection(code)).toBe('Antwort');
  // Nothing was changed by searching.
  await expect(code).toHaveValue(CODE);
  await expect(panel.getByTestId('diagram-code-status')).toHaveText('Code und Zeichenfläche sind auf demselben Stand.');

  // The button in the heading opens and closes the same bar, and a second Escape leaves the code as before.
  await panel.getByRole('button', { name: 'Im Code suchen und ersetzen' }).click();
  await expect(panel.getByRole('search', { name: 'Suchen' }).getByRole('textbox', { name: 'Suchen' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(code).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('whiteboard-canvas')).toBeFocused();
});

test('Ctrl+R replaces in the code, one hit or all, and the canvas follows (#245)', async ({ page }) => {
  const { panel, code } = await openCode(page);
  await code.evaluate((el: HTMLTextAreaElement) => { const at = el.value.indexOf('Dienst'); el.setSelectionRange(at, at + 6); });
  await page.keyboard.press('ControlOrMeta+r');
  const bar = panel.getByRole('search', { name: 'Suchen und Ersetzen' });
  const replacement = bar.getByRole('textbox', { name: 'Ersetzen durch' });
  await expect(bar.getByRole('textbox', { name: 'Suchen' })).toHaveValue('Dienst');
  await expect(replacement).toBeFocused();
  await expect(bar.getByTestId('find-count')).toHaveText('1/3');
  await expect(bar.getByRole('button', { name: 'Ersetzen', exact: true })).toBeEnabled();

  // Enter replaces the current hit and goes to the next one.
  await page.keyboard.type('Server');
  await page.keyboard.press('Enter');
  await expect(code).toHaveValue(CODE.replace('participant Dienst', 'participant Server'));
  await expect(bar.getByTestId('find-count')).toHaveText('1/2');
  await expect(replacement).toBeFocused();

  // "Replace all" does the rest in one step; the diagram on the canvas is renamed with it.
  await bar.getByRole('button', { name: 'Alle ersetzen' }).click();
  await expect(code).toHaveValue(CODE.replaceAll('Dienst', 'Server'));
  await expect(bar.getByTestId('find-note')).toHaveText('Ersetzte Treffer: 2');
  await expect(bar.getByTestId('find-count')).toHaveText('0/0');
  await expect(bar.getByRole('button', { name: 'Alle ersetzen' })).toBeDisabled();
  await expect(head(page, 'Server')).toBeVisible();
  await expect(head(page, 'Dienst')).toHaveCount(0);
  await expect(panel.getByTestId('diagram-code-status')).toHaveText('Code und Zeichenfläche sind auf demselben Stand.');

  // With a regular expression the replacement refers to groups; the spelling can be kept.
  await bar.getByRole('button', { name: 'Regulärer Ausdruck' }).click();
  await bar.getByRole('textbox', { name: 'Suchen' }).fill('(\\w+)->>(\\w+): Anfrage');
  await replacement.fill('$1->>$2: Frage');
  await expect(bar.getByTestId('find-count')).toHaveText('1/1');
  await bar.getByRole('button', { name: 'Ersetzen', exact: true }).click();
  await expect(code).toHaveValue(CODE.replaceAll('Dienst', 'Server').replace('Anfrage', 'Frage'));
  await bar.getByRole('button', { name: 'Regulärer Ausdruck' }).click();
  await bar.getByRole('textbox', { name: 'Suchen' }).fill('antwort');
  await replacement.fill('ergebnis');
  await bar.getByRole('button', { name: 'Schreibweise beibehalten' }).click();
  await bar.getByRole('button', { name: 'Alle ersetzen' }).click();
  const final = CODE.replaceAll('Dienst', 'Server').replace('Anfrage', 'Frage').replace('Antwort', 'Ergebnis');
  await expect(code).toHaveValue(final);
  await expect(page.locator('.whiteboard-canvas [data-sequence-role="message"]').filter({ hasText: 'Ergebnis' })).toHaveCount(1);
  expect((await new AxeBuilder({ page }).include('[data-testid="diagram-code-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // The row for replacing folds away again; searching stays.
  await bar.getByRole('button', { name: 'Ersetzen einblenden' }).click();
  await expect(panel.getByRole('search', { name: 'Suchen' }).getByRole('textbox', { name: 'Ersetzen durch' })).toHaveCount(0);

  // What was replaced can be taken back in the field like typing.
  await page.keyboard.press('Escape');
  await expect(code).toBeFocused();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(code).toHaveValue(CODE.replaceAll('Dienst', 'Server').replace('Anfrage', 'Frage'));
});

test('the search follows the dark theme and the English language', async ({ page }) => {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('sketchdraw.preferences.v1') ?? '{}');
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ ...raw, version: raw.version ?? 1, theme: 'dark', language: 'en' }));
  });
  await page.reload();
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('open-diagram-library-sequence').click();
  const library = page.getByTestId('shape-library-sidebar');
  await library.locator('button').filter({ hasText: /request|Anfrage/i }).first().click();
  await library.getByRole('button', { name: /close/i }).first().click();
  await page.getByRole('toolbar').getByRole('button', { name: 'Element actions' }).click();
  await page.getByRole('button', { name: 'Show Mermaid code' }).click();
  const panel = page.getByTestId('diagram-code-panel');
  const code = panel.getByTestId('diagram-code-editor');
  await code.focus();
  await page.keyboard.press('ControlOrMeta+r');
  const bar = panel.getByRole('search', { name: 'Search and replace' });
  await bar.getByRole('textbox', { name: 'Search' }).fill('participant');
  await expect(bar.getByRole('status')).toHaveText('Match 1 of 2');
  await expect(bar.getByRole('button', { name: 'Replace all' })).toBeEnabled();
  await expect(bar.getByRole('button', { name: 'Match case' })).toBeVisible();
  // The bar is a light-on-dark surface in the dark theme.
  const background = await bar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const [r, g, b] = background.match(/\d+/g)!.map(Number) as [number, number, number];
  expect(r + g + b).toBeLessThan(240);
  expect((await new AxeBuilder({ page }).include('[data-testid="diagram-code-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

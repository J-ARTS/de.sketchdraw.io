import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SUPPORT_URL = 'https://buymeacoffee.com/jeremyteichmann';

for (const [language, theme] of [['de', 'light'], ['en', 'dark']] as const) {
  test(`the workspace menu ends with "Buy me a coffee" and opens the support page in the browser (${language}, ${theme}) (#241)`, async ({ page }) => {
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language, canvasBackground: null }));
      const opened: string[] = [];
      Object.defineProperty(window, '__opened', { value: opened });
      window.open = ((url?: string | URL) => { opened.push(String(url)); return null; }) as typeof window.open;
    }, { language, theme });
    page.on('pageerror', (error) => { throw error; });
    await page.goto('/');
    await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();

    await page.getByTestId('workspace-menu-button').click();
    const menu = page.getByRole('menu', { name: language === 'de' ? 'Arbeitsbereich' : 'Workspace' });
    const entry = menu.getByTestId('workspace-menu-support');
    await expect(entry).toHaveRole('menuitem');
    await expect(entry).toHaveAccessibleName(language === 'de' ? 'Buy me a coffee öffnet im Browser' : 'Buy me a coffee opens in the browser');
    // It is the last entry, after the settings.
    expect(await menu.locator('[role^="menuitem"]').last().getAttribute('data-testid')).toBe('workspace-menu-support');
    expect((await new AxeBuilder({ page }).include('.view-menu').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

    // Reachable with the keyboard like every other entry.
    await page.keyboard.press('End');
    await expect(entry).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual([SUPPORT_URL]);
    await expect(page.getByTestId('workspace-menu-button')).toBeFocused();
  });
}

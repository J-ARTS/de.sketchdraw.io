import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.route('https://embed.example.test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors *" },
    body: '<!doctype html><title>Embed fixture</title><main data-testid="live-content" style="font:24px sans-serif;padding:24px">Live web content</main><script>localStorage.setItem("sketchdraw-embed", "ready");document.querySelector("main").dataset.storage=localStorage.getItem("sketchdraw-embed")</script>',
  }));
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('a sandboxed web embed is created, edited and managed like a canvas element', async ({ page }) => {
  const tool = page.getByRole('button', { name: 'Web-Embed', exact: true });
  await expect(tool).toHaveAttribute('title', /w/i);
  await tool.click();
  const dialog = page.getByRole('dialog', { name: 'Webseite einbetten' });
  await expect(dialog).toBeVisible();
  const input = page.getByTestId('web-embed-url');
  await input.fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Einbetten', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HTTP- oder HTTPS');
  await expect(page.locator('[data-kind="web-embed"]')).toHaveCount(0);

  await input.fill('https://embed.example.test/demo');
  await dialog.getByRole('button', { name: 'Einbetten', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const embed = page.locator('.whiteboard-canvas [data-kind="web-embed"]').first();
  await expect(embed).toHaveCount(1);
  await expect(embed.getByTestId('web-embed-surface')).toBeVisible();
  const iframe = embed.locator('iframe');
  await expect(iframe).toHaveAttribute('src', 'https://embed.example.test/demo');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-forms allow-same-origin allow-scripts');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect.poll(() => page.frames().some(frame => frame.url() === 'https://embed.example.test/demo')).toBe(true);
  await expect(page.frameLocator('iframe').getByTestId('live-content')).toHaveAttribute('data-storage', 'ready');
  const externalButton = embed.getByRole('button', { name: 'Extern öffnen' });
  await expect(externalButton).toBeVisible();
  await page.evaluate(() => {
    window.open = ((url) => {
      document.documentElement.dataset.openedExternal = String(url);
      return null;
    }) as typeof window.open;
  });
  await externalButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-opened-external', 'https://embed.example.test/demo');
  await expect(page.locator('[data-handle]')).toHaveCount(4);

  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Webadresse' }).click();
  await expect(page.getByRole('textbox', { name: 'Webadresse' })).toHaveValue('https://embed.example.test/demo');
  await expect(page.getByRole('button', { name: 'Webseite extern öffnen ↗' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+D');
  await expect(page.locator('.whiteboard-canvas [data-kind="web-embed"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('.whiteboard-canvas [data-kind="web-embed"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('W opens the web embed dialog from the canvas', async ({ page }) => {
  await page.getByTestId('whiteboard-canvas').press('W');
  await expect(page.getByRole('dialog', { name: 'Webseite einbetten' })).toBeVisible();
  await page.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Auswahl', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('the app origin is never embedded with scripts and same-origin privileges', async ({ page }) => {
  await page.getByRole('button', { name: 'Web-Embed', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Webseite einbetten' });
  await dialog.getByTestId('web-embed-url').fill(`${new URL(page.url()).origin}/private`);
  await dialog.getByRole('button', { name: 'Einbetten', exact: true }).click();

  const embed = page.locator('.whiteboard-canvas [data-kind="web-embed"]').first();
  await expect(embed.locator('iframe')).toHaveCount(0);
  await expect(embed).toContainText('Sketchdraw-App selbst kann hier nicht sicher eingebettet werden');
  await expect(embed.getByRole('button', { name: 'Extern öffnen' })).toBeVisible();
});

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createDocument, createElement, serializeDocument } from '../../src/domain';

// The tool to embed a web page is gone (#226): most sites forbid being shown in a frame. Documents that already
// contain an embed must keep opening and showing it, so these tests load such a document instead of creating one.
function documentWithEmbed(url: string): string {
  const document = createDocument('Mit Einbettung');
  document.elements = [createElement('web-embed', { id: 'web-embed:one', pageId: document.pages[0]!.id, x: 120, y: 160, width: 640, height: 400, embedUrl: url, label: new URL(url).hostname })];
  return serializeDocument(document);
}
async function openDocument(page: Page, contents: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('file-menu-button').click(); await page.getByTestId('file-menu-open').click();
  await (await chooser).setFiles({ name: 'embed.sketchdraw.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  await page.route('https://embed.example.test/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors *" },
    body: '<!doctype html><title>Embed fixture</title><main data-testid="live-content" style="font:24px sans-serif;padding:24px">Live web content</main><script>localStorage.setItem("sketchdraw-embed","ready");document.querySelector("main").dataset.storage=localStorage.getItem("sketchdraw-embed")</script>',
  }));
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('nothing offers to embed a web page any more', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Web-Embed', exact: true })).toHaveCount(0);
  await page.getByTestId('whiteboard-canvas').press('W');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Auswahl', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('more-shapes').click();
  await page.getByTestId('shape-library-sidebar').getByRole('searchbox').fill('embed');
  await expect(page.getByTestId('shape-library-sidebar')).not.toContainText('Web-Embed');
});

test('an embed of an existing document still shows sandboxed and is managed like a canvas element', async ({ page }) => {
  await openDocument(page, documentWithEmbed('https://embed.example.test/demo'));
  const embed = page.locator('.whiteboard-canvas [data-kind="web-embed"]').first();
  await expect(embed).toHaveCount(1);
  await expect(embed.getByTestId('web-embed-surface')).toBeVisible();
  const iframe = embed.locator('iframe');
  await expect(iframe).toHaveAttribute('src', 'https://embed.example.test/demo');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-forms allow-same-origin allow-scripts');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect.poll(() => page.frames().some(frame => frame.url() === 'https://embed.example.test/demo')).toBe(true);
  await expect(page.frameLocator('iframe').getByTestId('live-content')).toHaveAttribute('data-storage', 'ready');
  // Until it is selected the embed is a canvas element like any other; selected, its content can be used.
  await embed.getByTestId('web-embed-surface').click({ force: true });
  await expect(page.locator('[data-handle]')).toHaveCount(4);
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

  const bar = page.getByRole('toolbar', { name: 'Eigenschaften' });
  await bar.getByRole('button', { name: 'Webadresse' }).click();
  await expect(page.getByRole('textbox', { name: 'Webadresse' })).toHaveValue('https://embed.example.test/demo');
  await page.keyboard.press('Escape');

  await page.keyboard.press('ControlOrMeta+D');
  await expect(page.locator('.whiteboard-canvas [data-kind="web-embed"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect(page.locator('.whiteboard-canvas [data-kind="web-embed"]')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  // It can be removed like anything else.
  await page.getByTestId('whiteboard-canvas').focus();
  await page.keyboard.press('ControlOrMeta+A');
  await expect(page.locator('[data-handle]')).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.whiteboard-canvas [data-kind="web-embed"]')).toHaveCount(0);
});

test('the app origin is never embedded with scripts and same-origin privileges', async ({ page }) => {
  await openDocument(page, documentWithEmbed(`${new URL(page.url()).origin}/private`));
  const embed = page.locator('.whiteboard-canvas [data-kind="web-embed"]').first();
  await expect(embed.locator('iframe')).toHaveCount(0);
  await expect(embed).toContainText('Sketchdraw-App selbst kann hier nicht sicher eingebettet werden');
  await expect(embed.getByRole('button', { name: 'Extern öffnen' })).toBeVisible();
});

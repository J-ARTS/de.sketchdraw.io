import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ConfluenceLivePublishInput, ConfluencePageLiveLink, PluginSettingsSnapshot, SaveDocumentRequest } from '../../src/domain';

/**
 * The live link of a diagram page to a Confluence page (#210, #240) in the real renderer: the link is made in the
 * menu of the page, and from then on the window renders that page to a PNG and hands it to the desktop bridge after
 * each change. The bridge is a mock; what Confluence does with the images is covered by tests/unit/confluence-live-service.spec.ts.
 */
type Published = { documentId: string; title: string; diagramPageId: string | undefined; images: Array<{ pageId: string; name: string; hash: string; width: number; height: number; signature: number[]; bytes: number; pixelWidth: number; pixelHeight: number }> };
type LiveTestState = { published: Published[]; links: Array<{ diagramPageId: string | undefined; pageId: string | null; pages: number }>; result: 'synced' | 'retry' | 'failed' };
type TestWindow = Window & { __liveTest: LiveTestState };

async function desktop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: 'light', language: 'de', canvasBackground: null }));
    const control: LiveTestState = { published: [], links: [], result: 'synced' };
    let folder = ''; let links: ConfluencePageLiveLink[] = [];
    const targets = [{ id: '164037', title: 'Architektur', version: 1, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164037' }, { id: '164038', title: 'Betrieb', version: 4, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164038' }];
    const file = { handleId: 'architecture-file', name: 'Architecture.sketchdraw', versionToken: 'version-1' };
    const snapshot = (): PluginSettingsSnapshot => ({
      available: true, projectFolder: folder, profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default',
      git: { installed: true, enabled: false, folderPath: folder, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
      atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready', message: 'Jira ist eingerichtet.' },
      ...(folder && links.length ? { confluencePageLinks: links.map((link) => ({ ...link })) } : {}),
    });
    Object.defineProperty(window, '__liveTest', { value: control });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'cancelled' }),
      saveDocument: async (_request: SaveDocumentRequest) => { folder = '/Users/demo/architecture'; return { status: 'saved', file: { ...file } }; },
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      plugins: {
        getSettings: async (handleId?: string | null) => { if (handleId === null) folder = ''; else if (handleId !== undefined) folder = '/Users/demo/architecture'; return snapshot(); },
        selectProfile: async () => snapshot(), createProfile: async () => snapshot(), renameProfile: async () => snapshot(), deleteProfile: async () => snapshot(),
        afterDocumentSaved: async () => {}, installPlugin: async () => snapshot(), uninstallPlugin: async () => snapshot(),
        configureGit: async () => snapshot(), configureAtlassian: async () => snapshot(), testAtlassian: async () => ({ ok: true, message: 'Jira: verbunden' }),
        gitStatus: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }), gitSync: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }),
        watchDocument: async () => ({ ok: true, message: 'watching' }),
        listConfluencePages: async (query: string) => targets.filter((entry) => entry.title.toLowerCase().includes(query.toLowerCase())),
        getConfluencePage: async () => { throw new Error('not used'); }, updateConfluencePage: async () => { throw new Error('The manual send must not be used.'); },
        setConfluenceLiveLink: async (input: { handleId: string; documentId: string; pageId: string | null; diagramPageId?: string; diagramPageIds?: string[] }) => {
          control.links.push({ diagramPageId: input.diagramPageId, pageId: input.pageId, pages: input.diagramPageIds?.length ?? 0 });
          links = links.filter((link) => link.diagramPageId !== input.diagramPageId);
          const target = targets.find((entry) => entry.id === input.pageId);
          if (target && input.diagramPageId) links.push({ diagramPageId: input.diagramPageId, pageId: target.id, pageTitle: target.title, pageUrl: target.url, siteUrl: 'https://example.atlassian.net', documentId: input.documentId, usable: true });
          return snapshot();
        },
        publishConfluenceLive: async (input: ConfluenceLivePublishInput) => {
          const images: Published['images'] = [];
          for (const image of input.images) {
            // Decoding with the browser proves that the bytes are a real picture of the stated size.
            const bitmap = await createImageBitmap(new Blob([image.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
            images.push({ pageId: image.pageId, name: image.name, hash: image.hash, width: image.width, height: image.height, signature: [...image.png.slice(0, 8)], bytes: image.png.byteLength, pixelWidth: bitmap.width, pixelHeight: bitmap.height });
          }
          control.published.push({ documentId: input.documentId, title: input.title, diagramPageId: input.diagramPageId, images });
          if (control.result === 'synced') return { status: 'synced', message: 'Diagramm in Confluence aktualisiert.', uploaded: images.length, bodyUpdated: false, syncedAt: new Date().toISOString() };
          return { status: control.result, message: control.result === 'retry' ? 'Confluence ist nicht erreichbar. Die Veröffentlichung wird wiederholt, sobald die Verbindung steht.' : 'Confluence verweigert den Zugriff. Prüfe das API-Token und die Rechte für die Seite.', uploaded: 0, bodyUpdated: false };
        },
        createJiraIssue: async () => { throw new Error('not used'); }, listJiraIssues: async () => [], updateJiraIssue: async () => { throw new Error('not used'); }, transitionJiraIssue: async () => { throw new Error('not used'); }, onEvent: () => () => {},
      },
    } });
  });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

const live = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__liveTest));
const axe = async (page: Page, selector: string) => (await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;

/** Opens the page list and, from the menu of the named page, the dialog that links it to Confluence. */
async function openLinkDialog(page: Page, name: string, entry: 'Confluence-Seite verknüpfen…' | 'Confluence-Verknüpfung…'): Promise<Locator> {
  const panel = page.getByRole('dialog', { name: 'Seiten', exact: true });
  if (!await panel.isVisible()) await page.getByTestId('page-switcher').click();
  await panel.getByRole('button', { name: `Aktionen für ${name}`, exact: true }).click();
  await page.getByTestId('page-menu').getByRole('menuitem', { name: entry, exact: true }).click();
  const dialog = page.getByTestId('confluence-page-link-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `Confluence-Seite für „${name}“` })).toBeVisible();
  return dialog;
}

async function draw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(from[0], from[1]); await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up();
}

test('each page is linked to its own Confluence page in the page menu and published after every edit without sending (#210, #240)', async ({ page }) => {
  test.setTimeout(90_000);
  await desktop(page);
  await draw(page, [350, 220], [550, 360]);

  // Without a saved local diagram nothing can be linked; the dialog says what is missing.
  let dialog = await openLinkDialog(page, 'Seite 1', 'Confluence-Seite verknüpfen…');
  await expect(dialog.getByTestId('confluence-page-link-blocked')).toHaveText('Speichere das Diagramm lokal, um seine Seiten mit Confluence zu verknüpfen.');
  await expect(dialog.getByTestId('confluence-page-link-search')).toHaveCount(0);
  await expect(dialog).toContainText('solange die Desktop-App mit diesem Diagramm geöffnet ist');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // The page list was closed for the dialog; the focus is back on its button.
  await expect(page.getByTestId('page-switcher')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => page.evaluate(() => document.title)).not.toBe('');

  // The target page is searched and chosen for this page of the diagram.
  dialog = await openLinkDialog(page, 'Seite 1', 'Confluence-Seite verknüpfen…');
  await expect(dialog.getByTestId('confluence-page-link-search')).toBeFocused();
  expect(await axe(page, '[data-testid=confluence-page-link-dialog]')).toEqual([]);
  await dialog.getByTestId('confluence-page-link-search').fill('zzz');
  await dialog.getByRole('button', { name: 'Suchen', exact: true }).click();
  await expect(dialog).toContainText('Keine Confluence-Seite gefunden.');
  await dialog.getByTestId('confluence-page-link-search').fill('Arch');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: '„Seite 1“ mit „Architektur“ verknüpfen', exact: true }).click();
  await expect(dialog.getByTestId('confluence-link-target')).toHaveText('Architektur');
  await expect(dialog.getByTestId('confluence-link-status')).toContainText('Diagramm in Confluence aktualisiert.', { timeout: 15_000 });
  await expect(dialog.getByTestId('confluence-link-synced-at')).toContainText('Zuletzt übertragen:');
  await expect(dialog.getByRole('button', { name: '„Seite 1“ mit „Architektur“ verknüpfen', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('Mit dieser Seite verknüpft');
  expect(await axe(page, '[data-testid=confluence-page-link-dialog]')).toEqual([]);

  let state = await live(page);
  expect(state.links).toHaveLength(1);
  expect(state.links[0]).toMatchObject({ pageId: '164037', pages: 1 });
  const firstPageId = state.links[0]!.diagramPageId!;
  expect(state.published).toHaveLength(1);
  expect(state.published[0]!.diagramPageId).toBe(firstPageId);
  expect(state.published[0]!.images.map((image) => image.pageId)).toEqual([firstPageId]);
  const first = state.published[0]!.images[0]!;
  expect(first.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(first.pixelWidth).toBeGreaterThanOrEqual(first.width);
  expect(first.pixelHeight).toBeGreaterThanOrEqual(first.height);
  expect(first.bytes).toBeGreaterThan(1000);

  // The controls were disabled and enabled again while linking and publishing; the keyboard focus stayed in the
  // dialog and is on the action the user was led to.
  await expect(dialog.getByTestId('confluence-link-sync-now')).toBeFocused();

  // Even if the focus is lost to the page, keys do not act on the diagram behind the modal dialog …
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  const elementsBefore = await page.locator('[data-element-id]').count();
  expect(elementsBefore).toBeGreaterThan(0);
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  expect(await page.locator('[data-element-id]').count()).toBe(elementsBefore);

  // … and Escape closes the dialog. An edit on the canvas then reaches Confluence on its own.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await draw(page, [620, 240], [760, 340]);
  await expect.poll(async () => (await live(page)).published.length, { timeout: 15_000 }).toBe(2);
  state = await live(page);
  expect(state.published[1]!.diagramPageId).toBe(firstPageId);
  expect(state.published[1]!.images[0]!.hash).not.toBe(first.hash);
  expect(state.published[1]!.images[0]!.width).toBeGreaterThan(first.width);

  // The linked page is marked in the page list, and its menu now manages the link.
  await page.getByTestId('page-switcher').click();
  const panel = page.getByRole('dialog', { name: 'Seiten', exact: true });
  await expect(panel.getByTestId(`page-confluence-${firstPageId}`)).toHaveAttribute('title', 'Mit Confluence-Seite „Architektur“ verknüpft');
  // The link describes the page button; its name stays the page name.
  await expect(panel.getByRole('button', { name: 'Seite 1', exact: true })).toHaveAccessibleDescription('Mit Confluence-Seite „Architektur“ verknüpft');

  // A second page has no link: adding it changes the picture of the first page (its heading now names the page), drawing on the second sends nothing.
  await page.getByTestId('page-add').click();
  await expect(panel.getByRole('button', { name: 'Seite 2', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(async () => (await live(page)).published.length, { timeout: 15_000 }).toBe(3);
  await page.keyboard.press('Escape');
  await draw(page, [350, 220], [550, 360]);
  await page.waitForTimeout(4500);
  state = await live(page);
  expect(state.published).toHaveLength(3);
  expect(state.published.every((entry) => entry.diagramPageId === firstPageId && entry.images.length === 1)).toBe(true);

  // The second page goes to another Confluence page; only its picture is sent there.
  dialog = await openLinkDialog(page, 'Seite 2', 'Confluence-Seite verknüpfen…');
  await dialog.getByTestId('confluence-page-link-search').fill('Betr');
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: '„Seite 2“ mit „Betrieb“ verknüpfen', exact: true }).click();
  await expect(dialog.getByTestId('confluence-link-target')).toHaveText('Betrieb');
  await expect(dialog.getByTestId('confluence-link-status')).toContainText('Diagramm in Confluence aktualisiert.', { timeout: 15_000 });
  state = await live(page);
  expect(state.links[1]).toMatchObject({ pageId: '164038', pages: 2 });
  const secondPageId = state.links[1]!.diagramPageId!;
  expect(secondPageId).not.toBe(firstPageId);
  expect(state.published.at(-1)!.diagramPageId).toBe(secondPageId);
  expect(state.published.at(-1)!.images.map((image) => image.pageId)).toEqual([secondPageId]);
  expect(state.published.filter((entry) => entry.diagramPageId === secondPageId)).toHaveLength(1);
  await page.keyboard.press('Escape');

  // The plugin settings no longer repeat the links or offer Live Docs (#252); a page's menu leads to its link.
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugins', exact: true }).click();
  const plugins = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await plugins.getByRole('complementary').getByRole('button', { name: /^Jira\b/ }).click();
  await expect(plugins.getByRole('heading', { name: 'Jira-Konfiguration' })).toBeVisible();
  await expect(plugins.getByRole('heading', { name: 'Seiten live in Confluence' })).toHaveCount(0);
  await expect(plugins.getByRole('heading', { name: 'Confluence Live Docs' })).toHaveCount(0);
  await expect(plugins.getByRole('searchbox', { name: 'Confluence-Seiten suchen' })).toHaveCount(0);
  await expect(plugins.getByRole('button', { name: /live verknüpfen/i })).toHaveCount(0);
  await plugins.getByRole('button', { name: 'Plugin-Einstellungen schließen', exact: true }).click();
  await expect(plugins).toBeHidden();
  dialog = await openLinkDialog(page, 'Seite 2', 'Confluence-Verknüpfung…');
  await expect(dialog.getByTestId('confluence-link-target')).toHaveText('Betrieb');

  // A problem is shown as a problem, also in the page list, and removing the link stops the publication of that page only.
  await page.evaluate(() => { (window as unknown as TestWindow).__liveTest.result = 'failed'; });
  await dialog.getByTestId('confluence-link-sync-now').click();
  await expect(dialog.getByTestId('confluence-link-status')).toContainText('verweigert den Zugriff', { timeout: 15_000 });
  await expect(dialog.getByTestId('confluence-link-status')).toHaveAttribute('role', 'alert');
  await dialog.getByTestId('confluence-link-unlink').click();
  await expect(dialog.getByTestId('confluence-link-card')).toHaveCount(0);
  await expect(dialog.getByTestId('confluence-page-link-feedback')).toContainText('Verknüpfung gelöst.');
  await expect(dialog.getByTestId('confluence-page-link-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Only that page lost its link: its menu offers linking again, and page 1 still shows its Confluence page.
  dialog = await openLinkDialog(page, 'Seite 2', 'Confluence-Seite verknüpfen…');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  dialog = await openLinkDialog(page, 'Seite 1', 'Confluence-Verknüpfung…');
  await expect(dialog.getByTestId('confluence-link-target')).toHaveText('Architektur');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  const pagesPanel = page.getByRole('dialog', { name: 'Seiten', exact: true });
  if (await pagesPanel.isVisible()) { await page.keyboard.press('Escape'); await expect(pagesPanel).toBeHidden(); }
  expect((await live(page)).links.at(-1)).toMatchObject({ diagramPageId: secondPageId, pageId: null });

  await page.evaluate(() => { (window as unknown as TestWindow).__liveTest.result = 'synced'; });
  const before = (await live(page)).published.length;
  await draw(page, [620, 420], [740, 500]);
  await page.waitForTimeout(4500);
  expect((await live(page)).published).toHaveLength(before);
});

test('the page menu offers the Confluence link only while the plugin is active', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByTestId('page-switcher').click();
  await page.getByRole('dialog', { name: 'Seiten', exact: true }).getByRole('button', { name: 'Aktionen für Seite 1', exact: true }).click();
  await expect(page.getByTestId('page-menu').getByRole('menuitem')).toHaveCount(6);
  await expect(page.getByTestId('page-menu-confluence')).toHaveCount(0);
});

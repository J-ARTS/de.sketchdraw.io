import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ConfluenceLiveLink, ConfluenceLivePublishInput, PluginSettingsSnapshot, SaveDocumentRequest } from '../../src/domain';

/**
 * The live link of a diagram to a Confluence page (#210) in the real renderer: the link is made in the plugin
 * dialog, and from then on the window renders every page to a PNG and hands it to the desktop bridge after each
 * change. The bridge is a mock; what Confluence does with the images is covered by tests/unit/confluence-live-service.spec.ts.
 */
type Published = { documentId: string; title: string; images: Array<{ pageId: string; name: string; hash: string; width: number; height: number; signature: number[]; bytes: number; pixelWidth: number; pixelHeight: number }> };
type LiveTestState = { published: Published[]; links: Array<string | null>; result: 'synced' | 'retry' | 'failed' };
type TestWindow = Window & { __liveTest: LiveTestState };

async function desktop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme: 'light', language: 'de', canvasBackground: null }));
    const control: LiveTestState = { published: [], links: [], result: 'synced' };
    let folder = ''; let link: ConfluenceLiveLink | null = null;
    const file = { handleId: 'architecture-file', name: 'Architecture.sketchdraw', versionToken: 'version-1' };
    const snapshot = (): PluginSettingsSnapshot => ({
      available: true, projectFolder: folder, profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default',
      git: { installed: true, enabled: false, folderPath: folder, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
      atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready', message: 'Jira ist eingerichtet.' },
      ...(folder && link ? { confluenceLive: { ...link } } : {}),
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
        listConfluencePages: async (query: string) => [{ id: '164037', title: 'Architektur', version: 1, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164037' }, { id: '164038', title: 'Betrieb', version: 4, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164038' }].filter((entry) => entry.title.toLowerCase().includes(query.toLowerCase())),
        getConfluencePage: async () => { throw new Error('not used'); }, updateConfluencePage: async () => { throw new Error('The manual send must not be used.'); },
        setConfluenceLiveLink: async (input: { handleId: string; documentId: string; pageId: string | null }) => {
          control.links.push(input.pageId);
          link = input.pageId === null ? null : { pageId: input.pageId, pageTitle: 'Architektur', pageUrl: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=164037', siteUrl: 'https://example.atlassian.net', documentId: input.documentId, usable: true };
          return snapshot();
        },
        publishConfluenceLive: async (input: ConfluenceLivePublishInput) => {
          const images: Published['images'] = [];
          for (const image of input.images) {
            // Decoding with the browser proves that the bytes are a real picture of the stated size.
            const bitmap = await createImageBitmap(new Blob([image.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
            images.push({ pageId: image.pageId, name: image.name, hash: image.hash, width: image.width, height: image.height, signature: [...image.png.slice(0, 8)], bytes: image.png.byteLength, pixelWidth: bitmap.width, pixelHeight: bitmap.height });
          }
          control.published.push({ documentId: input.documentId, title: input.title, images });
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

async function openJira(page: Page): Promise<Locator> {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('complementary').getByRole('button', { name: /^Jira\b/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Jira-Konfiguration' })).toBeVisible();
  return dialog;
}

async function draw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(from[0], from[1]); await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up();
}

test('a diagram is linked to a Confluence page in the plugin dialog and published after every edit without sending (#210)', async ({ page }) => {
  test.setTimeout(60_000);
  await desktop(page);
  await draw(page, [350, 220], [550, 360]);
  let dialog = await openJira(page);
  const section = dialog.getByTestId('confluence-live');

  // Without a saved local diagram nothing can be linked; the conditions are stated in plain language.
  await expect(section.getByTestId('confluence-live-empty')).toContainText('Speichere das Diagramm lokal');
  await expect(section).toContainText('solange die Desktop-App mit diesem Diagramm geöffnet ist');
  await expect(section).toContainText('„Automatisch abrufen“');
  await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  await expect(section.getByTestId('confluence-live-empty')).toContainText('Live verknüpfen');

  // The target page is searched and chosen in this dialog.
  await dialog.getByTestId('confluence-search').fill('Arch');
  await dialog.getByRole('button', { name: 'Suchen', exact: true }).click();
  await dialog.getByRole('button', { name: '„Architektur“ live verknüpfen', exact: true }).click();
  await expect(section.getByTestId('confluence-live-target')).toHaveText('Architektur');
  await expect(section.getByTestId('confluence-live-status')).toContainText('Diagramm in Confluence aktualisiert.', { timeout: 15_000 });
  await expect(section).toContainText('Zuletzt übertragen:');
  await expect(dialog.getByRole('button', { name: '„Architektur“ live verknüpfen', exact: true })).toBeDisabled();

  let state = await live(page);
  expect(state.links).toEqual(['164037']);
  expect(state.published).toHaveLength(1);
  const first = state.published[0]!.images[0]!;
  expect(first.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(first.pixelWidth).toBeGreaterThanOrEqual(first.width);
  expect(first.pixelHeight).toBeGreaterThanOrEqual(first.height);
  expect(first.bytes).toBeGreaterThan(1000);

  // The controls were disabled and enabled again while linking and publishing; the keyboard focus stayed in the
  // dialog and is back on the action the user was led to.
  await expect(dialog.getByTestId('confluence-live-sync-now')).toBeFocused();

  // Even if the focus is lost to the page, keys do not act on the diagram behind the modal dialog …
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
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
  expect(state.published[1]!.images[0]!.hash).not.toBe(first.hash);
  expect(state.published[1]!.images[0]!.width).toBeGreaterThan(first.width);

  // A problem is shown as a problem, and removing the link stops the publication.
  await page.evaluate(() => { (window as unknown as TestWindow).__liveTest.result = 'failed'; });
  await draw(page, [350, 420], [470, 500]);
  dialog = await openJira(page);
  await expect(dialog.getByTestId('confluence-live-status')).toContainText('verweigert den Zugriff', { timeout: 15_000 });
  await expect(dialog.getByTestId('confluence-live-status')).toHaveAttribute('role', 'alert');
  await dialog.getByRole('button', { name: 'Verknüpfung lösen', exact: true }).click();
  await expect(dialog.getByTestId('confluence-live-empty')).toBeVisible();
  await expect(dialog.getByTestId('confluence-live-heading')).toBeFocused();
  const before = (await live(page)).published.length;
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await draw(page, [620, 420], [740, 500]);
  await page.waitForTimeout(4500);
  expect((await live(page)).published).toHaveLength(before);
  expect((await live(page)).links).toEqual(['164037', null]);
});

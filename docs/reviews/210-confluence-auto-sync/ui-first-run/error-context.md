# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/ui/confluence-live.spec.ts >> a diagram is linked to a Confluence page in the plugin dialog and published after every edit without sending (#210)
- Location: tests/ui/confluence-live.spec.ts:83:1

# Error details

```
Error: expect(locator).toBeHidden() failed

Locator:  getByRole('dialog', { name: 'Plugins', exact: true })
Expected: hidden
Received: visible
Timeout:  5000ms

Call log:
  - Expect "toBeHidden" getByRole('dialog', { name: 'Plugins', exact: true }) with timeout 5000ms
  - waiting for getByRole('dialog', { name: 'Plugins', exact: true })
    14 × locator resolved to <dialog open="" data-v-dee3372e="" data-v-ced5b2ce="" class="plugin-dialog" aria-labelledby="plugin-title">…</dialog>
       - unexpected value "visible"

```

```yaml
- dialog "Plugins":
  - text: INTEGRATIONEN
  - heading "Plugins" [level=1]
  - tablist "Plugin-Bereiche"
  - button "Plugin-Einstellungen schließen"
  - text: Projektordner
  - strong: /Users/demo/architecture
  - text: Profil „Standard“
  - status: Diagramm mit Confluence-Seite „Architektur“ verknüpft. Änderungen werden automatisch übertragen.
  - tabpanel "Installiert 2"
```

# Test source

```ts
  17  |     let folder = ''; let link: ConfluenceLiveLink | null = null;
  18  |     const file = { handleId: 'architecture-file', name: 'Architecture.sketchdraw', versionToken: 'version-1' };
  19  |     const snapshot = (): PluginSettingsSnapshot => ({
  20  |       available: true, projectFolder: folder, profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default',
  21  |       git: { installed: true, enabled: false, folderPath: folder, autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
  22  |       atlassian: { installed: true, enabled: true, siteUrl: 'https://example.atlassian.net', email: 'user@example.com', confluenceSpaceKey: 'DOC', jiraProjectKey: 'SK', jiraIssueType: 'Task', jqlFilter: '', credentialStored: true, health: 'ready', message: 'Jira ist eingerichtet.' },
  23  |       ...(folder && link ? { confluenceLive: { ...link } } : {}),
  24  |     });
  25  |     Object.defineProperty(window, '__liveTest', { value: control });
  26  |     Object.defineProperty(window, 'sketchdraw', { value: {
  27  |       platform: 'electron',
  28  |       openDocument: async () => ({ status: 'cancelled' }),
  29  |       saveDocument: async (_request: SaveDocumentRequest) => { folder = '/Users/demo/architecture'; return { status: 'saved', file: { ...file } }; },
  30  |       exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
  31  |       onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
  32  |       plugins: {
  33  |         getSettings: async (handleId?: string | null) => { if (handleId === null) folder = ''; else if (handleId !== undefined) folder = '/Users/demo/architecture'; return snapshot(); },
  34  |         selectProfile: async () => snapshot(), createProfile: async () => snapshot(), renameProfile: async () => snapshot(), deleteProfile: async () => snapshot(),
  35  |         afterDocumentSaved: async () => {}, installPlugin: async () => snapshot(), uninstallPlugin: async () => snapshot(),
  36  |         configureGit: async () => snapshot(), configureAtlassian: async () => snapshot(), testAtlassian: async () => ({ ok: true, message: 'Jira: verbunden' }),
  37  |         gitStatus: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }), gitSync: async () => ({ ok: true, message: 'Repository ist synchron.', settings: snapshot().git }),
  38  |         watchDocument: async () => ({ ok: true, message: 'watching' }),
  39  |         listConfluencePages: async (query: string) => [{ id: '164037', title: 'Architektur', version: 1, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164037' }, { id: '164038', title: 'Betrieb', version: 4, url: 'https://example.atlassian.net/wiki/spaces/DOC/pages/164038' }].filter((entry) => entry.title.toLowerCase().includes(query.toLowerCase())),
  40  |         getConfluencePage: async () => { throw new Error('not used'); }, updateConfluencePage: async () => { throw new Error('The manual send must not be used.'); },
  41  |         setConfluenceLiveLink: async (input: { handleId: string; documentId: string; pageId: string | null }) => {
  42  |           control.links.push(input.pageId);
  43  |           link = input.pageId === null ? null : { pageId: input.pageId, pageTitle: 'Architektur', pageUrl: 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=164037', siteUrl: 'https://example.atlassian.net', documentId: input.documentId, usable: true };
  44  |           return snapshot();
  45  |         },
  46  |         publishConfluenceLive: async (input: ConfluenceLivePublishInput) => {
  47  |           const images: Published['images'] = [];
  48  |           for (const image of input.images) {
  49  |             // Decoding with the browser proves that the bytes are a real picture of the stated size.
  50  |             const bitmap = await createImageBitmap(new Blob([image.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  51  |             images.push({ pageId: image.pageId, name: image.name, hash: image.hash, width: image.width, height: image.height, signature: [...image.png.slice(0, 8)], bytes: image.png.byteLength, pixelWidth: bitmap.width, pixelHeight: bitmap.height });
  52  |           }
  53  |           control.published.push({ documentId: input.documentId, title: input.title, images });
  54  |           if (control.result === 'synced') return { status: 'synced', message: 'Diagramm in Confluence aktualisiert.', uploaded: images.length, bodyUpdated: false, syncedAt: new Date().toISOString() };
  55  |           return { status: control.result, message: control.result === 'retry' ? 'Confluence ist nicht erreichbar. Die Veröffentlichung wird wiederholt, sobald die Verbindung steht.' : 'Confluence verweigert den Zugriff. Prüfe das API-Token und die Rechte für die Seite.', uploaded: 0, bodyUpdated: false };
  56  |         },
  57  |         createJiraIssue: async () => { throw new Error('not used'); }, listJiraIssues: async () => [], updateJiraIssue: async () => { throw new Error('not used'); }, transitionJiraIssue: async () => { throw new Error('not used'); }, onEvent: () => () => {},
  58  |       },
  59  |     } });
  60  |   });
  61  |   await page.goto('/');
  62  |   await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  63  | }
  64  | 
  65  | const live = (page: Page) => page.evaluate(() => structuredClone((window as unknown as TestWindow).__liveTest));
  66  | 
  67  | async function openJira(page: Page): Promise<Locator> {
  68  |   await page.getByTestId('workspace-menu-button').click();
  69  |   await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  70  |   const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  71  |   await expect(dialog).toBeVisible();
  72  |   await dialog.getByRole('complementary').getByRole('button', { name: /^Jira\b/ }).click();
  73  |   await expect(dialog.getByRole('heading', { name: 'Jira-Konfiguration' })).toBeVisible();
  74  |   return dialog;
  75  | }
  76  | 
  77  | async function draw(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  78  |   await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  79  |   await page.mouse.move(from[0], from[1]); await page.mouse.down();
  80  |   await page.mouse.move(to[0], to[1], { steps: 8 }); await page.mouse.up();
  81  | }
  82  | 
  83  | test('a diagram is linked to a Confluence page in the plugin dialog and published after every edit without sending (#210)', async ({ page }) => {
  84  |   test.setTimeout(60_000);
  85  |   await desktop(page);
  86  |   await draw(page, [350, 220], [550, 360]);
  87  |   let dialog = await openJira(page);
  88  |   const section = dialog.getByTestId('confluence-live');
  89  | 
  90  |   // Without a saved local diagram nothing can be linked; the conditions are stated in plain language.
  91  |   await expect(section.getByTestId('confluence-live-empty')).toContainText('Speichere das Diagramm lokal');
  92  |   await expect(section).toContainText('solange die Desktop-App mit diesem Diagramm geöffnet ist');
  93  |   await expect(section).toContainText('„Automatisch abrufen“');
  94  |   await dialog.getByRole('button', { name: 'Diagramm speichern', exact: true }).click();
  95  |   await expect(section.getByTestId('confluence-live-empty')).toContainText('Live verknüpfen');
  96  | 
  97  |   // The target page is searched and chosen in this dialog.
  98  |   await dialog.getByTestId('confluence-search').fill('Arch');
  99  |   await dialog.getByRole('button', { name: 'Suchen', exact: true }).click();
  100 |   await dialog.getByRole('button', { name: '„Architektur“ live verknüpfen', exact: true }).click();
  101 |   await expect(section.getByTestId('confluence-live-target')).toHaveText('Architektur');
  102 |   await expect(section.getByTestId('confluence-live-status')).toContainText('Diagramm in Confluence aktualisiert.', { timeout: 15_000 });
  103 |   await expect(section).toContainText('Zuletzt übertragen:');
  104 |   await expect(dialog.getByRole('button', { name: '„Architektur“ live verknüpfen', exact: true })).toBeDisabled();
  105 | 
  106 |   let state = await live(page);
  107 |   expect(state.links).toEqual(['164037']);
  108 |   expect(state.published).toHaveLength(1);
  109 |   const first = state.published[0]!.images[0]!;
  110 |   expect(first.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  111 |   expect(first.pixelWidth).toBeGreaterThanOrEqual(first.width);
  112 |   expect(first.pixelHeight).toBeGreaterThanOrEqual(first.height);
  113 |   expect(first.bytes).toBeGreaterThan(1000);
  114 | 
  115 |   // An edit on the canvas reaches Confluence on its own.
  116 |   await page.keyboard.press('Escape');
> 117 |   await expect(dialog).toBeHidden();
      |                        ^ Error: expect(locator).toBeHidden() failed
  118 |   await draw(page, [620, 240], [760, 340]);
  119 |   await expect.poll(async () => (await live(page)).published.length, { timeout: 15_000 }).toBe(2);
  120 |   state = await live(page);
  121 |   expect(state.published[1]!.images[0]!.hash).not.toBe(first.hash);
  122 |   expect(state.published[1]!.images[0]!.width).toBeGreaterThan(first.width);
  123 | 
  124 |   // A problem is shown as a problem, and removing the link stops the publication.
  125 |   await page.evaluate(() => { (window as unknown as TestWindow).__liveTest.result = 'failed'; });
  126 |   await draw(page, [350, 420], [470, 500]);
  127 |   dialog = await openJira(page);
  128 |   await expect(dialog.getByTestId('confluence-live-status')).toContainText('verweigert den Zugriff', { timeout: 15_000 });
  129 |   await expect(dialog.getByTestId('confluence-live-status')).toHaveAttribute('role', 'alert');
  130 |   await dialog.getByRole('button', { name: 'Verknüpfung lösen', exact: true }).click();
  131 |   await expect(dialog.getByTestId('confluence-live-empty')).toBeVisible();
  132 |   const before = (await live(page)).published.length;
  133 |   await page.keyboard.press('Escape');
  134 |   await draw(page, [620, 420], [740, 500]);
  135 |   await page.waitForTimeout(4500);
  136 |   expect((await live(page)).published).toHaveLength(before);
  137 |   expect((await live(page)).links).toEqual(['164037', null]);
  138 | });
  139 | 
```
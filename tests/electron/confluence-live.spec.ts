import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { stopElectron } from './helpers/stop-electron';
import { foreignStorage, isolatedEntrySource, remotePageId, startConfluenceFixture, syntheticEmail, syntheticSite, syntheticToken } from './confluence-fixture';

/**
 * Native #210 acceptance for all diagram pages, real Git auto-pull, restart and window lifetime.
 * Every run owns its profile, session, private MCP runtime and local HTTP/Git endpoints.
 * No mocked renderer bridge/store/exporter/service. Only dialog results, synthetic key storage and main HTTP transport.
 */
// Runtime capabilities must never enter Playwright traces, screenshots, videos or attachments.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const execFileNative = promisify(execFileCallback);
const cleanEnvironment = (root: string): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !/^(ELECTRON_RUN_AS_NODE|ELECTRON_DISABLE_SANDBOX|NODE_OPTIONS|NODE_PATH|SKETCHDRAW_.*|GIT_.*)$/i.test(entry[0]))),
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty-gitconfig'), GIT_TERMINAL_PROMPT: '0',
  // The MCP runtime default is independent of userData; isolate it explicitly on every launch/restart.
  SKETCHDRAW_MCP_RUNTIME_FILE: path.resolve(root, 'agent-runtime', 'active-v1.json'),
});
type Probe = { published: Array<{ images: Array<{ pageId: string; pngSha256: string; uint8Array: boolean; bytes: number; decoded: { width: number; height: number } }>; done: boolean; status?: string; rejected?: boolean }>; afterSaves: { started: number; completed: number; rejected: number }; actions: string[]; blockedFetches: string[] };
const probe = (app: ElectronApplication) => app.evaluate(() => structuredClone((globalThis as unknown as { __nativeConfluenceProbe: Probe }).__nativeConfluenceProbe));
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const documentRectangles = (page: Page) => page.getByTestId('whiteboard-canvas').locator('[data-render-state="document"][data-kind="rectangle"][data-element-id^="rectangle:"]');

async function openPlugins(page: Page) {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugins', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins', exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}
async function openJira(page: Page) {
  const dialog = await openPlugins(page);
  await dialog.getByRole('complementary').getByRole('button', { name: /^Jira\b/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Jira-Konfiguration', exact: true })).toBeVisible(); return dialog;
}
// Bounded, allowlisted diagnostics from this synthetic app only; no inputs, capabilities or runtime files.
async function canvasDiagnostic(page: Page, points: Array<[number, number]> = []) {
  return page.evaluate((points) => {
    const identify = (element: Element | null) => element ? { tag: element.tagName, testId: element.getAttribute('data-testid'), role: element.getAttribute('role'), label: element.getAttribute('aria-label'), className: typeof element.className === 'string' ? element.className : null, onCanvas: Boolean(element.closest('[data-testid="whiteboard-canvas"]')) } : null;
    const box = (element: Element | null) => { if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; };
    return { viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio }, focused: document.hasFocus(), active: identify(document.activeElement), canvas: box(document.querySelector('[data-testid="whiteboard-canvas"]')), saveStatus: document.querySelector('[data-testid="save-status"]')?.getAttribute('data-status'), pageLabel: document.querySelector('[data-testid="page-switcher"]')?.getAttribute('aria-label'), openDialogs: [...document.querySelectorAll('dialog[open]')].map(identify), pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map(identify), silhouetteVisible: Boolean(document.querySelector('[data-testid="shape-silhouette"]')), draftCount: document.querySelectorAll('[data-render-state="draft"]').length, rectangles: [...document.querySelectorAll('[data-testid="whiteboard-canvas"] [data-render-state="document"][data-kind="rectangle"]')].map(element => ({ id: element.getAttribute('data-element-id'), box: box(element), width: element.querySelector('rect')?.getAttribute('width'), height: element.querySelector('rect')?.getAttribute('height') })), points: points.map(([x, y]) => ({ x, y, top: identify(document.elementFromPoint(x, y)) })) };
  }, points);
}
async function draw(page: Page, from: [number, number], to: [number, number]) {
  const canvas = page.getByTestId('whiteboard-canvas');
  const rectangles = documentRectangles(page);
  const before = await rectangles.evaluateAll(elements => elements.map(element => element.getAttribute('data-element-id')));
  const savedBefore = await page.getByTestId('save-status').getAttribute('data-status');
  // Observe only allowlisted pointer fields, never document text, inputs or private runtime capabilities.
  await page.evaluate(() => {
    const events: unknown[] = [];
    const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'];
    const observe = (raw: Event) => {
      if (events.length >= 32) return;
      const event = raw as PointerEvent; const target = event.target as Element | null;
      events.push({ type: event.type, x: event.clientX, y: event.clientY, button: event.button, buttons: event.buttons, pointerId: event.pointerId, trusted: event.isTrusted, onCanvas: Boolean(target?.closest('[data-testid="whiteboard-canvas"]')), draftCount: document.querySelectorAll('[data-render-state="draft"]').length });
    };
    for (const type of types) document.addEventListener(type, observe, true);
    (globalThis as unknown as { __nativeDrawingProbe: unknown }).__nativeDrawingProbe = { events, stop: () => { for (const type of types) document.removeEventListener(type, observe, true); } };
  });
  try {
    const tool = page.getByRole('button', { name: 'Rechteck', exact: true });
    await tool.click(); await expect(tool).toHaveAttribute('aria-pressed', 'true');
    // Settle focus before the native pointer sequence starts after a modal or restart.
    await canvas.focus(); await expect(canvas).toBeFocused();
    await page.mouse.move(...from); await page.mouse.down();
    try {
      await page.mouse.move(...to, { steps: 8 });
      // A hover silhouette is not a drag. Require the real gesture's draft while the button is still pressed.
      await expect(canvas.locator('[data-render-state="draft"][data-kind="rectangle"]')).toHaveCount(1);
    } finally { await page.mouse.up(); }
    await expect(rectangles).toHaveCount(before.length + 1);
    const created = (await rectangles.evaluateAll(elements => elements.map(element => element.getAttribute('data-element-id')))).filter(id => !before.includes(id));
    expect(created).toHaveLength(1); expect(created[0]).toMatch(/^rectangle:/);
    await expect(canvas.locator('[data-render-state="draft"]')).toHaveCount(0);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', savedBefore === 'unsaved-new' ? 'unsaved-new' : 'dirty');
  } finally {
    const pointer = await page.evaluate(() => { const state = (globalThis as unknown as { __nativeDrawingProbe: { events: unknown[]; stop(): void } }).__nativeDrawingProbe; state.stop(); return state.events; });
    await test.info().attach('native-drag-diagnostics', { body: JSON.stringify({ from, to, before, pointer, dom: await canvasDiagnostic(page, [from, to]) }), contentType: 'application/json' });
  }
}
async function selectDiagramPage(page: Page, name: string) {
  await page.getByTestId('page-switcher').click();
  const pages = page.getByRole('dialog', { name: 'Seiten', exact: true });
  await expect(pages).toBeVisible();
  await pages.getByRole('button', { name, exact: true }).click();
  await expect(pages.getByRole('button', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape'); await expect(pages).toHaveCount(0);
}
async function save(app: ElectronApplication, page: Page, documentPath: string) {
  const before = (await probe(app)).afterSaves;
  expect(before.completed).toBe(before.started);
  expect(before.rejected).toBe(0);
  await app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, documentPath);
  await app.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()?.getMenuItemById('file-save'); if (!item) throw new Error('Missing native Save menu'); item.click(); });
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await expect.poll(() => readFile(documentPath, 'utf8').then(() => true).catch(() => false)).toBe(true);
  // "Saved" precedes this fire-and-forget IPC. Its real handler also reads Git status, which can lock the index.
  // Wait for this exact save's completion before test-owned Git writes; neither skip the handler nor remove locks.
  await expect.poll(async () => (await probe(app)).afterSaves, { timeout: 25_000 }).toEqual({ started: before.started + 1, completed: before.completed + 1, rejected: 0 });
}
async function open(app: ElectronApplication, page: Page, documentPath: string) {
  await app.evaluate(({ dialog }, destination) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [destination] }); }, documentPath);
  await app.evaluate(({ Menu }) => { const item = Menu.getApplicationMenu()?.getMenuItemById('file-open'); if (!item) throw new Error('Missing native Open menu'); item.click(); });
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
}
/** Configures the Atlassian plugin and links each named diagram page to the Confluence page through its page menu (#240). */
async function configureAndLink(page: Page, pageNames: string[] = ['Seite 1']) {
  const dialog = await openJira(page);
  await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
  await dialog.getByLabel('Atlassian-URL', { exact: true }).fill(syntheticSite);
  await dialog.getByLabel('Username oder E-Mail', { exact: true }).fill(syntheticEmail);
  await dialog.getByLabel('API-Token', { exact: true }).fill(syntheticToken);
  await dialog.getByLabel('Jira-Projekt', { exact: true }).fill('NATIVE');
  await dialog.getByRole('button', { name: 'Jira speichern', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Verbindung testen', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen', exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const name of pageNames) {
    const panel = page.getByRole('dialog', { name: 'Seiten', exact: true });
    if (!await panel.isVisible()) await page.getByTestId('page-switcher').click();
    await panel.getByRole('button', { name: `Aktionen für ${name}`, exact: true }).click();
    await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Confluence-Seite verknüpfen…', exact: true }).click();
    const link = page.getByTestId('confluence-page-link-dialog');
    await expect(link.getByRole('heading', { name: `Confluence-Seite für „${name}“` })).toBeVisible();
    await link.getByTestId('confluence-page-link-search').fill('Native Architektur');
    await link.getByRole('button', { name: 'Suchen', exact: true }).click();
    await link.getByRole('button', { name: `„${name}“ mit „Native Architektur“ verknüpfen`, exact: true }).click();
    await expect(link.getByTestId('confluence-link-target')).toHaveText('Native Architektur');
    await expect(link.getByTestId('confluence-link-status')).toContainText(/aktualisiert|aktuellen Stand/, { timeout: 25_000 });
    await link.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
    await expect(link).toBeHidden();
  }
}
async function installBuiltFixture(root: string, origin: string) {
  // Builds must be fresh before running this file; the test never starts the developer/user application.
  for (const dir of ['dist', 'dist-electron', 'dist-mcp']) await cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'sketchdraw-native-confluence-test', version: '0.0.0', main: 'entry.cjs' }));
  await writeFile(path.join(root, 'entry.cjs'), isolatedEntrySource(origin));
  await writeFile(path.join(root, 'empty-gitconfig'), '');
}
async function launch(root: string) {
  const app = await electron.launch({ args: [root], env: cleanEnvironment(root), chromiumSandbox: true });
  const page = await app.firstWindow(); await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  expect(page.url()).toBe('app://sketchdraw/index.html'); return { app, page };
}

// The real one-minute Git timer is retained: no service timers or clocks are accelerated.
test('native edits and automatic Git pull update the correct one of two linked diagram pages, and the links survive restart (#210, #240)', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-native-confluence-')));
  // V2 omits comments: the real backend must obtain the same version's digest via the V1 fallback.
  const remote = await startConfluenceFixture({ v2Comments: false }); let app: ElectronApplication | undefined;
  const execFile = (file: string, args: string[], options: { cwd?: string } = {}) => execFileNative(file, args, { ...options, env: cleanEnvironment(root) });
  const errors: string[] = [];
  const diagnostics: unknown[] = [];
  try {
    await installBuiltFixture(root, remote.origin);
    const project = path.join(root, 'project'); const bare = path.join(root, 'remote.git'); const updater = path.join(root, 'updater');
    await mkdir(project); const documentPath = path.join(project, 'architecture.sketchdraw.json');
    let launched = await launch(root); app = launched.app; let page = launched.page;
    page.on('pageerror', error => errors.push(error.message));
    await draw(page, [350, 220], [550, 360]);
    await expect(documentRectangles(page)).toHaveCount(1);
    // Create the second diagram page through the same page switcher used by people.
    await page.getByTestId('page-switcher').click();
    await page.getByTestId('page-add').click();
    await expect(page.getByRole('list', { name: 'Seitenliste' }).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Seite 2', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(documentRectangles(page)).toHaveCount(0);
    await draw(page, [350, 220], [490, 320]);
    await expect(documentRectangles(page)).toHaveCount(1);
    await selectDiagramPage(page, 'Seite 1');
    await expect(documentRectangles(page)).toHaveCount(1);
    await save(app, page, documentPath);
    const initialDocument = JSON.parse(await readFile(documentPath, 'utf8')) as { id: string; pages: Array<{ id: string; name: string }>; elements: Array<{ id: string; pageId: string; kind: string; width: number }> };
    expect(initialDocument.pages.map(entry => entry.name)).toEqual(['Seite 1', 'Seite 2']);
    const firstPageId = initialDocument.pages[0]!.id;
    const secondPageId = initialDocument.pages[1]!.id;
    expect(initialDocument.elements.filter(element => element.pageId === firstPageId)).toHaveLength(1);
    expect(initialDocument.elements.filter(element => element.pageId === secondPageId)).toHaveLength(1);

    await execFile('git', ['init', '--bare', bare]);
    await execFile('git', ['init', '-b', 'main'], { cwd: project });
    for (const [key, value] of [['user.email', 'native@example.invalid'], ['user.name', 'Native Test']] as const) await execFile('git', ['config', key, value], { cwd: project });
    await execFile('git', ['add', path.basename(documentPath)], { cwd: project });
    await execFile('git', ['commit', '-m', 'Initial native fixture'], { cwd: project });
    await execFile('git', ['remote', 'add', 'origin', bare], { cwd: project });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: project });
    await execFile('git', ['clone', '--branch', 'main', bare, updater]);
    for (const [key, value] of [['user.email', 'remote@example.invalid'], ['user.name', 'Remote Test']] as const) await execFile('git', ['config', key, value], { cwd: updater });
    let dialog = await openPlugins(page);
    await dialog.getByRole('button', { name: /Git Versionierung/ }).click();
    await dialog.getByRole('checkbox', { name: 'Aktiv', exact: true }).check();
    await dialog.getByLabel('Remote', { exact: true }).fill('origin');
    await dialog.getByRole('checkbox', { name: /Automatisch committen/ }).uncheck();
    // Keep the independent pull timer off while the fixture prepares external commits in this working tree.
    await dialog.getByRole('checkbox', { name: /Automatisch abrufen/ }).uncheck();
    await dialog.getByRole('checkbox', { name: /Automatisch pushen/ }).uncheck();
    await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
    // Starts the existing file watcher through the normal UI; the pull timer is enabled after preparation.
    await dialog.getByRole('button', { name: 'Status prüfen', exact: true }).click();
    await expect(dialog).toContainText('Repository ist synchron.');
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen', exact: true }).click();
    // Both diagram pages go to the same Confluence page, each through a link of its own (#240).
    await configureAndLink(page, ['Seite 1', 'Seite 2']);
    expect(remote.failures).toEqual([]); expect(remote.uploads).toHaveLength(2);
    // Map page IDs to attachment IDs by the actual PNG bytes observed at IPC, not by duplicating filename code.
    const initialPublications = (await probe(app)).published.filter(entry => entry.done && entry.status === 'synced');
    // One publication per linked page, each with exactly the image of its page.
    for (const entry of initialPublications) expect(entry.images).toHaveLength(1);
    const initialImages = initialPublications.flatMap(entry => entry.images);
    expect([...new Set(initialImages.map(image => image.pageId))].sort()).toEqual([firstPageId, secondPageId].sort());
    const firstImage = initialImages.find(image => image.pageId === firstPageId)!;
    const secondImage = initialImages.find(image => image.pageId === secondPageId)!;
    const first = remote.uploads.find(upload => upload.sha256 === firstImage.pngSha256);
    const second = remote.uploads.find(upload => upload.sha256 === secondImage.pngSha256);
    if (!first || !second) throw new Error('Initial page PNGs were not both uploaded');
    expect(first.id).toMatch(/^att\d+$/); expect(second.id).toMatch(/^att\d+$/);
    expect(first.id).not.toBe(second.id); expect(first.name).not.toBe(second.name);
    for (const initial of [first, second]) { expect(initial.bytes).toBeGreaterThan(1000); expect(initial.width).toBeGreaterThan(0); expect(initial.height).toBeGreaterThan(0); }
    const references = () => [...remote.body.matchAll(/<ri:attachment\b[^>]*\bri:filename="([^"]+)"/g)].map(match => match[1]);
    expect(references().sort()).toEqual([first.name, second.name].sort());
    // Each link inserted its own image once; the first image stayed when the second was added.
    expect(remote.body.startsWith(foreignStorage)).toBe(true); expect(remote.bodyWrites).toHaveLength(2);

    // Change only page 1. Page 2 stays byte-identical and must not acquire another attachment version.
    await draw(page, [650, 240], [790, 340]);
    await expect(documentRectangles(page)).toHaveCount(2);
    await expect.poll(() => remote.uploads.length, { timeout: 25_000 }).toBe(3);
    await expect.poll(async () => (await probe(app!)).published.every(entry => entry.done), { timeout: 25_000 }).toBe(true);
    expect((await probe(app)).published.at(-1)).toMatchObject({ done: true, status: 'synced' });
    expect(remote.uploads).toHaveLength(3);
    const local = remote.uploads[2]!;
    expect(local.id).toBe(first.id); expect(local.sha256).not.toBe(first.sha256);
    expect(local).toMatchObject({ method: 'POST', path: `/wiki/rest/api/content/${remotePageId}/child/attachment/${first.id}/data` });
    expect(remote.uploads.filter(upload => upload.id === second.id)).toHaveLength(1);
    expect(hash(remote.png(second.id))).toBe(second.sha256);
    expect(references().sort()).toEqual([first.name, second.name].sort());
    expect(remote.bodyWrites).toHaveLength(2); // Ordinary diagram edits only change attachment data.
    // Save only after upload: automatic publication did not depend on a save/send button.
    await save(app, page, documentPath);
    await execFile('git', ['add', path.basename(documentPath)], { cwd: project });
    await execFile('git', ['commit', '-m', 'Local UI fixture edit'], { cwd: project });
    await execFile('git', ['push', 'origin', 'main'], { cwd: project });
    const localHead = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: project })).stdout.trim();
    await execFile('git', ['pull', '--ff-only', 'origin', 'main'], { cwd: updater });

    // A real remote commit changes only page 2 while page 1 remains active in the renderer.
    const updatedPath = path.join(updater, path.basename(documentPath));
    const updated = JSON.parse(await readFile(updatedPath, 'utf8')) as typeof initialDocument;
    const rectangle = updated.elements.find(element => element.kind === 'rectangle' && element.pageId === secondPageId);
    if (!rectangle) throw new Error('Saved fixture has no rectangle on the second page');
    rectangle.width += 300; const expectedWidth = String(rectangle.width); const elementId = rectangle.id;
    await writeFile(updatedPath, `${JSON.stringify(updated, null, 2)}\n`);
    await execFile('git', ['add', path.basename(documentPath)], { cwd: updater });
    await execFile('git', ['commit', '-m', 'Remote diagram geometry edit'], { cwd: updater });
    await execFile('git', ['push', 'origin', 'main'], { cwd: updater });
    const remoteHead = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: updater })).stdout.trim();
    // Only now enable the real timer: no external fixture writes can race its service-internal Git commands.
    dialog = await openPlugins(page);
    await dialog.getByRole('button', { name: /Git Versionierung/ }).click();
    await dialog.getByRole('checkbox', { name: /Automatisch abrufen/ }).check();
    await dialog.getByRole('button', { name: 'Git speichern', exact: true }).click();
    await dialog.getByRole('button', { name: 'Status prüfen', exact: true }).click();
    await expect(dialog).toContainText('Repository liegt hinter dem Remote.');
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen', exact: true }).click();
    expect((await execFile('git', ['rev-parse', 'HEAD'], { cwd: project })).stdout.trim()).toBe(localHead);
    // No manual Git sync or Confluence sync here: wait for the product's actual periodic pull.
    await expect.poll(async () => (await execFile('git', ['rev-parse', 'HEAD'], { cwd: project })).stdout.trim(), { timeout: 95_000, intervals: [500, 1000, 2000] }).toBe(remoteHead);
    // Publication must update the inactive second page without first navigating to it.
    await expect(page.getByTestId('page-switcher')).toHaveAccessibleName('Seiten (2), aktuelle Seite: Seite 1');
    await expect.poll(() => remote.uploads.length, { timeout: 25_000 }).toBe(4);
    await expect.poll(async () => (await probe(app!)).published.every(entry => entry.done), { timeout: 25_000 }).toBe(true);
    expect((await probe(app)).published.at(-1)).toMatchObject({ done: true, status: 'synced' });
    expect(remote.uploads).toHaveLength(4);
    const pulled = remote.uploads[3]!;
    expect(pulled.id).toBe(second.id); expect(pulled.sha256).not.toBe(second.sha256);
    expect(pulled).toMatchObject({ method: 'POST', path: `/wiki/rest/api/content/${remotePageId}/child/attachment/${second.id}/data` });
    expect(remote.uploads.filter(upload => upload.id === first.id)).toHaveLength(2);
    expect(hash(remote.png(first.id))).toBe(local.sha256);
    expect(remote.uploads.filter(upload => upload.id === second.id)).toHaveLength(2);
    await selectDiagramPage(page, 'Seite 2');
    await expect(page.locator(`[data-element-id="${elementId}"] > g > rect`)).toHaveAttribute('width', expectedWidth, { timeout: 15_000 });
    await selectDiagramPage(page, 'Seite 1');
    expect(references().sort()).toEqual([first.name, second.name].sort());
    expect(remote.bodyWrites).toHaveLength(2); expect(remote.body.startsWith(foreignStorage)).toBe(true);
    expect(remote.requests.some(request => request.method === 'GET' && request.path === `/wiki/rest/api/content/${remotePageId}/child/attachment`)).toBe(true);
    const beforeRestart = await probe(app);
    expect(beforeRestart.blockedFetches).toEqual([]);
    expect(beforeRestart.actions).not.toContain('update-confluence-page');
    expect(beforeRestart.published.flatMap(entry => entry.images)).toEqual(expect.arrayContaining([expect.objectContaining({ uint8Array: true })]));
    for (const entry of beforeRestart.published) {
      expect(entry.images).toHaveLength(1);
      expect([firstPageId, secondPageId]).toContain(entry.images[0]!.pageId);
      for (const image of entry.images) {
        expect(image.uint8Array).toBe(true); expect(image.decoded.width).toBeGreaterThan(0); expect(image.decoded.height).toBeGreaterThan(0);
      }
    }
    const storePath = path.join(root, 'profile', 'plugins.json');
    const profile = JSON.parse(await readFile(storePath, 'utf8')) as { profiles: Array<{ atlassian: { confluenceLinks?: unknown[]; confluencePageLinks?: Array<{ pageId: string; documentId: string; documentPath: string; diagramPageId: string }> } }> };
    expect(profile.profiles.flatMap(entry => entry.atlassian.confluenceLinks ?? [])).toEqual([]);
    const storedLinks = profile.profiles.flatMap(entry => entry.atlassian.confluencePageLinks ?? []);
    expect(storedLinks).toHaveLength(2);
    for (const diagramPageId of [firstPageId, secondPageId]) expect(storedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ pageId: remotePageId, documentId: updated.id, documentPath, diagramPageId })]));
    expect(await readFile(documentPath, 'utf8')).not.toContain(syntheticToken);
    expect(await readFile(documentPath, 'utf8')).not.toContain(syntheticSite);

    await stopElectron(app); app = undefined;
    launched = await launch(root); app = launched.app; page = launched.page; page.on('pageerror', error => errors.push(error.message));
    await open(app, page, documentPath);
    await selectDiagramPage(page, 'Seite 2');
    await expect(documentRectangles(page)).toHaveCount(1);
    await expect(page.locator(`[data-element-id="${elementId}"] > g > rect`)).toHaveAttribute('width', expectedWidth);
    await selectDiagramPage(page, 'Seite 1');
    await expect(documentRectangles(page)).toHaveCount(2);
    // Both links are back after the restart, and each finds Confluence up to date. The plugin settings no longer
    // list them (#252); every page shows its link in its own dialog.
    for (const name of ['Seite 1', 'Seite 2']) {
      const panel = page.getByRole('dialog', { name: 'Seiten', exact: true });
      if (!await panel.isVisible()) await page.getByTestId('page-switcher').click();
      await panel.getByRole('button', { name: `Aktionen für ${name}`, exact: true }).click();
      await page.getByTestId('page-menu').getByRole('menuitem', { name: 'Confluence-Verknüpfung…', exact: true }).click();
      const link = page.getByTestId('confluence-page-link-dialog');
      await expect(link.getByTestId('confluence-link-target')).toHaveText('Native Architektur');
      await expect(link.getByTestId('confluence-link-status')).toContainText(/aktualisiert|aktuellen Stand/, { timeout: 25_000 });
      await link.getByRole('button', { name: 'Dialog schließen', exact: true }).click();
      await expect(link).toBeHidden();
    }
    if (await page.getByRole('dialog', { name: 'Seiten', exact: true }).isVisible()) await page.keyboard.press('Escape');
    dialog = await openJira(page);
    await expect(dialog.getByRole('heading', { name: 'Seiten live in Confluence' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Confluence Live Docs' })).toHaveCount(0);
    expect(remote.uploads).toHaveLength(4); // Same content after restart does not create another version.
    await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen', exact: true }).click();
    await expect(dialog).toBeHidden();
    diagnostics.push({ stage: 'before-restart-draw', dom: await canvasDiagnostic(page, [[360, 440], [490, 530]]), ipc: await probe(app), uploads: [...remote.uploads] });
    await draw(page, [360, 440], [490, 530]);
    diagnostics.push({ stage: 'after-restart-draw', dom: await canvasDiagnostic(page, [[360, 440], [490, 530]]), ipc: await probe(app), uploads: [...remote.uploads] });
    await expect(documentRectangles(page)).toHaveCount(3);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'dirty');
    await expect.poll(() => remote.uploads.length, { timeout: 25_000 }).toBe(5);
    await expect.poll(async () => (await probe(app!)).published.every(entry => entry.done), { timeout: 25_000 }).toBe(true);
    expect((await probe(app)).published.at(-1)).toMatchObject({ done: true, status: 'synced' });
    expect(remote.uploads).toHaveLength(5);
    expect(remote.uploads[4]).toMatchObject({ id: first.id, method: 'POST', path: `/wiki/rest/api/content/${remotePageId}/child/attachment/${first.id}/data` });
    expect(remote.uploads[4]!.sha256).not.toBe(local.sha256);
    expect(remote.uploads.filter(upload => upload.id === second.id)).toHaveLength(2);
    expect(hash(remote.png(second.id))).toBe(pulled.sha256);
    expect(references().sort()).toEqual([first.name, second.name].sort());
    expect(remote.bodyWrites).toHaveLength(2); expect(remote.failures).toEqual([]); expect(errors).toEqual([]);
    const afterRestart = await probe(app);
    expect(afterRestart.actions).not.toContain('set-confluence-live-link');
    expect(afterRestart.actions).not.toContain('convert-confluence-live-link');
    expect(afterRestart.actions).not.toContain('update-confluence-page');
    expect(afterRestart.blockedFetches).toEqual([]);
    await testInfo.attach('native-confluence-evidence', { body: JSON.stringify({ platform: process.platform, mainBundleSha256: hash(await readFile(path.join(root, 'dist-electron/main.cjs'))), pageMapping: [{ pageId: firstPageId, attachmentId: first.id, filename: first.name }, { pageId: secondPageId, attachmentId: second.id, filename: second.name }], uploads: remote.uploads, bodyWrites: remote.bodyWrites.length, foreignBodyPreserved: remote.body.startsWith(foreignStorage), realIpc: beforeRestart, restoredIpc: afterRestart, realGitPullHead: remoteHead, liveTenantContacted: false, openedConfluenceBrowserRefreshVerified: false }, null, 2), contentType: 'application/json' });
    await testInfo.attach('native-final-page-one.png', { body: remote.png(first.id), contentType: 'image/png' });
    await testInfo.attach('native-final-page-two.png', { body: remote.png(second.id), contentType: 'image/png' });
  } finally {
    diagnostics.push({ stage: 'cleanup', ipc: app ? await probe(app).catch(() => null) : null, uploads: remote.uploads, requests: remote.requests, fixtureFailures: remote.failures, pageErrorCount: errors.length });
    await testInfo.attach('native-restart-edit-diagnostics', { body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json' });
    try { if (app) await stopElectron(app); } finally { await remote.close(); }
    // Keep the isolated profile for diagnosis if process shutdown could not be confirmed.
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});

// Optional but concrete lifecycle regression. macOS keeps the real app alive after its last window closes.
test('closing the native diagram window cancels a delayed publication before another mutation (#210)', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS window lifetime differs from application lifetime.');
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-native-confluence-close-')));
  const remote = await startConfluenceFixture(); let app: ElectronApplication | undefined;
  try {
    await installBuiltFixture(root, remote.origin);
    const documentPath = path.join(root, 'architecture.sketchdraw.json');
    const launched = await launch(root); app = launched.app; const page = launched.page;
    await draw(page, [350, 220], [550, 360]); await save(app, page, documentPath); await configureAndLink(page);
    const gate = remote.holdNextAttachmentRead();
    await draw(page, [650, 240], [790, 340]);
    await expect.poll(async () => (await probe(app!)).published.some(entry => !entry.done), { timeout: 20_000 }).toBe(true);
    await Promise.race([gate.entered, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Held attachment read was not reached')), 20_000))]);
    const writesBefore = remote.requests.filter(request => request.method !== 'GET').length;
    const closing = page.waitForEvent('close');
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.close(); });
    await page.getByRole('button', { name: 'Verwerfen', exact: true }).click({ noWaitAfter: true }).catch(error => { if (!page.isClosed()) throw error; });
    await closing; gate.release();
    await expect.poll(async () => (await probe(app!)).published.every(entry => entry.done), { timeout: 20_000 }).toBe(true);
    expect(remote.requests.filter(request => request.method !== 'GET')).toHaveLength(writesBefore);
    const result = await probe(app);
    expect(result.published.at(-1)).toMatchObject({ done: true, status: 'cancelled' });
    expect(remote.failures).toEqual([]);
    await testInfo.attach('native-window-cancellation', { body: JSON.stringify({ platform: process.platform, writesBefore, writesAfter: remote.requests.filter(request => request.method !== 'GET').length, result }), contentType: 'application/json' });
  } finally {
    try { if (app) await stopElectron(app); } finally { await remote.close(); }
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
});

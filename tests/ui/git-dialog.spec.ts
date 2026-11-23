import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { GitChange, GitCommitSummary, GitPluginSettings, GitWorkbenchResult } from '../../src/domain';

type GitTestState = {
  changes: GitChange[];
  git: GitPluginSettings;
  /** The next changing call answers with this failure. */
  failNext: string;
  calls: Array<{ action: string; input?: unknown }>;
};
type TestWindow = Window & { __git: GitTestState };

/** A desktop with a Git repository in memory: the plugin is on, and the diagram gets its folder with the first save. */
async function desktop(page: Page, options: { enabled?: boolean; theme?: 'light' | 'dark' } = {}): Promise<void> {
  await page.addInitScript(({ enabled, theme }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language: 'de', canvasBackground: null }));
    const control: GitTestState = {
      changes: [
        { path: 'diagrams/architecture.sketchdraw', status: 'modified', document: true },
        { path: 'diagrams/login.sketchdraw', status: 'modified', document: false },
        { path: 'docs/notes.md', status: 'untracked', document: false },
      ],
      git: { installed: true, enabled, folderPath: '', autoCommit: false, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'ready', message: 'Lokale Änderungen erkannt.', repositoryName: 'shop-architecture', branch: 'main', changedFiles: 3, ahead: 1, behind: 2 },
      failNext: '',
      calls: [],
    };
    Object.defineProperty(window, '__git', { value: control });
    let folder = '';
    const commits: GitCommitSummary[] = [
      { hash: 'a'.repeat(40), shortHash: 'a41c9e2', subject: 'Zahlungsdienst anbinden', author: 'Mira Okafor', date: '2026-11-15T16:42:00+01:00', pushed: false },
      { hash: 'b'.repeat(40), shortHash: 'b7730d1', subject: 'Readme ergänzt', author: 'Jonas Reuter', date: '2026-11-14T10:05:00+01:00', pushed: true },
      { hash: 'c'.repeat(40), shortHash: 'c05e8aa', subject: 'Erstes Diagramm', author: 'Mira Okafor', date: '2026-11-10T09:12:00+01:00', pushed: true },
    ];
    const workbench = () => ({ settings: { ...control.git, folderPath: folder, changedFiles: control.changes.length }, changes: structuredClone(control.changes), documentPath: 'diagrams/architecture.sketchdraw' });
    const step = (action: string, input: unknown, message: string, apply: () => void): GitWorkbenchResult => {
      control.calls.push({ action, input: structuredClone(input) });
      if (control.failNext) { const failure = control.failNext; control.failNext = ''; return { ok: false, message: failure, workbench: workbench() }; }
      apply();
      return { ok: true, message, workbench: workbench() };
    };
    const without = (paths: string[]): void => { control.changes = control.changes.filter((change) => !paths.includes(change.path)); };
    const settings = () => ({ available: true, projectFolder: folder, profiles: [{ id: 'default', name: 'Standard' }], activeProfileId: 'default', git: { ...control.git, folderPath: folder, changedFiles: control.changes.length }, atlassian: { installed: false, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: '' } });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'cancelled' }),
      saveDocument: async () => { folder = '/Users/demo/shop'; return { status: 'saved', file: { handleId: 'architecture-file', name: 'architecture.sketchdraw', versionToken: `version-${Date.now()}` } }; },
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      plugins: {
        getSettings: async (handleId?: string | null) => { if (handleId === null) folder = ''; else if (handleId !== undefined) folder = '/Users/demo/shop'; return settings(); },
        afterDocumentSaved: async () => {}, watchDocument: async () => ({ ok: true, message: '' }), onEvent: () => () => {},
        gitWorkbench: async (handleId: string) => { control.calls.push({ action: 'workbench', input: handleId }); return workbench(); },
        gitDiff: async (input: { path: string; commit?: string }) => {
          control.calls.push({ action: 'diff', input: structuredClone(input) });
          if (input.commit === 'b'.repeat(40)) return { path: input.path, binary: false, truncated: false, lines: [] };
          return { path: input.path, binary: false, truncated: false, lines: [
            { kind: 'hunk', text: '@@ -3,2 +3,2 @@' },
            { kind: 'removed', text: `old line of ${input.path}`, oldLine: 3 },
            { kind: 'added', text: `new line of ${input.path}${input.commit ? ` in ${input.commit.slice(0, 7)}` : ''}`, newLine: 3 },
            { kind: 'context', text: 'arrow shop -> pay', oldLine: 4, newLine: 4 },
          ] };
        },
        gitCommit: async (input: { message: string; paths: string[]; push: boolean }) => step('commit', input, input.push ? 'Commit erstellt und gepusht.' : 'Commit erstellt.', () => { without(input.paths); control.git.ahead = input.push ? 0 : (control.git.ahead ?? 0) + 1; }),
        gitPush: async () => step('push', undefined, 'Commits wurden gepusht.', () => { control.git.ahead = 0; }),
        gitUpdate: async () => step('update', undefined, 'Neue Commits vom Remote übernommen.', () => { control.git.behind = 0; }),
        gitLog: async (input: { documentOnly: boolean }) => { control.calls.push({ action: 'log', input: structuredClone(input) }); return input.documentOnly ? [commits[0], commits[2]] : commits; },
        gitDiscard: async (input: { paths: string[] }) => step('discard', input, 'Änderungen verworfen.', () => without(input.paths)),
        gitRestoreDocument: async (input: { commit: string }) => step('restore', input, 'Das Diagramm hat den Stand des gewählten Commits. Mit einem Commit hältst du das fest.', () => { if (!control.changes.some((change) => change.document)) control.changes.unshift({ path: 'diagrams/architecture.sketchdraw', status: 'modified', document: true }); }),
        gitBranches: async (input: { fetch: boolean }) => { control.calls.push({ action: 'branches', input: structuredClone(input) }); return { current: control.git.branch, local: ['feature/login', 'main'], remote: input.fetch ? ['feature/shipping', 'main'] : ['main'], remoteName: 'origin' }; },
        gitCheckout: async (input: { branch: string; remote: boolean }) => step('checkout', input, `Branch „${input.branch}“ ausgecheckt.`, () => { control.git.branch = input.branch; }),
        gitCreateBranch: async (input: { name: string }) => step('create-branch', input, `Branch „${input.name}“ erstellt und ausgecheckt.`, () => { control.git.branch = input.name; }),
        gitMerge: async (input: { branch: string; remote: boolean }) => step('merge', input, 'Der Branch wurde zusammengeführt.', () => { control.git.ahead = (control.git.ahead ?? 0) + 1; }),
        gitAutomation: async (input: { autoCommit: boolean; autoPush: boolean; autoPull: boolean }) => { control.calls.push({ action: 'automation', input: structuredClone(input) }); Object.assign(control.git, input); return { ...control.git, folderPath: folder }; },
      },
    } });
  }, { enabled: options.enabled ?? true, theme: options.theme ?? 'light' });
}

const calls = (page: Page, action: string): Promise<unknown[]> => page.evaluate((name) => (window as unknown as TestWindow).__git.calls.filter((call) => call.action === name).map((call) => call.input), action);

/** Opens the app, saves the diagram into the repository folder and opens the Git dialog. */
async function openGit(page: Page): Promise<Locator> {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  await page.getByTestId('git-button').click();
  const dialog = page.getByRole('dialog', { name: 'Git', exact: true });
  await expect(dialog.getByTestId('git-blank')).toContainText('Dieses Diagramm liegt noch in keinem Ordner.');
  await dialog.getByRole('button', { name: 'Diagramm speichern' }).click();
  await expect(dialog.getByTestId('git-changes').getByRole('listitem')).toHaveCount(3);
  return dialog;
}

test.beforeEach(({ page }) => { page.on('pageerror', (error) => { throw error; }); });

test('the Git button only exists with an enabled Git plugin (#216)', async ({ page }) => {
  await desktop(page, { enabled: false });
  await page.goto('/');
  await expect(page.getByTestId('help-button')).toBeVisible();
  await expect(page.getByTestId('git-button')).toHaveCount(0);
});

test('the Git button sits beside help at the size of the bar and opens the dialog on the repository (#216)', async ({ page }) => {
  await desktop(page);
  await page.goto('/');
  const button = page.getByTestId('git-button'); const help = page.getByTestId('help-button');
  await expect(button).toHaveAccessibleName('Git');
  const [gitBox, helpBox] = [await button.boundingBox(), await help.boundingBox()];
  expect(gitBox!.width).toBe(helpBox!.width); expect(gitBox!.height).toBe(helpBox!.height); expect(gitBox!.y).toBe(helpBox!.y);
  expect(gitBox!.x).toBeGreaterThan(helpBox!.x); expect(gitBox!.x - (helpBox!.x + helpBox!.width)).toBeLessThan(12);

  const dialog = await openGit(page);
  await expect(dialog.getByTestId('git-repository')).toContainText('shop-architecture');
  await expect(dialog.getByTestId('git-repository')).toContainText('main');
  await expect(dialog.getByText('1 Commit noch nicht gepusht')).toBeAttached();
  await expect(dialog.getByText('2 neue Commits auf dem Remote')).toBeAttached();
  // The open diagram comes first, is ticked, and its changes are shown.
  const rows = dialog.getByTestId('git-changes').getByRole('listitem');
  await expect(rows.first()).toContainText('architecture.sketchdraw'); await expect(rows.first()).toContainText('Dieses Diagramm');
  await expect(rows.first().getByRole('checkbox')).toBeChecked(); await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(dialog.getByText('1 von 3 Dateien ausgewählt')).toBeVisible();
  await expect(dialog.getByTestId('diff-view').first()).toContainText('new line of diagrams/architecture.sketchdraw');
  await expect(dialog.getByTestId('diff-view').first()).toContainText('arrow shop -> pay');
  expect((await new AxeBuilder({ page }).include('[data-testid="git-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  // Another file shows its own changes; the button now tells of the changes; Escape gives the focus back.
  await rows.nth(1).getByRole('button').click();
  await expect(dialog.getByTestId('diff-view').first()).toContainText('new line of diagrams/login.sketchdraw');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  // The button names what waits for Git: the changed files and the commit that is not pushed yet; the dot marks it.
  await expect(button).toHaveAccessibleName('Git, 3 geänderte Dateien, 1 Commit noch nicht gepusht');
  await expect(page.getByTestId('git-dot')).toBeVisible();
});

test('the branch opens a menu to switch, create and merge branches and to fetch those of the remote', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  const branch = dialog.getByTestId('git-branch');
  await expect(branch).toHaveText('main');
  await branch.click();
  const menu = dialog.getByTestId('git-branches');
  await expect(menu.getByRole('searchbox', { name: 'Branches suchen' })).toBeFocused();
  await expect(menu.getByTestId('git-branches-local').getByRole('listitem')).toHaveCount(2);
  await expect(menu.locator('.branch-row[aria-current="true"]')).toContainText('main'); await expect(menu.locator('.branch-row[aria-current="true"]')).toBeDisabled();
  expect((await new AxeBuilder({ page }).include('[data-testid="git-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  // The remote is asked for its branches; the search narrows both lists.
  await expect(menu.getByTestId('git-branches-remote').getByRole('listitem')).toHaveCount(1);
  await menu.getByTestId('git-branches-fetch').click();
  await expect(menu.getByTestId('git-branches-remote').getByRole('listitem')).toHaveCount(2);
  await menu.getByRole('searchbox', { name: 'Branches suchen' }).fill('shipping');
  await expect(menu.getByTestId('git-branches-local').getByRole('listitem')).toHaveCount(0);
  await expect(menu.getByTestId('git-branches-remote').getByRole('listitem')).toHaveCount(1);
  // Escape closes the menu, not the dialog, and the focus returns to the branch.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0); await expect(dialog).toBeVisible(); await expect(branch).toBeFocused();

  // A branch of the remote is checked out; a merge asks first; a new branch is created by its name.
  await branch.click(); await menu.getByTestId('git-branches-fetch').click();
  await menu.getByRole('button', { name: 'origin/feature/shipping', exact: true }).click();
  await expect(dialog.getByTestId('git-status')).toContainText('Branch „feature/shipping“ ausgecheckt.');
  await expect(branch).toHaveText('feature/shipping');
  expect(await calls(page, 'checkout')).toEqual([{ handleId: 'architecture-file', branch: 'feature/shipping', remote: true }]);
  await branch.click();
  await menu.getByRole('button', { name: '„main“ in „feature/shipping“ zusammenführen' }).click();
  await expect(dialog.getByTestId('git-confirm')).toContainText('„main“ in „feature/shipping“ zusammenführen?');
  expect(await calls(page, 'merge')).toEqual([]);
  await dialog.getByTestId('git-confirm-merge').click();
  await expect(dialog.getByTestId('git-status')).toContainText('Der Branch wurde zusammengeführt.');
  expect(await calls(page, 'merge')).toEqual([{ handleId: 'architecture-file', branch: 'main', remote: false }]);
  await branch.click();
  await expect(menu.getByTestId('git-branch-create')).toBeDisabled();
  await menu.getByRole('textbox', { name: 'Name für einen neuen Branch' }).fill('feature/checkout');
  await menu.getByTestId('git-branch-create').click();
  await expect(dialog.getByTestId('git-status')).toContainText('Branch „feature/checkout“ erstellt und ausgecheckt.');
  expect(await calls(page, 'create-branch')).toEqual([{ handleId: 'architecture-file', name: 'feature/checkout' }]);
});

test('commits exactly the ticked files, alone or with a push (#216)', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  const commit = dialog.getByTestId('git-commit'); const commitPush = dialog.getByTestId('git-commit-push');
  await expect(commit).toBeDisabled();
  await dialog.getByLabel('Commit-Nachricht').fill('Zahlungsdienst umbenannt');
  await expect(commit).toBeEnabled();
  await dialog.getByRole('checkbox', { name: 'docs/notes.md für den Commit auswählen' }).check();
  await commit.click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Commit erstellt.');
  expect(await calls(page, 'commit')).toEqual([{ handleId: 'architecture-file', message: 'Zahlungsdienst umbenannt', paths: ['diagrams/architecture.sketchdraw', 'docs/notes.md'], push: false }]);
  await expect(dialog.getByTestId('git-changes').getByRole('listitem')).toHaveCount(1);
  await expect(dialog.getByLabel('Commit-Nachricht')).toHaveValue('');
  await expect(dialog.getByText('2 Commits noch nicht gepusht')).toBeAttached();

  // Nothing is ticked after the commit, so there is nothing to commit until a file is chosen.
  await dialog.getByLabel('Commit-Nachricht').fill('Login angepasst');
  await expect(commitPush).toBeDisabled();
  await dialog.getByRole('checkbox', { name: /Dateien ausgewählt/ }).check();
  await page.evaluate(() => { (window as unknown as TestWindow).__git.failNext = 'Commit erstellt, aber nicht gepusht. Der Remote hat neuere Commits. Bitte zuerst aktualisieren.'; });
  await commitPush.click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Commit erstellt, aber nicht gepusht. Der Remote hat neuere Commits. Bitte zuerst aktualisieren.');
  await expect(dialog.getByTestId('git-status')).toHaveClass(/is-error/);
  // A failure keeps what was typed.
  await expect(dialog.getByLabel('Commit-Nachricht')).toHaveValue('Login angepasst');
  await commitPush.click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Commit erstellt und gepusht.');
  await expect(dialog.getByTestId('git-clean')).toHaveText('Keine Änderungen. Alles ist committet.');
  expect((await calls(page, 'commit')).at(-1)).toEqual({ handleId: 'architecture-file', message: 'Login angepasst', paths: ['diagrams/login.sketchdraw'], push: true });
});

test('pushes, updates and discards, and asks before changes are thrown away (#216)', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  await dialog.getByTestId('git-update').click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Neue Commits vom Remote übernommen.');
  await expect(dialog.getByText('0 neue Commits auf dem Remote')).toBeAttached();
  await dialog.getByTestId('git-push').click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Commits wurden gepusht.');
  // With nothing ahead there is nothing to push.
  await expect(dialog.getByTestId('git-push')).toBeDisabled();
  await page.evaluate(() => { (window as unknown as TestWindow).__git.failNext = 'Lokale und entfernte Commits sind auseinandergelaufen. Sketchdraw führt sie nicht zusammen; bitte in einem Git-Werkzeug zusammenführen.'; });
  await dialog.getByTestId('git-update').click();
  await expect(dialog.getByTestId('git-status')).toContainText('auseinandergelaufen');
  await expect(dialog.getByTestId('git-status')).toHaveClass(/is-error/);

  // Untracked files are never deleted, so a selection of only such files cannot be discarded.
  const discard = dialog.getByTestId('git-discard');
  await dialog.getByRole('checkbox', { name: 'diagrams/architecture.sketchdraw für den Commit auswählen' }).uncheck();
  await expect(discard).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'docs/notes.md für den Commit auswählen' }).check();
  await expect(discard).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'diagrams/login.sketchdraw für den Commit auswählen' }).check();
  await discard.click();
  const confirm = dialog.getByTestId('git-confirm');
  await expect(confirm).toContainText('1 Datei auf den letzten Commit zurücksetzen? Die Änderungen sind danach weg.');
  await confirm.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(confirm).toHaveCount(0);
  expect(await calls(page, 'discard')).toEqual([]);
  await discard.click();
  await dialog.getByTestId('git-confirm-discard').click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Änderungen verworfen.');
  expect(await calls(page, 'discard')).toEqual([{ handleId: 'architecture-file', paths: ['diagrams/login.sketchdraw'] }]);
  await expect(dialog.getByTestId('git-changes').getByRole('listitem')).toHaveCount(2);
});

test('the history shows what a commit changed in the diagram and brings an old state back (#216)', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  const tabs = dialog.getByRole('tablist');
  await tabs.getByRole('tab', { name: /Änderungen/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Verlauf' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: 'Verlauf' })).toBeFocused();
  const history = dialog.getByTestId('git-history').getByRole('listitem');
  // Only the commits of this diagram at first; the newest is chosen and marked as not pushed.
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText('Zahlungsdienst anbinden'); await expect(history.first()).toContainText('Mira Okafor'); await expect(history.first()).toContainText('a41c9e2'); await expect(history.first()).toContainText('nicht gepusht');
  await expect(history.first()).toContainText('15.11.2026');
  await expect(history.nth(1)).not.toContainText('nicht gepusht');
  const panel = dialog.getByRole('tabpanel', { name: 'Verlauf' });
  await expect(panel.getByTestId('diff-view')).toContainText('new line of diagrams/architecture.sketchdraw in aaaaaaa');
  await panel.getByRole('switch', { name: 'Nur dieses Diagramm' }).click();
  await expect(history).toHaveCount(3);
  expect(await calls(page, 'log')).toEqual([{ handleId: 'architecture-file', documentOnly: true }, { handleId: 'architecture-file', documentOnly: false }]);
  await history.nth(1).getByRole('button').click();
  await expect(panel.getByTestId('diff-view')).toHaveText('Dieser Commit hat das Diagramm nicht geändert.');
  expect((await new AxeBuilder({ page }).include('[data-testid="git-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);

  await history.nth(2).getByRole('button').click();
  await panel.getByTestId('git-restore').click();
  await expect(dialog.getByTestId('git-confirm')).toContainText('Das Diagramm auf den Stand von c05e8aa zurücksetzen?');
  await dialog.getByTestId('git-confirm-restore').click();
  expect(await calls(page, 'restore')).toEqual([{ handleId: 'architecture-file', commit: 'c'.repeat(40) }]);
  // The old state is an ordinary change, so the dialog goes back to the changes.
  await expect(tabs.getByRole('tab', { name: /Änderungen/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByTestId('git-status')).toContainText('Das Diagramm hat den Stand des gewählten Commits.');
});

test('automatic commit, push and sync switch at once and keep each other (#216)', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  await dialog.getByRole('tab', { name: 'Automatik' }).click();
  const commit = dialog.getByTestId('git-auto-commit'); const push = dialog.getByTestId('git-auto-push'); const sync = dialog.getByTestId('git-auto-sync');
  await expect(commit).toHaveAttribute('aria-checked', 'false'); await expect(push).toHaveAttribute('aria-checked', 'false'); await expect(sync).toHaveAttribute('aria-checked', 'true');
  await expect(push).toContainText('Remote „origin“');
  await commit.click();
  await expect(commit).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByTestId('git-status')).toHaveText('Automatik gespeichert.');
  await sync.click();
  await expect(sync).toHaveAttribute('aria-checked', 'false');
  expect(await calls(page, 'automation')).toEqual([{ autoCommit: true, autoPush: false, autoPull: true }, { autoCommit: true, autoPush: false, autoPull: false }]);
  expect((await new AxeBuilder({ page }).include('[data-testid="git-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('unsaved changes of the diagram are named before a commit and block going back (#216)', async ({ page }) => {
  await desktop(page);
  const dialog = await openGit(page);
  await page.keyboard.press('Escape');
  // Draw something: the diagram now differs from its file.
  await page.getByRole('button', { name: 'Rechteck', exact: true }).click();
  await page.mouse.move(420, 320); await page.mouse.down(); await page.mouse.move(560, 420, { steps: 4 }); await page.mouse.up();
  await expect(page.locator('[data-kind="rectangle"]')).toHaveCount(1);
  await page.getByTestId('git-button').click();
  await expect(dialog.getByTestId('git-unsaved')).toContainText('Das Diagramm hat ungespeicherte Änderungen.');
  await dialog.getByRole('tab', { name: 'Verlauf' }).click();
  await expect(dialog.getByTestId('git-restore')).toBeDisabled();
  await dialog.getByTestId('git-update').click();
  await expect(dialog.getByTestId('git-status')).toHaveText('Speichere das Diagramm, bevor du den Stand vom Remote holst.');
  expect(await calls(page, 'update')).toEqual([]);
  await dialog.getByRole('tabpanel', { name: 'Verlauf' }).getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByTestId('git-restore')).toBeEnabled();
});

test('the Git dialog follows the dark theme (#216)', async ({ page }) => {
  await desktop(page, { theme: 'dark' });
  const dialog = await openGit(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const lightness = (locator: Locator, property: 'backgroundColor' | 'color'): Promise<number> => locator.evaluate((node, name) => { const [r, g, b] = getComputedStyle(node)[name].match(/[\d.]+/g)!.map(Number); return (r! + g! + b!) / 3; }, property);
  expect(await lightness(dialog.locator('.git-panel'), 'backgroundColor')).toBeLessThan(60);
  expect(await lightness(dialog.getByTestId('diff-view').first(), 'backgroundColor')).toBeLessThan(60);
  expect(await lightness(dialog.getByRole('heading', { name: 'Git' }), 'color')).toBeGreaterThan(200);
  expect((await new AxeBuilder({ page }).include('[data-testid="git-dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

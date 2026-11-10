import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }, testInfo) => {
  page.on('pageerror', error => { throw error; });
  if (testInfo.title.includes('installed plugin configuration')) {
    await page.addInitScript(() => {
      const settings = {
        available: true,
        projectFolder: '/Users/demo/architecture',
        git: { installed: false, enabled: false, folderPath: '/Users/demo/architecture', autoCommit: true, autoPush: false, autoPull: true, remote: 'origin', remoteUrl: '', authMode: 'system', username: '', credentialStored: false, health: 'disabled', message: 'Git-Plugin ist deaktiviert.' },
        atlassian: { installed: false, enabled: false, siteUrl: '', email: '', confluenceSpaceKey: '', jiraProjectKey: '', jiraIssueType: 'Task', jqlFilter: '', credentialStored: false, health: 'disabled', message: 'Jira-Plugin ist deaktiviert.' },
      };
      const clone = () => structuredClone(settings);
      Object.defineProperty(window, 'sketchdraw', { value: {
        platform: 'electron',
        openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }), exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
        onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
        plugins: {
          getSettings: async () => clone(),
          installPlugin: async (id: 'git' | 'jira') => { if (id === 'git') settings.git.installed = true; else settings.atlassian.installed = true; return clone(); },
          uninstallPlugin: async (id: 'git' | 'jira') => { if (id === 'git') settings.git.installed = false; else settings.atlassian.installed = false; return clone(); },
          configureGit: async () => clone(), configureAtlassian: async () => clone(), testAtlassian: async () => ({ ok: true, message: 'Jira: verbunden' }),
          gitStatus: async () => ({ ok: true, message: 'Repository ist synchron.', settings: clone().git }), gitSync: async () => ({ ok: true, message: 'Repository ist synchron.', settings: clone().git }), watchDocument: async () => ({ ok: true, message: 'watching' }),
          listConfluencePages: async () => [], getConfluencePage: async () => { throw new Error('not used'); }, updateConfluencePage: async () => { throw new Error('not used'); },
          createJiraIssue: async () => { throw new Error('not used'); }, listJiraIssues: async () => [], transitionJiraIssue: async () => { throw new Error('not used'); }, onEvent: () => () => {},
        },
      } });
    });
  }
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
});

test('installed plugin configuration exposes project-scoped Git and Jira controls', async ({ page }) => {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins' });
  await expect(dialog).toContainText('/Users/demo/architecture');
  await dialog.getByRole('button', { name: 'Installieren' }).click();
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Git-Konfiguration' })).toBeVisible();
  await expect(dialog.getByLabel('Projektordner')).toHaveValue('/Users/demo/architecture');
  await expect(dialog.getByLabel('Remote-URL')).toBeVisible();
  await dialog.getByText('Username und Token', { exact: true }).click();
  await expect(dialog.getByLabel('Access-Token')).toHaveAttribute('type', 'password');
  await dialog.getByRole('tab', { name: 'Marketplace' }).click();
  await dialog.getByRole('button', { name: /Jira Aufgaben/ }).click();
  await dialog.getByRole('button', { name: 'Installieren' }).click();
  await expect(dialog.getByRole('heading', { name: 'Jira-Konfiguration' })).toBeVisible();
  await expect(dialog.getByLabel('JQL-Filter')).toBeVisible();
  await expect(dialog.getByLabel('API-Token')).toHaveAttribute('type', 'password');
});

test('plugin marketplace exposes catalog and installed tabs while explaining the desktop boundary', async ({ page }) => {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitemcheckbox', { name: 'Plugin-Einstellungen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Plugins' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Marketplace' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: /Installiert/ })).toBeVisible();
  await expect(dialog).toContainText('Git');
  await expect(dialog).toContainText('Jira');
  await expect(dialog).toContainText('Electron-Desktop-App');
  await expect(dialog.getByRole('heading', { name: 'Git' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Installieren' })).toBeDisabled();
  await dialog.getByRole('tab', { name: /Installiert/ }).click();
  await expect(dialog).toContainText('Für dieses Projekt sind noch keine Plugins installiert.');
  expect((await new AxeBuilder({ page }).include('.plugin-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Plugin-Einstellungen schließen' }).click();
  await expect(dialog).toHaveCount(0);
});

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { UpdateStatus } from '../../src/domain';

type UpdateControl = {
  status: UpdateStatus;
  /** What a check answers with. */
  latest: { version: string; canInstall: boolean } | 'current' | 'offline';
  calls: string[];
  listeners: Array<(status: UpdateStatus) => void>;
  push(change: Partial<UpdateStatus>): void;
};
type TestWindow = Window & { __updates: UpdateControl };

/** A desktop app whose updater lives in memory: the test decides what a check finds and reports progress itself. */
async function desktop(page: Page, options: { theme?: 'light' | 'dark'; language?: 'de' | 'en'; supported?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ theme, language, supported }) => {
    localStorage.setItem('sketchdraw.preferences.v1', JSON.stringify({ theme, language, canvasBackground: null }));
    const control: UpdateControl = {
      status: { supported, canInstall: false, autoCheck: true, currentVersion: '0.1.6', phase: 'idle', latestVersion: null, progress: null, problem: null },
      latest: 'current',
      calls: [],
      listeners: [],
      push(change) { control.status = { ...control.status, ...change }; for (const listener of control.listeners) listener(control.status); },
    };
    Object.defineProperty(window, '__updates', { value: control });
    Object.defineProperty(window, 'sketchdraw', { value: {
      platform: 'electron',
      openDocument: async () => ({ status: 'cancelled' }), saveDocument: async () => ({ status: 'cancelled' }),
      exportFile: async () => ({ status: 'cancelled' }), openExternal: async () => {},
      onCloseRequested: () => () => {}, respondToClose: async () => {}, onMenuCommand: () => () => {},
      updates: {
        getStatus: async () => control.status,
        check: async () => {
          control.calls.push('check');
          if (control.latest === 'offline') control.push({ phase: 'error', problem: 'network' });
          else if (control.latest === 'current') control.push({ phase: 'current', latestVersion: control.status.currentVersion, problem: null });
          else control.push({ phase: 'available', latestVersion: control.latest.version, canInstall: control.latest.canInstall, problem: null });
          return control.status;
        },
        install: async () => { control.calls.push('install'); control.push({ phase: 'downloading', progress: 0 }); return control.status; },
        setAutoCheck: async (enabled: boolean) => { control.calls.push(`auto:${enabled}`); control.push({ autoCheck: enabled }); return control.status; },
        openReleasePage: async () => { control.calls.push('release-page'); },
        onStatus: (listener: (status: UpdateStatus) => void) => { control.listeners.push(listener); return () => { control.listeners = control.listeners.filter((entry) => entry !== listener); }; },
      },
    } });
  }, { theme: options.theme ?? 'light', language: options.language ?? 'de', supported: options.supported ?? true });
  page.on('pageerror', (error) => { throw error; });
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
}

async function openSettings(page: Page, language: 'de' | 'en' = 'de') {
  await page.getByTestId('workspace-menu-button').click();
  await page.getByRole('menuitem', { name: language === 'de' ? 'Einstellungen' : 'Settings' }).click();
  const dialog = page.getByTestId('settings-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
const control = <T>(page: Page, read: (control: UpdateControl) => T): Promise<T> => page.evaluate((source) => (new Function('control', `return (${source})(control)`) as (control: UpdateControl) => T)((window as unknown as TestWindow).__updates), read.toString());
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('[data-testid=settings-dialog]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;

test('the settings show the version, find a new one, install it and report the progress', async ({ page }) => {
  await desktop(page);
  const dialog = await openSettings(page);
  const section = dialog.getByRole('region', { name: 'Updates' });
  const message = section.getByTestId('update-message');
  await expect(section.getByTestId('update-version')).toHaveText('Version 0.1.6');
  await expect(message).toHaveText('');
  expect(await axe(page)).toEqual([]);

  await section.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(message).toHaveText('Sketchdraw ist aktuell.');

  await control(page, (updates) => { updates.latest = { version: '0.1.7', canInstall: true }; });
  await section.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(message).toHaveText('Version 0.1.7 ist verfügbar.');
  await expect(section.getByRole('button', { name: 'Nach Updates suchen' })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);

  await section.getByRole('button', { name: 'Jetzt aktualisieren' }).click();
  await expect(message).toHaveText('Version 0.1.7 wird geladen: 0 %');
  await expect(section.getByRole('button')).toHaveCount(0);
  await control(page, (updates) => { updates.push({ progress: 0.42 }); });
  await expect(message).toHaveText('Version 0.1.7 wird geladen: 42 %');
  const progress = section.getByRole('progressbar', { name: 'Fortschritt des Downloads' });
  await expect(progress).toHaveAttribute('aria-valuenow', '42');
  expect(await axe(page)).toEqual([]);

  await control(page, (updates) => { updates.push({ phase: 'installing', progress: null }); });
  await expect(message).toHaveText('Version 0.1.7 wird installiert …');
  await expect(progress).toHaveCount(0);
  await control(page, (updates) => { updates.push({ phase: 'ready' }); });
  await expect(message).toHaveText('Version 0.1.7 ist bereit. Sketchdraw startet neu, sobald offene Änderungen gesichert sind.');
  expect(await control(page, (updates) => updates.calls)).toEqual(['check', 'check', 'install']);
});

test('a failed check and a discarded download say why; the release page is offered where it helps', async ({ page }) => {
  await desktop(page);
  const section = (await openSettings(page)).getByRole('region', { name: 'Updates' });
  const message = section.getByTestId('update-message');

  await control(page, (updates) => { updates.latest = 'offline'; });
  await section.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(message).toHaveText('GitHub war nicht erreichbar. Versuche es später noch einmal.');
  await expect(section.getByRole('button', { name: 'Release-Seite öffnen' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Nach Updates suchen' })).toBeVisible();

  await control(page, (updates) => { updates.push({ phase: 'error', problem: 'checksum', latestVersion: '0.1.7' }); });
  await expect(message).toHaveText('Die geladene Datei passt nicht zur Prüfsumme des Releases und wurde verworfen.');
  await section.getByRole('button', { name: 'Release-Seite öffnen' }).click();
  expect(await control(page, (updates) => updates.calls)).toEqual(['check', 'release-page']);
  expect(await axe(page)).toEqual([]);

  // An installation that cannot replace itself only points to the release page.
  await control(page, (updates) => { updates.latest = { version: '0.1.7', canInstall: false }; });
  await section.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(message).toContainText('Diese Installation kann sich nicht selbst ersetzen');
  await expect(section.getByRole('button', { name: 'Jetzt aktualisieren' })).toHaveCount(0);
  await section.getByRole('button', { name: 'Release-Seite öffnen' }).click();
  expect(await control(page, (updates) => updates.calls.at(-1))).toBe('release-page');
});

test('the automatic check is a switch, and the section follows the language and the dark theme', async ({ page }) => {
  await desktop(page, { theme: 'dark', language: 'en' });
  const section = (await openSettings(page, 'en')).getByRole('region', { name: 'Updates' });
  const auto = section.getByRole('switch', { name: /Check for updates automatically/ });
  await expect(auto).toHaveAttribute('aria-checked', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-checked', 'false');
  expect(await control(page, (updates) => updates.calls)).toEqual(['auto:false']);
  await auto.focus();
  await page.keyboard.press('Space');
  await expect(auto).toHaveAttribute('aria-checked', 'true');

  await section.getByRole('button', { name: 'Check for updates' }).click();
  await expect(section.getByTestId('update-message')).toHaveText('Sketchdraw is up to date.');
  expect(await axe(page)).toEqual([]);
});

test('a start from the sources shows the version and no update actions', async ({ page }) => {
  await desktop(page, { supported: false });
  const dialog = await openSettings(page);
  const section = dialog.getByRole('region', { name: 'Updates' });
  await expect(section.getByTestId('update-message')).toHaveText('Updates gibt es nur in der installierten App.');
  await expect(section.getByRole('button')).toHaveCount(0);
  await expect(section.getByRole('switch')).toHaveCount(0);
});

test('the browser version has no update section', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('whiteboard-canvas')).toBeVisible();
  const dialog = await openSettings(page);
  await expect(dialog.getByText('Updates', { exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('update-settings')).toHaveCount(0);
});

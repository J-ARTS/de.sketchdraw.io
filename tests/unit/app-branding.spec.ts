import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { buildAppMenuTemplate } from '../../electron/app-menu';
import { APP_BUNDLE_ID, APP_DISPLAY_NAME } from '../../electron/branding';
import { NATIVE_TEXTS, nativeText, setNativeLanguage } from '../../electron/i18n';
import { createUpdatePrompts } from '../../electron/update-dialogs';
import type { UpdateStatus } from '../../src/domain/updates';

const ROOT = join(__dirname, '../..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [...(item.label ? [item.label] : []), ...(Array.isArray(item.submenu) ? labels(item.submenu) : [])]);
}
function menu(platform: NodeJS.Platform, language: 'de' | 'en', updates = true): MenuItemConstructorOptions[] {
  setNativeLanguage(language);
  return buildAppMenuTemplate({ platform, text: nativeText, onCommand: () => undefined, ...(updates ? { onCheckForUpdates: () => undefined } : {}) });
}

describe('the app is called Sketchdraw wherever its name shows (#236)', () => {
  it('names itself in the macOS app menu instead of taking the package name from app.name', () => {
    const [app] = menu('darwin', 'de');
    expect(app!.label).toBe('Sketchdraw');
    const entries = (app!.submenu as MenuItemConstructorOptions[]).filter((item) => item.type !== 'separator');
    expect(entries.map((item) => [item.role ?? item.id, item.label])).toEqual([
      ['about', 'Über Sketchdraw'],
      ['check-for-updates', 'Nach Updates suchen…'],
      ['hide', 'Sketchdraw ausblenden'],
      ['hideOthers', 'Andere ausblenden'],
      ['unhide', 'Alle einblenden'],
      ['quit', 'Sketchdraw beenden'],
    ]);
    const english = (menu('darwin', 'en')[0]!.submenu as MenuItemConstructorOptions[]).filter((item) => item.type !== 'separator').map((item) => item.label);
    expect(english).toEqual(['About Sketchdraw', 'Check for Updates…', 'Hide Sketchdraw', 'Hide Others', 'Show All', 'Quit Sketchdraw']);
  });

  it('gives every entry whose default label would use app.name an own label, on every platform', () => {
    const named = new Set(['about', 'hide', 'quit', 'services']);
    const walk = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? walk(item.submenu) : [])]);
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const language of ['de', 'en'] as const) {
        const all = walk(menu(platform, language));
        for (const item of all.filter((entry) => entry.role && named.has(entry.role))) expect(item.label, `${platform} ${item.role}`).toContain('Sketchdraw');
        for (const label of labels(menu(platform, language))) expect(label).not.toMatch(/de\.sketchdraw\.io|Electron/i);
      }
    }
  });

  it('puts About and the update check into a Help menu on Windows and Linux', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const template = menu(platform, 'de');
      expect(template.map((item) => item.label)).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Hilfe']);
      expect((template.at(-1)!.submenu as MenuItemConstructorOptions[]).map((item) => item.label)).toEqual(['Nach Updates suchen…', 'Über Sketchdraw']);
      expect(menu(platform, 'en').map((item) => item.label)).toEqual(['File', 'Edit', 'View', 'Help']);
    }
  });

  it('labels every entry in the language of the app instead of leaving role defaults in English', () => {
    const walk = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? walk(item.submenu) : [])]);
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      for (const item of walk(menu(platform, 'de'))) if (item.type !== 'separator') expect(item.label, `${platform} ${item.role ?? item.id}`).toBeTruthy();
    }
    expect(labels(menu('linux', 'de'))).toEqual(expect.arrayContaining(['Ausschneiden', 'Kopieren', 'Einfügen', 'Alles auswählen', 'Originalgröße', 'Vergrößern', 'Verkleinern', 'Vollbild']));
    expect(labels(menu('darwin', 'en'))).toEqual(expect.arrayContaining(['Close Window', 'Cut', 'Copy', 'Paste', 'Select All', 'Actual Size', 'Zoom In', 'Zoom Out', 'Toggle Full Screen']));
  });

  it('leaves the update check out where the app cannot look for updates', () => {
    for (const platform of ['darwin', 'win32'] as const) expect(labels(menu(platform, 'de', false))).not.toContain('Nach Updates suchen…');
  });

  it('keeps the menu ids that the renderer and the tests address', () => {
    const ids = (items: MenuItemConstructorOptions[]): string[] => items.flatMap((item) => [...(item.id ? [item.id] : []), ...(Array.isArray(item.submenu) ? ids(item.submenu) : [])]);
    expect(ids(menu('linux', 'de'))).toEqual(['file-open', 'file-save', 'file-save-as', 'edit-undo', 'edit-redo', 'check-for-updates']);
  });

  it('keeps the package name, because the data folder and the credential key are named after it', () => {
    const manifest = JSON.parse(read('package.json')) as { name: string; productName?: string };
    expect(manifest.name).toBe('de.sketchdraw.io');
    expect(manifest.productName).toBeUndefined();
    expect(read('electron/main.ts')).not.toMatch(/app\.setName\(|app\.name\s*=|setPath\(\s*'userData'/);
  });

  it('builds installers under the visible name and matches the window class of the Linux app', () => {
    const builder = JSON.parse(read('electron-builder.json')) as { productName: string; appId: string; linux: { desktop?: { entry?: Record<string, string> } } };
    expect(builder.productName).toBe(APP_DISPLAY_NAME);
    expect(builder.appId).toBe(APP_BUNDLE_ID);
    // Electron names the X11 window class after app.name; the desktop entry has to say the same for the dock to show name and icon.
    expect(builder.linux.desktop?.entry?.['StartupWMClass']).toBe('de.sketchdraw.io');
  });

  it('sets name, version and copyright of the About dialog and the Dock icon of a start from the sources', () => {
    const main = read('electron/main.ts');
    expect(main).toMatch(/app\.setAboutPanelOptions\(\{\s*applicationName: APP_DISPLAY_NAME,\s*applicationVersion: app\.getVersion\(\),\s*copyright: APP_COPYRIGHT/);
    expect(main).toMatch(/process\.platform === 'darwin' && !app\.isPackaged && icon\) app\.dock\?\.setIcon\(icon\)/);
    expect(read('index.html')).toContain('<title>Sketchdraw</title>');
  });
});

describe('native texts', () => {
  it('fills placeholders in both languages and falls back to the German text', () => {
    setNativeLanguage('de');
    expect(nativeText('Sketchdraw {version} ist verfügbar', { version: '0.1.7' })).toBe('Sketchdraw 0.1.7 ist verfügbar');
    setNativeLanguage('en');
    expect(nativeText('Sketchdraw {version} ist verfügbar', { version: '0.1.7' })).toBe('Sketchdraw 0.1.7 is available');
    expect(nativeText('Nicht übersetzt {x}', { x: '1' })).toBe('Nicht übersetzt 1');
    setNativeLanguage('de');
  });

  it('has an English version of every text of the menu and the update dialogs, with the same placeholders', () => {
    const sources = ['electron/app-menu.ts', 'electron/update-dialogs.ts'].map(read).join('\n');
    const used = [...sources.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]!).filter((text) => /[äöüÄÖÜß…]|^[A-ZÄÖÜ][a-zäöüß]+ |^(Datei|Speichern|Bearbeiten|Ansicht|Hilfe|Später|Versionshinweise)$/.test(text));
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((text) => !NATIVE_TEXTS.includes(text))).toEqual([]);
    setNativeLanguage('en');
    const placeholders = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join();
    for (const german of NATIVE_TEXTS) expect(placeholders(nativeText(german)), german).toBe(placeholders(german));
    setNativeLanguage('de');
  });
});

describe('update dialogs', () => {
  const status = (overrides: Partial<UpdateStatus>): UpdateStatus => ({ supported: true, canInstall: true, autoCheck: true, currentVersion: '0.1.6', phase: 'available', latestVersion: '0.1.7', progress: null, problem: null, ...overrides });

  function setup(answers: number[], checked: UpdateStatus, installed: UpdateStatus = status({ phase: 'ready' })) {
    setNativeLanguage('de');
    const shown: Array<{ message: string; detail?: string; buttons?: string[] }> = [];
    const service = {
      check: vi.fn(async () => checked),
      install: vi.fn(async () => installed),
      dismissAvailable: vi.fn(async () => undefined),
      shouldPrompt: vi.fn(() => checked.phase === 'available'),
    };
    const openReleasePage = vi.fn();
    const prompts = createUpdatePrompts({
      service: () => service,
      showMessage: async (options) => { shown.push({ message: options.message, ...(options.detail ? { detail: options.detail } : {}), ...(options.buttons ? { buttons: options.buttons } : {}) }); return { response: answers.shift() ?? 0, checkboxChecked: false }; },
      openReleasePage,
      text: nativeText,
    });
    return { prompts, shown, service, openReleasePage };
  }
  const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

  it('offers the new version from the menu and installs it on "Jetzt aktualisieren"', async () => {
    const { prompts, shown, service } = setup([0], status({}));
    await prompts.checkFromMenu();
    expect(shown).toEqual([{
      message: 'Sketchdraw 0.1.7 ist verfügbar',
      detail: 'Installiert ist Version 0.1.6. Sketchdraw lädt die neue Version, prüft sie gegen die Prüfsumme des Releases und startet danach neu.',
      buttons: ['Jetzt aktualisieren', 'Später', 'Versionshinweise'],
    }]);
    expect(service.install).toHaveBeenCalledOnce();
    expect(service.dismissAvailable).not.toHaveBeenCalled();
  });

  it('does nothing on "Später" from the menu and opens the notes on "Versionshinweise"', async () => {
    const later = setup([1], status({}));
    await later.prompts.checkFromMenu();
    expect(later.service.install).not.toHaveBeenCalled();
    expect(later.service.dismissAvailable).not.toHaveBeenCalled();

    const notes = setup([2], status({}));
    await notes.prompts.checkFromMenu();
    expect(notes.openReleasePage).toHaveBeenCalledOnce();
    expect(notes.service.install).not.toHaveBeenCalled();
  });

  it('says so when the app is up to date, and why when the check failed', async () => {
    const current = setup([0], status({ phase: 'current', latestVersion: '0.1.6' }));
    await current.prompts.checkFromMenu();
    expect(current.shown).toEqual([{ message: 'Sketchdraw ist aktuell', detail: 'Version 0.1.6 ist die neueste veröffentlichte Version.', buttons: ['Schließen'] }]);

    const offline = setup([0], status({ phase: 'error', problem: 'network', latestVersion: null }));
    await offline.prompts.checkFromMenu();
    expect(offline.shown).toEqual([{ message: 'Das Update ist fehlgeschlagen', detail: 'GitHub war nicht erreichbar. Versuche es später noch einmal.', buttons: ['Schließen'] }]);
    expect(offline.openReleasePage).not.toHaveBeenCalled();
  });

  it('explains a failed installation and offers the release page', async () => {
    const { prompts, shown, openReleasePage } = setup([0, 0], status({}), status({ phase: 'error', problem: 'checksum' }));
    await prompts.checkFromMenu();
    expect(shown[1]).toEqual({ message: 'Das Update ist fehlgeschlagen', detail: 'Die geladene Datei passt nicht zur Prüfsumme des Releases und wurde verworfen.', buttons: ['Release-Seite öffnen', 'Schließen'] });
    expect(openReleasePage).toHaveBeenCalledOnce();
  });

  it('points to the release page where the installation cannot replace itself', async () => {
    const { prompts, shown, service, openReleasePage } = setup([0], status({ canInstall: false }));
    await prompts.checkFromMenu();
    expect(shown[0]!.buttons).toEqual(['Release-Seite öffnen', 'Später']);
    expect(shown[0]!.detail).toContain('kann sich nicht selbst ersetzen');
    expect(openReleasePage).toHaveBeenCalledOnce();
    expect(service.install).not.toHaveBeenCalled();
  });

  it('stays silent after an automatic check unless a version is available, and remembers "Später"', async () => {
    for (const quiet of [status({ phase: 'current' }), status({ phase: 'error', problem: 'network' }), status({ phase: 'error', problem: 'release' })]) {
      const { prompts, shown } = setup([], quiet);
      prompts.onAutomaticCheck(quiet);
      await settle();
      expect(shown).toEqual([]);
    }
    const available = setup([1], status({}));
    available.prompts.onAutomaticCheck(status({}));
    await settle();
    expect(available.shown).toHaveLength(1);
    expect(available.service.dismissAvailable).toHaveBeenCalledOnce();
    expect(available.service.install).not.toHaveBeenCalled();

    const dismissed = setup([], status({}));
    dismissed.service.shouldPrompt.mockReturnValue(false);
    dismissed.prompts.onAutomaticCheck(status({}));
    await settle();
    expect(dismissed.shown).toEqual([]);
  });

  it('reports an installation that failed after the last quit', async () => {
    const failed = status({ phase: 'error', problem: 'install' });
    const { prompts, shown } = setup([1], failed);
    prompts.onAutomaticCheck(failed);
    await settle();
    expect(shown).toEqual([{ message: 'Das Update ist fehlgeschlagen', detail: 'Die neue Version ließ sich nicht installieren. Auf der Release-Seite kannst du sie von Hand laden.', buttons: ['Release-Seite öffnen', 'Schließen'] }]);
  });

  it('speaks English when the app does', async () => {
    const { prompts, shown } = setup([1], status({}));
    setNativeLanguage('en');
    await prompts.checkFromMenu();
    setNativeLanguage('de');
    expect(shown[0]).toEqual({
      message: 'Sketchdraw 0.1.7 is available',
      detail: 'Version 0.1.6 is installed. Sketchdraw downloads the new version, checks it against the checksum of the release and then restarts.',
      buttons: ['Update now', 'Later', 'Release notes'],
    });
  });
});

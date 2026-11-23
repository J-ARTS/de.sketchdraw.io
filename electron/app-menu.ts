import type { MenuItemConstructorOptions } from 'electron';
import { APP_DISPLAY_NAME } from './branding';
import type { MenuCommand } from './ipc-contract';

export interface AppMenuOptions {
  readonly platform: NodeJS.Platform;
  /** Translates a German source text of the native layer. */
  text(german: string): string;
  onCommand(command: MenuCommand): void;
  /** "Check for Updates…" is always offered (#299): the installed app and a start from the sources both answer it. */
  onCheckForUpdates(): void;
}

/**
 * The application menu. Every entry that would otherwise take its label from `app.name` (About, Hide, Quit) names the
 * app itself: `app.name` is the package name and must stay it (#236).
 */
export function buildAppMenuTemplate(options: AppMenuOptions): MenuItemConstructorOptions[] {
  const { text, onCommand } = options;
  const isMac = options.platform === 'darwin';
  const about: MenuItemConstructorOptions = { role: 'about', label: text('Über Sketchdraw') };
  const updates: MenuItemConstructorOptions[] = [{ id: 'check-for-updates', label: text('Nach Updates suchen…'), click: () => options.onCheckForUpdates() }];
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: APP_DISPLAY_NAME,
      submenu: [
        about,
        ...updates,
        { type: 'separator' },
        { role: 'hide', label: text('Sketchdraw ausblenden') },
        { role: 'hideOthers', label: text('Andere ausblenden') },
        { role: 'unhide', label: text('Alle einblenden') },
        { type: 'separator' },
        { role: 'quit', label: text('Sketchdraw beenden') },
      ],
    });
  }

  template.push(
    {
      label: text('Datei'),
      submenu: [
        { id: 'file-open', label: text('Öffnen…'), accelerator: 'CmdOrCtrl+O', click: () => onCommand('open') },
        { id: 'file-save', label: text('Speichern'), accelerator: 'CmdOrCtrl+S', click: () => onCommand('save') },
        { id: 'file-save-as', label: text('Speichern unter…'), accelerator: 'CmdOrCtrl+Shift+S', click: () => onCommand('save-as') },
        { type: 'separator' },
        isMac ? { role: 'close', label: text('Fenster schließen') } : { role: 'quit', label: text('Sketchdraw beenden') },
      ],
    },
    {
      label: text('Bearbeiten'),
      submenu: [
        { id: 'edit-undo', label: text('Rückgängig'), accelerator: 'CmdOrCtrl+Z', click: () => onCommand('undo') },
        { id: 'edit-redo', label: text('Wiederholen'), accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: () => onCommand('redo') },
        { type: 'separator' },
        { role: 'cut', label: text('Ausschneiden') },
        { role: 'copy', label: text('Kopieren') },
        { role: 'paste', label: text('Einfügen') },
        { role: 'selectAll', label: text('Alles auswählen') },
      ],
    },
    {
      label: text('Ansicht'),
      submenu: [
        { role: 'resetZoom', label: text('Originalgröße') },
        { role: 'zoomIn', label: text('Vergrößern') },
        { role: 'zoomOut', label: text('Verkleinern') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: text('Vollbild') },
      ],
    },
  );

  if (!isMac) template.push({ label: text('Hilfe'), submenu: [...updates, about] });
  return template;
}

import { app } from 'electron';

/**
 * Texts of the native layer (application menu, file dialogs). German is the source language. The renderer reports its
 * language through the setLanguage IPC channel; before that the operating system language is used.
 */
const EN: Readonly<Record<string, string>> = {
  'Datei': 'File',
  'Öffnen…': 'Open…',
  'Speichern': 'Save',
  'Speichern unter…': 'Save as…',
  'Bearbeiten': 'Edit',
  'Rückgängig': 'Undo',
  'Wiederholen': 'Redo',
  'Sketchdraw-Dokument öffnen': 'Open Sketchdraw document',
  'Sketchdraw-Dokument speichern unter': 'Save Sketchdraw document as',
  'Ansicht': 'View',
  'Fenster schließen': 'Close Window',
  'Ausschneiden': 'Cut',
  'Kopieren': 'Copy',
  'Einfügen': 'Paste',
  'Alles auswählen': 'Select All',
  'Originalgröße': 'Actual Size',
  'Vergrößern': 'Zoom In',
  'Verkleinern': 'Zoom Out',
  'Vollbild': 'Toggle Full Screen',
  'Hilfe': 'Help',
  'Über Sketchdraw': 'About Sketchdraw',
  'Nach Updates suchen…': 'Check for Updates…',
  'Sketchdraw ausblenden': 'Hide Sketchdraw',
  'Andere ausblenden': 'Hide Others',
  'Alle einblenden': 'Show All',
  'Sketchdraw beenden': 'Quit Sketchdraw',
  'Sketchdraw {version} ist verfügbar': 'Sketchdraw {version} is available',
  'Installiert ist Version {current}. Sketchdraw lädt die neue Version, prüft sie gegen die Prüfsumme des Releases und startet danach neu.': 'Version {current} is installed. Sketchdraw downloads the new version, checks it against the checksum of the release and then restarts.',
  'Installiert ist Version {current}. Diese Installation kann sich nicht selbst ersetzen; die neue Version liegt auf der Release-Seite.': 'Version {current} is installed. This installation cannot replace itself; the new version is on the release page.',
  'Jetzt aktualisieren': 'Update now',
  'Später': 'Later',
  'Versionshinweise': 'Release notes',
  'Release-Seite öffnen': 'Open release page',
  'Schließen': 'Close',
  'Sketchdraw ist aktuell': 'Sketchdraw is up to date',
  'Version {current} ist die neueste veröffentlichte Version.': 'Version {current} is the latest published version.',
  'Das Update ist fehlgeschlagen': 'The update failed',
  'GitHub war nicht erreichbar. Versuche es später noch einmal.': 'GitHub could not be reached. Try again later.',
  'Das neueste Release ließ sich nicht lesen.': 'The latest release could not be read.',
  'Die geladene Datei passt nicht zur Prüfsumme des Releases und wurde verworfen.': 'The downloaded file does not match the checksum of the release and was discarded.',
  'Die neue Version ließ sich nicht installieren. Auf der Release-Seite kannst du sie von Hand laden.': 'The new version could not be installed. You can download it by hand from the release page.',
  'Die Installation wurde abgebrochen.': 'The installation was cancelled.',
};

/** The app language reported by the renderer; until then the operating system language decides. */
let chosen: 'de' | 'en' | null = null;
export function setNativeLanguage(language: 'de' | 'en'): void { chosen = language; }
export function nativeLanguage(): 'de' | 'en' {
  if (chosen) return chosen;
  let locale = 'de';
  try { locale = app?.getLocale() ?? 'de'; } catch { /* app not ready: keep the German source text */ }
  return locale.toLowerCase().startsWith('en') ? 'en' : 'de';
}

/** `{name}` placeholders are filled from `params`; the German text is the key. */
export function nativeText(german: string, params?: Readonly<Record<string, string>>): string {
  const text = nativeLanguage() === 'en' ? EN[german] ?? german : german;
  return params ? text.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match) : text;
}

/** The German source texts that have an English version; tests compare them with what the native layer uses. */
export const NATIVE_TEXTS: readonly string[] = Object.freeze(Object.keys(EN));

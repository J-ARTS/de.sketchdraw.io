import { app } from 'electron';

/**
 * Texts of the native layer (application menu, file dialogs). German is the source language; English is used when the
 * operating system language is English. The in-app language only affects the renderer (tracked in the issue tracker).
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
};

export function nativeText(german: string): string {
  let locale = 'de';
  try { locale = app?.getLocale() ?? 'de'; } catch { /* app not ready: keep the German source text */ }
  return locale.toLowerCase().startsWith('en') ? EN[german] ?? german : german;
}

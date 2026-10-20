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

export function nativeText(german: string): string {
  return nativeLanguage() === 'en' ? EN[german] ?? german : german;
}

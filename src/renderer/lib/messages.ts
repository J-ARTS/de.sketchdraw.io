import type { ElementKind } from '@/domain/types';
import type { SaveStatus } from '@/renderer/state/contract';
import { KIND_LABELS, elementCountLabel } from './describe';
import { zoomLabel } from './viewport';

/** Status line text per SaveStatus. Only a confirmed `saved` result may read "Gespeichert". */
export const SAVE_STATUS_TEXT: Readonly<Record<SaveStatus, string>> = {
  'unsaved-new': 'Nicht gespeichert',
  dirty: 'Ungespeicherte Änderungen',
  saving: 'Speichert …',
  saved: 'Gespeichert',
  'handed-off': 'Als Download übergeben',
  error: 'Speichern fehlgeschlagen',
  conflict: 'Speicherkonflikt',
};

/** Shown for an untouched new document (revision 0, no file). */
export const PRISTINE_DOCUMENT_TEXT = 'Neues Dokument';

function withDetail(base: string, detail: string | undefined): string {
  const text = detail?.trim();
  return text ? `${base} ${text}` : base;
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/** Store notices and live announcements. Components receive the finished string and never build German text themselves. */
export const messages = {
  selectionCleared: (): string => 'Auswahl aufgehoben',
  selectionCount: (count: number): string =>
    count <= 0 ? 'Nichts ausgewählt' : `${elementCountLabel(count)} ausgewählt`,
  toolChanged: (toolLabel: string): string => `Werkzeug ${toolLabel}`,

  created: (kind: ElementKind): string => `${KIND_LABELS[kind]} erstellt`,
  deleted: (count: number): string => `${elementCountLabel(count)} gelöscht`,
  duplicated: (count: number): string => `${elementCountLabel(count)} dupliziert`,
  moved: (count: number, x: number, y: number): string =>
    `${elementCountLabel(count)} verschoben nach ${Math.round(x)}, ${Math.round(y)}`,
  grouped: (count: number): string => `${elementCountLabel(count)} in Container gruppiert`,
  ungrouped: (containerCount: number): string => `${containerCount} Container aufgelöst`,
  nothingToGroup: (): string => 'Zum Gruppieren zuerst Elemente auswählen',
  nothingToUngroup: (): string => 'Die Auswahl enthält keinen Container',
  connected: (from: string, to: string): string => `Verbunden: ${from} mit ${to}`,
  connectNeedsTwo: (): string => 'Zum Verbinden genau zwei Elemente auswählen',

  undone: (): string => 'Rückgängig gemacht',
  redone: (): string => 'Wiederholt',
  nothingToUndo: (): string => 'Nichts zum Rückgängigmachen',
  nothingToRedo: (): string => 'Nichts zum Wiederholen',
  historyConflict: (operation: 'undo' | 'redo'): string =>
    `${operation === 'undo' ? 'Rückgängig' : 'Wiederholen'} nicht möglich: Betroffene Elemente wurden inzwischen anderweitig geändert. Nichts wurde geändert.`,
  revisionConflict: (): string =>
    'Das Dokument wurde währenddessen geändert. Die Aktion wurde nicht ausgeführt, bitte erneut versuchen.',
  actionRejected: (detail?: string): string => withDetail('Die Aktion wurde abgelehnt.', detail),

  saved: (name: string): string => `Gespeichert: ${name}`,
  downloadInitiated: (name: string): string => `Als Download übergeben: ${name}`,
  saveFailed: (detail?: string): string =>
    withDetail('Speichern fehlgeschlagen. Das Dokument bleibt unverändert im Editor.', detail),
  saveConflict: (): string =>
    'Speichern abgebrochen: Die Datei wurde außerhalb von sketchdraw geändert und nicht überschrieben. Dokument und Änderungen bleiben erhalten.',
  saveCancelled: (): string => 'Speichern abgebrochen',

  opened: (name: string): string => `Geöffnet: ${name}`,
  openFailed: (detail?: string): string => withDetail('Die Datei konnte nicht geöffnet werden.', detail),
  openInvalid: (detail?: string): string =>
    withDetail('Ungültige Datei: Das Dokument konnte nicht gelesen werden. Das aktuelle Dokument bleibt unverändert.', detail),

  imageTooLarge: (maxBytes: number): string => `Das Bild ist zu groß (maximal ${megabytes(maxBytes)} MB).`,
  imageTotalTooLarge: (): string => 'Die eingebetteten Bilder überschreiten die maximale Gesamtgröße des Dokuments.',
  imageWrongFormat: (): string => 'Dieses Bildformat wird nicht unterstützt. Erlaubt sind PNG, JPEG und WebP.',
  imageReadFailed: (): string => 'Das Bild konnte nicht gelesen werden.',

  offscreenChanges: (count: number): string =>
    `${count} ${count === 1 ? 'Änderung' : 'Änderungen'} außerhalb des sichtbaren Bereichs`,
  focusAfterRemoteDelete: (nextName?: string): string =>
    nextName
      ? `Das fokussierte Element wurde gelöscht. Fokus auf ${nextName}.`
      : 'Das fokussierte Element wurde gelöscht. Fokus liegt auf der Zeichenfläche.',

  zoomLevel: (zoom: number): string => `Zoom ${zoomLabel(zoom)}`,
  fitAll: (): string => 'Alle Elemente werden angezeigt',
  fitSelection: (): string => 'Auswahl wird angezeigt',
  nothingToFit: (): string => 'Es gibt nichts anzuzeigen',

  emptyTextDiscarded: (): string => 'Leerer Text verworfen',
  textConflictChanged: (): string => 'Das Element wurde während der Bearbeitung geändert. Dein Entwurf bleibt erhalten.',
  textConflictDeleted: (): string => 'Das Element wurde während der Bearbeitung gelöscht. Dein Entwurf bleibt erhalten.',
  gestureConflict: (canRetry: boolean): string =>
    canRetry
      ? 'Die Änderung wurde nicht übernommen, weil das Dokument inzwischen geändert wurde. Sie kann erneut angewendet oder verworfen werden.'
      : 'Die Änderung wurde nicht übernommen, weil betroffene Elemente inzwischen geändert wurden. Sie kann nicht automatisch erneut angewendet werden.',
  gestureRetried: (): string => 'Änderung erneut angewendet',
  gestureDiscarded: (): string => 'Änderung verworfen',
} as const;

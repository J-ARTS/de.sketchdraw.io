import type { ElementKind } from '@/domain/types';
import type { SaveStatus } from '@/renderer/state/contract';
import { KIND_LABELS, elementCountLabel } from './describe';
import { zoomLabel } from './viewport';

import { L, t, tn } from '@/renderer/i18n';
/** Status line text per SaveStatus. Only a confirmed `saved` result may read "Gespeichert". Getters translate at read time. */
export const SAVE_STATUS_TEXT: Readonly<Record<SaveStatus, string>> = {
  get 'unsaved-new'() { return t('Nicht gespeichert'); },
  get dirty() { return t('Ungespeicherte Änderungen'); },
  get saving() { return t('Speichert …'); },
  get saved() { return t('Gespeichert'); },
  get 'handed-off'() { return t('Als Download übergeben'); },
  get error() { return t('Speichern fehlgeschlagen'); },
  get conflict() { return t('Speicherkonflikt'); },
};

/** Shown for an untouched new document (revision 0, no file). */
export const PRISTINE_DOCUMENT_TEXT = L('Neues Dokument');

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
  selectionCleared: (): string => t('Auswahl aufgehoben'),
  selectionCount: (count: number): string =>
    count <= 0 ? t('Nichts ausgewählt') : t('{elements} ausgewählt', { elements: elementCountLabel(count) }),
  toolChanged: (toolLabel: string): string => t('Werkzeug {toolLabel}', { toolLabel }),

  created: (kind: ElementKind): string => t('{kind} erstellt', { kind: t(KIND_LABELS[kind]) }),
  deleted: (count: number): string => t('{elements} gelöscht', { elements: elementCountLabel(count) }),
  duplicated: (count: number): string => t('{elements} dupliziert', { elements: elementCountLabel(count) }),
  moved: (count: number, x: number, y: number): string =>
    t('{elements} verschoben nach {x}, {y}', { elements: elementCountLabel(count), x: Math.round(x), y: Math.round(y) }),
  grouped: (count: number): string => t('{elements} in Container gruppiert', { elements: elementCountLabel(count) }),
  ungrouped: (containerCount: number): string => tn(containerCount, '{count} Container aufgelöst', '{count} Container aufgelöst'),
  nothingToGroup: (): string => t('Zum Gruppieren zuerst Elemente auswählen'),
  nothingToUngroup: (): string => t('Die Auswahl enthält keinen Container'),
  connected: (from: string, to: string): string => t('Verbunden: {from} mit {to}', { from, to }),
  connectNeedsTwo: (): string => t('Zum Verbinden genau zwei Elemente auswählen'),

  undone: (): string => t('Rückgängig gemacht'),
  redone: (): string => t('Wiederholt'),
  nothingToUndo: (): string => t('Nichts zum Rückgängigmachen'),
  nothingToRedo: (): string => t('Nichts zum Wiederholen'),
  historyConflict: (operation: 'undo' | 'redo'): string =>
    operation === 'undo' ? t('Rückgängig nicht möglich: Betroffene Elemente wurden inzwischen anderweitig geändert. Nichts wurde geändert.') : t('Wiederholen nicht möglich: Betroffene Elemente wurden inzwischen anderweitig geändert. Nichts wurde geändert.'),
  revisionConflict: (): string =>
    t('Das Dokument wurde währenddessen geändert. Die Aktion wurde nicht ausgeführt, bitte erneut versuchen.'),
  actionRejected: (detail?: string): string => withDetail(t('Die Aktion wurde abgelehnt.'), detail),

  saved: (name: string): string => t('Gespeichert: {name}', { name }),
  downloadInitiated: (name: string): string => t('Als Download übergeben: {name}', { name }),
  saveFailed: (detail?: string): string =>
    withDetail(t('Speichern fehlgeschlagen. Das Dokument bleibt unverändert im Editor.'), detail),
  saveConflict: (): string =>
    t('Speichern abgebrochen: Die Datei wurde außerhalb von sketchdraw geändert und nicht überschrieben. Dokument und Änderungen bleiben erhalten.'),
  saveCancelled: (): string => t('Speichern abgebrochen'),

  opened: (name: string): string => t('Geöffnet: {name}', { name }),
  openFailed: (detail?: string): string => withDetail(t('Die Datei konnte nicht geöffnet werden.'), detail),
  openInvalid: (detail?: string): string =>
    withDetail(t('Ungültige Datei: Das Dokument konnte nicht gelesen werden. Das aktuelle Dokument bleibt unverändert.'), detail),

  imageTooLarge: (maxBytes: number): string => t('Das Bild ist zu groß (maximal {maxBytes} MB).', { maxBytes: megabytes(maxBytes) }),
  imageTotalTooLarge: (): string => t('Die eingebetteten Bilder überschreiten die maximale Gesamtgröße des Dokuments.'),
  imageWrongFormat: (): string => t('Dieses Bildformat wird nicht unterstützt. Erlaubt sind PNG, JPEG und WebP.'),
  imageReadFailed: (): string => t('Das Bild konnte nicht gelesen werden.'),

  offscreenChanges: (count: number): string =>
    tn(count, '{count} Änderung außerhalb des sichtbaren Bereichs', '{count} Änderungen außerhalb des sichtbaren Bereichs'),
  focusAfterRemoteDelete: (nextName?: string): string =>
    nextName
      ? t('Das fokussierte Element wurde gelöscht. Fokus auf {nextName}.', { nextName })
      : t('Das fokussierte Element wurde gelöscht. Fokus liegt auf der Zeichenfläche.'),

  zoomLevel: (zoom: number): string => t('Zoom {zoom}', { zoom: zoomLabel(zoom) }),
  fitAll: (): string => t('Alle Elemente werden angezeigt'),
  fitSelection: (): string => t('Auswahl wird angezeigt'),
  nothingToFit: (): string => t('Es gibt nichts anzuzeigen'),

  emptyTextDiscarded: (): string => t('Leerer Text verworfen'),
  textConflictChanged: (): string => t('Das Element wurde während der Bearbeitung geändert. Dein Entwurf bleibt erhalten.'),
  textConflictDeleted: (): string => t('Das Element wurde während der Bearbeitung gelöscht. Dein Entwurf bleibt erhalten.'),
  gestureConflict: (canRetry: boolean): string =>
    canRetry
      ? t('Die Änderung wurde nicht übernommen, weil das Dokument inzwischen geändert wurde. Sie kann erneut angewendet oder verworfen werden.')
      : t('Die Änderung wurde nicht übernommen, weil betroffene Elemente inzwischen geändert wurden. Sie kann nicht automatisch erneut angewendet werden.'),
  gestureRetried: (): string => t('Änderung erneut angewendet'),
  gestureDiscarded: (): string => t('Änderung verworfen'),
} as const;

import type { FileState, SaveStatus } from '@/renderer/state/contract';
import { t } from '@/renderer/i18n';
import { PRISTINE_DOCUMENT_TEXT, SAVE_STATUS_TEXT } from './messages';

export interface SaveStatusView { status: SaveStatus; text: string }

const FILE_EXTENSION = '.sketchdraw.json';
const FALLBACK_BASE_NAME = 'Unbenanntes Diagramm'; // file names stay language-independent
const MAX_BASE_NAME_LENGTH = 100;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Revision-based, not content-based: only a confirmed `saved` result sets savedRevision.
 * A never-persisted document is dirty once it has a revision, or when a handle exists without a confirmed revision.
 * An untouched new document (revision 0, no handle) is not dirty.
 */
export function isDirty(file: FileState, revision: number): boolean {
  if (file.savedRevision !== null) return file.savedRevision !== revision;
  return revision > 0 || file.handle !== null || file.requiresInitialSave === true;
}

function view(status: SaveStatus): SaveStatusView {
  return { status, text: SAVE_STATUS_TEXT[status] };
}

/** Derived only from save results: `saved` needs a confirmed revision, a download hand-off never counts as saved. */
export function deriveSaveStatus(file: FileState, revision: number): SaveStatusView {
  if (file.saving) return view('saving');
  if (file.conflict) return view('conflict');
  if (file.lastError !== null) return view('error');
  if (file.savedRevision === revision) return view('saved');
  if (file.handedOffRevision === revision) return view('handed-off');
  if (isDirty(file, revision)) {
    return view(file.savedRevision !== null || file.handle !== null ? 'dirty' : 'unsaved-new');
  }
  return { status: 'unsaved-new', text: t(PRISTINE_DOCUMENT_TEXT) };
}

/** A download hand-off of the current revision does not trigger the prompt, but a later edit does. */
export function needsClosePrompt(file: FileState, revision: number, hasDraft: boolean): boolean {
  if (hasDraft || file.saving) return true;
  return isDirty(file, revision) && file.handedOffRevision !== revision;
}

function replaceControlCharacters(value: string): string {
  return Array.from(value, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f ? ' ' : char;
  }).join('');
}

/** Safe file name for the save dialog: no path separators, control characters or Windows device names. */
export function suggestFileName(title: string): string {
  let base = replaceControlCharacters(title)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.sketchdraw(?:\.json)?$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  base = Array.from(base).slice(0, MAX_BASE_NAME_LENGTH).join('').replace(/[.\s]+$/, '');
  if (base === '') base = FALLBACK_BASE_NAME;
  if (WINDOWS_RESERVED_NAME.test(base)) base = `${base}_`;
  return `${base}${FILE_EXTENSION}`;
}

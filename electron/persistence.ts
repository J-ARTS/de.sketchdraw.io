import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { INTEROP_LIMITS } from '../src/interop/limits';
import {
  deserializeDocument,
  DOMAIN_LIMITS,
  DomainValidationError,
} from '../src/domain/index';
import type {
  ExportFileResult,
  FileError,
  FileReference,
  OpenDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
  SketchDocument,
} from '../src/domain/types';
import {
  type ExportFormat,
  validateExportFileRequest,
  validateSaveDocumentRequest,
} from './ipc-contract';

const DEFAULT_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const MAX_FILENAME_LENGTH = 200;
const CONTROL_AND_RESERVED_FILENAME_CHARS = /[\u0000-\u001F\u007F<>:"/\\|?*]+/g;
const UNIX_OR_WIN_PATH_PATTERN =
  /(?:[A-Za-z]:\\[^\s"'<>|]+|\\\\[^\s"'<>|]+|\/(?:Users|home|tmp|var|private|etc|opt|usr|mnt|Volumes|proc|sys|dev)\/[^\s"'<>|]*)/g;

export interface OpenDialogSelection {
  canceled: boolean;
  filePaths: string[];
}

export interface SaveDialogSelection {
  canceled: boolean;
  filePath?: string;
}

export interface PersistenceDialogAdapter {
  showOpenDialog(options: {
    title: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<OpenDialogSelection>;
  showSaveDialog(options: {
    title: string;
    defaultPath: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<SaveDialogSelection>;
}

export interface FileHandleLike {
  writeFile(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface PersistenceFsAdapter {
  stat(filePath: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(filePath: string): Promise<Buffer>;
  open(filePath: string, flags: string, mode?: number): Promise<FileHandleLike>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath?(filePath: string): Promise<string>;
}

export interface PersistenceServiceOptions {
  dialogs: PersistenceDialogAdapter;
  fsAdapter?: PersistenceFsAdapter;
  validateDocumentText?: (text: string) => SketchDocument;
  maxDocumentBytes?: number;
  maxExportBytes?: number;
  /**
   * Optional lifecycle hook invoked after temp file fsync/close and immediately
   * before the second pre-rename version check. Used in deterministic unit tests
   * to verify concurrent external modification detection right before rename.
   */
  onBeforePreRenameCheck?: (targetPath: string, tempPath: string) => Promise<void> | void;
}

interface HandleRecord {
  readonly handleId: string;
  selectedPath: string;
  canonicalPath: string;
  versionToken: string;
}

type ExpectedTargetState =
  | { kind: 'version'; versionToken: string }
  | { kind: 'missing' };

const defaultFsAdapter: PersistenceFsAdapter = {
  stat: (filePath) => fs.stat(filePath),
  readFile: (filePath) => fs.readFile(filePath),
  open: (filePath, flags, mode) => fs.open(filePath, flags, mode),
  rename: (oldPath, newPath) => fs.rename(oldPath, newPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath),
};

function getErrnoCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : '';
}

export function computeVersionToken(content: Buffer | Uint8Array | string): string {
  const bytes =
    typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return `sha256:${digest}`;
}

export function redactFilesystemPaths(message: string): string {
  return message.replace(UNIX_OR_WIN_PATH_PATTERN, '[redacted-path]');
}

export function sanitizeSuggestedFileName(
  suggestedName: string,
  format: ExportFormat = 'sketchdraw',
): string {
  const requiredExt = `.${format}`;
  const rawSegments = suggestedName
    .split(/[/\\]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== '.' && part !== '..');

  const rawBase = rawSegments.length > 0 ? rawSegments[rawSegments.length - 1]! : '';
  const cleaned = rawBase
    .replace(CONTROL_AND_RESERVED_FILENAME_CHARS, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();

  let stem = cleaned.length > 0 ? cleaned : 'untitled';
  if (stem.toLowerCase().endsWith(requiredExt)) {
    stem = stem.slice(0, stem.length - requiredExt.length);
  }
  if (stem.trim().length === 0 || stem === '.' || stem === '..') {
    stem = 'untitled';
  }

  const maxStemLength = Math.max(1, MAX_FILENAME_LENGTH - requiredExt.length);
  if (stem.length > maxStemLength) {
    stem = stem.slice(0, maxStemLength);
  }

  return `${stem}${requiredExt}`;
}

export function mapFsErrorToSafeFileError(
  error: unknown,
  fallbackMessage: string,
): FileError {
  const code = getErrnoCode(error) || 'IO_ERROR';

  switch (code) {
    case 'ENOENT':
      return {
        status: 'error',
        code: 'FILE_NOT_FOUND',
        message: 'The target file or directory does not exist.',
      };
    case 'EACCES':
    case 'EPERM':
      return {
        status: 'error',
        code: 'PERMISSION_DENIED',
        message: 'Permission denied while accessing the file.',
      };
    case 'ENOSPC':
      return {
        status: 'error',
        code: 'DISK_FULL',
        message: 'Insufficient disk space to complete the file operation.',
      };
    case 'EROFS':
      return {
        status: 'error',
        code: 'READ_ONLY_FILESYSTEM',
        message: 'The target filesystem is read-only.',
      };
    case 'EISDIR':
      return {
        status: 'error',
        code: 'IS_DIRECTORY',
        message: 'The selected target is a directory, not a regular file.',
      };
    case 'EBUSY':
      return {
        status: 'error',
        code: 'FILE_BUSY',
        message: 'The target file is currently locked or in use by another process.',
      };
    case 'ENAMETOOLONG':
      return {
        status: 'error',
        code: 'NAME_TOO_LONG',
        message: 'The file name or path exceeds operating system limits.',
      };
    default:
      return {
        status: 'error',
        code: 'IO_ERROR',
        message: redactFilesystemPaths(fallbackMessage),
      };
  }
}

function getDialogFiltersForFormat(
  format: ExportFormat,
): Array<{ name: string; extensions: string[] }> {
  switch (format) {
    case 'svg':
      return [{ name: 'SVG Vector Image', extensions: ['svg'] }];
    case 'drawio':
      return [{ name: 'draw.io Diagram', extensions: ['drawio', 'xml'] }];
    case 'sketchdraw':
      return [{ name: 'Sketchdraw Document', extensions: ['sketchdraw', 'json'] }];
  }
}

/**
 * Stateful desktop persistence service owned exclusively by Electron Main.
 *
 * Security & Consistency Guarantees:
 * 1. Only Main allocates random opaque `handleId` tokens (`hdl_<32-hex>`).
 *    Renderer never receives or supplies raw filesystem paths.
 * 2. Size and schema validation are enforced via `src/domain/index` (`deserializeDocument`
 *    and `DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES`).
 * 3. Existing target paths are canonicalized via `realpath` (and new targets via
 *    `realpath(dirname) + basename`). Directory symlink aliases and file symlinks pointing
 *    to the same underlying file share the same in-process lock and canonical version state.
 *    Saving a document opened via a file symlink writes and atomically renames onto the
 *    resolved real target file so the symbolic link itself is preserved.
 * 4. Ordinary `save`, `save-as`, and `exportFile` all enforce a two-phase target guard
 *    (either expected SHA-256 `versionToken` or confirmed target absence after the dialog):
 *    checked before opening the sibling temporary file (`wx`, mode `0o600`) and re-verified
 *    after `fsync` + `close` immediately before `rename`. Temporary files are always unlinked
 *    on failure or conflict.
 * 5. Residual OS boundary: Standard POSIX/Windows `rename` is atomic with respect to
 *    file contents, preventing partial files, and the double hash/existence + canonical path
 *    check narrows the conflict window to the minimum possible user-space interval. Because
 *    OS kernels do not offer a cross-process conditional `rename-if-hash-matches` syscall,
 *    an uncoordinated external process writing or retargeting paths in the sub-millisecond
 *    window between the pre-rename check and `rename` cannot be atomically prevented without
 *    OS-specific mandatory file locks.
 */
export class DocumentPersistenceService {
  private readonly dialogs: PersistenceDialogAdapter;
  private readonly fsAdapter: PersistenceFsAdapter;
  private readonly validateDocumentFn: (text: string) => SketchDocument;
  private readonly maxDocumentBytes: number;
  private readonly maxExportBytes: number;
  private readonly onBeforePreRenameCheck?: (
    targetPath: string,
    tempPath: string,
  ) => Promise<void> | void;

  private readonly handlesById = new Map<string, HandleRecord>();
  private readonly handleIdBySelectedPath = new Map<string, string>();
  private readonly canonicalVersionByPath = new Map<string, string>();
  private readonly fileLocks = new Map<string, Promise<void>>();

  constructor(options: PersistenceServiceOptions) {
    this.dialogs = options.dialogs;
    this.fsAdapter = options.fsAdapter ?? defaultFsAdapter;
    this.validateDocumentFn =
      options.validateDocumentText ?? deserializeDocument;
    this.maxDocumentBytes =
      options.maxDocumentBytes ??
      DOMAIN_LIMITS?.['MAX_DOCUMENT_JSON_BYTES'] ??
      DEFAULT_MAX_DOCUMENT_BYTES;
    this.maxExportBytes = options.maxExportBytes ?? INTEROP_LIMITS.MAX_EXPORT_BYTES;
    this.onBeforePreRenameCheck = options.onBeforePreRenameCheck;
  }

  /** Main-process-only lookup for trusted integrations. Raw paths never cross IPC. */
  public getHandleLocation(handleId: string): { selectedPath: string; canonicalPath: string; versionToken: string } | null {
    const record = this.handlesById.get(handleId);
    return record ? { selectedPath: record.selectedPath, canonicalPath: record.canonicalPath, versionToken: record.versionToken } : null;
  }

  /** Reloads an existing capability after a file watcher observes an external write. */
  public async reloadDocument(handleId: string): Promise<OpenDocumentResult> {
    const record = this.handlesById.get(handleId);
    if (!record) return { status: 'error', code: 'UNKNOWN_HANDLE', message: 'Unknown or expired file handle.' };
    return this.runWithFileLock(record.canonicalPath, async () => {
      try {
        const rawBuffer = await this.fsAdapter.readFile(record.canonicalPath);
        if (rawBuffer.byteLength > this.maxDocumentBytes) return { status: 'error', code: 'DOCUMENT_TOO_LARGE', message: `Document exceeds the maximum allowed size of ${this.maxDocumentBytes} bytes.` };
        const text = rawBuffer.toString('utf8');
        const validationError = this.validateDocumentString(text);
        if (validationError) return validationError;
        const file = this.registerOrUpdateHandle(record.selectedPath, record.canonicalPath, computeVersionToken(rawBuffer), record.handleId);
        return { status: 'opened', text, file };
      } catch (error) {
        return mapFsErrorToSafeFileError(error, 'Failed to reload the document file.');
      }
    });
  }

  public async openDocument(): Promise<OpenDocumentResult> {
    let selection: OpenDialogSelection;
    try {
      selection = await this.dialogs.showOpenDialog({
        title: 'Sketchdraw-Dokument öffnen',
        filters: [
          { name: 'Sketchdraw Document', extensions: ['sketchdraw', 'json'] },
        ],
      });
    } catch {
      return {
        status: 'error',
        code: 'DIALOG_ERROR',
        message: 'Failed to open the native file selection dialog.',
      };
    }

    if (selection.canceled || selection.filePaths.length === 0) {
      return { status: 'cancelled' };
    }

    const rawPath = selection.filePaths[0];
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
      return { status: 'cancelled' };
    }

    const selectedPath = path.resolve(rawPath);
    let canonicalPath: string;
    try {
      canonicalPath = await this.resolveCanonicalExistingPath(selectedPath);
    } catch (error) {
      return mapFsErrorToSafeFileError(
        error,
        'Failed to resolve the selected document file.',
      );
    }

    return this.runWithFileLock(canonicalPath, async () => {
      try {
        const stat = await this.fsAdapter.stat(canonicalPath);
        if (!stat.isFile()) {
          return {
            status: 'error',
            code: 'IS_DIRECTORY',
            message: 'The selected item is not a regular file.',
          };
        }

        if (stat.size > this.maxDocumentBytes) {
          return {
            status: 'error',
            code: 'DOCUMENT_TOO_LARGE',
            message: `Document exceeds the maximum allowed size of ${this.maxDocumentBytes} bytes.`,
          };
        }

        const rawBuffer = await this.fsAdapter.readFile(canonicalPath);
        if (rawBuffer.byteLength > this.maxDocumentBytes) {
          return {
            status: 'error',
            code: 'DOCUMENT_TOO_LARGE',
            message: `Document exceeds the maximum allowed size of ${this.maxDocumentBytes} bytes.`,
          };
        }

        const text = rawBuffer.toString('utf8');
        const validationError = this.validateDocumentString(text);
        if (validationError) {
          return validationError;
        }

        const versionToken = computeVersionToken(rawBuffer);
        const fileRef = this.registerOrUpdateHandle(
          selectedPath,
          canonicalPath,
          versionToken,
        );

        return {
          status: 'opened',
          text,
          file: fileRef,
        };
      } catch (error) {
        return mapFsErrorToSafeFileError(
          error,
          'Failed to read the selected document file.',
        );
      }
    });
  }

  public async saveDocument(
    rawRequest: unknown,
  ): Promise<SaveDocumentResult> {
    const validated = validateSaveDocumentRequest(rawRequest);
    if (!validated.ok) {
      return validated.error;
    }

    const request: SaveDocumentRequest = validated.value;
    const utf8Buffer = Buffer.from(request.text, 'utf8');
    if (utf8Buffer.byteLength > this.maxDocumentBytes) {
      return {
        status: 'error',
        code: 'DOCUMENT_TOO_LARGE',
        message: `Document exceeds the maximum allowed size of ${this.maxDocumentBytes} bytes.`,
      };
    }

    const validationError = this.validateDocumentString(request.text);
    if (validationError) {
      return validationError;
    }

    if (request.mode === 'save') {
      const handleRecord = this.handlesById.get(request.handleId);
      if (!handleRecord) {
        return {
          status: 'error',
          code: 'UNKNOWN_HANDLE',
          message: 'Unknown or expired file handle.',
        };
      }

      const canonicalPath = handleRecord.canonicalPath;
      const selectedPath = handleRecord.selectedPath;

      return this.runWithFileLock(canonicalPath, async () => {
        const trackedCanonicalVersion =
          this.canonicalVersionByPath.get(canonicalPath);
        if (
          handleRecord.versionToken !== request.expectedVersionToken ||
          (trackedCanonicalVersion !== undefined &&
            trackedCanonicalVersion !== request.expectedVersionToken)
        ) {
          return {
            status: 'conflict',
            message:
              'The file on disk was modified or removed externally since it was last loaded or saved.',
          };
        }

        const writeOutcome = await this.writeBufferAtomically({
          targetPath: canonicalPath,
          selectedPath,
          buffer: utf8Buffer,
          expectedState: {
            kind: 'version',
            versionToken: request.expectedVersionToken,
          },
        });

        if (writeOutcome.status !== 'ok') {
          return writeOutcome.result;
        }

        const updatedRef = this.registerOrUpdateHandle(
          selectedPath,
          canonicalPath,
          writeOutcome.versionToken,
          handleRecord.handleId,
        );

        return {
          status: 'saved',
          file: updatedRef,
        };
      });
    }

    const safeDefaultName = sanitizeSuggestedFileName(
      request.suggestedName,
      'sketchdraw',
    );

    let saveSelection: SaveDialogSelection;
    try {
      saveSelection = await this.dialogs.showSaveDialog({
        title: 'Sketchdraw-Dokument speichern unter',
        defaultPath: safeDefaultName,
        filters: getDialogFiltersForFormat('sketchdraw'),
      });
    } catch {
      return {
        status: 'error',
        code: 'DIALOG_ERROR',
        message: 'Failed to open the native save dialog.',
      };
    }

    if (
      saveSelection.canceled ||
      typeof saveSelection.filePath !== 'string' ||
      saveSelection.filePath.trim().length === 0
    ) {
      return { status: 'cancelled' };
    }

    const selectedPath = path.resolve(saveSelection.filePath);
    let canonicalPath: string;
    try {
      canonicalPath = await this.resolveCanonicalTargetPath(selectedPath);
    } catch (error) {
      return mapFsErrorToSafeFileError(
        error,
        'Failed to resolve the selected save target path.',
      );
    }

    const dialogBaseline = await this.readDiskVersionToken(canonicalPath);
    if (dialogBaseline.status === 'error') {
      return dialogBaseline.error;
    }
    const expectedState: ExpectedTargetState =
      dialogBaseline.status === 'ok'
        ? { kind: 'version', versionToken: dialogBaseline.versionToken }
        : { kind: 'missing' };

    return this.runWithFileLock(canonicalPath, async () => {
      const writeOutcome = await this.writeBufferAtomically({
        targetPath: canonicalPath,
        selectedPath,
        buffer: utf8Buffer,
        expectedState,
      });

      if (writeOutcome.status !== 'ok') {
        return writeOutcome.result;
      }

      const fileRef = this.registerOrUpdateHandle(
        selectedPath,
        canonicalPath,
        writeOutcome.versionToken,
      );

      return {
        status: 'saved',
        file: fileRef,
      };
    });
  }

  public async exportFile(rawRequest: unknown): Promise<ExportFileResult> {
    const validated = validateExportFileRequest(rawRequest);
    if (!validated.ok) {
      return validated.error;
    }

    const { contents, suggestedName, format } = validated.value;
    const maxBytes = format === 'sketchdraw' ? this.maxDocumentBytes : this.maxExportBytes;
    const utf8Buffer = Buffer.from(contents, 'utf8');

    if (utf8Buffer.byteLength === 0) {
      return {
        status: 'error',
        code: 'EMPTY_EXPORT',
        message: 'Export contents must not be empty.',
      };
    }

    if (utf8Buffer.byteLength > maxBytes) {
      return {
        status: 'error',
        code: 'EXPORT_TOO_LARGE',
        message: `Export contents exceed the maximum allowed size of ${maxBytes} bytes.`,
      };
    }

    if (format === 'sketchdraw') {
      const validationError = this.validateDocumentString(contents);
      if (validationError) {
        return validationError;
      }
    }

    const safeDefaultName = sanitizeSuggestedFileName(suggestedName, format);

    let saveSelection: SaveDialogSelection;
    try {
      saveSelection = await this.dialogs.showSaveDialog({
        title: 'Diagramm exportieren',
        defaultPath: safeDefaultName,
        filters: getDialogFiltersForFormat(format),
      });
    } catch {
      return {
        status: 'error',
        code: 'DIALOG_ERROR',
        message: 'Failed to open the native export dialog.',
      };
    }

    if (
      saveSelection.canceled ||
      typeof saveSelection.filePath !== 'string' ||
      saveSelection.filePath.trim().length === 0
    ) {
      return { status: 'cancelled' };
    }

    const selectedPath = path.resolve(saveSelection.filePath);
    let canonicalPath: string;
    try {
      canonicalPath = await this.resolveCanonicalTargetPath(selectedPath);
    } catch (error) {
      return mapFsErrorToSafeFileError(
        error,
        'Failed to resolve the selected export target path.',
      );
    }

    const dialogBaseline = await this.readDiskVersionToken(canonicalPath);
    if (dialogBaseline.status === 'error') {
      return dialogBaseline.error;
    }
    const expectedState: ExpectedTargetState =
      dialogBaseline.status === 'ok'
        ? { kind: 'version', versionToken: dialogBaseline.versionToken }
        : { kind: 'missing' };

    return this.runWithFileLock(canonicalPath, async () => {
      const writeOutcome = await this.writeBufferAtomically({
        targetPath: canonicalPath,
        selectedPath,
        buffer: utf8Buffer,
        expectedState,
      });

      if (writeOutcome.status !== 'ok') {
        if (writeOutcome.result.status === 'conflict') {
          return {
            status: 'error',
            code: 'EXPORT_CONFLICT',
            message: writeOutcome.result.message,
          };
        }
        return writeOutcome.result;
      }

      this.syncCanonicalVersion(canonicalPath, writeOutcome.versionToken);

      return {
        status: 'exported',
        name: path.basename(selectedPath),
      };
    });
  }

  private async realpath(filePath: string): Promise<string> {
    const fn = this.fsAdapter.realpath ?? defaultFsAdapter.realpath!;
    return fn(filePath);
  }

  private async resolveCanonicalExistingPath(rawPath: string): Promise<string> {
    return this.realpath(path.resolve(rawPath));
  }

  private async resolveCanonicalTargetPath(rawPath: string): Promise<string> {
    const resolved = path.resolve(rawPath);
    try {
      return await this.realpath(resolved);
    } catch (error) {
      if (getErrnoCode(error) !== 'ENOENT') {
        throw error;
      }
      const parentDir = path.dirname(resolved);
      const realParent = await this.realpath(parentDir);
      return path.join(realParent, path.basename(resolved));
    }
  }

  private validateDocumentString(text: string): FileError | null {
    if (typeof this.validateDocumentFn !== 'function') {
      return {
        status: 'error',
        code: 'DOMAIN_VALIDATOR_UNAVAILABLE',
        message: 'Domain validation module is unavailable.',
      };
    }

    try {
      this.validateDocumentFn(text);
      return null;
    } catch (error) {
      if (
        error instanceof DomainValidationError &&
        Array.isArray(error.issues) &&
        error.issues.length > 0
      ) {
        const firstIssue = error.issues[0]!;
        const detail = `${firstIssue.path || '<root>'}: ${firstIssue.message} (${firstIssue.code})`;
        return {
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: redactFilesystemPaths(
            `Document validation failed: ${detail}`,
          ),
        };
      }

      const rawMessage =
        error instanceof Error
          ? error.message
          : 'Document failed schema validation.';
      return {
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: redactFilesystemPaths(
          `Document validation failed: ${rawMessage}`,
        ),
      };
    }
  }

  private syncCanonicalVersion(
    canonicalPath: string,
    versionToken: string,
  ): void {
    this.canonicalVersionByPath.set(canonicalPath, versionToken);
    for (const record of this.handlesById.values()) {
      if (record.canonicalPath === canonicalPath) {
        record.versionToken = versionToken;
      }
    }
  }

  private registerOrUpdateHandle(
    selectedPath: string,
    canonicalPath: string,
    versionToken: string,
    preferredHandleId?: string,
  ): FileReference {
    const existingHandleId =
      preferredHandleId ?? this.handleIdBySelectedPath.get(selectedPath);
    const handleId =
      existingHandleId ?? `hdl_${crypto.randomBytes(16).toString('hex')}`;

    const record: HandleRecord = {
      handleId,
      selectedPath,
      canonicalPath,
      versionToken,
    };

    this.handlesById.set(handleId, record);
    this.handleIdBySelectedPath.set(selectedPath, handleId);
    this.syncCanonicalVersion(canonicalPath, versionToken);

    return {
      handleId,
      name: path.basename(selectedPath),
      versionToken,
    };
  }

  private async readDiskVersionToken(
    targetPath: string,
  ): Promise<
    | { status: 'ok'; versionToken: string }
    | { status: 'missing' }
    | { status: 'error'; error: FileError }
  > {
    try {
      const stat = await this.fsAdapter.stat(targetPath);
      if (!stat.isFile()) {
        return {
          status: 'error',
          error: {
            status: 'error',
            code: 'IS_DIRECTORY',
            message: 'The target path is not a regular file.',
          },
        };
      }
      if (stat.size > this.maxDocumentBytes) {
        return { status: 'ok', versionToken: `oversized:${stat.size}` };
      }
      const bytes = await this.fsAdapter.readFile(targetPath);
      return { status: 'ok', versionToken: computeVersionToken(bytes) };
    } catch (error) {
      if (getErrnoCode(error) === 'ENOENT') {
        return { status: 'missing' };
      }
      return {
        status: 'error',
        error: mapFsErrorToSafeFileError(
          error,
          'Failed to inspect current file version on disk.',
        ),
      };
    }
  }

  private async verifyTargetState(
    targetPath: string,
    selectedPath: string,
    expectedState: ExpectedTargetState,
    phase: 'initial' | 'pre-rename',
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        result: { status: 'conflict'; message: string } | FileError;
      }
  > {
    let currentCanonicalPath: string;
    try {
      currentCanonicalPath =
        expectedState.kind === 'version'
          ? await this.resolveCanonicalExistingPath(selectedPath)
          : await this.resolveCanonicalTargetPath(selectedPath);
    } catch (error) {
      if (getErrnoCode(error) === 'ENOENT') {
        return {
          ok: false,
          result: {
            status: 'conflict',
            message:
              'The target file or its parent path was removed or retargeted externally.',
          },
        };
      }
      return {
        ok: false,
        result: mapFsErrorToSafeFileError(
          error,
          'Failed to verify canonical target path on disk.',
        ),
      };
    }

    if (currentCanonicalPath !== targetPath) {
      return {
        ok: false,
        result: {
          status: 'conflict',
          message:
            'The target path alias or symlink was retargeted externally before the write completed.',
        },
      };
    }

    const diskCheck = await this.readDiskVersionToken(targetPath);
    if (diskCheck.status === 'error') {
      return { ok: false, result: diskCheck.error };
    }

    if (expectedState.kind === 'missing') {
      if (diskCheck.status !== 'missing') {
        return {
          ok: false,
          result: {
            status: 'conflict',
            message:
              'A file was created externally at the selected target path while preparing the atomic write.',
          },
        };
      }
      return { ok: true };
    }

    if (
      diskCheck.status === 'missing' ||
      diskCheck.versionToken !== expectedState.versionToken
    ) {
      return {
        ok: false,
        result: {
          status: 'conflict',
          message:
            phase === 'initial'
              ? 'The file on disk was modified or removed externally since it was last loaded or saved.'
              : 'The file on disk was modified externally while preparing the atomic save.',
        },
      };
    }

    return { ok: true };
  }

  private async writeBufferAtomically(options: {
    targetPath: string;
    selectedPath: string;
    buffer: Buffer;
    expectedState: ExpectedTargetState;
  }): Promise<
    | { status: 'ok'; versionToken: string }
    | {
        status: 'failed';
        result: { status: 'conflict'; message: string } | FileError;
      }
  > {
    const { targetPath, selectedPath, buffer, expectedState } = options;

    const initialVerification = await this.verifyTargetState(
      targetPath,
      selectedPath,
      expectedState,
      'initial',
    );
    if (!initialVerification.ok) {
      return { status: 'failed', result: initialVerification.result };
    }

    const targetDir = path.dirname(targetPath);
    const targetBase = path.basename(targetPath);
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const tempPath = path.join(targetDir, `.${targetBase}.${randomSuffix}.tmp`);

    let fileHandle: FileHandleLike | null = null;
    let fileClosed = false;
    let tempCreated = false;
    let renamed = false;

    try {
      fileHandle = await this.fsAdapter.open(tempPath, 'wx', 0o600);
      tempCreated = true;

      await fileHandle.writeFile(buffer);
      await fileHandle.sync();
      await fileHandle.close();
      fileClosed = true;

      if (this.onBeforePreRenameCheck) {
        await this.onBeforePreRenameCheck(targetPath, tempPath);
      }

      const preRenameVerification = await this.verifyTargetState(
        targetPath,
        selectedPath,
        expectedState,
        'pre-rename',
      );
      if (!preRenameVerification.ok) {
        return { status: 'failed', result: preRenameVerification.result };
      }

      await this.fsAdapter.rename(tempPath, targetPath);
      renamed = true;

      return {
        status: 'ok',
        versionToken: computeVersionToken(buffer),
      };
    } catch (error) {
      return {
        status: 'failed',
        result: mapFsErrorToSafeFileError(
          error,
          'Failed to write file atomically to disk.',
        ),
      };
    } finally {
      if (fileHandle && !fileClosed) {
        try {
          await fileHandle.close();
        } catch {
          // Ignore secondary close errors during cleanup
        }
      }
      if (tempCreated && !renamed) {
        try {
          await this.fsAdapter.unlink(tempPath);
        } catch {
          // Ignore unlink errors if the file was already removed
        }
      }
    }
  }

  private async runWithFileLock<T>(
    canonicalPath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.fileLocks.get(canonicalPath) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const chained = previous.then(() => currentGate);
    this.fileLocks.set(canonicalPath, chained);

    await previous;
    try {
      return await operation();
    } finally {
      releaseLock();
      if (this.fileLocks.get(canonicalPath) === chained) {
        this.fileLocks.delete(canonicalPath);
      }
    }
  }
}

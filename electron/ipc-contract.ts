import type {
  FileError,
  SaveDocumentRequest,
} from '../src/domain/types';

export const IPC_CHANNELS = Object.freeze({
  OPEN_DOCUMENT: 'sketchdraw:persistence:open-document',
  SAVE_DOCUMENT: 'sketchdraw:persistence:save-document',
  EXPORT_FILE: 'sketchdraw:persistence:export-file',
  OPEN_EXTERNAL: 'sketchdraw:shell:open-external',
  CLOSE_REQUESTED: 'sketchdraw:window:close-requested',
  RESPOND_TO_CLOSE: 'sketchdraw:window:respond-to-close',
  MENU_COMMAND: 'sketchdraw:menu:command',
  PLUGIN_INVOKE: 'sketchdraw:plugins:invoke',
  PLUGIN_EVENT: 'sketchdraw:plugins:event',
  SET_LANGUAGE: 'sketchdraw:app:set-language',
} as const);

export type MenuCommand = 'open' | 'save' | 'save-as' | 'undo' | 'redo';
export type ExportFormat = 'svg' | 'drawio' | 'sketchdraw';
export type CloseDecision = 'close' | 'cancel';
export type AppLanguage = 'de' | 'en';

export const MENU_COMMANDS: readonly MenuCommand[] = Object.freeze([
  'open',
  'save',
  'save-as',
  'undo',
  'redo',
]);

export const EXPORT_FORMATS: readonly ExportFormat[] = Object.freeze([
  'svg',
  'drawio',
  'sketchdraw',
]);

export const CLOSE_DECISIONS: readonly CloseDecision[] = Object.freeze([
  'close',
  'cancel',
]);

export const APP_LANGUAGES: readonly AppLanguage[] = Object.freeze(['de', 'en']);

export const HANDLE_ID_PATTERN = /^hdl_[0-9a-f]{32}$/;
export const VERSION_TOKEN_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const CLOSE_REQUEST_ID_PATTERN = /^close_[0-9a-f]{32}$/;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAVE_AS_ALLOWED_KEYS = new Set(['mode', 'text', 'suggestedName']);
const SAVE_ALLOWED_KEYS = new Set([
  'mode',
  'text',
  'suggestedName',
  'handleId',
  'expectedVersionToken',
]);
const EXPORT_ALLOWED_KEYS = new Set(['contents', 'suggestedName', 'format']);
const OPEN_EXTERNAL_ALLOWED_KEYS = new Set(['url', 'userInitiated']);
const RESPOND_TO_CLOSE_ALLOWED_KEYS = new Set(['requestId', 'decision']);

export interface ExportFileIpcPayload {
  contents: string;
  suggestedName: string;
  format: ExportFormat;
}

export interface OpenExternalIpcPayload {
  url: string;
  userInitiated: boolean;
}

export interface RespondToCloseIpcPayload {
  requestId: string;
  decision: CloseDecision;
}

export type ValidationOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: FileError };

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return false;
    }
  }
  return true;
}

function hasOnlyAllowedKeys(
  record: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(record);
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }
  return true;
}

export function isMenuCommand(value: unknown): value is MenuCommand {
  return (
    typeof value === 'string' &&
    (MENU_COMMANDS as readonly string[]).includes(value)
  );
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return (
    typeof value === 'string' &&
    (EXPORT_FORMATS as readonly string[]).includes(value)
  );
}

export function isCloseDecision(value: unknown): value is CloseDecision {
  return (
    typeof value === 'string' &&
    (CLOSE_DECISIONS as readonly string[]).includes(value)
  );
}

export function isValidOpaqueHandleId(value: unknown): value is string {
  return typeof value === 'string' && HANDLE_ID_PATTERN.test(value);
}

export function isValidVersionToken(value: unknown): value is string {
  return typeof value === 'string' && VERSION_TOKEN_PATTERN.test(value);
}

export function isValidCloseRequestId(value: unknown): value is string {
  return typeof value === 'string' && CLOSE_REQUEST_ID_PATTERN.test(value);
}

export function validateSaveDocumentRequest(
  input: unknown,
): ValidationOutcome<SaveDocumentRequest> {
  if (!isPlainRecord(input)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Save request must be a plain object.',
      },
    };
  }

  const mode = input['mode'];
  if (mode !== 'save-as' && mode !== 'save') {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Save request mode must be "save" or "save-as".',
      },
    };
  }

  const allowedKeys =
    mode === 'save-as' ? SAVE_AS_ALLOWED_KEYS : SAVE_ALLOWED_KEYS;
  if (!hasOnlyAllowedKeys(input, allowedKeys)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Save request contains unsupported or forbidden properties.',
      },
    };
  }

  const text = input['text'];
  if (typeof text !== 'string') {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Save request text must be a string.',
      },
    };
  }

  const suggestedName = input['suggestedName'];
  if (
    typeof suggestedName !== 'string' ||
    suggestedName.trim().length === 0 ||
    suggestedName.length > 512 ||
    suggestedName.includes('\0')
  ) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Save request suggestedName must be a non-empty string.',
      },
    };
  }

  if (mode === 'save-as') {
    return {
      ok: true,
      value: {
        mode: 'save-as',
        text,
        suggestedName,
      },
    };
  }

  const handleId = input['handleId'];
  if (!isValidOpaqueHandleId(handleId)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_HANDLE',
        message: 'Save request requires a valid opaque handleId issued by Main.',
      },
    };
  }

  const expectedVersionToken = input['expectedVersionToken'];
  if (!isValidVersionToken(expectedVersionToken)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_VERSION_TOKEN',
        message: 'Save request requires a valid content-hash expectedVersionToken.',
      },
    };
  }

  return {
    ok: true,
    value: {
      mode: 'save',
      text,
      suggestedName,
      handleId,
      expectedVersionToken,
    },
  };
}

export function validateExportFileRequest(
  input: unknown,
): ValidationOutcome<ExportFileIpcPayload> {
  if (!isPlainRecord(input) || !hasOnlyAllowedKeys(input, EXPORT_ALLOWED_KEYS)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Export request must be a plain object with contents, suggestedName, and format.',
      },
    };
  }

  const contents = input['contents'];
  if (typeof contents !== 'string') {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Export contents must be a string.',
      },
    };
  }

  const suggestedName = input['suggestedName'];
  if (
    typeof suggestedName !== 'string' ||
    suggestedName.trim().length === 0 ||
    suggestedName.length > 512 ||
    suggestedName.includes('\0')
  ) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_REQUEST',
        message: 'Export suggestedName must be a non-empty string.',
      },
    };
  }

  const format = input['format'];
  if (!isExportFormat(format)) {
    return {
      ok: false,
      error: {
        status: 'error',
        code: 'INVALID_FORMAT',
        message: 'Export format must be one of "svg", "drawio", or "sketchdraw".',
      },
    };
  }

  return {
    ok: true,
    value: {
      contents,
      suggestedName,
      format,
    },
  };
}

/** The renderer reports its UI language so native menus and dialogs follow it. Only the two known codes are accepted. */
export function validateSetLanguageRequest(input: unknown): AppLanguage {
  if (!isPlainRecord(input) || !hasOnlyAllowedKeys(input, new Set(['language']))) {
    throw new Error('Invalid setLanguage payload.');
  }
  const language = input['language'];
  if (typeof language !== 'string' || !(APP_LANGUAGES as readonly string[]).includes(language)) {
    throw new Error('Unsupported language.');
  }
  return language as AppLanguage;
}

export function validateOpenExternalRequest(
  input: unknown,
): OpenExternalIpcPayload {
  if (
    !isPlainRecord(input) ||
    !hasOnlyAllowedKeys(input, OPEN_EXTERNAL_ALLOWED_KEYS)
  ) {
    throw new Error('Invalid openExternal payload.');
  }

  const url = input['url'];
  const userInitiated = input['userInitiated'];

  if (typeof url !== 'string' || typeof userInitiated !== 'boolean') {
    throw new Error('Invalid openExternal payload types.');
  }

  return { url, userInitiated };
}

export function validateRespondToCloseRequest(
  input: unknown,
): RespondToCloseIpcPayload {
  if (
    !isPlainRecord(input) ||
    !hasOnlyAllowedKeys(input, RESPOND_TO_CLOSE_ALLOWED_KEYS)
  ) {
    throw new Error('Invalid respondToClose payload.');
  }

  const requestId = input['requestId'];
  const decision = input['decision'];

  if (!isValidCloseRequestId(requestId)) {
    throw new Error('Invalid close requestId format.');
  }

  if (!isCloseDecision(decision)) {
    throw new Error('Close decision must be "close" or "cancel".');
  }

  return { requestId, decision };
}

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

export function validateExternalHttpUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string') {
    throw new Error('External URL must be a string.');
  }

  const trimmed = rawUrl.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 2048 ||
    CONTROL_CHAR_PATTERN.test(trimmed)
  ) {
    throw new Error(
      'External URL is empty, too long, or contains control characters.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('External URL is not a valid absolute URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(
      `Unsupported external URL protocol "${parsed.protocol}". Only http: and https: are allowed.`,
    );
  }

  if (!parsed.hostname || parsed.hostname.trim().length === 0) {
    throw new Error('External URL must include a valid hostname.');
  }

  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('External URL must not include embedded credentials.');
  }

  return parsed;
}

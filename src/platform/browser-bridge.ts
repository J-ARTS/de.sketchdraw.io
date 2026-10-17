import {
  deserializeDocument,
  DOMAIN_LIMITS,
  DomainValidationError,
} from '../domain/index';
import { INTEROP_LIMITS } from '../interop/limits';
import type {
  DesktopBridge,
  ExportFileResult,
  FileError,
  OpenDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
  SketchDocument,
} from '../domain/types';

export type BrowserExportFormat = 'svg' | 'drawio' | 'sketchdraw';
export type BrowserCloseDecision = 'close' | 'cancel';
export type BrowserMenuCommand = 'open' | 'save' | 'save-as' | 'undo' | 'redo';

const DEFAULT_MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
const DEFAULT_REVOKE_OBJECT_URL_DELAY_MS = 60_000;
const USER_GESTURE_WINDOW_MS = 2_500;
const MAX_FILENAME_LENGTH = 200;

const HANDLE_ID_PATTERN = /^(?:b?hdl)_[0-9a-f]{32}$/;
const VERSION_TOKEN_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const RESERVED_FILENAME_CHAR_PATTERN = /[\u0000-\u001F\u007F<>:"/\\|?*]+/g;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SAVE_AS_KEYS = new Set(['mode', 'text', 'suggestedName']);
const SAVE_KEYS = new Set([
  'mode',
  'text',
  'suggestedName',
  'handleId',
  'expectedVersionToken',
]);
const ALLOWED_EXPORT_FORMATS = new Set<BrowserExportFormat>([
  'svg',
  'drawio',
  'sketchdraw',
]);

// SHA-256 constants for deterministic fallback when crypto.subtle is unavailable
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256HexSync(data: Uint8Array): string {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const bitLenHi = Math.floor((data.byteLength * 8) / 0x100000000);
  const bitLenLo = (data.byteLength * 8) >>> 0;
  const paddedLength = Math.ceil((data.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.byteLength] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, bitLenHi, false);
  view.setUint32(paddedLength - 4, bitLenLo, false);

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeBrowserVersionToken(
  content: string | Uint8Array,
): Promise<string> {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;

  if (
    typeof globalThis.crypto !== 'undefined' &&
    globalThis.crypto?.subtle &&
    typeof globalThis.crypto.subtle.digest === 'function'
  ) {
    try {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        copy.buffer,
      );
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `sha256:${hex}`;
    } catch {
      // Fallback to synchronous SHA-256 implementation
    }
  }

  return `sha256:${sha256HexSync(bytes)}`;
}

export function generateBrowserHandleId(): string {
  const randomBytes = new Uint8Array(16);
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    globalThis.crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i += 1) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `hdl_${hex}`;
}

export function sanitizeDownloadFileName(
  suggestedName: string,
  format: BrowserExportFormat = 'sketchdraw',
): string {
  const requiredExt = `.${format}`;
  const segments = suggestedName
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  const rawBase = segments.length > 0 ? segments[segments.length - 1]! : '';
  const cleaned = rawBase
    .replace(RESERVED_FILENAME_CHAR_PATTERN, '_')
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

export function sanitizeOpenedFileName(rawName: string): string {
  const segments = rawName
    .split(/[/\\]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  const rawBase = segments.length > 0 ? segments[segments.length - 1]! : '';
  const cleaned = rawBase
    .replace(RESERVED_FILENAME_CHAR_PATTERN, '_')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') {
    return 'untitled.sketchdraw';
  }
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
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
  allowed: ReadonlySet<string>,
): boolean {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return false;
    }
  }
  return true;
}

function getMimeTypeForFormat(format: BrowserExportFormat): string {
  switch (format) {
    case 'svg':
      return 'image/svg+xml;charset=utf-8';
    case 'drawio':
      return 'application/xml;charset=utf-8';
    case 'sketchdraw':
      return 'application/json;charset=utf-8';
  }
}

let lastBrowserTrustedGestureAt = -Infinity;
let gestureListenersInstalled = false;

function ensureBrowserGestureTracking(): void {
  if (
    gestureListenersInstalled ||
    typeof window === 'undefined' ||
    typeof window.addEventListener !== 'function'
  ) {
    return;
  }
  gestureListenersInstalled = true;

  const onEvent = (event: Event): void => {
    if (event.isTrusted) {
      lastBrowserTrustedGestureAt = Date.now();
    }
  };

  for (const eventName of [
    'pointerdown',
    'pointerup',
    'click',
    'auxclick',
    'keydown',
  ] as const) {
    window.addEventListener(eventName, onEvent, {
      capture: true,
      passive: true,
    });
  }
}

export function hasActiveBrowserUserGesture(now = Date.now()): boolean {
  if (
    typeof navigator !== 'undefined' &&
    'userActivation' in navigator &&
    navigator.userActivation?.isActive === true
  ) {
    return true;
  }
  return now - lastBrowserTrustedGestureAt <= USER_GESTURE_WINDOW_MS;
}

export interface BrowserFileInputLike {
  type: string;
  accept: string;
  style: { display: string };
  files: ArrayLike<{ name: string; size: number; text(): Promise<string> }> | null;
  addEventListener(
    type: 'change' | 'cancel',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: 'change' | 'cancel', listener: () => void): void;
  click(): void;
  remove(): void;
}

export interface BrowserAnchorLike {
  href: string;
  download: string;
  rel: string;
  style: { display: string };
  click(): void;
  remove(): void;
}

export interface BrowserDomAdapter {
  createFileInput(): BrowserFileInputLike;
  createDownloadAnchor(): BrowserAnchorLike;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  openWindow(url: string, target: string, features: string): void;
  scheduleRevoke(callback: () => void, delayMs: number): void;
}

export interface BrowserDesktopBridgeOptions {
  dom?: Partial<BrowserDomAdapter>;
  validateDocumentText?: (text: string) => SketchDocument;
  maxDocumentBytes?: number;
  maxExportBytes?: number;
  revokeDelayMs?: number;
  isUserGestureActive?: () => boolean;
}

function createDefaultDomAdapter(): BrowserDomAdapter {
  return {
    createFileInput(): BrowserFileInputLike {
      if (typeof document === 'undefined') {
        throw new Error('DOM document is not available in this environment.');
      }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.sketchdraw,.json,application/json';
      input.style.display = 'none';
      (document.body ?? document.documentElement)?.appendChild(input);
      return input;
    },
    createDownloadAnchor(): BrowserAnchorLike {
      if (typeof document === 'undefined') {
        throw new Error('DOM document is not available in this environment.');
      }
      const anchor = document.createElement('a');
      anchor.style.display = 'none';
      (document.body ?? document.documentElement)?.appendChild(anchor);
      return anchor;
    },
    createObjectUrl(blob: Blob): string {
      return URL.createObjectURL(blob);
    },
    revokeObjectUrl(url: string): void {
      URL.revokeObjectURL(url);
    },
    openWindow(url: string, target: string, features: string): void {
      if (typeof window === 'undefined' || typeof window.open !== 'function') {
        throw new Error('window.open is not available in this environment.');
      }
      window.open(url, target, features);
    },
    scheduleRevoke(callback: () => void, delayMs: number): void {
      const timer = setTimeout(callback, delayMs) as unknown as {
        unref?: () => void;
      };
      if (typeof timer === 'object' && timer !== null && typeof timer.unref === 'function') {
        timer.unref();
      }
    },
  };
}

export function createBrowserDesktopBridge(
  options: BrowserDesktopBridgeOptions = {},
): DesktopBridge {
  ensureBrowserGestureTracking();

  const defaults = createDefaultDomAdapter();
  const dom: BrowserDomAdapter = {
    ...defaults,
    ...options.dom,
  };

  const validateDocumentFn =
    options.validateDocumentText ?? deserializeDocument;
  const maxDocumentBytes =
    options.maxDocumentBytes ??
    DOMAIN_LIMITS?.['MAX_DOCUMENT_JSON_BYTES'] ??
    DEFAULT_MAX_DOCUMENT_BYTES;
  const revokeDelayMs =
    options.revokeDelayMs ?? DEFAULT_REVOKE_OBJECT_URL_DELAY_MS;
  const maxExportBytes = options.maxExportBytes ?? INTEROP_LIMITS.MAX_EXPORT_BYTES;
  const checkUserGesture =
    options.isUserGestureActive ?? (() => hasActiveBrowserUserGesture());

  function validateSketchDocumentText(text: string): FileError | null {
    if (typeof validateDocumentFn !== 'function') {
      return {
        status: 'error',
        code: 'DOMAIN_VALIDATOR_UNAVAILABLE',
        message: 'Domain validation module is unavailable.',
      };
    }

    try {
      validateDocumentFn(text);
      return null;
    } catch (error) {
      if (
        error instanceof DomainValidationError &&
        Array.isArray(error.issues) &&
        error.issues.length > 0
      ) {
        const first = error.issues[0]!;
        return {
          status: 'error',
          code: 'VALIDATION_ERROR',
          message: `Document validation failed at ${first.path || '<root>'}: ${first.message} (${first.code})`,
        };
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Document failed schema validation.';
      return {
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: `Document validation failed: ${message}`,
      };
    }
  }

  function triggerBlobDownload(
    contents: string,
    safeFileName: string,
    mimeType: string,
  ): { ok: true } | { ok: false; error: FileError } {
    let objectUrl: string | null = null;
    let anchor: BrowserAnchorLike | null = null;
    let revokeScheduled = false;

    try {
      const blob = new Blob([contents], { type: mimeType });
      objectUrl = dom.createObjectUrl(blob);
      anchor = dom.createDownloadAnchor();
      anchor.href = objectUrl;
      anchor.download = safeFileName;
      anchor.rel = 'noopener';
      anchor.click();

      const urlToRevoke = objectUrl;
      dom.scheduleRevoke(() => {
        try {
          dom.revokeObjectUrl(urlToRevoke);
        } catch {
          // Ignore revoke errors after download completes
        }
      }, revokeDelayMs);
      revokeScheduled = true;

      return { ok: true };
    } catch {
      if (objectUrl !== null && !revokeScheduled) {
        try {
          dom.revokeObjectUrl(objectUrl);
        } catch {
          // Ignore secondary cleanup error
        }
      }
      return {
        ok: false,
        error: {
          status: 'error',
          code: 'DOWNLOAD_FAILED',
          message: 'Failed to initiate browser file download.',
        },
      };
    } finally {
      if (anchor) {
        try {
          anchor.remove();
        } catch {
          // Ignore DOM removal errors
        }
      }
    }
  }

  const bridge: DesktopBridge = {
    platform: 'browser',

    async openDocument(): Promise<OpenDocumentResult> {
      let input: BrowserFileInputLike;
      try {
        input = dom.createFileInput();
      } catch {
        return {
          status: 'error',
          code: 'FILE_PICKER_UNAVAILABLE',
          message: 'Browser file input is not available.',
        };
      }

      return new Promise<OpenDocumentResult>((resolve) => {
        let settled = false;

        const cleanup = (): void => {
          input.removeEventListener('change', onChange);
          input.removeEventListener('cancel', onCancel);
          try {
            input.remove();
          } catch {
            // Ignore cleanup errors
          }
        };

        const finish = (result: OpenDocumentResult): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(result);
        };

        const onCancel = (): void => {
          finish({ status: 'cancelled' });
        };

        const onChange = (): void => {
          void (async () => {
            try {
              const files = input.files;
              const selected = files && files.length > 0 ? files[0] : undefined;
              if (!selected) {
                finish({ status: 'cancelled' });
                return;
              }

              if (selected.size > maxDocumentBytes) {
                finish({
                  status: 'error',
                  code: 'DOCUMENT_TOO_LARGE',
                  message: `Selected file exceeds the maximum allowed size of ${maxDocumentBytes} bytes.`,
                });
                return;
              }

              const text = await selected.text();
              const utf8Bytes = new TextEncoder().encode(text);
              if (utf8Bytes.byteLength > maxDocumentBytes) {
                finish({
                  status: 'error',
                  code: 'DOCUMENT_TOO_LARGE',
                  message: `Selected file exceeds the maximum allowed size of ${maxDocumentBytes} bytes.`,
                });
                return;
              }

              const validationError = validateSketchDocumentText(text);
              if (validationError) {
                finish(validationError);
                return;
              }

              const versionToken = await computeBrowserVersionToken(utf8Bytes);
              const handleId = generateBrowserHandleId();
              const safeName = sanitizeOpenedFileName(selected.name);

              finish({
                status: 'opened',
                text,
                file: {
                  handleId,
                  name: safeName,
                  versionToken,
                },
              });
            } catch {
              finish({
                status: 'error',
                code: 'FILE_READ_ERROR',
                message: 'Failed to read the selected file in the browser.',
              });
            }
          })();
        };

        input.addEventListener('change', onChange, { once: true });
        input.addEventListener('cancel', onCancel, { once: true });

        try {
          input.click();
        } catch {
          finish({
            status: 'error',
            code: 'FILE_PICKER_ERROR',
            message: 'Failed to open the browser file chooser.',
          });
        }
      });
    },

    async saveDocument(
      request: SaveDocumentRequest,
    ): Promise<SaveDocumentResult> {
      if (!isPlainRecord(request)) {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Save request must be a plain object.',
        };
      }

      const mode = request['mode'];
      if (mode !== 'save' && mode !== 'save-as') {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Save request mode must be "save" or "save-as".',
        };
      }

      const allowedKeys = mode === 'save-as' ? SAVE_AS_KEYS : SAVE_KEYS;
      if (!hasOnlyAllowedKeys(request, allowedKeys)) {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Save request contains unsupported or forbidden properties.',
        };
      }

      if (typeof request.text !== 'string') {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Save request text must be a string.',
        };
      }

      if (
        typeof request.suggestedName !== 'string' ||
        request.suggestedName.trim().length === 0 ||
        request.suggestedName.length > 512 ||
        request.suggestedName.includes('\0')
      ) {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Save request suggestedName must be a non-empty string.',
        };
      }

      if (mode === 'save') {
        if (
          typeof request.handleId !== 'string' ||
          !HANDLE_ID_PATTERN.test(request.handleId)
        ) {
          return {
            status: 'error',
            code: 'INVALID_HANDLE',
            message: 'Save request requires a valid opaque handleId.',
          };
        }

        if (
          typeof request.expectedVersionToken !== 'string' ||
          !VERSION_TOKEN_PATTERN.test(request.expectedVersionToken)
        ) {
          return {
            status: 'error',
            code: 'INVALID_VERSION_TOKEN',
            message: 'Save request requires a valid expectedVersionToken.',
          };
        }
      }

      const utf8Bytes = new TextEncoder().encode(request.text);
      if (utf8Bytes.byteLength > maxDocumentBytes) {
        return {
          status: 'error',
          code: 'DOCUMENT_TOO_LARGE',
          message: `Document exceeds the maximum allowed size of ${maxDocumentBytes} bytes.`,
        };
      }

      const validationError = validateSketchDocumentText(request.text);
      if (validationError) {
        return validationError;
      }

      const safeFileName = sanitizeDownloadFileName(
        request.suggestedName,
        'sketchdraw',
      );

      let objectUrl: string | null = null;
      let anchor: BrowserAnchorLike | null = null;
      let revokeScheduled = false;

      try {
        const blob = new Blob([request.text], {
          type: getMimeTypeForFormat('sketchdraw'),
        });
        objectUrl = dom.createObjectUrl(blob);
        anchor = dom.createDownloadAnchor();
        anchor.href = objectUrl;
        anchor.download = safeFileName;
        anchor.rel = 'noopener';
        anchor.click();

        const urlToRevoke = objectUrl;
        dom.scheduleRevoke(() => {
          try {
            dom.revokeObjectUrl(urlToRevoke);
          } catch {
            // Ignore revoke errors
          }
        }, revokeDelayMs);
        revokeScheduled = true;

        // Browser mode never claims direct disk persistence ('saved');
        // it always reports 'download-initiated'.
        return {
          status: 'download-initiated',
          name: safeFileName,
        };
      } catch {
        if (objectUrl !== null && !revokeScheduled) {
          try {
            dom.revokeObjectUrl(objectUrl);
          } catch {
            // Ignore cleanup errors
          }
        }
        return {
          status: 'error',
          code: 'DOWNLOAD_FAILED',
          message: 'Failed to initiate browser download.',
        };
      } finally {
        if (anchor) {
          try {
            anchor.remove();
          } catch {
            // Ignore removal errors
          }
        }
      }
    },

    async exportFile(
      contents: string,
      suggestedName: string,
      format: BrowserExportFormat,
    ): Promise<ExportFileResult> {
      if (typeof contents !== 'string') {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Export contents must be a string.',
        };
      }

      if (
        typeof suggestedName !== 'string' ||
        suggestedName.trim().length === 0 ||
        suggestedName.length > 512 ||
        suggestedName.includes('\0')
      ) {
        return {
          status: 'error',
          code: 'INVALID_REQUEST',
          message: 'Export suggestedName must be a non-empty string.',
        };
      }

      if (!ALLOWED_EXPORT_FORMATS.has(format)) {
        return {
          status: 'error',
          code: 'INVALID_FORMAT',
          message: 'Export format must be "svg", "drawio", or "sketchdraw".',
        };
      }

      const utf8Bytes = new TextEncoder().encode(contents);
      if (utf8Bytes.byteLength === 0) {
        return {
          status: 'error',
          code: 'EMPTY_EXPORT',
          message: 'Export contents must not be empty.',
        };
      }

      const maxBytes = format === 'sketchdraw' ? maxDocumentBytes : maxExportBytes;
      if (utf8Bytes.byteLength > maxBytes) {
        return {
          status: 'error',
          code: 'EXPORT_TOO_LARGE',
          message: `Export contents exceed the maximum allowed size of ${maxBytes} bytes.`,
        };
      }

      if (format === 'sketchdraw') {
        const validationError = validateSketchDocumentText(contents);
        if (validationError) {
          return validationError;
        }
      }

      const safeFileName = sanitizeDownloadFileName(suggestedName, format);
      const outcome = triggerBlobDownload(
        contents,
        safeFileName,
        getMimeTypeForFormat(format),
      );
      if (!('ok' in outcome) || !outcome.ok) {
        return {
          status: 'error',
          code: 'DOWNLOAD_FAILED',
          message: 'Failed to initiate browser export download.',
        };
      }

      return {
        status: 'download-initiated',
        name: safeFileName,
      };
    },

    async openExternal(url: string): Promise<void> {
      const validated = validateExternalHttpUrl(url);
      if (!checkUserGesture()) {
        throw new Error(
          'External links can only be opened directly from a human UI interaction.',
        );
      }
      dom.openWindow(validated.toString(), '_blank', 'noopener,noreferrer');
    },

    onCloseRequested(_listener: (requestId: string) => void): () => void {
      if (typeof _listener !== 'function') {
        throw new Error('onCloseRequested requires a listener function.');
      }
      // Browser close warnings are handled by the renderer via window 'beforeunload'.
      return () => {};
    },

    async respondToClose(
      requestId: string,
      decision: BrowserCloseDecision,
    ): Promise<void> {
      if (typeof requestId !== 'string' || requestId.trim().length === 0) {
        throw new Error('respondToClose requires a non-empty requestId.');
      }
      if (decision !== 'close' && decision !== 'cancel') {
        throw new Error('respondToClose decision must be "close" or "cancel".');
      }
    },

    onMenuCommand(_listener: (command: BrowserMenuCommand) => void): () => void {
      if (typeof _listener !== 'function') {
        throw new Error('onMenuCommand requires a listener function.');
      }
      return () => {};
    },
  };

  return Object.freeze(bridge);
}

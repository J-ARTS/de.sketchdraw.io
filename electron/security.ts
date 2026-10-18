import fs from 'node:fs/promises';
import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'sketchdraw';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

export const DEV_SERVER_HOST = '127.0.0.1';
export const DEV_SERVER_PORT = '5173';
export const DEV_SERVER_ORIGIN = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
export const DEV_SERVER_ENTRY_URL = `${DEV_SERVER_ORIGIN}/`;

export const WINDOW_DIMENSIONS = Object.freeze({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 640,
} as const);

export const PRIVILEGED_APP_SCHEME_CONFIG = Object.freeze({
  scheme: APP_SCHEME,
  privileges: Object.freeze({
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    bypassCSP: false,
    stream: true,
  }),
});

export interface RendererTarget {
  readonly mode: 'dev' | 'bundled';
  readonly entryUrl: string;
  readonly allowedOrigin: string;
}

export interface IpcSenderFrameLike {
  readonly url: string;
  readonly routingId: number;
  readonly parent: unknown | null;
}

export interface IpcSenderWebContentsLike {
  readonly id: number;
  isDestroyed(): boolean;
  getURL?(): string;
}

export interface IpcSenderEventLike {
  readonly sender: IpcSenderWebContentsLike | null | undefined;
  readonly senderFrame: IpcSenderFrameLike | null | undefined;
}

export interface IpcSecurityContext {
  readonly windowWebContentsId: number | null;
  readonly mainFrameRoutingId: number | null;
  readonly isWindowDestroyed: boolean;
  readonly allowedOrigin: string;
}

export type SenderValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export type AppProtocolResolution =
  | { ok: true; filePath: string; mimeType: string }
  | { ok: false; status: 400 | 403 | 404 | 405; reason: string };

const SAFE_MIME_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
});

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
const ENCODED_SLASH_OR_NULL_PATTERN = /%(?:2f|5c|00)/i;

export function buildContentSecurityPolicy(mode: 'dev' | 'bundled'): string {
  const connectSrc =
    mode === 'dev'
      ? "'self' ws://127.0.0.1:5173 http://127.0.0.1:5173"
      : "'self'";

  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-src https: http:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** True only for resources owned by the trusted renderer, never for remote iframe responses. */
export function isTrustedRendererResourceUrl(rawUrl: string, target: RendererTarget): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (target.mode === 'dev') return parsed.origin === DEV_SERVER_ORIGIN;
    return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname === APP_HOST &&
      parsed.username === '' && parsed.password === '' && parsed.port === '';
  } catch {
    return false;
  }
}

export function resolveRendererTarget(options: {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}): RendererTarget {
  const rawDevUrl = options.env['SKETCHDRAW_DEV_SERVER_URL'];

  if (!options.isPackaged && typeof rawDevUrl === 'string' && rawDevUrl.trim().length > 0) {
    let parsed: URL;
    try {
      parsed = new URL(rawDevUrl);
    } catch {
      throw new Error(
        'Invalid SKETCHDRAW_DEV_SERVER_URL: failed to parse URL.',
      );
    }

    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== DEV_SERVER_HOST ||
      parsed.port !== DEV_SERVER_PORT ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new Error(
        `Rejected untrusted SKETCHDRAW_DEV_SERVER_URL: only ${DEV_SERVER_ORIGIN} is allowed in unpacked development mode.`,
      );
    }

    return {
      mode: 'dev',
      entryUrl: DEV_SERVER_ENTRY_URL,
      allowedOrigin: DEV_SERVER_ORIGIN,
    };
  }

  return {
    mode: 'bundled',
    entryUrl: APP_ENTRY_URL,
    allowedOrigin: APP_ORIGIN,
  };
}

function matchesAllowedOrigin(
  parsed: URL,
  rawUrl: string,
  allowedOrigin: string,
): boolean {
  if (typeof allowedOrigin !== 'string' || allowedOrigin.length === 0) {
    return false;
  }

  let expected: URL;
  try {
    expected = new URL(allowedOrigin);
  } catch {
    return false;
  }

  // Node's WHATWG URL parser returns origin === 'null' for custom schemes like app://sketchdraw.
  // Only allow either the privileged app://sketchdraw authority or a standard tuple origin.
  const isTrustedCustomAppOrigin =
    expected.protocol === `${APP_SCHEME}:` &&
    expected.hostname === APP_HOST &&
    expected.port === '' &&
    expected.host === APP_HOST;
  const isStandardTupleOrigin =
    expected.origin !== 'null' && expected.hostname.length > 0;

  if (!isTrustedCustomAppOrigin && !isStandardTupleOrigin) {
    return false;
  }

  if (
    expected.username !== '' ||
    expected.password !== '' ||
    (expected.pathname !== '' && expected.pathname !== '/') ||
    expected.search !== '' ||
    expected.hash !== ''
  ) {
    return false;
  }

  if (
    parsed.protocol !== expected.protocol ||
    parsed.hostname !== expected.hostname ||
    parsed.port !== expected.port ||
    parsed.host !== expected.host ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return false;
  }

  if (isStandardTupleOrigin && parsed.origin !== expected.origin) {
    return false;
  }

  // Enforce explicit "<scheme>//<host>" authority in the raw URL string to reject
  // empty credential/port syntax tricks such as "app://sketchdraw@/index.html" or "app://sketchdraw:/index.html".
  const schemePrefix = `${expected.protocol}//`;
  if (!rawUrl.toLowerCase().startsWith(schemePrefix)) {
    return false;
  }
  const remainder = rawUrl.slice(schemePrefix.length);
  const authorityEnd = remainder.search(/[/?#]/);
  const rawAuthority =
    authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
  if (rawAuthority.toLowerCase() !== expected.host.toLowerCase()) {
    return false;
  }

  return true;
}

export function isAllowedRendererUrl(
  rawUrl: string,
  allowedOrigin: string,
): boolean {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (!matchesAllowedOrigin(parsed, rawUrl, allowedOrigin)) {
    return false;
  }

  return parsed.pathname === '/' || parsed.pathname === '/index.html';
}

export function isAllowedNavigationUrl(
  rawUrl: string,
  allowedOrigin: string,
): boolean {
  return isAllowedRendererUrl(rawUrl, allowedOrigin);
}

export function validateIpcSender(
  event: IpcSenderEventLike,
  context: IpcSecurityContext,
): SenderValidationResult {
  if (context.isWindowDestroyed || context.windowWebContentsId === null) {
    return { ok: false, reason: 'Target application window is not active.' };
  }

  const sender = event.sender;
  if (!sender || sender.isDestroyed()) {
    return { ok: false, reason: 'IPC sender WebContents is missing or destroyed.' };
  }

  if (sender.id !== context.windowWebContentsId) {
    return { ok: false, reason: 'IPC sender does not match the authorized window.' };
  }

  const senderFrame = event.senderFrame;
  if (!senderFrame) {
    return { ok: false, reason: 'IPC senderFrame is missing.' };
  }

  if (senderFrame.parent !== null) {
    return { ok: false, reason: 'IPC messages from subframes are forbidden.' };
  }

  if (
    context.mainFrameRoutingId !== null &&
    senderFrame.routingId !== context.mainFrameRoutingId
  ) {
    return {
      ok: false,
      reason: 'IPC senderFrame routingId does not match the main frame.',
    };
  }

  if (!isAllowedRendererUrl(senderFrame.url, context.allowedOrigin)) {
    return {
      ok: false,
      reason: 'IPC senderFrame URL does not match the authorized origin.',
    };
  }

  if (typeof sender.getURL === 'function') {
    const currentContentsUrl = sender.getURL();
    if (!isAllowedRendererUrl(currentContentsUrl, context.allowedOrigin)) {
      return {
        ok: false,
        reason: 'IPC sender WebContents URL does not match the authorized origin.',
      };
    }
  }

  return { ok: true };
}

function isSubPath(rootDir: string, candidatePath: string): boolean {
  const rel = path.relative(rootDir, candidatePath);
  return (
    rel.length > 0 &&
    rel !== '.' &&
    !rel.startsWith('..') &&
    !path.isAbsolute(rel)
  );
}

export function resolveAppProtocolPath(
  requestUrl: string,
  distRootDir: string,
): AppProtocolResolution {
  if (typeof requestUrl !== 'string' || requestUrl.length === 0) {
    return { ok: false, status: 400, reason: 'Empty request URL.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400, reason: 'Malformed request URL.' };
  }

  if (
    parsed.protocol !== `${APP_SCHEME}:` ||
    parsed.hostname !== APP_HOST ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== ''
  ) {
    return { ok: false, status: 403, reason: 'Forbidden app protocol host or credentials.' };
  }

  const rawPathname = parsed.pathname;
  if (
    ENCODED_SLASH_OR_NULL_PATTERN.test(rawPathname) ||
    rawPathname.includes('\\')
  ) {
    return {
      ok: false,
      status: 403,
      reason: 'Forbidden encoded path separator or null byte.',
    };
  }

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    return { ok: false, status: 400, reason: 'Invalid URL percent-encoding.' };
  }

  if (
    decodedPathname.includes('\0') ||
    decodedPathname.includes('\\') ||
    CONTROL_CHAR_PATTERN.test(decodedPathname)
  ) {
    return {
      ok: false,
      status: 403,
      reason: 'Forbidden character in decoded path.',
    };
  }

  const normalizedRoute =
    decodedPathname === '' || decodedPathname === '/'
      ? '/index.html'
      : decodedPathname;

  const segments = normalizedRoute.split('/').filter((seg) => seg.length > 0);
  if (segments.some((seg) => seg === '.' || seg === '..')) {
    return {
      ok: false,
      status: 403,
      reason: 'Relative traversal segments are forbidden.',
    };
  }

  const resolvedRoot = path.resolve(distRootDir);
  const candidatePath = path.resolve(resolvedRoot, ...segments);

  if (!isSubPath(resolvedRoot, candidatePath)) {
    return {
      ok: false,
      status: 403,
      reason: 'Resolved path escapes the bundle root directory.',
    };
  }

  const ext = path.extname(candidatePath).toLowerCase();
  const mimeType = SAFE_MIME_TYPES[ext];
  if (!mimeType) {
    return {
      ok: false,
      status: 403,
      reason: 'Unsupported asset extension.',
    };
  }

  return {
    ok: true,
    filePath: candidatePath,
    mimeType,
  };
}

export async function serveAppProtocolRequest(
  request: { url: string; method: string },
  distRootDir: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const resolved = resolveAppProtocolPath(request.url, distRootDir);
  if (!resolved.ok) {
    return new Response(resolved.reason, {
      status: resolved.status,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  try {
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(distRootDir),
      fs.realpath(resolved.filePath),
    ]);

    if (!isSubPath(realRoot, realTarget)) {
      return new Response('Forbidden', {
        status: 403,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': resolved.mimeType,
      'Content-Security-Policy': buildContentSecurityPolicy('bundled'),
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
    };

    if (method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }

    const content = await fs.readFile(realTarget);
    return new Response(new Uint8Array(content), { status: 200, headers });
  } catch {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

export function validateExternalUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== 'string') {
    throw new Error('External URL must be a string.');
  }

  const trimmed = rawUrl.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 2048 ||
    CONTROL_CHAR_PATTERN.test(trimmed)
  ) {
    throw new Error('External URL is empty, too long, or contains control characters.');
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

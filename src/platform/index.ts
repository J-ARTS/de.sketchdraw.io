import type {
  DesktopBridge,
  ExportFileResult,
  FileError,
  FileReference,
  OpenDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
} from '../domain/types';
import {
  type BrowserAnchorLike,
  type BrowserCloseDecision,
  type BrowserDesktopBridgeOptions,
  type BrowserDomAdapter,
  type BrowserExportFormat,
  type BrowserFileInputLike,
  type BrowserMenuCommand,
  computeBrowserVersionToken,
  createBrowserDesktopBridge,
  generateBrowserHandleId,
  hasActiveBrowserUserGesture,
  sanitizeDownloadFileName,
  sanitizeOpenedFileName,
  sha256HexSync,
  validateExternalHttpUrl,
} from './browser-bridge';

declare global {
  interface Window {
    readonly sketchdraw?: DesktopBridge;
  }
}

export type {
  BrowserAnchorLike,
  BrowserCloseDecision,
  BrowserDesktopBridgeOptions,
  BrowserDomAdapter,
  BrowserExportFormat,
  BrowserFileInputLike,
  BrowserMenuCommand,
  DesktopBridge,
  ExportFileResult,
  FileError,
  FileReference,
  OpenDocumentResult,
  SaveDocumentRequest,
  SaveDocumentResult,
};

export {
  computeBrowserVersionToken,
  createBrowserDesktopBridge,
  generateBrowserHandleId,
  hasActiveBrowserUserGesture,
  sanitizeDownloadFileName,
  sanitizeOpenedFileName,
  sha256HexSync,
  validateExternalHttpUrl,
};

const REQUIRED_BRIDGE_METHODS = [
  'openDocument',
  'saveDocument',
  'exportFile',
  'openExternal',
  'onCloseRequested',
  'respondToClose',
  'onMenuCommand',
] as const;

export function isDesktopBridgeContract(
  candidate: unknown,
): candidate is DesktopBridge {
  if (typeof candidate !== 'object' || candidate === null) {
    return false;
  }

  const record = candidate as Record<string, unknown>;
  if (record['platform'] !== 'electron' && record['platform'] !== 'browser') {
    return false;
  }

  for (const method of REQUIRED_BRIDGE_METHODS) {
    if (typeof record[method] !== 'function') {
      return false;
    }
  }

  return true;
}

let browserBridgeSingleton: DesktopBridge | null = null;

export function getDesktopBridge(): DesktopBridge {
  if (typeof window !== 'undefined' && isDesktopBridgeContract(window.sketchdraw)) {
    return window.sketchdraw;
  }

  if (browserBridgeSingleton === null) {
    browserBridgeSingleton = createBrowserDesktopBridge();
  }

  return browserBridgeSingleton;
}

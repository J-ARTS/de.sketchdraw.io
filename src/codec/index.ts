import {
  DOMAIN_LIMITS,
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../domain';
import { cloneAsset, cloneComponentSet } from '../domain/geometry';
import type {
  ComponentSet,
  ElementKind,
  ElementStyle,
  ParseDiagnostic,
  ParseResult,
  SketchAsset,
  SketchDocument,
  SketchElement,
  ValidationIssue,
} from '../domain/types';
import {
  ELEMENT_KINDS,
  FORBIDDEN_KEYS,
  isPlainRecord,
  joinPath,
  utf8ByteLength,
} from '../domain/validation';
import {
  formatCompactJson,
  formatJsonString,
  MAX_JSON_DEPTH,
  parseStrictJsonObject,
  scanJsonStringToken,
  type JsonObjectSpans,
  type SourceSpan,
} from './json';

export const SCRIPT_V1_DEFAULT_STYLE: Readonly<ElementStyle> = Object.freeze({
  stroke: '#1f2937',
  fill: 'transparent',
  strokeWidth: 2,
  opacity: 1,
  fontSize: 16,
  textAlign: 'left',
  strokeDash: 'solid',
});

export const CODEC_LIMITS = Object.freeze({
  MAX_SCRIPT_BYTES: DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES,
  MAX_JSON_DEPTH,
  MAX_DIAGNOSTICS: 100,
});

const DOCUMENT_DECL_ALLOWED_KEYS: ReadonlySet<string> = new Set(['id', 'title', 'metadata', 'commentThreads', 'tasks']);

interface ParsedElementEntry {
  id: string;
  element: Record<string, unknown>;
  lineSpan: SourceSpan;
  idSpan: SourceSpan;
  jsonSpans: JsonObjectSpans;
}

interface ParsedAssetEntry {
  id: string;
  asset: Record<string, unknown>;
  lineSpan: SourceSpan;
  idSpan: SourceSpan;
  jsonSpans?: JsonObjectSpans;
}

interface ParsedSetEntry {
  id: string;
  set: Record<string, unknown>;
  lineSpan: SourceSpan;
  idSpan: SourceSpan;
  jsonSpans?: JsonObjectSpans;
}

function isHorizontalWs(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t';
}

function skipHorizontalWs(line: string, pos: number, end: number): number {
  let cursor = pos;
  while (cursor < end && isHorizontalWs(line[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function scanWord(line: string, pos: number, end: number): number {
  let cursor = pos;
  while (cursor < end && !isHorizontalWs(line[cursor])) {
    cursor += 1;
  }
  return cursor;
}

function makeDiag(
  code: string,
  span: SourceSpan,
  message: string,
  options?: {
    elementId?: string;
    issuePath?: string;
    severity?: 'error' | 'warning';
  },
): ParseDiagnostic {
  const diag: ParseDiagnostic = {
    code,
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    message,
    severity: options?.severity ?? 'error',
  };
  if (options?.elementId !== undefined) {
    diag.elementId = options.elementId;
  }
  if (options?.issuePath !== undefined && options.issuePath.length > 0) {
    diag.issuePath = options.issuePath;
  }
  return diag;
}

function applyDiagnosticCap(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  const max = CODEC_LIMITS.MAX_DIAGNOSTICS;
  if (diagnostics.length <= max) {
    return diagnostics;
  }
  const capped = diagnostics.slice(0, max - 1);
  const last = diagnostics[max - 1]!;
  capped.push({
    code: 'LIMIT_EXCEEDED',
    line: last.line,
    column: last.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
    message: `Diagnostic limit of ${max} reached; additional errors may exist.`,
    severity: 'error',
  });
  return capped;
}

function lookupSpanInJson(
  spans: JsonObjectSpans | undefined,
  relPath: string,
  preferKey: boolean,
  fallback: SourceSpan,
): SourceSpan {
  if (!spans) {
    return fallback;
  }
  const primary = preferKey ? spans.keySpans : spans.valueSpans;
  const secondary = preferKey ? spans.valueSpans : spans.keySpans;

  let current = relPath;
  while (current.length > 0) {
    const foundPrimary = primary.get(current);
    if (foundPrimary) return foundPrimary;
    const foundSecondary = secondary.get(current);
    if (foundSecondary) return foundSecondary;

    const lastDot = current.lastIndexOf('.');
    const lastBracket = current.lastIndexOf('[');
    const cut = Math.max(lastDot, lastBracket);
    if (cut <= 0) {
      break;
    }
    current = current.slice(0, cut);
  }

  return spans.root ?? fallback;
}

function mapDomainIssueToDiagnostic(
  issue: ValidationIssue,
  headerSpan: SourceSpan,
  documentSpan: SourceSpan,
  documentJsonSpans: JsonObjectSpans | undefined,
  assetEntries: ReadonlyMap<string, ParsedAssetEntry>,
  setEntries: readonly ParsedSetEntry[],
  elementEntries: readonly ParsedElementEntry[],
): ParseDiagnostic {
  const { path, code, message } = issue;
  const preferKey =
    code === 'UNKNOWN_FIELD' || code === 'FORBIDDEN_KEY' || code === 'INVALID_METADATA_KEY';

  if (path === 'schemaVersion') {
    return makeDiag(code, headerSpan, message, { issuePath: path });
  }

  if (
    path === '' ||
    path === 'id' ||
    path === 'title' ||
    path === 'metadata' ||
    path.startsWith('metadata.')
  ) {
    const span = lookupSpanInJson(documentJsonSpans, path, preferKey, documentSpan);
    return makeDiag(code, span, message, { issuePath: path || undefined });
  }

  if (path === 'assets' || path.startsWith('assets.')) {
    if (path === 'assets') {
      const firstAsset = assetEntries.values().next().value as ParsedAssetEntry | undefined;
      return makeDiag(code, firstAsset?.lineSpan ?? documentSpan, message, { issuePath: path });
    }
    const rest = path.slice('assets.'.length);
    let matchedEntry: ParsedAssetEntry | undefined;
    let relPath = '';
    for (const [assetId, entry] of assetEntries.entries()) {
      if (rest === assetId) {
        matchedEntry = entry;
        relPath = '';
        break;
      }
      if (rest.startsWith(`${assetId}.`)) {
        if (!matchedEntry || assetId.length > matchedEntry.id.length) {
          matchedEntry = entry;
          relPath = rest.slice(assetId.length + 1);
        }
      }
    }
    if (matchedEntry) {
      if (relPath === '' || relPath === 'id') {
        return makeDiag(code, matchedEntry.idSpan, message, { issuePath: path });
      }
      const span = lookupSpanInJson(
        matchedEntry.jsonSpans,
        relPath,
        preferKey,
        matchedEntry.lineSpan,
      );
      return makeDiag(code, span, message, { issuePath: path });
    }
    return makeDiag(code, documentSpan, message, { issuePath: path });
  }

  if (path === 'componentSets' || path.startsWith('componentSets[')) {
    const match = /^componentSets\[(\d+)\](?:\.(.*))?$/.exec(path);
    if (match) {
      const idx = Number(match[1]);
      const relPath = match[2] ?? '';
      const setEntry = setEntries[idx];
      if (setEntry) {
        if (relPath === 'id') {
          return makeDiag(code, setEntry.idSpan, message, { issuePath: path });
        }
        const span = lookupSpanInJson(setEntry.jsonSpans, relPath, preferKey, setEntry.lineSpan);
        return makeDiag(code, span, message, { issuePath: path });
      }
    }
    return makeDiag(code, documentSpan, message, { issuePath: path });
  }

  if (path === 'elements' || path.startsWith('elements[')) {
    const match = /^elements\[(\d+)\](?:\.(.*))?$/.exec(path);
    if (match) {
      const idx = Number(match[1]);
      const relPath = match[2] ?? '';
      const elEntry = elementEntries[idx];
      if (elEntry) {
        if (relPath === 'id' || relPath === 'kind') {
          const explicitKeySpan = elEntry.jsonSpans.keySpans.get(relPath);
          return makeDiag(code, explicitKeySpan ?? elEntry.idSpan, message, {
            elementId: elEntry.id,
            issuePath: path,
          });
        }
        const span = lookupSpanInJson(elEntry.jsonSpans, relPath, preferKey, elEntry.lineSpan);
        return makeDiag(code, span, message, {
          elementId: elEntry.id,
          issuePath: path,
        });
      }
    }
    return makeDiag(code, documentSpan, message, { issuePath: path });
  }

  return makeDiag(code, documentSpan, message, { issuePath: path || undefined });
}

function applyElementScriptDefaults(
  rawObj: Record<string, unknown>,
  kind: ElementKind,
  id: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id,
    kind,
  };

  for (const key of Object.getOwnPropertyNames(rawObj)) {
    if (key === 'id' || key === 'kind') {
      continue;
    }
    Object.defineProperty(out, key, {
      value: rawObj[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  if (!Object.prototype.hasOwnProperty.call(rawObj, 'rotation')) {
    out.rotation = 0;
  }

  if (!Object.prototype.hasOwnProperty.call(rawObj, 'style')) {
    out.style = { ...SCRIPT_V1_DEFAULT_STYLE };
  } else if (isPlainRecord(rawObj.style)) {
    const mergedStyle: Record<string, unknown> = {
      ...SCRIPT_V1_DEFAULT_STYLE,
    };
    for (const sKey of Object.getOwnPropertyNames(rawObj.style)) {
      Object.defineProperty(mergedStyle, sKey, {
        value: rawObj.style[sKey],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    out.style = mergedStyle;
  }

  return out;
}

/**
 * Pure parser for Sketchdraw Script v1 (.sketchdraw.txt).
 * Never mutates contextDocument, never performs I/O, and never throws on invalid script input.
 */
export function parseDiagram(source: string, contextDocument?: SketchDocument): ParseResult {
  const defaultTopSpan: SourceSpan = { line: 1, column: 1, endLine: 1, endColumn: 2 };

  if (typeof source !== 'string') {
    return {
      ok: false,
      diagnostics: [
        makeDiag('JSON_SYNTAX', defaultTopSpan, 'Diagram script source must be a string.'),
      ],
    };
  }

  if (
    source.length > CODEC_LIMITS.MAX_SCRIPT_BYTES ||
    utf8ByteLength(source) > CODEC_LIMITS.MAX_SCRIPT_BYTES
  ) {
    return {
      ok: false,
      diagnostics: [
        makeDiag(
          'LIMIT_EXCEEDED',
          defaultTopSpan,
          `Script size exceeds maximum of ${CODEC_LIMITS.MAX_SCRIPT_BYTES} UTF-8 bytes.`,
        ),
      ],
    };
  }

  let validatedContext: SketchDocument | undefined;
  if (contextDocument !== undefined) {
    try {
      validatedContext = validateDocument(contextDocument);
    } catch (error) {
      if (error instanceof DomainValidationError) {
        return {
          ok: false,
          diagnostics: applyDiagnosticCap(
            error.issues.map((iss) =>
              makeDiag(iss.code, defaultTopSpan, `Invalid contextDocument: ${iss.message}`, {
                issuePath: iss.path,
              }),
            ),
          ),
        };
      }
      return {
        ok: false,
        diagnostics: [
          makeDiag('INVALID_DOCUMENT', defaultTopSpan, 'Invalid contextDocument provided.'),
        ],
      };
    }
  }

  // Strip at most one leading UTF-8 BOM
  const normalizedSource = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const rawLines = normalizedSource.split('\n');

  const diagnostics: ParseDiagnostic[] = [];
  let seenHeader = false;
  let seenDocument = false;
  let headerSpan: SourceSpan = defaultTopSpan;
  let documentSpan: SourceSpan = defaultTopSpan;
  let documentJsonSpans: JsonObjectSpans | undefined;

  let docId: unknown = undefined;
  let docTitle: unknown = undefined;
  let docMetadata: unknown = {};
  let docCommentThreads: unknown = [];
  let docTasks: unknown = [];
  let includeCommentThreads = false;
  let includeTasks = false;
  let hasResourceResolutionError = false;

  const seenElementIds = new Set<string>();
  const handledAssetIds = new Set<string>();
  const handledSetIds = new Set<string>();

  const elementEntries: ParsedElementEntry[] = [];
  const assetEntries = new Map<string, ParsedAssetEntry>();
  const setEntries: ParsedSetEntry[] = [];

  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx += 1) {
    if (diagnostics.length > CODEC_LIMITS.MAX_DIAGNOSTICS) {
      break;
    }

    const lineNumber = lineIdx + 1;
    const rawLine = rawLines[lineIdx]!;
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;

    const bareCr = line.indexOf('\r');
    if (bareCr !== -1) {
      diagnostics.push(
        makeDiag(
          'JSON_SYNTAX',
          {
            line: lineNumber,
            column: bareCr + 1,
            endLine: lineNumber,
            endColumn: bareCr + 2,
          },
          'Standalone carriage return (CR) is not allowed inside a line.',
        ),
      );
      continue;
    }

    const firstNonWs = skipHorizontalWs(line, 0, line.length);
    if (firstNonWs >= line.length) {
      continue; // blank line
    }

    if (line[firstNonWs] === '#') {
      continue; // full-line comment
    }

    let trimEnd = line.length;
    while (trimEnd > firstNonWs && isHorizontalWs(line[trimEnd - 1])) {
      trimEnd -= 1;
    }

    const kwEnd = scanWord(line, firstNonWs, trimEnd);
    const keyword = line.slice(firstNonWs, kwEnd);
    const keywordSpan: SourceSpan = {
      line: lineNumber,
      column: firstNonWs + 1,
      endLine: lineNumber,
      endColumn: kwEnd + 1,
    };
    const lineSpan: SourceSpan = {
      line: lineNumber,
      column: firstNonWs + 1,
      endLine: lineNumber,
      endColumn: trimEnd + 1,
    };

    // 1. First non-empty line must be "sketchdraw 1"
    if (!seenHeader) {
      seenHeader = true;
      headerSpan = lineSpan;

      if (keyword !== 'sketchdraw') {
        diagnostics.push(
          makeDiag(
            'EXPECTED_HEADER',
            keywordSpan,
            'First declaration must be the "sketchdraw 1" header.',
          ),
        );
        continue;
      }

      const verStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (verStart >= trimEnd || verStart === kwEnd) {
        diagnostics.push(
          makeDiag(
            'FORMAT_VERSION',
            lineSpan,
            'Missing format version in header; expected "sketchdraw 1".',
          ),
        );
        continue;
      }

      const verText = line.slice(verStart, trimEnd);
      const verSpan: SourceSpan = {
        line: lineNumber,
        column: verStart + 1,
        endLine: lineNumber,
        endColumn: trimEnd + 1,
      };
      if (verText !== '1') {
        diagnostics.push(
          makeDiag(
            'FORMAT_VERSION',
            verSpan,
            `Unsupported Sketchdraw script format version "${verText}"; expected "1".`,
          ),
        );
      }
      continue;
    }

    // 2. Second non-empty line must be "document {...}"
    if (!seenDocument) {
      seenDocument = true;
      documentSpan = lineSpan;

      if (keyword !== 'document') {
        diagnostics.push(
          makeDiag(
            'EXPECTED_DOCUMENT',
            keywordSpan,
            'Second declaration must be "document {...}".',
          ),
        );
        continue;
      }

      const jsonStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (jsonStart >= trimEnd || jsonStart === kwEnd) {
        diagnostics.push(
          makeDiag(
            'EXPECTED_DOCUMENT',
            lineSpan,
            'Missing JSON object in document declaration.',
          ),
        );
        continue;
      }

      const jsonRes = parseStrictJsonObject(line.slice(jsonStart, trimEnd), {
        lineNumber,
        lineOffset: jsonStart,
        basePath: '',
      });
      if (!jsonRes.ok) {
        diagnostics.push(...jsonRes.diagnostics);
        continue;
      }

      documentJsonSpans = jsonRes.spans;
      const docObj = jsonRes.value;

      for (const key of Object.getOwnPropertyNames(docObj)) {
        const kSpan = jsonRes.spans.keySpans.get(key) ?? jsonRes.spans.root;
        if (FORBIDDEN_KEYS.has(key)) {
          diagnostics.push(
            makeDiag('FORBIDDEN_KEY', kSpan, `Forbidden property key "${key}".`, {
              issuePath: key,
            }),
          );
        } else if (!DOCUMENT_DECL_ALLOWED_KEYS.has(key)) {
          diagnostics.push(
            makeDiag(
              'UNKNOWN_FIELD',
              kSpan,
              `Unknown or disallowed property "${key}" in document declaration.`,
              { issuePath: key },
            ),
          );
        }
      }

      if (Object.prototype.hasOwnProperty.call(docObj, 'id')) {
        docId = docObj.id;
        if (
          validatedContext !== undefined &&
          typeof docObj.id === 'string' &&
          docObj.id !== validatedContext.id
        ) {
          const idValSpan = jsonRes.spans.valueSpans.get('id') ?? jsonRes.spans.root;
          diagnostics.push(
            makeDiag(
              'CONTEXT_ID_MISMATCH',
              idValSpan,
              `Document id "${docObj.id}" does not match context document id "${validatedContext.id}".`,
              { issuePath: 'id' },
            ),
          );
        }
      } else if (validatedContext !== undefined) {
        docId = validatedContext.id;
      } else {
        diagnostics.push(
          makeDiag(
            'CONTEXT_REQUIRED',
            jsonRes.spans.root,
            'Document "id" is required when parsing without a contextDocument.',
            { issuePath: 'id' },
          ),
        );
      }

      if (Object.prototype.hasOwnProperty.call(docObj, 'title')) {
        docTitle = docObj.title;
      } else {
        docTitle = undefined;
      }

      if (Object.prototype.hasOwnProperty.call(docObj, 'metadata')) {
        docMetadata = docObj.metadata;
      } else {
        docMetadata = {};
      }
      includeCommentThreads = Object.prototype.hasOwnProperty.call(docObj, 'commentThreads') || Boolean(validatedContext?.commentThreads?.length);
      includeTasks = Object.prototype.hasOwnProperty.call(docObj, 'tasks') || Boolean(validatedContext?.tasks?.length);
      docCommentThreads = Object.prototype.hasOwnProperty.call(docObj, 'commentThreads') ? docObj.commentThreads : (validatedContext?.commentThreads ?? []);
      docTasks = Object.prototype.hasOwnProperty.call(docObj, 'tasks') ? docObj.tasks : (validatedContext?.tasks ?? []);
      continue;
    }

    // 3. Subsequent declarations
    if (keyword === 'sketchdraw' || keyword === 'document') {
      diagnostics.push(
        makeDiag(
          'DUPLICATE_DECLARATION',
          keywordSpan,
          `Duplicate "${keyword}" declaration is not allowed.`,
        ),
      );
      continue;
    }

    if (ELEMENT_KINDS.has(keyword as ElementKind)) {
      const kind = keyword as ElementKind;
      const idStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (idStart === kwEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, `Missing element ID and JSON object after "${kind}".`),
        );
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        continue;
      }

      const elementId = idToken.value;
      const elIdx = elementEntries.length;
      const basePath = joinPath('elements', elIdx);

      const jsonStart = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
      if (jsonStart === idToken.nextOffset || jsonStart >= trimEnd) {
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: idToken.nextOffset + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            `Expected whitespace and a JSON object after element ID "${elementId}".`,
            { elementId, issuePath: basePath },
          ),
        );
        continue;
      }

      const jsonRes = parseStrictJsonObject(line.slice(jsonStart, trimEnd), {
        lineNumber,
        lineOffset: jsonStart,
        basePath,
        elementId,
      });
      if (!jsonRes.ok) {
        diagnostics.push(...jsonRes.diagnostics);
        continue;
      }

      if (seenElementIds.has(elementId)) {
        diagnostics.push(
          makeDiag(
            'DUPLICATE_DECLARATION',
            idToken.span,
            `Duplicate element declaration for id "${elementId}".`,
            { elementId, issuePath: joinPath(basePath, 'id') },
          ),
        );
      } else {
        seenElementIds.add(elementId);
      }

      for (const forbiddenTailKey of ['id', 'kind'] as const) {
        if (Object.prototype.hasOwnProperty.call(jsonRes.value, forbiddenTailKey)) {
          const kSpan = jsonRes.spans.keySpans.get(forbiddenTailKey) ?? jsonRes.spans.root;
          diagnostics.push(
            makeDiag(
              'UNKNOWN_FIELD',
              kSpan,
              `Property "${forbiddenTailKey}" must not be repeated inside the element JSON object.`,
              { elementId, issuePath: joinPath(basePath, forbiddenTailKey) },
            ),
          );
        }
      }

      const normalizedElement = applyElementScriptDefaults(jsonRes.value, kind, elementId);
      elementEntries.push({
        id: elementId,
        element: normalizedElement,
        lineSpan,
        idSpan: idToken.span,
        jsonSpans: jsonRes.spans,
      });
      continue;
    }

    if (keyword === 'asset') {
      const idStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (idStart === kwEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, 'Missing asset ID and JSON object after "asset".'),
        );
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        continue;
      }

      const assetId = idToken.value;
      const basePath = joinPath('assets', assetId);

      const jsonStart = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
      if (jsonStart === idToken.nextOffset || jsonStart >= trimEnd) {
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: idToken.nextOffset + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            `Expected whitespace and a JSON object after asset ID "${assetId}".`,
            { issuePath: basePath },
          ),
        );
        continue;
      }

      const jsonRes = parseStrictJsonObject(line.slice(jsonStart, trimEnd), {
        lineNumber,
        lineOffset: jsonStart,
        basePath,
      });
      if (!jsonRes.ok) {
        diagnostics.push(...jsonRes.diagnostics);
        hasResourceResolutionError = true;
        continue;
      }

      if (handledAssetIds.has(assetId)) {
        diagnostics.push(
          makeDiag(
            'DUPLICATE_DECLARATION',
            idToken.span,
            `Duplicate declaration for asset "${assetId}".`,
            { issuePath: basePath },
          ),
        );
      } else {
        handledAssetIds.add(assetId);
      }

      if (Object.prototype.hasOwnProperty.call(jsonRes.value, 'id')) {
        const kSpan = jsonRes.spans.keySpans.get('id') ?? jsonRes.spans.root;
        diagnostics.push(
          makeDiag(
            'UNKNOWN_FIELD',
            kSpan,
            'Property "id" must not be repeated inside the asset JSON object.',
            { issuePath: joinPath(basePath, 'id') },
          ),
        );
      }

      const assetCandidate: Record<string, unknown> = { id: assetId };
      for (const key of Object.getOwnPropertyNames(jsonRes.value)) {
        if (key === 'id') continue;
        Object.defineProperty(assetCandidate, key, {
          value: jsonRes.value[key],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }

      assetEntries.set(assetId, {
        id: assetId,
        asset: assetCandidate,
        lineSpan,
        idSpan: idToken.span,
        jsonSpans: jsonRes.spans,
      });
      continue;
    }

    if (keyword === 'asset-ref') {
      const idStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (idStart === kwEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, 'Missing asset ID after "asset-ref".'),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        hasResourceResolutionError = true;
        continue;
      }

      const assetId = idToken.value;
      const basePath = joinPath('assets', assetId);

      if (idToken.nextOffset < trimEnd) {
        const trailPos = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: trailPos + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            'Unexpected trailing tokens after "asset-ref" identifier.',
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      if (handledAssetIds.has(assetId)) {
        diagnostics.push(
          makeDiag(
            'DUPLICATE_DECLARATION',
            idToken.span,
            `Duplicate declaration for asset "${assetId}".`,
            { issuePath: basePath },
          ),
        );
      } else {
        handledAssetIds.add(assetId);
      }

      if (!validatedContext) {
        diagnostics.push(
          makeDiag(
            'CONTEXT_REQUIRED',
            lineSpan,
            `"asset-ref" for "${assetId}" requires a contextDocument.`,
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const ctxAsset = Object.prototype.hasOwnProperty.call(validatedContext.assets, assetId)
        ? validatedContext.assets[assetId]
        : undefined;
      if (!ctxAsset) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_MISSING',
            idToken.span,
            `Referenced asset "${assetId}" does not exist in contextDocument.`,
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      assetEntries.set(assetId, {
        id: assetId,
        asset: cloneAsset(ctxAsset) as unknown as Record<string, unknown>,
        lineSpan,
        idSpan: idToken.span,
      });
      continue;
    }

    if (keyword === 'set') {
      const idStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (idStart === kwEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, 'Missing set ID and JSON object after "set".'),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        hasResourceResolutionError = true;
        continue;
      }

      const setId = idToken.value;
      const setIdx = setEntries.length;
      const basePath = joinPath('componentSets', setIdx);

      const jsonStart = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
      if (jsonStart === idToken.nextOffset || jsonStart >= trimEnd) {
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: idToken.nextOffset + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            `Expected whitespace and a JSON object after set ID "${setId}".`,
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const jsonRes = parseStrictJsonObject(line.slice(jsonStart, trimEnd), {
        lineNumber,
        lineOffset: jsonStart,
        basePath,
      });
      if (!jsonRes.ok) {
        diagnostics.push(...jsonRes.diagnostics);
        hasResourceResolutionError = true;
        continue;
      }

      if (handledSetIds.has(setId)) {
        diagnostics.push(
          makeDiag(
            'DUPLICATE_DECLARATION',
            idToken.span,
            `Duplicate declaration for component set "${setId}".`,
            { issuePath: joinPath(basePath, 'id') },
          ),
        );
      } else {
        handledSetIds.add(setId);
      }

      if (Object.prototype.hasOwnProperty.call(jsonRes.value, 'id')) {
        const kSpan = jsonRes.spans.keySpans.get('id') ?? jsonRes.spans.root;
        diagnostics.push(
          makeDiag(
            'UNKNOWN_FIELD',
            kSpan,
            'Property "id" must not be repeated inside the set JSON object.',
            { issuePath: joinPath(basePath, 'id') },
          ),
        );
      }

      const setCandidate: Record<string, unknown> = { id: setId };
      for (const key of Object.getOwnPropertyNames(jsonRes.value)) {
        if (key === 'id') continue;
        Object.defineProperty(setCandidate, key, {
          value: jsonRes.value[key],
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }

      setEntries.push({
        id: setId,
        set: setCandidate,
        lineSpan,
        idSpan: idToken.span,
        jsonSpans: jsonRes.spans,
      });
      continue;
    }

    if (keyword === 'set-ref') {
      const idStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (idStart === kwEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, 'Missing set ID and version object after "set-ref".'),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        hasResourceResolutionError = true;
        continue;
      }

      const setId = idToken.value;
      const setIdx = setEntries.length;
      const basePath = joinPath('componentSets', setIdx);

      const jsonStart = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
      if (jsonStart === idToken.nextOffset || jsonStart >= trimEnd) {
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: idToken.nextOffset + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            `Expected whitespace and {"version":"..."} after "set-ref" ID "${setId}".`,
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const jsonRes = parseStrictJsonObject(line.slice(jsonStart, trimEnd), {
        lineNumber,
        lineOffset: jsonStart,
        basePath,
      });
      if (!jsonRes.ok) {
        diagnostics.push(...jsonRes.diagnostics);
        hasResourceResolutionError = true;
        continue;
      }

      if (handledSetIds.has(setId)) {
        diagnostics.push(
          makeDiag(
            'DUPLICATE_DECLARATION',
            idToken.span,
            `Duplicate declaration for component set "${setId}".`,
            { issuePath: joinPath(basePath, 'id') },
          ),
        );
      } else {
        handledSetIds.add(setId);
      }

      for (const key of Object.getOwnPropertyNames(jsonRes.value)) {
        const kSpan = jsonRes.spans.keySpans.get(key) ?? jsonRes.spans.root;
        if (FORBIDDEN_KEYS.has(key)) {
          diagnostics.push(
            makeDiag('FORBIDDEN_KEY', kSpan, `Forbidden property key "${key}".`, {
              issuePath: joinPath(basePath, key),
            }),
          );
        } else if (key !== 'version') {
          diagnostics.push(
            makeDiag(
              'UNKNOWN_FIELD',
              kSpan,
              `Property "${key}" is not allowed in "set-ref"; only "version" is allowed.`,
              { issuePath: joinPath(basePath, key) },
            ),
          );
        }
      }

      const reqVersion = jsonRes.value.version;
      const versionSpan = jsonRes.spans.valueSpans.get('version') ?? jsonRes.spans.root;
      if (typeof reqVersion !== 'string' || reqVersion.length === 0) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_VERSION_CONFLICT',
            versionSpan,
            `"set-ref" for "${setId}" requires a non-empty string "version".`,
            { issuePath: joinPath(basePath, 'version') },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      if (!validatedContext) {
        diagnostics.push(
          makeDiag(
            'CONTEXT_REQUIRED',
            lineSpan,
            `"set-ref" for "${setId}" requires a contextDocument.`,
            { issuePath: basePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const ctxSet = validatedContext.componentSets.find((s) => s.id === setId);
      if (!ctxSet) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_MISSING',
            idToken.span,
            `Referenced component set "${setId}" does not exist in contextDocument.`,
            { issuePath: joinPath(basePath, 'id') },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      if (ctxSet.version !== reqVersion) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_VERSION_CONFLICT',
            versionSpan,
            `Component set "${setId}" version "${reqVersion}" does not match context version "${ctxSet.version}".`,
            { issuePath: joinPath(basePath, 'version') },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      setEntries.push({
        id: setId,
        set: cloneComponentSet(ctxSet) as unknown as Record<string, unknown>,
        lineSpan,
        idSpan: idToken.span,
        jsonSpans: jsonRes.spans,
      });
      continue;
    }

    if (keyword === 'drop') {
      const subStart = skipHorizontalWs(line, kwEnd, trimEnd);
      if (subStart === kwEnd || subStart >= trimEnd) {
        diagnostics.push(
          makeDiag('UNKNOWN_DECLARATION', lineSpan, 'Expected "asset" or "set" after "drop".'),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const subEnd = scanWord(line, subStart, trimEnd);
      const subKeyword = line.slice(subStart, subEnd);
      const subSpan: SourceSpan = {
        line: lineNumber,
        column: subStart + 1,
        endLine: lineNumber,
        endColumn: subEnd + 1,
      };

      if (subKeyword !== 'asset' && subKeyword !== 'set') {
        diagnostics.push(
          makeDiag(
            'UNKNOWN_DECLARATION',
            subSpan,
            `Unknown drop target "${subKeyword}"; expected "asset" or "set".`,
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const idStart = skipHorizontalWs(line, subEnd, trimEnd);
      if (idStart === subEnd || idStart >= trimEnd) {
        diagnostics.push(
          makeDiag('JSON_SYNTAX', lineSpan, `Missing identifier after "drop ${subKeyword}".`),
        );
        hasResourceResolutionError = true;
        continue;
      }

      const idToken = scanJsonStringToken(line, idStart, trimEnd, lineNumber);
      if (!idToken.ok) {
        diagnostics.push(idToken.diagnostic);
        hasResourceResolutionError = true;
        continue;
      }

      const targetId = idToken.value;
      const issuePath = subKeyword === 'asset' ? joinPath('assets', targetId) : 'componentSets';

      if (idToken.nextOffset < trimEnd) {
        const trailPos = skipHorizontalWs(line, idToken.nextOffset, trimEnd);
        diagnostics.push(
          makeDiag(
            'JSON_SYNTAX',
            {
              line: lineNumber,
              column: trailPos + 1,
              endLine: lineNumber,
              endColumn: trimEnd + 1,
            },
            `Unexpected trailing tokens after "drop ${subKeyword}" identifier.`,
            { issuePath },
          ),
        );
        hasResourceResolutionError = true;
        continue;
      }

      if (subKeyword === 'asset') {
        if (handledAssetIds.has(targetId)) {
          diagnostics.push(
            makeDiag(
              'DUPLICATE_DECLARATION',
              idToken.span,
              `Duplicate declaration or drop for asset "${targetId}".`,
              { issuePath },
            ),
          );
        } else {
          handledAssetIds.add(targetId);
        }

        if (!validatedContext) {
          diagnostics.push(
            makeDiag(
              'CONTEXT_REQUIRED',
              lineSpan,
              `"drop asset" for "${targetId}" requires a contextDocument.`,
              { issuePath },
            ),
          );
          hasResourceResolutionError = true;
          continue;
        }

        if (!Object.prototype.hasOwnProperty.call(validatedContext.assets, targetId)) {
          diagnostics.push(
            makeDiag(
              'RESOURCE_MISSING',
              idToken.span,
              `Cannot drop asset "${targetId}" because it does not exist in contextDocument.`,
              { issuePath },
            ),
          );
          hasResourceResolutionError = true;
          continue;
        }
      } else {
        if (handledSetIds.has(targetId)) {
          diagnostics.push(
            makeDiag(
              'DUPLICATE_DECLARATION',
              idToken.span,
              `Duplicate declaration or drop for component set "${targetId}".`,
              { issuePath },
            ),
          );
        } else {
          handledSetIds.add(targetId);
        }

        if (!validatedContext) {
          diagnostics.push(
            makeDiag(
              'CONTEXT_REQUIRED',
              lineSpan,
              `"drop set" for "${targetId}" requires a contextDocument.`,
              { issuePath },
            ),
          );
          hasResourceResolutionError = true;
          continue;
        }

        if (!validatedContext.componentSets.some((s) => s.id === targetId)) {
          diagnostics.push(
            makeDiag(
              'RESOURCE_MISSING',
              idToken.span,
              `Cannot drop component set "${targetId}" because it does not exist in contextDocument.`,
              { issuePath },
            ),
          );
          hasResourceResolutionError = true;
          continue;
        }
      }
      continue;
    }

    diagnostics.push(
      makeDiag('UNKNOWN_DECLARATION', keywordSpan, `Unknown declaration keyword "${keyword}".`),
    );
  }

  if (!seenHeader) {
    diagnostics.push(
      makeDiag(
        'EXPECTED_HEADER',
        defaultTopSpan,
        'Missing "sketchdraw 1" header in script.',
      ),
    );
  } else if (!seenDocument) {
    diagnostics.push(
      makeDiag(
        'EXPECTED_DOCUMENT',
        headerSpan,
        'Missing "document {...}" declaration after header.',
      ),
    );
  }

  // Verify all context resources were explicitly declared, referenced, or dropped
  if (seenDocument && validatedContext !== undefined) {
    for (const ctxAssetId of Object.keys(validatedContext.assets)) {
      if (!handledAssetIds.has(ctxAssetId)) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_OMITTED',
            documentSpan,
            `Context asset "${ctxAssetId}" was omitted; declare it with "asset", reference it with "asset-ref", or remove it with "drop asset".`,
            { issuePath: joinPath('assets', ctxAssetId) },
          ),
        );
      }
    }

    for (const ctxSet of validatedContext.componentSets) {
      if (!handledSetIds.has(ctxSet.id)) {
        diagnostics.push(
          makeDiag(
            'RESOURCE_OMITTED',
            documentSpan,
            `Context component set "${ctxSet.id}" was omitted; declare it with "set", reference it with "set-ref", or remove it with "drop set".`,
            { issuePath: 'componentSets' },
          ),
        );
      }
    }
  }

  if (seenHeader && seenDocument && !hasResourceResolutionError) {
    const assetsRecord: Record<string, unknown> = {};
    for (const [assetId, entry] of assetEntries.entries()) {
      Object.defineProperty(assetsRecord, assetId, {
        value: entry.asset,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    const candidateDoc: Record<string, unknown> = {
      schemaVersion: 1,
      id: docId,
      title: docTitle,
      elements: elementEntries.map((e) => e.element),
      assets: assetsRecord,
      componentSets: setEntries.map((s) => s.set),
      metadata: docMetadata,
    };
    if (includeCommentThreads) candidateDoc.commentThreads = docCommentThreads;
    if (includeTasks) candidateDoc.tasks = docTasks;

    try {
      const validated = validateDocument(candidateDoc);
      if (diagnostics.length === 0) {
        // Also enforce canonical serialized document 32 MiB byte limit
        serializeDocument(validated);
        return {
          ok: true,
          document: validated,
          diagnostics: [],
        };
      }
    } catch (error) {
      if (error instanceof DomainValidationError) {
        for (const issue of error.issues) {
          if (diagnostics.length > CODEC_LIMITS.MAX_DIAGNOSTICS) {
            break;
          }
          if (
            issue.code === 'DUPLICATE_ELEMENT_ID' ||
            issue.code === 'DUPLICATE_COMPONENT_SET_ID'
          ) {
            continue;
          }
          if (issue.path === 'id' && docId === undefined) {
            continue;
          }
          const mappedCode =
            issue.code === 'DOCUMENT_JSON_TOO_LARGE' ? 'LIMIT_EXCEEDED' : issue.code;
          const diag = mapDomainIssueToDiagnostic(
            { ...issue, code: mappedCode },
            headerSpan,
            documentSpan,
            documentJsonSpans,
            assetEntries,
            setEntries,
            elementEntries,
          );
          diagnostics.push(diag);
        }
      } else {
        diagnostics.push(
          makeDiag('VALIDATION_FAILED', documentSpan, 'Document validation failed.'),
        );
      }
    }
  }

  return {
    ok: false,
    diagnostics: applyDiagnosticCap(diagnostics),
  };
}

function formatAssetTail(asset: SketchAsset): string {
  return formatCompactJson({
    dataUrl: asset.dataUrl,
    mimeType: asset.mimeType,
    name: asset.name,
  });
}

function formatSetTail(set: ComponentSet): string {
  return formatCompactJson({
    components: set.components,
    name: set.name,
    version: set.version,
  });
}

function formatElementTail(element: SketchElement): string {
  const tail: Record<string, unknown> = {};
  for (const key of Object.keys(element)) {
    if (key === 'id' || key === 'kind') {
      continue;
    }
    const val = element[key as keyof SketchElement];
    if (val !== undefined) {
      tail[key] = val;
    }
  }
  return formatCompactJson(tail);
}

/**
 * Formats a validated SketchDocument into a deterministic, standalone Sketchdraw Script v1 string.
 * Validates the input document and throws DomainValidationError on invalid input or oversized output.
 */
export function formatDiagram(document: SketchDocument): string {
  const validated = validateDocument(document);
  // Enforce canonical document JSON size limit as well
  serializeDocument(validated);

  const documentDeclaration: Record<string, unknown> = {
    id: validated.id,
    metadata: validated.metadata,
    title: validated.title,
  };
  if (validated.commentThreads !== undefined) documentDeclaration.commentThreads = validated.commentThreads;
  if (validated.tasks !== undefined) documentDeclaration.tasks = validated.tasks;
  const headerAndDocGroup = [
    'sketchdraw 1',
    `document ${formatCompactJson(documentDeclaration)}`,
  ].join('\n');

  const groups: string[] = [headerAndDocGroup];

  const sortedAssetIds = Object.keys(validated.assets).sort();
  if (sortedAssetIds.length > 0) {
    const assetLines = sortedAssetIds.map((assetId) => {
      const asset = validated.assets[assetId]!;
      return `asset ${formatJsonString(asset.id)} ${formatAssetTail(asset)}`;
    });
    groups.push(assetLines.join('\n'));
  }

  if (validated.componentSets.length > 0) {
    const setLines = validated.componentSets.map(
      (set) => `set ${formatJsonString(set.id)} ${formatSetTail(set)}`,
    );
    groups.push(setLines.join('\n'));
  }

  if (validated.elements.length > 0) {
    const elementLines = validated.elements.map(
      (el) => `${el.kind} ${formatJsonString(el.id)} ${formatElementTail(el)}`,
    );
    groups.push(elementLines.join('\n'));
  }

  const output = `${groups.join('\n\n')}\n`;
  const byteLength = utf8ByteLength(output);
  if (byteLength > CODEC_LIMITS.MAX_SCRIPT_BYTES) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'LIMIT_EXCEEDED',
        message: `Formatted script size (${byteLength} bytes) exceeds limit of ${CODEC_LIMITS.MAX_SCRIPT_BYTES} bytes.`,
      },
    ]);
  }

  return output;
}

import {
  createScanner,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser';
import { normalizeZero } from '../domain/geometry';
import type { ParseDiagnostic } from '../domain/types';
import { joinPath } from '../domain/validation';

export const MAX_JSON_DEPTH = 64;

const SCAN_ERROR_NONE = 0;

const SYNTAX_KIND = {
  OpenBraceToken: 1,
  CloseBraceToken: 2,
  OpenBracketToken: 3,
  CloseBracketToken: 4,
  CommaToken: 5,
  ColonToken: 6,
  NullKeyword: 7,
  TrueKeyword: 8,
  FalseKeyword: 9,
  StringLiteral: 10,
  NumericLiteral: 11,
  LineCommentTrivia: 12,
  BlockCommentTrivia: 13,
  LineBreakTrivia: 14,
  Trivia: 15,
  Unknown: 16,
  EOF: 17,
} as const;

export interface SourceSpan {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface JsonObjectSpans {
  readonly root: SourceSpan;
  readonly keySpans: ReadonlyMap<string, SourceSpan>;
  readonly valueSpans: ReadonlyMap<string, SourceSpan>;
}

export type StrictJsonObjectResult =
  | {
      ok: true;
      value: Record<string, unknown>;
      spans: JsonObjectSpans;
      diagnostics: ParseDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: ParseDiagnostic[];
      spans?: JsonObjectSpans;
    };

export interface StrictJsonParseContext {
  lineNumber: number;
  lineOffset: number;
  basePath?: string;
  elementId?: string;
}

const STRICT_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function makeSpan(lineNumber: number, lineOffset: number, offset: number, length: number): SourceSpan {
  const safeOffset = Math.max(0, offset);
  const safeLen = Math.max(1, length);
  const startCol = lineOffset + safeOffset + 1;
  return {
    line: lineNumber,
    column: startCol,
    endLine: lineNumber,
    endColumn: startCol + safeLen,
  };
}

function makeDiagnostic(
  code: string,
  span: SourceSpan,
  message: string,
  context: StrictJsonParseContext,
  issuePath?: string,
): ParseDiagnostic {
  const diag: ParseDiagnostic = {
    code,
    line: span.line,
    column: span.column,
    endLine: span.endLine,
    endColumn: span.endColumn,
    message,
    severity: 'error',
  };
  if (context.elementId !== undefined) {
    diag.elementId = context.elementId;
  }
  if (issuePath !== undefined && issuePath.length > 0) {
    diag.issuePath = issuePath;
  } else if (context.basePath !== undefined && context.basePath.length > 0) {
    diag.issuePath = context.basePath;
  }
  return diag;
}

/**
 * Scans a singlequoted/doublequoted ID token at the given position in a line.
 * Only strict double-quoted JSON strings are permitted.
 */
export function scanJsonStringToken(
  line: string,
  startOffset: number,
  endOffset: number,
  lineNumber: number,
):
  | {
      ok: true;
      value: string;
      span: SourceSpan;
      nextOffset: number;
    }
  | {
      ok: false;
      diagnostic: ParseDiagnostic;
    } {
  if (startOffset >= endOffset) {
    const col = endOffset + 1;
    return {
      ok: false,
      diagnostic: {
        code: 'JSON_SYNTAX',
        line: lineNumber,
        column: col,
        endLine: lineNumber,
        endColumn: col + 1,
        message: 'Expected double-quoted JSON string identifier.',
        severity: 'error',
      },
    };
  }

  const slice = line.slice(startOffset, endOffset);
  if (slice[0] !== '"') {
    const tokenEnd = slice.search(/[ \t]/);
    const len = tokenEnd === -1 ? slice.length : Math.max(1, tokenEnd);
    return {
      ok: false,
      diagnostic: {
        code: 'JSON_SYNTAX',
        line: lineNumber,
        column: startOffset + 1,
        endLine: lineNumber,
        endColumn: startOffset + len + 1,
        message: 'Identifier must be a double-quoted JSON string.',
        severity: 'error',
      },
    };
  }

  const scanner = createScanner(slice, false);
  const token = scanner.scan();
  const scanErr = scanner.getTokenError();
  const tokenOffset = scanner.getTokenOffset();
  const tokenLen = scanner.getTokenLength();

  if (
    token !== SYNTAX_KIND.StringLiteral ||
    scanErr !== SCAN_ERROR_NONE ||
    tokenOffset !== 0 ||
    tokenLen < 2
  ) {
    return {
      ok: false,
      diagnostic: {
        code: 'JSON_SYNTAX',
        line: lineNumber,
        column: startOffset + 1,
        endLine: lineNumber,
        endColumn: startOffset + Math.max(1, tokenLen) + 1,
        message: 'Malformed JSON string identifier.',
        severity: 'error',
      },
    };
  }

  const span: SourceSpan = {
    line: lineNumber,
    column: startOffset + 1,
    endLine: lineNumber,
    endColumn: startOffset + tokenLen + 1,
  };

  return {
    ok: true,
    value: scanner.getTokenValue(),
    span,
    nextOffset: startOffset + tokenLen,
  };
}

/**
 * Parses a strict JSON object from a single-line declaration tail using jsonc-parser.
 * Enforces:
 * - No comments, no trailing commas, no multiline tokens
 * - Pre-parse nesting depth check (<= 64) before any tree recursion
 * - Strict number syntax and finiteness
 * - Duplicate object key rejection with exact source span
 * - Prototype-safe plain object construction (using Object.defineProperty)
 * - Path-to-span mapping for both property keys and values
 */
export function parseStrictJsonObject(
  jsonText: string,
  context: StrictJsonParseContext,
  maxDepth = MAX_JSON_DEPTH,
): StrictJsonObjectResult {
  const { lineNumber, lineOffset } = context;

  if (jsonText.length === 0 || jsonText[0] !== '{') {
    const span = makeSpan(lineNumber, lineOffset, 0, Math.max(1, jsonText.length));
    return {
      ok: false,
      diagnostics: [
        makeDiagnostic(
          'JSON_SYNTAX',
          span,
          'Expected a strict JSON object starting with "{".',
          context,
        ),
      ],
    };
  }

  // Step 1: Iterative token scan to enforce depth limit and strict token validity before recursion
  const scanner = createScanner(jsonText, false);
  let depth = 0;
  let token = scanner.scan();

  while (token !== SYNTAX_KIND.EOF) {
    const tokenErr = scanner.getTokenError();
    const tokenOffset = scanner.getTokenOffset();
    const tokenLen = scanner.getTokenLength();

    if (tokenErr !== SCAN_ERROR_NONE) {
      const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic('JSON_SYNTAX', span, 'Invalid JSON token in declaration.', context),
        ],
      };
    }

    if (
      token === SYNTAX_KIND.LineCommentTrivia ||
      token === SYNTAX_KIND.BlockCommentTrivia
    ) {
      const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic(
            'JSON_SYNTAX',
            span,
            'Comments are not allowed inside JSON declarations.',
            context,
          ),
        ],
      };
    }

    if (token === SYNTAX_KIND.LineBreakTrivia) {
      const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic(
            'JSON_SYNTAX',
            span,
            'Multiline JSON blocks are not allowed; use \\n escape inside strings.',
            context,
          ),
        ],
      };
    }

    if (token === SYNTAX_KIND.Unknown) {
      const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
      return {
        ok: false,
        diagnostics: [
          makeDiagnostic('JSON_SYNTAX', span, 'Unexpected symbol in JSON declaration.', context),
        ],
      };
    }

    if (token === SYNTAX_KIND.OpenBraceToken || token === SYNTAX_KIND.OpenBracketToken) {
      depth += 1;
      if (depth > maxDepth) {
        const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
        return {
          ok: false,
          diagnostics: [
            makeDiagnostic(
              'LIMIT_EXCEEDED',
              span,
              `JSON nesting depth exceeds maximum of ${maxDepth}.`,
              context,
            ),
          ],
        };
      }
    } else if (
      token === SYNTAX_KIND.CloseBraceToken ||
      token === SYNTAX_KIND.CloseBracketToken
    ) {
      depth = Math.max(0, depth - 1);
    } else if (token === SYNTAX_KIND.NumericLiteral) {
      const rawNumber = jsonText.slice(tokenOffset, tokenOffset + tokenLen);
      if (!STRICT_NUMBER_PATTERN.test(rawNumber)) {
        const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
        return {
          ok: false,
          diagnostics: [
            makeDiagnostic(
              'JSON_SYNTAX',
              span,
              `Invalid JSON number format "${rawNumber}".`,
              context,
            ),
          ],
        };
      }
      const parsedNum = Number(rawNumber);
      if (!Number.isFinite(parsedNum)) {
        const span = makeSpan(lineNumber, lineOffset, tokenOffset, tokenLen);
        return {
          ok: false,
          diagnostics: [
            makeDiagnostic(
              'JSON_SYNTAX',
              span,
              `JSON number "${rawNumber}" is not finite.`,
              context,
            ),
          ],
        };
      }
    }

    token = scanner.scan();
  }

  // Step 2: Parse into AST with jsonc-parser parseTree
  const parseErrors: ParseError[] = [];
  const rootNode = parseTree(jsonText, parseErrors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });

  if (parseErrors.length > 0 || !rootNode || rootNode.type !== 'object') {
    const diagnostics: ParseDiagnostic[] = [];
    if (parseErrors.length > 0) {
      const firstErr = parseErrors[0]!;
      const span = makeSpan(lineNumber, lineOffset, firstErr.offset, Math.max(1, firstErr.length));
      const codeName = printParseErrorCode(firstErr.error);
      diagnostics.push(
        makeDiagnostic('JSON_SYNTAX', span, `Invalid JSON syntax (${codeName}).`, context),
      );
    } else {
      const span = makeSpan(lineNumber, lineOffset, 0, Math.max(1, jsonText.length));
      diagnostics.push(
        makeDiagnostic('JSON_SYNTAX', span, 'Declaration tail must be a JSON object.', context),
      );
    }
    return {
      ok: false,
      diagnostics,
    };
  }

  // Step 3: Walk AST to detect duplicate keys, record spans, and build prototype-safe objects
  const keySpans = new Map<string, SourceSpan>();
  const valueSpans = new Map<string, SourceSpan>();
  const duplicateDiagnostics: ParseDiagnostic[] = [];

  const rootSpan = makeSpan(lineNumber, lineOffset, rootNode.offset, rootNode.length);
  valueSpans.set('', rootSpan);

  function evaluateNode(node: Node, relPath: string, currentDepth: number): unknown {
    if (currentDepth > maxDepth) {
      const span = makeSpan(lineNumber, lineOffset, node.offset, node.length);
      duplicateDiagnostics.push(
        makeDiagnostic(
          'LIMIT_EXCEEDED',
          span,
          `JSON nesting depth exceeds maximum of ${maxDepth}.`,
          context,
          context.basePath ? joinPath(context.basePath, relPath) : relPath,
        ),
      );
      return null;
    }

    const nodeSpan = makeSpan(lineNumber, lineOffset, node.offset, node.length);
    valueSpans.set(relPath, nodeSpan);

    switch (node.type) {
      case 'object': {
        const obj: Record<string, unknown> = {};
        const seenKeys = new Set<string>();
        const children = node.children ?? [];
        for (const propNode of children) {
          if (propNode.type !== 'property' || !propNode.children || propNode.children.length < 2) {
            continue;
          }
          const keyNode = propNode.children[0]!;
          const valNode = propNode.children[1]!;
          const key = String(keyNode.value ?? '');
          const propRelPath = joinPath(relPath, key);
          const fullIssuePath = context.basePath
            ? joinPath(context.basePath, propRelPath)
            : propRelPath;

          const kSpan = makeSpan(lineNumber, lineOffset, keyNode.offset, keyNode.length);
          keySpans.set(propRelPath, kSpan);

          if (seenKeys.has(key)) {
            duplicateDiagnostics.push(
              makeDiagnostic(
                'DUPLICATE_JSON_KEY',
                kSpan,
                `Duplicate JSON property key "${key}".`,
                context,
                fullIssuePath,
              ),
            );
          } else {
            seenKeys.add(key);
          }

          const evaluatedVal = evaluateNode(valNode, propRelPath, currentDepth + 1);
          Object.defineProperty(obj, key, {
            value: evaluatedVal,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return obj;
      }

      case 'array': {
        const children = node.children ?? [];
        const arr: unknown[] = [];
        for (let i = 0; i < children.length; i += 1) {
          const itemNode = children[i]!;
          const itemRelPath = joinPath(relPath, i);
          arr.push(evaluateNode(itemNode, itemRelPath, currentDepth + 1));
        }
        return arr;
      }

      case 'number': {
        const num = typeof node.value === 'number' ? normalizeZero(node.value) : Number(node.value);
        return normalizeZero(num);
      }

      case 'string':
      case 'boolean':
        return node.value;

      case 'null':
      default:
        return null;
    }
  }

  const evaluatedRoot = evaluateNode(rootNode, '', 1) as Record<string, unknown>;
  const spans: JsonObjectSpans = {
    root: rootSpan,
    keySpans,
    valueSpans,
  };

  if (duplicateDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: duplicateDiagnostics,
      spans,
    };
  }

  return {
    ok: true,
    value: evaluatedRoot,
    spans,
    diagnostics: [],
  };
}

/**
 * Formats a JavaScript value into canonical compact single-line JSON with
 * recursively sorted object keys, preserved array order, -0 normalized to 0,
 * and lone UTF-16 surrogates escaped via standard JSON.stringify.
 */
function canonicalizeForCompactJson(value: unknown): unknown {
  if (typeof value === 'number') {
    return normalizeZero(value);
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'undefined'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeForCompactJson);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const entry = record[key];
      if (entry !== undefined) {
        Object.defineProperty(out, key, {
          value: canonicalizeForCompactJson(entry),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return out;
  }
  return value;
}

export function formatCompactJson(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeForCompactJson(value));
}

export function formatJsonString(value: string): string {
  return JSON.stringify(value);
}

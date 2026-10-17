import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { DomainValidationError } from '../domain/errors';
import { normalizeZero } from '../domain/geometry';
import { utf8ByteLength } from '../domain/validation';

export const ICON_LIMITS = Object.freeze({
  MAX_ICON_SVG_BYTES: 64 * 1024,
  MAX_ICON_ELEMENTS: 256,
  MAX_ICON_DEPTH: 16,
  MAX_ICON_NUMBERS: 10_000,
  MAX_ICON_COORDINATE_ABS: 1_000_000,
  MAX_ICON_DIMENSION: 1_000_000,
  MAX_ICON_STROKE_WIDTH: 1_000,
});

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export type SafeSvgTagName =
  | 'svg'
  | 'g'
  | 'path'
  | 'rect'
  | 'circle'
  | 'ellipse'
  | 'line'
  | 'polyline'
  | 'polygon';

export interface SafeSvgViewBox {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface SafeSvgElementNode {
  readonly tag: Exclude<SafeSvgTagName, 'svg'>;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SafeSvgElementNode[];
}

export interface SafeSvgRootNode {
  readonly tag: 'svg';
  readonly viewBox: string;
  readonly parsedViewBox: SafeSvgViewBox;
  readonly xmlns: typeof SVG_NAMESPACE;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly SafeSvgElementNode[];
}

export type SafeIconTree = SafeSvgRootNode;

export type SafeIconParseResult =
  | {
      readonly ok: true;
      readonly tree: SafeSvgRootNode;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

export interface ResolvedCatalogIcon {
  readonly tree: SafeSvgRootNode;
  readonly isFallback: boolean;
  readonly warning?: {
    readonly code: string;
    readonly message: string;
  };
}

const ALLOWED_TAGS: ReadonlySet<SafeSvgTagName> = new Set<SafeSvgTagName>([
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
]);

const CONTAINER_ICON_TAGS: ReadonlySet<SafeSvgTagName> = new Set<SafeSvgTagName>(['svg', 'g']);

const PRESENTATION_ATTRIBUTES: ReadonlySet<string> = new Set([
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'fill-rule',
  'stroke-linecap',
  'stroke-linejoin',
]);

const GEOMETRY_ATTRIBUTES_BY_TAG: Readonly<Record<SafeSvgTagName, ReadonlySet<string>>> = {
  svg: new Set(['viewBox', 'xmlns']),
  g: new Set(),
  path: new Set(['d']),
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']),
  polygon: new Set(['points']),
};

const REQUIRED_GEOMETRY_BY_TAG: Readonly<Record<SafeSvgTagName, readonly string[]>> = {
  svg: ['viewBox'],
  g: [],
  path: ['d'],
  rect: ['width', 'height'],
  circle: ['r'],
  ellipse: ['rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const SVG_NUMBER_TOKEN_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FILL_RULES: ReadonlySet<string> = new Set(['nonzero', 'evenodd']);
const STROKE_LINECAPS: ReadonlySet<string> = new Set(['butt', 'round', 'square']);
const STROKE_LINEJOINS: ReadonlySet<string> = new Set(['miter', 'round', 'bevel']);
const ALLOWED_PATH_COMMANDS: ReadonlySet<string> = new Set([
  'M',
  'm',
  'L',
  'l',
  'H',
  'h',
  'V',
  'v',
  'C',
  'c',
  'Q',
  'q',
  'Z',
  'z',
]);

function parseStrictSvgNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed !== raw || !SVG_NUMBER_TOKEN_PATTERN.test(raw)) {
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return null;
  }
  return normalizeZero(num);
}

function isValidSvgColor(value: string): boolean {
  if (value === 'none' || value === 'currentColor') {
    return true;
  }
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Parses a sequence of SVG numbers separated by whitespace and/or single commas.
 * Rejects units, percentages, leading/trailing commas, or consecutive commas.
 */
function parseSvgNumberSequence(
  input: string,
  maxNumbersRemaining: number,
):
  | { ok: true; numbers: number[] }
  | { ok: false; code: string; message: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: 'ICON_ATTRIBUTE_VALUE_INVALID', message: 'Empty numeric sequence.' };
  }

  const numbers: number[] = [];
  let i = 0;
  const len = trimmed.length;
  let allowComma = false;
  let sawComma = false;

  while (i < len) {
    while (i < len && (trimmed[i] === ' ' || trimmed[i] === '\t' || trimmed[i] === '\r' || trimmed[i] === '\n')) {
      i += 1;
    }
    if (i >= len) break;

    if (trimmed[i] === ',') {
      if (!allowComma || sawComma) {
        return {
          ok: false,
          code: 'ICON_ATTRIBUTE_VALUE_INVALID',
          message: 'Unexpected comma in numeric sequence.',
        };
      }
      sawComma = true;
      i += 1;
      while (i < len && (trimmed[i] === ' ' || trimmed[i] === '\t' || trimmed[i] === '\r' || trimmed[i] === '\n')) {
        i += 1;
      }
      if (i >= len) {
        return {
          ok: false,
          code: 'ICON_ATTRIBUTE_VALUE_INVALID',
          message: 'Trailing comma in numeric sequence.',
        };
      }
    }

    const start = i;
    if (trimmed[i] === '+' || trimmed[i] === '-') {
      i += 1;
    }
    let digitsBefore = 0;
    while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
      i += 1;
      digitsBefore += 1;
    }
    let digitsAfter = 0;
    if (i < len && trimmed[i] === '.') {
      i += 1;
      while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
        i += 1;
        digitsAfter += 1;
      }
    }
    if (digitsBefore === 0 && digitsAfter === 0) {
      return {
        ok: false,
        code: 'ICON_ATTRIBUTE_VALUE_INVALID',
        message: `Invalid numeric token near "${trimmed.slice(start, Math.min(len, start + 12))}".`,
      };
    }
    if (i < len && (trimmed[i] === 'e' || trimmed[i] === 'E')) {
      i += 1;
      if (i < len && (trimmed[i] === '+' || trimmed[i] === '-')) {
        i += 1;
      }
      const expStart = i;
      while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
        i += 1;
      }
      if (i === expStart) {
        return {
          ok: false,
          code: 'ICON_ATTRIBUTE_VALUE_INVALID',
          message: 'Malformed exponent in SVG number.',
        };
      }
    }

    // Must be followed by whitespace, comma, or end of string (not units like px or % or another dot)
    if (
      i < len &&
      trimmed[i] !== ' ' &&
      trimmed[i] !== '\t' &&
      trimmed[i] !== '\r' &&
      trimmed[i] !== '\n' &&
      trimmed[i] !== ','
    ) {
      return {
        ok: false,
        code: 'ICON_ATTRIBUTE_VALUE_INVALID',
        message: 'Units, percentages, or adjacent invalid characters are not allowed in SVG numbers.',
      };
    }

    const tokenStr = trimmed.slice(start, i);
    const num = parseStrictSvgNumber(tokenStr);
    if (num === null) {
      return {
        ok: false,
        code: 'ICON_ATTRIBUTE_VALUE_INVALID',
        message: `Invalid SVG number "${tokenStr}".`,
      };
    }
    if (Math.abs(num) > ICON_LIMITS.MAX_ICON_COORDINATE_ABS) {
      return {
        ok: false,
        code: 'ICON_ATTRIBUTE_VALUE_INVALID',
        message: `SVG number ${num} exceeds coordinate limit of ${ICON_LIMITS.MAX_ICON_COORDINATE_ABS}.`,
      };
    }

    numbers.push(num);
    if (numbers.length > maxNumbersRemaining) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: `Icon numeric value count exceeds maximum of ${ICON_LIMITS.MAX_ICON_NUMBERS}.`,
      };
    }

    allowComma = true;
    sawComma = false;
  }

  return { ok: true, numbers };
}

/**
 * Validates an SVG path `d` attribute against the restricted S2 command set:
 * M/m, L/l, H/h, V/v, C/c, Q/q, Z/z.
 */
function validateSvgPathData(
  d: string,
  maxNumbersRemaining: number,
):
  | { ok: true; numberCount: number }
  | { ok: false; code: string; message: string } {
  const trimmed = d.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: 'ICON_INVALID_PATH',
      message: 'Path attribute "d" must not be empty.',
    };
  }

  let i = 0;
  const len = trimmed.length;
  let numberCount = 0;
  let commandIndex = 0;

  while (i < len) {
    while (i < len && (trimmed[i] === ' ' || trimmed[i] === '\t' || trimmed[i] === '\r' || trimmed[i] === '\n')) {
      i += 1;
    }
    if (i >= len) break;

    const cmd = trimmed[i]!;
    if (!ALLOWED_PATH_COMMANDS.has(cmd)) {
      return {
        ok: false,
        code: 'ICON_INVALID_PATH',
        message: `Unsupported or invalid SVG path command "${cmd}".`,
      };
    }
    if (commandIndex === 0 && cmd !== 'M' && cmd !== 'm') {
      return {
        ok: false,
        code: 'ICON_INVALID_PATH',
        message: 'SVG path data must start with an "M" or "m" moveto command.',
      };
    }
    commandIndex += 1;
    i += 1;

    const args: number[] = [];
    let allowComma = false;
    let sawComma = false;

    while (i < len) {
      while (
        i < len &&
        (trimmed[i] === ' ' || trimmed[i] === '\t' || trimmed[i] === '\r' || trimmed[i] === '\n')
      ) {
        i += 1;
      }
      if (i >= len) break;

      if (trimmed[i] === ',') {
        if (!allowComma || sawComma) {
          return {
            ok: false,
            code: 'ICON_INVALID_PATH',
            message: `Unexpected comma in path command "${cmd}".`,
          };
        }
        sawComma = true;
        i += 1;
        while (
          i < len &&
          (trimmed[i] === ' ' || trimmed[i] === '\t' || trimmed[i] === '\r' || trimmed[i] === '\n')
        ) {
          i += 1;
        }
        if (i >= len) {
          return {
            ok: false,
            code: 'ICON_INVALID_PATH',
            message: `Trailing comma in path command "${cmd}".`,
          };
        }
      }

      const ch = trimmed[i]!;
      if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z')) {
        if (sawComma) {
          return {
            ok: false,
            code: 'ICON_INVALID_PATH',
            message: `Trailing comma before path command "${ch}".`,
          };
        }
        break;
      }

      const start = i;
      if (trimmed[i] === '+' || trimmed[i] === '-') {
        i += 1;
      }
      let digitsBefore = 0;
      while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
        i += 1;
        digitsBefore += 1;
      }
      let digitsAfter = 0;
      if (i < len && trimmed[i] === '.') {
        i += 1;
        while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
          i += 1;
          digitsAfter += 1;
        }
      }
      if (digitsBefore === 0 && digitsAfter === 0) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Malformed number in path command "${cmd}".`,
        };
      }
      if (i < len && (trimmed[i] === 'e' || trimmed[i] === 'E')) {
        i += 1;
        if (i < len && (trimmed[i] === '+' || trimmed[i] === '-')) {
          i += 1;
        }
        const expStart = i;
        while (i < len && trimmed.charCodeAt(i) >= 48 && trimmed.charCodeAt(i) <= 57) {
          i += 1;
        }
        if (i === expStart) {
          return {
            ok: false,
            code: 'ICON_INVALID_PATH',
            message: `Malformed exponent in path command "${cmd}".`,
          };
        }
      }

      const tokenStr = trimmed.slice(start, i);
      const num = parseStrictSvgNumber(tokenStr);
      if (num === null) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Invalid number "${tokenStr}" in path command "${cmd}".`,
        };
      }
      if (Math.abs(num) > ICON_LIMITS.MAX_ICON_COORDINATE_ABS) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path coordinate ${num} exceeds maximum of ${ICON_LIMITS.MAX_ICON_COORDINATE_ABS}.`,
        };
      }

      args.push(num);
      numberCount += 1;
      if (numberCount > maxNumbersRemaining) {
        return {
          ok: false,
          code: 'LIMIT_EXCEEDED',
          message: `Icon numeric value count exceeds maximum of ${ICON_LIMITS.MAX_ICON_NUMBERS}.`,
        };
      }

      allowComma = true;
      sawComma = false;
    }

    const upper = cmd.toUpperCase();
    if (upper === 'Z') {
      if (args.length !== 0) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path command "${cmd}" does not accept numeric arguments.`,
        };
      }
    } else if (upper === 'H' || upper === 'V') {
      if (args.length < 1) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path command "${cmd}" requires at least 1 numeric argument.`,
        };
      }
    } else if (upper === 'M' || upper === 'L') {
      if (args.length < 2 || args.length % 2 !== 0) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path command "${cmd}" requires pairs of 2 numeric arguments (got ${args.length}).`,
        };
      }
    } else if (upper === 'Q') {
      if (args.length < 4 || args.length % 4 !== 0) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path command "${cmd}" requires groups of 4 numeric arguments (got ${args.length}).`,
        };
      }
    } else if (upper === 'C') {
      if (args.length < 6 || args.length % 6 !== 0) {
        return {
          ok: false,
          code: 'ICON_INVALID_PATH',
          message: `Path command "${cmd}" requires groups of 6 numeric arguments (got ${args.length}).`,
        };
      }
    }
  }

  if (commandIndex === 0) {
    return {
      ok: false,
      code: 'ICON_INVALID_PATH',
      message: 'Path attribute "d" contains no commands.',
    };
  }

  return { ok: true, numberCount };
}

function deepFreezeIconTree(root: SafeSvgRootNode): SafeSvgRootNode {
  function freezeChild(node: SafeSvgElementNode): SafeSvgElementNode {
    Object.freeze(node.attributes);
    for (const child of node.children) {
      freezeChild(child);
    }
    Object.freeze(node.children);
    return Object.freeze(node);
  }

  Object.freeze(root.parsedViewBox);
  Object.freeze(root.attributes);
  for (const child of root.children) {
    freezeChild(child);
  }
  Object.freeze(root.children);
  return Object.freeze(root);
}

interface MutableIconNode {
  tag: SafeSvgTagName;
  attributes: Record<string, string>;
  children: MutableIconNode[];
  viewBox?: string;
  parsedViewBox?: SafeSvgViewBox;
}

/**
 * Pure, DOM-free validator and parser that converts an SVG icon string into a
 * strictly whitelisted, deeply frozen SafeSvgRootNode tree.
 */
export function parseSafeIconSvg(svg: string): SafeIconParseResult {
  if (typeof svg !== 'string') {
    return {
      ok: false,
      code: 'ICON_INVALID_INPUT',
      message: 'Icon SVG input must be a string.',
    };
  }

  const trimmed = svg.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      code: 'ICON_EMPTY',
      message: 'Icon SVG string must not be empty.',
    };
  }

  const byteLen = utf8ByteLength(svg);
  if (byteLen > ICON_LIMITS.MAX_ICON_SVG_BYTES) {
    return {
      ok: false,
      code: 'LIMIT_EXCEEDED',
      message: `Icon SVG UTF-8 size (${byteLen} bytes) exceeds limit of ${ICON_LIMITS.MAX_ICON_SVG_BYTES} bytes.`,
    };
  }

  if (/<!doctype/i.test(svg) || /<!entity/i.test(svg)) {
    return {
      ok: false,
      code: 'ICON_DOCTYPE_FORBIDDEN',
      message: 'DOCTYPE and ENTITY declarations are forbidden in icon SVG.',
    };
  }

  const parser = new SaxesParser({
    xmlns: false,
    fragment: false,
    position: true,
  });

  const state: {
    failure: { code: string; message: string } | null;
    rootNode: MutableIconNode | null;
  } = {
    failure: null,
    rootNode: null,
  };
  let elementCount = 0;
  let totalNumbers = 0;
  const stack: MutableIconNode[] = [];

  function recordFailure(code: string, message: string): void {
    if (!state.failure) {
      state.failure = { code, message };
    }
  }

  parser.on('doctype', () => {
    recordFailure('ICON_DOCTYPE_FORBIDDEN', 'DOCTYPE declarations are forbidden in icon SVG.');
  });

  parser.on('xmldecl', () => {
    recordFailure('ICON_PI_FORBIDDEN', 'XML declarations and processing instructions are forbidden in icon SVG.');
  });

  parser.on('processinginstruction', () => {
    recordFailure('ICON_PI_FORBIDDEN', 'Processing instructions are forbidden in icon SVG.');
  });

  parser.on('cdata', () => {
    recordFailure('ICON_TEXT_FORBIDDEN', 'CDATA sections are forbidden in icon SVG.');
  });

  parser.on('text', (text: string) => {
    if (state.failure) return;
    if (!/^[ \t\r\n]*$/.test(text)) {
      recordFailure('ICON_TEXT_FORBIDDEN', 'Text content is not allowed inside decorative icon SVG elements.');
    }
  });

  parser.on('error', (err: Error) => {
    recordFailure('ICON_XML_SYNTAX', `Invalid XML in icon SVG: ${err.message}`);
  });

  parser.on('opentag', (tag: SaxesTagPlain) => {
    if (state.failure) return;

    const rawTagName = tag.name;
    if (rawTagName.includes(':')) {
      recordFailure(
        'ICON_NAMESPACE_FORBIDDEN',
        `Namespace prefixes are not allowed on SVG tag "${rawTagName}".`,
      );
      return;
    }

    if (!ALLOWED_TAGS.has(rawTagName as SafeSvgTagName)) {
      recordFailure(
        'ICON_TAG_FORBIDDEN',
        `Unsupported or forbidden SVG tag "<${rawTagName}>".`,
      );
      return;
    }

    const tagName = rawTagName as SafeSvgTagName;
    const isRoot = stack.length === 0 && state.rootNode === null;

    if (isRoot && tagName !== 'svg') {
      recordFailure('ICON_INVALID_ROOT', 'Root element of icon SVG must be "<svg>".');
      return;
    }

    if (!isRoot && tagName === 'svg') {
      recordFailure('ICON_NESTED_SVG_FORBIDDEN', 'Nested "<svg>" elements are not allowed.');
      return;
    }

    if (!isRoot) {
      const parent = stack[stack.length - 1];
      if (!parent) {
        recordFailure('ICON_INVALID_ROOT', 'Multiple root elements are not allowed in icon SVG.');
        return;
      }
      if (!CONTAINER_ICON_ICON_TAG_CHECK(parent.tag)) {
        recordFailure(
          'ICON_INVALID_HIERARCHY',
          `Element "<${parent.tag}>" cannot contain child element "<${tagName}>".`,
        );
        return;
      }
    }

    const nextDepth = stack.length + 1;
    if (nextDepth > ICON_LIMITS.MAX_ICON_DEPTH) {
      recordFailure(
        'LIMIT_EXCEEDED',
        `Icon SVG nesting depth (${nextDepth}) exceeds maximum of ${ICON_LIMITS.MAX_ICON_DEPTH}.`,
      );
      return;
    }

    elementCount += 1;
    if (elementCount > ICON_LIMITS.MAX_ICON_ELEMENTS) {
      recordFailure(
        'LIMIT_EXCEEDED',
        `Icon SVG element count exceeds maximum of ${ICON_LIMITS.MAX_ICON_ELEMENTS}.`,
      );
      return;
    }

    const allowedGeom = GEOMETRY_ATTRIBUTES_BY_TAG[tagName];
    const cleanAttributes: Record<string, string> = {};
    let parsedViewBox: SafeSvgViewBox | undefined;
    let normalizedViewBox: string | undefined;

    for (const attrName of Object.keys(tag.attributes)) {
      const attrVal = tag.attributes[attrName]!;

      if (attrName.includes(':') || (attrName === 'xmlns' && tagName !== 'svg')) {
        recordFailure(
          'ICON_NAMESPACE_FORBIDDEN',
          `Forbidden namespace or prefixed attribute "${attrName}" on "<${tagName}>".`,
        );
        return;
      }

      if (!PRESENTATION_ATTRIBUTES.has(attrName) && !allowedGeom.has(attrName)) {
        recordFailure(
          'ICON_ATTRIBUTE_FORBIDDEN',
          `Attribute "${attrName}" is not allowed on "<${tagName}>".`,
        );
        return;
      }

      // Validate presentation attributes
      if (attrName === 'fill' || attrName === 'stroke') {
        if (!isValidSvgColor(attrVal)) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid color "${attrVal}" for attribute "${attrName}"; only "none", "currentColor", or hex colors are allowed.`,
          );
          return;
        }
        cleanAttributes[attrName] = attrVal;
        continue;
      }

      if (attrName === 'stroke-width') {
        const num = parseStrictSvgNumber(attrVal);
        if (num === null || num < 0 || num > ICON_LIMITS.MAX_ICON_STROKE_WIDTH) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid stroke-width "${attrVal}"; must be a number between 0 and ${ICON_LIMITS.MAX_ICON_STROKE_WIDTH}.`,
          );
          return;
        }
        cleanAttributes[attrName] = String(num);
        continue;
      }

      if (attrName === 'opacity') {
        const num = parseStrictSvgNumber(attrVal);
        if (num === null || num < 0 || num > 1) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid opacity "${attrVal}"; must be a number between 0 and 1.`,
          );
          return;
        }
        cleanAttributes[attrName] = String(num);
        continue;
      }

      if (attrName === 'fill-rule') {
        if (!FILL_RULES.has(attrVal)) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid fill-rule "${attrVal}"; must be "nonzero" or "evenodd".`,
          );
          return;
        }
        cleanAttributes[attrName] = attrVal;
        continue;
      }

      if (attrName === 'stroke-linecap') {
        if (!STROKE_LINECAPS.has(attrVal)) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid stroke-linecap "${attrVal}"; must be "butt", "round", or "square".`,
          );
          return;
        }
        cleanAttributes[attrName] = attrVal;
        continue;
      }

      if (attrName === 'stroke-linejoin') {
        if (!STROKE_LINEJOINS.has(attrVal)) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Invalid stroke-linejoin "${attrVal}"; must be "miter", "round", or "bevel".`,
          );
          return;
        }
        cleanAttributes[attrName] = attrVal;
        continue;
      }

      // Root-only attributes
      if (attrName === 'xmlns') {
        if (attrVal !== SVG_NAMESPACE) {
          recordFailure(
            'ICON_NAMESPACE_FORBIDDEN',
            `Invalid SVG xmlns "${attrVal}"; must be "${SVG_NAMESPACE}".`,
          );
          return;
        }
        continue;
      }

      if (attrName === 'viewBox') {
        const seq = parseSvgNumberSequence(
          attrVal,
          ICON_LIMITS.MAX_ICON_NUMBERS - totalNumbers,
        );
        if (!seq.ok) {
          recordFailure(seq.code, seq.message);
          return;
        }
        if (seq.numbers.length !== 4) {
          recordFailure(
            'ICON_INVALID_VIEWBOX',
            'SVG viewBox must contain exactly 4 numbers (minX minY width height).',
          );
          return;
        }
        const [minX, minY, width, height] = seq.numbers as [number, number, number, number];
        if (
          width <= 0 ||
          height <= 0 ||
          width > ICON_LIMITS.MAX_ICON_DIMENSION ||
          height > ICON_LIMITS.MAX_ICON_DIMENSION
        ) {
          recordFailure(
            'ICON_INVALID_VIEWBOX',
            'SVG viewBox width and height must be positive numbers within dimension limits.',
          );
          return;
        }
        totalNumbers += 4;
        parsedViewBox = { minX, minY, width, height };
        normalizedViewBox = `${minX} ${minY} ${width} ${height}`;
        continue;
      }

      // Geometry attributes
      if (attrName === 'd') {
        const pathRes = validateSvgPathData(
          attrVal,
          ICON_LIMITS.MAX_ICON_NUMBERS - totalNumbers,
        );
        if (!pathRes.ok) {
          recordFailure(pathRes.code, pathRes.message);
          return;
        }
        totalNumbers += pathRes.numberCount;
        cleanAttributes.d = attrVal.trim();
        continue;
      }

      if (attrName === 'points') {
        const ptsRes = parseSvgNumberSequence(
          attrVal,
          ICON_LIMITS.MAX_ICON_NUMBERS - totalNumbers,
        );
        if (!ptsRes.ok) {
          recordFailure(ptsRes.code, ptsRes.message);
          return;
        }
        if (ptsRes.numbers.length < 4 || ptsRes.numbers.length % 2 !== 0) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Attribute "points" on "<${tagName}>" requires an even number of at least 4 coordinates.`,
          );
          return;
        }
        totalNumbers += ptsRes.numbers.length;
        cleanAttributes.points = attrVal.trim();
        continue;
      }

      if (
        attrName === 'width' ||
        attrName === 'height' ||
        attrName === 'r' ||
        attrName === 'rx' ||
        attrName === 'ry'
      ) {
        const num = parseStrictSvgNumber(attrVal);
        if (num === null || num < 0 || num > ICON_LIMITS.MAX_ICON_DIMENSION) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Attribute "${attrName}" on "<${tagName}>" must be a non-negative number <= ${ICON_LIMITS.MAX_ICON_DIMENSION}.`,
          );
          return;
        }
        totalNumbers += 1;
        if (totalNumbers > ICON_LIMITS.MAX_ICON_NUMBERS) {
          recordFailure(
            'LIMIT_EXCEEDED',
            `Icon numeric value count exceeds maximum of ${ICON_LIMITS.MAX_ICON_NUMBERS}.`,
          );
          return;
        }
        cleanAttributes[attrName] = String(num);
        continue;
      }

      if (
        attrName === 'x' ||
        attrName === 'y' ||
        attrName === 'cx' ||
        attrName === 'cy' ||
        attrName === 'x1' ||
        attrName === 'y1' ||
        attrName === 'x2' ||
        attrName === 'y2'
      ) {
        const num = parseStrictSvgNumber(attrVal);
        if (num === null || Math.abs(num) > ICON_LIMITS.MAX_ICON_COORDINATE_ABS) {
          recordFailure(
            'ICON_ATTRIBUTE_VALUE_INVALID',
            `Attribute "${attrName}" on "<${tagName}>" must be a finite number within ±${ICON_LIMITS.MAX_ICON_COORDINATE_ABS}.`,
          );
          return;
        }
        totalNumbers += 1;
        if (totalNumbers > ICON_LIMITS.MAX_ICON_NUMBERS) {
          recordFailure(
            'LIMIT_EXCEEDED',
            `Icon numeric value count exceeds maximum of ${ICON_LIMITS.MAX_ICON_NUMBERS}.`,
          );
          return;
        }
        cleanAttributes[attrName] = String(num);
        continue;
      }
    }

    // Verify required geometry attributes for this tag
    const requiredAttrs = REQUIRED_GEOMETRY_BY_TAG[tagName];
    for (const reqAttr of requiredAttrs) {
      if (reqAttr === 'viewBox') {
        if (!parsedViewBox || !normalizedViewBox) {
          recordFailure(
            'ICON_MISSING_VIEWBOX',
            'Root "<svg>" element requires a valid "viewBox" attribute.',
          );
          return;
        }
      } else if (!Object.prototype.hasOwnProperty.call(cleanAttributes, reqAttr)) {
        recordFailure(
          'ICON_MISSING_GEOMETRY',
          `Element "<${tagName}>" is missing required geometry attribute "${reqAttr}".`,
        );
        return;
      }
    }

    const node: MutableIconNode = {
      tag: tagName,
      attributes: cleanAttributes,
      children: [],
      ...(parsedViewBox ? { parsedViewBox } : {}),
      ...(normalizedViewBox ? { viewBox: normalizedViewBox } : {}),
    };

    if (isRoot) {
      state.rootNode = node;
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    stack.push(node);
  });

  parser.on('closetag', () => {
    if (state.failure) return;
    stack.pop();
  });

  try {
    parser.write(svg).close();
  } catch (err) {
    recordFailure(
      'ICON_XML_SYNTAX',
      err instanceof Error ? err.message : 'Invalid XML in icon SVG.',
    );
  }

  if (state.failure) {
    return {
      ok: false,
      code: state.failure.code,
      message: state.failure.message,
    };
  }

  const root = state.rootNode;
  if (!root || root.tag !== 'svg' || !root.parsedViewBox || !root.viewBox) {
    return {
      ok: false,
      code: 'ICON_INVALID_ROOT',
      message: 'Icon SVG did not produce a valid "<svg>" root element.',
    };
  }

  function toSafeElementNode(node: MutableIconNode): SafeSvgElementNode {
    return {
      tag: node.tag as Exclude<SafeSvgTagName, 'svg'>,
      attributes: { ...node.attributes },
      children: node.children.map(toSafeElementNode),
    };
  }

  const safeRoot: SafeSvgRootNode = deepFreezeIconTree({
    tag: 'svg',
    viewBox: root.viewBox,
    parsedViewBox: root.parsedViewBox,
    xmlns: SVG_NAMESPACE,
    attributes: { ...root.attributes },
    children: root.children.map(toSafeElementNode),
  });

  return {
    ok: true,
    tree: safeRoot,
  };
}

function CONTAINER_ICON_ICON_TAG_CHECK(tag: SafeSvgTagName): boolean {
  return CONTAINER_ICON_TAGS.has(tag);
}

/**
 * Validates an icon SVG string and returns its deeply frozen SafeSvgRootNode tree,
 * or throws DomainValidationError with path and stable code.
 */
export function validateSafeIconSvg(svg: unknown, path = 'iconSvg'): SafeSvgRootNode {
  if (typeof svg !== 'string') {
    throw new DomainValidationError([
      {
        path,
        code: 'ICON_INVALID_INPUT',
        message: 'Icon SVG must be a string.',
      },
    ]);
  }
  const result = parseSafeIconSvg(svg);
  if (!result.ok) {
    throw new DomainValidationError([
      {
        path,
        code: result.code,
        message: result.message,
      },
    ]);
  }
  return result.tree;
}

export const GENERIC_FALLBACK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';

const parsedFallback = parseSafeIconSvg(GENERIC_FALLBACK_ICON_SVG);
if (!parsedFallback.ok) {
  throw new Error(`Internal error: GENERIC_FALLBACK_ICON_SVG failed validation: ${parsedFallback.message}`);
}

export const GENERIC_FALLBACK_ICON_TREE: SafeSvgRootNode = parsedFallback.tree;

/**
 * Resolves a decorative component icon into a safe, DOM-free SVG node tree.
 * Missing or unsupported icons (e.g. legacy icons outside the S2 subset) fall back
 * to GENERIC_FALLBACK_ICON_TREE with a structured warning, without mutating the document.
 */
export function resolveCatalogIcon(iconSvg?: string): ResolvedCatalogIcon {
  if (iconSvg === undefined) {
    return {
      tree: GENERIC_FALLBACK_ICON_TREE,
      isFallback: true,
    };
  }

  const parsed = parseSafeIconSvg(iconSvg);
  if (parsed.ok) {
    return {
      tree: parsed.tree,
      isFallback: false,
    };
  }

  return {
    tree: GENERIC_FALLBACK_ICON_TREE,
    isFallback: true,
    warning: {
      code: parsed.code,
      message: parsed.message,
    },
  };
}

// Convenient aliases for UI/adapter consumers
export const parseIconSvg = parseSafeIconSvg;
export const resolveIconTree = resolveCatalogIcon;

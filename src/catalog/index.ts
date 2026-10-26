import {
  createScanner,
  parseTree,
  printParseErrorCode,
  type Node,
  type ParseError,
} from 'jsonc-parser';
import { SCRIPT_V1_DEFAULT_STYLE } from '../codec';
import {
  applyCommand,
  DEFAULT_PAGE_ID,
  DOMAIN_LIMITS,
  DomainValidationError,
  serializeDocument,
  validateDocument,
} from '../domain';
import {
  areComponentSetsEqual,
  cloneComponentSet,
  cloneElement,
  normalizeZero,
} from '../domain/geometry';
import type {
  ComponentDefinition,
  ComponentSet,
  DocumentCommand,
  ElementStyle,
  Point,
  SketchDocument,
  SketchElement,
  ValidationIssue,
} from '../domain/types';
import {
  checkObjectKeys,
  isPlainRecord,
  joinPath,
  utf8ByteLength,
  validateDocumentationUrl,
  validateIdField,
  validatePoint,
  validateStringMetadata,
  validateStyle,
} from '../domain/validation';
import { awsGroupById, GROUP_METADATA_KEY } from './aws-groups';
import { builtInComponentSets } from './builtin';
import { ICON_LIMITS, parseSafeIconSvg } from './icon';

export { builtInComponentSets } from './builtin';
export * from './aws-groups';
export * from './icon';
export * from './resource-card';

export const CATALOG_LIMITS = Object.freeze({
  MAX_COMPONENT_SET_JSON_BYTES: 2 * 1024 * 1024,
  MAX_JSON_DEPTH: 64,
  MAX_SETS_PER_DOCUMENT: 128,
  MAX_TOTAL_DEFINITIONS: 2_000,
  MAX_ALIASES_PER_DEFINITION: 200,
  MAX_WIDGETS_PER_DEFINITION: 32,
  MAX_OPTIONS_PER_SELECT_WIDGET: 100,
  MAX_VERSION_LENGTH: 64,
  ...ICON_LIMITS,
});

export interface InstantiateComponentRequest {
  set: ComponentSet;
  type: string;
  id: string;
  at: Point; // absolute top-left document coordinates
  parentId?: string;
  /** Page of the new element; defaults to the first page. */
  pageId?: string;
  label?: string;
  metadata?: Record<string, string>;
}

export interface ComponentInstantiation {
  element: SketchElement;
  command: DocumentCommand;
}

export interface CatalogSearchResult {
  readonly set: ComponentSet;
  readonly component: ComponentDefinition;
}

const COMPONENT_SET_KEYS: ReadonlySet<string> = new Set(['id', 'name', 'version', 'components']);
const COMPONENT_DEF_KEYS: ReadonlySet<string> = new Set([
  'type',
  'name',
  'provider',
  'category',
  'aliases',
  'defaultWidth',
  'defaultHeight',
  'style',
  'metadata',
  'documentationUrl',
  'iconSvg',
  'widgets',
]);
const WIDGET_KEYS: ReadonlySet<string> = new Set(['key', 'label', 'kind', 'options']);
const INSTANTIATE_REQUEST_KEYS: ReadonlySet<string> = new Set([
  'set',
  'type',
  'id',
  'pageId',
  'at',
  'parentId',
  'label',
  'metadata',
]);

const PROVIDERS: ReadonlySet<ComponentDefinition['provider']> = new Set([
  'aws',
  'azure',
  'gcp',
  'kubernetes',
  'generic',
  'custom',
]);
const WIDGET_KINDS: ReadonlySet<'text' | 'number' | 'select'> = new Set([
  'text',
  'number',
  'select',
]);

const WIDGET_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;
const STRICT_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function hasValidProviderNamespace(
  type: string,
  provider: ComponentDefinition['provider'],
): boolean {
  const prefix = `${provider}.`;
  if (!type.startsWith(prefix)) {
    return false;
  }
  const rest = type.slice(prefix.length);
  if (rest.length === 0 || rest.startsWith('.') || rest.endsWith('.') || rest.includes('..')) {
    return false;
  }
  const segments = rest.split('.');
  if (provider === 'custom') {
    // custom.<org>.<name> requires at least 2 segments after "custom."
    return segments.length >= 2 && segments.every((seg) => seg.length > 0);
  }
  return segments.length >= 1 && segments.every((seg) => seg.length > 0);
}

/**
 * Formats a widget metadata key (`widget:<componentType>:<widgetKey>`).
 */
export function formatWidgetMetadataKey(componentType: string, widgetKey: string): string {
  return `widget:${componentType}:${widgetKey}`;
}

/**
 * Parses a metadata key with the `widget:` prefix into its `componentType` and `widgetKey` parts.
 */
export function parseWidgetMetadataKey(
  key: string,
): { componentType: string; widgetKey: string } | null {
  if (!key.startsWith('widget:')) {
    return null;
  }
  const rest = key.slice('widget:'.length);
  const lastColon = rest.lastIndexOf(':');
  if (lastColon <= 0 || lastColon >= rest.length - 1) {
    return null;
  }
  const componentType = rest.slice(0, lastColon);
  const widgetKey = rest.slice(lastColon + 1);
  return { componentType, widgetKey };
}

/**
 * Validates a single widget string value against its widget definition.
 * Throws DomainValidationError if invalid.
 */
export function validateWidgetValue(
  widget: NonNullable<ComponentDefinition['widgets']>[number],
  value: unknown,
  path = 'metadata',
): string {
  if (typeof value !== 'string') {
    throw new DomainValidationError([
      {
        path,
        code: 'INVALID_WIDGET_VALUE',
        message: `Widget "${widget.key}" value must be a string.`,
      },
    ]);
  }
  if (value.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
    throw new DomainValidationError([
      {
        path,
        code: 'TEXT_TOO_LONG',
        message: `Widget "${widget.key}" value exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
      },
    ]);
  }

  if (widget.kind === 'number') {
    if (value.length === 0 || value.trim() !== value) {
      throw new DomainValidationError([
        {
          path,
          code: 'INVALID_WIDGET_VALUE',
          message: `Numeric widget "${widget.key}" requires a canonical finite JSON number string.`,
        },
      ]);
    }
    const num = Number(value);
    if (!Number.isFinite(num) || Object.is(num, -0) || String(num) !== value) {
      throw new DomainValidationError([
        {
          path,
          code: 'INVALID_WIDGET_VALUE',
          message: `Numeric widget "${widget.key}" value "${value}" is not a canonical finite JSON number string.`,
        },
      ]);
    }
  } else if (widget.kind === 'select') {
    if (!Array.isArray(widget.options) || !widget.options.includes(value)) {
      throw new DomainValidationError([
        {
          path,
          code: 'INVALID_WIDGET_VALUE',
          message: `Select widget "${widget.key}" value "${value}" is not among declared options.`,
        },
      ]);
    }
  }

  return value;
}

/**
 * Validates a ComponentSet for new catalog import or component instantiation.
 * Enforces S2 provider namespace rules, widget rules, version rules, and safe SVG icon rules.
 * Returns a detached clone of the validated ComponentSet.
 */
export function validateComponentSet(input: unknown): ComponentSet {
  const issues: ValidationIssue[] = [];
  const ancestors = new Set<object>();

  if (!isPlainRecord(input)) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'INVALID_COMPONENT_SET',
        message: 'ComponentSet must be a plain object.',
      },
    ]);
  }

  ancestors.add(input);
  checkObjectKeys(input, '', COMPONENT_SET_KEYS, issues);

  validateIdField(input.id, 'id', issues);

  if (
    typeof input.name !== 'string' ||
    input.name.trim().length === 0 ||
    input.name.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
  ) {
    issues.push({
      path: 'name',
      code: 'INVALID_COMPONENT_SET_NAME',
      message: 'ComponentSet name must be a non-empty string within text limits.',
    });
  }

  if (
    typeof input.version !== 'string' ||
    input.version.length === 0 ||
    input.version.length > CATALOG_LIMITS.MAX_VERSION_LENGTH ||
    input.version.trim().length === 0 ||
    CONTROL_CHAR_PATTERN.test(input.version)
  ) {
    issues.push({
      path: 'version',
      code: 'INVALID_COMPONENT_SET_VERSION',
      message: `ComponentSet version must be a non-empty string up to ${CATALOG_LIMITS.MAX_VERSION_LENGTH} characters without control characters.`,
    });
  }

  if (!Array.isArray(input.components)) {
    issues.push({
      path: 'components',
      code: 'INVALID_COMPONENTS',
      message: 'ComponentSet components must be an array.',
    });
  } else if (ancestors.has(input.components)) {
    issues.push({
      path: 'components',
      code: 'CYCLIC_OBJECT',
      message: 'Cyclic reference in ComponentSet components.',
    });
  } else {
    ancestors.add(input.components);
    if (input.components.length > CATALOG_LIMITS.MAX_TOTAL_DEFINITIONS) {
      issues.push({
        path: 'components',
        code: 'LIMIT_EXCEEDED',
        message: `ComponentSet definition count (${input.components.length}) exceeds maximum of ${CATALOG_LIMITS.MAX_TOTAL_DEFINITIONS}.`,
      });
    }

    const seenTypes = new Set<string>();
    const compLimit = Math.min(input.components.length, CATALOG_LIMITS.MAX_TOTAL_DEFINITIONS);

    for (let i = 0; i < compLimit; i += 1) {
      const comp = input.components[i];
      const compPath = joinPath('components', i);
      if (!isPlainRecord(comp)) {
        issues.push({
          path: compPath,
          code: 'INVALID_COMPONENT_DEFINITION',
          message: 'ComponentDefinition must be a plain object.',
        });
        continue;
      }
      if (ancestors.has(comp)) {
        issues.push({
          path: compPath,
          code: 'CYCLIC_OBJECT',
          message: 'Cyclic reference in ComponentDefinition.',
        });
        continue;
      }
      ancestors.add(comp);
      checkObjectKeys(comp, compPath, COMPONENT_DEF_KEYS, issues);

      const providerValid =
        typeof comp.provider === 'string' &&
        PROVIDERS.has(comp.provider as ComponentDefinition['provider']);
      if (!providerValid) {
        issues.push({
          path: joinPath(compPath, 'provider'),
          code: 'INVALID_COMPONENT_PROVIDER',
          message: 'ComponentDefinition provider must be aws, azure, gcp, kubernetes, generic, or custom.',
        });
      }

      const typePath = joinPath(compPath, 'type');
      if (validateIdField(comp.type, typePath, issues)) {
        if (seenTypes.has(comp.type)) {
          issues.push({
            path: typePath,
            code: 'COMPONENT_TYPE_COLLISION',
            message: `Duplicate component type "${comp.type}" within ComponentSet.`,
          });
        } else {
          seenTypes.add(comp.type);
        }

        if (
          providerValid &&
          !hasValidProviderNamespace(comp.type, comp.provider as ComponentDefinition['provider'])
        ) {
          issues.push({
            path: typePath,
            code: 'INVALID_COMPONENT_TYPE_NAMESPACE',
            message:
              comp.provider === 'custom'
                ? `Custom component type "${comp.type}" must start with "custom.<org>.<name>".`
                : `Component type "${comp.type}" must start with provider prefix "${String(comp.provider)}.".`,
          });
        }
      }

      if (
        typeof comp.name !== 'string' ||
        comp.name.trim().length === 0 ||
        comp.name.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
      ) {
        issues.push({
          path: joinPath(compPath, 'name'),
          code: 'INVALID_COMPONENT_NAME',
          message: 'ComponentDefinition name must be a non-empty string.',
        });
      }

      if (
        typeof comp.category !== 'string' ||
        comp.category.trim().length === 0 ||
        comp.category.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
      ) {
        issues.push({
          path: joinPath(compPath, 'category'),
          code: 'INVALID_COMPONENT_CATEGORY',
          message: 'ComponentDefinition category must be a non-empty string.',
        });
      }

      for (const dimKey of ['defaultWidth', 'defaultHeight'] as const) {
        const dim = comp[dimKey];
        if (
          typeof dim !== 'number' ||
          !Number.isFinite(dim) ||
          dim <= 0 ||
          dim > DOMAIN_LIMITS.MAX_DIMENSION
        ) {
          issues.push({
            path: joinPath(compPath, dimKey),
            code: 'INVALID_DIMENSION',
            message: `ComponentDefinition ${dimKey} must be a positive finite number <= ${DOMAIN_LIMITS.MAX_DIMENSION}.`,
          });
        }
      }

      validateStyle(comp.style, joinPath(compPath, 'style'), ancestors, issues, true);

      if (Object.prototype.hasOwnProperty.call(comp, 'aliases') && comp.aliases !== undefined) {
        const aliasesPath = joinPath(compPath, 'aliases');
        if (!Array.isArray(comp.aliases)) {
          issues.push({
            path: aliasesPath,
            code: 'INVALID_ALIASES',
            message: 'ComponentDefinition aliases must be an array of strings.',
          });
        } else if (ancestors.has(comp.aliases)) {
          issues.push({
            path: aliasesPath,
            code: 'CYCLIC_OBJECT',
            message: 'Cyclic reference in ComponentDefinition aliases.',
          });
        } else {
          if (comp.aliases.length > CATALOG_LIMITS.MAX_ALIASES_PER_DEFINITION) {
            issues.push({
              path: aliasesPath,
              code: 'LIMIT_EXCEEDED',
              message: `ComponentDefinition aliases count (${comp.aliases.length}) exceeds maximum of ${CATALOG_LIMITS.MAX_ALIASES_PER_DEFINITION}.`,
            });
          }
          const aliasLimit = Math.min(
            comp.aliases.length,
            CATALOG_LIMITS.MAX_ALIASES_PER_DEFINITION,
          );
          for (let aIdx = 0; aIdx < aliasLimit; aIdx += 1) {
            validateIdField(comp.aliases[aIdx], joinPath(aliasesPath, aIdx), issues);
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'metadata') && comp.metadata !== undefined) {
        validateStringMetadata(comp.metadata, joinPath(compPath, 'metadata'), ancestors, issues);
      }

      if (
        Object.prototype.hasOwnProperty.call(comp, 'documentationUrl') &&
        comp.documentationUrl !== undefined
      ) {
        validateDocumentationUrl(
          comp.documentationUrl,
          joinPath(compPath, 'documentationUrl'),
          issues,
        );
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'iconSvg') && comp.iconSvg !== undefined) {
        const iconPath = joinPath(compPath, 'iconSvg');
        if (typeof comp.iconSvg !== 'string') {
          issues.push({
            path: iconPath,
            code: 'UNSAFE_ICON_SVG',
            message: 'ComponentDefinition iconSvg must be a string.',
          });
        } else {
          const iconRes = parseSafeIconSvg(comp.iconSvg);
          if (!iconRes.ok) {
            issues.push({
              path: iconPath,
              code: iconRes.code,
              message: iconRes.message,
            });
          } else if (comp.iconSvg.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
            issues.push({
              path: iconPath,
              code: 'LIMIT_EXCEEDED',
              message: `ComponentDefinition iconSvg length (${comp.iconSvg.length}) exceeds maximum of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
            });
          }
        }
      }

      if (Object.prototype.hasOwnProperty.call(comp, 'widgets') && comp.widgets !== undefined) {
        const widgetsPath = joinPath(compPath, 'widgets');
        if (!Array.isArray(comp.widgets)) {
          issues.push({
            path: widgetsPath,
            code: 'INVALID_WIDGETS',
            message: 'ComponentDefinition widgets must be an array.',
          });
        } else if (ancestors.has(comp.widgets)) {
          issues.push({
            path: widgetsPath,
            code: 'CYCLIC_OBJECT',
            message: 'Cyclic reference in ComponentDefinition widgets.',
          });
        } else {
          ancestors.add(comp.widgets);
          if (comp.widgets.length > CATALOG_LIMITS.MAX_WIDGETS_PER_DEFINITION) {
            issues.push({
              path: widgetsPath,
              code: 'LIMIT_EXCEEDED',
              message: `Widget count (${comp.widgets.length}) exceeds maximum of ${CATALOG_LIMITS.MAX_WIDGETS_PER_DEFINITION} per definition.`,
            });
          }
          const seenWidgetKeys = new Set<string>();
          const widgetLimit = Math.min(
            comp.widgets.length,
            CATALOG_LIMITS.MAX_WIDGETS_PER_DEFINITION,
          );
          for (let wIdx = 0; wIdx < widgetLimit; wIdx += 1) {
            const widget = comp.widgets[wIdx];
            const wPath = joinPath(widgetsPath, wIdx);
            if (!isPlainRecord(widget)) {
              issues.push({
                path: wPath,
                code: 'INVALID_WIDGET',
                message: 'Widget must be a plain object.',
              });
              continue;
            }
            if (ancestors.has(widget)) {
              issues.push({
                path: wPath,
                code: 'CYCLIC_OBJECT',
                message: 'Cyclic reference in widget.',
              });
              continue;
            }
            ancestors.add(widget);
            checkObjectKeys(widget, wPath, WIDGET_KEYS, issues);

            const keyPath = joinPath(wPath, 'key');
            if (typeof widget.key !== 'string' || !WIDGET_KEY_PATTERN.test(widget.key)) {
              issues.push({
                path: keyPath,
                code: 'INVALID_WIDGET_KEY',
                message: 'Widget key must match [A-Za-z][A-Za-z0-9_-]{0,63}.',
              });
            } else if (seenWidgetKeys.has(widget.key)) {
              issues.push({
                path: keyPath,
                code: 'DUPLICATE_WIDGET_KEY',
                message: `Duplicate widget key "${widget.key}" in component definition.`,
              });
            } else {
              seenWidgetKeys.add(widget.key);
            }

            if (
              typeof widget.label !== 'string' ||
              widget.label.trim().length === 0 ||
              widget.label.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
            ) {
              issues.push({
                path: joinPath(wPath, 'label'),
                code: 'INVALID_WIDGET_LABEL',
                message: 'Widget label must be a non-empty string.',
              });
            }

            const wKind = widget.kind;
            const kindValid =
              typeof wKind === 'string' &&
              WIDGET_KINDS.has(wKind as 'text' | 'number' | 'select');
            if (!kindValid) {
              issues.push({
                path: joinPath(wPath, 'kind'),
                code: 'INVALID_WIDGET_KIND',
                message: 'Widget kind must be "text", "number", or "select".',
              });
            }

            const hasOptions =
              Object.prototype.hasOwnProperty.call(widget, 'options') &&
              widget.options !== undefined;
            const optionsPath = joinPath(wPath, 'options');

            if (wKind === 'select') {
              if (!hasOptions || !Array.isArray(widget.options) || widget.options.length === 0) {
                issues.push({
                  path: optionsPath,
                  code: 'INVALID_WIDGET_OPTIONS',
                  message: 'Select widget requires a non-empty array of options.',
                });
              } else if (ancestors.has(widget.options)) {
                issues.push({
                  path: optionsPath,
                  code: 'CYCLIC_OBJECT',
                  message: 'Cyclic reference in widget options.',
                });
              } else {
                if (widget.options.length > CATALOG_LIMITS.MAX_OPTIONS_PER_SELECT_WIDGET) {
                  issues.push({
                    path: optionsPath,
                    code: 'LIMIT_EXCEEDED',
                    message: `Select widget options count (${widget.options.length}) exceeds maximum of ${CATALOG_LIMITS.MAX_OPTIONS_PER_SELECT_WIDGET}.`,
                  });
                }
                const seenOpts = new Set<string>();
                const optLimit = Math.min(
                  widget.options.length,
                  CATALOG_LIMITS.MAX_OPTIONS_PER_SELECT_WIDGET,
                );
                for (let oIdx = 0; oIdx < optLimit; oIdx += 1) {
                  const opt = widget.options[oIdx];
                  const optPath = joinPath(optionsPath, oIdx);
                  if (
                    typeof opt !== 'string' ||
                    opt.length === 0 ||
                    opt.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH
                  ) {
                    issues.push({
                      path: optPath,
                      code: 'INVALID_WIDGET_OPTIONS',
                      message: 'Select widget option must be a non-empty string.',
                    });
                  } else if (seenOpts.has(opt)) {
                    issues.push({
                      path: optPath,
                      code: 'DUPLICATE_WIDGET_OPTION',
                      message: `Duplicate select widget option "${opt}".`,
                    });
                  } else {
                    seenOpts.add(opt);
                  }
                }
              }
            } else if (hasOptions) {
              issues.push({
                path: optionsPath,
                code: 'INVALID_WIDGET_OPTIONS',
                message: 'Widget options are only allowed when widget kind is "select".',
              });
            }

            ancestors.delete(widget);
          }
          ancestors.delete(comp.widgets);
        }
      }

      // If definition has default metadata with widget: keys, validate those widget values as well
      if (
        comp.metadata !== undefined &&
        isPlainRecord(comp.metadata) &&
        typeof comp.type === 'string'
      ) {
        const widgetsByKey = new Map<
          string,
          NonNullable<ComponentDefinition['widgets']>[number]
        >();
        if (Array.isArray(comp.widgets)) {
          for (const w of comp.widgets) {
            if (isPlainRecord(w) && typeof w.key === 'string') {
              widgetsByKey.set(
                w.key,
                w as NonNullable<ComponentDefinition['widgets']>[number],
              );
            }
          }
        }
        for (const mKey of Object.keys(comp.metadata)) {
          if (!mKey.startsWith('widget:')) continue;
          const parsedKey = parseWidgetMetadataKey(mKey);
          const mPath = joinPath(joinPath(compPath, 'metadata'), mKey);
          if (!parsedKey || parsedKey.componentType !== comp.type) {
            issues.push({
              path: mPath,
              code: 'INVALID_WIDGET_NAMESPACE',
              message: `Widget metadata key "${mKey}" does not match component type "${comp.type}".`,
            });
            continue;
          }
          const wDef = widgetsByKey.get(parsedKey.widgetKey);
          if (!wDef) {
            issues.push({
              path: mPath,
              code: 'UNKNOWN_WIDGET_KEY',
              message: `Widget metadata key "${mKey}" references unknown widget "${parsedKey.widgetKey}".`,
            });
            continue;
          }
          try {
            validateWidgetValue(wDef, comp.metadata[mKey], mPath);
          } catch (err) {
            if (err instanceof DomainValidationError) {
              issues.push(...err.issues);
            }
          }
        }
      }

      ancestors.delete(comp);
    }

    ancestors.delete(input.components);
  }

  ancestors.delete(input);

  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  return cloneComponentSet(input as unknown as ComponentSet);
}

/**
 * Parses a JSON string (up to 2 MiB UTF-8) into a validated ComponentSet.
 * Rejects comments, trailing commas, duplicate keys, forbidden keys, and unknown fields.
 */
export function parseComponentSet(source: string): ComponentSet {
  if (typeof source !== 'string') {
    throw new DomainValidationError([
      {
        path: '',
        code: 'JSON_SYNTAX',
        message: 'ComponentSet JSON source must be a string.',
      },
    ]);
  }

  if (
    source.length > CATALOG_LIMITS.MAX_COMPONENT_SET_JSON_BYTES ||
    utf8ByteLength(source) > CATALOG_LIMITS.MAX_COMPONENT_SET_JSON_BYTES
  ) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'LIMIT_EXCEEDED',
        message: `ComponentSet JSON UTF-8 size exceeds limit of ${CATALOG_LIMITS.MAX_COMPONENT_SET_JSON_BYTES} bytes.`,
      },
    ]);
  }

  const normalized = source.startsWith('\uFEFF') ? source.slice(1) : source;

  // Iterative token scan before parseTree recursion
  const scanner = createScanner(normalized, false);
  let depth = 0;
  let token = scanner.scan();

  while (token !== 17 /* EOF */) {
    const scanErr = scanner.getTokenError();
    const tokenOffset = scanner.getTokenOffset();
    const tokenLen = scanner.getTokenLength();

    if (scanErr !== 0 /* None */) {
      throw new DomainValidationError([
        {
          path: '',
          code: 'JSON_SYNTAX',
          message: `Invalid JSON token at offset ${tokenOffset}.`,
        },
      ]);
    }

    if (token === 12 /* LineCommentTrivia */ || token === 13 /* BlockCommentTrivia */) {
      throw new DomainValidationError([
        {
          path: '',
          code: 'JSON_SYNTAX',
          message: 'Comments are not allowed in ComponentSet JSON.',
        },
      ]);
    }

    if (token === 16 /* Unknown */) {
      throw new DomainValidationError([
        {
          path: '',
          code: 'JSON_SYNTAX',
          message: `Unexpected symbol at offset ${tokenOffset}.`,
        },
      ]);
    }

    if (token === 1 /* OpenBraceToken */ || token === 3 /* OpenBracketToken */) {
      depth += 1;
      if (depth > CATALOG_LIMITS.MAX_JSON_DEPTH) {
        throw new DomainValidationError([
          {
            path: '',
            code: 'LIMIT_EXCEEDED',
            message: `JSON nesting depth exceeds maximum of ${CATALOG_LIMITS.MAX_JSON_DEPTH}.`,
          },
        ]);
      }
    } else if (token === 2 /* CloseBraceToken */ || token === 4 /* CloseBracketToken */) {
      depth = Math.max(0, depth - 1);
    } else if (token === 11 /* NumericLiteral */) {
      const rawNum = normalized.slice(tokenOffset, tokenOffset + tokenLen);
      if (!STRICT_NUMBER_PATTERN.test(rawNum) || !Number.isFinite(Number(rawNum))) {
        throw new DomainValidationError([
          {
            path: '',
            code: 'JSON_SYNTAX',
            message: `Invalid or non-finite JSON number "${rawNum}".`,
          },
        ]);
      }
    }

    token = scanner.scan();
  }

  const parseErrors: ParseError[] = [];
  const rootNode = parseTree(normalized, parseErrors, {
    disallowComments: true,
    allowTrailingComma: false,
    allowEmptyContent: false,
  });

  if (parseErrors.length > 0 || !rootNode || rootNode.type !== 'object') {
    const firstErr = parseErrors[0];
    const detail = firstErr ? ` (${printParseErrorCode(firstErr.error)})` : '';
    throw new DomainValidationError([
      {
        path: '',
        code: 'JSON_SYNTAX',
        message: `Invalid ComponentSet JSON${detail}.`,
      },
    ]);
  }

  const duplicateIssues: ValidationIssue[] = [];

  function evaluateAst(node: Node, relPath: string): unknown {
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
          const propPath = joinPath(relPath, key);

          if (seenKeys.has(key)) {
            duplicateIssues.push({
              path: propPath,
              code: 'DUPLICATE_JSON_KEY',
              message: `Duplicate JSON property key "${key}".`,
            });
          } else {
            seenKeys.add(key);
          }

          const val = evaluateAst(valNode, propPath);
          Object.defineProperty(obj, key, {
            value: val,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return obj;
      }
      case 'array': {
        const children = node.children ?? [];
        return children.map((child, idx) => evaluateAst(child, joinPath(relPath, idx)));
      }
      case 'number':
        return normalizeZero(typeof node.value === 'number' ? node.value : Number(node.value));
      case 'string':
      case 'boolean':
        return node.value;
      case 'null':
      default:
        return null;
    }
  }

  const evaluated = evaluateAst(rootNode, '');
  if (duplicateIssues.length > 0) {
    throw new DomainValidationError(duplicateIssues);
  }

  return validateComponentSet(evaluated);
}

function checkSetImportCompatibility(
  validatedDoc: SketchDocument,
  validSet: ComponentSet,
  setPathPrefix: string,
): { alreadyPresent: boolean } {
  const existingSameId = validatedDoc.componentSets.find((s) => s.id === validSet.id);
  if (existingSameId) {
    if (existingSameId.version !== validSet.version) {
      throw new DomainValidationError([
        {
          path: joinPath(setPathPrefix, 'version'),
          code: 'SET_VERSION_CONFLICT',
          message: `ComponentSet "${validSet.id}" already exists in document with version "${existingSameId.version}" (requested "${validSet.version}").`,
        },
      ]);
    }
    if (!areComponentSetsEqual([existingSameId], [validSet])) {
      throw new DomainValidationError([
        {
          path: setPathPrefix || 'set',
          code: 'SET_CONTENT_CONFLICT',
          message: `ComponentSet "${validSet.id}"@${validSet.version} already exists in document with different content.`,
        },
      ]);
    }
    return { alreadyPresent: true };
  }

  // New set ID: check global componentType uniqueness across existing sets in document
  const existingTypes = new Map<string, string>();
  let totalExistingDefs = 0;
  for (const existingSet of validatedDoc.componentSets) {
    totalExistingDefs += existingSet.components.length;
    for (const comp of existingSet.components) {
      existingTypes.set(comp.type, existingSet.id);
    }
  }

  for (let i = 0; i < validSet.components.length; i += 1) {
    const comp = validSet.components[i]!;
    const ownerSetId = existingTypes.get(comp.type);
    if (ownerSetId !== undefined) {
      throw new DomainValidationError([
        {
          path: joinPath(joinPath(setPathPrefix, 'components'), i) + '.type',
          code: 'COMPONENT_TYPE_COLLISION',
          message: `Component type "${comp.type}" is already defined in existing set "${ownerSetId}".`,
        },
      ]);
    }
  }

  if (validatedDoc.componentSets.length + 1 > CATALOG_LIMITS.MAX_SETS_PER_DOCUMENT) {
    throw new DomainValidationError([
      {
        path: 'componentSets',
        code: 'LIMIT_EXCEEDED',
        message: `Document componentSet count would exceed maximum of ${CATALOG_LIMITS.MAX_SETS_PER_DOCUMENT}.`,
      },
    ]);
  }

  if (totalExistingDefs + validSet.components.length > CATALOG_LIMITS.MAX_TOTAL_DEFINITIONS) {
    throw new DomainValidationError([
      {
        path: 'componentSets',
        code: 'LIMIT_EXCEEDED',
        message: `Total component definitions in document would exceed maximum of ${CATALOG_LIMITS.MAX_TOTAL_DEFINITIONS}.`,
      },
    ]);
  }

  return { alreadyPresent: false };
}

/**
 * Prepares a `set-component-sets` command to import a validated ComponentSet into the document,
 * or returns `null` if an identical set (same id, version, and content) is already present.
 */
export function prepareComponentSetImport(
  document: SketchDocument,
  set: ComponentSet,
): DocumentCommand | null {
  const validatedDoc = validateDocument(document);
  const validSet = validateComponentSet(set);

  const { alreadyPresent } = checkSetImportCompatibility(validatedDoc, validSet, 'set');
  if (alreadyPresent) {
    return null;
  }

  const command: DocumentCommand = {
    type: 'set-component-sets',
    sets: [...validatedDoc.componentSets.map(cloneComponentSet), cloneComponentSet(validSet)],
  };

  const nextDoc = applyCommand(validatedDoc, command);
  serializeDocument(nextDoc);

  return command;
}

/**
 * Instantiates a component from a ComponentSet into a SketchDocument.
 * Returns the detached SketchElement and a validated DocumentCommand (either a `batch`
 * of `set-component-sets` + `add` if the set was not yet in the document, or `add` if already present).
 */
export function instantiateComponent(
  document: SketchDocument,
  request: InstantiateComponentRequest,
): ComponentInstantiation {
  const validatedDoc = validateDocument(document);

  if (!isPlainRecord(request)) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'INVALID_REQUEST',
        message: 'InstantiateComponentRequest must be a plain object.',
      },
    ]);
  }

  const issues: ValidationIssue[] = [];
  const ancestors = new Set<object>([request]);
  checkObjectKeys(request, '', INSTANTIATE_REQUEST_KEYS, issues);
  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  const validSet = validateComponentSet(request.set);
  const { alreadyPresent } = checkSetImportCompatibility(validatedDoc, validSet, 'set');

  if (typeof request.type !== 'string' || request.type.length === 0) {
    throw new DomainValidationError([
      {
        path: 'type',
        code: 'UNKNOWN_COMPONENT_TYPE',
        message: 'Component type must be a non-empty string.',
      },
    ]);
  }

  const definition = validSet.components.find((c) => c.type === request.type);
  if (!definition) {
    throw new DomainValidationError([
      {
        path: 'type',
        code: 'UNKNOWN_COMPONENT_TYPE',
        message: `Component type "${request.type}" does not exist in ComponentSet "${validSet.id}".`,
      },
    ]);
  }

  validateIdField(request.id, 'id', issues);
  if (issues.length === 0 && validatedDoc.elements.some((el) => el.id === request.id)) {
    issues.push({
      path: 'id',
      code: 'DUPLICATE_ELEMENT_ID',
      message: `Element id "${request.id}" already exists in the document.`,
    });
  }

  validatePoint(request.at, 'at', ancestors, issues);

  if (Object.prototype.hasOwnProperty.call(request, 'parentId') && request.parentId !== undefined) {
    if (validateIdField(request.parentId, 'parentId', issues)) {
      const parentEl = validatedDoc.elements.find((el) => el.id === request.parentId);
      if (!parentEl) {
        issues.push({
          path: 'parentId',
          code: 'MISSING_PARENT_CONTAINER',
          message: `Parent container "${request.parentId}" does not exist in the document.`,
        });
      } else if (parentEl.kind !== 'container') {
        issues.push({
          path: 'parentId',
          code: 'INVALID_PARENT_KIND',
          message: `Element "${request.parentId}" is a "${parentEl.kind}", not a container.`,
        });
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(request, 'label') && request.label !== undefined) {
    if (typeof request.label !== 'string') {
      issues.push({
        path: 'label',
        code: 'INVALID_TEXT',
        message: 'Component label must be a string.',
      });
    } else if (request.label.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) {
      issues.push({
        path: 'label',
        code: 'TEXT_TOO_LONG',
        message: `Component label exceeds maximum length of ${DOMAIN_LIMITS.MAX_TEXT_LENGTH} characters.`,
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(request, 'metadata') && request.metadata !== undefined) {
    validateStringMetadata(request.metadata, 'metadata', ancestors, issues);
  }

  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  // Merge metadata from definition then request, and validate any widget: entries
  let mergedMetadata: Record<string, string> | undefined;
  if (definition.metadata !== undefined || request.metadata !== undefined) {
    mergedMetadata = {
      ...(definition.metadata ?? {}),
      ...(request.metadata ?? {}),
    };

    const widgetsByKey = new Map<
      string,
      NonNullable<ComponentDefinition['widgets']>[number]
    >();
    if (definition.widgets) {
      for (const w of definition.widgets) {
        widgetsByKey.set(w.key, w);
      }
    }

    for (const mKey of Object.keys(mergedMetadata)) {
      if (!mKey.startsWith('widget:')) continue;
      const mPath = joinPath('metadata', mKey);
      const parsedKey = parseWidgetMetadataKey(mKey);
      if (!parsedKey || parsedKey.componentType !== definition.type) {
        issues.push({
          path: mPath,
          code: 'INVALID_WIDGET_NAMESPACE',
          message: `Widget metadata key "${mKey}" does not match component type "${definition.type}".`,
        });
        continue;
      }
      const wDef = widgetsByKey.get(parsedKey.widgetKey);
      if (!wDef) {
        issues.push({
          path: mPath,
          code: 'UNKNOWN_WIDGET_KEY',
          message: `Widget metadata key "${mKey}" references unknown widget "${parsedKey.widgetKey}" on "${definition.type}".`,
        });
        continue;
      }
      try {
        validateWidgetValue(wDef, mergedMetadata[mKey]!, mPath);
      } catch (err) {
        if (err instanceof DomainValidationError) {
          issues.push(...err.issues);
        }
      }
    }
  }

  if (issues.length > 0) {
    throw new DomainValidationError(issues);
  }

  // Merge Script v1 required style defaults with partial definition style
  const mergedStyle: ElementStyle = {
    stroke: definition.style.stroke ?? SCRIPT_V1_DEFAULT_STYLE.stroke,
    fill: definition.style.fill ?? SCRIPT_V1_DEFAULT_STYLE.fill,
    ...(definition.style.textColor !== undefined ? { textColor: definition.style.textColor } : {}),
    strokeWidth: normalizeZero(
      definition.style.strokeWidth ?? SCRIPT_V1_DEFAULT_STYLE.strokeWidth,
    ),
    opacity: normalizeZero(definition.style.opacity ?? SCRIPT_V1_DEFAULT_STYLE.opacity),
    fontSize: normalizeZero(definition.style.fontSize ?? SCRIPT_V1_DEFAULT_STYLE.fontSize),
    textAlign: definition.style.textAlign ?? SCRIPT_V1_DEFAULT_STYLE.textAlign,
    strokeDash: definition.style.strokeDash ?? SCRIPT_V1_DEFAULT_STYLE.strokeDash,
    ...(definition.style.fontFamily !== undefined
      ? { fontFamily: definition.style.fontFamily }
      : {}),
  };

  // AWS group frames (#143) are containers that carry their look in a metadata key, not components.
  const group = awsGroupById(definition.metadata?.[GROUP_METADATA_KEY]);
  if (group) {
    const text = request.label ?? group.label;
    const container: SketchElement = {
      id: request.id,
      pageId: request.pageId ?? DEFAULT_PAGE_ID,
      kind: 'container',
      x: normalizeZero(request.at.x),
      y: normalizeZero(request.at.y),
      width: normalizeZero(definition.defaultWidth),
      height: normalizeZero(definition.defaultHeight),
      rotation: 0,
      style: mergedStyle,
      text,
      label: text,
      ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
      metadata: { [GROUP_METADATA_KEY]: group.id, ...(request.metadata ?? {}) },
    };
    const groupCommand: DocumentCommand = { type: 'add', elements: [cloneElement(container)] };
    serializeDocument(applyCommand(validatedDoc, groupCommand));
    return { element: cloneElement(container), command: groupCommand };
  }

  const element: SketchElement = {
    id: request.id,
    pageId: request.pageId ?? DEFAULT_PAGE_ID,
    kind: 'component',
    componentType: definition.type,
    x: normalizeZero(request.at.x),
    y: normalizeZero(request.at.y),
    width: normalizeZero(definition.defaultWidth),
    height: normalizeZero(definition.defaultHeight),
    rotation: 0,
    style: mergedStyle,
    text: definition.name,
    label: request.label !== undefined ? request.label : definition.name,
    ...(request.parentId !== undefined ? { parentId: request.parentId } : {}),
    ...(definition.documentationUrl !== undefined
      ? { documentationUrl: definition.documentationUrl }
      : {}),
    ...(mergedMetadata !== undefined ? { metadata: mergedMetadata } : {}),
  };

  const addCommand: DocumentCommand = {
    type: 'add',
    elements: [cloneElement(element)],
  };

  const command: DocumentCommand = alreadyPresent
    ? addCommand
    : {
        type: 'batch',
        commands: [
          {
            type: 'set-component-sets',
            sets: [
              ...validatedDoc.componentSets.map(cloneComponentSet),
              cloneComponentSet(validSet),
            ],
          },
          addCommand,
        ],
      };

  const nextDoc = applyCommand(validatedDoc, command);
  serializeDocument(nextDoc);

  return {
    element: cloneElement(element),
    command,
  };
}

/**
 * Pure search helper across ComponentSets matching name, provider, category, type, and aliases.
 * An empty query returns all components (filtered by optional providerFilter).
 */
export function searchCatalogComponents(
  sets: readonly ComponentSet[] = builtInComponentSets,
  query = '',
  providerFilter: ComponentDefinition['provider'] | 'all' = 'all',
): CatalogSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const normalizedQuerySpaced = normalizedQuery.replace(/-/g, ' ');
  const results: CatalogSearchResult[] = [];

  for (const set of sets) {
    for (const component of set.components) {
      if (providerFilter !== 'all' && component.provider !== providerFilter) {
        continue;
      }
      if (normalizedQuery.length === 0) {
        results.push({
          set: cloneComponentSet(set),
          component: cloneComponentSet({ ...set, components: [component] }).components[0]!,
        });
        continue;
      }

      const haystacks = [
        component.name,
        component.provider,
        component.category,
        component.type,
        ...(component.aliases ?? []),
      ];

      const matches = haystacks.some((h) => {
        const lower = h.toLowerCase();
        return (
          lower.includes(normalizedQuery) ||
          lower.replace(/-/g, ' ').includes(normalizedQuerySpaced)
        );
      });
      if (matches) {
        results.push({
          set: cloneComponentSet(set),
          component: cloneComponentSet({ ...set, components: [component] }).components[0]!,
        });
      }
    }
  }

  return results;
}

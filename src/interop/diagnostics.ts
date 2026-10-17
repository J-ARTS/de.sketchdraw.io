import { DOMAIN_LIMITS } from '../domain/limits';
import type { ConversionWarning } from '../domain/types';
import { isValidId, utf8ByteLength } from '../domain/validation';
import { INTEROP_LIMITS } from './limits';
import {
  cloneDiagnostic,
  InteropError,
  type InteropDiagnostic,
  type InteropDiagnosticEffect,
  type InteropDiagnosticSeverity,
  type InteropFidelity,
  type InteropFormat,
} from './types';

export interface DiagnosticInput {
  code: string;
  severity: InteropDiagnosticSeverity;
  effect: InteropDiagnosticEffect;
  message: string;
  sourceId?: string;
  property?: string;
  pageIndex?: number;
  elementId?: string;
  sourcePath?: string;
  order?: number;
}

interface IndexedDiagnostic {
  diag: InteropDiagnostic;
  order: number;
}

export class DiagnosticCollector {
  private readonly entries: IndexedDiagnostic[] = [];
  private readonly dedupKeys = new Set<string>();
  private nextOrder = 0;
  private omittedCount = 0;

  add(input: DiagnosticInput): void {
    const dedupKey = `${input.code}|${input.sourcePath ?? ''}|${input.sourceId ?? ''}|${input.elementId ?? ''}|${input.property ?? ''}|${input.pageIndex ?? ''}`;
    if (this.dedupKeys.has(dedupKey)) {
      return;
    }
    if (this.entries.length >= INTEROP_LIMITS.MAX_DIAGNOSTICS) {
      this.omittedCount += 1;
      return;
    }
    this.dedupKeys.add(dedupKey);

    const order = input.order !== undefined ? input.order : this.nextOrder++;
    if (input.order !== undefined && input.order >= this.nextOrder) {
      this.nextOrder = input.order + 1;
    }

    const diag: InteropDiagnostic = {
      code: input.code,
      severity: input.severity,
      effect: input.effect,
      message: input.message,
    };
    if (input.sourceId !== undefined) diag.sourceId = input.sourceId;
    if (input.property !== undefined) diag.property = input.property;
    if (input.pageIndex !== undefined) diag.pageIndex = input.pageIndex;
    if (input.elementId !== undefined) diag.elementId = input.elementId;
    if (input.sourcePath !== undefined) diag.sourcePath = input.sourcePath;

    this.entries.push({ diag, order });
  }

  allocateOrder(): number {
    return this.nextOrder++;
  }

  finalize(): InteropDiagnostic[] {
    const sorted = [...this.entries].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      const pathA = a.diag.sourcePath ?? '';
      const pathB = b.diag.sourcePath ?? '';
      if (pathA !== pathB) return pathA < pathB ? -1 : 1;
      const propA = a.diag.property ?? '';
      const propB = b.diag.property ?? '';
      if (propA !== propB) return propA < propB ? -1 : 1;
      if (a.diag.code !== b.diag.code) return a.diag.code < b.diag.code ? -1 : 1;
      return 0;
    });

    const maxDiag = INTEROP_LIMITS.MAX_DIAGNOSTICS;
    if (this.omittedCount === 0) {
      return sorted.map((entry) => cloneDiagnostic(entry.diag));
    }

    const capped = sorted.slice(0, maxDiag).map((entry) => cloneDiagnostic(entry.diag));
    const omittedCount = this.omittedCount;
    capped.push({
      code: 'DIAGNOSTICS_TRUNCATED',
      severity: 'warning',
      effect: 'omitted',
      message: `Diagnostic output truncated after ${maxDiag} entries (${omittedCount} additional diagnostic(s) omitted).`,
    });
    return capped;
  }
}

export function extractWarnings(diagnostics: readonly InteropDiagnostic[]): ConversionWarning[] {
  const warnings: ConversionWarning[] = [];
  for (const diag of diagnostics) {
    if (diag.severity === 'warning') {
      const warning: ConversionWarning = {
        message: diag.message,
      };
      if (diag.sourceId !== undefined) warning.sourceId = diag.sourceId;
      if (diag.property !== undefined) warning.property = diag.property;
      warnings.push(warning);
    }
  }
  return warnings;
}

export function hasWarningDiagnostics(diagnostics: readonly InteropDiagnostic[]): boolean {
  return diagnostics.some((diag) => diag.severity === 'warning');
}

export function computeImportFidelity(
  diagnostics: readonly InteropDiagnostic[],
  restoredFromVerifiedEnvelope: boolean,
): InteropFidelity {
  if (restoredFromVerifiedEnvelope) {
    return 'own-roundtrip';
  }
  for (const diag of diagnostics) {
    if (
      diag.severity === 'warning' ||
      diag.effect === 'approximated' ||
      diag.effect === 'omitted' ||
      diag.effect === 'rejected'
    ) {
      return 'approximate';
    }
  }
  return 'supported-subset';
}

export class XmlOutputBuilder {
  private readonly chunks: string[] = [];
  private byteLength = 0;
  private readonly maxBytes: number;

  constructor(maxBytes = INTEROP_LIMITS.MAX_EXPORT_BYTES) {
    this.maxBytes = maxBytes;
  }

  append(chunk: string): void {
    if (chunk.length === 0) return;
    const chunkBytes = utf8ByteLength(chunk);
    if (this.byteLength + chunkBytes > this.maxBytes) {
      throw new InteropError(
        'LIMIT_EXCEEDED',
        `Generated export size exceeds maximum of ${this.maxBytes} UTF-8 bytes.`,
      );
    }
    this.byteLength += chunkBytes;
    this.chunks.push(chunk);
  }

  getByteLength(): number {
    return this.byteLength;
  }

  toString(): string {
    return this.chunks.join('');
  }
}

function isValidXml10CodePoint(cp: number): boolean {
  return (
    cp === 0x09 ||
    cp === 0x0a ||
    cp === 0x0d ||
    (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) ||
    (cp >= 0x10000 && cp <= 0x10ffff)
  );
}

export function sanitizeXml10Text(
  input: string,
  collector?: DiagnosticCollector,
  context?: {
    elementId?: string;
    sourceId?: string;
    property?: string;
    sourcePath?: string;
    format?: InteropFormat;
  },
): string {
  let out = '';
  let approximated = false;
  const len = input.length;

  for (let i = 0; i < len; i += 1) {
    const code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < len) {
        const next = input.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += input[i]! + input[i + 1]!;
          i += 1;
          continue;
        }
      }
      // Unpaired high surrogate
      out += '\uFFFD';
      approximated = true;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      // Unpaired low surrogate
      out += '\uFFFD';
      approximated = true;
      continue;
    }
    if (!isValidXml10CodePoint(code)) {
      out += '\uFFFD';
      approximated = true;
      continue;
    }
    out += input[i]!;
  }

  if (approximated && collector) {
    collector.add({
      code: 'TEXT_CHARACTERS_APPROXIMATED',
      severity: 'warning',
      effect: 'approximated',
      elementId: context?.elementId,
      sourceId: context?.sourceId,
      property: context?.property ?? 'text',
      sourcePath: context?.sourcePath,
      message: `Characters not representable in XML 1.0 (${context?.format ?? 'xml'} visible projection) were replaced with U+FFFD; original characters remain preserved only in embedded JSON metadata.`,
    });
  }

  return out;
}

export function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

export function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

export class DeterministicIdMapper {
  private readonly sourceToDomain = new Map<string, string>();
  private readonly usedDomainIds = new Set<string>();
  private fallbackIndex = 1;

  resolveId(
    rawSourceId: string | undefined,
    prefix: string,
    collector: DiagnosticCollector,
    context?: {
      pageIndex?: number;
      sourcePath?: string;
      order?: number;
    },
  ): string {
    if (rawSourceId !== undefined && this.sourceToDomain.has(rawSourceId)) {
      return this.sourceToDomain.get(rawSourceId)!;
    }

    if (
      rawSourceId !== undefined &&
      isValidId(rawSourceId) &&
      !this.usedDomainIds.has(rawSourceId)
    ) {
      this.usedDomainIds.add(rawSourceId);
      this.sourceToDomain.set(rawSourceId, rawSourceId);
      return rawSourceId;
    }

    // Need deterministic remapping
    const sanitizedBase =
      rawSourceId !== undefined
        ? rawSourceId
            .replace(/[^A-Za-z0-9._:-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 64)
        : '';

    let candidate =
      sanitizedBase.length > 0 && isValidId(`${prefix}_${sanitizedBase}`)
        ? `${prefix}_${sanitizedBase}`
        : `${prefix}_${this.fallbackIndex}`;

    while (!isValidId(candidate) || this.usedDomainIds.has(candidate)) {
      this.fallbackIndex += 1;
      candidate =
        sanitizedBase.length > 0
          ? `${prefix}_${sanitizedBase.slice(0, 48)}_${this.fallbackIndex}`
          : `${prefix}_${this.fallbackIndex}`;
    }
    this.fallbackIndex += 1;

    this.usedDomainIds.add(candidate);
    if (rawSourceId !== undefined) {
      this.sourceToDomain.set(rawSourceId, candidate);
      collector.add({
        code: 'ID_REMAPPED',
        severity: 'info',
        effect: 'normalized',
        sourceId: rawSourceId,
        elementId: candidate,
        property: 'id',
        pageIndex: context?.pageIndex,
        sourcePath: context?.sourcePath,
        order: context?.order,
        message: `Source ID "${rawSourceId}" was mapped to valid domain ID "${candidate}".`,
      });
    }

    return candidate;
  }

  getMappedId(rawSourceId: string): string | undefined {
    return this.sourceToDomain.get(rawSourceId);
  }

  hasUsedId(domainId: string): boolean {
    return this.usedDomainIds.has(domainId);
  }

  reserveDomainId(domainId: string): void {
    this.usedDomainIds.add(domainId);
  }
}

export interface SourceMetadataPayload {
  format: InteropFormat;
  sourceId?: string;
  pageIndex?: number;
  sourceType: string;
  parentSourceId?: string;
  layerId?: string;
  layerName?: string;
  hidden?: boolean;
  extraAttributes?: Record<string, string>;
  extraStyles?: Record<string, string>;
}

export class SourceMetadataBudget {
  private totalBytes = 0;

  attach(
    metadata: Record<string, string>,
    payload: SourceMetadataPayload,
    collector: DiagnosticCollector,
    context: {
      elementId: string;
      sourceId?: string;
      pageIndex?: number;
      sourcePath?: string;
      order?: number;
    },
  ): void {
    const baseObj: Record<string, unknown> = {
      format: payload.format,
      sourceType: payload.sourceType,
    };
    if (payload.sourceId !== undefined) baseObj.sourceId = payload.sourceId;
    if (payload.pageIndex !== undefined) baseObj.pageIndex = payload.pageIndex;
    if (payload.parentSourceId !== undefined) baseObj.parentSourceId = payload.parentSourceId;
    if (payload.layerId !== undefined) baseObj.layerId = payload.layerId;
    if (payload.layerName !== undefined) baseObj.layerName = payload.layerName;
    if (payload.hidden !== undefined) baseObj.hidden = payload.hidden;

    const fullObj: Record<string, unknown> = { ...baseObj };
    const hasExtraAttrs =
      payload.extraAttributes !== undefined && Object.keys(payload.extraAttributes).length > 0;
    const hasExtraStyles =
      payload.extraStyles !== undefined && Object.keys(payload.extraStyles).length > 0;
    if (hasExtraAttrs) fullObj.extraAttributes = payload.extraAttributes;
    if (hasExtraStyles) fullObj.extraStyles = payload.extraStyles;

    let serialized = JSON.stringify(fullObj);
    let bytes = utf8ByteLength(serialized);

    const maxPerObjectBytes = INTEROP_LIMITS.MAX_PRESERVED_SOURCE_BYTES;
    const maxTotalBytes = INTEROP_LIMITS.MAX_TOTAL_PRESERVED_SOURCE_BYTES;
    const maxChars = Math.min(
      INTEROP_LIMITS.MAX_METADATA_VALUE_CHARS,
      DOMAIN_LIMITS.MAX_TEXT_LENGTH,
    );

    if (
      serialized.length > maxChars ||
      bytes > maxPerObjectBytes ||
      this.totalBytes + bytes > maxTotalBytes
    ) {
      const rejectedBytes = bytes;
      // Try storing only core provenance without extraAttributes/extraStyles
      serialized = JSON.stringify(baseObj);
      bytes = utf8ByteLength(serialized);

      collector.add({
        code: 'SOURCE_DATA_NOT_PRESERVED',
        severity: 'warning',
        effect: 'omitted',
        elementId: context.elementId,
        sourceId: context.sourceId,
        property: 'metadata',
        pageIndex: context.pageIndex,
        sourcePath: context.sourcePath,
        order: context.order,
        message: `Source attributes/styles (${rejectedBytes} UTF-8 bytes) exceeded preservation budget (max ${maxPerObjectBytes} bytes per element, ${maxTotalBytes} bytes total) and were omitted.`,
      });

      if (
        serialized.length > maxChars ||
        bytes > maxPerObjectBytes ||
        this.totalBytes + bytes > maxTotalBytes
      ) {
        return;
      }
    }

    const baseKey = 'sketchdraw.interop.source.v1';
    let targetKey = baseKey;
    if (Object.prototype.hasOwnProperty.call(metadata, baseKey)) {
      let suffix = 2;
      while (Object.prototype.hasOwnProperty.call(metadata, `${baseKey}.${suffix}`)) {
        suffix += 1;
      }
      targetKey = `${baseKey}.${suffix}`;
      collector.add({
        code: 'SEMANTICS_IN_METADATA',
        severity: 'info',
        effect: 'preserved-as-data',
        elementId: context.elementId,
        sourceId: context.sourceId,
        property: targetKey,
        pageIndex: context.pageIndex,
        sourcePath: context.sourcePath,
        order: context.order,
        message: `Existing metadata key "${baseKey}" was preserved; provenance stored under "${targetKey}".`,
      });
    }

    this.totalBytes += bytes;
    metadata[targetKey] = serialized;
  }
}

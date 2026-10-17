import { DomainValidationError } from './errors';
import { DOMAIN_LIMITS } from './limits';
import type { SketchDocument } from './types';
import { utf8ByteLength, validateAndSerializeDocument, validateDocument } from './validation';

export function serializeDocument(document: SketchDocument): string {
  return validateAndSerializeDocument(document).serialized;
}

export function deserializeDocument(text: string): SketchDocument {
  if (typeof text !== 'string') {
    throw new DomainValidationError([
      {
        path: '',
        code: 'INVALID_JSON_INPUT',
        message: 'Serialized document input must be a string.',
      },
    ]);
  }

  if (
    text.length > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES ||
    utf8ByteLength(text) > DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES
  ) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'DOCUMENT_JSON_TOO_LARGE',
        message: `Document JSON UTF-8 byte length exceeds limit of ${DOMAIN_LIMITS.MAX_DOCUMENT_JSON_BYTES} bytes.`,
      },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DomainValidationError([
      {
        path: '',
        code: 'INVALID_JSON',
        message: error instanceof Error ? `Invalid JSON: ${error.message}` : 'Invalid JSON text.',
      },
    ]);
  }

  return validateDocument(parsed);
}

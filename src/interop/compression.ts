import { Inflate } from 'fflate';
import { INTEROP_LIMITS } from './limits';
import { InteropError } from './types';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const textEncoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

function base64CharToVal(code: number): number {
  if (code >= 65 && code <= 90) return code - 65; // A-Z
  if (code >= 97 && code <= 122) return code - 71; // a-z
  if (code >= 48 && code <= 57) return code + 4; // 0-9
  if (code === 43) return 62; // +
  if (code === 47) return 63; // /
  return -1;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  const chunks: string[] = [];
  let current = '';

  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const hasB1 = i + 1 < len;
    const hasB2 = i + 2 < len;
    const b1 = hasB1 ? bytes[i + 1]! : 0;
    const b2 = hasB2 ? bytes[i + 2]! : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;
    current +=
      BASE64_ALPHABET[(triplet >> 18) & 0x3f]! +
      BASE64_ALPHABET[(triplet >> 12) & 0x3f]! +
      (hasB1 ? BASE64_ALPHABET[(triplet >> 6) & 0x3f]! : '=') +
      (hasB2 ? BASE64_ALPHABET[triplet & 0x3f]! : '=');

    if (current.length >= 16_384) {
      chunks.push(current);
      current = '';
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.join('');
}

export function decodeBase64Bounded(
  rawInput: string,
  maxBytes: number,
  context?: { pageIndex?: number; sourcePath?: string; label?: string },
): Uint8Array {
  const clean = rawInput.replace(/[ \t\r\n]+/g, '');
  const label = context?.label ?? 'Base64 payload';

  if (clean.length === 0 || clean.length % 4 !== 0) {
    throw new InteropError(
      'INVALID_COMPRESSION',
      `Malformed ${label}: Base64 length (${clean.length}) must be a positive multiple of 4.`,
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: `Malformed ${label}: invalid Base64 length.`,
        },
      ],
    );
  }

  let padding = 0;
  if (clean.endsWith('==')) {
    padding = 2;
  } else if (clean.endsWith('=')) {
    padding = 1;
  }

  const decodedLength = (clean.length / 4) * 3 - padding;
  if (decodedLength <= 0) {
    throw new InteropError('INVALID_COMPRESSION', `Malformed ${label}: decoded payload is empty.`, [
      {
        code: 'INVALID_COMPRESSION',
        severity: 'error',
        effect: 'rejected',
        pageIndex: context?.pageIndex,
        sourcePath: context?.sourcePath,
        message: `Malformed ${label}: decoded payload is empty.`,
      },
    ]);
  }

  if (decodedLength > maxBytes) {
    throw new InteropError(
      'LIMIT_EXCEEDED',
      `Decoded ${label} size (${decodedLength} bytes) exceeds limit of ${maxBytes} bytes.`,
      [
        {
          code: 'LIMIT_EXCEEDED',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: `Decoded ${label} size (${decodedLength} bytes) exceeds limit of ${maxBytes} bytes.`,
        },
      ],
    );
  }

  const out = new Uint8Array(decodedLength);
  let outPos = 0;
  const len = clean.length;

  for (let i = 0; i < len; i += 4) {
    const isLastGroup = i + 4 === len;
    const c0 = base64CharToVal(clean.charCodeAt(i));
    const c1 = base64CharToVal(clean.charCodeAt(i + 1));
    const ch2 = clean.charCodeAt(i + 2);
    const ch3 = clean.charCodeAt(i + 3);

    const pad2 = isLastGroup && padding === 2 && ch2 === 61;
    const pad3 = isLastGroup && padding >= 1 && ch3 === 61;

    const c2 = pad2 ? 0 : base64CharToVal(ch2);
    const c3 = pad3 ? 0 : base64CharToVal(ch3);

    if (
      c0 < 0 ||
      c1 < 0 ||
      c2 < 0 ||
      c3 < 0 ||
      (!isLastGroup && (ch2 === 61 || ch3 === 61)) ||
      (isLastGroup && padding === 2 && (c1 & 0x0f) !== 0) ||
      (isLastGroup && padding === 1 && (c2 & 0x03) !== 0)
    ) {
      throw new InteropError(
        'INVALID_COMPRESSION',
        `Malformed ${label}: invalid Base64 character or non-canonical padding bits at offset ${i}.`,
        [
          {
            code: 'INVALID_COMPRESSION',
            severity: 'error',
            effect: 'rejected',
            pageIndex: context?.pageIndex,
            sourcePath: context?.sourcePath,
            message: `Malformed ${label}: invalid Base64 encoding.`,
          },
        ],
      );
    }

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outPos++] = (triple >> 16) & 0xff;
    if (!pad2) {
      out[outPos++] = (triple >> 8) & 0xff;
    }
    if (!pad3) {
      out[outPos++] = triple & 0xff;
    }
  }

  return out;
}

/**
 * Escapes any unpaired UTF-16 surrogates in a JSON text string as ASCII \uXXXX
 * before UTF-8 encoding so that TextEncoder never substitutes U+FFFD.
 */
export function ensureAsciiEscapedLoneSurrogatesInJson(jsonText: string): string {
  let out = '';
  let lastIndex = 0;
  const len = jsonText.length;

  for (let i = 0; i < len; i += 1) {
    const code = jsonText.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (i + 1 < len) {
        const next = jsonText.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          i += 1;
          continue;
        }
      }
      out += jsonText.slice(lastIndex, i) + `\\u${code.toString(16).padStart(4, '0')}`;
      lastIndex = i + 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += jsonText.slice(lastIndex, i) + `\\u${code.toString(16).padStart(4, '0')}`;
      lastIndex = i + 1;
    }
  }

  if (lastIndex === 0) {
    return jsonText;
  }
  return out + jsonText.slice(lastIndex);
}

export function encodeUtf8JsonToBase64(jsonText: string): string {
  const safeJson = ensureAsciiEscapedLoneSurrogatesInJson(jsonText);
  const bytes = textEncoder.encode(safeJson);
  return encodeBytesToBase64(bytes);
}

export function decodeBase64ToUtf8String(
  base64Text: string,
  maxBytes: number,
  context?: { pageIndex?: number; sourcePath?: string; label?: string },
): string {
  const bytes = decodeBase64Bounded(base64Text, maxBytes, context);
  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    throw new InteropError(
      'INVALID_COMPRESSION',
      `Decoded ${context?.label ?? 'Base64 payload'} is not valid UTF-8.`,
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: `Decoded ${context?.label ?? 'Base64 payload'} contains invalid UTF-8 byte sequences.`,
        },
      ],
    );
  }
}

/**
 * Bounded synchronous raw-DEFLATE decompression using fflate's streaming `Inflate`.
 *
 * Working-volume analysis on pinned `fflate@0.8.3`:
 * - We feed compressed input in chunks of at most `MAX_INFLATE_INPUT_CHUNK_BYTES` (1,024 bytes).
 * - In RFC 1951 (raw DEFLATE), the theoretical maximum compression ratio is 1,032x
 *   (2 bits per 258-byte match in a custom dynamic Huffman block). Thus a 1,024-byte push
 *   can produce at most ~1.007 MiB of output inside `inflt()` before `Inflate.prototype.c`
 *   invokes `ondata`, with `inflt` maintaining a 32 KiB sliding lookback window (`this.o`)
 *   and at most a ~2.4 MiB temporary typed array (`cbuf(bt + 131072)`).
 * - Inside `ondata`, we verify `totalOutputBytes + outChunk.byteLength <= maxOutputBytes`
 *   BEFORE retaining `outChunk` and immediately abort with `LIMIT_EXCEEDED` on overflow,
 *   preventing any subsequent `push` calls.
 */
export function inflateRawDeflateBounded(
  compressed: Uint8Array,
  maxOutputBytes = INTEROP_LIMITS.MAX_INFLATED_URI_BYTES,
  context?: { pageIndex?: number; sourcePath?: string },
): Uint8Array {
  if (compressed.byteLength === 0) {
    throw new InteropError(
      'INVALID_COMPRESSION',
      'Compressed draw.io page payload must not be empty.',
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: 'Compressed draw.io page payload is empty.',
        },
      ],
    );
  }

  // Reject ZIP (PK\x03\x04), GZIP (\x1f\x8b), and Zlib (0x78 wrapper) containers explicitly
  if (
    compressed.byteLength >= 4 &&
    compressed[0] === 0x50 &&
    compressed[1] === 0x4b &&
    compressed[2] === 0x03 &&
    compressed[3] === 0x04
  ) {
    throw new InteropError(
      'UNSUPPORTED_FORMAT',
      'ZIP archive container is not a valid draw.io raw-DEFLATE page.',
      [
        {
          code: 'UNSUPPORTED_FORMAT',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: 'ZIP archive container is not supported; expected Base64 raw-DEFLATE.',
        },
      ],
    );
  }

  if (compressed.byteLength >= 2 && compressed[0] === 0x1f && compressed[1] === 0x8b) {
    throw new InteropError(
      'INVALID_COMPRESSION',
      'GZIP header detected; draw.io compressed pages must use raw DEFLATE without wrapper.',
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: 'GZIP wrapper is not allowed; expected raw DEFLATE.',
        },
      ],
    );
  }

  if (
    compressed.byteLength >= 2 &&
    (compressed[0]! & 0x0f) === 8 &&
    compressed[0]! >> 4 <= 7 &&
    ((compressed[0]! << 8) | compressed[1]!) % 31 === 0 &&
    (compressed[0]! & 0x06) === 0
  ) {
    // Note: in raw DEFLATE, byte[0] bits 1..2 == 00 means stored block, where bytes 1..4 are LEN/NLEN.
    // A zlib header (e.g. 0x78 0x9c) has bits 1..2 == 00 and satisfies (cmf<<8|flg)%31 == 0.
    const isValidStoredBlock =
      compressed.byteLength >= 5 &&
      ((compressed[1]! | (compressed[2]! << 8)) ^ 0xffff) ===
        (compressed[3]! | (compressed[4]! << 8));
    if (!isValidStoredBlock) {
      throw new InteropError(
        'INVALID_COMPRESSION',
        'Zlib wrapper detected; draw.io compressed pages must use raw DEFLATE without wrapper.',
        [
          {
            code: 'INVALID_COMPRESSION',
            severity: 'error',
            effect: 'rejected',
            pageIndex: context?.pageIndex,
            sourcePath: context?.sourcePath,
            message: 'Zlib header is not allowed; expected raw DEFLATE.',
          },
        ],
      );
    }
  }

  const outputChunks: Uint8Array[] = [];
  let totalOutputBytes = 0;
  let sawFinalBlock = false;

  const inflater = new Inflate((outChunk, final) => {
    if (totalOutputBytes + outChunk.byteLength > maxOutputBytes) {
      throw new InteropError(
        'LIMIT_EXCEEDED',
        `Inflated draw.io page size exceeds limit of ${maxOutputBytes} bytes.`,
        [
          {
            code: 'LIMIT_EXCEEDED',
            severity: 'error',
            effect: 'rejected',
            pageIndex: context?.pageIndex,
            sourcePath: context?.sourcePath,
            message: `Inflated draw.io page size exceeds limit of ${maxOutputBytes} bytes.`,
          },
        ],
      );
    }
    if (outChunk.byteLength > 0) {
      totalOutputBytes += outChunk.byteLength;
      outputChunks.push(new Uint8Array(outChunk));
    }
    if (final) {
      sawFinalBlock = true;
    }
  });

  const stepSize = INTEROP_LIMITS.MAX_INFLATE_INPUT_CHUNK_BYTES;
  try {
    for (let offset = 0; offset < compressed.byteLength; offset += stepSize) {
      const end = Math.min(offset + stepSize, compressed.byteLength);
      const isFinal = end === compressed.byteLength;
      const slice = compressed.subarray(offset, end);
      inflater.push(slice, isFinal);
    }
  } catch (err) {
    if (err instanceof InteropError) {
      throw err;
    }
    throw new InteropError(
      'INVALID_COMPRESSION',
      `Raw DEFLATE decompression failed: ${err instanceof Error ? err.message : 'corrupt stream'}.`,
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: `Raw DEFLATE decompression failed: ${err instanceof Error ? err.message : 'corrupt stream'}.`,
        },
      ],
    );
  }

  // Verify the DEFLATE stream actually reached BFINAL=1 and did not leave trailing garbage
  const internalState = inflater as unknown as {
    s?: { f?: number; l?: unknown; p?: number };
    p?: Uint8Array;
  };
  if (
    !sawFinalBlock ||
    totalOutputBytes === 0 ||
    internalState.s?.l !== null ||
    !internalState.s?.f ||
    (internalState.p && internalState.p.byteLength > (internalState.s?.p ? 1 : 0))
  ) {
    throw new InteropError(
      'INVALID_COMPRESSION',
      'Incomplete or corrupt raw DEFLATE stream in draw.io page.',
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: 'Incomplete or corrupt raw DEFLATE stream in draw.io page.',
        },
      ],
    );
  }

  if (outputChunks.length === 1) {
    return outputChunks[0]!;
  }

  const combined = new Uint8Array(totalOutputBytes);
  let writeOffset = 0;
  for (const chunk of outputChunks) {
    combined.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }
  return combined;
}

function hexDigitVal(code: number): number {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 65 && code <= 70) return code - 55;
  if (code >= 97 && code <= 102) return code - 87;
  return -1;
}

/**
 * Bounded URI component decoder that converts inflated ASCII/UTF-8 bytes into decoded UTF-8 XML text,
 * counting decoded UTF-8 bytes incrementally before string assembly and enforcing `MAX_DECODED_PAGE_BYTES`.
 */
export function decodeUriPageBounded(
  inflatedBytes: Uint8Array,
  maxDecodedBytes = INTEROP_LIMITS.MAX_DECODED_PAGE_BYTES,
  context?: { pageIndex?: number; sourcePath?: string },
): string {
  let uriText: string;
  try {
    uriText = fatalUtf8Decoder.decode(inflatedBytes);
  } catch {
    throw new InteropError(
      'INVALID_COMPRESSION',
      'Inflated draw.io page intermediate payload is not valid UTF-8/ASCII.',
      [
        {
          code: 'INVALID_COMPRESSION',
          severity: 'error',
          effect: 'rejected',
          pageIndex: context?.pageIndex,
          sourcePath: context?.sourcePath,
          message: 'Inflated draw.io page intermediate payload is not valid UTF-8/ASCII.',
        },
      ],
    );
  }

  const len = uriText.length;
  let decodedByteCount = 0;
  const decodedSegments: string[] = [];
  let plainStart = 0;
  let i = 0;

  while (i < len) {
    const ch = uriText.charCodeAt(i);
    if (ch !== 37 /* '%' */) {
      // Count UTF-8 bytes of literal character
      if (ch <= 0x7f) {
        decodedByteCount += 1;
      } else if (ch <= 0x7ff) {
        decodedByteCount += 2;
      } else if (ch >= 0xd800 && ch <= 0xdbff) {
        decodedByteCount += 4;
        i += 1; // surrogate pair
      } else {
        decodedByteCount += 3;
      }
      if (decodedByteCount > maxDecodedBytes) {
        throw new InteropError(
          'LIMIT_EXCEEDED',
          `URI-decoded draw.io page size exceeds limit of ${maxDecodedBytes} UTF-8 bytes.`,
          [
            {
              code: 'LIMIT_EXCEEDED',
              severity: 'error',
              effect: 'rejected',
              pageIndex: context?.pageIndex,
              sourcePath: context?.sourcePath,
              message: `URI-decoded draw.io page size exceeds limit of ${maxDecodedBytes} UTF-8 bytes.`,
            },
          ],
        );
      }
      i += 1;
      continue;
    }

    if (i > plainStart) {
      decodedSegments.push(uriText.slice(plainStart, i));
    }

    // Collect contiguous %XX sequences so multi-byte UTF-8 percent-escapes decode together
    const pctBytes: number[] = [];
    while (i < len && uriText.charCodeAt(i) === 37 /* '%' */) {
      if (i + 2 >= len) {
        throw new InteropError(
          'INVALID_COMPRESSION',
          `Truncated URI percent-escape at offset ${i} in compressed draw.io page.`,
          [
            {
              code: 'INVALID_COMPRESSION',
              severity: 'error',
              effect: 'rejected',
              pageIndex: context?.pageIndex,
              sourcePath: context?.sourcePath,
              message: `Truncated URI percent-escape at offset ${i} in compressed draw.io page.`,
            },
          ],
        );
      }
      const hi = hexDigitVal(uriText.charCodeAt(i + 1));
      const lo = hexDigitVal(uriText.charCodeAt(i + 2));
      if (hi < 0 || lo < 0) {
        throw new InteropError(
          'INVALID_COMPRESSION',
          `Malformed URI percent-escape "${uriText.slice(i, i + 3)}" at offset ${i} in compressed draw.io page.`,
          [
            {
              code: 'INVALID_COMPRESSION',
              severity: 'error',
              effect: 'rejected',
              pageIndex: context?.pageIndex,
              sourcePath: context?.sourcePath,
              message: `Malformed URI percent-escape "${uriText.slice(i, i + 3)}" in compressed draw.io page.`,
            },
          ],
        );
      }
      decodedByteCount += 1;
      if (decodedByteCount > maxDecodedBytes) {
        throw new InteropError(
          'LIMIT_EXCEEDED',
          `URI-decoded draw.io page size exceeds limit of ${maxDecodedBytes} UTF-8 bytes.`,
          [
            {
              code: 'LIMIT_EXCEEDED',
              severity: 'error',
              effect: 'rejected',
              pageIndex: context?.pageIndex,
              sourcePath: context?.sourcePath,
              message: `URI-decoded draw.io page size exceeds limit of ${maxDecodedBytes} UTF-8 bytes.`,
            },
          ],
        );
      }
      pctBytes.push((hi << 4) | lo);
      i += 3;
    }

    try {
      const decodedPct = fatalUtf8Decoder.decode(new Uint8Array(pctBytes));
      decodedSegments.push(decodedPct);
    } catch {
      throw new InteropError(
        'INVALID_COMPRESSION',
        'Invalid UTF-8 byte sequence in URI-encoded draw.io page.',
        [
          {
            code: 'INVALID_COMPRESSION',
            severity: 'error',
            effect: 'rejected',
            pageIndex: context?.pageIndex,
            sourcePath: context?.sourcePath,
            message: 'Invalid UTF-8 byte sequence in URI-encoded draw.io page.',
          },
        ],
      );
    }

    plainStart = i;
  }

  if (plainStart < len) {
    decodedSegments.push(uriText.slice(plainStart));
  }

  return decodedSegments.join('');
}

export function decompressDrawioPageXml(
  encodedPayload: string,
  pageIndex: number,
  sourcePath: string,
): string {
  const compressedBytes = decodeBase64Bounded(
    encodedPayload,
    INTEROP_LIMITS.MAX_COMPRESSED_PAGE_BYTES,
    {
      pageIndex,
      sourcePath,
      label: 'compressed draw.io page',
    },
  );

  const inflatedBytes = inflateRawDeflateBounded(
    compressedBytes,
    INTEROP_LIMITS.MAX_INFLATED_URI_BYTES,
    {
      pageIndex,
      sourcePath,
    },
  );

  return decodeUriPageBounded(inflatedBytes, INTEROP_LIMITS.MAX_DECODED_PAGE_BYTES, {
    pageIndex,
    sourcePath,
  });
}

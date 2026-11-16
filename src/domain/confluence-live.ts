/**
 * The managed diagram section of a Confluence page (#210).
 *
 * Sketchdraw owns exactly the `<ac:image>` elements that show one of its own attachments **of this page**: a single
 * `<ri:attachment>` without a container reference whose file name, after decoding XML character references, is one
 * of its own. An attachment of another page or blog post (`<ri:page>` inside the reference), an image with several
 * sources and anything whose ownership is not certain belong to other people: they are never removed and never count
 * as the diagram being shown.
 *
 * The page body is never parsed and serialized again. The storage markup is only scanned for the positions of the
 * owned elements, and single elements are spliced in or out; every other character stays as it was read. Images that
 * are already shown stay where somebody put them, in whatever order and size: a changed page order in the diagram
 * does not move them.
 */

export const CONFLUENCE_LIVE_FILE_PREFIX = 'sketchdraw-';
export const CONFLUENCE_LIVE_MAX_IMAGES = 100;
export const CONFLUENCE_LIVE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const PNG_END = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82] as const;
const OWN_FILENAME = /^sketchdraw-[0-9a-f]{8,32}-[0-9a-f]{8,32}\.png$/;

/**
 * Only rendered PNG images leave the app; nothing that a viewer could execute. Checked are the signature, the image
 * header as first chunk with a real size, and the end chunk as last bytes.
 */
export function isPngImage(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length + 25 + PNG_END.length) return false;
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return false;
  if (view.getUint32(16) === 0 || view.getUint32(20) === 0) return false;
  return PNG_END.every((value, index) => bytes[bytes.length - PNG_END.length + index] === value);
}

/** Attachment names of one diagram start with this; `documentKey` and `pageKey` are short hex digests. */
export function confluenceLiveFilePrefix(documentKey: string): string {
  if (!/^[0-9a-f]{8,32}$/.test(documentKey)) throw new Error('Invalid document key.');
  return `${CONFLUENCE_LIVE_FILE_PREFIX}${documentKey}-`;
}

export function confluenceLiveFilename(documentKey: string, pageKey: string): string {
  if (!/^[0-9a-f]{8,32}$/.test(pageKey)) throw new Error('Invalid page key.');
  return `${confluenceLiveFilePrefix(documentKey)}${pageKey}.png`;
}

export interface ManagedImage {
  filename: string;
  /** Alternative text of a newly inserted image. */
  alt: string;
  /** Display width in pixels of a newly inserted image. */
  width: number;
}

export type ManagedImagePlan =
  | { status: 'unchanged' }
  | { status: 'changed'; body: string; added: string[]; removed: string[] }
  /** The markup or the ownership of an image could not be read without doubt; the body must not be written. */
  | { status: 'unsafe' };

interface OwnedRange { filename: string; start: number; end: number }

/** A `<ri:attachment>` directly inside an image. */
interface AttachmentReference { filename: string | null; contained: boolean }

interface OpenElement {
  name: string;
  start: number;
  /** For `ac:image`: its resource children (`ri:*`), and the attachments among them. */
  resources: number;
  attachments: AttachmentReference[];
  /** For `ri:attachment` inside an image: the reference it stands for. */
  reference: AttachmentReference | null;
}

const NAME = /[A-Za-z_][\w.:-]*/y;
const PREDEFINED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * The text an XML attribute value stands for. Numeric character references and the five predefined entities are
 * decoded; anything else cannot be decoded with certainty here and gives null.
 */
function decodeAttribute(raw: string): string | null {
  let failed = false;
  const text = raw.replace(/&([^;&]*);?/g, (match, body: string) => {
    if (!match.endsWith(';')) { failed = true; return ''; }
    if (body[0] === '#') {
      const hex = body[1] === 'x';
      const digits = body.slice(hex ? 2 : 1);
      if (!(hex ? /^[0-9a-fA-F]{1,6}$/ : /^[0-9]{1,7}$/).test(digits)) { failed = true; return ''; }
      const code = Number.parseInt(digits, hex ? 16 : 10);
      const valid = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
      if (!valid) { failed = true; return ''; }
      return String.fromCodePoint(code);
    }
    const value = PREDEFINED[body];
    if (value === undefined) { failed = true; return ''; }
    return value;
  });
  return failed ? null : text;
}

/**
 * Finds the owned `<ac:image>` elements of well-formed storage markup. Returns null for anything that is not
 * unambiguously well formed or whose ownership cannot be decided, so a body that this scanner misreads can never be
 * rewritten.
 */
function ownedRanges(body: string, prefix: string): OwnedRange[] | null {
  const ranges: OwnedRange[] = [];
  const stack: OpenElement[] = [];
  let index = 0;
  while (index < body.length) {
    const open = body.indexOf('<', index);
    if (open < 0) break;
    if (body.startsWith('<!--', open)) {
      const end = body.indexOf('-->', open + 4);
      if (end < 0) return null;
      index = end + 3; continue;
    }
    if (body.startsWith('<![CDATA[', open)) {
      const end = body.indexOf(']]>', open + 9);
      if (end < 0) return null;
      index = end + 3; continue;
    }
    if (body.startsWith('<?', open)) {
      const end = body.indexOf('?>', open + 2);
      if (end < 0) return null;
      index = end + 2; continue;
    }
    if (body[open + 1] === '/') {
      NAME.lastIndex = open + 2;
      const name = NAME.exec(body)?.[0];
      if (!name) return null;
      let cursor = open + 2 + name.length;
      while (/\s/.test(body[cursor] ?? '')) cursor++;
      if (body[cursor] !== '>') return null;
      const element = stack.pop();
      if (!element || element.name !== name) return null;
      if (element.name === 'ac:image') {
        // Owned: exactly one source, an attachment of this page with one of our file names.
        const reference = element.attachments[0];
        if (element.resources === 1 && element.attachments.length === 1 && reference?.filename && !reference.contained) ranges.push({ filename: reference.filename, start: element.start, end: cursor + 1 });
      }
      index = cursor + 1; continue;
    }
    NAME.lastIndex = open + 1;
    const name = NAME.exec(body)?.[0];
    if (!name) return null;
    let cursor = open + 1 + name.length;
    let filename: string | null | undefined;
    let selfClosing = false;
    const attributes = new Set<string>();
    for (;;) {
      const spaceStart = cursor;
      while (/\s/.test(body[cursor] ?? '')) cursor++;
      if (body[cursor] === '>') { cursor++; break; }
      if (body[cursor] === '/' && body[cursor + 1] === '>') { selfClosing = true; cursor += 2; break; }
      if (cursor === spaceStart) return null;
      NAME.lastIndex = cursor;
      const attribute = NAME.exec(body)?.[0];
      if (!attribute) return null;
      // An attribute given twice is not XML; which of the two values counts is anybody's guess.
      if (attributes.has(attribute)) return null;
      attributes.add(attribute);
      cursor += attribute.length;
      while (/\s/.test(body[cursor] ?? '')) cursor++;
      if (body[cursor] !== '=') return null;
      cursor++;
      while (/\s/.test(body[cursor] ?? '')) cursor++;
      const quote = body[cursor];
      if (quote !== '"' && quote !== "'") return null;
      const close = body.indexOf(quote, cursor + 1);
      if (close < 0) return null;
      const value = body.slice(cursor + 1, close);
      if (value.includes('<')) return null;
      if (name === 'ri:attachment' && attribute === 'ri:filename') filename = decodeAttribute(value);
      cursor = close + 1;
    }
    const parent = stack.at(-1);
    let reference: AttachmentReference | null = null;
    if (parent?.name === 'ac:image' && name.startsWith('ri:')) {
      parent.resources++;
      if (name === 'ri:attachment') {
        // A file name that cannot be decoded with certainty might or might not be ours: nothing may be decided on it.
        if (filename === null) return null;
        reference = { filename: filename !== undefined && filename.startsWith(prefix) && OWN_FILENAME.test(filename) ? filename : null, contained: false };
        parent.attachments.push(reference);
      }
    } else if (parent?.reference) {
      // Anything inside the reference (`ri:page`, `ri:blog-post`, …) names another container than this page.
      parent.reference.contained = true;
    }
    if (!selfClosing) stack.push({ name, start: open, resources: 0, attachments: [], reference });
    index = cursor;
  }
  if (stack.length > 0) return null;
  ranges.sort((a, b) => a.start - b.start);
  // Owned images never contain each other; anything else is markup this scanner does not understand.
  for (let position = 1; position < ranges.length; position++) if (ranges[position]!.start < ranges[position - 1]!.end) return null;
  return ranges;
}

function escapeAttribute(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function imageMarkup(image: ManagedImage): string {
  const width = Math.max(120, Math.min(1800, Math.round(image.width) || 760));
  return `<ac:image ac:align="center" ac:layout="center" ac:alt="${escapeAttribute(image.alt.slice(0, 300))}" ac:width="${width}"><ri:attachment ri:filename="${escapeAttribute(image.filename)}" /></ac:image>`;
}

/**
 * File names of this diagram that the page shows through images of its own attachments, in page order; null when
 * the markup cannot be read safely.
 */
export function managedImageFilenames(storageBody: string, prefix: string): string[] | null {
  const ranges = ownedRanges(storageBody, prefix);
  return ranges ? ranges.map((range) => range.filename) : null;
}

/**
 * Plans the smallest change that makes the page show exactly `images`: owned images of pages that no longer exist
 * are removed, missing ones are inserted next to their neighbour in the diagram (or at the end of the page). Images
 * that are already shown stay where somebody put them, with whatever size and position they were given.
 */
export function planManagedImages(storageBody: string, prefix: string, images: readonly ManagedImage[]): ManagedImagePlan {
  if (!prefix.startsWith(CONFLUENCE_LIVE_FILE_PREFIX) || prefix.length < CONFLUENCE_LIVE_FILE_PREFIX.length + 9) throw new Error('Invalid file prefix.');
  if (images.some((image) => !image.filename.startsWith(prefix) || !OWN_FILENAME.test(image.filename))) throw new Error('Invalid file name.');
  if (new Set(images.map((image) => image.filename)).size !== images.length) throw new Error('Duplicate file name.');
  const ranges = ownedRanges(storageBody, prefix);
  if (!ranges) return { status: 'unsafe' };
  const wanted = new Set(images.map((image) => image.filename));
  const shown = new Set(ranges.map((range) => range.filename));
  const stale = ranges.filter((range) => !wanted.has(range.filename));
  const missing = images.filter((image) => !shown.has(image.filename));
  if (stale.length === 0 && missing.length === 0) return { status: 'unchanged' };

  // Insertions are collected per position of the original body; removals are ranges of the original body.
  const insertions = new Map<number, string[]>();
  const insertAt = (position: number, markup: string) => { insertions.set(position, [...(insertions.get(position) ?? []), markup]); };
  const kept = ranges.filter((range) => wanted.has(range.filename));
  /** Where the image of each diagram page currently ends: the anchor for the page that follows it. */
  const anchorEnd = new Map<string, number>();
  for (const range of kept) if (!anchorEnd.has(range.filename)) anchorEnd.set(range.filename, range.end);
  let previous: number | null = null;
  const pendingBeforeFirst: string[] = [];
  for (const image of images) {
    const end = anchorEnd.get(image.filename);
    if (end !== undefined) {
      if (pendingBeforeFirst.length) {
        // Pages in front of the first shown page go in front of its image.
        const start = kept.find((range) => range.filename === image.filename)!.start;
        for (const markup of pendingBeforeFirst.splice(0)) insertAt(start, markup);
      }
      previous = end; continue;
    }
    if (previous === null && kept.length > 0) { pendingBeforeFirst.push(imageMarkup(image)); continue; }
    insertAt(previous ?? storageBody.length, imageMarkup(image));
  }
  for (const markup of pendingBeforeFirst) insertAt(storageBody.length, markup);

  let body = '';
  let cursor = 0;
  const positions = [...new Set([...insertions.keys(), ...stale.map((range) => range.start)])].sort((a, b) => a - b);
  for (const position of positions) {
    body += storageBody.slice(cursor, position);
    cursor = position;
    body += (insertions.get(position) ?? []).join('');
    const removal = stale.find((range) => range.start === position);
    if (removal) cursor = removal.end;
  }
  body += storageBody.slice(cursor);
  return { status: 'changed', body, added: missing.map((image) => image.filename), removed: [...new Set(stale.map((range) => range.filename))] };
}

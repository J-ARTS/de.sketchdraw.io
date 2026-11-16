import type { AnnotationBlock, AnnotationBlockType, AnnotationDocument, AnnotationRun } from './types';

const ENTITY_MAP: Readonly<Record<string, string>> = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (_match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITY_MAP[entity.toLowerCase()] ?? '';
  });
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function blockType(tag: string): AnnotationBlockType {
  if (/^h[1-4]$/.test(tag)) return `heading-${tag.slice(1)}` as AnnotationBlockType;
  if (tag === 'li') return 'bullet';
  if (tag === 'blockquote') return 'quote';
  return 'paragraph';
}

/** Converts Confluence storage XHTML to Sketchdraw's safe rich-text model. */
export function confluenceStorageToAnnotation(storageBody: string): AnnotationDocument {
  const blocks: AnnotationBlock[] = [];
  const withoutDangerous = storageBody.slice(0, 1_000_000).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  const pattern = /<(h[1-4]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of withoutDangerous.matchAll(pattern)) {
    const text = stripMarkup(match[2] ?? '');
    if (text) blocks.push({ type: blockType((match[1] ?? 'p').toLowerCase()), runs: [{ text }] });
  }
  if (blocks.length === 0) {
    const text = stripMarkup(withoutDangerous);
    if (text) blocks.push({ type: 'paragraph', runs: [{ text }] });
  }
  return { version: 1, blocks: blocks.length > 0 ? blocks : [{ type: 'paragraph', runs: [{ text: '' }] }] };
}

export type ConfluenceStorageLoss = 'formatting' | 'links' | 'numbered-lists' | 'tables' | 'media-and-macros' | 'characters' | 'structure';

const KEPT_BLOCK_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'li', 'blockquote']);
/** Attributes that carry no content of their own; the editor creates them again. */
const NEUTRAL_ATTRIBUTES = new Set(['local-id', 'ac:local-id', 'data-local-id']);

/**
 * Names what `confluenceStorageToAnnotation` followed by `annotationToConfluenceStorage` would remove from a page.
 * The annotation model keeps plain headings, paragraphs, bullets and quotes; everything else of a page (#209) is
 * lost when an imported annotation replaces the page body. An empty result means the page survives that round trip.
 */
export function confluenceStorageLoss(storageBody: string): ConfluenceStorageLoss[] {
  const found = new Set<ConfluenceStorageLoss>();
  if (storageBody.length > 1_000_000) found.add('structure');
  const body = storageBody.slice(0, 1_000_000);
  if (/<!\[CDATA\[|<!--|<\?/.test(body)) found.add('structure');
  let listDepth = 0;
  /** Blocks inside a list item or a quote: the annotation keeps one line of text per item. */
  const containers: Array<{ tag: string; blocks: number }> = [];
  for (const match of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g)) {
    const closing = match[1] === '/'; const tag = (match[2] ?? '').toLowerCase(); const attributes = match[3] ?? '';
    if (match[4] !== '/' && (tag === 'li' || tag === 'blockquote')) {
      if (closing) { if (containers.at(-1)?.tag === tag) containers.pop(); }
      else containers.push({ tag, blocks: 0 });
    } else if (!closing && containers.length > 0 && /^(h[1-6]|p)$/.test(tag) && ++containers.at(-1)!.blocks > 1) found.add('structure');
    if (tag === 'a') found.add('links');
    else if (tag === 'ol') found.add('numbered-lists');
    else if (['table', 'tbody', 'thead', 'tr', 'th', 'td', 'colgroup', 'col'].includes(tag)) found.add('tables');
    else if (tag.includes(':') || ['img', 'video', 'audio', 'iframe', 'object', 'embed'].includes(tag)) found.add('media-and-macros');
    else if (!KEPT_BLOCK_TAGS.has(tag)) found.add('formatting');
    if (tag === 'ul' || tag === 'ol') {
      if (closing) listDepth = Math.max(0, listDepth - 1);
      else if (++listDepth > 1) found.add('structure');
    }
    for (const attribute of attributes.matchAll(/([\w:.-]+)\s*=/g)) if (!NEUTRAL_ATTRIBUTES.has((attribute[1] ?? '').toLowerCase())) found.add('formatting');
  }
  // Markup the tag pattern above did not recognise cannot be judged; treat it as content that would be lost.
  if (body.replace(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g, '').includes('<')) found.add('structure');
  for (const match of body.matchAll(/&([a-z][a-z0-9]*);/gi)) if (ENTITY_MAP[(match[1] ?? '').toLowerCase()] === undefined) found.add('characters');
  const visible = stripMarkup(body);
  const kept = confluenceStorageToAnnotation(body).blocks.map((block) => block.runs.map((run) => run.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
  if (visible.replace(/\s+/g, '') !== kept.replace(/\s+/g, '')) found.add('structure');
  return [...found];
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function runToHtml(run: AnnotationRun): string {
  let result = escapeHtml(run.text);
  if (run.bold) result = `<strong>${result}</strong>`;
  if (run.italic) result = `<em>${result}</em>`;
  if (run.underline) result = `<u>${result}</u>`;
  if (run.color && /^#[0-9a-f]{6}$/i.test(run.color)) result = `<span style="color: ${run.color}">${result}</span>`;
  return result;
}

/** Serializes only the supported annotation subset; no arbitrary HTML survives the round-trip. */
export function annotationToConfluenceStorage(document: AnnotationDocument): string {
  return document.blocks.map((block) => {
    const contents = block.runs.map(runToHtml).join('');
    switch (block.type) {
      case 'heading-1': return `<h1>${contents}</h1>`;
      case 'heading-2': return `<h2>${contents}</h2>`;
      case 'heading-3': return `<h3>${contents}</h3>`;
      case 'heading-4': return `<h4>${contents}</h4>`;
      case 'bullet': return `<ul><li>${contents}</li></ul>`;
      case 'numbered': return `<ol><li>${contents}</li></ol>`;
      case 'quote': return `<blockquote>${contents}</blockquote>`;
      default: return `<p>${contents}</p>`;
    }
  }).join('');
}

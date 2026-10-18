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

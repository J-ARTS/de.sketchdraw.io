import type { SketchDocument } from '@/domain';
import { prepareSvgExport } from '@/interop';

/**
 * One diagram page as it is shown in Confluence (#210): the page as the SVG export draws it, on a white sheet with a
 * heading that names the diagram and the page. The heading is part of the image, so the Confluence page needs no
 * text of ours around it and every image explains itself.
 */
export interface LivePageRender {
  pageId: string;
  name: string;
  svg: string;
  /** Size in CSS pixels. */
  width: number;
  height: number;
  /** SHA-256 (hex) of `svg`: the same diagram gives the same value on every device. */
  hash: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 24;
const HEADER_HEIGHT = 56;
const MIN_WIDTH = 480;
const EMPTY_HEIGHT = 96;
/** Longest edge of the rendered PNG in device pixels. */
export const LIVE_IMAGE_MAX_EDGE = 4096;

const escapeXml = (value: string): string => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const number = (value: number): string => String(Math.round(value * 100) / 100);

function shorten(text: string, width: number): string {
  const limit = Math.max(12, Math.floor((width - 2 * PADDING) / 9.5));
  const characters = [...text];
  return characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : text;
}

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/**
 * Renders every page of the diagram through the existing SVG export. The export runs without the embedded document,
 * so comments, tasks and other data that is not visible on the canvas never reach Confluence.
 */
export async function renderLivePages(document: SketchDocument, text: { empty: string }): Promise<LivePageRender[]> {
  const pages: LivePageRender[] = [];
  for (const page of document.pages) {
    const exported = prepareSvgExport(document, { pageId: page.id, embedDocument: false }).contents;
    const root = /^<svg xmlns="[^"]*" viewBox="(-?[\d.e+-]+) (-?[\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)">/.exec(exported);
    if (!root || !exported.endsWith('</svg>')) throw new Error('The SVG export has an unexpected shape.');
    const empty = !document.elements.some((element) => element.pageId === page.id);
    const contentWidth = empty ? 0 : Number(root[3]); const contentHeight = empty ? 0 : Number(root[4]);
    if (!Number.isFinite(contentWidth) || !Number.isFinite(contentHeight)) throw new Error('The SVG export has an unexpected size.');
    const width = Math.ceil(Math.max(MIN_WIDTH, contentWidth + 2 * PADDING));
    const height = Math.ceil(HEADER_HEIGHT + (empty ? EMPTY_HEIGHT : contentHeight + PADDING));
    const heading = shorten(document.pages.length > 1 ? `${document.title} · ${page.name}` : document.title, width);
    const content = empty
      ? `<text x="${PADDING}" y="${HEADER_HEIGHT + 44}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="#6b7280">${escapeXml(text.empty)}</text>`
      : `<svg x="${number((width - contentWidth) / 2)}" y="${HEADER_HEIGHT}" width="${number(contentWidth)}" height="${number(contentHeight)}" viewBox="${root[1]} ${root[2]} ${root[3]} ${root[4]}">${exported.slice(root[0].length)}`;
    const svg = `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
      + `<rect width="${width}" height="${height}" fill="#ffffff"/>`
      + `<text x="${PADDING}" y="35" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="600" fill="#1f2330">${escapeXml(heading)}</text>`
      + `<rect x="0" y="${HEADER_HEIGHT - 1}" width="${width}" height="1" fill="#d9dce3"/>`
      + `${content}</svg>`;
    pages.push({ pageId: page.id, name: page.name, svg, width, height, hash: await digest(svg) });
    // Large diagrams must not block the canvas for the whole run.
    await Promise.resolve();
  }
  return pages;
}

/**
 * Draws the SVG into a PNG with the browser's own renderer. The SVG is loaded as an image, where scripts and
 * external resources are never executed or fetched; only pixels leave this function.
 */
export async function rasterizeSvgToPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') throw new Error('Rendering needs the desktop app window.');
  const scale = Math.min(2, LIVE_IMAGE_MAX_EDGE / Math.max(width, height));
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The diagram could not be rendered.'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The diagram could not be rendered.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/png'); });
  if (!blob) throw new Error('The diagram could not be rendered.');
  return new Uint8Array(await blob.arrayBuffer());
}

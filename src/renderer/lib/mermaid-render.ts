import { createDocument, createElement, DOMAIN_LIMITS, type SketchAsset, type SketchDocument, type SketchElement } from '@/domain';
import { rasterizeSvgToPng } from './confluence-live-image';

/**
 * Mermaid diagrams the app has no shapes for (#279): class, state and ER diagrams, Gantt, mind maps and the other
 * kinds of https://mermaid.js.org. Mermaid itself draws them. The drawing is stored as a raster image, and the
 * image carries its code, so it can be changed as code and drawn again. Flowcharts and sequence diagrams do not
 * come here: they become shapes that can be edited on the canvas.
 *
 * Mermaid is loaded only when such a diagram is drawn. It runs in the sandbox of the renderer with
 * `securityLevel: 'strict'`; what it draws is loaded as an image, where scripts never run and nothing is fetched,
 * and only its pixels are kept.
 */
export const MERMAID_CODE_KEY = 'mermaid:code';
/** Longest code that is drawn; Mermaid's own limit for the text of a diagram. */
export const MERMAID_MAX_CODE_LENGTH = 50_000;
/** Longest side an imported diagram gets on the canvas; a larger drawing is scaled down to it. */
const MAX_CANVAS_EDGE = 1200;

export interface RenderedMermaid {
  /** The drawing as a PNG. */
  dataUrl: string;
  /** Size of the drawing in CSS pixels, as Mermaid laid it out. */
  width: number;
  height: number;
}

/** The code cannot be drawn. `message` is what Mermaid said, shortened to its first lines. */
export class MermaidRenderError extends Error {
  constructor(message: string, public readonly reason: 'syntax' | 'size' | 'render' = 'syntax') { super(message); }
}

/** The code of a Mermaid image, or null for any other element. */
export function mermaidCodeOf(element: Pick<SketchElement, 'kind' | 'metadata'> | null | undefined): string | null {
  const code = element?.kind === 'image' ? element.metadata?.[MERMAID_CODE_KEY] : undefined;
  return typeof code === 'string' && code.trim() ? code : null;
}

/** What kind of diagram the code declares, for a name: its first word that is not a comment, directive or front matter. */
export function mermaidDiagramName(code: string): string {
  let frontMatter = false;
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (line === '---') { frontMatter = !frontMatter; continue; }
    if (frontMatter || !line || line.startsWith('%%')) continue;
    return /^[A-Za-z][\w-]*/.exec(line)?.[0] ?? 'Mermaid';
  }
  return 'Mermaid';
}

type Mermaid = (typeof import('mermaid'))['default'];
let loading: Promise<Mermaid> | null = null;
let counter = 0;
/** Loads Mermaid on first use. A failed load is tried again the next time. */
function mermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then((module) => {
    module.default.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'default', suppressErrorRendering: true, maxTextSize: MERMAID_MAX_CODE_LENGTH,
      // Mermaid's own layout. Its default since version 12 is ELK, which is not shipped with Sketchdraw (see
      // `stubs/elk.ts`); a diagram whose code asks for ELK says so instead of being drawn.
      layout: 'dagre',
      // Labels are SVG text: a drawing with HTML inside cannot be kept as a picture on every system.
      htmlLabels: false, flowchart: { htmlLabels: false },
      // The drawing is rasterised as an image, which cannot load the fonts of the app.
      fontFamily: 'Helvetica, Arial, sans-serif',
    });
    return module.default;
  }).catch((error) => { loading = null; throw error; });
  return loading;
}

const firstLines = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n').slice(0, 4).join('\n').slice(0, 500);

/** Size of an SVG from its `viewBox`; Mermaid writes its drawings with a relative width. */
function sized(svg: string): { svg: string; width: number; height: number } {
  // Mermaid writes its drawing the way a browser writes HTML. Where it holds HTML text (`<br>`, `&nbsp;`) it is not
  // well-formed XML; then the HTML reader takes it, and the result is written again as XML an image can load.
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const strict = xml.documentElement.nodeName === 'svg' && !xml.querySelector('parsererror') ? xml.documentElement : null;
  const root = strict ?? new DOMParser().parseFromString(svg, 'text/html').body.querySelector('svg');
  if (!root) throw new MermaidRenderError('Mermaid drew no picture.', 'render');
  const box = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const width = Number.isFinite(box[2]) && box[2]! > 0 ? box[2]! : Number.parseFloat(root.getAttribute('width') ?? '');
  const height = Number.isFinite(box[3]) && box[3]! > 0 ? box[3]! : Number.parseFloat(root.getAttribute('height') ?? '');
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) throw new MermaidRenderError('Mermaid drew no picture.', 'render');
  root.setAttribute('width', String(width)); root.setAttribute('height', String(height));
  root.removeAttribute('style');
  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

function toDataUrl(png: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < png.length; offset += 0x8000) binary += String.fromCharCode(...png.subarray(offset, offset + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/** Draws Mermaid code as a PNG. Throws a `MermaidRenderError` that says why when the code cannot be drawn. */
export async function renderMermaidImage(code: string): Promise<RenderedMermaid> {
  if (!code.trim()) throw new MermaidRenderError('The code is empty.');
  if (code.length > MERMAID_MAX_CODE_LENGTH) throw new MermaidRenderError('The code is too long.', 'size');
  const engine = await mermaid();
  try { await engine.parse(code); } catch (error) { throw new MermaidRenderError(firstLines(error)); }
  let drawn: string;
  try { drawn = (await engine.render(`sketchdraw-mermaid-${++counter}`, code)).svg; } catch (error) { throw new MermaidRenderError(firstLines(error), 'render'); }
  const { svg, width, height } = sized(drawn);
  let png: Uint8Array;
  try { png = await rasterizeSvgToPng(svg, width, height); } catch (error) { throw new MermaidRenderError(`The drawing could not be turned into an image (${firstLines(error)}).`, 'render'); }
  const dataUrl = toDataUrl(png);
  if (dataUrl.length > DOMAIN_LIMITS.MAX_ASSET_BYTES) throw new MermaidRenderError('The drawing is too large for an image of the document.', 'size');
  return { dataUrl, width, height };
}

/** The size a drawing gets on the canvas: its own, scaled down when it is larger than the canvas usually shows. */
export function mermaidCanvasSize(rendered: Pick<RenderedMermaid, 'width' | 'height'>): { width: number; height: number } {
  const scale = Math.min(1, MAX_CANVAS_EDGE / Math.max(rendered.width, rendered.height));
  return { width: Math.max(1, Math.round(rendered.width * scale)), height: Math.max(1, Math.round(rendered.height * scale)) };
}

/** The asset and the image element of a drawn diagram; the element carries the code. */
export function mermaidImage(code: string, rendered: RenderedMermaid, ids: { asset: string; element?: string; pageId?: string }, at: { x: number; y: number } = { x: 0, y: 0 }): { asset: SketchAsset; element: SketchElement } {
  const name = mermaidDiagramName(code);
  const { width, height } = mermaidCanvasSize(rendered);
  const asset: SketchAsset = { id: ids.asset, name: `${name}.png`, mimeType: 'image/png', dataUrl: rendered.dataUrl };
  const element = createElement('image', { ...(ids.element ? { id: ids.element } : {}), ...(ids.pageId ? { pageId: ids.pageId } : {}), x: at.x, y: at.y, width, height, assetId: asset.id, label: name, metadata: { [MERMAID_CODE_KEY]: code } });
  return { asset, element };
}

/** A document with the drawn diagram as its only element, as an import result needs it. */
export function mermaidImageDocument(code: string, rendered: RenderedMermaid): SketchDocument {
  const base = createDocument(mermaidDiagramName(code));
  const { asset, element } = mermaidImage(code, rendered, { asset: `asset:mermaid-${Date.now().toString(36)}-${++counter}`, pageId: base.pages[0]!.id }, { x: 80, y: 80 });
  return { ...base, assets: { [asset.id]: asset }, elements: [element] };
}

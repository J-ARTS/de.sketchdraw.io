import { alignedTextTop, annotationPlainText, connectorEndMarker, tablePlainText, extractPage, connectorPathData, connectorRouting, connectorStartMarker, effectiveShapeVariant, SHAPE_PATHS, SHAPE_TEXT_SIDE_INSET, serializeDocument, supportsVerticalAlign, TEXT_LINE_HEIGHT, validateDocument, verticalAlignOf, verticalTextInset, visibleLineCount, wrapTextLines } from '../domain';
import type { ComponentSet, ConnectorMarker, Point, SketchDocument, SketchElement } from '../domain';
import { resolveAnchorWorldPoint, syncConnectorEndpoints } from '../domain/geometry';
import { mergeLayout } from '../domain/table-merge';
import { resolveCatalogIcon, type SafeSvgElementNode } from '../catalog/icon';
import { awsGroupOf, builtInComponentSets, CLOUD_CARD_EXPORT_COLORS, CLOUD_CARD_PROVIDER_SIZE, CLOUD_CARD_TITLE_SIZE, cloudCardLayout, cloudCardUsesThemeSurface, cloudProviderLabel, cloudProviderOf, figureLayout, groupChrome, groupTileSvg, isCloudCard, isIconFigure, isResourceCard, resourceCardIconType, resourceCardLayout, resourceCardLines, resourceCardLinks, RESOURCE_CARD_TEXT_COLOR, type CloudCardLayout } from '../catalog';
import { DiagnosticCollector, XmlOutputBuilder, escapeXmlAttr, escapeXmlText, hasWarningDiagnostics, sanitizeXml10Text } from './diagnostics';
import { SVG_NS, OWN_NS, color, CURRENT_PROJECTION, encodeEnvelope, type ProjectionVersion } from './common';
import { parseXmlDocument } from './xml';
import { encodeBytesToBase64 } from './compression';
import { InteropError, type InteropExportOptions, type InteropExportResult, type InteropFormat } from './types';
const n = (v: number): string => String(Object.is(v, -0) ? 0 : v);
export function worldPoint(el: SketchElement, point: Point): Point {
  return resolveAnchorWorldPoint({ ...el, width: 2, height: 2, x: el.x + el.width / 2 - 1, y: el.y + el.height / 2 - 1 }, { x: (point.x - el.width / 2) / 2 + 0.5, y: (point.y - el.height / 2) / 2 + 0.5 });
}
function diagnostic(d: DiagnosticCollector, el: SketchElement | undefined, code: string, message: string, warning = true) {
  d.add({ code, elementId: el?.id, property: 'projection', severity: warning ? 'warning' : 'info', effect: warning ? 'approximated' : 'preserved-as-data', message });
}
function safeColor(v: string, d: DiagnosticCollector, el: SketchElement): string {
  return color(v, '#000000', () => diagnostic(d, el, 'STYLE_APPROXIMATED', 'Unsafe or unsupported color replaced with black.'));
}
function safeTextColor(el: SketchElement, d: DiagnosticCollector): string {
  return safeColor(el.style.textColor ?? el.style.stroke, d, el);
}
function xmlText(value: string, d: DiagnosticCollector, el?: SketchElement): string {
  return sanitizeXml10Text(value, d, { elementId: el?.id });
}
function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => ` ${k}="${escapeXmlAttr(String(v))}"`).join('');
}
function svgPaint(el: SketchElement, d: DiagnosticCollector): string {
  return attrs({ stroke: safeColor(el.style.stroke, d, el), fill: safeColor(el.style.fill, d, el), 'stroke-width': el.style.strokeWidth, opacity: el.style.opacity,
    ...(el.style.strokeDash === 'solid' ? {} : { 'stroke-dasharray': el.style.strokeDash === 'dotted' ? '2 4' : '8 6' }) });
}
const SVG_FONT_FAMILY = { sans: 'Inter, sans-serif', mono: 'JetBrains Mono, monospace', roboto: 'Roboto, sans-serif', scribbled: 'Caveat, cursive' } as const;
const DRAWIO_FONT_FAMILY = { sans: 'sans-serif', mono: 'monospace', roboto: 'Roboto, sans-serif', scribbled: 'Caveat, cursive' } as const;
/** The text an element shows. Up to SVG picture 1 and draw.io picture 2 an emptied text fell back to the label. */
const shownText = (el: SketchElement, legacyLabel: boolean): string => legacyLabel ? el.text || el.label || '' : el.text ?? el.label ?? '';
/**
 * Whether the text of an element is plain text inside its box: a shape or free text. Parts of a sequence diagram
 * that draw their own text (fragment titles, dividers, actors) are not.
 */
function hasPlacedText(el: SketchElement): boolean {
  if (!supportsVerticalAlign(el.kind)) return false;
  const part = el.metadata?.['sequence:role'];
  return !(part === 'fragment' || part === 'divider' || (part === 'head' && el.metadata?.['sequence:head'] === 'actor'));
}
/**
 * Text of a shape or of free text as the canvas draws it (#277, #296): broken into the same lines, 8 px from the
 * side it is aligned to, at the top, in the middle or at the bottom, 1.25 line height. Pictures 1 and 2 wrote it
 * unbroken into the upper left corner.
 */
function placedText(el: SketchElement, plainText: string, d: DiagnosticCollector): string {
  const font = el.style.fontSize, align = el.style.textAlign, free = el.kind === 'text';
  const lines = wrapTextLines(xmlText(plainText, d, el), el.width, font, free ? 0 : 2 * SHAPE_TEXT_SIDE_INSET)
    .slice(0, visibleLineCount(el.height, font))
    .map(line => el.style.listStyle === 'bullet' && line.text !== '' ? `• ${line.text}` : line.text);
  const x = align === 'center' ? el.width / 2 : align === 'right' ? el.width - SHAPE_TEXT_SIDE_INSET : free ? 0 : SHAPE_TEXT_SIDE_INSET;
  const step = font * TEXT_LINE_HEIGHT;
  const y = alignedTextTop(verticalAlignOf(el), el.height, lines.length * step, verticalTextInset(el.kind)) + font * .93;
  return `<text${attrs({ x, y, 'font-size': font, 'font-family': SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'], 'font-weight': el.style.fontWeight ?? 'normal', 'text-decoration': el.style.textDecoration ?? 'none', 'text-anchor': align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', stroke: 'none', fill: safeTextColor(el, d), opacity: el.style.opacity, 'xml:space': 'preserve' })}>${lines.map((line, i) => `<tspan${attrs({ x, y: y + i * step })}>${escapeXmlText(line)}</tspan>`).join('')}</text>`;
}
function nativeText(el: SketchElement, d: DiagnosticCollector, legacyLabel = false, placed = false): string {
  // An emptied text stays empty; the label stands in only where no text was set (#258).
  const plainText = shownText(el, legacyLabel);
  if (placed && hasPlacedText(el)) {
    if (plainText === '') return '';
    diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Editable text depends on fonts available in the receiving application.');
    return placedText(el, plainText, d);
  }
  const visibleText = el.style.listStyle === 'bullet'
    ? plainText.split('\n').map(line => line ? `• ${line}` : line).join('\n')
    : plainText;
  if (visibleText === '')
    return '';
  diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Editable text depends on fonts available in the receiving application.');
  const font = el.style.fontSize, align = el.kind === 'connector' ? 'center' : el.style.textAlign;
  const group = awsGroupOf(el);
  // A component with a small symbol (service, database, queue …) has its symbol centred at the top and its text in
  // the lower half, 8 px from the side, as the canvas draws it. Picture 1 wrote the text over the symbol.
  const plainComponent = !legacyLabel && el.kind === 'component' && !isIconFigure(el) && !group;
  const inset = el.kind === 'sticky-note' ? 20 : plainComponent ? 8 : 0;
  const label = group ? groupChrome(group, el.width, font).label : null;
  const x = label ? (align === 'center' ? (label.left + label.right) / 2 : align === 'right' ? label.right : label.left) : align === 'center' ? el.width / 2 : align === 'right' ? el.width - inset : inset;
  // A free-standing symbol (isometric icons) carries its label below the symbol.
  const figure = isIconFigure(el) ? figureLayout(el, visibleText.split('\n').length) : null;
  const y = label ? label.top + font * .93 : figure ? figure.labelTop + font * .93 : el.kind === 'connector' ? el.height / 2 : plainComponent ? el.height * .58 + font * .93 : font + inset;
  const text = xmlText(visibleText, d, el);
  return `<text${attrs({ x, y, 'font-size': font, 'font-family': SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'], 'font-weight': el.style.fontWeight ?? 'normal', 'text-decoration': el.style.textDecoration ?? 'none', 'text-anchor': align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', ...(el.kind === 'connector' ? { 'dominant-baseline': 'middle', 'paint-order': 'stroke', stroke: '#ffffff', 'stroke-width': 8, 'stroke-linejoin': 'round' } : { stroke: 'none' }), fill: safeTextColor(el, d), opacity: el.style.opacity, 'xml:space': 'preserve' })}>${text.split('\n').map((line, i) => `<tspan${attrs({ x, y: y + i * font * 1.2 })}>${escapeXmlText(line)}</tspan>`).join('')}</text>`;
}
function stickyAuthor(el: SketchElement, d: DiagnosticCollector): string {
  if (el.kind !== 'sticky-note' || !el.author) return '';
  return `<text${attrs({ x: 20, y: el.height - 20, 'font-size': Math.max(12, el.style.fontSize * .72), 'font-family': SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'], fill: safeTextColor(el, d), opacity: el.style.opacity * .82 })}>${escapeXmlText(xmlText(el.author, d, el))}</text>`;
}
function annotationSvgContent(el: SketchElement, d: DiagnosticCollector): string {
  if (el.kind !== 'annotation' || !el.annotation) return '';
  diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Formatted annotation text depends on fonts available in the receiving application.');
  const base = el.style.fontSize;
  let y = 28;
  let numbered = 0;
  return el.annotation.blocks.map((block) => {
    const size = block.type === 'heading-1' ? base * 1.8 : block.type === 'heading-2' ? base * 1.5 : block.type === 'heading-3' ? base * 1.28 : block.type === 'heading-4' ? base * 1.12 : base;
    const weight = block.type.startsWith('heading-') ? 700 : 400;
    if (block.type === 'numbered') numbered += 1; else numbered = 0;
    const prefix = block.type === 'bullet' ? '• ' : block.type === 'numbered' ? `${numbered}. ` : block.type === 'quote' ? '❝ ' : '';
    y += size;
    const runs = block.runs.map((run, index) => `<tspan${attrs({ ...(index === 0 ? { x: 28 } : {}), 'font-weight': run.bold ? 700 : undefined, 'font-style': run.italic ? 'italic' : undefined, 'text-decoration': run.underline ? 'underline' : undefined, fill: run.color ? safeColor(run.color, d, el) : undefined })}>${index === 0 ? escapeXmlText(prefix) : ''}${escapeXmlText(xmlText(run.text, d, el))}</tspan>`).join('');
    const output = `<text${attrs({ x: 28, y, 'font-size': size, 'font-family': SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'], 'font-weight': weight, fill: safeTextColor(el, d), opacity: el.style.opacity })}>${runs}</text>`;
    y += size * .65;
    return output;
  }).join('');
}
/**
 * The grid of a table. Merged cells (#197) are drawn as the canvas draws them, once and over their whole region,
 * with the text and format of their top left cell; the cells below a merge are not drawn (#287). Up to SVG
 * picture 2 every cell was drawn, which showed the text a merge hides.
 */
function tableSvgContent(el: SketchElement, d: DiagnosticCollector, merged: boolean): string {
  if (el.kind !== 'table' || !el.table) return '';
  diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Table text depends on fonts available in the receiving application.');
  const table = el.table;
  const totalWidth = table.columns.reduce((sum, column) => sum + column.width, 0) || 1;
  const totalHeight = table.rows.reduce((sum, row) => sum + row.height, 0) || 1;
  const widths = table.columns.map(column => el.width * column.width / totalWidth);
  const heights = table.rows.map(row => el.height * row.height / totalHeight);
  const merges = merged ? mergeLayout(el, table) : null;
  let y = 0;
  return table.rows.map((row, rowIndex) => {
    let x = 0;
    const output = table.columns.map((column, columnIndex) => {
      const cell = table.cells.find((entry) => entry.rowId === row.id && entry.columnId === column.id)!;
      const region = merges?.anchors.get(cell.id);
      const width = region ? widths.slice(columnIndex, columnIndex + region.columnSpan).reduce((sum, value) => sum + value, 0) : widths[columnIndex]!;
      const height = region ? heights.slice(rowIndex, rowIndex + region.rowSpan).reduce((sum, value) => sum + value, 0) : heights[rowIndex]!;
      if (merges?.covered.has(cell.id)) { x += widths[columnIndex]!; return ''; }
      const align = cell.style.textAlign; const tx = align === 'center' ? x + width / 2 : align === 'right' ? x + width - 10 : x + 10;
      const value = cell.style.listStyle === 'bullet' && cell.text ? `• ${cell.text}` : cell.text;
      const markup = `<rect${attrs({ x, y, width, height, fill: safeColor(cell.style.fill, d, el), stroke: '#cbd5e1', 'stroke-width': 1 })}/>${value ? `<text${attrs({ x: tx, y: y + 10 + cell.style.fontSize, fill: safeColor(cell.style.color, d, el), 'font-size': cell.style.fontSize, 'font-family': SVG_FONT_FAMILY[cell.style.fontFamily], 'font-weight': cell.style.fontWeight, 'text-decoration': cell.style.textDecoration, 'text-anchor': align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start' })}>${escapeXmlText(xmlText(value, d, el))}</text>` : ''}`;
      x += widths[columnIndex]!; return markup;
    }).join('');
    y += heights[rowIndex]!; return output;
  }).join('');
}
/** The text of a table as its cells show it: a cell below a merge shows nothing (#287). */
function visibleTableText(el: SketchElement): string {
  if (!el.table) return el.text ?? '';
  const covered = mergeLayout(el, el.table).covered;
  if (!covered.size) return tablePlainText(el.table);
  return tablePlainText({ ...el.table, cells: el.table.cells.map(cell => covered.has(cell.id) ? { ...cell, text: '' } : cell) });
}
/** What the SVG export needs to draw the card of a cloud component like the canvas does, or null for any other element. */
function cloudCardExport(el: SketchElement, componentSets: readonly ComponentSet[], d: DiagnosticCollector): { layout: CloudCardLayout; fill: string; stroke: string; text: string; providerText: string; titleColor: string } | null {
  if (!isCloudCard(el, componentSets)) return null;
  const provider = cloudProviderOf(el, componentSets)!;
  const definition = componentSets.flatMap(set => set.components).find(c => c.type === el.componentType);
  const layout = cloudCardLayout(el, (el.text ?? el.label) || definition?.name || 'Component');
  const themed = cloudCardUsesThemeSurface(el, definition);
  const fontFamily = SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'];
  const titleFill = el.style.textColor ? safeColor(el.style.textColor, d, el) : CLOUD_CARD_EXPORT_COLORS.text;
  const title = layout.title.lines.map((line, index) => `<tspan${attrs({ x: layout.title.x, y: layout.title.y + index * layout.title.lineHeight })}>${escapeXmlText(xmlText(line, d, el))}</tspan>`).join('');
  const titleText = `<text${attrs({ 'font-size': CLOUD_CARD_TITLE_SIZE, 'font-family': fontFamily, 'font-weight': 650, 'text-anchor': 'middle', fill: titleFill, opacity: el.style.opacity })}>${title}</text>`;
  const providerText = `<text${attrs({ x: layout.title.x, y: layout.providerY, 'font-size': CLOUD_CARD_PROVIDER_SIZE, 'font-family': fontFamily, 'font-weight': 500, 'text-anchor': 'middle', fill: CLOUD_CARD_EXPORT_COLORS.provider, opacity: el.style.opacity })}>${escapeXmlText(cloudProviderLabel(provider))}</text>`;
  return {
    layout,
    fill: themed.fill ? CLOUD_CARD_EXPORT_COLORS.surface : safeColor(el.style.fill, d, el),
    stroke: themed.stroke ? CLOUD_CARD_EXPORT_COLORS.border : safeColor(el.style.stroke, d, el),
    text: `${titleText}${providerText}`,
    providerText,
    titleColor: titleFill,
  };
}
/** The resource card of SVG picture 1 (releases up to 0.1.8): one line per text. Only drawn to verify such a file. */
function resourceCardSvgContentV1(el: SketchElement, d: DiagnosticCollector): string {
  if (!isResourceCard(el)) return '';
  const fontFamily = SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'];
  const titleSize = Math.max(14, el.style.fontSize);
  const descriptionSize = Math.max(10, el.style.fontSize * .65);
  const footerHeight = Math.max(28, Math.min(36, el.height * .24));
  const bodyHeight = Math.max(0, el.height - footerHeight);
  const iconSize = Math.max(28, Math.min(52, bodyHeight * .48, el.width * .16));
  const textX = 20 + iconSize + 18;
  const title = escapeXmlText(xmlText(el.text || el.label || 'Ressourcenkarte', d, el));
  const description = escapeXmlText(xmlText((el.description || 'BESCHREIBUNG').toUpperCase(), d, el));
  const links = resourceCardLinks(el);
  const linkMarkup = links.map((link, index) => {
    const width = el.width / links.length;
    const x = width * (index + .5);
    return `<a href="${escapeXmlAttr(link.url)}"><text${attrs({ x, y: el.height - footerHeight / 2, 'font-size': Math.max(10, Math.min(14, descriptionSize)), 'font-family': fontFamily, 'font-weight': 650, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#2563eb' })}>${escapeXmlText(xmlText(link.label.toUpperCase(), d, el))}</text></a>`;
  }).join('');
  return `<text${attrs({ x: textX, y: bodyHeight / 2 - Math.max(5, titleSize * .25), 'font-size': titleSize, 'font-family': fontFamily, 'font-weight': 600, 'dominant-baseline': 'central', fill: safeTextColor(el, d) })}>${title}</text><text${attrs({ x: textX, y: bodyHeight / 2 + Math.max(16, titleSize * .85), 'font-size': descriptionSize, 'font-family': fontFamily, 'font-weight': 500, 'dominant-baseline': 'central', fill: safeTextColor(el, d), 'fill-opacity': .55 })}>${description}</text>${linkMarkup}`;
}
/** Where SVG picture 1 put the icon of a resource card. */
function legacyResourceCardIcon(el: SketchElement): { iconSize: number; icon: Point } {
  const footerHeight = Math.max(28, Math.min(36, el.height * .24));
  const iconSize = Math.max(28, Math.min(52, (el.height - footerHeight) * .48, el.width * .16));
  return { iconSize, icon: { x: 20, y: Math.max(10, (el.height - footerHeight - iconSize) / 2) } };
}
function resourceCardSvgContent(el: SketchElement, d: DiagnosticCollector, withoutTitle = false): string {
  if (!isResourceCard(el)) return '';
  // The same layout as on the canvas: several lines per text (#254) and both looks of the card (#257).
  const layout = resourceCardLayout(el);
  const dashed = layout.look === 'dashed';
  const fontFamily = SVG_FONT_FAMILY[el.style.fontFamily ?? 'sans'];
  // Without a chosen text colour the card is written in black, as on the canvas (#189), not in its frame colour.
  const fill = el.style.textColor ? safeColor(el.style.textColor, d, el) : RESOURCE_CARD_TEXT_COLOR;
  const lines = (block: typeof layout.title, values: string[]) => values.map((line, index) => `<tspan${attrs({ x: layout.textX, y: block.y + index * block.lineHeight })}>${escapeXmlText(xmlText(line, d, el))}</tspan>`).join('');
  const title = lines(layout.title, resourceCardLines(el.text || el.label || 'Ressourcenkarte'));
  const description = lines(layout.description, resourceCardLines(el.description || (dashed ? 'Beschreibung' : 'BESCHREIBUNG')).map((line) => dashed ? line : line.toUpperCase()));
  const links = resourceCardLinks(el);
  const linkSize = Math.max(10, Math.min(14, layout.description.fontSize));
  const linkMarkup = links.map((link, index) => {
    const width = layout.footer.width / links.length;
    const left = layout.footer.x + width * index;
    const y = layout.footer.y + layout.footer.height / 2;
    const text = dashed
      ? `<text${attrs({ x: left + 14, y, 'font-size': linkSize, 'font-family': fontFamily, 'font-weight': 500, 'dominant-baseline': 'central', fill })}>${escapeXmlText(xmlText(link.label, d, el))}</text>`
      : `<text${attrs({ x: left + width / 2, y, 'font-size': linkSize, 'font-family': fontFamily, 'font-weight': 650, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#2563eb' })}>${escapeXmlText(xmlText(link.label.toUpperCase(), d, el))}</text>`;
    return `<a href="${escapeXmlAttr(link.url)}">${text}</a>`;
  }).join('');
  return `${withoutTitle ? '' : `<text${attrs({ 'font-size': layout.title.fontSize, 'font-family': fontFamily, 'font-weight': 600, 'dominant-baseline': 'central', fill })}>${title}</text>`}<text${attrs({ 'font-size': layout.description.fontSize, 'font-family': fontFamily, 'font-weight': 500, 'dominant-baseline': 'central', fill })}>${description}</text>${linkMarkup}`;
}
const DRAWIO_MARKER: Readonly<Record<ConnectorMarker, string>> = {
  none: 'none', 'line-arrow': 'open', 'solid-arrow': 'classic', triangle: 'block',
  'solid-triangle': 'block',
  // diagrams.net has no distinct reversed-triangle end marker. The embedded
  // Sketchdraw model retains it; an unembedded projection uses the closest cap.
  'reverse-triangle': 'block', circle: 'oval', 'solid-circle': 'oval', diamond: 'diamond',
  'exactly-one': 'ERmandOne', many: 'ERmany', 'zero-or-one': 'ERzeroToOne',
  'zero-or-many': 'ERzeroToMany', 'one-or-many': 'ERoneToMany',
};
const DRAWIO_FILLED_MARKERS: ReadonlySet<ConnectorMarker> = new Set(['solid-arrow', 'solid-triangle', 'solid-circle']);
function svgMarker(id: string, marker: ConnectorMarker, stroke: string, width: number): string {
  if (marker === 'none') return '';
  const er = ['exactly-one', 'many', 'zero-or-one', 'zero-or-many', 'one-or-many'].includes(marker);
  const refX = marker === 'exactly-one' || marker === 'zero-or-one' ? 14 : er ? 17 : 11;
  const common = `id="${id}" markerWidth="${er ? 20 : 14}" markerHeight="14" refX="${refX}" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"`;
  const paint = `stroke="${escapeXmlAttr(stroke)}" stroke-width="${n(Math.max(1, width))}" stroke-linejoin="round"`;
  if (marker === 'line-arrow') return `<marker ${common}><path d="M2 2L11 7L2 12" fill="none" ${paint}/></marker>`;
  if (marker === 'solid-arrow') return `<marker ${common}><path d="M1 1L12 7L1 13Z" fill="${escapeXmlAttr(stroke)}" ${paint}/></marker>`;
  if (marker === 'triangle') return `<marker ${common}><path d="M1 1L12 7L1 13Z" fill="white" ${paint}/></marker>`;
  if (marker === 'solid-triangle') return `<marker ${common}><path d="M1 1L12 7L1 13Z" fill="${escapeXmlAttr(stroke)}" ${paint}/></marker>`;
  if (marker === 'reverse-triangle') return `<marker ${common}><path d="M11 1L1 7L11 13Z" fill="white" ${paint}/></marker>`;
  if (marker === 'circle') return `<marker ${common}><circle cx="7" cy="7" r="5" fill="white" ${paint}/></marker>`;
  if (marker === 'solid-circle') return `<marker ${common}><circle cx="7" cy="7" r="5" fill="${escapeXmlAttr(stroke)}" ${paint}/></marker>`;
  if (marker === 'diamond') return `<marker ${common}><path d="M1 7L7 1L13 7L7 13Z" fill="white" ${paint}/></marker>`;
  if (marker === 'exactly-one') return `<marker ${common}><path d="M7 2V12M14 2V12" fill="none" ${paint}/></marker>`;
  if (marker === 'many') return `<marker ${common}><path d="M5 7H9M9 7L17 1M9 7L17 7M9 7L17 13" fill="none" ${paint}/></marker>`;
  if (marker === 'zero-or-one') return `<marker ${common}><circle cx="5" cy="7" r="3.5" fill="white" ${paint}/><path d="M14 2V12" fill="none" ${paint}/></marker>`;
  if (marker === 'zero-or-many') return `<marker ${common}><circle cx="4.5" cy="7" r="3.5" fill="white" ${paint}/><path d="M8 7H11M11 7L17 1M11 7L17 7M11 7L17 13" fill="none" ${paint}/></marker>`;
  return `<marker ${common}><path d="M5 2V12M8 7H11M11 7L17 1M11 7L17 7M11 7L17 13" fill="none" ${paint}/></marker>`;
}
function safeIcon(node: SafeSvgElementNode): string {
  return `<${node.tag}${attrs(node.attributes)}>${node.children.map(safeIcon).join('')}</${node.tag}>`;
}
function nativeSvg(document: SketchDocument, d: DiagnosticCollector, embed: boolean, projectionVersion: ProjectionVersion = CURRENT_PROJECTION.svg, picture: { withoutTitle?: boolean } = {}): string {
  // Picture 1 is what releases up to 0.1.8 wrote; it is drawn again only to verify a file of that version (#272).
  const legacy = projectionVersion < 2;
  // Picture 3 places the text of shapes and of free text as the canvas does (#277) and draws merged table cells
  // as one cell (#287).
  const placed = projectionVersion >= 3;
  const out = new XmlOutputBuilder();
  const map = new Map(document.elements.map(el => [el.id, el]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const componentSets = [...document.componentSets, ...builtInComponentSets];
  for (const raw of document.elements) {
    const el = syncConnectorEndpoints(raw, map);
    const points = el.points ?? [{ x: 0, y: 0 }, { x: el.width, y: 0 }, { x: el.width, y: el.height }, { x: 0, y: el.height }];
    for (const local of points) {
      const p = worldPoint(el, local);
      const pad = el.style.strokeWidth / 2 + 16;
      minX = Math.min(minX, p.x - pad);
      minY = Math.min(minY, p.y - pad);
      maxX = Math.max(maxX, p.x + pad);
      maxY = Math.max(maxY, p.y + pad);
    }
  }
  const bounds = document.elements.length ? [minX, minY, maxX - minX, maxY - minY] : [0, 0, 1, 1];
  out.append(`<svg xmlns="${SVG_NS}" viewBox="${bounds.map(n).join(' ')}"><title>${escapeXmlText(xmlText(document.title, d))}</title>`);
  if (embed)
    out.append(`<metadata><sd:document xmlns:sd="${OWN_NS}">${encodeEnvelope(document, 'svg', projectionVersion)}</sd:document></metadata>`);
  for (let index = 0; index < document.elements.length; index++) {
    const el = syncConnectorEndpoints(document.elements[index]!, map);
    out.append(`<g${attrs({ id: `sd-${index}`, transform: `translate(${n(el.x)} ${n(el.y)}) rotate(${n(el.rotation)} ${n(el.width / 2)} ${n(el.height / 2)})` })}>`);
    if (el.label !== undefined)
      out.append(`<title>${escapeXmlText(xmlText(el.label, d, el))}</title>`);
    if (el.description !== undefined)
      out.append(`<desc>${escapeXmlText(xmlText(el.description, d, el))}</desc>`);
    const paint = svgPaint(el, d);
    const cloud = legacy ? null : cloudCardExport(el, componentSets, d);
    const shapeVariant = effectiveShapeVariant(el);
    const markerStart = el.kind === 'connector' ? connectorStartMarker(el) : 'none';
    const markerEnd = el.kind === 'connector' ? connectorEndMarker(el) : 'none';
    if (el.kind === 'connector' && (markerStart !== 'none' || markerEnd !== 'none')) {
      const markerColor = safeColor(el.style.stroke, d, el);
      out.append(`<defs>${svgMarker(`sd-${index}-start`, markerStart, markerColor, el.style.strokeWidth)}${svgMarker(`sd-${index}-end`, markerEnd, markerColor, el.style.strokeWidth)}</defs>`);
    }
    if (el.kind === 'sticky-note') {
      out.append(`<defs><filter id="sd-${index}-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#18251d" flood-opacity=".18"/></filter></defs>`);
      out.append(`<rect${attrs({ x: 0, y: 0, width: el.width, height: el.height, fill: safeColor(el.style.fill, d, el), opacity: el.style.opacity, stroke: 'none', filter: `url(#sd-${index}-shadow)` })}/>`);
    }
    else if (el.kind === 'annotation') {
      out.append(`<defs><filter id="sd-${index}-annotation-shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#263244" flood-opacity=".14"/></filter></defs>`);
      out.append(`<rect${attrs({ x: 0, y: 0, width: el.width, height: el.height, rx: 8, fill: safeColor(el.style.fill, d, el), stroke: safeColor(el.style.stroke, d, el), 'stroke-width': el.style.strokeWidth, opacity: el.style.opacity, filter: `url(#sd-${index}-annotation-shadow)` })}/>`);
    }
    else if (el.kind === 'table') out.append(tableSvgContent(el, d, placed));
    else if (el.kind === 'web-embed') {
      out.append(`<a href="${escapeXmlAttr(el.embedUrl!)}"><rect${attrs({ x: 0, y: 0, width: el.width, height: el.height, rx: 8, fill: safeColor(el.style.fill, d, el), stroke: safeColor(el.style.stroke, d, el), 'stroke-width': el.style.strokeWidth, opacity: el.style.opacity })}/>`);
      out.append(`<path d="M0 34H${n(el.width)}" stroke="${safeColor(el.style.stroke, d, el)}" stroke-width="1" opacity=".55"/><circle cx="16" cy="17" r="4" fill="#22c55e"/><text x="28" y="22" font-size="12" font-family="sans-serif" fill="${safeTextColor(el, d)}">${escapeXmlText(xmlText(el.label ?? el.embedUrl ?? 'Web-Embed', d, el))}</text></a>`);
      diagnostic(d, el, 'WEB_EMBED_PROJECTED_AS_LINK', 'Web embed is exported as a static linked card; remote page content is not embedded.');
    }
    else if (el.kind === 'frame') {
      out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}" fill="none"${attrs({ stroke: safeColor(el.style.stroke, d, el), 'stroke-width': el.style.strokeWidth, 'stroke-dasharray': '10 7', opacity: el.style.opacity, 'data-sketchdraw-kind': 'frame' })}/>`);
      diagnostic(d, el, 'FRAME_PROJECTED_AS_VIEWPORT', 'Frame is exported as an editable outline; slide order remains in embedded document metadata.', false);
    }
    else if (shapeVariant) {
      if (shapeVariant === 'square') out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}" data-sketchdraw-shape="square"${paint}/>`);
      else if (shapeVariant === 'circle') out.append(`<ellipse cx="${n(el.width / 2)}" cy="${n(el.height / 2)}" rx="${n(el.width / 2)}" ry="${n(el.height / 2)}" data-sketchdraw-shape="circle"${paint}/>`);
      else if (shapeVariant === 'diamond') out.append(`<polygon points="${n(el.width / 2)},0 ${n(el.width)},${n(el.height / 2)} ${n(el.width / 2)},${n(el.height)} 0,${n(el.height / 2)}" data-sketchdraw-shape="diamond"${paint}/>`);
      else {
        const paths = SHAPE_PATHS[shapeVariant];
        out.append(`<g${attrs({ width: el.width, height: el.height, 'data-sketchdraw-shape': shapeVariant })}${paint}>${paths.map((path, pathIndex) => `<path d="${escapeXmlAttr(path)}" transform="translate(${-el.width / 6} ${-el.height / 6}) scale(${n(el.width / 18)} ${n(el.height / 18)})" fill="${pathIndex === 0 ? 'inherit' : 'none'}" vector-effect="non-scaling-stroke"/>`).join('')}</g>`);
      }
    }
    else if (legacy && isResourceCard(el)) {
      const footerHeight = Math.max(28, Math.min(36, el.height * .24));
      out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}" rx="8"${paint}/><path d="M0 ${n(el.height - footerHeight)}H${n(el.width)}V${n(el.height - 8)}Q${n(el.width)} ${n(el.height)} ${n(el.width - 8)} ${n(el.height)}H8Q0 ${n(el.height)} 0 ${n(el.height - 8)}Z" fill="#eef4fb" stroke="none"/>`);
    }
    else if (isResourceCard(el)) {
      const { look, footer, footerHeight } = resourceCardLayout(el);
      const bar = look === 'dashed'
        ? `<rect${attrs({ x: footer.x, y: footer.y, width: footer.width, height: footer.height, rx: 3, fill: safeColor(el.style.stroke, d, el), 'fill-opacity': 0.22, stroke: 'none' })}/>`
        : `<path d="M0 ${n(el.height - footerHeight)}H${n(el.width)}V${n(el.height - 8)}Q${n(el.width)} ${n(el.height)} ${n(el.width - 8)} ${n(el.height)}H8Q0 ${n(el.height)} 0 ${n(el.height - 8)}Z" fill="#eef4fb" stroke="none"/>`;
      out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}" rx="8"${paint}/>${bar}`);
    }
    else if (cloud) {
      // The card of a cloud component as the canvas draws it (#259): rounded, with the surface of the light theme
      // while its colours are untouched.
      out.append(`<rect${attrs({ x: 0, y: 0, width: el.width, height: el.height, rx: cloud.layout.radius, fill: cloud.fill, stroke: cloud.stroke, 'stroke-width': Math.max(1, el.style.strokeWidth), opacity: el.style.opacity, ...(el.style.strokeDash === 'solid' ? {} : { 'stroke-dasharray': el.style.strokeDash === 'dotted' ? '2 4' : '8 6' }) })}/>`);
    }
    else if (['container', 'component'].includes(el.kind))
      out.append(`<rect x="0" y="0" width="${n(el.width)}" height="${n(el.height)}"${paint}/>`);
    else if (el.kind === 'connector')
      out.append(`<path d="${escapeXmlAttr(connectorPathData(el))}"${paint}${attrs({ 'marker-start': markerStart === 'none' ? undefined : `url(#sd-${index}-start)`, 'marker-end': markerEnd === 'none' ? undefined : `url(#sd-${index}-end)` })}/>`);
    else if (el.kind === 'path')
      out.append(`<polyline points="${el.points!.map(p => `${n(p.x)},${n(p.y)}`).join(' ')}"${paint}/>`);
    else if (el.kind === 'image')
      out.append(`<image${attrs({ x: 0, y: 0, width: el.width, height: el.height, href: document.assets[el.assetId!]!.dataUrl, opacity: el.style.opacity, preserveAspectRatio: 'none' })}/>`);
    if (el.kind === 'component') {
      const definition = [...document.componentSets, ...builtInComponentSets].flatMap(set => set.components).find(c => c.type === (isResourceCard(el) ? resourceCardIconType(el) : el.componentType));
      const icon = resolveCatalogIcon(definition?.iconSvg);
      if (icon.isFallback)
        diagnostic(d, el, 'COMPONENT_ICON_FALLBACK', 'Component uses the safe generic icon; provider semantics remain metadata.');
      const tree = icon.tree;
      const card = isResourceCard(el) ? legacy ? legacyResourceCardIcon(el) : resourceCardLayout(el) : null;
      const figure = isIconFigure(el) ? figureLayout(el, shownText(el, legacy).split('\n').length).icon : null;
      const iconSize = figure ? figure.size : card ? card.iconSize : cloud ? cloud.layout.icon.size : Math.min(32, el.width, el.height);
      out.append(`<svg${attrs({ ...tree.attributes, x: figure ? figure.x : card ? card.icon.x : cloud ? cloud.layout.icon.x : legacy ? 4 : el.width / 2 - iconSize / 2, y: figure ? figure.y : card ? card.icon.y : cloud ? cloud.layout.icon.y : legacy ? 4 : Math.max(8, el.height * .15), width: iconSize, height: iconSize, viewBox: tree.viewBox, color: safeColor(el.style.stroke,d,el), opacity: el.style.opacity })}>${tree.children.map(safeIcon).join('')}</svg>`);
    }
    const group = awsGroupOf(el);
    const groupIcon = group ? groupChrome(group, el.width, el.style.fontSize).icon : null;
    if (group && groupIcon) {
      const tree = resolveCatalogIcon(groupTileSvg(group, safeColor(el.style.stroke, d, el))).tree;
      out.append(`<svg${attrs({ ...tree.attributes, x: groupIcon.x, y: groupIcon.y, width: groupIcon.size, height: groupIcon.size, viewBox: tree.viewBox, opacity: el.style.opacity })}>${tree.children.map(safeIcon).join('')}</svg>`);
    }
    const visibleText = isResourceCard(el) ? legacy ? resourceCardSvgContentV1(el, d) : resourceCardSvgContent(el, d, picture.withoutTitle) : cloud ? picture.withoutTitle ? cloud.providerText : cloud.text : el.kind === 'annotation' ? annotationSvgContent(el, d) : ['table', 'web-embed'].includes(el.kind) ? '' : `${picture.withoutTitle ? '' : nativeText(el, d, legacy, placed)}${stickyAuthor(el, d)}`;
    const exportLink = el.kind === 'sticky-note' ? el.documentationUrl : undefined;
    out.append(exportLink
      ? `<a href="${escapeXmlAttr(exportLink)}">${visibleText}</a>`
      : visibleText);
    out.append('</g>');
  }
  out.append('</svg>');
  return out.toString();
}
/** Element kinds draw.io has no shape for: they are written as the picture the canvas shows (#260). */
const DRAWIO_PICTURE_KINDS: ReadonlySet<SketchElement['kind']> = new Set(['component', 'sticky-note', 'table', 'annotation', 'web-embed']);
/** Of those, the kinds whose text draw.io writes itself on top of the picture, so it can be edited there. */
const DRAWIO_LABELLED_PICTURES: ReadonlySet<SketchElement['kind']> = new Set(['component', 'sticky-note']);
/**
 * An element as the picture the canvas shows, as an SVG image for draw.io (#260): draw.io has no shapes for the
 * cards, tables and notes of Sketchdraw, and a rectangle with a name is not what the diagram looks like. The picture
 * is the one the SVG export draws for the element. `withoutTitle` leaves the text out that draw.io writes itself.
 */
/**
 * The SVG picture the pictures of a draw.io picture are drawn with. It is named per draw.io picture and does not
 * follow the current SVG picture: a change to the SVG export must not change what a draw.io file of an existing
 * picture number contains (#290). draw.io picture 5 took over SVG picture 3 (merged table cells, #287).
 */
const drawioPictureSvg = (projectionVersion: ProjectionVersion): ProjectionVersion => projectionVersion >= 5 ? 3 : 2;
function elementPicture(el: SketchElement, document: SketchDocument, withoutTitle: boolean, svgPicture: ProjectionVersion): string {
  const single: SketchElement = { ...el, x: 0, y: 0, rotation: 0 };
  delete single.parentId;
  const picture = nativeSvg({ ...document, elements: [single] }, new DiagnosticCollector(), false, svgPicture, { withoutTitle });
  // The frame of the card is drawn on its edge; half of it would be cut off at the border of the picture.
  const pad = Math.ceil(Math.max(1, el.style.strokeWidth) / 2);
  const framed = picture.replace(/^<svg [^>]*>/, `<svg${attrs({ xmlns: SVG_NS, viewBox: `${-pad} ${-pad} ${n(el.width + 2 * pad)} ${n(el.height + 2 * pad)}`, width: el.width, height: el.height })}>`);
  // draw.io writes the data of an image without the `;base64` marker, because `;` separates the entries of a style.
  return `data:image/svg+xml,${encodeBytesToBase64(new TextEncoder().encode(framed))}`;
}
/**
 * Where and how draw.io writes the text of a pictured element, so it stands where the canvas shows it: the name of
 * a cloud card under its icon, the title of a resource card beside its icon, the text of a note inside its margin.
 */
function drawioLabelStyle(el: SketchElement, componentSets: readonly ComponentSet[], d: DiagnosticCollector): Record<string, string | number> {
  const round = (value: number) => Math.round(value * 100) / 100;
  const base = { html: 1, verticalAlign: 'top', spacing: 0 };
  if (el.kind === 'sticky-note') return { ...base, spacing: 20, whiteSpace: 'wrap' };
  const cloud = cloudCardExport(el, componentSets, d);
  if (isResourceCard(el)) {
    const layout = resourceCardLayout(el);
    return { ...base, align: 'left', spacingLeft: round(layout.textX), spacingTop: round(layout.title.y - layout.title.fontSize * .6), fontSize: layout.title.fontSize, fontStyle: 1, fontColor: el.style.textColor ? safeColor(el.style.textColor, d, el) : RESOURCE_CARD_TEXT_COLOR };
  }
  if (cloud) return { ...base, align: 'center', whiteSpace: 'wrap', spacingLeft: 6, spacingRight: 6, spacingTop: round(cloud.layout.title.y - CLOUD_CARD_TITLE_SIZE * .93 - 1), fontSize: CLOUD_CARD_TITLE_SIZE, fontStyle: 1, fontColor: cloud.titleColor };
  const sides = { spacingLeft: el.style.textAlign === 'left' ? 8 : 0, spacingRight: el.style.textAlign === 'right' ? 8 : 0 };
  if (isIconFigure(el)) return { ...base, whiteSpace: 'wrap', spacingTop: round(figureLayout(el, (el.text ?? el.label ?? '').split('\n').length).labelTop) };
  return { ...base, whiteSpace: 'wrap', ...sides, spacingTop: round(el.height * .58) };
}
/** Text as the HTML of a draw.io label: nothing but the characters and line breaks. */
const drawioHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
function nativeDrawio(document: SketchDocument, d: DiagnosticCollector, embed: boolean, projectionVersion: ProjectionVersion = CURRENT_PROJECTION.drawio): string {
  // Pictures 1 and 2 are drawn again only to verify a file of that version: they fell back to the label for an
  // emptied text and showed a component as a rectangle with its name.
  const legacyLabel = projectionVersion < 3;
  const componentSets = [...document.componentSets, ...builtInComponentSets];
  const out = new XmlOutputBuilder();
  const ids = new Map(document.elements.map((e, i) => [e.id, `sd-${i}`]));
  const map = new Map(document.elements.map(e => [e.id, e]));
  out.append('<mxfile compressed="false">');
  // One <diagram> per page, in page order. A single-page document keeps its title as the diagram name; the embedded
  // model (all pages) sits on the first diagram.
  for (const [pageIndex, page] of document.pages.entries()) {
  const diagramName = document.pages.length === 1 ? document.title : page.name;
  out.append(`<diagram id="page-${pageIndex + 1}" name="${escapeXmlAttr(xmlText(diagramName, d))}"><mxGraphModel><root><object id="0"${embed && pageIndex === 0 ? ` sketchdrawInterop="${encodeEnvelope(document, 'drawio', projectionVersion)}"` : ''}><mxCell/></object><mxCell id="1" parent="0"/>`);
  for (const raw of document.elements.filter((candidate) => candidate.pageId === page.id)) {
    const el = syncConnectorEndpoints(raw, map), parent = el.parentId ? map.get(el.parentId) : undefined;
    const p = { x: parent?.x ?? 0, y: parent?.y ?? 0 };
    // The hidden text of a pictured table is what its cells show: from picture 5 on, nothing for a cell below a merge (#287).
    const sourceText = el.kind === 'table' && el.table && projectionVersion >= 5 ? visibleTableText(el) : el.kind === 'annotation' && el.annotation ? annotationPlainText(el.annotation) : el.style.listStyle === 'bullet' ? shownText(el, legacyLabel).split('\n').map(line => line ? `• ${line}` : line).join('\n') : shownText(el, legacyLabel);
    // Pictures 1 and 2 knew no pictures: every element was a draw.io shape with its text.
    const pictured = !legacyLabel && DRAWIO_PICTURE_KINDS.has(el.kind);
    const labelled = pictured && DRAWIO_LABELLED_PICTURES.has(el.kind);
    const text = labelled ? drawioHtml(xmlText(sourceText, d, el)) : xmlText(sourceText, d, el);
    const fontStyle = (el.style.fontWeight === 'bold' ? 1 : 0) + (el.style.textDecoration === 'line-through' ? 8 : 0);
    const shapeVariant = effectiveShapeVariant(el);
    const startMarker = el.kind === 'connector' ? connectorStartMarker(el) : 'none';
    const endMarker = el.kind === 'connector' ? connectorEndMarker(el) : 'none';
    // v1 used the outer border/text style even for tables. Keep that exact
    // projection exclusively for validating legacy envelopes before restoring them.
    const table = projectionVersion >= 2 && el.kind === 'table' ? el.table : undefined;
    const firstCell = table?.cells.find(cell => cell.rowId === table.rows[0]!.id && cell.columnId === table.columns[0]!.id);
    if (firstCell && table!.cells.some(cell => cell.style.color.toLowerCase() !== firstCell.style.color.toLowerCase() || cell.style.fill.toLowerCase() !== firstCell.style.fill.toLowerCase()))
      d.add({ code: 'STYLE_APPROXIMATED', elementId: el.id, property: 'table.colors', severity: 'warning', effect: embed ? 'approximated' : 'omitted', message: embed ? 'The native table projection uses the first visible cell colors; mixed cell colors remain in embedded metadata only.' : 'The portable table projection uses the first visible cell colors; other cell colors are omitted.' });
    const style = [`html=0`, `strokeColor=${safeColor(el.style.stroke, d, el)}`, `fillColor=${safeColor(firstCell?.style.fill ?? el.style.fill, d, el)}`, `strokeWidth=${el.style.strokeWidth}`, `opacity=${el.style.opacity * 100}`, `fontSize=${el.style.fontSize}`, `fontColor=${firstCell ? safeColor(firstCell.style.color, d, el) : safeTextColor(el,d)}`, `fontFamily=${DRAWIO_FONT_FAMILY[el.style.fontFamily ?? 'sans']}`, `fontStyle=${fontStyle}`, `align=${el.style.textAlign}`, `rotation=${el.rotation}`, `dashed=${el.style.strokeDash === 'solid' ? 0 : 1}`, `dashPattern=${el.style.strokeDash === 'dotted' ? '2 4' : '8 6'}`, ...(el.style.strokeDash === 'animated' ? ['flowAnimation=1'] : []), `startArrow=${DRAWIO_MARKER[startMarker]}`, `startFill=${DRAWIO_FILLED_MARKERS.has(startMarker) ? 1 : 0}`, `endArrow=${DRAWIO_MARKER[endMarker]}`, `endFill=${DRAWIO_FILLED_MARKERS.has(endMarker) ? 1 : 0}`];
    if (shapeVariant) {
      style.push(`sketchdrawShapeVariant=${shapeVariant}`);
      const native: Partial<Record<typeof shapeVariant, readonly string[]>> = {
        circle: ['ellipse'], diamond: ['rhombus'], triangle: ['shape=triangle'], 'triangle-down': ['shape=triangle', 'direction=south'],
        rounded: ['rounded=1', `arcSize=${el.style.cornerRadius === undefined ? 30 : Math.round(Math.min(50, (el.style.cornerRadius / Math.max(1, Math.min(el.width, el.height))) * 100))}`], chevron: ['shape=mxgraph.basic.chevron'], process: ['shape=process'],
        document: ['shape=document'], documents: ['shape=multipleDocuments'], 'manual-input': ['shape=manualInput'],
        hexagon: ['shape=hexagon'], parallelogram: ['shape=parallelogram'], 'parallelogram-reverse': ['shape=parallelogram', 'direction=west'],
        cylinder: ['shape=cylinder3'], tube: ['shape=cylinder', 'direction=east'], 'internal-storage': ['shape=internalStorage'],
        trapezoid: ['shape=trapezoid'], summing: ['ellipse'], or: ['ellipse'], 'off-page': ['shape=offPageConnector'],
        folder: ['shape=folder'], note: ['shape=note'], pentagon: ['shape=pentagon'], 'loop-limit': ['shape=loopLimit'],
      };
      style.push(...(native[shapeVariant] ?? []));
      if (['diamond', 'triangle', 'triangle-down'].includes(shapeVariant) && (el.style.cornerRadius ?? 0) > 0) {
        style.push('rounded=1', `arcSize=${Math.round(Math.min(50, ((el.style.cornerRadius ?? 0) / Math.max(1, Math.min(el.width, el.height))) * 100))}`);
      }
    }
    else if (el.kind === 'text')
      style.push('text', 'strokeColor=none', 'fillColor=none');
    else if (el.kind === 'container') {
      style.push('container=1', 'verticalAlign=top');
      const group = awsGroupOf(el);
      if (group) {
        // AWS group frames (#143): draw.io's own group shape, so the file opens with the same look and container behavior.
        const k = el.style.fontSize / 12;
        const chrome = groupChrome(group, el.width, el.style.fontSize);
        style.push('pointerEvents=0', 'collapsible=0', 'recursiveResize=0', 'whiteSpace=wrap', `sketchdrawGroup=${group.id}`);
        if (group.drawioIcon) {
          style.push(`shape=mxgraph.aws4.${group.layout === 'center' ? 'groupCenter' : 'group'}`, `grIcon=${group.drawioIcon}`, `grIconSize=${n(Math.round(25 * k * 100) / 100)}`);
          if (el.style.strokeWidth === 0) style.push('grStroke=0');
          style.push(group.layout === 'center' ? `spacingTop=${n(Math.round(25 * k * 100) / 100)}` : `spacingLeft=${n(Math.round((chrome.label.left - 2 * k) * 100) / 100)}`);
        }
        else if (el.style.strokeWidth === 0) style.push('strokeColor=none');
        const dashed = style.indexOf('dashPattern=8 6');
        if (dashed >= 0 && el.style.strokeDash === 'dashed') style[dashed] = 'dashPattern=3 3';
      }
    }
    else if (el.kind === 'frame') {
      style.push('fillColor=none', 'dashed=1', 'dashPattern=10 7', 'verticalAlign=top', 'sketchdrawKind=frame');
      diagnostic(d, el, 'FRAME_PROJECTED_AS_VIEWPORT', 'Frame is exported as an editable viewport outline; slide order remains in embedded document metadata.', false);
    }
    else if (el.kind === 'image')
      style.push('shape=image', `image=${document.assets[el.assetId!]!.dataUrl.replace(';base64,', ',')}`, 'imageAspect=0');
    else if (pictured && el.kind === 'component')
      style.push(`sketchdrawComponent=${encodeURIComponent(el.componentType ?? '')}`, ...(el.description ? [`sketchdrawDescription=${encodeURIComponent(el.description)}`] : []));
    else if (pictured && el.kind === 'sticky-note')
      style.push('sketchdrawKind=sticky-note', `sketchdrawAuthor=${encodeURIComponent(el.author ?? '')}`, `sketchdrawListStyle=${el.style.listStyle ?? 'none'}`);
    else if (pictured && el.kind === 'web-embed') {
      style.push('sketchdrawKind=web-embed', `link=${encodeURIComponent(el.embedUrl ?? '')}`);
      diagnostic(d, el, 'WEB_EMBED_PROJECTED_AS_LINK', 'Web embed is exported as a static linked card; remote page content is not embedded.');
    }
    else if (pictured)
      style.push(`sketchdrawKind=${el.kind}`);
    else if (el.kind === 'sticky-note')
      style.push('shape=note', 'shadow=1', 'verticalAlign=top', 'spacing=20', `sketchdrawAuthor=${encodeURIComponent(el.author ?? '')}`, `sketchdrawListStyle=${el.style.listStyle ?? 'none'}`);
    else if (el.kind === 'annotation')
      style.push('rounded=1', 'arcSize=8', 'shadow=1', 'verticalAlign=top', 'spacing=24', 'whiteSpace=wrap', 'sketchdrawKind=annotation');
    else if (el.kind === 'table')
      style.push('shape=table', 'childLayout=tableLayout', 'whiteSpace=wrap', 'verticalAlign=top', 'sketchdrawKind=table');
    else if (el.kind === 'web-embed') {
      style.push('rounded=1', 'arcSize=8', 'whiteSpace=wrap', 'verticalAlign=top', 'sketchdrawKind=web-embed', `link=${encodeURIComponent(el.embedUrl ?? '')}`);
      diagnostic(d, el, 'WEB_EMBED_PROJECTED_AS_LINK', 'Web embed is exported as a static linked card; remote page content is not embedded.');
    }
    // draw.io puts text in the middle unless told otherwise. Free text of older documents starts at the top, and
    // text and shapes can be aligned to the top or the bottom (#296); picture 4 says so, earlier pictures did not.
    if (projectionVersion >= 4 && !pictured && supportsVerticalAlign(el.kind) && verticalAlignOf(el) !== 'middle')
      style.push(`verticalAlign=${verticalAlignOf(el)}`);
    if (pictured) {
      // The picture shows the element; a text draw.io writes itself stands on top of it and can be edited there.
      // Any other text stays the value of the cell, hidden, so it is not lost and comes back on import.
      const entries: Record<string, string | number> = { shape: 'image', image: elementPicture(el, document, labelled, drawioPictureSvg(projectionVersion)), imageAspect: 0, ...(labelled ? drawioLabelStyle(el, componentSets, d) : { noLabel: 1 }) };
      for (const [key, value] of Object.entries(entries)) {
        const at = style.findIndex(entry => entry.startsWith(`${key}=`));
        if (at >= 0) style[at] = `${key}=${value}`; else style.push(`${key}=${value}`);
      }
    }
    const edge = el.kind === 'connector' || el.kind === 'path';
    if (edge) {
      if (el.kind === 'connector' && connectorRouting(el) === 'elbowed') style.push('edgeStyle=orthogonalEdgeStyle', 'rounded=1', 'noEdgeStyle=0');
      else if (el.kind === 'connector' && connectorRouting(el) === 'curved') style.push('edgeStyle=none', 'curved=1', 'noEdgeStyle=1');
      else style.push('edgeStyle=none', 'noEdgeStyle=1');
      if (el.rotation !== 0)
        style.push('rotation=0');
      for (const [side, endpoint] of [['exit', el.from], ['entry', el.to]] as const)
        if (endpoint)
          style.push(`${side}X=${endpoint.anchor.x}`, `${side}Y=${endpoint.anchor.y}`, `${side}Perimeter=0`);
      if (el.kind === 'path')
        diagnostic(d, el, 'PATH_PROJECTION_APPROXIMATED', 'Freehand path is projected as an editable native edge; path identity/fill may differ.');
    }
    if (el.kind === 'component' && legacyLabel)
      diagnostic(d, el, 'COMPONENT_ICON_FALLBACK', 'draw.io component is an editable named rectangle; catalog/icon semantics remain metadata.');
    else if (pictured)
      diagnostic(d, el, 'ELEMENT_PROJECTED_AS_IMAGE', labelled ? 'Element is exported as a picture of what the canvas shows; its text is written by draw.io and stays editable.' : 'Element is exported as a picture of what the canvas shows; its content is not editable in draw.io.', false);
    if (text)
      diagnostic(d, el, 'FONT_RENDERING_DEPENDENT', 'Text rendering depends on receiver fonts and text layout.');
    out.append(`<mxCell${attrs({ id: ids.get(el.id), parent: el.parentId ? ids.get(el.parentId) : '1', value: text, style: style.join(';') + ';', ...(edge ? { edge: '1', source: el.from ? ids.get(el.from.elementId) : undefined, target: el.to ? ids.get(el.to.elementId) : undefined } : { vertex: '1' }) })}>`);
    if (edge) {
      const points = el.points!.map(point => worldPoint(el, point));
      out.append('<mxGeometry relative="1" as="geometry">');
      for (const [point, as] of [[points[0]!, 'sourcePoint'], [points.at(-1)!, 'targetPoint']] as const)
        out.append(`<mxPoint${attrs({ x: point.x - p.x, y: point.y - p.y, as })}/>`);
      out.append('<Array as="points">');
      for (const point of points.slice(1, -1))
        out.append(`<mxPoint${attrs({ x: point.x - p.x, y: point.y - p.y })}/>`);
      out.append('</Array></mxGeometry>');
    }
    else
      out.append(`<mxGeometry${attrs({ x: el.x - p.x, y: el.y - p.y, width: el.width, height: el.height, as: 'geometry' })}/>`);
    out.append('</mxCell>');
  }
  out.append('</root></mxGraphModel></diagram>');
  }
  // mxGraph paints children together. Detect non-contiguous descendants in the flat domain order.
  for (const parent of document.elements.filter(e => e.kind === 'container')) {
    const descendants = new Set([parent.id]);
    for (let pass = 0; pass < 32; pass++)
      for (const el of document.elements)
        if (el.parentId && descendants.has(el.parentId))
          descendants.add(el.id);
    const indices = document.elements.map((e, i) => descendants.has(e.id) ? i : -1).filter(i => i >= 0);
    if (indices.length > 1 && indices.at(-1)! - indices[0]! + 1 !== indices.length)
      diagnostic(d, parent, 'STACKING_ORDER_APPROXIMATED', 'Native hierarchy groups descendants and can change flat stacking order.');
  }
  out.append('</mxfile>');
  return out.toString();
}
/** Internal comparison surface; old versions are never selected by export callers. */
export function drawioProjectionForValidation(document: SketchDocument, projectionVersion: ProjectionVersion): string {
  return nativeDrawio(document, new DiagnosticCollector(), false, projectionVersion);
}
/** The SVG picture of an embedded document as the exporter of the given version drew it; see `drawioProjectionForValidation`. */
export function svgProjectionForValidation(document: SketchDocument, projectionVersion: ProjectionVersion): string {
  const full = validateDocument(document);
  return nativeSvg(full.pages.length > 1 ? extractPage(full, full.pages[0]!.id) : full, new DiagnosticCollector(), true, projectionVersion);
}
export function prepareExport(document: SketchDocument, format: Exclude<InteropFormat, 'mermaid'>, options: InteropExportOptions = {}): InteropExportResult {
  const full = validateDocument(document);
  serializeDocument(full);
  const d = new DiagnosticCollector(), embed = options.embedDocument !== false;
  // SVG shows a single page; the embedded model is then that page as a standalone document.
  const svgPageId = options.pageId ?? full.pages[0]!.id;
  if (format === 'svg' && !full.pages.some((page) => page.id === svgPageId))
    throw new InteropError('PAGE_NOT_FOUND', 'The page to export does not exist.');
  const doc = format === 'svg' && full.pages.length > 1 ? extractPage(full, svgPageId) : full;
  if (format === 'svg' && full.pages.length > 1)
    diagnostic(d, undefined, 'PAGE_EXPORTED_SINGLE', `SVG contains one page ("${full.pages.find((page) => page.id === svgPageId)!.name}"); the other ${full.pages.length - 1} page(s) are not part of this file.`, false);
  if (doc.componentSets.length || (doc.commentThreads?.length ?? 0) || (doc.tasks?.length ?? 0) || Object.keys(doc.metadata).length || Object.keys(doc.assets).length || doc.elements.some(e => e.parentId || e.from || e.to || e.metadata || e.label || e.description || e.componentType || e.author || e.annotation || e.table))
    diagnostic(d, undefined, embed ? 'SEMANTICS_IN_METADATA' : 'SEMANTICS_OMITTED', embed ? 'Additional document semantics and resources are embedded as data, including information not visible on the canvas.' : 'Portable projection omits native document identity, catalog, binding and metadata semantics.', !embed);
  const contents = format === 'svg' ? nativeSvg(doc, d, embed) : nativeDrawio(doc, d, embed);
  // Do not produce an output whose native projection exceeds our import limits.
  parseXmlDocument(contents);
  const diagnostics = d.finalize();
  return { format, contents, mimeType: format === 'svg' ? 'image/svg+xml' : 'application/xml', suggestedExtension: format === 'svg' ? '.svg' : '.drawio', diagnostics, requiresConfirmation: hasWarningDiagnostics(diagnostics), embedsDocument: embed };
}
export const prepareSvgExport = (doc: SketchDocument, options?: InteropExportOptions): InteropExportResult => prepareExport(doc, 'svg', options);
export const prepareDrawioExport = (doc: SketchDocument, options?: InteropExportOptions): InteropExportResult => prepareExport(doc, 'drawio', options);
function stringExport(result: InteropExportResult): string { if (result.requiresConfirmation)
  throw new InteropError('LOSS_CONFIRMATION_REQUIRED', 'Export requires loss confirmation.', result.diagnostics); return result.contents; }
export const exportSvg = (doc: SketchDocument): string => stringExport(prepareSvgExport(doc));
export const exportDrawio = (doc: SketchDocument): string => stringExport(prepareDrawioExport(doc));

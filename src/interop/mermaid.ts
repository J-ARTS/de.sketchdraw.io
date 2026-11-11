import { createElement, DOMAIN_LIMITS, serializeDocument, validateDocument } from '../domain';
import type { ShapeVariant, SketchDocument, SketchElement } from '../domain';
import { utf8ByteLength } from '../domain/validation';
import { add, context, decodeEnvelope, encodeEnvelope, fail, finish, importBoundary, type ImportContext } from './common';
import { DiagnosticCollector, hasWarningDiagnostics, sanitizeXml10Text, XmlOutputBuilder } from './diagnostics';
import { INTEROP_LIMITS } from './limits';
import { InteropError, type ImportOptions, type InteropExportOptions, type InteropExportResult, type InteropImportResult } from './types';

// This is a deliberately bounded, synchronous flowchart subset, not a Mermaid runtime.
const MAX_VISIBLE_BYTES = 8 * 1024 * 1024;
const ENVELOPE_PREFIX = '%% sketchdraw-mermaid-v1 ';
type Direction = 'LR' | 'RL' | 'TB' | 'TD' | 'BT';
interface Node { id: string; text: string; shape: ShapeVariant; parent?: string; group?: boolean }
interface Edge { from: string; to: string; text?: string; start: boolean; end: boolean; dash: 'solid' | 'dotted'; thick: boolean }
interface Graph { direction: Direction; nodes: Map<string, Node>; edges: Edge[]; members: Map<string, Set<string>> }
const SHAPES: readonly [string, string, ShapeVariant][] = [
  ['[(', ')]', 'cylinder'], ['[[', ']]', 'process'], ['((', '))', 'circle'], ['{{', '}}', 'hexagon'],
  ['[', ']', 'square'], ['(', ')', 'rounded'], ['{', '}', 'diamond'],
];
const LINKS = ['<-.->', '<==>', '<-->', '-.->', '-->', '==>', '---', '-.-', '==='] as const;
function invalid(message: string): never { return fail('MERMAID_SYNTAX_INVALID', message); }
function unsupported(message: string): never { return fail('MERMAID_SYNTAX_UNSUPPORTED', message); }
function checkBudget(graph: Graph, extra = 1): void {
  if (graph.nodes.size + graph.edges.length + extra > DOMAIN_LIMITS.MAX_ELEMENTS)
    fail('LIMIT_EXCEEDED', 'Mermaid node and edge budget exceeded.');
}

function label(raw: string): string {
  // Reserve at most ten source characters per decoded character (numeric entities).
  // Check before trimming, scanning tags, or replacing entities.
  if (raw.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH * 10) fail('LIMIT_EXCEEDED', 'Raw Mermaid label exceeds its text budget.');
  let value = raw.trim();
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"') || value.slice(1, -1).includes('"')) invalid('Malformed quoted Mermaid label. Use entities for embedded quotes.');
    value = value.slice(1, -1);
  } else if (value.includes('"')) invalid('Quotes must surround the complete Mermaid label.');
  if (value.includes('`')) unsupported('HTML and Markdown labels are not supported.');
  for (let start = value.indexOf('<'); start >= 0; start = value.indexOf('<', start + 1)) {
    const next = value[start + 1] === '/' ? start + 2 : start + 1;
    if (!/[a-z!]/i.test(value[next] ?? '')) continue;
    // No closing bracket means no later opening bracket can form a tag either.
    if (value.indexOf('>', next + 1) < 0) break;
    unsupported('HTML and Markdown labels are not supported.');
  }
  const entities: Readonly<Record<string, string>> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0' };
  value = value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);|#(\d+|[a-z]+);/gi, (whole, html: string | undefined, mermaid: string | undefined) => {
    const token = html ?? mermaid!;
    if (Object.hasOwn(entities, token)) return entities[token]!;
    const numeric = html?.startsWith('#x') ? Number.parseInt(html.slice(2), 16)
      : /^#?\d+$/.test(token) ? Number(token.replace(/^#/, '')) : NaN;
    if (!Number.isInteger(numeric)) return whole;
    if (numeric <= 0 || numeric > 0x10ffff || numeric >= 0xd800 && numeric <= 0xdfff) invalid('Invalid label entity.');
    return String.fromCodePoint(numeric);
  });
  if (value.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) fail('LIMIT_EXCEEDED', 'Mermaid label exceeds the text limit.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid('Control characters are not supported in Mermaid labels.');
  return value === ' ' ? '' : value;
}

/** Newlines/semicolons delimit statements only outside quoted labels and shapes. */
function statements(source: string): string[] {
  const result: string[] = [];
  let start = 0, depth = 0, quoted = false;
  const push = (end: number) => {
    const value = source.slice(start, end).trim();
    if (value) result.push(value);
    if (result.length > DOMAIN_LIMITS.MAX_ELEMENTS * 3) fail('LIMIT_EXCEEDED', 'Too many Mermaid statements.');
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (depth === 0 && c === '%' && source[i + 1] === '%') {
      if (source[i + 2] === '{') unsupported('Mermaid configuration directives are not supported.');
      push(i);
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
      start = i + 1;
      continue;
    }
    if ('[({'.includes(c)) depth++;
    if ('])}'.includes(c)) depth--;
    if (depth < 0) invalid('Unexpected closing delimiter.');
    if (depth > 16) fail('LIMIT_EXCEEDED', 'Mermaid label nesting is too deep.');
    if (!depth && (c === '\n' || c === ';')) { push(i); start = i + 1; }
  }
  if (quoted || depth) invalid('Unclosed Mermaid label or shape.');
  push(source.length);
  return result;
}

class StatementParser {
  private offset = 0;
  constructor(private readonly source: string, private readonly graph: Graph, private readonly parent?: string) {}
  private space(): void { while (/\s/.test(this.source[this.offset] ?? '') && this.offset < this.source.length) this.offset++; }
  private rest(): string { return this.source.slice(this.offset); }
  private id(): string {
    this.space();
    const start = this.offset;
    while (this.offset < this.source.length) {
      if (LINKS.some(link => this.source.startsWith(link, this.offset)) || this.source.startsWith('--', this.offset) || this.source.startsWith('-.', this.offset) || this.source.startsWith('==', this.offset)) break;
      if (!/[\p{L}\p{N}_.-]/u.test(this.source[this.offset]!)) break;
      this.offset++;
    }
    const id = this.source.slice(start, this.offset);
    if (!id || !/^[\p{L}\p{N}_]/u.test(id)) invalid('Expected a Mermaid node identifier.');
    if (id === 'end') invalid('The lowercase identifier end is reserved by Mermaid.');
    if (id.length > DOMAIN_LIMITS.MAX_TEXT_LENGTH) fail('LIMIT_EXCEEDED', 'Mermaid identifier is too long.');
    return id;
  }
  private enclosed(open: string, close: string): string {
    this.offset += open.length;
    const start = this.offset;
    let quoted = false;
    while (this.offset < this.source.length) {
      const c = this.source[this.offset]!;
      if (c === '"') quoted = !quoted;
      if (!quoted && this.source.startsWith(close, this.offset)) {
        const raw = this.source.slice(start, this.offset);
        this.offset += close.length;
        return label(raw);
      }
      this.offset++;
    }
    return invalid('Unclosed Mermaid label.');
  }
  node(): string {
    const id = this.id();
    this.space();
    let text: string | undefined, shape: ShapeVariant = 'square';
    const delimiters = SHAPES.find(([open]) => this.source.startsWith(open, this.offset));
    if (delimiters) {
      if (this.source.startsWith('([', this.offset) || this.source.startsWith('(((', this.offset) || /^\[[/\\>]/.test(this.rest())) unsupported('This Mermaid node shape is not supported.');
      text = this.enclosed(delimiters[0], delimiters[1]); shape = delimiters[2];
    }
    const existing = this.graph.nodes.get(id);
    if (existing?.group && text !== undefined) unsupported('A subgraph cannot also be declared as a shape.');
    if (!existing) { checkBudget(this.graph); this.graph.nodes.set(id, { id, text: text ?? id, shape }); }
    else if (text !== undefined) { existing.text = text; existing.shape = shape; }
    if (this.parent) this.graph.members.get(this.parent)!.add(id);
    return id;
  }
  group(): string {
    let id = this.id();
    this.space();
    const bracketed = this.source[this.offset] === '[';
    // Mermaid gives an unbracketed multiword title a generated identity. Do not
    // steal its first word from a real node ID, or collide with similar titles.
    if (!bracketed && this.rest()) id = `mermaid:subgraph:${this.graph.members.size}`;
    if (this.graph.nodes.has(id)) invalid('Subgraph identifiers must be unique and distinct from nodes.');
    const text = bracketed ? this.enclosed('[', ']') : label(this.source.trim());
    if (this.source[this.offset] === '[') invalid('Malformed subgraph.');
    checkBudget(this.graph);
    this.graph.nodes.set(id, { id, text, shape: 'square', group: true });
    this.graph.members.set(id, new Set());
    if (this.parent) this.graph.members.get(this.parent)!.add(id);
    // A bracketed title must consume the entire declaration.
    if (bracketed && this.rest().trim()) unsupported('Unsupported subgraph declaration.');
    return id;
  }
  private edge(): Omit<Edge, 'from' | 'to'> {
    this.space();
    let syntax = LINKS.find(link => this.source.startsWith(link, this.offset));
    let text: string | undefined;
    if (syntax) {
      this.offset += syntax.length;
      if (/[-=.<>]/.test(this.source[this.offset] ?? '')) unsupported('Extended Mermaid edge lengths and decorations are not supported.');
    }
    else {
      const forms = [['--', '-->', '-->'], ['-.', '.->', '-.->'], ['==', '==>', '==>']] as const;
      const form = forms.find(([open]) => this.source.startsWith(open, this.offset));
      if (!form) unsupported('Unsupported Mermaid edge or statement syntax.');
      this.offset += form[0].length;
      if (/^[xo]/.test(this.rest())) unsupported('Circle and cross edge endings are not supported.');
      const start = this.offset;
      let quoted = false;
      while (this.offset < this.source.length) {
        if (this.source[this.offset] === '"') quoted = !quoted;
        if (!quoted && this.source.startsWith(form[1], this.offset)) break;
        if (!quoted && ['--', '==', '-.', '.-'].some(token => this.source.startsWith(token, this.offset))) unsupported('This labelled plain, decorated or extended Mermaid edge is not supported.');
        this.offset++;
      }
      if (this.offset === this.source.length) invalid('Missing end of a labelled Mermaid edge.');
      const rawLabel = this.source.slice(start, this.offset).trim();
      if (!rawLabel.startsWith('"') && (/^[-=.]/.test(rawLabel) || /[-=.]$/.test(rawLabel))) unsupported('Ambiguous unquoted Mermaid edge label. Quote the complete label.');
      text = label(rawLabel);
      this.offset += form[1].length;
      syntax = form[2];
    }
    // These suffixes are Mermaid circle/cross markers, not identifiers oB/xB.
    if ((syntax === '---' || syntax === '-.-' || syntax === '===') && /^[ox]/.test(this.rest())) unsupported('Circle and cross edge endings are not supported.');
    this.space();
    if (this.source[this.offset] === '|') text = this.enclosed('|', '|');
    return { text, start: syntax.startsWith('<'), end: syntax.endsWith('>'), dash: syntax.includes('.') ? 'dotted' : 'solid', thick: syntax.includes('=') };
  }
  parse(): void {
    let from = this.node();
    this.space();
    while (this.offset < this.source.length) {
      const edge = this.edge();
      const to = this.node();
      checkBudget(this.graph);
      this.graph.edges.push({ ...edge, from, to });
      from = to;
      this.space();
    }
  }
}

function parse(source: string): Graph {
  const parts = statements(source);
  const header = parts.shift() ?? '';
  const match = /^(?:flowchart|graph)\s+(LR|RL|TB|TD|BT)\b(.*)$/s.exec(header);
  if (!match) {
    if (/^(?:graph|flowchart)\b/.test(header)) invalid('A flowchart direction LR, RL, TB, TD or BT is required.');
    fail('MERMAID_DIAGRAM_UNSUPPORTED', 'Only Mermaid graph and flowchart diagrams are supported.');
  }
  const graph: Graph = { direction: match[1] as Direction, nodes: new Map(), edges: [], members: new Map() };
  if (match[2]!.trim()) parts.unshift(match[2]!.trim());
  const parents: string[] = [];
  for (const part of parts) {
    if (/^(?:click|style|classDef|class|linkStyle|direction|accTitle|accDescr)\b/.test(part)) unsupported('Mermaid styling, callbacks, accessibility directives and local directions are not supported.');
    if (part === 'end') {
      const parent = parents.pop();
      if (!parent) invalid('Unexpected subgraph end.');
      // Mermaid assigns membership when a subgraph closes. The first completed
      // group claims a node; an outer reference must not steal it from a child.
      for (const id of graph.members.get(parent)!) {
        const node = graph.nodes.get(id)!;
        if (id === parent || node.parent) continue;
        let ancestor: string | undefined = parent;
        while (ancestor) {
          if (ancestor === id) invalid('Mermaid subgraph references create a cyclic container hierarchy.');
          ancestor = graph.nodes.get(ancestor)?.parent;
        }
        node.parent = parent;
      }
      continue;
    }
    if (/^subgraph\s/.test(part)) {
      if (parents.length >= DOMAIN_LIMITS.MAX_CONTAINER_DEPTH) fail('LIMIT_EXCEEDED', 'Mermaid subgraph nesting exceeds the domain limit.');
      parents.push(new StatementParser(part.replace(/^subgraph\s+/, ''), graph, parents.at(-1)).group());
    } else new StatementParser(part, graph, parents.at(-1)).parse();
  }
  if (parents.length) invalid('A subgraph is missing its end statement.');
  // Cross-group references can create a deeper hierarchy than the source's
  // lexical nesting; validate that bound before recursive layout/expansion.
  for (const node of graph.nodes.values()) {
    let depth = 0, parent = node.parent;
    while (parent) {
      if (++depth > DOMAIN_LIMITS.MAX_CONTAINER_DEPTH) fail('LIMIT_EXCEEDED', 'Mermaid subgraph references exceed the hierarchy depth limit.');
      parent = graph.nodes.get(parent)!.parent;
    }
  }
  return graph;
}

function materialize(ctx: ImportContext, graph: Graph): void {
  const elements = new Map<string, SketchElement>();
  for (const node of graph.nodes.values()) {
    const id = ctx.ids.resolveId(node.id, 'mermaid', ctx.diagnostics);
    const kind = node.group ? 'container' : node.shape === 'circle' ? 'ellipse' : node.shape === 'diamond' ? 'diamond' : 'rectangle';
    elements.set(node.id, createElement(kind, { id, text: node.text, ...(node.group ? {} : { shapeVariant: node.shape }), width: node.shape === 'circle' ? 100 : 180, height: node.shape === 'circle' ? 100 : 80 }));
  }
  const children = new Map<string | undefined, string[]>();
  for (const node of graph.nodes.values()) {
    const list = children.get(node.parent) ?? []; list.push(node.id); children.set(node.parent, list);
    if (node.parent) elements.get(node.id)!.parentId = elements.get(node.parent)!.id;
  }
  // Layout is bounded by scope depth and total nodes, and never follows cyclic edges.
  const horizontal = graph.direction === 'LR' || graph.direction === 'RL';
  const layout = (parent?: string): { width: number; height: number } => {
    const ids = children.get(parent) ?? [];
    let main = 0, cross = 0, line = 0, width = 0, height = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!, el = elements.get(id)!;
      if (graph.nodes.get(id)!.group) {
        const size = layout(id); el.width = Math.max(220, size.width + 80); el.height = Math.max(140, size.height + 100);
      }
      if (i && i % 6 === 0) { main = 0; cross += line + 80; line = 0; }
      el.x = horizontal ? main : cross; el.y = horizontal ? cross : main;
      main += (horizontal ? el.width : el.height) + 80;
      line = Math.max(line, horizontal ? el.height : el.width);
      width = Math.max(width, el.x + el.width); height = Math.max(height, el.y + el.height);
    }
    for (const id of ids) {
      const el = elements.get(id)!;
      if (graph.direction === 'RL') el.x = width - el.x - el.width;
      if (graph.direction === 'BT') el.y = height - el.y - el.height;
    }
    return { width, height };
  };
  layout();
  const place = (parent: string | undefined, x: number, y: number): void => {
    for (const id of children.get(parent) ?? []) {
      const el = elements.get(id)!; el.x += x; el.y += y; add(ctx, el);
      place(id, el.x + 40, el.y + 60);
    }
  };
  place(undefined, 40, 40);
  for (const [index, edge] of graph.edges.entries()) {
    const a = elements.get(edge.from)!, b = elements.get(edge.to)!;
    const forward = graph.direction !== 'RL' && graph.direction !== 'BT';
    const aa = horizontal ? { x: forward ? 1 : 0, y: .5 } : { x: .5, y: forward ? 1 : 0 };
    const ba = horizontal ? { x: forward ? 0 : 1, y: .5 } : { x: .5, y: forward ? 0 : 1 };
    const p = { x: a.x + a.width * aa.x, y: a.y + a.height * aa.y };
    const q = { x: b.x + b.width * ba.x, y: b.y + b.height * ba.y };
    const points = edge.from === edge.to ? [p, { x: p.x + 50, y: p.y + 100 }, { x: q.x - 50, y: q.y + 100 }, q] : [p, q];
    const x = Math.min(...points.map(v => v.x)), y = Math.min(...points.map(v => v.y));
    const connector = createElement('connector', { id: ctx.ids.resolveId(`mermaid-edge-${index}`, 'edge', ctx.diagnostics), x, y,
      width: Math.max(...points.map(v => v.x)) - x, height: Math.max(...points.map(v => v.y)) - y,
      points: points.map(v => ({ x: v.x - x, y: v.y - y })), text: edge.text,
      from: { elementId: a.id, anchor: aa }, to: { elementId: b.id, anchor: ba }, connectorRouting: 'straight',
      startMarker: edge.start ? 'solid-arrow' : 'none', endMarker: edge.end ? 'solid-arrow' : 'none',
    });
    connector.style.strokeDash = edge.dash; connector.style.strokeWidth = edge.thick ? 4 : 2;
    add(ctx, connector);
  }
  if (graph.nodes.size) ctx.diagnostics.add({ code: 'MERMAID_LAYOUT_GENERATED', severity: 'info', effect: 'normalized', property: 'geometry', message: 'Mermaid: A deterministic flowchart layout was generated; Mermaid source contains no canvas coordinates.' });
}

function extract(source: string): { visible: string; envelope?: string; pageIndex?: number } {
  if (typeof source !== 'string') invalid('Mermaid input must be text.');
  if (source.length > INTEROP_LIMITS.MAX_INPUT_BYTES || utf8ByteLength(source) > INTEROP_LIMITS.MAX_INPUT_BYTES) fail('LIMIT_EXCEEDED', 'Mermaid input exceeds its byte limit.');
  let value = source.trim();
  if (value.startsWith('```')) {
    const firstNewline = value.indexOf('\n');
    if (firstNewline < 0 || value.slice(0, firstNewline).trimEnd().toLowerCase() !== '```mermaid' || !value.endsWith('\n```'))
      unsupported('Use one complete Mermaid code block without surrounding prose.');
    value = value.slice(firstNewline + 1, -4);
    if (value.includes('```')) unsupported('Use one complete Mermaid code block without surrounding prose.');
  }
  let envelope: string | undefined, pageIndex: number | undefined;
  let quoted = false, depth = 0, start = 0;
  const segments: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (!depth && value.startsWith('%%', i)) {
      const newline = value.indexOf('\n', i), end = newline < 0 ? value.length : newline;
      // A metadata-looking line inside a quoted/multiline label is visible text,
      // never authority to restore a hidden model.
      if ((i === 0 || value[i - 1] === '\n') && value.startsWith(ENVELOPE_PREFIX, i)) {
        if (envelope !== undefined) invalid('Multiple embedded Mermaid documents are not allowed.');
        const payload = value.slice(i + ENVELOPE_PREFIX.length, end).replace(/\r$/, '');
        const space = payload.indexOf(' ');
        pageIndex = Number(payload.slice(0, space)); envelope = payload.slice(space + 1);
        if (space < 1 || !/^\d+$/.test(payload.slice(0, space))) pageIndex = -1;
        segments.push(value.slice(start, i)); start = end;
      }
      i = end - 1;
      continue;
    }
    if ('[({'.includes(c)) depth++;
    if ('])}'.includes(c)) depth--;
  }
  segments.push(value.slice(start));
  const visible = segments.join('').trim();
  if (utf8ByteLength(visible) > MAX_VISIBLE_BYTES) fail('LIMIT_EXCEEDED', 'Visible Mermaid source exceeds its byte limit.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(visible)) invalid('Mermaid source contains control characters.');
  return { visible, envelope, pageIndex };
}

export function importMermaid(source: string, options: ImportOptions = {}): InteropImportResult {
  return importBoundary(() => {
    const input = extract(source), ctx = context('mermaid', 'Imported Mermaid');
    if (input.envelope !== undefined) {
      try {
        const document = decodeEnvelope(input.envelope, 'mermaid');
        const page = document.pages[input.pageIndex ?? -1];
        if (!page || projection(document, page.id, new DiagnosticCollector()).trim() !== input.visible.replace(/\r\n/g, '\n'))
          fail('EMBEDDED_MODEL_STALE', 'Visible Mermaid no longer matches its embedded document.');
        ctx.diagnostics.add({ code: 'EMBEDDED_MODEL_RESTORED', severity: 'info', effect: 'preserved-as-data', property: 'metadata', pageIndex: input.pageIndex,
          message: `Mermaid: Restored the complete embedded document (${document.pages.length} pages). The visible projection was verified against page ${input.pageIndex! + 1}: ${page.name}. Other pages, assets, comments and tasks come from the embedded native document.` });
        const result = finish(ctx, options, document);
        result.source.pageId = page.id;
        return result;
      } catch (error) {
        ctx.diagnostics.add({ code: error instanceof InteropError && error.code === 'EMBEDDED_MODEL_STALE' ? 'EMBEDDED_MODEL_STALE' : 'EMBEDDED_MODEL_INVALID', severity: 'warning', effect: 'omitted', property: 'metadata', message: 'Mermaid: Embedded data was not restored; only the current visible flowchart is imported.' });
      }
    }
    materialize(ctx, parse(input.visible));
    return finish(ctx, options);
  });
}

function warning(d: DiagnosticCollector, code: string, message: string, elementId?: string, property?: string): void {
  d.add({ code, severity: 'warning', effect: 'approximated', message: `Mermaid: ${message}`, elementId, property });
}
function escaped(value: string, d: DiagnosticCollector, elementId: string): string {
  // Mermaid's documented numeric entity syntax keeps delimiters, HTML and directives literal.
  const normalized = sanitizeXml10Text(value, d, { elementId, property: 'text', format: 'mermaid' });
  if (/[\r\n]/.test(normalized)) warning(d, 'MERMAID_MULTILINE_LABEL_APPROXIMATED', 'Label text retains its newline characters, but line wrapping and line-break layout may differ in another Mermaid renderer.', elementId, 'text');
  // Mermaid rejects an empty quoted token. A single blank has the same visible
  // result and is normalized back to empty by this adapter's portable importer.
  if (!normalized) return ' ';
  // Literal colons can trigger Mermaid's style/entity preprocessing, even inside
  // quoted labels. Encode them and slashes rather than exposing that syntax.
  return Array.from(normalized, c => /[\p{L}\p{N} ,.!?_'-]/u.test(c) ? c : `#${c.codePointAt(0)};`).join('');
}
function projection(document: SketchDocument, pageId: string, d: DiagnosticCollector): string {
  const elements = document.elements.filter(el => el.pageId === pageId);
  const ids = new Map(elements.filter(el => el.kind !== 'connector').map((el, i) => [el.id, `n${i}`]));
  const out = new XmlOutputBuilder(MAX_VISIBLE_BYTES); out.append('flowchart LR\n');
  const children = new Map<string | undefined, SketchElement[]>();
  const groups = new Set(elements.filter(el => el.kind === 'container').map(el => el.id));
  for (const el of elements) {
    if (el.kind === 'connector') continue;
    const parent = el.parentId && groups.has(el.parentId) ? el.parentId : undefined;
    const list = children.get(parent) ?? []; list.push(el); children.set(parent, list);
  }
  const emit = (parent?: string, depth = 1): void => {
    for (const el of children.get(parent) ?? []) {
      const id = ids.get(el.id)!, indent = '  '.repeat(depth);
      const text = escaped(el.text || el.label || (el.kind === 'image' ? 'Image' : el.kind === 'web-embed' ? 'Web page' : ''), d, el.id);
      if (el.kind === 'container') {
        out.append(`${indent}subgraph ${id}["${text}"]\n`); emit(el.id, depth + 1); out.append(`${indent}end\n`); continue;
      }
      const shape = el.shapeVariant ?? (el.kind === 'ellipse' ? 'circle' : el.kind === 'diamond' ? 'diamond' : 'square');
      const delimiters = SHAPES.find(([, , variant]) => variant === shape) ?? SHAPES[4]!;
      out.append(`${indent}${id}${delimiters[0]}"${text}"${delimiters[1]}\n`);
      if (!['rectangle', 'ellipse', 'diamond', 'text'].includes(el.kind)) warning(d, 'MERMAID_ELEMENT_APPROXIMATED', `${el.kind} content is represented as a labelled flowchart node; images, rich content and native behavior are unavailable to other Mermaid tools.`, el.id, 'kind');
      if (!SHAPES.some(([, , variant]) => variant === shape)) warning(d, 'MERMAID_SHAPE_APPROXIMATED', 'This shape is represented as a rectangle.', el.id, 'shapeVariant');
    }
  };
  emit();
  let free = 0;
  for (const el of elements.filter(el => el.kind === 'connector')) {
    const endpoint = (target: string | undefined): string => {
      const id = target ? ids.get(target) : undefined;
      if (id) return id;
      const replacement = `endpoint${free++}`;
      out.append(`  ${replacement}["Endpoint"]\n`);
      warning(d, 'MERMAID_FREE_ENDPOINT_APPROXIMATED', 'A free or unsupported connector endpoint is represented as a separate node.', el.id, 'endpoints');
      return replacement;
    };
    const from = endpoint(el.from?.elementId), to = endpoint(el.to?.elementId);
    const start = el.startMarker !== undefined && el.startMarker !== 'none', end = el.endMarker !== 'none';
    const dotted = el.style.strokeDash === 'dashed' || el.style.strokeDash === 'dotted';
    let link = dotted ? (end || start ? '-.->' : '-.-') : (end || start ? '-->' : '---');
    if (start && end) link = `<${link}`;
    const edgeText = el.text || el.label;
    const text = edgeText ? `|"${escaped(edgeText, d, el.id)}"|` : '';
    out.append(`  ${start && !end ? to : from} ${link}${text} ${start && !end ? from : to}\n`);
    if ([el.startMarker, el.endMarker].some(marker => marker && !['none', 'solid-arrow'].includes(marker))) warning(d, 'MERMAID_MARKER_APPROXIMATED', 'Connector marker styles are represented as ordinary arrowheads.', el.id, 'markers');
  }
  if (elements.length) {
    warning(d, 'MERMAID_LAYOUT_LOSS', 'Other Mermaid tools calculate their own layout; canvas coordinates, sizes and connector routes are not preserved.', undefined, 'geometry');
    warning(d, 'MERMAID_STYLE_LOSS', 'Canvas colors, fonts, line widths, opacity and detailed styling are not preserved in the portable flowchart.', undefined, 'style');
  }
  if (document.pages.length > 1) warning(d, 'MERMAID_OTHER_PAGES_OMITTED', 'The visible flowchart contains only the selected page.', undefined, 'pages');
  if (document.commentThreads?.length || document.tasks?.length) warning(d, 'MERMAID_DISCUSSION_OMITTED', 'Comments and tasks are not part of the portable Mermaid flowchart.', undefined, 'comments');
  return out.toString();
}

export function prepareMermaidExport(document: SketchDocument, options: InteropExportOptions = {}): InteropExportResult {
  return importBoundary(() => {
    const full = validateDocument(document); serializeDocument(full);
    const pageId = options.pageId ?? full.pages[0]!.id;
    const pageIndex = full.pages.findIndex(page => page.id === pageId);
    if (pageIndex < 0) fail('PAGE_NOT_FOUND', 'The selected Mermaid export page does not exist.');
    const d = new DiagnosticCollector(), out = new XmlOutputBuilder();
    out.append(projection(full, pageId, d));
    const embed = options.embedDocument !== false;
    if (embed) {
      out.append(`${ENVELOPE_PREFIX}${pageIndex} ${encodeEnvelope(full, 'mermaid')}\n`);
      d.add({ code: 'MERMAID_EMBEDDED_DOCUMENT', severity: 'info', effect: 'preserved-as-data', property: 'metadata', message: 'Mermaid: The comment contains the complete document, including other pages, assets, comments and tasks. Other Mermaid tools ignore these data; disable embedded data for a portable visible-page-only export.' });
    }
    const contents = out.toString();
    if (contents.length > 50_000) warning(d, 'MERMAID_RENDERER_SIZE_LIMIT', 'This file exceeds Mermaid’s default 50,000-character rendering limit. Export without embedded data, reduce the visible flowchart, or configure the receiving renderer explicitly.', undefined, 'size');
    const diagnostics = d.finalize();
    return { format: 'mermaid', contents, mimeType: 'text/plain', suggestedExtension: '.mmd', diagnostics, requiresConfirmation: hasWarningDiagnostics(diagnostics), embedsDocument: embed };
  });
}

/** Like other string exporters, callers must explicitly review lossy projections. */
export function exportMermaid(document: SketchDocument, options: InteropExportOptions = {}): string {
  const result = prepareMermaidExport(document, options);
  if (result.requiresConfirmation) throw new InteropError('LOSS_CONFIRMATION_REQUIRED', 'Review Mermaid conversion diagnostics before exporting.', result.diagnostics);
  return result.contents;
}

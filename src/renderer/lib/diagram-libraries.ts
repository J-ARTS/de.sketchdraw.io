import { createElement, type ConnectorMarker, type ConnectorRouting, type ElementStyle, type Point, type SketchElement, type TableDocument } from '@/domain';
import { L } from '@/renderer/i18n';
import { DEFAULT_STYLE, STYLE_BY_KIND } from './constants';
import { ELEMENT_CLIPBOARD_FORMAT, type ElementClipboardPayload } from '../state/element-clipboard';

/**
 * Libraries for diagram types (#191, #192): entity relationship, BPMN and sequence diagrams. A template is a
 * small arrangement of ordinary elements (shapes, tables, containers, connectors), built in code and inserted
 * like a paste, so everything stays editable, readable as diagram code and visible to agents. No new element
 * kind and no component set is involved.
 */
export const TEMPLATE_DRAG_MIME = 'application/x-sketchdraw-template';

export type DiagramLibraryId = 'er' | 'bpmn' | 'sequence';

export interface DiagramTemplate {
  /** Unique across all libraries, e.g. `er.entity`. */
  id: string;
  /** German source text; shown through `t()`. */
  name: string;
  section: string;
  /** Extra search words, German and English. */
  keywords: string;
  build(): ElementClipboardPayload;
}

export interface DiagramLibrary {
  id: DiagramLibraryId;
  name: string;
  description: string;
  templates: readonly DiagramTemplate[];
}

/** Metadata keys that mark the parts of a sequence diagram, so the editor can extend it (#192). */
export const SEQUENCE_ROLE_KEY = 'sequence:role';
export type SequenceRole = 'lifeline' | 'head' | 'line' | 'message';
export const SEQUENCE_LIFELINE = Object.freeze({ width: 160, height: 420, headHeight: 48, gap: 60, firstMessage: 96, messageStep: 48 });

const INK = DEFAULT_STYLE.stroke;
const style = (overrides: Partial<ElementStyle> = {}): ElementStyle => ({ ...DEFAULT_STYLE, ...overrides });
const payload = (elements: SketchElement[]): ElementClipboardPayload => ({ format: ELEMENT_CLIPBOARD_FORMAT, version: 1, elements, assets: {}, componentSets: [] });

interface Box { x: number; y: number; width: number; height: number }
function shape(kind: 'rectangle' | 'ellipse' | 'diamond', id: string, box: Box, text: string, extra: Partial<SketchElement> = {}, look: Partial<ElementStyle> = {}): SketchElement {
  return createElement(kind, { id, ...box, text, label: text || undefined, style: style({ textAlign: 'center', fontSize: 16, fill: '#ffffff', ...look }), ...extra });
}
function container(id: string, box: Box, text: string, look: Partial<ElementStyle> = {}, extra: Partial<SketchElement> = {}): SketchElement {
  return createElement('container', { id, ...box, text, label: text, style: style({ ...STYLE_BY_KIND.container, fontSize: 14, ...look }), ...extra });
}
interface End { id: string; anchor: Point }
interface LinkOptions { start?: ConnectorMarker; end?: ConnectorMarker; dash?: ElementStyle['strokeDash']; text?: string; from?: End; to?: End; routing?: ConnectorRouting; extra?: Partial<SketchElement> }
/** A connector from `a` to `b` (document coordinates), straight unless `routing` says otherwise, optionally bound to elements at both ends. */
function link(id: string, a: Point, b: Point, options: LinkOptions = {}): SketchElement {
  return createElement('connector', {
    id,
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
    points: [{ x: a.x - Math.min(a.x, b.x), y: a.y - Math.min(a.y, b.y) }, { x: b.x - Math.min(a.x, b.x), y: b.y - Math.min(a.y, b.y) }],
    connectorRouting: options.routing ?? 'straight',
    startMarker: options.start ?? 'none',
    endMarker: options.end ?? 'none',
    ...(options.text ? { text: options.text } : {}),
    ...(options.from ? { from: { elementId: options.from.id, anchor: options.from.anchor } } : {}),
    ...(options.to ? { to: { elementId: options.to.id, anchor: options.to.anchor } } : {}),
    style: style({ fontSize: 14, strokeDash: options.dash ?? 'solid' }),
    ...options.extra,
  });
}

/** An entity as a table: a tinted header row with the entity's name, then one row per attribute. */
function entityTable(id: string, at: Point, name: string, attributes: ReadonlyArray<readonly [string, string]>): SketchElement {
  const columns = [{ id: `${id}:c1`, width: 150 }, { id: `${id}:c2`, width: 110 }];
  const rows = [name, ...attributes.map(([attribute]) => attribute)].map((_, index) => ({ id: `${id}:r${index}`, height: 36 }));
  const base = { fontSize: 14, fontFamily: 'sans' as const, textDecoration: 'none' as const, listStyle: 'none' as const, textAlign: 'left' as const };
  const table: TableDocument = {
    version: 1,
    rows,
    columns,
    cells: rows.flatMap((row, rowIndex) => columns.map((column, columnIndex) => ({
      id: `${id}:${rowIndex}:${columnIndex}`,
      rowId: row.id,
      columnId: column.id,
      text: rowIndex === 0 ? (columnIndex === 0 ? name : '') : attributes[rowIndex - 1]![columnIndex]!,
      style: rowIndex === 0
        ? { ...base, fill: '#dbe4ff', color: '#1e1e1e', fontWeight: 'bold' as const }
        : { ...base, fill: '#ffffff', color: columnIndex === 0 ? '#1e1e1e' : '#5f5c74', fontWeight: 'normal' as const },
    }))),
  };
  return createElement('table', { id, x: at.x, y: at.y, width: 260, height: rows.length * 36, label: name, table, style: style({ fill: '#ffffff', strokeWidth: 1 }) });
}

/** Relationships are curved connectors, like the curved arrow: they bend towards the sides they dock on and can be shaped by their control points. */
const ER_LINKS: ReadonlyArray<readonly [string, string, ConnectorMarker, ConnectorMarker, string]> = [
  ['er.one-to-one', L('Beziehung 1:1'), 'exactly-one', 'exactly-one', 'one to one eins'],
  ['er.one-to-many', L('Beziehung 1:n'), 'exactly-one', 'one-or-many', 'one to many viele'],
  ['er.optional-to-many', L('Beziehung 0..1:n'), 'zero-or-one', 'zero-or-many', 'optional zero many'],
  ['er.many-to-many', L('Beziehung n:m'), 'one-or-many', 'one-or-many', 'many to many'],
];

const er: DiagramLibrary = {
  id: 'er',
  name: L('ER-Diagramme'),
  description: L('Entitäten, Attribute und Beziehungen'),
  templates: [
    { id: 'er.entity', name: L('Entität'), section: L('Tabellen'), keywords: 'entity table tabelle crow foot', build: () => payload([entityTable('t', { x: 0, y: 0 }, 'Entität', [['id', 'PK'], ['name', 'string'], ['created_at', 'date']])]) },
    {
      id: 'er.example', name: L('Beispiel: Kunde und Bestellung'), section: L('Tabellen'), keywords: 'example beispiel customer order',
      build: () => payload([
        entityTable('a', { x: 0, y: 0 }, 'Kunde', [['id', 'PK'], ['name', 'string'], ['email', 'string']]),
        entityTable('b', { x: 420, y: 0 }, 'Bestellung', [['id', 'PK'], ['kunde_id', 'FK'], ['datum', 'date']]),
        link('l', { x: 260, y: 72 }, { x: 420, y: 72 }, { routing: 'curved', start: 'exactly-one', end: 'zero-or-many', from: { id: 'a', anchor: { x: 1, y: 0.5 } }, to: { id: 'b', anchor: { x: 0, y: 0.5 } } }),
      ]),
    },
    ...ER_LINKS.map(([id, name, start, end, keywords]): DiagramTemplate => ({ id, name, section: L('Beziehungen'), keywords: `relationship kardinalität cardinality ${keywords}`, build: () => payload([link('l', { x: 0, y: 0 }, { x: 200, y: 0 }, { routing: 'curved', start, end })]) })),
    { id: 'er.chen-entity', name: L('Entität (Chen)'), section: L('Chen-Notation'), keywords: 'entity chen rechteck', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 150, height: 70 }, 'Entität')]) },
    { id: 'er.chen-attribute', name: L('Attribut'), section: L('Chen-Notation'), keywords: 'attribute chen ellipse', build: () => payload([shape('ellipse', 's', { x: 0, y: 0, width: 130, height: 60 }, 'Attribut')]) },
    { id: 'er.chen-key', name: L('Schlüsselattribut'), section: L('Chen-Notation'), keywords: 'key attribute primary schlüssel', build: () => payload([shape('ellipse', 's', { x: 0, y: 0, width: 130, height: 60 }, 'ID', {}, { fontWeight: 'bold', fill: '#fff3bf' })]) },
    { id: 'er.chen-relationship', name: L('Beziehung (Chen)'), section: L('Chen-Notation'), keywords: 'relationship chen raute diamond', build: () => payload([shape('diamond', 's', { x: 0, y: 0, width: 150, height: 90 }, 'hat')]) },
  ],
};

const round = (id: string, text: string, look: Partial<ElementStyle>): SketchElement => shape('ellipse', id, { x: 0, y: 0, width: 56, height: 56 }, text, {}, look);
const task = (id: string, at: Point, text: string): SketchElement => shape('rectangle', id, { x: at.x, y: at.y, width: 150, height: 80 }, text, { shapeVariant: 'rounded' });
const gateway = (id: string, at: Point, symbol: string): SketchElement => shape('diamond', id, { x: at.x, y: at.y, width: 72, height: 72 }, symbol, {}, { fontSize: 24, fill: '#fff9db' });

const bpmn: DiagramLibrary = {
  id: 'bpmn',
  name: L('BPMN'),
  description: L('Ereignisse, Aufgaben, Gateways und Bahnen'),
  templates: [
    { id: 'bpmn.start', name: L('Startereignis'), section: L('Ereignisse'), keywords: 'start event', build: () => payload([round('s', '', { stroke: '#2f9e44', fill: '#ebfbee', strokeWidth: 2 })]) },
    { id: 'bpmn.end', name: L('Endereignis'), section: L('Ereignisse'), keywords: 'end event ende', build: () => payload([round('s', '', { stroke: '#c92a2a', fill: '#fff5f5', strokeWidth: 5 })]) },
    { id: 'bpmn.timer', name: L('Zeitereignis'), section: L('Ereignisse'), keywords: 'timer intermediate zwischenereignis zeit', build: () => payload([round('s', '◷', { strokeWidth: 2, fontSize: 26 })]) },
    { id: 'bpmn.message', name: L('Nachrichtenereignis'), section: L('Ereignisse'), keywords: 'message intermediate zwischenereignis nachricht', build: () => payload([round('s', '✉', { strokeWidth: 2, fontSize: 24 })]) },
    { id: 'bpmn.task', name: L('Aufgabe'), section: L('Aktivitäten'), keywords: 'task activity aktivität', build: () => payload([task('s', { x: 0, y: 0 }, 'Aufgabe')]) },
    { id: 'bpmn.subprocess', name: L('Teilprozess'), section: L('Aktivitäten'), keywords: 'subprocess unterprozess', build: () => payload([task('s', { x: 0, y: 0 }, 'Teilprozess\n⊞')]) },
    { id: 'bpmn.gateway-exclusive', name: L('Exklusives Gateway'), section: L('Gateways'), keywords: 'gateway xor exclusive entscheidung', build: () => payload([gateway('s', { x: 0, y: 0 }, '✕')]) },
    { id: 'bpmn.gateway-parallel', name: L('Paralleles Gateway'), section: L('Gateways'), keywords: 'gateway and parallel', build: () => payload([gateway('s', { x: 0, y: 0 }, '+')]) },
    { id: 'bpmn.gateway-inclusive', name: L('Inklusives Gateway'), section: L('Gateways'), keywords: 'gateway or inclusive', build: () => payload([gateway('s', { x: 0, y: 0 }, '○')]) },
    { id: 'bpmn.data-object', name: L('Datenobjekt'), section: L('Daten'), keywords: 'data object dokument', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 80, height: 100 }, 'Daten', { shapeVariant: 'note' }, { fontSize: 14 })]) },
    { id: 'bpmn.data-store', name: L('Datenspeicher'), section: L('Daten'), keywords: 'data store datenbank database', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 100, height: 90 }, 'Speicher', { shapeVariant: 'cylinder' }, { fontSize: 14 })]) },
    { id: 'bpmn.pool', name: L('Pool'), section: L('Bahnen'), keywords: 'pool participant teilnehmer swimlane', build: () => payload([container('s', { x: 0, y: 0, width: 640, height: 220 }, 'Pool', { stroke: INK, strokeDash: 'solid', strokeWidth: 2 })]) },
    {
      id: 'bpmn.pool-lanes', name: L('Pool mit zwei Bahnen'), section: L('Bahnen'), keywords: 'pool lane bahn swimlane',
      build: () => payload([
        container('p', { x: 0, y: 0, width: 640, height: 320 }, 'Pool', { stroke: INK, strokeDash: 'solid', strokeWidth: 2 }),
        container('a', { x: 16, y: 40, width: 608, height: 124 }, 'Bahn 1', { stroke: INK, strokeDash: 'solid' }, { parentId: 'p' }),
        container('b', { x: 16, y: 180, width: 608, height: 124 }, 'Bahn 2', { stroke: INK, strokeDash: 'solid' }, { parentId: 'p' }),
      ]),
    },
    { id: 'bpmn.sequence-flow', name: L('Sequenzfluss'), section: L('Flüsse'), keywords: 'sequence flow pfeil', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { end: 'solid-arrow' })]) },
    { id: 'bpmn.message-flow', name: L('Nachrichtenfluss'), section: L('Flüsse'), keywords: 'message flow', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { start: 'circle', end: 'triangle', dash: 'dashed' })]) },
    { id: 'bpmn.association', name: L('Assoziation'), section: L('Flüsse'), keywords: 'association', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { dash: 'dotted' })]) },
    {
      id: 'bpmn.example', name: L('Beispiel: einfacher Prozess'), section: L('Flüsse'), keywords: 'example beispiel process prozess',
      build: () => {
        const start = { ...round('s', '', { stroke: '#2f9e44', fill: '#ebfbee', strokeWidth: 2 }), x: 0, y: 12 };
        const end = { ...round('e', '', { stroke: '#c92a2a', fill: '#fff5f5', strokeWidth: 5 }), x: 496, y: 12 };
        const right = { x: 1, y: 0.5 };
        const left = { x: 0, y: 0.5 };
        return payload([
          start, task('t', { x: 116, y: 0 }, 'Aufgabe'), gateway('g', { x: 346, y: 4 }, '✕'), end,
          link('l1', { x: 56, y: 40 }, { x: 116, y: 40 }, { end: 'solid-arrow', from: { id: 's', anchor: right }, to: { id: 't', anchor: left } }),
          link('l2', { x: 266, y: 40 }, { x: 346, y: 40 }, { end: 'solid-arrow', from: { id: 't', anchor: right }, to: { id: 'g', anchor: left } }),
          link('l3', { x: 418, y: 40 }, { x: 496, y: 40 }, { end: 'solid-arrow', from: { id: 'g', anchor: right }, to: { id: 'e', anchor: left } }),
        ]);
      },
    },
  ],
};

const role = (value: SequenceRole): Record<string, string> => ({ [SEQUENCE_ROLE_KEY]: value });

/**
 * One lifeline: an invisible container that holds the participant's box and the dashed line below it. Moving
 * the container moves both; messages bind to the container, so they follow as well.
 */
export function sequenceLifeline(id: string, at: Point, name: string, height: number = SEQUENCE_LIFELINE.height): SketchElement[] {
  const { width, headHeight } = SEQUENCE_LIFELINE;
  return [
    createElement('container', { id, x: at.x, y: at.y, width, height, label: name, metadata: role('lifeline'), style: style({ stroke: 'transparent', strokeWidth: 1, fontSize: 14 }) }),
    createElement('rectangle', { id: `${id}:head`, parentId: id, x: at.x, y: at.y, width, height: headHeight, text: name, label: name, metadata: role('head'), style: style({ textAlign: 'center', fontSize: 16, fill: '#e7f5ff' }) }),
    createElement('path', { id: `${id}:line`, parentId: id, x: at.x + width / 2, y: at.y + headHeight, width: 0, height: height - headHeight, points: [{ x: 0, y: 0 }, { x: 0, y: height - headHeight }], metadata: role('line'), style: style({ strokeDash: 'dashed', strokeWidth: 1, stroke: '#868e96' }) }),
  ];
}

export type SequenceMessageKind = 'sync' | 'async' | 'reply';
/** A message between two lifelines at document height `y`; both ends are bound to the lifeline containers. */
export function sequenceMessage(id: string, from: SketchElement, to: SketchElement, y: number, text: string, kind: SequenceMessageKind = 'sync'): SketchElement {
  const anchor = (lifeline: SketchElement): Point => ({ x: 0.5, y: Math.max(0, Math.min(1, (y - lifeline.y) / Math.max(1, lifeline.height))) });
  return link(id, { x: from.x + from.width / 2, y }, { x: to.x + to.width / 2, y }, {
    end: kind === 'sync' ? 'solid-arrow' : 'line-arrow',
    dash: kind === 'reply' ? 'dashed' : 'solid',
    text,
    from: { id: from.id, anchor: anchor(from) },
    to: { id: to.id, anchor: anchor(to) },
    extra: { metadata: role('message') },
  });
}

function sequenceExample(): ElementClipboardPayload {
  const step = SEQUENCE_LIFELINE.width + SEQUENCE_LIFELINE.gap;
  const a = sequenceLifeline('a', { x: 0, y: 0 }, 'Client');
  const b = sequenceLifeline('b', { x: step, y: 0 }, 'Dienst');
  const y = SEQUENCE_LIFELINE.firstMessage;
  return payload([...a, ...b, sequenceMessage('m1', a[0]!, b[0]!, y, 'Anfrage'), sequenceMessage('m2', b[0]!, a[0]!, y + SEQUENCE_LIFELINE.messageStep, 'Antwort', 'reply')]);
}
const free = (text: string, kind: SequenceMessageKind): ElementClipboardPayload => payload([link('l', { x: 0, y: 0 }, { x: 220, y: 0 }, { end: kind === 'sync' ? 'solid-arrow' : 'line-arrow', dash: kind === 'reply' ? 'dashed' : 'solid', text, extra: { metadata: role('message') } })]);

const sequence: DiagramLibrary = {
  id: 'sequence',
  name: L('Sequenzdiagramme'),
  description: L('Lebenslinien, Nachrichten und Fragmente'),
  templates: [
    { id: 'sequence.example', name: L('Beispiel: Anfrage und Antwort'), section: L('Start'), keywords: 'example beispiel request response', build: sequenceExample },
    { id: 'sequence.lifeline', name: L('Lebenslinie'), section: L('Start'), keywords: 'lifeline participant teilnehmer achse actor akteur', build: () => payload(sequenceLifeline('a', { x: 0, y: 0 }, 'Teilnehmer')) },
    { id: 'sequence.message', name: L('Nachricht'), section: L('Nachrichten'), keywords: 'message synchronous synchron call aufruf', build: () => free('Nachricht', 'sync') },
    { id: 'sequence.async', name: L('Asynchrone Nachricht'), section: L('Nachrichten'), keywords: 'message asynchronous asynchron', build: () => free('Nachricht', 'async') },
    { id: 'sequence.reply', name: L('Antwort'), section: L('Nachrichten'), keywords: 'reply return response rückgabe', build: () => free('Antwort', 'reply') },
    { id: 'sequence.activation', name: L('Aktivierung'), section: L('Weitere'), keywords: 'activation execution balken', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 14, height: 90 }, '', {}, { strokeWidth: 1 })]) },
    { id: 'sequence.fragment', name: L('Fragment (alt, loop, opt)'), section: L('Weitere'), keywords: 'fragment alt loop opt combined', build: () => payload([container('s', { x: 0, y: 0, width: 420, height: 160 }, 'alt', { stroke: INK, strokeDash: 'solid', strokeWidth: 1 })]) },
  ],
};

export const DIAGRAM_LIBRARIES: readonly DiagramLibrary[] = [er, bpmn, sequence];

export function diagramLibrary(id: DiagramLibraryId): DiagramLibrary {
  return DIAGRAM_LIBRARIES.find((library) => library.id === id)!;
}
export function diagramTemplate(id: string): DiagramTemplate | undefined {
  for (const library of DIAGRAM_LIBRARIES) {
    const template = library.templates.find((entry) => entry.id === id);
    if (template) return template;
  }
  return undefined;
}

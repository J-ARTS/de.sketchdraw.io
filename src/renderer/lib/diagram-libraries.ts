import { createElement, type ConnectorMarker, type ConnectorRouting, type ElementStyle, type Point, type SketchElement, type TableDocument } from '@/domain';
import { L } from '@/renderer/i18n';
import { DEFAULT_STYLE } from './constants';
import { BPMN_EVENT_KEY, BPMN_ICON_KEY, BPMN_ICON_STYLE_KEY, BPMN_MARKER_KEY, createLane, createPool, type BpmnEvent, type BpmnMarker } from './bpmn';
import { ELEMENT_CLIPBOARD_FORMAT, type ElementClipboardPayload } from '../state/element-clipboard';
import { TABLE_MERGES_KEY } from './table-merge';
import { buildSequence, freeSequenceMessage, sequenceFragmentElements, sequenceLifeline, sequenceNoteElement, SEQUENCE_LIFELINE, type FragmentOperator } from './sequence-model';

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

const style = (overrides: Partial<ElementStyle> = {}): ElementStyle => ({ ...DEFAULT_STYLE, ...overrides });
const payload = (elements: SketchElement[]): ElementClipboardPayload => ({ format: ELEMENT_CLIPBOARD_FORMAT, version: 1, elements, assets: {}, componentSets: [] });

interface Box { x: number; y: number; width: number; height: number }
function shape(kind: 'rectangle' | 'ellipse' | 'diamond', id: string, box: Box, text: string, extra: Partial<SketchElement> = {}, look: Partial<ElementStyle> = {}): SketchElement {
  return createElement(kind, { id, ...box, text, label: text || undefined, style: style({ textAlign: 'center', fontSize: 16, fill: '#ffffff', ...look }), ...extra });
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

/** An entity as a table: a tinted, merged header row with the entity's name, then one row per attribute. */
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
        ? { ...base, fill: '#dbe4ff', color: '#1e1e1e', fontWeight: 'bold' as const, textAlign: 'center' as const }
        : { ...base, fill: '#ffffff', color: columnIndex === 0 ? '#1e1e1e' : '#5f5c74', fontWeight: 'normal' as const },
    }))),
  };
  // The header is one merged row with the table's name (#197); it keeps covering columns that are added later.
  const header = `${id}:0:0>${id}:0:${columns.length - 1}`;
  return createElement('table', { id, x: at.x, y: at.y, width: 260, height: rows.length * 36, label: name, table, metadata: { [TABLE_MERGES_KEY]: header }, style: style({ fill: '#ffffff', strokeWidth: 1 }) });
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

type Meta = Record<string, string>;
const EVENT_LOOK: Record<BpmnEvent, Partial<ElementStyle>> = {
  start: { stroke: '#2f9e44', fill: '#ebfbee', strokeWidth: 1.5 },
  intermediate: { stroke: '#1971c2', fill: '#e7f5ff', strokeWidth: 1.5 },
  end: { stroke: '#c92a2a', fill: '#fff5f5', strokeWidth: 4 },
};
/** An event: a circle whose border says start, intermediate or end, with an optional symbol; `solid` symbols mark throwing events. */
function event(id: string, kind: BpmnEvent, icon?: string, solid = false, at: Point = { x: 0, y: 0 }): SketchElement {
  const metadata: Meta = { [BPMN_EVENT_KEY]: kind, ...(icon ? { [BPMN_ICON_KEY]: icon } : {}), ...(solid ? { [BPMN_ICON_STYLE_KEY]: 'solid' } : {}) };
  return createElement('ellipse', { id, x: at.x, y: at.y, width: 48, height: 48, metadata, style: style({ textAlign: 'center', fontSize: 12, ...EVENT_LOOK[kind] }) });
}
interface ActivityOptions { icon?: string; solid?: boolean; marker?: BpmnMarker; look?: Partial<ElementStyle> }
/** An activity: a rounded rectangle with an optional type symbol at the top left and a marker at the bottom. */
function activity(id: string, at: Point, text: string, options: ActivityOptions = {}): SketchElement {
  const metadata: Meta = { ...(options.icon ? { [BPMN_ICON_KEY]: options.icon } : {}), ...(options.solid ? { [BPMN_ICON_STYLE_KEY]: 'solid' } : {}), ...(options.marker ? { [BPMN_MARKER_KEY]: options.marker } : {}) };
  return shape('rectangle', id, { x: at.x, y: at.y, width: 150, height: 80 }, text, { shapeVariant: 'rounded', ...(Object.keys(metadata).length ? { metadata } : {}) }, { fill: '#fff9db', ...options.look });
}
const task = (id: string, at: Point, text: string): SketchElement => activity(id, at, text);
const gateway = (id: string, at: Point, symbol: string): SketchElement => shape('diamond', id, { x: at.x, y: at.y, width: 64, height: 64 }, symbol, {}, { fontSize: 24, fontWeight: 'bold' });

const EVENTS: ReadonlyArray<readonly [string, string, BpmnEvent, string | undefined, boolean, string]> = [
  ['bpmn.start', L('Startereignis'), 'start', undefined, false, 'start event'],
  ['bpmn.start-message', L('Start: Nachricht'), 'start', 'message', false, 'start message nachricht'],
  ['bpmn.start-timer', L('Start: Zeit'), 'start', 'timer', false, 'start timer zeit'],
  ['bpmn.start-conditional', L('Start: Bedingung'), 'start', 'conditional', false, 'start conditional bedingung'],
  ['bpmn.start-signal', L('Start: Signal'), 'start', 'signal', false, 'start signal'],
  ['bpmn.intermediate', L('Zwischenereignis'), 'intermediate', undefined, false, 'intermediate event'],
  ['bpmn.message', L('Nachricht empfangen'), 'intermediate', 'message', false, 'intermediate message catch nachrichtenereignis'],
  ['bpmn.message-throw', L('Nachricht senden'), 'intermediate', 'message', true, 'intermediate message throw senden'],
  ['bpmn.timer', L('Zeitereignis'), 'intermediate', 'timer', false, 'timer intermediate zeit'],
  ['bpmn.intermediate-conditional', L('Bedingung'), 'intermediate', 'conditional', false, 'conditional intermediate'],
  ['bpmn.intermediate-signal', L('Signal empfangen'), 'intermediate', 'signal', false, 'signal catch'],
  ['bpmn.intermediate-signal-throw', L('Signal senden'), 'intermediate', 'signal', true, 'signal throw'],
  ['bpmn.intermediate-link', L('Link'), 'intermediate', 'link', false, 'link verweis'],
  ['bpmn.intermediate-escalation', L('Eskalation'), 'intermediate', 'escalation', true, 'escalation'],
  ['bpmn.end', L('Endereignis'), 'end', undefined, false, 'end event ende'],
  ['bpmn.end-message', L('Ende: Nachricht'), 'end', 'message', true, 'end message'],
  ['bpmn.end-error', L('Ende: Fehler'), 'end', 'error', true, 'end error fehler'],
  ['bpmn.end-signal', L('Ende: Signal'), 'end', 'signal', true, 'end signal'],
  ['bpmn.end-cancel', L('Ende: Abbruch'), 'end', 'cancel', false, 'end cancel abbruch'],
  ['bpmn.end-terminate', L('Ende: Terminierung'), 'end', 'terminate', false, 'end terminate terminierung'],
];
const ACTIVITIES: ReadonlyArray<readonly [string, string, string, ActivityOptions, string]> = [
  ['bpmn.task', L('Aufgabe'), 'Aufgabe', {}, 'task activity aktivität'],
  ['bpmn.user-task', L('Benutzeraufgabe'), 'Aufgabe', { icon: 'user' }, 'user task benutzer'],
  ['bpmn.service-task', L('Serviceaufgabe'), 'Aufgabe', { icon: 'service' }, 'service task dienst'],
  ['bpmn.script-task', L('Skriptaufgabe'), 'Aufgabe', { icon: 'script' }, 'script task skript'],
  ['bpmn.send-task', L('Sendeaufgabe'), 'Aufgabe', { icon: 'message', solid: true }, 'send task senden'],
  ['bpmn.receive-task', L('Empfangsaufgabe'), 'Aufgabe', { icon: 'message' }, 'receive task empfangen'],
  ['bpmn.manual-task', L('Manuelle Aufgabe'), 'Aufgabe', { icon: 'manual' }, 'manual task manuell'],
  ['bpmn.rule-task', L('Geschäftsregel-Aufgabe'), 'Aufgabe', { icon: 'rule' }, 'business rule task regel'],
  ['bpmn.subprocess', L('Teilprozess'), 'Teilprozess', { marker: 'subprocess' }, 'subprocess unterprozess'],
  ['bpmn.call-activity', L('Aufrufaktivität'), 'Aufruf', { look: { strokeWidth: 5 } }, 'call activity aufruf'],
  ['bpmn.loop-task', L('Schleife'), 'Aufgabe', { marker: 'loop' }, 'loop schleife wiederholung'],
  ['bpmn.multi-parallel', L('Mehrfachinstanz (parallel)'), 'Aufgabe', { marker: 'parallel' }, 'multi instance parallel mehrfach'],
  ['bpmn.multi-sequential', L('Mehrfachinstanz (sequenziell)'), 'Aufgabe', { marker: 'sequential' }, 'multi instance sequential mehrfach'],
  ['bpmn.event-subprocess', L('Ereignis-Teilprozess'), 'Teilprozess', { marker: 'subprocess', look: { strokeDash: 'dotted' } }, 'event subprocess'],
];

/** A pool with its lanes stacked over the whole width, like in a BPMN tool. */
function poolWithLanes(names: readonly string[], laneHeight = 150): SketchElement[] {
  const pool = createPool('p', { x: 0, y: 0, width: 760, height: names.length * laneHeight }, 'Pool');
  return [pool, ...names.map((name, index) => createLane(`l${index}`, pool, index * laneHeight, laneHeight, name))];
}

const bpmn: DiagramLibrary = {
  id: 'bpmn',
  name: L('BPMN'),
  description: L('Ereignisse, Aufgaben, Gateways und Bahnen'),
  templates: [
    ...EVENTS.map(([id, name, kind, icon, solid, keywords]): DiagramTemplate => ({ id, name, section: L('Ereignisse'), keywords: `event ereignis ${keywords}`, build: () => payload([event('s', kind, icon, solid)]) })),
    ...ACTIVITIES.map(([id, name, text, options, keywords]): DiagramTemplate => ({ id, name, section: L('Aktivitäten'), keywords, build: () => payload([activity('s', { x: 0, y: 0 }, text, options)]) })),
    { id: 'bpmn.gateway-exclusive', name: L('Exklusives Gateway'), section: L('Gateways'), keywords: 'gateway xor exclusive entscheidung', build: () => payload([gateway('s', { x: 0, y: 0 }, '✕')]) },
    { id: 'bpmn.gateway-parallel', name: L('Paralleles Gateway'), section: L('Gateways'), keywords: 'gateway and parallel', build: () => payload([gateway('s', { x: 0, y: 0 }, '+')]) },
    { id: 'bpmn.gateway-inclusive', name: L('Inklusives Gateway'), section: L('Gateways'), keywords: 'gateway or inclusive', build: () => payload([gateway('s', { x: 0, y: 0 }, '○')]) },
    { id: 'bpmn.gateway-event', name: L('Ereignisbasiertes Gateway'), section: L('Gateways'), keywords: 'gateway event based ereignis', build: () => payload([gateway('s', { x: 0, y: 0 }, '⬠')]) },
    { id: 'bpmn.data-object', name: L('Datenobjekt'), section: L('Daten'), keywords: 'data object dokument', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 80, height: 100 }, 'Daten', { shapeVariant: 'note' }, { fontSize: 14 })]) },
    { id: 'bpmn.data-store', name: L('Datenspeicher'), section: L('Daten'), keywords: 'data store datenbank database', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 100, height: 90 }, 'Speicher', { shapeVariant: 'cylinder' }, { fontSize: 14 })]) },
    { id: 'bpmn.pool-lanes', name: L('Pool mit zwei Bahnen'), section: L('Bahnen'), keywords: 'pool lane bahn swimlane', build: () => payload(poolWithLanes(['Bahn 1', 'Bahn 2'])) },
    { id: 'bpmn.pool-three-lanes', name: L('Pool mit drei Bahnen'), section: L('Bahnen'), keywords: 'pool lane bahn swimlane drei three', build: () => payload(poolWithLanes(['Bahn 1', 'Bahn 2', 'Bahn 3'], 130)) },
    { id: 'bpmn.pool', name: L('Pool'), section: L('Bahnen'), keywords: 'pool participant teilnehmer swimlane', build: () => payload([createPool('p', { x: 0, y: 0, width: 760, height: 200 }, 'Pool')]) },
    { id: 'bpmn.pool-collapsed', name: L('Zugeklappter Pool'), section: L('Bahnen'), keywords: 'pool collapsed black box teilnehmer partner', build: () => payload([shape('rectangle', 's', { x: 0, y: 0, width: 760, height: 70 }, 'Teilnehmer', {}, { fontSize: 20, strokeWidth: 1.5 })]) },
    { id: 'bpmn.sequence-flow', name: L('Sequenzfluss'), section: L('Flüsse'), keywords: 'sequence flow pfeil', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { end: 'solid-arrow' })]) },
    { id: 'bpmn.message-flow', name: L('Nachrichtenfluss'), section: L('Flüsse'), keywords: 'message flow', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { start: 'circle', end: 'triangle', dash: 'dashed' })]) },
    { id: 'bpmn.association', name: L('Assoziation'), section: L('Flüsse'), keywords: 'association', build: () => payload([link('l', { x: 0, y: 0 }, { x: 160, y: 0 }, { dash: 'dotted' })]) },
    {
      id: 'bpmn.example', name: L('Beispiel: einfacher Prozess'), section: L('Flüsse'), keywords: 'example beispiel process prozess',
      build: () => {
        const right = { x: 1, y: 0.5 };
        const left = { x: 0, y: 0.5 };
        return payload([
          event('s', 'start', 'message', false, { x: 0, y: 16 }), task('t', { x: 108, y: 0 }, 'Antrag prüfen'), gateway('g', { x: 338, y: 8 }, '✕'), event('e', 'end', undefined, false, { x: 482, y: 16 }),
          link('l1', { x: 48, y: 40 }, { x: 108, y: 40 }, { end: 'solid-arrow', from: { id: 's', anchor: right }, to: { id: 't', anchor: left } }),
          link('l2', { x: 258, y: 40 }, { x: 338, y: 40 }, { end: 'solid-arrow', from: { id: 't', anchor: right }, to: { id: 'g', anchor: left } }),
          link('l3', { x: 402, y: 40 }, { x: 482, y: 40 }, { end: 'solid-arrow', from: { id: 'g', anchor: right }, to: { id: 'e', anchor: left } }),
        ]);
      },
    },
  ],
};

const fragment = (operator: FragmentOperator, label: string, sections: readonly string[] = []): ElementClipboardPayload =>
  payload(sequenceFragmentElements('s', { x: 0, y: 0, width: 420, height: sections.length ? 200 : 140 }, operator, label, sections));

function sequenceExample(): ElementClipboardPayload {
  return payload(buildSequence({
    autonumber: false,
    participants: [{ id: 'a', name: 'Client', actor: false }, { id: 'b', name: 'Dienst', actor: false }],
    items: [
      { type: 'message', id: 'm1', from: 'a', to: 'b', text: 'Anfrage', kind: 'sync' },
      { type: 'message', id: 'm2', from: 'b', to: 'a', text: 'Antwort', kind: 'reply' },
    ],
  }));
}

const sequence: DiagramLibrary = {
  id: 'sequence',
  name: L('Sequenzdiagramme'),
  description: L('Lebenslinien, Nachrichten und Fragmente'),
  templates: [
    { id: 'sequence.example', name: L('Beispiel: Anfrage und Antwort'), section: L('Start'), keywords: 'example beispiel request response', build: sequenceExample },
    { id: 'sequence.lifeline', name: L('Lebenslinie'), section: L('Start'), keywords: 'lifeline participant teilnehmer achse', build: () => payload(sequenceLifeline('a', { x: 0, y: 0 }, 'Teilnehmer')) },
    { id: 'sequence.actor', name: L('Akteur'), section: L('Start'), keywords: 'actor akteur person user benutzer strichmännchen', build: () => payload(sequenceLifeline('a', { x: 0, y: 0 }, 'Akteur', SEQUENCE_LIFELINE.height, true)) },
    { id: 'sequence.message', name: L('Nachricht'), section: L('Nachrichten'), keywords: 'message synchronous synchron call aufruf', build: () => payload([freeSequenceMessage('l', 'Nachricht', 'sync')]) },
    { id: 'sequence.async', name: L('Asynchrone Nachricht'), section: L('Nachrichten'), keywords: 'message asynchronous asynchron', build: () => payload([freeSequenceMessage('l', 'Nachricht', 'async')]) },
    { id: 'sequence.reply', name: L('Antwort'), section: L('Nachrichten'), keywords: 'reply return response rückgabe', build: () => payload([freeSequenceMessage('l', 'Antwort', 'reply')]) },
    { id: 'sequence.loop', name: L('Schleife (loop)'), section: L('Fragmente'), keywords: 'loop schleife wiederholung fragment', build: () => fragment('loop', 'Bedingung') },
    { id: 'sequence.alt', name: L('Alternative (alt)'), section: L('Fragmente'), keywords: 'alt else alternative sonst fragment if', build: () => fragment('alt', 'Bedingung', ['sonst']) },
    { id: 'sequence.opt', name: L('Optional (opt)'), section: L('Fragmente'), keywords: 'opt optional fragment', build: () => fragment('opt', 'Bedingung') },
    { id: 'sequence.par', name: L('Parallel (par)'), section: L('Fragmente'), keywords: 'par parallel and gleichzeitig fragment', build: () => fragment('par', 'Erster Ablauf', ['Zweiter Ablauf']) },
    { id: 'sequence.critical', name: L('Kritischer Bereich (critical)'), section: L('Fragmente'), keywords: 'critical kritisch option fragment', build: () => fragment('critical', 'Aktion', ['Fehlerfall']) },
    { id: 'sequence.break', name: L('Abbruch (break)'), section: L('Fragmente'), keywords: 'break abbruch ausnahme exception fragment', build: () => fragment('break', 'Bedingung') },
    { id: 'sequence.rect', name: L('Hervorhebung (rect)'), section: L('Fragmente'), keywords: 'rect highlight hervorhebung hintergrund background', build: () => fragment('rect', '') },
    { id: 'sequence.note', name: L('Notiz'), section: L('Weitere'), keywords: 'note notiz anmerkung hinweis', build: () => payload([sequenceNoteElement('s', { x: 0, y: 0, width: 180, height: 40 }, 'Notiz')]) },
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

import { t } from '@/renderer/i18n';
import { BPMN_ACTIVITY_TYPES, BPMN_EVENT_TYPES } from './diagram-libraries';
import type { FlowDirection, FlowEdgeKind, FlowGroup, FlowModel, FlowNode, FlowShape } from './flow-model';
import type { SequenceCodeDiagnostic } from './sequence-code';

/**
 * A process as text (#206), in the notation of a Mermaid `flowchart`. Mermaid has no BPMN diagram, so the
 * BPMN meaning rides on what a flowchart has:
 *
 *     flowchart LR
 *         subgraph p1 [Bestellung]
 *             subgraph l1 [Vertrieb]
 *                 e1(( )):::start-message
 *                 t1(Antrag prüfen):::user-task
 *                 g1{X}
 *             end
 *         end
 *         e1 --> t1
 *         t1 -->|vollständig| g1
 *
 * - `((text))` is an event; its class says which (`start`, `timer`, `end-error`, … as in the library).
 * - `(text)` is a task; its class says which kind (`user-task`, `service-task`, `subprocess`, …).
 * - `{X}`, `{+}`, `{O}`, `{*}` are the exclusive, parallel, inclusive and event-based gateway; any other
 *   text in braces is a decision with that text.
 * - `[(text)]` is a data store, `[/text/]` a data object, `[text]` a plain box, `([text])` a rounded one.
 * - `subgraph` is a pool, a `subgraph` in it a lane.
 * - `-->` is a sequence flow, `-.->` a message flow, `-.-` an association, `---` a plain line; a text goes
 *   in `-->|text|`.
 */
const INDENT = '    ';
const SYMBOL_TO_CODE: Readonly<Record<string, string>> = Object.freeze({ '✕': 'X', '×': 'X', '○': 'O', '⬠': '*' });
const CODE_TO_SYMBOL: Readonly<Record<string, string>> = Object.freeze({ X: '✕', x: '✕', O: '○', o: '○', '*': '⬠' });
const BRACKETS: Readonly<Record<FlowShape, readonly [string, string]>> = Object.freeze({
  event: ['((', '))'], task: ['(', ')'], gateway: ['{', '}'], store: ['[(', ')]'], data: ['[/', '/]'], box: ['[', ']'], round: ['([', '])'],
});
const ARROWS: Readonly<Record<FlowEdgeKind, string>> = Object.freeze({ flow: '-->', message: '-.->', association: '-.-', line: '---' });
const PLAIN = /^[\p{L}\p{N} _.,:;!?%+*–-]*$/u;
/** A text as it stands in the code: as it is where that is safe, in quotes otherwise. */
function written(text: string): string {
  const flat = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).join('<br/>');
  if (!flat) return ' ';
  return PLAIN.test(flat) && flat === flat.trim() ? flat : `"${flat.replace(/"/g, '#quot;')}"`;
}
const read = (text: string): string => {
  const trimmed = text.trim();
  const bare = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
  return bare.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n').trim();
};

/** The code of a process. */
export function flowToCode(model: FlowModel): string {
  const lines = [`flowchart ${model.direction}`];
  const node = (entry: FlowNode, pad: string): string => {
    const [open, close] = BRACKETS[entry.shape];
    const text = entry.shape === 'gateway' ? SYMBOL_TO_CODE[entry.text] ?? written(entry.text) : written(entry.text);
    return `${pad}${entry.id}${open}${text}${close}${entry.type ? `:::${entry.type}` : ''}`;
  };
  const group = (entry: FlowGroup, depth: number): void => {
    const pad = INDENT.repeat(depth);
    lines.push(`${pad}subgraph ${entry.id} [${written(entry.text)}]`);
    for (const inner of model.groups.filter((other) => other.parent === entry.id)) group(inner, depth + 1);
    for (const inner of model.nodes.filter((other) => other.group === entry.id)) lines.push(node(inner, INDENT.repeat(depth + 1)));
    lines.push(`${pad}end`);
  };
  for (const entry of model.groups.filter((other) => !other.parent)) group(entry, 1);
  for (const entry of model.nodes.filter((other) => !other.group)) lines.push(node(entry, INDENT));
  for (const edge of model.edges) lines.push(`${INDENT}${edge.from} ${ARROWS[edge.kind]}${edge.text ? `|${written(edge.text)}|` : ''} ${edge.to}`);
  return `${lines.join('\n')}\n`;
}

const ID = /^[\p{L}_][\p{L}\p{N}_]*(?:-[\p{L}\p{N}_]+)*/u;
/** Brackets of a node, longest first; `shape` null marks a Mermaid shape that has no meaning here and is read as a box. */
const OPENERS: ReadonlyArray<readonly [string, string, FlowShape | null, string | null]> = [
  ['(((', ')))', 'event', 'intermediate'], ['((', '))', 'event', null], ['([', '])', 'round', null], ['[(', ')]', 'store', null], ['[[', ']]', 'task', 'subprocess'],
  ['[/', '/]', 'data', null], ['[/', '\\]', null, null], ['[\\', '\\]', null, null], ['[\\', '/]', null, null], ['{{', '}}', null, null],
  ['{', '}', 'gateway', null], ['(', ')', 'task', null], ['[', ']', 'box', null], ['>', ']', 'data', null],
];
/** Links: `kind` by the line, a text either between bars after the arrow or inside the line. */
const LINKS: ReadonlyArray<readonly [RegExp, FlowEdgeKind]> = [
  [/^--\s+(?!-)(.+?)\s+--+>/, 'flow'], [/^==\s+(?!=)(.+?)\s+==+>/, 'flow'], [/^-\.\s+(.+?)\s+\.-+>/, 'message'],
  [/^--\s+(?!-)(.+?)\s+--+-(?!>)/, 'line'], [/^-\.\s+(.+?)\s+\.-+(?!>)/, 'association'],
  [/^--+>()/, 'flow'], [/^==+>()/, 'flow'], [/^-\.+->()/, 'message'], [/^--+[ox]()/, 'flow'], [/^-\.+-()/, 'association'], [/^--+-()/, 'line'], [/^==+=()/, 'line'],
];

export interface ParsedFlow { model: FlowModel; diagnostics: SequenceCodeDiagnostic[] }

/** Reads code into a model. With an error among the diagnostics the model is not to be used. */
export function parseFlowCode(code: string): ParsedFlow {
  const diagnostics: SequenceCodeDiagnostic[] = [];
  const model: FlowModel = { direction: 'LR', groups: [], nodes: [], edges: [] };
  const nodes = new Map<string, FlowNode>();
  const groups = new Map<string, FlowGroup>();
  const open: Array<{ id: string; line: number }> = [];
  const hinted = new Set<string>();
  const hint = (line: number, key: string, message: string): void => { if (!hinted.has(key)) { hinted.add(key); diagnostics.push({ line, severity: 'hint', message }); } };
  const fail = (line: number, message: string): void => { diagnostics.push({ line, severity: 'error', message }); };
  let serial = 0;
  let started = false;

  /** A node at the start of `text`: its id and what the brackets and the class say; `rest` is what follows. */
  const node = (text: string, line: number): { id: string; rest: string } | null => {
    const id = ID.exec(text)?.[0];
    if (!id) return null;
    let rest = text.slice(id.length);
    let shape: FlowShape | undefined;
    let type: string | null = null;
    let label: string | undefined;
    const opener = OPENERS.find(([start]) => rest.startsWith(start));
    if (opener) {
      const [start, end, shapeOf, typeOf] = opener;
      const inner = rest.slice(start.length);
      const quoted = inner.trimStart().startsWith('"');
      const from = quoted ? inner.indexOf('"', inner.indexOf('"') + 1) : -1;
      const close = inner.indexOf(end, quoted && from >= 0 ? from + 1 : 0);
      if (close < 0) { fail(line, t('Die Klammer von „{id}“ wird nicht geschlossen.', { id })); return null; }
      label = read(inner.slice(0, close));
      rest = inner.slice(close + end.length);
      if (!shapeOf) hint(line, `shape${start}`, t('Die Form „{open}…{close}“ gibt es hier nicht; sie wird als Kasten gelesen.', { open: start, close: end }));
      shape = shapeOf ?? 'box';
      type = typeOf;
    }
    const tagged = /^:::([\p{L}\p{N}_-]+)/u.exec(rest);
    if (tagged) {
      rest = rest.slice(tagged[0].length);
      const name = tagged[1]!;
      const known = shape === 'event' ? Boolean(BPMN_EVENT_TYPES[name]) : shape === 'task' ? Boolean(BPMN_ACTIVITY_TYPES[name]) : false;
      if (known) type = name === 'task' ? null : name;
      else if (shape === 'event' || shape === 'task') fail(line, t('Die Art „{name}“ gibt es für diese Form nicht.', { name }));
      else hint(line, `class${name}`, t('Klassen haben nur an Ereignissen „((…))“ und Aufgaben „(…)“ eine Bedeutung; „{name}“ wird übergangen.', { name }));
    }
    const known = nodes.get(id);
    if (groups.has(id)) { fail(line, t('„{id}“ ist ein Pool oder eine Bahn und kann kein Knoten sein.', { id })); return null; }
    if (!known) {
      const text = label === undefined ? id : shape === 'gateway' ? CODE_TO_SYMBOL[label] ?? label : label;
      const made: FlowNode = { id, shape: shape ?? 'box', type: shape === 'event' ? type ?? 'start' : type, text, group: open.at(-1)?.id ?? null };
      nodes.set(id, made);
      model.nodes.push(made);
    } else if (shape) {
      // A later mention with brackets describes the node again.
      known.shape = shape;
      known.type = shape === 'event' ? type ?? 'start' : type;
      known.text = shape === 'gateway' ? CODE_TO_SYMBOL[label ?? ''] ?? label ?? '' : label ?? '';
    }
    return { id, rest };
  };

  code.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim().replace(/;$/, '').trim();
    if (!text || text.startsWith('%%')) return;
    const word = text.split(/\s+/)[0]!.toLowerCase();
    const rest = text.slice(word.length).trim();
    if (!started) {
      started = true;
      if (word === 'flowchart' || word === 'graph') {
        const direction = rest.toUpperCase();
        if (direction && !['LR', 'RL', 'TD', 'TB', 'BT'].includes(direction)) fail(line, t('Unbekannte Richtung „{direction}“. Möglich sind LR und TD.', { direction: rest }));
        model.direction = (direction === 'TD' || direction === 'TB' || direction === 'BT' ? 'TD' : 'LR') as FlowDirection;
        return;
      }
    }
    if (word === 'subgraph') {
      const match = /^([\p{L}_][\p{L}\p{N}_-]*)\s*\[(.*)\]$/u.exec(rest);
      const id = match ? match[1]! : ID.exec(rest)?.[0] === rest ? rest : `sub${serial += 1}`;
      const title = match ? read(match[2]!) : read(rest);
      if (!rest) { fail(line, t('Hier fehlt der Name des Pools oder der Bahn.')); open.push({ id: `sub${serial += 1}`, line }); return; }
      if (groups.has(id) || nodes.has(id)) { fail(line, t('Der Name „{id}“ ist schon vergeben.', { id })); open.push({ id, line }); return; }
      if (open.length >= 2) hint(line, 'nesting', t('Bahnen lassen sich nicht weiter unterteilen; tiefere Ebenen werden als Bahnen desselben Pools gelesen.'));
      const group: FlowGroup = { id, text: title, parent: open.length ? open[Math.min(open.length, 1) - 1]!.id : null };
      groups.set(id, group);
      model.groups.push(group);
      open.push({ id, line });
      return;
    }
    if (word === 'end' && !rest) { if (!open.pop()) fail(line, t('„end“ ohne offenen Block.')); return; }
    if (word === 'direction') return;
    if (['classdef', 'class', 'style', 'linkstyle', 'click'].includes(word)) { hint(line, word, t('„{word}“ wird nicht unterstützt und übergangen.', { word })); return; }
    if (text.includes('&')) { fail(line, t('Mehrere Knoten mit „&“ werden nicht unterstützt. Schreibe jeden Pfeil in eine eigene Zeile.')); return; }

    // A statement: a node, or a chain of nodes joined by links.
    let at = node(text, line);
    if (!at) { if (!diagnostics.some((entry) => entry.line === line && entry.severity === 'error')) fail(line, t('Zeile nicht verstanden: {text}', { text: text.length > 60 ? `${text.slice(0, 60)}…` : text })); return; }
    for (let guard = 0; guard < 64; guard += 1) {
      const after = at.rest.trimStart();
      if (!after) return;
      const link = LINKS.map(([pattern, kind]) => ({ match: pattern.exec(after), kind })).find((entry) => entry.match);
      if (!link?.match) { fail(line, t('Nach „{id}“ wird ein Pfeil erwartet, zum Beispiel -->.', { id: at.id })); return; }
      if (/[ox]$/.test(link.match[0]) && !link.match[1]) hint(line, 'ends', t('Pfeilenden mit Kreis oder Kreuz werden als normaler Pfeil gelesen.'));
      let tail = after.slice(link.match[0].length).trimStart();
      let label = link.match[1] ?? '';
      // A text between bars; in quotes it may contain a bar itself.
      const bars = /^\|\s*("[^"]*")\s*\|/.exec(tail) ?? /^\|([^|]*)\|/.exec(tail);
      if (bars) { label = bars[1]!; tail = tail.slice(bars[0].length).trimStart(); }
      const target = node(tail, line);
      if (!target) { if (!diagnostics.some((entry) => entry.line === line && entry.severity === 'error')) fail(line, t('Nach dem Pfeil fehlt der Knoten, zu dem er führt.')); return; }
      model.edges.push({ from: at.id, to: target.id, text: read(label), kind: link.kind });
      at = target;
    }
  });
  for (const entry of open) fail(entry.line, t('Dieser Block wird nicht mit „end“ geschlossen.'));
  if (!model.nodes.length) fail(1, t('Ein Ablauf braucht mindestens einen Knoten.'));
  return { model, diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}

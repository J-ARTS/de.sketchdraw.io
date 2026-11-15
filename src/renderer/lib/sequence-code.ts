import { t } from '@/renderer/i18n';
import {
  FRAGMENT_FILL, FRAGMENT_OPERATORS, FRAGMENT_SECTION_KEYWORD,
  type FragmentOperator, type SequenceFragment, type SequenceItem, type SequenceMessage, type SequenceMessageKind, type SequenceModel, type SequenceNote, type SequenceNoteSide,
} from './sequence-model';

/**
 * A sequence diagram as text (#200), in the notation of Mermaid's `sequenceDiagram`, so a diagram can be read,
 * copied and changed as code:
 *
 *     sequenceDiagram
 *         autonumber
 *         actor K as Kunde
 *         participant Shop
 *         K->>Shop: bestellen
 *         alt lieferbar
 *             Shop-->>K: Bestätigung
 *         else
 *             Shop-->>K: Absage
 *         end
 *
 * Supported: participants and actors with aliases, the arrows `->>` (call), `-)` (asynchronous) and `-->>`
 * (reply), calls to oneself, `autonumber`, notes, and the blocks loop, alt/else, opt, par/and,
 * critical/option, break and rect. Activations follow from calls and replies, so `activate`, `deactivate`
 * and the `+`/`-` marks are read but not needed. What Mermaid knows beyond that is reported, not dropped
 * silently.
 */
export interface SequenceCodeDiagnostic { line: number; message: string; severity: 'error' | 'hint' }
/** A parsed diagram; participants are named by the keys the code uses for them. */
export interface ParsedSequence { model: SequenceModel; diagnostics: SequenceCodeDiagnostic[] }

const INDENT = '    ';
const RESERVED = new Set(['end', 'loop', 'alt', 'else', 'opt', 'par', 'and', 'critical', 'option', 'break', 'rect', 'note', 'participant', 'actor', 'autonumber', 'activate', 'deactivate', 'box', 'create', 'destroy', 'link', 'links', 'title']);
const ARROW: Readonly<Record<SequenceMessageKind, string>> = Object.freeze({ sync: '->>', async: '-)', reply: '-->>' });
const oneLine = (text: string): string => text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim()).join('<br/>');
const manyLines = (text: string): string => text.replace(/<br\s*\/?>/gi, '\n').trim();

/** Short names for the participants, as the code refers to them: the name itself where it is a plain word. */
function codeKeys(model: SequenceModel): Map<string, string> {
  const keys = new Map<string, string>();
  const taken = new Set<string>();
  for (const participant of model.participants) {
    let key = participant.name.normalize('NFKD').replace(/[^A-Za-z0-9_]/g, '');
    if (!key || /^[0-9]/.test(key) || RESERVED.has(key.toLowerCase())) key = `T${key}`;
    let unique = key;
    for (let index = 2; taken.has(unique.toLowerCase()); index += 1) unique = `${key}${index}`;
    taken.add(unique.toLowerCase());
    keys.set(participant.id, unique);
  }
  return keys;
}

/** The code of a diagram. */
export function sequenceToCode(model: SequenceModel): string {
  const keys = codeKeys(model);
  const lines = ['sequenceDiagram'];
  if (model.autonumber) lines.push(`${INDENT}autonumber`);
  for (const participant of model.participants) {
    const key = keys.get(participant.id)!;
    const name = oneLine(participant.name);
    lines.push(`${INDENT}${participant.actor ? 'actor' : 'participant'} ${key}${name === key ? '' : ` as ${name}`}`);
  }
  const write = (items: readonly SequenceItem[], depth: number): void => {
    const pad = INDENT.repeat(depth);
    for (const item of items) {
      if (item.type === 'message') lines.push(`${pad}${keys.get(item.from)}${ARROW[item.kind]}${keys.get(item.to)}: ${oneLine(item.text)}`.trimEnd());
      else if (item.type === 'note') {
        const where = item.side === 'over' ? `over ${keys.get(item.from)}${item.to === item.from ? '' : `,${keys.get(item.to)}`}` : `${item.side} of ${keys.get(item.from)}`;
        lines.push(`${pad}Note ${where}: ${oneLine(item.text)}`.trimEnd());
      } else {
        const start = item.operator === 'rect' ? item.fill ?? FRAGMENT_FILL : oneLine(item.sections[0]!.label);
        lines.push(`${pad}${item.operator} ${start}`.trimEnd());
        item.sections.forEach((section, index) => {
          if (index > 0) lines.push(`${pad}${FRAGMENT_SECTION_KEYWORD[item.operator] ?? 'else'} ${oneLine(section.label)}`.trimEnd());
          write(section.items, depth + 1);
        });
        lines.push(`${pad}end`);
      }
    }
  };
  write(model.items, 1);
  return `${lines.join('\n')}\n`;
}

const MESSAGE = /^([^:]*?)\s*(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->)\s*([+-]?)\s*([^:]*?)\s*(?::\s?(.*))?$/;
const KIND_OF_ARROW: Readonly<Record<string, SequenceMessageKind>> = Object.freeze({
  '->>': 'sync', '->': 'sync', '-x': 'sync', '<<->>': 'sync', '-)': 'async', '-->>': 'reply', '-->': 'reply', '--x': 'reply', '--)': 'reply', '<<-->>': 'reply',
});
const COLOUR = /^(rgba?|hsla?)\([^()]*\)$/i;

/**
 * Reads code into a model. The ids in the model are the keys of the code for participants and running
 * numbers for everything else; `reconcileSequence` maps them onto the elements of an existing diagram.
 * With an error among the diagnostics the model is not to be used.
 */
export function parseSequenceCode(code: string): ParsedSequence {
  const diagnostics: SequenceCodeDiagnostic[] = [];
  const model: SequenceModel = { participants: [], items: [], autonumber: false };
  const known = new Map<string, string>();
  let serial = 0;
  const nextId = (prefix: string): string => `${prefix}${serial += 1}`;
  const participant = (key: string, line: number, name?: string, actor = false): string | null => {
    const clean = key.trim();
    if (!clean) { diagnostics.push({ line, severity: 'error', message: t('Hier fehlt der Name eines Teilnehmers.') }); return null; }
    const id = known.get(clean);
    if (id) {
      if (name !== undefined) diagnostics.push({ line, severity: 'error', message: t('Der Teilnehmer „{name}“ ist schon weiter oben angelegt.', { name: clean }) });
      return id;
    }
    known.set(clean, clean);
    model.participants.push({ id: clean, name: manyLines(name ?? clean), actor });
    return clean;
  };
  /** Open blocks, innermost last; a `box` only groups participants and adds nothing to the diagram. */
  const open: Array<{ fragment: SequenceFragment | null; line: number }> = [];
  const target = (): SequenceItem[] => { const inner = [...open].reverse().find((entry) => entry.fragment); return inner ? inner.fragment!.sections.at(-1)!.items : model.items; };
  const hinted = new Set<string>();
  const hint = (line: number, key: string, message: string): void => { if (!hinted.has(key)) { hinted.add(key); diagnostics.push({ line, severity: 'hint', message }); } };
  let started = false;

  code.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim().replace(/;$/, '').trim();
    if (!text || text.startsWith('%%')) return;
    if (!started) { started = true; if (/^sequenceDiagram$/i.test(text)) return; }
    const word = text.split(/\s+/)[0]!.toLowerCase();
    const rest = text.slice(word.length).trim();

    if (word === 'sequencediagram') return;
    if (word === 'autonumber') { model.autonumber = true; return; }
    if (word === 'participant' || word === 'actor') {
      if (/@\{/.test(rest)) hint(line, 'type', t('Teilnehmertypen (Angabe hinter @) werden nicht unterstützt und als einfache Teilnehmer gelesen.'));
      const [key, ...alias] = rest.replace(/@\{[^}]*\}/, '').split(/\s+as\s+/i);
      participant(key ?? '', line, alias.length ? alias.join(' as ') : key ?? '', word === 'actor');
      return;
    }
    if (word === 'note') {
      const match = /^(right of|left of|over)\s+([^:]+?)\s*(?::\s?(.*))?$/i.exec(rest);
      if (!match) { diagnostics.push({ line, severity: 'error', message: t('Notiz nicht verstanden. Erwartet: Note over A,B: Text') }); return; }
      const where = match[1]!.toLowerCase();
      const side: SequenceNoteSide = where === 'over' ? 'over' : where === 'right of' ? 'right' : 'left';
      const names = match[2]!.split(',').map((name) => name.trim()).filter(Boolean);
      const from = participant(names[0] ?? '', line);
      const to = side === 'over' && names[1] ? participant(names[1], line) : from;
      if (from && to) target().push({ type: 'note', id: nextId('note'), text: manyLines(match[3] ?? ''), side, from, to });
      return;
    }
    if ((FRAGMENT_OPERATORS as readonly string[]).includes(word)) {
      const operator = word as FragmentOperator;
      const colour = operator === 'rect' && COLOUR.test(rest) ? rest : undefined;
      if (operator === 'rect' && rest && !colour) hint(line, 'colour', t('Die Farbe einer Hervorhebung wird als rgb(…) oder rgba(…) erwartet; sie bekommt die Standardfarbe.'));
      const fragment: SequenceFragment = { type: 'fragment', id: nextId('fragment'), operator, ...(operator === 'rect' ? { fill: colour ?? FRAGMENT_FILL } : {}), sections: [{ id: null, label: operator === 'rect' ? '' : manyLines(rest), items: [] }] };
      target().push(fragment);
      open.push({ fragment, line });
      return;
    }
    if (word === 'else' || word === 'and' || word === 'option') {
      const inner = open.at(-1)?.fragment;
      if (!inner || FRAGMENT_SECTION_KEYWORD[inner.operator] !== word) {
        const owner = word === 'else' ? 'alt' : word === 'and' ? 'par' : 'critical';
        diagnostics.push({ line, severity: 'error', message: t('„{word}“ gehört in einen Block „{owner}“.', { word, owner }) });
        return;
      }
      inner.sections.push({ id: null, label: manyLines(rest), items: [] });
      return;
    }
    if (word === 'end') {
      if (!open.pop()) diagnostics.push({ line, severity: 'error', message: t('„end“ ohne offenen Block.') });
      return;
    }
    if (word === 'box') { hint(line, 'box', t('Gruppen von Teilnehmern (box) werden nicht unterstützt; die Teilnehmer darin bleiben erhalten.')); open.push({ fragment: null, line }); return; }
    if (word === 'activate' || word === 'deactivate') { hint(line, 'activate', t('Aktivierungen entstehen automatisch vom Aufruf bis zur Antwort; „activate“ und „deactivate“ werden nicht gebraucht.')); return; }
    if (['create', 'destroy', 'link', 'links', 'title', 'acctitle', 'accdescr'].includes(word)) { hint(line, word, t('„{word}“ wird nicht unterstützt und übergangen.', { word })); return; }

    const match = MESSAGE.exec(text);
    if (match) {
      const from = participant(match[1]!, line);
      const to = participant(match[4]!, line);
      if (['<<->>', '<<-->>', '->', '-->', '-x', '--x'].includes(match[2]!)) hint(line, `arrow${match[2]}`, t('Der Pfeil „{arrow}“ wird als „{read}“ gelesen.', { arrow: match[2]!, read: ARROW[KIND_OF_ARROW[match[2]!]!] }));
      if (from && to) target().push({ type: 'message', id: nextId('message'), from, to, text: manyLines(match[5] ?? ''), kind: KIND_OF_ARROW[match[2]!]! });
      return;
    }
    diagnostics.push({ line, severity: 'error', message: t('Zeile nicht verstanden: {text}', { text: text.length > 60 ? `${text.slice(0, 60)}…` : text }) });
  });
  for (const entry of open) diagnostics.push({ line: entry.line, severity: 'error', message: t('Dieser Block wird nicht mit „end“ geschlossen.') });
  if (!model.participants.length) diagnostics.push({ line: 1, severity: 'error', message: t('Ein Sequenzdiagramm braucht mindestens einen Teilnehmer.') });
  return { model, diagnostics: diagnostics.sort((a, b) => a.line - b.line) };
}

/**
 * The parsed model with the ids of the diagram it replaces, wherever a part can be recognised again: a
 * participant by its name, a message by its ends and text, a fragment by its operator and condition, a note
 * by its text. What is recognised keeps its element (and with it its colours); the rest is new.
 */
export function reconcileSequence(parsed: SequenceModel, current: SequenceModel, createId: (prefix: string) => string): SequenceModel {
  const flat = (items: readonly SequenceItem[]): SequenceItem[] => items.flatMap((item) => item.type === 'fragment' ? [item, ...item.sections.flatMap((section) => flat(section.items))] : [item]);
  /** Hands out the old parts that fit a key, each one once, in their order. */
  const pool = <T extends { id: string }>(olds: readonly T[], keyOf: (old: T) => string) => {
    const free = [...olds];
    return (key: string): T | undefined => { const index = free.findIndex((old) => keyOf(old) === key); return index < 0 ? undefined : free.splice(index, 1)[0]; };
  };

  // Participants: by name, then the ones left over in their order (a renamed participant keeps its lifeline).
  const byName = pool(current.participants, (old) => old.name);
  const matched = parsed.participants.map((participant) => byName(participant.name));
  const leftover = current.participants.filter((old) => !matched.includes(old));
  const ids = new Map<string, string>();
  const participants = parsed.participants.map((participant, index) => {
    const old = matched[index] ?? leftover.shift();
    const id = old?.id ?? createId('container');
    ids.set(participant.id, id);
    return { ...participant, id };
  });

  const oldItems = flat(current.items);
  const oldMessages = oldItems.filter((item): item is SequenceMessage => item.type === 'message');
  const oldNotes = oldItems.filter((item): item is SequenceNote => item.type === 'note');
  const oldFragments = oldItems.filter((item): item is SequenceFragment => item.type === 'fragment');
  const exactMessage = pool(oldMessages, (old) => `${old.from}>${old.to}:${old.text}`);
  const exactNote = pool(oldNotes, (old) => old.text);
  const exactFragment = pool(oldFragments, (old) => `${old.operator}:${old.sections[0]!.label}`);
  // First what is unchanged, then what only changed its text: two passes over the new items.
  const kept = new Map<SequenceItem, SequenceItem>();
  const newItems = flat(parsed.items);
  for (const item of newItems) {
    const old = item.type === 'message' ? exactMessage(`${ids.get(item.from)}>${ids.get(item.to)}:${item.text}`)
      : item.type === 'note' ? exactNote(item.text) : exactFragment(`${item.operator}:${item.sections[0]!.label}`);
    if (old) kept.set(item, old);
  }
  const used = new Set([...kept.values()].map((old) => old.id));
  const looseMessage = pool(oldMessages.filter((old) => !used.has(old.id)), (old) => `${old.from}>${old.to}`);
  const looseNote = pool(oldNotes.filter((old) => !used.has(old.id)), () => '');
  const looseFragment = pool(oldFragments.filter((old) => !used.has(old.id)), (old) => old.operator);
  for (const item of newItems) {
    if (kept.has(item)) continue;
    const old = item.type === 'message' ? looseMessage(`${ids.get(item.from)}>${ids.get(item.to)}`) : item.type === 'note' ? looseNote('') : looseFragment(item.operator);
    if (old) kept.set(item, old);
  }

  const convert = (items: readonly SequenceItem[]): SequenceItem[] => items.map((item) => {
    const old = kept.get(item);
    if (item.type === 'message') return { ...item, id: old?.id ?? createId('connector'), from: ids.get(item.from)!, to: ids.get(item.to)! };
    if (item.type === 'note') return { ...item, id: old?.id ?? createId('rectangle'), from: ids.get(item.from)!, to: ids.get(item.to)! };
    const before = old?.type === 'fragment' ? old : null;
    return { ...item, id: before?.id ?? createId('container'), sections: item.sections.map((section, index) => ({ id: index === 0 ? null : before?.sections[index]?.id ?? null, label: section.label, items: convert(section.items) })) };
  });
  return { autonumber: parsed.autonumber, participants, items: convert(parsed.items) };
}

import type { KeyInput, Tool } from '@/renderer/state/contract';

import { L, t } from '@/renderer/i18n';
export interface ToolDef { tool: Tool; label: string; key: string; description: string; shift?: boolean }

export const TOOL_DEFS: readonly ToolDef[] = [
  { tool: 'select', label: L('Auswahl'), key: 'v', description: L('Elemente auswählen, verschieben und in der Größe ändern') },
  { tool: 'hand', label: L('Hand'), key: 'h', description: L('Ansicht verschieben') },
  { tool: 'rectangle', label: L('Rechteck'), key: 'r', description: L('Rechteck aufziehen') },
  { tool: 'ellipse', label: L('Ellipse'), key: 'e', description: L('Ellipse aufziehen') },
  { tool: 'diamond', label: L('Raute'), key: 'd', description: L('Raute aufziehen') },
  { tool: 'connector', label: L('Verbindung'), key: 'l', description: L('Zwei Elemente mit einer Verbindung verknüpfen') },
  { tool: 'path', label: L('Freihand'), key: 'p', description: L('Frei zeichnen') },
  { tool: 'eraser', label: L('Radierer'), key: 'e', shift: true, description: L('Elemente durch Klicken oder Ziehen entfernen') },
  { tool: 'text', label: L('Text'), key: 't', description: L('Text einfügen') },
  { tool: 'table', label: L('Tabelle'), key: 't', shift: true, description: L('Formatierbare Tabelle einfügen') },
  { tool: 'sticky-note', label: L('Notiz'), key: 'n', description: L('Sticky Note einfügen') },
  { tool: 'annotation', label: L('Annotation'), key: 'a', description: L('Formatierbaren Textblock einfügen') },
  { tool: 'image', label: L('Bild'), key: 'b', description: L('Bild einfügen') },
  { tool: 'container', label: L('Container'), key: 'c', description: L('Container zum Gruppieren von Elementen aufziehen') },
  { tool: 'frame', label: L('Frame'), key: 'f', description: L('Präsentationsrahmen als Folie aufziehen') },
  { tool: 'web-embed', label: L('Web-Embed'), key: 'w', description: L('Webseite als eingebetteten Frame hinzufügen') },
  { tool: 'comment', label: L('Kommentar'), key: 'k', description: L('Kommentar an ein Element oder eine Tabellenzelle heften') },
  { tool: 'laser', label: L('Laserpointer'), key: 'k', shift: true, description: L('Temporär auf Bereiche der Zeichenfläche zeigen') },
];

export interface ShortcutDef {
  id: string;
  label: string;
  /** Display form with German key names; alternatives are separated by " / ". */
  combo: string;
  scope: 'global' | 'canvas' | 'text';
  group: string;
}

interface ModifierSpec { primary: boolean; shift: boolean | 'any'; alt: boolean }
type KeyTest = (input: KeyInput) => boolean;
type Alternative = readonly [ModifierSpec, KeyTest];
interface Binding { def: ShortcutDef; matches: (input: KeyInput, isMac: boolean) => boolean }

const NONE: ModifierSpec = { primary: false, shift: false, alt: false };
const NONE_ANY_SHIFT: ModifierSpec = { primary: false, shift: 'any', alt: false };
const SHIFT: ModifierSpec = { primary: false, shift: true, alt: false };
const ALT: ModifierSpec = { primary: false, shift: false, alt: true };
const ALT_SHIFT: ModifierSpec = { primary: false, shift: true, alt: true };
const PRIMARY: ModifierSpec = { primary: true, shift: false, alt: false };
const PRIMARY_SHIFT: ModifierSpec = { primary: true, shift: true, alt: false };
const PRIMARY_ANY_SHIFT: ModifierSpec = { primary: true, shift: 'any', alt: false };

/** Primary = Cmd on macOS, Ctrl elsewhere. The other one must not be held; AltGr (Ctrl+Alt) never matches. */
function modifiersMatch(input: KeyInput, isMac: boolean, spec: ModifierSpec): boolean {
  const primary = isMac ? input.metaKey : input.ctrlKey;
  const foreign = isMac ? input.ctrlKey : input.metaKey;
  if (foreign || primary !== spec.primary || input.altKey !== spec.alt) return false;
  return spec.shift === 'any' || input.shiftKey === spec.shift;
}

/** Layout-aware: matches event.key so QWERTZ Z/Y work; event.code only for layouts without Latin letters. */
function letterIs(letter: string): KeyTest {
  return (input) => {
    if (/^[a-z]$/i.test(input.key)) return input.key.toLowerCase() === letter;
    return input.code === `Key${letter.toUpperCase()}`;
  };
}

function keyIs(...keys: string[]): KeyTest {
  return (input) => keys.includes(input.key);
}

function codeIs(...codes: string[]): KeyTest {
  return (input) => codes.includes(input.code);
}

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

function bind(def: ShortcutDef, ...alternatives: Alternative[]): Binding {
  return {
    def,
    matches: (input, isMac) =>
      alternatives.some(([spec, test]) => modifiersMatch(input, isMac, spec) && test(input)),
  };
}

const TOOLS = L('Werkzeuge');
const EDIT = L('Bearbeiten');
const SELECTION = L('Auswahl und Bewegung');
const VIEW = L('Ansicht');
const FILE = L('Datei');
const GENERAL = L('Allgemein');
const TEXT_EDITING = L('Textbearbeitung');

const BINDINGS: readonly Binding[] = [
  ...TOOL_DEFS.map((tool) =>
    bind(
      { id: `tool.${tool.tool}`, label: tool.label, combo: `${tool.shift ? 'Umschalt+' : ''}${tool.key.toUpperCase()}`, scope: 'canvas', group: TOOLS },
      [tool.shift ? SHIFT : NONE, letterIs(tool.key)],
    ),
  ),
  bind({ id: 'file.open', label: L('Datei öffnen'), combo: 'Strg+O', scope: 'global', group: FILE }, [PRIMARY, letterIs('o')]),
  bind({ id: 'file.save', label: L('Speichern'), combo: 'Strg+S', scope: 'global', group: FILE }, [PRIMARY, letterIs('s')]),
  bind({ id: 'file.save-as', label: L('Speichern unter'), combo: 'Strg+Umschalt+S', scope: 'global', group: FILE }, [PRIMARY_SHIFT, letterIs('s')]),
  bind({ id: 'edit.undo', label: L('Rückgängig'), combo: 'Strg+Z', scope: 'global', group: EDIT }, [PRIMARY, letterIs('z')]),
  bind(
    { id: 'edit.redo', label: L('Wiederholen'), combo: 'Strg+Umschalt+Z / Strg+Y', scope: 'global', group: EDIT },
    [PRIMARY_SHIFT, letterIs('z')],
    [PRIMARY, letterIs('y')],
  ),
  bind({ id: 'edit.select-all', label: L('Alles auswählen'), combo: 'Strg+A', scope: 'global', group: EDIT }, [PRIMARY, letterIs('a')]),
  bind({ id: 'edit.copy', label: L('Auswahl kopieren'), combo: 'Strg+C', scope: 'global', group: EDIT }, [PRIMARY, letterIs('c')]),
  bind({ id: 'edit.paste', label: L('An Mausposition einfügen'), combo: 'Strg+V', scope: 'global', group: EDIT }, [PRIMARY, letterIs('v')]),
  bind({ id: 'edit.duplicate', label: L('Duplizieren'), combo: 'Strg+D', scope: 'global', group: EDIT }, [PRIMARY, letterIs('d')]),
  bind({ id: 'edit.group', label: L('In Container gruppieren'), combo: 'Strg+G', scope: 'global', group: EDIT }, [PRIMARY, letterIs('g')]),
  bind({ id: 'edit.ungroup', label: L('Gruppierung lösen'), combo: 'Strg+Umschalt+G', scope: 'global', group: EDIT }, [PRIMARY_SHIFT, letterIs('g')]),
  bind({ id: 'edit.delete', label: L('Löschen'), combo: 'Entf / Rücktaste', scope: 'canvas', group: EDIT }, [NONE, keyIs('Delete', 'Backspace')]),
  bind({ id: 'edit.text', label: L('Text bearbeiten'), combo: 'Enter', scope: 'canvas', group: EDIT }, [NONE, keyIs('Enter')]),
  bind(
    { id: 'move.nudge', label: L('Auswahl um 1 px verschieben (ohne Auswahl: Ansicht verschieben)'), combo: 'Pfeiltasten', scope: 'canvas', group: SELECTION },
    [NONE, keyIs(...ARROW_KEYS)],
  ),
  bind(
    { id: 'move.nudge-large', label: L('Auswahl um 10 px verschieben'), combo: 'Umschalt+Pfeiltasten', scope: 'canvas', group: SELECTION },
    [SHIFT, keyIs(...ARROW_KEYS)],
  ),
  bind(
    { id: 'select.neighbor', label: L('Benachbartes Element auswählen'), combo: 'Alt+Pfeiltasten', scope: 'canvas', group: SELECTION },
    [ALT, keyIs(...ARROW_KEYS)],
  ),
  bind({ id: 'select.next', label: L('Nächstes Element in Lesereihenfolge'), combo: 'Bild ab', scope: 'canvas', group: SELECTION }, [NONE, keyIs('PageDown')]),
  bind({ id: 'select.previous', label: L('Vorheriges Element in Lesereihenfolge'), combo: 'Bild auf', scope: 'canvas', group: SELECTION }, [NONE, keyIs('PageUp')]),
  bind(
    { id: 'view.zoom-in', label: L('Vergrößern'), combo: 'Strg+Plus', scope: 'global', group: VIEW },
    [PRIMARY_ANY_SHIFT, (input) => input.key === '+' || input.key === '=' || input.code === 'NumpadAdd'],
  ),
  bind(
    { id: 'view.zoom-out', label: L('Verkleinern'), combo: 'Strg+Minus', scope: 'global', group: VIEW },
    [PRIMARY_ANY_SHIFT, (input) => input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract'],
  ),
  bind(
    { id: 'view.zoom-reset', label: L('Zoom auf 100 %'), combo: 'Strg+0', scope: 'global', group: VIEW },
    [PRIMARY, (input) => input.key === '0' || input.code === 'Digit0' || input.code === 'Numpad0'],
  ),
  bind({ id: 'view.fit-all', label: L('Alles anzeigen'), combo: 'Umschalt+1', scope: 'canvas', group: VIEW }, [SHIFT, codeIs('Digit1')]),
  bind({ id: 'view.fit-selection', label: L('Zur Auswahl zoomen'), combo: 'Umschalt+2', scope: 'canvas', group: VIEW }, [SHIFT, codeIs('Digit2')]),
  bind({ id: 'view.objects', label: L('Objekte ein- oder ausblenden'), combo: 'O', scope: 'canvas', group: VIEW }, [NONE, letterIs('o')]),
  bind({ id: 'view.present', label: L('Frames präsentieren'), combo: 'Alt+Umschalt+P', scope: 'canvas', group: VIEW }, [ALT_SHIFT, letterIs('p')]),
  bind({ id: 'view.help', label: L('Tastaturhilfe anzeigen'), combo: '?', scope: 'canvas', group: VIEW }, [NONE_ANY_SHIFT, keyIs('?')]),
  bind(
    { id: 'cancel', label: L('Abbrechen, schließen, Auswahl aufheben'), combo: 'Esc', scope: 'global', group: GENERAL },
    [NONE_ANY_SHIFT, keyIs('Escape')],
  ),
  bind({ id: 'text.commit', label: L('Text übernehmen'), combo: 'Esc', scope: 'text', group: TEXT_EDITING }, [NONE_ANY_SHIFT, keyIs('Escape')]),
];

export const SHORTCUTS: readonly ShortcutDef[] = BINDINGS.map((binding) => binding.def);

/** Global shortcuts that still work while an editable control has focus; all others keep native text behavior. */
const TEXT_PASSTHROUGH: ReadonlySet<string> = new Set(['file.open', 'file.save', 'file.save-as']);

function scopeApplies(def: ShortcutDef, scope: KeyInput['scope']): boolean {
  switch (def.scope) {
    case 'canvas':
      return scope === 'canvas';
    case 'text':
      return scope === 'text';
    case 'global':
      return scope !== 'text' || TEXT_PASSTHROUGH.has(def.id);
  }
}

/** Returns the ShortcutDef.id for a key event, or null. Never fires during IME composition. */
export function resolveShortcut(input: KeyInput, isMac: boolean): string | null {
  if (input.isComposing || input.key === 'Process') return null;
  for (const binding of BINDINGS) {
    if (scopeApplies(binding.def, input.scope) && binding.matches(input, isMac)) return binding.def.id;
  }
  return null;
}

const MAC_MODIFIERS: ReadonlyArray<readonly [string, string]> = [
  ['Alt', '⌥'],
  ['Umschalt', '⇧'],
  ['Strg', '⌘'],
];
const MAC_KEY_NAMES: ReadonlyMap<string, string> = new Map([
  ['Plus', '+'],
  ['Minus', '−'],
  ['Rücktaste', '⌫'],
]);

function formatForMac(alternative: string): string {
  const tokens = alternative.split('+');
  const key = tokens.pop() ?? '';
  const modifiers = MAC_MODIFIERS.filter(([name]) => tokens.includes(name))
    .map(([, symbol]) => symbol)
    .join('');
  return `${modifiers}${MAC_KEY_NAMES.get(key) ?? t(key)}`;
}

/** Non-macOS: unchanged. macOS: modifier symbols in system order without separators, e.g. "Strg+Umschalt+Z" becomes "⇧⌘Z". */
export function formatCombo(combo: string, isMac: boolean): string {
  if (!isMac) {
    // Key names are stored in German ("Strg", "Umschalt"); other languages translate each token (Ctrl, Shift).
    return combo.split(' / ').map((alternative) => alternative.split('+').map((token) => t(token)).join('+')).join(' / ');
  }
  return combo.split(' / ').map(formatForMac).join(' / ');
}

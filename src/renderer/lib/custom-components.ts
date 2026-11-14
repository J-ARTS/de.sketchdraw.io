import { ref, type Ref } from 'vue';
import { parseElementClipboard, type ElementClipboardPayload } from '../state/element-clipboard';

/**
 * The user's own component library (#188). A component is a saved selection in the checked element clipboard
 * format, so it can hold several elements, their connectors, images and component sets, and inserting it is a
 * paste. The library belongs to this device, like the shape bar: it is stored in localStorage and is available
 * in every document. Inserted components are ordinary elements; a document never depends on the library.
 */
export const CUSTOM_COMPONENTS_STORAGE_KEY = 'sketchdraw.custom-components.v1';
export const CUSTOM_COMPONENT_DRAG_MIME = 'application/x-sketchdraw-custom-component';
export const CUSTOM_COMPONENT_LIMITS = Object.freeze({
  MAX_COMPONENTS: 200,
  MAX_NAME_LENGTH: 60,
  /** One component, as JSON. Images are what makes a component large. */
  MAX_COMPONENT_BYTES: 512 * 1024,
  /** The whole library; localStorage holds about 5 MiB for everything the app keeps there. */
  MAX_LIBRARY_BYTES: 4 * 1024 * 1024,
});

export interface CustomComponent {
  id: string;
  name: string;
  payload: ElementClipboardPayload;
}

export type CustomComponentFailure = 'empty' | 'too-large' | 'library-full' | 'storage';
export type CustomComponentResult = { ok: true; component: CustomComponent } | { ok: false; reason: CustomComponentFailure };

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const defaultStorage = (): StorageLike | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);

/** One line without control characters, at most MAX_NAME_LENGTH long; empty when nothing readable is left. */
export function normalizeComponentName(name: string): string {
  const line = name.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(line).slice(0, CUSTOM_COMPONENT_LIMITS.MAX_NAME_LENGTH).join('').trim();
}

/** Stored text is untrusted: every entry is checked like clipboard text, and broken entries are dropped. */
export function validateCustomComponents(value: unknown): CustomComponent[] {
  if (!Array.isArray(value)) return [];
  const result: CustomComponent[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (result.length >= CUSTOM_COMPONENT_LIMITS.MAX_COMPONENTS) break;
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 128 || ids.has(entry.id) || typeof entry.name !== 'string') continue;
    const name = normalizeComponentName(entry.name);
    let text: string;
    try { text = JSON.stringify(entry.payload); } catch { continue; }
    if (!name || typeof text !== 'string' || byteLength(text) > CUSTOM_COMPONENT_LIMITS.MAX_COMPONENT_BYTES) continue;
    const payload = parseElementClipboard(text);
    if (!payload) continue;
    ids.add(entry.id);
    result.push({ id: entry.id, name, payload });
  }
  return result;
}

export function loadCustomComponents(storage: StorageLike | undefined = defaultStorage()): CustomComponent[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CUSTOM_COMPONENTS_STORAGE_KEY);
    if (!raw || byteLength(raw) > CUSTOM_COMPONENT_LIMITS.MAX_LIBRARY_BYTES * 2) return [];
    const parsed = JSON.parse(raw) as { version?: unknown; components?: unknown };
    return isRecord(parsed) && parsed.version === 1 ? validateCustomComponents(parsed.components) : [];
  } catch {
    return [];
  }
}

function serialize(components: readonly CustomComponent[]): string {
  return JSON.stringify({ version: 1, components });
}

export interface CustomComponentState {
  components: Ref<CustomComponent[]>;
  /** Which tab of the library is shown; shared so that saving a component can lead there. */
  tab: Ref<'shapes' | 'custom'>;
  /** The component whose name is being edited in the library, if any. */
  renamingId: Ref<string | null>;
  add(name: string, payload: ElementClipboardPayload | null, createId: () => string): CustomComponentResult;
  rename(id: string, name: string): boolean;
  remove(id: string): boolean;
  get(id: string): CustomComponent | undefined;
  /** A free name of the form "<base> 2", "<base> 3" …; `base` itself when it is unused. */
  uniqueName(base: string): string;
  /** The first free name of the form "<base> 1", "<base> 2" …, for components without a caption of their own. */
  numberedName(base: string): string;
  /** Reads the library again, e.g. after another window changed it. */
  reload(): void;
}

export function createCustomComponentState(storage: StorageLike | undefined = defaultStorage()): CustomComponentState {
  const components = ref<CustomComponent[]>(loadCustomComponents(storage));
  const tab = ref<'shapes' | 'custom'>('shapes');
  const renamingId = ref<string | null>(null);

  /** Without storage (tests, private mode without access) the library lives for the session only. */
  function persist(next: CustomComponent[]): boolean {
    if (storage) {
      try { storage.setItem(CUSTOM_COMPONENTS_STORAGE_KEY, serialize(next)); } catch { return false; }
    }
    components.value = next;
    return true;
  }

  function uniqueName(base: string): string {
    const taken = new Set(components.value.map((component) => component.name.toLocaleLowerCase()));
    if (!taken.has(base.toLocaleLowerCase())) return base;
    for (let index = 2; ; index += 1) {
      const suffix = ` ${index}`;
      const candidate = `${Array.from(base).slice(0, CUSTOM_COMPONENT_LIMITS.MAX_NAME_LENGTH - suffix.length).join('').trim()}${suffix}`;
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
  }

  return {
    components,
    tab,
    renamingId,
    add(name, payload, createId) {
      const text = payload ? JSON.stringify(payload) : '';
      // The same check as on load, so that nothing is stored that a restart would drop.
      const checked = text ? parseElementClipboard(text) : null;
      const cleanName = normalizeComponentName(name);
      if (!checked || !cleanName) return { ok: false, reason: 'empty' };
      if (byteLength(text) > CUSTOM_COMPONENT_LIMITS.MAX_COMPONENT_BYTES) return { ok: false, reason: 'too-large' };
      if (components.value.length >= CUSTOM_COMPONENT_LIMITS.MAX_COMPONENTS) return { ok: false, reason: 'library-full' };
      const component: CustomComponent = { id: createId(), name: uniqueName(cleanName), payload: checked };
      const next = [component, ...components.value];
      if (byteLength(serialize(next)) > CUSTOM_COMPONENT_LIMITS.MAX_LIBRARY_BYTES) return { ok: false, reason: 'library-full' };
      return persist(next) ? { ok: true, component } : { ok: false, reason: 'storage' };
    },
    rename(id, name) {
      const cleanName = normalizeComponentName(name);
      const current = components.value.find((component) => component.id === id);
      if (!current || !cleanName) return false;
      if (current.name === cleanName) return true;
      return persist(components.value.map((component) => (component.id === id ? { ...component, name: cleanName } : component)));
    },
    remove(id) {
      if (!components.value.some((component) => component.id === id)) return false;
      if (renamingId.value === id) renamingId.value = null;
      return persist(components.value.filter((component) => component.id !== id));
    },
    get(id) { return components.value.find((component) => component.id === id); },
    uniqueName,
    numberedName(base) {
      const taken = new Set(components.value.map((component) => component.name.toLocaleLowerCase()));
      for (let index = 1; ; index += 1) {
        const candidate = `${base} ${index}`;
        if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
      }
    },
    reload() { components.value = loadCustomComponents(storage); },
  };
}

let shared: CustomComponentState | null = null;

/** The one library of this window. */
export function useCustomComponents(): CustomComponentState {
  if (!shared) {
    const state = createCustomComponentState();
    shared = state;
    // Another window of the app saved, renamed or deleted a component.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => { if (event.key === CUSTOM_COMPONENTS_STORAGE_KEY || event.key === null) state.reload(); });
    }
  }
  return shared;
}

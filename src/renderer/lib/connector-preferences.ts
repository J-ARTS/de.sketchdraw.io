import type { ConnectorMarker, ConnectorRouting } from '@/domain';

export const CONNECTOR_PREFERENCES_KEY = 'sketchdraw.connector-defaults.v1';

/** Line type and arrowhead used for every newly drawn connector until the user changes them. */
export interface ConnectorDefaults {
  routing: ConnectorRouting;
  endMarker: ConnectorMarker;
}

/** New connectors are right-angled ("rechtwinklig") with a line arrowhead unless the user chose otherwise. */
export const DEFAULT_CONNECTOR_DEFAULTS: Readonly<ConnectorDefaults> = { routing: 'elbowed', endMarker: 'line-arrow' };

export const CONNECTOR_ROUTING_OPTIONS: ReadonlyArray<{ value: ConnectorRouting; label: string }> = [
  { value: 'elbowed', label: 'Rechtwinklig' }, { value: 'curved', label: 'Gebogen' }, { value: 'straight', label: 'Gerade' },
];
export const CONNECTOR_END_MARKER_OPTIONS: ReadonlyArray<{ value: ConnectorMarker; label: string }> = [
  { value: 'none', label: 'Keine' }, { value: 'line-arrow', label: 'Linienpfeil' },
  { value: 'solid-arrow', label: 'Gefüllter Pfeil' }, { value: 'triangle', label: 'Dreieck' },
  { value: 'solid-triangle', label: 'Gefülltes Dreieck' }, { value: 'circle', label: 'Kreis' },
  { value: 'solid-circle', label: 'Gefüllter Kreis' }, { value: 'diamond', label: 'Raute' },
];

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
const browserStorage = (): StorageLike | undefined => (typeof localStorage === 'undefined' ? undefined : localStorage);
const routings = new Set<string>(CONNECTOR_ROUTING_OPTIONS.map((option) => option.value));
const markers = new Set<string>(CONNECTOR_END_MARKER_OPTIONS.map((option) => option.value));

export function loadConnectorDefaults(storage: StorageLike | undefined = browserStorage()): ConnectorDefaults {
  const fallback = { ...DEFAULT_CONNECTOR_DEFAULTS };
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(CONNECTOR_PREFERENCES_KEY) ?? 'null') as { version?: unknown; routing?: unknown; endMarker?: unknown } | null;
    if (parsed?.version !== 1) return fallback;
    return {
      routing: typeof parsed.routing === 'string' && routings.has(parsed.routing) ? parsed.routing as ConnectorRouting : fallback.routing,
      endMarker: typeof parsed.endMarker === 'string' && markers.has(parsed.endMarker) ? parsed.endMarker as ConnectorMarker : fallback.endMarker,
    };
  } catch {
    return fallback;
  }
}

export function saveConnectorDefaults(defaults: ConnectorDefaults, storage: StorageLike | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CONNECTOR_PREFERENCES_KEY, JSON.stringify({ version: 1, ...defaults }));
    return true;
  } catch {
    return false;
  }
}

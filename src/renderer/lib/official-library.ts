import type { ComponentDefinition, ComponentSet } from '@/domain';
import { OFFICIAL_PROVIDERS, toOfficialComponentSets, type OfficialProvider, type RawOfficialLibrary } from '@/catalog/official-sets';

export { OFFICIAL_PROVIDERS, type OfficialProvider };

interface Manifest { providers: Record<OfficialProvider, { count: number; categories: Array<{ id: string; name: string; count: number }> }> }

// Vite splits each provider into its own chunk; nothing is loaded until a library is opened or searched (#92).
const loaders = import.meta.glob<RawOfficialLibrary>('../../catalog/official/{aws,azure,gcp,kubernetes}.json', { import: 'default' });
const manifest = Object.values(import.meta.glob<Manifest>('../../catalog/official/manifest.json', { import: 'default', eager: true }))[0];
const cache = new Map<OfficialProvider, Promise<ComponentSet[]>>();

export function officialIconCount(provider: OfficialProvider): number {
  return manifest?.providers[provider]?.count ?? 0;
}

export function loadOfficialLibrary(provider: OfficialProvider): Promise<ComponentSet[]> {
  let pending = cache.get(provider);
  if (!pending) {
    const load = loaders[`../../catalog/official/${provider}.json`];
    pending = load ? load().then(toOfficialComponentSets) : Promise.resolve([]);
    pending.catch(() => cache.delete(provider));
    cache.set(provider, pending);
  }
  return pending;
}

export function loadAllOfficialLibraries(): Promise<ComponentSet[]> {
  return Promise.all(OFFICIAL_PROVIDERS.map(loadOfficialLibrary)).then((sets) => sets.flat());
}

export interface OfficialMatch { set: ComponentSet; component: ComponentDefinition }

/** Search without cloning: sets are frozen, and cloning per hit would copy every icon string of the set. */
export function searchOfficial(sets: readonly ComponentSet[], query: string, limit = Number.POSITIVE_INFINITY): OfficialMatch[] {
  const needle = query.trim().toLocaleLowerCase('de').replace(/-/g, ' ');
  const results: OfficialMatch[] = [];
  for (const set of sets) {
    for (const component of set.components) {
      const haystack = `${component.name} ${component.category} ${(component.aliases ?? []).join(' ')}`.toLocaleLowerCase('de').replace(/-/g, ' ');
      if (!needle || haystack.includes(needle)) {
        results.push({ set, component });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}

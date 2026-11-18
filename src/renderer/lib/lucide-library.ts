import type { ComponentSet } from '@/domain';
import { toLucideComponentSets, type RawLucideLibrary } from '@/catalog/lucide-sets';

interface Manifest { package: string; count: number; categories: Array<{ id: string; name: string; count: number }> }

// The icons are a chunk of their own; nothing is loaded until the library is opened or searched (#227).
const loaders = import.meta.glob<RawLucideLibrary>('../../catalog/lucide/lucide.json', { import: 'default' });
const manifest = Object.values(import.meta.glob<Manifest>('../../catalog/lucide/manifest.json', { import: 'default', eager: true }))[0];
let pending: Promise<ComponentSet[]> | null = null;

export function lucideIconCount(): number { return manifest?.count ?? 0; }
export function lucidePackage(): string { return manifest?.package ?? ''; }

export function loadLucideLibrary(): Promise<ComponentSet[]> {
  if (!pending) {
    const load = loaders['../../catalog/lucide/lucide.json'];
    pending = load ? load().then(toLucideComponentSets) : Promise.resolve([]);
    pending.catch(() => { pending = null; });
  }
  return pending;
}

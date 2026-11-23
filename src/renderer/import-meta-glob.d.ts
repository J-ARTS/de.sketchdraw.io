// Minimal typing for Vite's import.meta.glob; the app tsconfig does not load vite/client types.
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options: { import: string; eager: true; query?: string; exhaustive?: boolean }): Record<string, T>;
  glob<T = unknown>(pattern: string | string[], options: { import: string; eager?: false; query?: string; exhaustive?: boolean }): Record<string, () => Promise<T>>;
}

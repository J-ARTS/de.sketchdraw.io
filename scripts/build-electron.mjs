#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mainEntry = path.join(rootDir, 'electron/main.ts');
const preloadEntry = path.join(rootDir, 'electron/preload.ts');
const outDir = path.join(rootDir, 'dist-electron');

export async function buildElectronBundles() {
  const missing = [];
  if (!fs.existsSync(mainEntry)) {
    missing.push('electron/main.ts [Issue #8 / Electron Main & Persistence (Antigravity)]');
  }
  if (!fs.existsSync(preloadEntry)) {
    missing.push('electron/preload.ts [Issue #8 / Electron Preload Bridge (Antigravity)]');
  }

  if (missing.length > 0) {
    console.error('[build:electron] Cannot bundle Electron processes; missing entry point(s):');
    for (const item of missing) {
      console.error(`  - ${item}`);
    }
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const sharedOptions = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info',
  };

  await build({
    ...sharedOptions,
    entryPoints: [mainEntry],
    outfile: path.join(outDir, 'main.cjs'),
  });

  await build({
    ...sharedOptions,
    entryPoints: [preloadEntry],
    outfile: path.join(outDir, 'preload.cjs'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildElectronBundles().catch((error) => {
    console.error('[build:electron] Build failed:', error);
    process.exit(1);
  });
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.slice('--mode='.length) : 'all';

const ENTRYPOINTS = {
  domainTypes: {
    relPath: 'src/domain/types.ts',
    owner: 'Issue #6 / Shared Contracts (Codex & Antigravity)',
  },
  rendererMain: {
    relPath: 'src/renderer/main.ts',
    owner: 'Issue #10 / Renderer UI (Claude Code)',
  },
  electronMain: {
    relPath: 'electron/main.ts',
    owner: 'Issue #8 / Electron Main & Persistence (Antigravity)',
  },
  electronPreload: {
    relPath: 'electron/preload.ts',
    owner: 'Issue #8 / Electron Preload Bridge (Antigravity)',
  },
};

function findTestFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  const results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && /\.(test|spec)\.ts$/.test(entry.name)) {
      results.push(path.relative(rootDir, fullPath));
    }
  }
  return results;
}

function checkFiles(keys) {
  const missing = [];
  for (const key of keys) {
    const spec = ENTRYPOINTS[key];
    const absPath = path.join(rootDir, spec.relPath);
    if (!fs.existsSync(absPath)) {
      missing.push(`${spec.relPath} [${spec.owner}]`);
    }
  }
  return missing;
}

const errors = [];

switch (mode) {
  case 'renderer': {
    const missing = checkFiles(['rendererMain']);
    if (missing.length > 0) {
      errors.push(
        `Missing renderer entry point(s) required for Vite browser build/dev:\n  - ${missing.join('\n  - ')}`
      );
    }
    break;
  }
  case 'electron': {
    const missing = checkFiles(['electronMain', 'electronPreload']);
    if (missing.length > 0) {
      errors.push(
        `Missing Electron entry point(s) required for desktop bundle:\n  - ${missing.join('\n  - ')}`
      );
    }
    break;
  }
  case 'typecheck': {
    const missing = checkFiles(['domainTypes', 'rendererMain', 'electronMain', 'electronPreload']);
    if (missing.length > 0) {
      errors.push(
        `Full application typecheck blocked by pending integration entry point(s):\n  - ${missing.join('\n  - ')}\n  (Hint: Run "npm run typecheck:config" to typecheck existing contracts in src/domain/types.ts and root configurations.)`
      );
    }
    break;
  }
  case 'tests-unit': {
    const unitTests = findTestFiles(path.join(rootDir, 'tests/unit'));
    if (unitTests.length === 0) {
      errors.push(
        'No unit test files (*.test.ts / *.spec.ts) found in tests/unit/. Refusing to report empty test suite as passed (Issue #9 / Antigravity).'
      );
    }
    break;
  }
  case 'tests-ui': {
    const missing = checkFiles(['rendererMain']);
    if (missing.length > 0) {
      errors.push(
        `UI test execution blocked by missing renderer entry point(s):\n  - ${missing.join('\n  - ')}`
      );
    }
    const uiTests = findTestFiles(path.join(rootDir, 'tests/ui'));
    if (uiTests.length === 0) {
      errors.push(
        'No UI test files (*.test.ts / *.spec.ts) found in tests/ui/. Refusing to report empty test suite as passed (Issue #10 / Claude Code).'
      );
    }
    break;
  }
  case 'tests-electron': {
    const missing = checkFiles(['rendererMain', 'electronMain', 'electronPreload']);
    if (missing.length > 0) {
      errors.push(
        `Electron test execution blocked by missing entry point(s):\n  - ${missing.join('\n  - ')}`
      );
    }
    const electronTests = findTestFiles(path.join(rootDir, 'tests/electron'));
    if (electronTests.length === 0) {
      errors.push(
        'No Electron test files (*.test.ts / *.spec.ts) found in tests/electron/. Refusing to report empty test suite as passed (Issue #8 / Antigravity).'
      );
    }
    break;
  }
  default: {
    const missing = checkFiles(['domainTypes', 'rendererMain', 'electronMain', 'electronPreload']);
    if (missing.length > 0) {
      errors.push(`Missing required entry point(s):\n  - ${missing.join('\n  - ')}`);
    }
    break;
  }
}

if (errors.length > 0) {
  console.error(`[verify-entrypoints:${mode}] Integration dependency check failed:`);
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

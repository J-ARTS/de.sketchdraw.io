import { build } from 'esbuild';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'src/mcp/server.ts');

try {
  await access(entry);
  await build({
    entryPoints: [entry],
    outfile: path.join(root, 'dist-mcp/server.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    tsconfig: path.join(root, 'tsconfig.mcp.json'),
    logLevel: 'info',
  });
} catch (error) {
  console.error('[build:mcp] Unable to bundle the MCP adapter:', error);
  process.exitCode = 1;
}

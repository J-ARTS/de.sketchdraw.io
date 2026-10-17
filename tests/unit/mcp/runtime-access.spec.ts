import { afterEach, describe, expect, it } from 'vitest';
import { chmod, lstat, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { agentRuntimeFilePath, clearAgentRuntimeAccess, readAgentRuntimeAccess, writeAgentRuntimeAccess } from '../../../electron/agent-access/runtime-access';
import { loadAgentClientConfig } from '../../../src/mcp/client';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

const grant = {
  SKETCHDRAW_MCP_ENDPOINT: 'tcp:127.0.0.1:12345',
  SKETCHDRAW_MCP_CAPABILITY: 'a'.repeat(64),
  SKETCHDRAW_MCP_GRANT_ID: 'grant:automatic',
  SKETCHDRAW_MCP_APP_EPOCH: 'b'.repeat(32),
  SKETCHDRAW_MCP_DOCUMENT_ID: 'doc:automatic',
};

describe('automatic agent runtime access', () => {
  it('uses stable per-user paths on every target platform', () => {
    expect(agentRuntimeFilePath({}, 'darwin', '/home/test')).toBe('/home/test/Library/Application Support/io.sketchdraw.de/agent-runtime/active-v1.json');
    expect(agentRuntimeFilePath({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, 'win32', 'C:\\Users\\test')).toContain(path.join('io.sketchdraw.de', 'agent-runtime', 'active-v1.json'));
    expect(agentRuntimeFilePath({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/test')).toBe('/config/io.sketchdraw.de/agent-runtime/active-v1.json');
    expect(() => agentRuntimeFilePath({ SKETCHDRAW_MCP_RUNTIME_FILE: 'relative.json' })).toThrow(/absolute/);
  });

  it('publishes, loads and conditionally removes the private current grant', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-runtime-')); roots.push(root);
    const file = path.join(root, 'private', 'active-v1.json');
    await writeAgentRuntimeAccess(file, grant, { command: '/app/Sketchdraw', args: ['/app/server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1', SKETCHDRAW_MCP_RUNTIME_FILE: file } });
    const value = await readAgentRuntimeAccess(file);
    expect(value).toMatchObject({ version: 1, grant, clientConfiguration: { command: '/app/Sketchdraw' } });
    expect(await loadAgentClientConfig({ SKETCHDRAW_MCP_RUNTIME_FILE: file })).toEqual(grant);
    if (process.platform !== 'win32') {
      expect(Number((await lstat(file)).mode) & 0o777).toBe(0o600);
      expect(Number((await lstat(path.dirname(file))).mode) & 0o777).toBe(0o700);
    }
    await clearAgentRuntimeAccess(file, { grantId: 'another', appEpoch: grant.SKETCHDRAW_MCP_APP_EPOCH });
    expect(await readAgentRuntimeAccess(file)).toBeDefined();
    await clearAgentRuntimeAccess(file, { grantId: grant.SKETCHDRAW_MCP_GRANT_ID, appEpoch: grant.SKETCHDRAW_MCP_APP_EPOCH });
    expect(await readAgentRuntimeAccess(file)).toBeUndefined();
  });

  it('refuses a runtime file readable by other local users', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(path.join(os.tmpdir(), 'sketchdraw-runtime-')); roots.push(root);
    const file = path.join(root, 'private', 'active-v1.json');
    await writeAgentRuntimeAccess(file, grant, { command: '/app/Sketchdraw', args: ['/app/server.cjs'], env: {} });
    await chmod(file, 0o644);
    await expect(readAgentRuntimeAccess(file)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});

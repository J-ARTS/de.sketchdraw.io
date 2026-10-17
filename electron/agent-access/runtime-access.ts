import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { AgentAccessError } from '../../src/agent-access/errors';
import { hex16, hex32, idSchema } from '../../src/agent-access/schema';
import type { AgentIssuedGrant } from '../../src/agent-access/types';

const RUNTIME_DIRECTORY = 'io.sketchdraw.de';
const RUNTIME_FILE = 'agent-runtime/active-v1.json';
const MAX_RUNTIME_FILE_BYTES = 16 * 1024;

const grantSchema = z.strictObject({
  SKETCHDRAW_MCP_ENDPOINT: z.string().min(1).max(256),
  SKETCHDRAW_MCP_CAPABILITY: hex32,
  SKETCHDRAW_MCP_GRANT_ID: idSchema,
  SKETCHDRAW_MCP_APP_EPOCH: hex16,
  SKETCHDRAW_MCP_DOCUMENT_ID: idSchema,
});

const runtimeSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: z.string().datetime(),
  grant: grantSchema,
  clientConfiguration: z.strictObject({
    command: z.string().min(1),
    args: z.array(z.string()).min(1),
    env: z.record(z.string(), z.string()),
  }),
});

export type AgentRuntimeAccess = z.infer<typeof runtimeSchema>;
type AgentClientConfig = AgentIssuedGrant['env'];

/** A stable, per-user location shared by the desktop host and its bundled MCP adapter. */
export function agentRuntimeFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = os.homedir(),
): string {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const override = env.SKETCHDRAW_MCP_RUNTIME_FILE;
  if (override) {
    if (!platformPath.isAbsolute(override)) throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime path must be absolute.');
    return platformPath.normalize(override);
  }
  if (platform === 'darwin') return platformPath.join(home, 'Library', 'Application Support', RUNTIME_DIRECTORY, RUNTIME_FILE);
  if (platform === 'win32') return platformPath.join(env.APPDATA || platformPath.join(home, 'AppData', 'Roaming'), RUNTIME_DIRECTORY, RUNTIME_FILE);
  return platformPath.join(env.XDG_CONFIG_HOME || platformPath.join(home, '.config'), RUNTIME_DIRECTORY, RUNTIME_FILE);
}

function assertPrivateRuntimeFile(file: string, stats: Awaited<ReturnType<typeof lstat>>): void {
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_RUNTIME_FILE_BYTES) throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime file is invalid.');
  if (process.platform !== 'win32' && (stats.uid !== process.getuid?.() || (Number(stats.mode) & 0o077) !== 0)) throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime file is not private.');
  if (!path.isAbsolute(file)) throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime path is invalid.');
}

export async function readAgentRuntimeAccess(file = agentRuntimeFilePath()): Promise<AgentRuntimeAccess | undefined> {
  let stats: Awaited<ReturnType<typeof lstat>>;
  try { stats = await lstat(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime file cannot be inspected.');
  }
  assertPrivateRuntimeFile(file, stats);
  try { return runtimeSchema.parse(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) {
    if (error instanceof AgentAccessError) throw error;
    throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime file is invalid.');
  }
}

export async function writeAgentRuntimeAccess(file: string, grant: AgentClientConfig, clientConfiguration: AgentRuntimeAccess['clientConfiguration']): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    await chmod(directory, 0o700);
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || stats.uid !== process.getuid?.()) throw new AgentAccessError('ACCESS_DENIED', 'The automatic agent runtime directory is not private.');
  }
  const value = runtimeSchema.parse({ version: 1, updatedAt: new Date().toISOString(), grant, clientConfiguration });
  const temporary = path.join(directory, `.active-${randomBytes(12).toString('hex')}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  if (process.platform !== 'win32') await chmod(temporary, 0o600);
  try {
    // Windows rename does not replace a stale crash artifact. Its capability no longer
    // has a live host, so removing it before publishing the new session is safe.
    if (process.platform === 'win32') await rm(file, { force: true });
    await rename(temporary, file);
  }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function clearAgentRuntimeAccess(file: string, expected?: { grantId: string; appEpoch: string }): Promise<void> {
  if (expected) {
    const current = await readAgentRuntimeAccess(file).catch(() => undefined);
    if (!current || current.grant.SKETCHDRAW_MCP_GRANT_ID !== expected.grantId || current.grant.SKETCHDRAW_MCP_APP_EPOCH !== expected.appEpoch) return;
  }
  await rm(file, { force: true });
}

import { createHmac, timingSafeEqual } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { AgentAccessError } from '../../src/agent-access/errors';

export function authMac(capability: string, label: string, grantId: string, appEpoch: string, clientNonce: string, serverNonce: string): string {
  return createHmac('sha256', Buffer.from(capability, 'hex'))
    .update(JSON.stringify([label, grantId, appEpoch, clientNonce, serverNonce])).digest('hex');
}
export function sameMac(actual: string, expected: string): boolean {
  return /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
export async function endpointOptions(endpoint: string): Promise<{ path: string } | { host: string; port: number }> {
  if (/^tcp:127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(endpoint)) {
    const port = Number(endpoint.split(':').at(-1));
    if (port > 65535) throw new AgentAccessError('ACCESS_DENIED', 'Invalid local endpoint.');
    return { host: '127.0.0.1', port };
  }
  if (!endpoint.startsWith('unix:') || process.platform === 'win32') throw new AgentAccessError('ACCESS_DENIED', 'Invalid local endpoint.');
  const socketPath = endpoint.slice(5);
  if (!path.isAbsolute(socketPath) || Buffer.byteLength(socketPath) > 100) throw new AgentAccessError('ACCESS_DENIED', 'Invalid local endpoint.');
  const [parent, socket] = await Promise.all([lstat(path.dirname(socketPath)), lstat(socketPath)]);
  const uid = process.getuid?.();
  if (uid === undefined || !parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== uid || (parent.mode & 0o777) !== 0o700 || !socket.isSocket() || socket.uid !== uid || (socket.mode & 0o777) !== 0o600) {
    throw new AgentAccessError('ACCESS_DENIED', 'Local endpoint ownership check failed.');
  }
  return { path: socketPath };
}

import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isUpdateStatus, validateUpdateRequest } from '../../electron/ipc-contract';

describe('update IPC contract (#237)', () => {
  it('has its own channels', () => {
    expect(IPC_CHANNELS.UPDATE_INVOKE).toBe('sketchdraw:updates:invoke');
    expect(IPC_CHANNELS.UPDATE_EVENT).toBe('sketchdraw:updates:event');
  });

  it('accepts exactly the five commands', () => {
    for (const action of ['status', 'check', 'install', 'open-release-page'] as const) expect(validateUpdateRequest({ action })).toEqual({ action });
    expect(validateUpdateRequest({ action: 'set-auto-check', enabled: false })).toEqual({ action: 'set-auto-check', enabled: false });
  });

  it('rejects anything that carries an address, a version, a file or an unknown command', () => {
    for (const input of [
      { action: 'install', url: 'https://example.com/x.dmg' },
      { action: 'install', version: '9.9.9' },
      { action: 'install', file: '/tmp/x' },
      { action: 'check', enabled: true },
      { action: 'set-auto-check' },
      { action: 'set-auto-check', enabled: 'yes' },
      { action: 'set-auto-check', enabled: true, extra: 1 },
      { action: 'download' },
      {},
      null,
      'check',
      ['check'],
      JSON.parse('{"action":"check","__proto__":{}}'),
    ]) expect(() => validateUpdateRequest(input)).toThrow();
  });

  it('only lets a complete status through to the page', () => {
    const status = { supported: true, canInstall: true, autoCheck: true, currentVersion: '0.1.6', phase: 'downloading', latestVersion: '0.1.7', progress: 0.4, problem: null };
    expect(isUpdateStatus(status)).toBe(true);
    expect(isUpdateStatus({ ...status, phase: 'error', progress: null, problem: 'checksum' })).toBe(true);
    for (const broken of [{ ...status, phase: 'rebooting' }, { ...status, progress: 2 }, { ...status, problem: 'unknown' }, { ...status, supported: 'yes' }, { ...status, latestVersion: 7 }, null, 'ready', []]) expect(isUpdateStatus(broken)).toBe(false);
  });
});

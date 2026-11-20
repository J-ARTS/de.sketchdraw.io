import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, sanitizeUserName, USER_NAME_MAX_LENGTH } from '../../electron/ipc-contract';

describe('userName IPC contract (#250)', () => {
  it('has its own channel', () => {
    expect(IPC_CHANNELS.USER_NAME).toBe('sketchdraw:app:user-name');
  });

  it('passes an account name on as one clean, short line', () => {
    expect(sanitizeUserName('jeremy')).toBe('jeremy');
    expect(sanitizeUserName('  Jeremy\tTeichmann\n')).toBe('Jeremy Teichmann');
    expect(sanitizeUserName('DOMAIN\\user')).toBe('DOMAIN\\user');
    expect(Array.from(sanitizeUserName('x'.repeat(200)))).toHaveLength(USER_NAME_MAX_LENGTH);
  });

  it('turns anything else into no suggestion', () => {
    for (const input of [undefined, null, 42, {}, ['name'], '', '   ', '\u0000\u0007']) expect(sanitizeUserName(input)).toBe('');
  });
});

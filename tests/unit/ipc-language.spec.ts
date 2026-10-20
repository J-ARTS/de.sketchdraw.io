import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, validateSetLanguageRequest } from '../../electron/ipc-contract';

describe('setLanguage IPC contract', () => {
  it('has its own channel', () => {
    expect(IPC_CHANNELS.SET_LANGUAGE).toBe('sketchdraw:app:set-language');
  });

  it('accepts exactly the supported languages', () => {
    expect(validateSetLanguageRequest({ language: 'de' })).toBe('de');
    expect(validateSetLanguageRequest({ language: 'en' })).toBe('en');
  });

  it('rejects unknown languages, extra keys and non-records', () => {
    for (const input of [{ language: 'fr' }, { language: 1 }, { language: 'en', extra: true }, {}, null, 'en', ['en'], JSON.parse('{"language":"en","__proto__":{}}')]) {
      expect(() => validateSetLanguageRequest(input)).toThrow();
    }
  });
});

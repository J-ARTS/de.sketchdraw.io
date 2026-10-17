import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, isAllowedRendererUrl, validateIpcSender } from '../../electron/security';

describe('desktop sender boundary acceptance', () => {
  it('accepts the bundled app main page despite WHATWG opaque custom-scheme origin', () => {
    expect(new URL('app://sketchdraw/index.html').origin).toBe('null');
    expect(isAllowedRendererUrl('app://sketchdraw/index.html', APP_ORIGIN)).toBe(true);
    expect(isAllowedRendererUrl('app://sketchdraw/', APP_ORIGIN)).toBe(true);
    expect(validateIpcSender({
      sender: { id: 7, isDestroyed: () => false, getURL: () => 'app://sketchdraw/index.html' },
      senderFrame: { url: 'app://sketchdraw/index.html', routingId: 3, parent: null },
    }, { windowWebContentsId: 7, mainFrameRoutingId: 3, isWindowDestroyed: false, allowedOrigin: APP_ORIGIN })).toEqual({ ok: true });
  });

  it('rejects other opaque origins, alternate authorities and subframes', () => {
    for (const url of ['file:///index.html', 'data:text/html,app', 'app://attacker/index.html',
      'app://sketchdraw.evil/index.html', 'app://user@sketchdraw/index.html',
      'app://sketchdraw:123/index.html', 'app://sketchdraw/other.html']) {
      expect(isAllowedRendererUrl(url, APP_ORIGIN), url).toBe(false);
    }
    expect(validateIpcSender({
      sender: { id: 7, isDestroyed: () => false },
      senderFrame: { url: 'app://sketchdraw/index.html', routingId: 3, parent: {} },
    }, { windowWebContentsId: 7, mainFrameRoutingId: 3, isWindowDestroyed: false, allowedOrigin: APP_ORIGIN }).ok).toBe(false);
  });
});

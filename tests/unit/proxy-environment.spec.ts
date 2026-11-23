import { describe, expect, it } from 'vitest';
import { pluginRequestInit } from '../../electron/plugin-fetch';
import { environmentProxy } from '../../electron/proxy-environment';

describe('proxy of the environment', () => {
  it('leaves the settings of the system in charge when no proxy is named', () => {
    expect(environmentProxy({})).toBeNull();
    expect(environmentProxy({ http_proxy: '  ', HTTPS_PROXY: '' })).toBeNull();
    expect(environmentProxy({ no_proxy: 'localhost' })).toBeNull();
  });

  it('translates http_proxy and https_proxy, the lower-case name first', () => {
    expect(environmentProxy({ http_proxy: 'http://localhost:3128', https_proxy: 'http://localhost:3128', HTTP_PROXY: 'http://other.example:8080', HTTPS_PROXY: 'http://other.example:8080' }))
      .toEqual({ proxyRules: 'http=localhost:3128;https=localhost:3128', proxyBypassRules: '' });
    expect(environmentProxy({ HTTP_PROXY: 'http://proxy.example:8080', HTTPS_PROXY: 'http://secure.example:8443/' }))
      .toEqual({ proxyRules: 'http=proxy.example:8080;https=secure.example:8443', proxyBypassRules: '' });
    expect(environmentProxy({ https_proxy: 'proxy.example:3128' })).toEqual({ proxyRules: 'https=proxy.example:3128', proxyBypassRules: '' });
  });

  it('uses all_proxy for what has no proxy of its own and keeps the scheme of other proxies', () => {
    expect(environmentProxy({ ALL_PROXY: 'socks5://127.0.0.1:1080', http_proxy: 'http://proxy.example:3128' }))
      .toEqual({ proxyRules: 'http=proxy.example:3128;https=socks5://127.0.0.1:1080', proxyBypassRules: '' });
    expect(environmentProxy({ https_proxy: 'https://secure.example' })).toEqual({ proxyRules: 'https=https://secure.example', proxyBypassRules: '' });
  });

  it('never passes a user name or password of the proxy address on, and ignores what is no proxy address', () => {
    expect(environmentProxy({ https_proxy: 'http://alice:secret@proxy.example:3128/' })).toEqual({ proxyRules: 'https=proxy.example:3128', proxyBypassRules: '' });
    expect(environmentProxy({ https_proxy: 'ftp://proxy.example', http_proxy: 'http://' })).toBeNull();
    expect(environmentProxy({ https_proxy: 'not a url', all_proxy: 'http://fallback.example:3128' })).toEqual({ proxyRules: 'http=fallback.example:3128;https=fallback.example:3128', proxyBypassRules: '' });
  });

  it('reaches the hosts of no_proxy directly; a star switches the proxy off', () => {
    expect(environmentProxy({ https_proxy: 'http://proxy.example:3128', no_proxy: 'localhost, 127.0.0.1,.example.com *.intern.example' }))
      .toEqual({ proxyRules: 'https=proxy.example:3128', proxyBypassRules: 'localhost,127.0.0.1,.example.com,*.intern.example' });
    expect(environmentProxy({ https_proxy: 'http://proxy.example:3128', no_proxy: 'a.example;<-loopback>,b.example' })?.proxyBypassRules).toBe('b.example');
    expect(environmentProxy({ https_proxy: 'http://proxy.example:3128', NO_PROXY: '*' })).toBeNull();
  });
});

describe('requests of the plugins', () => {
  it('name the app instead of a browser, keep what the request carries and never send a cookie', () => {
    const init = pluginRequestInit({ method: 'POST', redirect: 'error', body: '{"jql":"x"}', headers: { Accept: 'application/json', Authorization: 'Basic abc', 'User-Agent': 'Mozilla/5.0 Chrome/140' } }, '0.1.9');
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', body: '{"jql":"x"}', credentials: 'omit' });
    expect(init.headers).toEqual({ accept: 'application/json', authorization: 'Basic abc', 'user-agent': 'Sketchdraw/0.1.9' });
    expect(pluginRequestInit(undefined, '1.0.0')).toEqual({ headers: { 'user-agent': 'Sketchdraw/1.0.0' }, credentials: 'omit' });
  });
});

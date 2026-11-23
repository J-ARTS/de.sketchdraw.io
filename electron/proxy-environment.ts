/**
 * The proxy named in the environment. Company networks and developers name theirs in `https_proxy` and
 * `http_proxy`; Electron's network stack only knows the settings of the system, so the variables are translated
 * into the rules it understands. Without such a variable the settings of the system stay in charge.
 */
export interface EnvironmentProxy {
  /** Rules for Chromium, for example `http=proxy:3128;https=proxy:3128`. */
  proxyRules: string;
  /** Hosts that are reached directly, taken from `no_proxy`. Loopback addresses are always reached directly. */
  proxyBypassRules: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** The lower-case name wins, as it does for curl and git; an empty variable counts as not set. */
function named(env: Environment, name: string): string | undefined {
  return [env[name], env[name.toUpperCase()]].map((value) => value?.trim()).find(Boolean);
}

/**
 * `http://user:secret@proxy:3128/` becomes `proxy:3128`. A user name and password in the address are left out:
 * they never reach a command line or a log from here, and such a proxy has to be set up in the system instead.
 */
function proxyServer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`); } catch { return undefined; }
  if (!url.hostname || !['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol)) return undefined;
  return `${url.protocol === 'http:' ? '' : `${url.protocol}//`}${url.host}`;
}

export function environmentProxy(env: Environment): EnvironmentProxy | null {
  const fallback = proxyServer(named(env, 'all_proxy'));
  const http = proxyServer(named(env, 'http_proxy')) ?? fallback;
  const https = proxyServer(named(env, 'https_proxy')) ?? fallback;
  if (!http && !https) return null;
  const bypass = (named(env, 'no_proxy') ?? '').split(/[\s,]+/).map((entry) => entry.trim()).filter((entry) => entry && !/[;<>]/.test(entry));
  // `no_proxy=*` switches the proxy off altogether.
  if (bypass.includes('*')) return null;
  return {
    proxyRules: [http ? `http=${http}` : '', https ? `https=${https}` : ''].filter(Boolean).join(';'),
    proxyBypassRules: bypass.join(','),
  };
}

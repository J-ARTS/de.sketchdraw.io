/**
 * How the plugins reach Jira, Confluence and Azure DevOps. Their requests go through Electron's network stack,
 * because only that follows the proxy of the system and of the environment. That stack names itself like a
 * browser, and Atlassian takes a writing request of a browser for a form sent from a web page: it answers 403
 * "XSRF check failed". So the app names itself. No cookie is kept or sent; a token is all a request carries.
 */
export function pluginRequestInit(init: RequestInit | undefined, version: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', `Sketchdraw/${version}`);
  return { ...init, headers: Object.fromEntries(headers), credentials: 'omit' };
}

/**
 * Session links open the desktop app: `sketchdraw://join#sketchdraw-hdht=<invitation>`. The invitation travels in the
 * fragment and never contains the PIN. Everything here is pure so main, preload and renderer validate identically.
 */
export const APP_LINK_SCHEME = 'sketchdraw';
export const APP_LINK_BASE = `${APP_LINK_SCHEME}://join`;
/** The base64url invitation of at most 4096 decoded bytes, exactly as `buildHdhtLink` writes it. */
const FRAGMENT_PATTERN = /^sketchdraw-hdht=[A-Za-z0-9_-]{16,5600}$/;
/** Operating systems may add a trailing slash to the host part; nothing else is tolerated. */
const APP_LINK_PATTERN = /^sketchdraw:\/\/join\/?#(sketchdraw-hdht=[A-Za-z0-9_-]{16,5600})$/i;

/** The fragment form (`sketchdraw-hdht=…`) main hands to the renderer. */
export function isAppLinkFragment(value: unknown): value is string {
  return typeof value === 'string' && FRAGMENT_PATTERN.test(value);
}

/** Returns the invitation fragment of a `sketchdraw://join` link, or null for anything else. */
export function parseAppLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 6000) return null;
  const fragment = APP_LINK_PATTERN.exec(value)?.[1];
  return fragment && isAppLinkFragment(fragment) ? fragment : null;
}

/** Windows and Linux pass the link as a command line argument; the last valid one wins. */
export function findAppLink(argv: readonly unknown[]): string | null {
  for (let index = argv.length - 1; index >= 0; index--) {
    const fragment = parseAppLink(argv[index]);
    if (fragment) return fragment;
  }
  return null;
}

import { relayTopic } from './codec';
import { checkedRelayUrl } from './invitation';

/*
 * The relay route of a session (#300). Whoever starts a session chooses how the devices reach each other:
 *  - `p2p`: directly over HyperDHT, or through volunteer helper peers. No server takes part.
 *  - `cloud`: every device opens a WebSocket to one relay (a Cloudflare Worker, or the self-hosted relay of this
 *    repository). The relay forwards the same end-to-end encrypted records the helper peers forward; it sees network
 *    addresses, times and amounts of data, never the PIN, a key or the drawing.
 * The session link carries the address of the room, so guests need no setting.
 */
export type SessionRoute = 'p2p' | 'cloud';

/**
 * The relay the app offers by itself: the Worker its publisher runs (relay/cloudflare, deployed 2026-11-23). The
 * address field is filled with it, so the relay route works without anyone typing an address; a different relay
 * can still be entered. Empty would mean: no relay ships with the app.
 */
export const DEFAULT_CLOUD_RELAY_URL = 'sketchdraw-relay.jeremy-teichman74.workers.dev';

const ROUTE_KEY = 'sketchdraw.session-route.v1';
const ADDRESS_KEY = 'sketchdraw.cloud-relay-url.v1';

/**
 * What people type or paste for a relay: `relay.example.workers.dev`, an `https://` address copied from the browser,
 * or `wss://…`. Returns the checked WebSocket address ending in a slash. Throws `RELAY_URL_INVALID` or
 * `RELAY_URL_INSECURE` (plain `ws://` is only accepted for this computer itself).
 */
export function cloudRelayBase(text: string): string {
  let value = text.trim();
  if (!value) throw new TypeError('RELAY_URL_MISSING');
  if (/^https:\/\//i.test(value)) value = `wss://${value.slice(8)}`;
  else if (/^http:\/\//i.test(value)) value = `ws://${value.slice(7)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `wss://${value}`;
  const url = new URL(checkedRelayUrl(value));
  // An address that already names a room (copied out of a link) is cut back to the relay itself.
  url.pathname = url.pathname.replace(/\/v1(?:\/[0-9a-f]{64})?\/?$/, '/');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return checkedRelayUrl(url.toString());
}

/** The room of one session at a relay: `<relay>/v1/<topic>`; the topic is a hash of the host's public session key. */
export async function cloudRelayRoomUrl(base: string, hostPublicKey: Uint8Array): Promise<string> {
  return checkedRelayUrl(`${cloudRelayBase(base)}v1/${await relayTopic(hostPublicKey)}`);
}

/** The host name of a relay address, to tell people where their connection goes; empty when there is none. */
export function relayHostName(url: string): string {
  try { return url ? new URL(url).host : ''; } catch { return ''; }
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function storage(): Store | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

/** The route chosen last on this device; direct is the default and the answer to anything unreadable. */
export function storedSessionRoute(store: Store | null = storage()): SessionRoute {
  try { return store?.getItem(ROUTE_KEY) === 'cloud' ? 'cloud' : 'p2p'; } catch { return 'p2p'; }
}
export function storeSessionRoute(route: SessionRoute, store: Store | null = storage()): void {
  try { if (route === 'cloud') store?.setItem(ROUTE_KEY, 'cloud'); else store?.removeItem(ROUTE_KEY); } catch { /* the choice still applies to this session */ }
}

/** The relay address this device uses: its own entry, otherwise the one the app ships with. */
export function storedCloudRelayAddress(store: Store | null = storage()): string {
  try { return store?.getItem(ADDRESS_KEY)?.trim() || DEFAULT_CLOUD_RELAY_URL; } catch { return DEFAULT_CLOUD_RELAY_URL; }
}
export function storeCloudRelayAddress(address: string, store: Store | null = storage()): void {
  const value = address.trim();
  try { if (value && value !== DEFAULT_CLOUD_RELAY_URL) store?.setItem(ADDRESS_KEY, value); else store?.removeItem(ADDRESS_KEY); } catch { /* the address still applies to this session */ }
}

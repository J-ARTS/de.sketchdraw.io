/**
 * Shareable session links: the signed room invitation travels in the URL fragment, which browsers never send to a
 * server. Opening the link in a browser starts the web app, which joins the room.
 */
export const SESSION_LINK_PARAM = 'sketchdraw-session';
export const DEFAULT_WEB_APP_URL = 'https://de.sketchdraw.io/';
/** Public MQTT brokers used only to find the peer (signaling); drawing data never passes through them. */
export const DEFAULT_SESSION_RELAYS: readonly string[] = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
/** A public STUN server lets peers behind NAT discover their address. No TURN credentials are built in. */
export const DEFAULT_SESSION_RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] };

/** Normalizes the address of the web app that opens invitation links; falls back to the default. */
export function normalizeWebAppUrl(value: string | undefined | null): string {
  try {
    const url = new URL((value ?? '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_WEB_APP_URL;
    url.hash = ''; url.search = '';
    return url.toString();
  } catch {
    return DEFAULT_WEB_APP_URL;
  }
}

/** The page address that serves the app in a browser, or the default web app address inside the desktop app. */
export function ownWebAppUrl(location: Pick<Location, 'protocol' | 'origin' | 'pathname'> | undefined = typeof window === 'undefined' ? undefined : window.location): string {
  if (location && (location.protocol === 'https:' || location.protocol === 'http:')) return normalizeWebAppUrl(`${location.origin}${location.pathname}`);
  return DEFAULT_WEB_APP_URL;
}

export function buildSessionLink(invitation: string, webAppUrl: string): string {
  return `${normalizeWebAppUrl(webAppUrl)}#${SESSION_LINK_PARAM}=${encodeURIComponent(invitation)}`;
}

/** Accepts a full link, a bare fragment or the raw invitation text and returns the invitation, or null. */
export function extractSessionInvitation(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  const marker = `${SESSION_LINK_PARAM}=`;
  const index = value.indexOf(marker);
  if (index < 0) return /^[A-Za-z0-9+/_=-]{40,}$/.test(value) ? value : null;
  const raw = value.slice(index + marker.length).split(/[&\s]/)[0] ?? '';
  try {
    const decoded = decodeURIComponent(raw);
    return decoded || null;
  } catch {
    return null;
  }
}

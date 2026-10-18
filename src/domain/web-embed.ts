export type WebEmbedUrlResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/** Parses user input without fetching it. Only absolute HTTP(S) URLs without credentials are accepted. */
export function parseWebEmbedUrl(input: string): WebEmbedUrlResult {
  const value = input.trim();
  if (!value) return { ok: false, message: 'Bitte gib eine Webadresse ein.' };
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { ok: false, message: 'Nur vollständige HTTP- oder HTTPS-Adressen sind erlaubt.' };
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      return { ok: false, message: 'Die Webadresse darf keine eingebetteten Zugangsdaten enthalten.' };
    }
    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, message: 'Die Webadresse ist ungültig. Beispiel: https://example.com' };
  }
}

export function webEmbedLabel(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'Web-Embed';
  }
}

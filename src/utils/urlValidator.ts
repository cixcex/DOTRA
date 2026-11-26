// ---------------------------------------------------------------------------
// DOTRA URL validation / normalisation
// ---------------------------------------------------------------------------

export interface UrlCheck {
  ok: boolean;
  url?: string;
  error?: string;
}

const MAX_URL_LENGTH = 2000;

/** Normalise + validate a user-entered URL. Auto-prepends https://. */
export function normalizeUrl(input: string): UrlCheck {
  let value = input.trim();
  if (!value) return { ok: false, error: 'Enter a URL first.' };

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    value = `https://${value}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: 'That does not look like a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only http:// and https:// links can be encoded.' };
  }
  if (!parsed.hostname || parsed.hostname.length < 1) {
    return { ok: false, error: 'The URL needs a host, e.g. https://example.com.' };
  }
  if (value.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'This URL is too long for a QR code (max ~2000 characters).' };
  }

  return { ok: true, url: parsed.href };
}

/** Short host label for UI display, e.g. "example.com". */
export function urlHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

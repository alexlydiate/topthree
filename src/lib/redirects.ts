/**
 * Only ever redirect to a path on this site.
 *
 * `next` arrives from a query string, so without this an attacker could send
 * someone through our login and land them on their own page wearing our URL.
 * Rejects absolute URLs, protocol-relative `//evil.com`, and backslash tricks.
 */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}

/** Origin to build OAuth callbacks from, preferring the configured public one. */
export function siteOrigin(request: Request, configured?: string): string {
  if (configured) return configured.replace(/\/$/, '');
  return new URL(request.url).origin;
}

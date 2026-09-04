import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from 'astro:env/server';
import type { AstroCookies } from 'astro';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Read every cookie off the incoming request.
 *
 * AstroCookies has no public enumerate, and @supabase/ssr needs to see all of
 * them (session tokens get chunked across sb-*.0, sb-*.1, ...), so parse the
 * header directly.
 */
function parseCookieHeader(header: string | null): { name: string; value: string }[] {
  if (!header) return [];

  return header.split(';').flatMap((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return [];

    const name = pair.slice(0, eq).trim();
    if (!name) return [];

    const raw = pair.slice(eq + 1).trim();
    let value = raw;
    try {
      // Symmetric with Astro's cookies.set(), which encodes on write.
      value = decodeURIComponent(raw);
    } catch {
      // A malformed percent-sequence isn't worth failing the request over.
    }
    return [{ name, value }];
  });
}

export interface SupabaseContext {
  supabase: SupabaseClient;
  /**
   * Cache headers Supabase requires on any response that wrote auth cookies.
   * Skipping these behind a CDN risks serving one user's session to another,
   * so the middleware copies them onto the outgoing response.
   */
  authHeaders: Record<string, string>;
}

/** One client per request. Never share across requests. */
export function createSupabaseServerClient(
  request: Request,
  cookies: AstroCookies,
): SupabaseContext {
  const authHeaders: Record<string, string> = {};

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(request.headers.get('cookie'));
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          cookies.set(name, value, { ...options, path: options?.path ?? '/' });
        }
        Object.assign(authHeaders, headers);
      },
    },
  });

  return { supabase, authHeaders };
}

/** True if this request even claims to carry a session. */
export function hasAuthCookie(request: Request): boolean {
  const header = request.headers.get('cookie');
  return !!header && /(?:^|;\s*)sb-/.test(header);
}

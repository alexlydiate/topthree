import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient, hasAuthCookie } from './lib/supabase';
import { getProfileById } from './lib/queries';

export const onRequest = defineMiddleware(async (context, next) => {
  const { supabase, authHeaders } = createSupabaseServerClient(
    context.request,
    context.cookies,
  );

  context.locals.supabase = supabase;
  context.locals.userId = null;
  context.locals.profile = null;

  // Anonymous traffic -- crawlers, mostly -- shouldn't pay for an auth round
  // trip. No session cookie means there is nothing to verify.
  if (hasAuthCookie(context.request)) {
    // Resolve identity before rendering starts. A token refresh that lands
    // after the response is committed can't write its cookies back, which
    // shows up later as random logouts.
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;

    if (!error && typeof sub === 'string') {
      context.locals.userId = sub;
      context.locals.profile = await getProfileById(supabase, sub);
    }
  }

  const response = await next();

  // Responses that set auth cookies must not be cached by Cloudflare.
  try {
    for (const [key, value] of Object.entries(authHeaders)) {
      response.headers.set(key, value);
    }
  } catch {
    // Immutable headers on some response types; nothing to do.
  }

  return response;
});

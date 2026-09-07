import type { APIRoute } from 'astro';
import type { Provider } from '@supabase/supabase-js';
import { SITE_URL } from 'astro:env/server';
import { PROVIDERS } from '../../lib/types';
import { safeNext, siteOrigin } from '../../lib/redirects';

const ALLOWED = new Set<string>(PROVIDERS.map((p) => p.id));

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const form = await request.formData();
  const provider = String(form.get('provider') ?? '');
  const next = safeNext(String(form.get('next') ?? ''), '/onboarding');

  if (!ALLOWED.has(provider)) {
    return redirect('/login?error=unknown_provider', 303);
  }

  const origin = siteOrigin(request, SITE_URL);
  const callback = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;

  const { data, error } = await locals.supabase.auth.signInWithOAuth({
    // `provider` came off a form, so it's a string. The cast is also what lets
    // a Supabase *custom* provider id ("custom:something") through, which the
    // supabase-js Provider union doesn't model -- the value is passed straight
    // to the authorize URL. ALLOWED is the real guard.
    provider: provider as Provider,
    options: {
      redirectTo: callback,
      // We complete the code exchange ourselves in /auth/callback.
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    console.error('OAuth start failed', error);
    return redirect('/login?error=provider_unavailable', 303);
  }

  // The PKCE verifier was just written to a cookie by the Supabase client;
  // returning a redirect here is what commits it to the browser.
  return redirect(data.url, 303);
};

export const GET: APIRoute = ({ redirect }) => redirect('/login', 303);

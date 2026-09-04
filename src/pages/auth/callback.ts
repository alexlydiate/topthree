import type { APIRoute } from 'astro';
import { safeNext } from '../../lib/redirects';

export const GET: APIRoute = async ({ url, locals, redirect }) => {
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'), '/onboarding');

  // The provider reports user-facing failures (a declined consent screen)
  // here rather than by omitting the code.
  const providerError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (providerError) {
    console.warn('OAuth provider returned an error:', providerError);
    return redirect('/login?error=denied', 303);
  }

  if (!code) return redirect('/login?error=missing_code', 303);

  const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('Code exchange failed', error);
    return redirect('/login?error=exchange_failed', 303);
  }

  return redirect(next, 303);
};

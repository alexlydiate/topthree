import type { APIRoute } from 'astro';
import { isLocalSupabase, TEST_PASSWORD } from '../../lib/devAuth';
import { safeNext } from '../../lib/redirects';

/**
 * Sign in with email and password, for local development only.
 *
 * The app is social-SSO-only, which means you otherwise cannot log in locally
 * without registering a real OAuth app first. This exists so `npm run dev` is
 * usable from a cold start.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  // Not 403: in production this route should be indistinguishable from one
  // that was never deployed.
  if (!isLocalSupabase()) return new Response('Not found', { status: 404 });

  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '') || TEST_PASSWORD;
  const next = safeNext(String(form.get('next') ?? ''), '/');

  if (!email) return redirect('/dev-login?error=Pick+a+user', 303);

  const { error } = await locals.supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return redirect(`/dev-login?error=${encodeURIComponent(error.message)}`, 303);
  }

  // The session cookies were written by the client above; returning a redirect
  // is what commits them to the browser.
  return redirect(next, 303);
};

import type { APIRoute } from 'astro';
import { friendlyError } from '../../lib/apiError';

const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.userId) return redirect('/login', 303);

  const form = await request.formData();
  const handle = String(form.get('handle') ?? '').trim().toLowerCase();
  const displayName = String(form.get('display_name') ?? '').trim();
  const back = String(form.get('back') ?? '/onboarding');

  if (!HANDLE_RE.test(handle)) {
    const msg = 'Handles are 3-20 characters: lowercase letters, numbers and underscores.';
    return redirect(`${back}?error=${encodeURIComponent(msg)}`, 303);
  }

  const { error } = await locals.supabase
    .from('profiles')
    .update({
      handle,
      display_name: displayName ? displayName.slice(0, 60) : null,
      handle_confirmed: true,
    })
    .eq('id', locals.userId);

  if (error) {
    const msg =
      error.code === '23505' ? 'That handle is taken.' : friendlyError(error);
    return redirect(`${back}?error=${encodeURIComponent(msg)}`, 303);
  }

  return redirect(back, 303);
};

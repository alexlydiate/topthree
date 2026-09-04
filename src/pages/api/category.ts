import type { APIRoute } from 'astro';
import { friendlyError } from '../../lib/apiError';

/**
 * Create-or-find a category, then send the user straight to writing their
 * TopThree in it. A plain form POST so it works before Vue hydrates.
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  if (!locals.userId) return redirect('/login?next=/onboarding', 303);

  const form = await request.formData();
  const name = String(form.get('name') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();

  if (name.length < 2) {
    return redirect('/onboarding?error=' + encodeURIComponent('Give the category a name.'), 303);
  }

  const { data, error } = await locals.supabase
    .rpc('ensure_category', {
      p_name: name.slice(0, 80),
      p_description: description ? description.slice(0, 280) : null,
    })
    .single<{ slug: string }>();

  if (error || !data) {
    return redirect('/onboarding?error=' + encodeURIComponent(friendlyError(error)), 303);
  }

  return redirect(`/c/${data.slug}/add`, 303);
};

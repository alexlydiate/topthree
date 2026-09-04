import type { APIRoute } from 'astro';
import { searchItems } from '../../../lib/queries';
import { json } from '../../../lib/apiError';

export const GET: APIRoute = async ({ url, locals }) => {
  const categoryId = url.searchParams.get('category');
  const term = url.searchParams.get('q') ?? '';

  if (!categoryId) return json({ error: 'Missing category' }, 400);

  const items = await searchItems(locals.supabase, categoryId, term);

  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // Typeahead results are public and change slowly; let the edge absorb
      // the repeated keystrokes without going back to Postgres each time.
      'cache-control': 'public, max-age=15',
    },
  });
};

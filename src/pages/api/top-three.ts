import type { APIRoute } from 'astro';
import { friendlyError, json } from '../../lib/apiError';

interface Payload {
  categoryId?: unknown;
  names?: unknown;
  note?: unknown;
}

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.userId) return json({ error: 'You need to be signed in.' }, 401);

  let payload: Payload;
  try {
    payload = (await request.json()) as Payload;
  } catch {
    return json({ error: 'Malformed request.' }, 400);
  }

  const { categoryId, names, note } = payload;

  if (typeof categoryId !== 'string' || !categoryId) {
    return json({ error: 'Missing category.' }, 400);
  }

  if (!Array.isArray(names) || names.length !== 3) {
    return json({ error: 'A TopThree needs exactly three entries.' }, 400);
  }

  const cleaned = names.map((n) => (typeof n === 'string' ? n.trim() : ''));
  if (cleaned.some((n) => !n)) {
    return json({ error: 'Fill in all three before posting.' }, 400);
  }
  if (cleaned.some((n) => n.length > 120)) {
    return json({ error: 'Entries must be 120 characters or fewer.' }, 400);
  }

  // submit_top_three does the whole thing in one transaction: find-or-create
  // each item by its normalised slug, upsert the list, rewrite the entries.
  const { data, error } = await locals.supabase.rpc('submit_top_three', {
    p_category_id: categoryId,
    p_names: cleaned,
    p_note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 280) : null,
  });

  if (error) return json({ error: friendlyError(error) }, 400);

  return json({ id: data }, 200);
};

import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Turn a Postgres error into something worth showing a person.
 *
 * P0001 is a bare `RAISE EXCEPTION` from our own functions, so those messages
 * were written for users and can be passed through. Anything else is an
 * internal detail and gets a generic message instead.
 */
export function friendlyError(error: PostgrestError | null): string {
  if (!error) return 'Something went wrong.';

  switch (error.code) {
    case 'P0001':
      return error.message;
    case '42501':
      return 'You need to be signed in to do that.';
    case '23505':
      return 'That already exists.';
    case '23503':
      return 'That category no longer exists.';
    case '23514':
      return 'That does not look right — check the length and try again.';
    default:
      console.error('Unexpected database error', error);
      return 'Something went wrong. Please try again.';
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

import { SUPABASE_URL } from 'astro:env/server';

/**
 * True only when this process is pointed at a Supabase running on this machine.
 *
 * This is the security boundary for the dev sign-in route. It keys off the
 * Supabase host rather than a NODE_ENV or a feature flag on purpose: those are
 * things someone can set by accident, whereas a production deploy talks to
 * `<ref>.supabase.co` and can therefore never satisfy this check. The route is
 * inert in production even though its code ships.
 *
 * The seeded test accounts also only exist in the local database, so there is
 * nothing for it to authenticate against anywhere else.
 */
export function isLocalSupabase(): boolean {
  try {
    const { hostname } = new URL(SUPABASE_URL);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return false;
  }
}

/** Accounts created by `npm run seed`. Local only. */
export const TEST_USERS = [
  { email: 'alice@example.com', handle: 'alice', name: 'Alice Nguyen' },
  { email: 'bob@example.com', handle: 'bob', name: 'Bob Bobson' },
  { email: 'cara@example.com', handle: 'cara', name: 'Cara Diaz' },
  // Deliberately has no TopThrees, so the first-run onboarding prompt is
  // reachable without wiping the database.
  { email: 'dave@example.com', handle: 'dave', name: 'Dave Okafor' },
] as const;

export const TEST_PASSWORD = 'password123';

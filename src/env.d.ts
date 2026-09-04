/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    supabase: import('@supabase/supabase-js').SupabaseClient;
    /** Verified from the session JWT, not trusted from the cookie body. */
    userId: string | null;
    profile: import('./lib/types').Profile | null;
  }
}

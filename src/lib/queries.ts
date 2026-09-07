import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Category,
  CategoryStats,
  Profile,
  Ranking,
  TopThreeEntry,
  TopThreeItem,
  TopThreeWithCategory,
  TopThreeWithProfile,
} from './types';

/**
 * Explicit FK hints (`!constraint_name`) throughout. PostgREST can usually
 * infer the join, but it errors ambiguously the moment a second FK to the same
 * table appears -- which will happen the first time `loves` lands.
 */

const TOP_THREE_FIELDS = `
  id,
  note,
  updated_at,
  entries:top_three_entries (
    rank,
    item:items!top_three_entries_item_id_fkey ( id, name, slug )
  )
`;

/**
 * PostgREST types every embedded relation as an array, even a to-one one like
 * top_threes -> profiles. At runtime a many-to-one embed comes back as a plain
 * object, so the inferred type is simply wrong.
 *
 * Casting past it would work today and break silently if that ever changed --
 * bylines would just quietly stop rendering. Normalising both shapes costs
 * nothing and can't fail that way.
 */
type Embed<T> = T | T[] | null | undefined;

function one<T>(value: Embed<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

interface RawEntry {
  rank: number;
  item: Embed<TopThreeItem>;
}

interface RawTopThree {
  id: string;
  note: string | null;
  updated_at: string;
  entries: RawEntry[] | null;
}

/** Entries come back in arbitrary order; a TopThree is meaningless unranked. */
function mapEntries(raw: RawEntry[] | null | undefined): TopThreeEntry[] {
  return (raw ?? [])
    .map((entry) => ({ rank: entry.rank, item: one(entry.item) }))
    .filter((entry): entry is TopThreeEntry => entry.item !== null)
    .sort((a, b) => a.rank - b.rank);
}

export async function getProfileById(
  supabase: SupabaseClient,
  id: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function getProfileByHandle(
  supabase: SupabaseClient,
  handle: string,
): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('handle', handle.toLowerCase())
    .maybeSingle();
  return (data as Profile) ?? null;
}

export async function getCategoryBySlug(
  supabase: SupabaseClient,
  slug: string,
): Promise<Category | null> {
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  return (data as Category) ?? null;
}

/**
 * The TopFive: Borda score, tie-broken on first-place votes then total
 * mentions, so "one person's #1" loses to "three people's #3" only when the
 * points actually say so.
 */
export async function getTopFive(
  supabase: SupabaseClient,
  categoryId: string,
  limit = 5,
): Promise<Ranking[]> {
  const { data } = await supabase
    .from('category_rankings')
    .select('item_id, name, slug, score, mentions, firsts, seconds, thirds')
    .eq('category_id', categoryId)
    .order('score', { ascending: false })
    .order('firsts', { ascending: false })
    .order('mentions', { ascending: false })
    .order('name', { ascending: true })
    .limit(limit);
  return (data as Ranking[]) ?? [];
}

export async function getCategoryTopThrees(
  supabase: SupabaseClient,
  categoryId: string,
  limit = 100,
): Promise<TopThreeWithProfile[]> {
  const { data } = await supabase
    .from('top_threes')
    .select(`
      ${TOP_THREE_FIELDS},
      profile:profiles!top_threes_user_id_fkey ( handle, display_name, avatar_url )
    `)
    .eq('category_id', categoryId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as (RawTopThree & {
    profile: Embed<TopThreeWithProfile['profile']>;
  })[];

  return rows
    .map((row) => ({
      id: row.id,
      note: row.note,
      updated_at: row.updated_at,
      entries: mapEntries(row.entries),
      profile: one(row.profile),
    }))
    .filter((row): row is TopThreeWithProfile => row.profile !== null);
}

export async function getTopThreesByUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<TopThreeWithCategory[]> {
  const { data } = await supabase
    .from('top_threes')
    .select(`
      ${TOP_THREE_FIELDS},
      category:categories!top_threes_category_id_fkey ( id, slug, name )
    `)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  const rows = (data ?? []) as (RawTopThree & {
    category: Embed<TopThreeWithCategory['category']>;
  })[];

  return rows
    .map((row) => ({
      id: row.id,
      note: row.note,
      updated_at: row.updated_at,
      entries: mapEntries(row.entries),
      category: one(row.category),
    }))
    .filter((row): row is TopThreeWithCategory => row.category !== null);
}

/** The caller's own list for a category, for prefilling the editor. */
export async function getOwnTopThree(
  supabase: SupabaseClient,
  userId: string,
  categoryId: string,
): Promise<TopThreeWithCategory | null> {
  const { data } = await supabase
    .from('top_threes')
    .select(`
      ${TOP_THREE_FIELDS},
      category:categories!top_threes_category_id_fkey ( id, slug, name )
    `)
    .eq('user_id', userId)
    .eq('category_id', categoryId)
    .maybeSingle();

  if (!data) return null;

  const row = data as RawTopThree & {
    category: Embed<TopThreeWithCategory['category']>;
  };
  const category = one(row.category);
  if (!category) return null;

  return {
    id: row.id,
    note: row.note,
    updated_at: row.updated_at,
    entries: mapEntries(row.entries),
    category,
  };
}

export async function listCategories(
  supabase: SupabaseClient,
  opts: { search?: string; limit?: number } = {},
): Promise<CategoryStats[]> {
  let query = supabase
    .from('category_stats')
    .select('*')
    .order('top_three_count', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50);

  if (opts.search?.trim()) {
    // Escape PostgREST's wildcards so a literal % in a search doesn't match all.
    const term = opts.search.trim().replace(/[%_]/g, '\\$&');
    query = query.ilike('name', `%${term}%`);
  }

  const { data } = await query;
  return (data as CategoryStats[]) ?? [];
}

/**
 * Typeahead for the editor. This is the single most important query in the
 * app: steering people onto an existing item is what stops the TopFive
 * fragmenting into near-duplicate spellings.
 */
export async function searchItems(
  supabase: SupabaseClient,
  categoryId: string,
  term: string,
  limit = 8,
): Promise<{ id: string; name: string; slug: string }[]> {
  const cleaned = term.trim();
  if (!cleaned) return [];

  const escaped = cleaned.replace(/[%_]/g, '\\$&');
  const { data } = await supabase
    .from('items')
    .select('id, name, slug')
    .eq('category_id', categoryId)
    .ilike('name', `%${escaped}%`)
    .limit(limit);

  return data ?? [];
}

/**
 * URLs worth putting in the sitemap.
 *
 * Only categories and profiles that actually contain something. A category
 * with no TopThrees renders a heading and "nobody has posted here yet", which
 * is a thin page; submitting hundreds of them invites Google to judge the site
 * on its emptiest URLs rather than its best ones. They stay crawlable and
 * linked from /c — they just aren't advertised.
 */
export interface SitemapEntry {
  path: string;
  lastmod: string | null;
}

export async function getSitemapCategories(
  supabase: SupabaseClient,
  limit = 5000,
): Promise<SitemapEntry[]> {
  const { data } = await supabase
    .from('category_stats')
    .select('slug, last_activity_at, top_three_count')
    .gt('top_three_count', 0)
    .order('last_activity_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    path: `/c/${row.slug}`,
    lastmod: row.last_activity_at,
  }));
}

export async function getSitemapProfiles(
  supabase: SupabaseClient,
  limit = 5000,
): Promise<SitemapEntry[]> {
  const { data } = await supabase
    .from('profile_stats')
    .select('handle, last_activity_at, top_three_count')
    .gt('top_three_count', 0)
    .order('last_activity_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    path: `/u/${row.handle}`,
    lastmod: row.last_activity_at,
  }));
}

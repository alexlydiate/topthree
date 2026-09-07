export interface Profile {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  handle_confirmed: boolean;
  created_at: string;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CategoryStats extends Category {
  top_three_count: number;
  last_activity_at: string | null;
}

/** A row of the aggregated TopFive. */
export interface Ranking {
  item_id: string;
  name: string;
  slug: string;
  score: number;
  mentions: number;
  firsts: number;
  seconds: number;
  thirds: number;
}

export interface TopThreeItem {
  id: string;
  name: string;
  slug: string;
}

export interface TopThreeEntry {
  rank: number;
  item: TopThreeItem;
}

export interface TopThree {
  id: string;
  note: string | null;
  updated_at: string;
  entries: TopThreeEntry[];
}

export interface TopThreeWithProfile extends TopThree {
  profile: Pick<Profile, 'handle' | 'display_name' | 'avatar_url'>;
}

export interface TopThreeWithCategory extends TopThree {
  category: Pick<Category, 'id' | 'slug' | 'name'>;
}

export const PROVIDERS = [
  { id: 'google', label: 'Google', brand: '#ea4335' },
  { id: 'discord', label: 'Discord', brand: '#5865f2' },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

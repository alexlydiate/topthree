-- TopThree: initial schema
--
-- Design notes
-- ------------
-- The one thing that makes or breaks this product is item canonicalisation. If
-- "The Beatles", "Beatles" and "beatles" become three rows, the aggregated
-- TopFive fragments into noise and the core feature is worthless. So every item
-- carries a normalised `slug`, unique per category, and a trigger keeps it
-- honest no matter which client wrote the row.
--
-- Aggregation is a Borda count: a #1 pick is worth 3 points, #2 is 2, #3 is 1.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Normalisation
-- ---------------------------------------------------------------------------

-- Not IMMUTABLE: unaccent() depends on a mutable dictionary, so this is STABLE
-- and therefore can't back a generated column. Triggers do the work instead.
--
-- SECURITY DEFINER because this runs inside triggers and RPCs on behalf of the
-- `authenticated` role, which would otherwise need USAGE on the extensions
-- schema to reach unaccent(). Safe to elevate: it touches no tables, takes one
-- text argument, and its search_path is pinned.
create or replace function public.slugify(txt text)
returns text
language sql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        -- strip a leading article: "The Beatles" and "Beatles" must collide
        regexp_replace(
          lower(unaccent(coalesce(txt, ''))),
          '^(the|a|an)\s+', '', 'g'
        ),
        -- everything that isn't a letter or digit becomes a separator
        '[^a-z0-9]+', '-', 'g'
      )
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 60),
  avatar_url text,
  bio text check (char_length(bio) <= 280),
  -- true once the user has confirmed the auto-generated handle
  handle_confirmed boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.profiles.handle is
  'Lowercase, URL-safe. Auto-generated from the OAuth provider, editable once.';

-- Derive a free handle from whatever the OAuth provider gave us.
create or replace function public.generate_handle(seed text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := regexp_replace(lower(coalesce(seed, '')), '[^a-z0-9_]+', '', 'g');
  base := left(base, 20);

  -- Reddit allows handles we can't use, and Google gives us an email local part
  -- that may be entirely punctuation. Fall back to something random.
  if base is null or char_length(base) < 3 then
    base := 'tt' || substr(md5(random()::text), 1, 6);
  end if;

  candidate := base;
  while exists (select 1 from public.profiles p where p.handle = candidate) loop
    n := n + 1;
    if n > 25 then
      candidate := left(base, 14) || substr(md5(random()::text), 1, 6);
    else
      candidate := left(base, 20 - char_length(n::text)) || n::text;
    end if;
  end loop;

  return candidate;
end;
$$;

-- Supabase inserts into auth.users on first OAuth login; mirror that into a
-- profile so the rest of the app never has to special-case a missing row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  seed text;
begin
  seed := coalesce(
    nullif(meta->>'user_name', ''),           -- reddit, discord
    nullif(meta->>'preferred_username', ''),
    nullif(meta->>'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );

  insert into public.profiles (id, handle, display_name, avatar_url)
  values (
    new.id,
    public.generate_handle(seed),
    nullif(coalesce(meta->>'full_name', meta->>'name', meta->>'user_name'), ''),
    nullif(coalesce(meta->>'avatar_url', meta->>'picture'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text check (char_length(description) <= 280),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index categories_created_at_idx on public.categories (created_at desc);

create or replace function public.categories_set_slug()
returns trigger
language plpgsql
as $$
begin
  new.name := trim(new.name);
  new.slug := public.slugify(new.name);
  if new.slug is null then
    raise exception 'Category name must contain at least one letter or number';
  end if;
  return new;
end;
$$;

create trigger categories_set_slug_trg
  before insert or update of name on public.categories
  for each row execute function public.categories_set_slug();

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table public.items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (category_id, slug)
);

create index items_category_idx on public.items (category_id);
-- Backs the typeahead that steers people onto existing items.
create index items_name_trgm_idx on public.items (category_id, slug text_pattern_ops);

create or replace function public.items_set_slug()
returns trigger
language plpgsql
as $$
begin
  new.name := trim(new.name);
  new.slug := public.slugify(new.name);
  if new.slug is null then
    raise exception 'Item name must contain at least one letter or number';
  end if;
  return new;
end;
$$;

create trigger items_set_slug_trg
  before insert or update of name on public.items
  for each row execute function public.items_set_slug();

-- ---------------------------------------------------------------------------
-- TopThrees
-- ---------------------------------------------------------------------------

-- One list per user per category, edited in place. This constraint is what
-- makes the aggregate meaningful: nobody can stuff the ballot by posting twice.
create table public.top_threes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);

create index top_threes_category_idx on public.top_threes (category_id, updated_at desc);
create index top_threes_user_idx on public.top_threes (user_id, updated_at desc);

create table public.top_three_entries (
  top_three_id uuid not null references public.top_threes(id) on delete cascade,
  rank smallint not null check (rank between 1 and 3),
  item_id uuid not null references public.items(id) on delete cascade,
  primary key (top_three_id, rank),
  -- can't rank the same thing twice in one list
  unique (top_three_id, item_id)
);

create index top_three_entries_item_idx on public.top_three_entries (item_id);

-- ---------------------------------------------------------------------------
-- Aggregation
-- ---------------------------------------------------------------------------

-- security_invoker so the view respects the caller's RLS rather than the
-- definer's. Everything here is public-read anyway, but defaulting to the safe
-- behaviour means adding a private column later doesn't silently leak it.
create or replace view public.category_rankings
with (security_invoker = on) as
select
  i.category_id,
  i.id                                            as item_id,
  i.name,
  i.slug,
  sum(4 - e.rank)::int                            as score,
  count(*)::int                                   as mentions,
  count(*) filter (where e.rank = 1)::int         as firsts,
  count(*) filter (where e.rank = 2)::int         as seconds,
  count(*) filter (where e.rank = 3)::int         as thirds
from public.top_three_entries e
join public.items i on i.id = e.item_id
group by i.category_id, i.id, i.name, i.slug;

comment on view public.category_rankings is
  'Borda count per category: #1 = 3pts, #2 = 2pts, #3 = 1pt. The TopFive is the
   top 5 rows by score, tie-broken on first-place votes then total mentions.';

create or replace view public.category_stats
with (security_invoker = on) as
select
  c.id,
  c.slug,
  c.name,
  c.description,
  c.created_at,
  c.created_by,
  count(distinct t.id)::int as top_three_count,
  max(t.updated_at)         as last_activity_at
from public.categories c
left join public.top_threes t on t.category_id = c.id
group by c.id, c.slug, c.name, c.description, c.created_at, c.created_by;

-- ---------------------------------------------------------------------------
-- Writing a TopThree
-- ---------------------------------------------------------------------------

-- Find-or-create three items and (re)write the caller's list, atomically.
-- Doing this as separate client round-trips would race two users who introduce
-- the same new item at the same moment, and would leave a half-written list if
-- the third insert failed.
--
-- Runs with INVOKER rights, so RLS still decides whether the caller may write.
create or replace function public.submit_top_three(
  p_category_id uuid,
  p_names text[],
  p_note text default null
)
returns uuid
language plpgsql
as $$
declare
  v_user_id uuid := auth.uid();
  v_top_three_id uuid;
  v_item_id uuid;
  v_name text;
  v_slug text;
  v_seen text[] := '{}';
  i int;
begin
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  if array_length(p_names, 1) is distinct from 3 then
    raise exception 'A TopThree needs exactly three entries';
  end if;

  -- Reject duplicates up front with a friendly message; the unique constraint
  -- on (top_three_id, item_id) would otherwise surface as a raw 23505.
  for i in 1..3 loop
    v_slug := public.slugify(p_names[i]);
    if v_slug is null then
      raise exception 'Entry %s is empty', i;
    end if;
    if v_slug = any (v_seen) then
      raise exception 'The same thing cannot appear twice in one TopThree';
    end if;
    v_seen := v_seen || v_slug;
  end loop;

  insert into public.top_threes (user_id, category_id, note)
  values (v_user_id, p_category_id, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (user_id, category_id) do update
    set note = excluded.note,
        updated_at = now()
  returning id into v_top_three_id;

  -- Simplest correct way to rewrite an edited list.
  delete from public.top_three_entries where top_three_id = v_top_three_id;

  for i in 1..3 loop
    v_name := trim(p_names[i]);
    v_slug := public.slugify(v_name);

    -- The no-op UPDATE is deliberate: ON CONFLICT DO NOTHING returns no row, so
    -- there'd be nothing to RETURNING. Keeping items.name means the first
    -- spelling of an item wins and doesn't churn every time someone retypes it.
    insert into public.items (category_id, name, slug, created_by)
    values (p_category_id, v_name, v_slug, v_user_id)
    on conflict (category_id, slug) do update set name = public.items.name
    returning id into v_item_id;

    insert into public.top_three_entries (top_three_id, rank, item_id)
    values (v_top_three_id, i::smallint, v_item_id);
  end loop;

  return v_top_three_id;
end;
$$;

-- Create a category if it's new, otherwise hand back the existing one. Lets the
-- onboarding form treat "create" and "pick" as the same action.
create or replace function public.ensure_category(
  p_name text,
  p_description text default null
)
returns public.categories
language plpgsql
as $$
declare
  v_slug text := public.slugify(p_name);
  v_row public.categories;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_slug is null then
    raise exception 'Category name must contain at least one letter or number';
  end if;

  select * into v_row from public.categories where slug = v_slug;
  if found then
    return v_row;
  end if;

  insert into public.categories (name, description, created_by)
  values (trim(p_name), nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  on conflict (slug) do update set name = public.categories.name
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Everything is world-readable: this is a public site and crawlers arrive
-- unauthenticated. Writes are owner-only.

alter table public.profiles          enable row level security;
alter table public.categories        enable row level security;
alter table public.items             enable row level security;
alter table public.top_threes        enable row level security;
alter table public.top_three_entries enable row level security;

create policy "profiles are public"
  on public.profiles for select using (true);
create policy "users insert own profile"
  on public.profiles for insert with check ((select auth.uid()) = id);
create policy "users update own profile"
  on public.profiles for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "categories are public"
  on public.categories for select using (true);
create policy "signed-in users create categories"
  on public.categories for insert
  with check ((select auth.uid()) is not null and created_by = (select auth.uid()));

create policy "items are public"
  on public.items for select using (true);
create policy "signed-in users create items"
  on public.items for insert with check ((select auth.uid()) is not null);
-- The no-op UPDATE in submit_top_three needs an UPDATE policy to pass RLS.
create policy "signed-in users touch items"
  on public.items for update using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

create policy "top threes are public"
  on public.top_threes for select using (true);
create policy "users write own top threes"
  on public.top_threes for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "entries are public"
  on public.top_three_entries for select using (true);
create policy "users write own entries"
  on public.top_three_entries for all
  using (exists (
    select 1 from public.top_threes t
    where t.id = top_three_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.top_threes t
    where t.id = top_three_id and t.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
-- Supabase grants this by default; stated explicitly so the migration
-- doesn't depend on that staying true.
grant usage on schema extensions to anon, authenticated;
grant select on public.profiles, public.categories, public.items,
                public.top_threes, public.top_three_entries,
                public.category_rankings, public.category_stats
  to anon, authenticated;
grant insert, update on public.profiles, public.items to authenticated;
grant insert on public.categories to authenticated;
grant insert, update, delete on public.top_threes, public.top_three_entries to authenticated;
grant execute on function public.submit_top_three(uuid, text[], text) to authenticated;
grant execute on function public.ensure_category(text, text) to authenticated;
grant execute on function public.slugify(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Iteration 2 seam: follows and loves
-- ---------------------------------------------------------------------------
-- Deliberately not created yet. Both are purely additive -- no changes to the
-- tables above -- so shipping them is a new migration plus frontend work:
--
--   create table public.follows (
--     follower_id  uuid not null references public.profiles(id) on delete cascade,
--     following_id uuid not null references public.profiles(id) on delete cascade,
--     created_at   timestamptz not null default now(),
--     primary key (follower_id, following_id),
--     check (follower_id <> following_id)
--   );
--
--   -- "loves", not likes: rendered as a heart, never a thumbs up.
--   create table public.loves (
--     user_id      uuid not null references public.profiles(id) on delete cascade,
--     top_three_id uuid not null references public.top_threes(id) on delete cascade,
--     created_at   timestamptz not null default now(),
--     primary key (user_id, top_three_id)
--   );
--
-- Note that loves attach to a whole TopThree, not to an item: loving someone's
-- list is a social signal and must stay separate from the Borda score, or a
-- popular list would quietly double-count into the TopFive.

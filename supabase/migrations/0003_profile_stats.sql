-- Profile activity, mirroring category_stats.
--
-- Added for the sitemap, which needs a lastmod per profile and needs to know
-- which profiles have any content at all. Empty profiles are thin pages and
-- listing them invites Google to judge the site on its worst URLs rather than
-- its best.

create or replace view public.profile_stats
with (security_invoker = on) as
select
  p.id,
  p.handle,
  p.display_name,
  p.created_at,
  count(t.id)::int as top_three_count,
  max(t.updated_at) as last_activity_at
from public.profiles p
left join public.top_threes t on t.user_id = p.id
group by p.id, p.handle, p.display_name, p.created_at;

grant select on public.profile_stats to anon, authenticated;

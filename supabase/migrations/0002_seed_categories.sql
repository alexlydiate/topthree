-- Starter categories.
--
-- An empty site can't demonstrate the idea: the onboarding prompt offers
-- "create a category or pick an existing one", and with nothing to pick the
-- only path is the harder one. These seed rows give a new user somewhere to
-- land. created_by is null -- they belong to nobody.
--
-- Migrations run as `postgres`, which bypasses RLS, so the insert policy
-- requiring created_by = auth.uid() doesn't apply here.

insert into public.categories (name, description)
values
  ('Sci-fi novels',            'The best science fiction ever put on paper.'),
  ('Pizza toppings',           'Settle it once and for all.'),
  ('Albums of the 1990s',      'Ten years, three slots. Choose carefully.'),
  ('Cities to live in',        'Not to visit -- to actually live in.'),
  ('Programming languages',    'Bring evidence.'),
  ('Films of the last decade', 'Released 2016 or later.'),
  ('Breakfast cereals',        'A serious category.'),
  ('Board games',              'For playing with actual humans in a room.'),
  ('British sitcoms',          'The ones that still hold up.'),
  ('Places to walk in the UK', 'Day walks, not expeditions.'),
  ('Podcasts',                 'Currently in your rotation.'),
  ('Video games of all time',  'No era restriction. Defend your picks.')
on conflict (slug) do nothing;

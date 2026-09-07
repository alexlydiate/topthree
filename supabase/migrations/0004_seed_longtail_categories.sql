-- Long-tail seed categories.
--
-- Chosen for specificity, not breadth. A new domain cannot rank for "board
-- games" -- that is BoardGameGeek's -- but "board games for exactly two
-- players" is winnable, and it is also a better prompt: people have confident
-- opinions about narrow things and freeze on broad ones.
--
-- Trimmed to the set most likely to actually get filled. An empty category is
-- an invitation, but sixty invitations and three parties is its own kind of
-- signal, so breadth was traded for the ones a visitor can answer on the spot.
--
-- Deliberately shipped with no TopThrees. The sitemap excludes categories with
-- nothing in them, so these stay invisible to search until somebody posts and
-- cannot drag the site down as thin pages. What they buy is a visitor seeing a
-- site with range and an obvious thing to do -- conversion, not rankings.
--
-- Selection bias, on purpose:
--   * subjects you can have an opinion about without research, because the
--     hard problem is getting a first list out of a stranger
--   * purchasable things (books, albums, games) -- the pages where affiliate
--     links would eventually make sense
--   * UK-flavoured entries, matching the audience and facing a fraction of the
--     competition of their American equivalents

insert into public.categories (name, description) values

-- Music ----------------------------------------------------------------------
  ('Radiohead albums',                'Rank them. Show your working.'),
  ('David Bowie albums',              'Fifty years, three slots.'),
  ('Albums for a long drive',         'Front to back, no skipping.'),
  ('Cover versions better than the original', 'Rare, and worth arguing about.'),

-- Film and television --------------------------------------------------------
  ('Films better than the book',      'A short list, by definition.'),
  ('Films to watch with a hangover',  'Undemanding, comforting, familiar.'),
  ('Studio Ghibli films',             'No wrong answers, plenty of wrong orders.'),
  ('Christmas films',                 'Settle the annual argument.'),

-- Books ----------------------------------------------------------------------
  ('Terry Pratchett novels',          'Forty-one books. Three slots. Good luck.'),
  ('Books under 200 pages',           'Short, and none the worse for it.'),
  ('Books to give a teenager',        'Without putting them off reading forever.'),
  ('Crime novels',                    'Whodunnits, procedurals, noir -- all welcome.'),
  ('Fantasy novels that are not Tolkien', 'He is disqualified. Everyone else is fair game.'),

-- Games ----------------------------------------------------------------------
  ('Board games for exactly two players', 'No filler, no player elimination.'),
  ('Video games of the 1990s',        'Sprites, discs and demo discs.'),
  ('Zelda games',                     'Rank them and defend it.'),

-- Food and drink -------------------------------------------------------------
  ('Biscuits to dunk in tea',         'Structural integrity matters.'),
  ('Crisp flavours',                  'A serious national question.'),
  ('Chocolate bars',                  'Corner shop, not chocolatier.'),
  ('Sandwich fillings',               'No toasting. No wraps.'),
  ('Curry house orders',              'What you actually order, not what impresses.'),

-- Britain ---------------------------------------------------------------------
  ('Seaside towns',                   'Off-season counts.'),
  ('Motorway service stations',       'Yes, really. Some are better.'),
  ('Train journeys in Britain',       'For the window, not the destination.'),
  ('Scottish islands',                'Visited, not aspirational.'),

-- Everyday --------------------------------------------------------------------
  ('Excuses for being late',          'The ones that work.'),
  ('Household gadgets',               'Cheap things that changed your week.'),

-- Tools -----------------------------------------------------------------------
  ('Command-line tools',              'The ones you install on a fresh machine.'),
  ('Text editors',                    'Bring evidence.')

on conflict (slug) do nothing;

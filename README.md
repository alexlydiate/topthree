# TopThree

Everyone has a top three. Post yours in any category; the crowd's **TopFive**
falls out of the aggregate.

- **`/c/sci-fi-novels`** — a category page: the aggregated TopFive, then
  everybody's individual TopThrees.
- **`/u/alice`** — a profile: every TopThree that person has posted, each
  linking back to its category.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | Astro 7, SSR | Category pages are the growth channel, so they must be server-rendered and indexable. Content pages ship **zero JavaScript**. |
| Interactive bits | Vue islands | Only the TopThree editor needs to be interactive, so only that page loads Vue. |
| Backend | Supabase (Postgres + Auth + RLS) | Row Level Security *is* the authorization layer, so there's no backend service to write or run. |
| Hosting | Cloudflare Workers | Free tier, one command to deploy. |

Running cost at MVP scale: **£0**, plus a domain.

### Why not a Vue SPA on static hosting

It was the original plan and it's cheaper to reason about, but this product
lives or dies on organic search. Every category someone creates is a potential
landing page for "best sci-fi novels", and a client-rendered SPA hands Google a
spinner. SSR costs nothing extra on Workers.

### Why the server holds the only Supabase client

No Supabase client is ever shipped to the browser. The Vue island talks to our
own `/api/*` routes, which use the request-scoped server client. That keeps RLS
enforcement server-side, keeps the anon key out of the page, and makes the
client bundle 84 KB instead of ~200 KB.

## The bit that actually matters

Item canonicalisation. If "The Beatles", "Beatles" and "beatles" become three
rows, the TopFive fragments into noise and the core feature is worthless.

Two defences:

1. **A normalised `slug` per item, unique per category**, maintained by a
   database trigger so it holds no matter which client wrote the row.
   `slugify()` lowercases, strips accents, drops a leading article, and
   collapses everything non-alphanumeric. `The Left Hand of Darkness`,
   `Left Hand of Darkness` and `left hand of darkness` all become
   `left-hand-of-darkness`.
2. **A typeahead in the editor** that surfaces existing items as you type, so
   picking the established spelling is the path of least resistance.

Aggregation is a **Borda count**: a #1 pick scores 3, #2 scores 2, #3 scores 1.
Ties break on first-place votes, then total mentions. It's the
`category_rankings` view.

`submit_top_three()` does find-or-create-items, upsert-list and rewrite-entries
in a single transaction. Doing that as separate client round-trips would race
two users introducing the same new item at the same moment, and could leave a
half-written list behind.

## Setup

### 1. Supabase project

Create a project at [supabase.com](https://supabase.com) (free tier is fine).
Then run the migrations — paste each file into the SQL Editor in order:

- `supabase/migrations/0001_init.sql` — schema, RLS, functions, views
- `supabase/migrations/0002_seed_categories.sql` — a dozen starter categories

Starter categories matter more than they look: onboarding offers "create one or
pick one", and with an empty database the only path is the harder one.

### 2. Auth providers

All redirect URIs are the same:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

**Google** and **Discord** are native providers — create an OAuth app with each,
then paste the client ID and secret into Supabase → Authentication → Providers.

**Reddit is not a native Supabase provider.** It's wired up as a *custom OAuth
provider*, which the free tier supports (3 of them). Create a **web app** at
[reddit.com/prefs/apps](https://www.reddit.com/prefs/apps), then in Supabase →
Authentication → Providers → Custom:

| Field | Value |
| --- | --- |
| Identifier | `custom:reddit` (must match `PROVIDERS` in `src/lib/types.ts`) |
| Type | OAuth2 |
| Authorization URL | `https://www.reddit.com/api/v1/authorize` |
| Token URL | `https://www.reddit.com/api/v1/access_token` |
| UserInfo URL | `https://oauth.reddit.com/api/v1/me` |
| Scopes | `identity` |
| Email optional | **on** |

That last row is not optional-in-practice: Reddit's `/api/v1/me` returns no
email address, and Supabase requires one unless you say otherwise. Sign-in fails
with a confusing error if you miss it.

Reddit also wants `duration=permanent` on the authorize URL if you want refresh
tokens to outlive the hour.

#### On the two providers you asked for that aren't here

**Instagram is not possible.** The Basic Display API — the only route that ever
supported personal accounts — reached end-of-life on 4 December 2024. Its
replacement requires a Business or Creator account, so consumer Instagram login
no longer exists. Facebook Login is the only remaining Meta route.

**TikTok needs a shim.** TikTok's Login Kit uses `client_key` where the OAuth2
spec says `client_id`, which breaks Supabase's generic OAuth2 client along with
most other libraries. It's doable with a small Cloudflare Worker that proxies
the authorize and token endpoints and rewrites the parameter, then registering
that Worker's URLs as the custom provider endpoints. Deferred, not blocked.

### 3. Local development

**A plain local Postgres is not enough.** The app never speaks the Postgres wire
protocol — it talks HTTP to PostgREST for data and to GoTrue for auth. Supabase's
API layer *is* the backend; that's the trade that removes the need to write one.

**But you don't need a deployed project either.** The Supabase CLI runs the whole
stack locally in Docker:

```bash
npx supabase start
```

That brings up Postgres, PostgREST, GoTrue and Studio, and applies everything in
`supabase/migrations/` — schema, RLS, functions and the seed categories — on
first run. It prints an `API_URL` and `ANON_KEY`; put them in `.env`:

```
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_ANON_KEY="<the ANON_KEY it printed>"
```

Then `npm run dev`. Studio is at <http://127.0.0.1:54323>.

Useful follow-ups:

| Command | Does |
| --- | --- |
| `npx supabase status` | URLs and keys again |
| `npx supabase db reset` | Drop and re-apply every migration + seed |
| `npx supabase stop` | Shut the stack down |

`npm run preview` runs the built Worker under Wrangler, which reads `.dev.vars`
rather than `.env` — copy the same two values across.

#### Signing in locally

`supabase/config.toml` enables **Google** and **Discord** and reads their
credentials from the project-root `.env` via `env()` substitution, so no secret
is ever committed. You still have to register the OAuth apps yourself.

The redirect URI to register is the same for both, and must match exactly —
note `127.0.0.1`, not `localhost`, because that's what GoTrue sends:

```
http://127.0.0.1:54321/auth/v1/callback
```

**Discord is the quicker one** — no consent screen, no verification:
[discord.com/developers/applications](https://discord.com/developers/applications)
→ your app → OAuth2 → Redirects → add the URI above.

**Google**: [console.cloud.google.com](https://console.cloud.google.com) → APIs &
Services → Credentials → Create credentials → OAuth client ID → *Web
application*. You'll be asked to configure the consent screen first; set it to
External and add yourself as a test user.

Then put the values in `.env`:

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID="..."
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET="..."
SUPABASE_AUTH_EXTERNAL_DISCORD_CLIENT_ID="..."
SUPABASE_AUTH_EXTERNAL_DISCORD_SECRET="..."
```

Config and env changes only take effect on a restart:

```bash
npx supabase stop && npx supabase start
```

Check it took with `curl -s http://127.0.0.1:54321/auth/v1/settings -H "apikey: $ANON_KEY"`
— enabled providers appear under `external`. A provider that's off produces
`{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`.

**Reddit cannot be tested locally.** It's a Supabase *custom* OAuth provider, and
custom providers are hosted-only — the local CLI supports only the native list.
The app will happily redirect to GoTrue for `custom:reddit`; GoTrue is what
rejects it. Test Reddit against a hosted free-tier project.

### 4. Deploy

Deployment is automated. Pushing to `main` runs `.github/workflows/deploy.yml`,
which applies migrations first and only deploys the frontend if they succeed —
the frontend can depend on schema that just landed, so the order matters.

`.github/workflows/ci.yml` runs on every PR: typecheck, build, and — when
anything under `supabase/` changed — applies every migration to an empty
database, which is the only way to catch a migration that no longer works from
a clean slate.

#### GitHub repository secrets

Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens (see permissions below) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages, right-hand sidebar |
| `SUPABASE_ACCESS_TOKEN` | supabase.com/dashboard/account/tokens |
| `SUPABASE_DB_PASSWORD` | The database password you set when creating the project |
| `SUPABASE_URL` | Project Settings → Data API |
| `SUPABASE_ANON_KEY` | Project Settings → API Keys (the `anon` / publishable one) |

#### GitHub repository variables

Same page, **Variables** tab — these aren't secret and it's useful to see them:

| Variable | Value |
| --- | --- |
| `SUPABASE_PROJECT_REF` | Your project ref, e.g. `abcdefghijklmnop` |
| `SITE_URL` | `https://topthreeanything.com` — used by the post-deploy smoke test |

#### Cloudflare API token permissions

The "Edit Cloudflare Workers" template is *nearly* right, but provisioning the
custom domain also needs DNS. Create a custom token with:

- Account → **Workers Scripts** → Edit
- Zone → **Workers Routes** → Edit
- Zone → **DNS** → Edit  *(required by `custom_domain` in `wrangler.jsonc`)*

Scope the zone permissions to `topthreeanything.com`.

#### How configuration reaches the Worker

Two different mechanisms, deliberately:

- **`SUPABASE_URL` / `SUPABASE_ANON_KEY`** are Worker *secrets*, pushed by the
  deploy workflow via `wrangler secret put`. Rotating one is "update the GitHub
  secret, re-run the workflow".
- **`SITE_URL`** is a plain `var` in `wrangler.jsonc`, because it's public and
  belongs in version control. It's declared `access: 'secret'` in the Astro env
  schema only to mean "read at runtime, don't inline at build".

For local `npm run preview`, put `SITE_URL` in `.dev.vars` to override the
production value — otherwise OAuth callbacks point at the live site. Wrangler
picks `.dev.vars` up on **restart**, not on hot reload. `npm run dev` reads
`.env` and is unaffected either way.

#### Custom domain

`wrangler.jsonc` claims the apex `topthreeanything.com` as a Worker custom
domain, so the first successful deploy provisions it. If the zone isn't attached
to the same Cloudflare account yet, the deploy fails — comment out `routes` and
the Worker goes to its `*.workers.dev` URL instead.

`www` is deliberately not routed here: serving both would give the site two
canonical URLs and split its search ranking, which is the whole thing we chose
SSR to protect. Add a Cloudflare redirect rule sending `www` → apex instead.

Don't forget the Supabase side: Authentication → URL Configuration → set Site
URL to `https://topthreeanything.com` and add `https://topthreeanything.com/auth/callback`
to Redirect URLs, or sign-in will bounce.

#### Gating deploys

Both jobs declare `environment: production`. If you want a manual approval step
before anything reaches the live site, add a required reviewer to that
environment in Settings → Environments.

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :4321 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built Worker locally via Wrangler |
| `npm run check` | Typecheck `.astro`, `.ts` and `.vue` |
| `npm run deploy` | Build and deploy to Cloudflare |

## Layout

```
src/
  middleware.ts          Resolves the session once per request
  lib/
    supabase.ts          Request-scoped server client, cookie plumbing
    queries.ts           Every read the app performs
    types.ts             Domain types + the provider list
  components/
    TopThreeEditor.vue   The only interactive component
    TopFive.astro        The aggregate
    TopThreeCard.astro   One person's list
  pages/
    c/[slug].astro       Category page
    c/[slug]/add.astro   Editor
    u/[handle].astro     Profile
    api/                 JSON + form endpoints for the island
    auth/                OAuth start, callback, signout
supabase/migrations/     Schema, RLS, functions, seeds
```

## What's verified, and what isn't

Exercised end to end against the local Supabase stack — real PostgREST, real
GoTrue, real JWTs, RLS enforced:

- **Canonicalisation.** `Dune` / `dune` / `DUNE!` / `"  Dune  "` collapse to one
  item; so do `The Left Hand of Darkness` / `Left Hand of Darkness` (article) and
  `Hyperion` / `Hypérion` (accent). The first spelling entered wins the display
  name rather than churning on every retype.
- **Borda scoring**, including tie-breaks, and live recomputation after an edit.
- **The write path** — `submit_top_three` through PostgREST with a real user JWT.
- **The read path** — nested embeds with FK hints, rendering on category and
  profile pages.
- **The editor island** — typeahead suggestions, selection, submit, redirect.
- **The profile trigger** — fires on real signup, derives a handle from provider
  metadata, and resolves collisions (`alice` → `alice1`).
- **RLS**, against a plain Postgres with a Supabase-shaped stub: cross-user
  writes blocked, impersonation blocked, anonymous reads allowed, anonymous
  writes rejected.

**Not verified:** the OAuth redirect round trip itself, which needs real provider
credentials. Local sign-in during testing was done by minting a GoTrue session
directly. Register a Google or Discord app (above) to exercise the real flow.

## Next iteration

Both are purely additive — no changes to existing tables. The exact migration is
written out at the bottom of `0001_init.sql`.

- **Follows** — a feed of the people whose taste you trust.
- **Loves** — a heart, not a thumbs up. Deliberately attached to a whole
  TopThree rather than to an item, so a popular list can't quietly double-count
  into the Borda score.

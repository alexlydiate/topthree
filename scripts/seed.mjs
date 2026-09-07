/**
 * Seed the local database with test users and a bit of content.
 *
 * Run after `supabase db reset`, which wipes auth.users along with everything
 * else. Idempotent: re-running it is a no-op for users that already exist.
 *
 * Users are created through the GoTrue admin API rather than by INSERTing into
 * auth.users. Hand-writing those rows means matching GoTrue's expectations for
 * password hashing, identities and a dozen non-null token columns, and getting
 * any of it subtly wrong produces accounts that exist but cannot sign in.
 */
import { execFileSync } from 'node:child_process';

const USERS = [
  { email: 'alice@example.com', user_name: 'alice', full_name: 'Alice Nguyen' },
  { email: 'bob@example.com', user_name: 'bob', full_name: 'Bob Bobson' },
  { email: 'cara@example.com', user_name: 'cara', full_name: 'Cara Diaz' },
  // Left with no lists on purpose: the onboarding prompt only shows for a
  // user who hasn't posted, and it's the first screen in the product.
  { email: 'dave@example.com', user_name: 'dave', full_name: 'Dave Okafor' },
];

const PASSWORD = 'password123';

const LISTS = [
  ['sci-fi-novels', 'alice@example.com', ['Dune', 'The Left Hand of Darkness', 'Neuromancer'], 'Herbert still wins.'],
  ['sci-fi-novels', 'bob@example.com', ['dune', 'Neuromancer', 'Hyperion'], null],
  ['sci-fi-novels', 'cara@example.com', ['DUNE!', 'Left Hand of Darkness', 'Hypérion'], 'Fight me.'],
  ['pizza-toppings', 'alice@example.com', ['Anchovy', 'Nduja', 'Basil'], null],
  ['pizza-toppings', 'bob@example.com', ['Pepperoni', 'Anchovies', 'Mushroom'], 'Anchovy is correct.'],
  ['board-games', 'cara@example.com', ['Brass: Birmingham', 'Azul', 'Codenames'], null],
];

function status() {
  const raw = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw);
}

let api, serviceKey, anonKey;
try {
  const s = status();
  api = s.API_URL;
  serviceKey = s.SERVICE_ROLE_KEY;
  anonKey = s.ANON_KEY;
} catch {
  console.error('Could not read `supabase status`. Is the local stack running?');
  console.error('Start it with:  npx supabase start');
  process.exit(1);
}

// Hard stop: these are accounts with a published password. They must never be
// created anywhere but this machine.
const host = new URL(api).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  console.error(`Refusing to seed a non-local Supabase (${host}).`);
  process.exit(1);
}

const admin = (path, init = {}) =>
  fetch(`${api}${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

console.log(`Seeding ${api}`);

for (const user of USERS) {
  const res = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: user.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { user_name: user.user_name, full_name: user.full_name },
    }),
  });

  if (res.ok) {
    console.log(`  created ${user.email}`);
  } else {
    const body = await res.json().catch(() => ({}));
    // Already there from a previous run; nothing to do.
    if (res.status === 422 || /already/i.test(body.msg ?? body.message ?? '')) {
      console.log(`  ${user.email} already exists`);
    } else {
      console.error(`  FAILED ${user.email}: ${res.status} ${JSON.stringify(body)}`);
      process.exitCode = 1;
    }
  }
}

async function tokenFor(email) {
  const res = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`sign-in failed for ${email}`);
  return body.access_token;
}

const catRes = await fetch(`${api}/rest/v1/categories?select=id,slug`, {
  headers: { apikey: anonKey },
});
const categories = Object.fromEntries(
  (await catRes.json()).map((c) => [c.slug, c.id]),
);

for (const [slug, email, names, note] of LISTS) {
  const categoryId = categories[slug];
  if (!categoryId) {
    console.warn(`  skipping ${slug} (category not found -- migrations applied?)`);
    continue;
  }

  const token = await tokenFor(email);
  const res = await fetch(`${api}/rest/v1/rpc/submit_top_three`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_category_id: categoryId, p_names: names, p_note: note }),
  });

  if (res.ok) console.log(`  ${email} -> ${slug}`);
  else console.error(`  FAILED ${email} -> ${slug}: ${res.status} ${await res.text()}`);
}

console.log('\nDone. Sign in at http://localhost:4321/dev-login');

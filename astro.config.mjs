// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
  // Every page is rendered on demand. Category and profile pages depend on
  // live data, and the whole point of SSR here is that crawlers get real HTML.
  // Canonical/OG URLs always name the production domain, so the *.workers.dev
  // hostname can't become a duplicate of the site in the index. This is
  // build-time and deliberately separate from SITE_URL, which is runtime and
  // environment-specific (it builds OAuth callbacks, which must match the host
  // actually being used).
  site: 'https://topthreeanything.com',

  output: 'server',

  // Astro's own session store is unused -- Supabase keeps the session in
  // cookies. Turning it off means no Workers KV namespace to provision and a
  // smaller Worker bundle.
  session: false,
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  integrations: [vue()],

  // Supabase credentials are server-only. No Supabase client ever ships to the
  // browser: islands talk to our own /api routes instead. See README.
  env: {
    schema: {
      // Both are read at runtime, not inlined at build time. The anon key is
      // safe to expose by design, but keeping both as runtime secrets means the
      // build needs no credentials at all -- CI can build without them, and
      // rotating a key is a redeploy of config, not of code.
      SUPABASE_URL: envField.string({ context: 'server', access: 'secret' }),
      SUPABASE_ANON_KEY: envField.string({ context: 'server', access: 'secret' }),
      // 'secret' means "read at runtime" rather than "inlined at build". The
      // value isn't sensitive -- it's supplied as a plain var in
      // wrangler.jsonc -- but it must not be baked into the bundle, or
      // changing the domain would mean a rebuild rather than a config edit.
      SITE_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
    },
  },

  vite: {
    ssr: {
      // Supabase's realtime bundle pulls in Node builtins it never uses here.
      external: ['node:events'],
    },
  },
});

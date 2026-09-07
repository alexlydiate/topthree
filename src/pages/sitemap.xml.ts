import type { APIRoute } from 'astro';
import { SITE_URL } from 'astro:env/server';
import { getSitemapCategories, getSitemapProfiles } from '../lib/queries';
import type { SitemapEntry } from '../lib/queries';
import { siteOrigin } from '../lib/redirects';

/**
 * Generated per request rather than at build.
 *
 * @astrojs/sitemap walks the routes it can see at build time, which here would
 * be `/`, `/c` and a couple of noindex pages -- every page worth submitting
 * lives behind a dynamic route fed by the database, and new ones appear
 * whenever somebody creates a category. A build-time sitemap would be stale the
 * moment it shipped.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(origin: string, entry: SitemapEntry, changefreq: string, priority: string) {
  const lastmod = entry.lastmod
    ? `\n    <lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>`
    : '';

  return `  <url>
    <loc>${escapeXml(origin + entry.path)}</loc>${lastmod}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export const GET: APIRoute = async ({ request, locals }) => {
  const origin = siteOrigin(request, SITE_URL);

  const [categories, profiles] = await Promise.all([
    getSitemapCategories(locals.supabase),
    getSitemapProfiles(locals.supabase),
  ]);

  // Category pages are the point of the site: each is a landing page for a
  // search someone is already making. Profiles rank below them.
  const entries = [
    urlEntry(origin, { path: '/', lastmod: null }, 'daily', '1.0'),
    urlEntry(origin, { path: '/c', lastmod: null }, 'daily', '0.9'),
    ...categories.map((c) => urlEntry(origin, c, 'daily', '0.8')),
    ...profiles.map((p) => urlEntry(origin, p, 'weekly', '0.5')),
  ];

  // The spec caps a single sitemap at 50,000 URLs / 50MB. Well beyond MVP
  // scale, but if this is ever approached the fix is a sitemap index listing
  // /sitemap-categories.xml and /sitemap-profiles.xml separately.
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // Crawlers refetch this often and it does not need to be to-the-second.
      'cache-control': 'public, max-age=3600',
    },
  });
};

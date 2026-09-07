import type { APIRoute } from 'astro';
import { SITE_URL } from 'astro:env/server';
import { siteOrigin } from '../lib/redirects';

/**
 * Dynamic so the Sitemap line points at whatever origin is serving.
 *
 * Note what is NOT disallowed. /login, /onboarding and the editor already send
 * `noindex` in their markup, and blocking a page in robots.txt prevents
 * crawlers from ever seeing that tag -- Google will still index a
 * robots-blocked URL it finds linked, just without the content, which is the
 * opposite of what we want. Pages we want kept out of the index must stay
 * crawlable so the noindex is honoured.
 *
 * /api and /auth are different: they serve JSON and redirects, so there is no
 * markup to carry a noindex, and blocking is the only instrument available.
 */
export const GET: APIRoute = ({ request }) => {
  const origin = siteOrigin(request, SITE_URL);

  const body = `# https://topthreeanything.com
User-agent: *
Allow: /
Disallow: /api/
Disallow: /auth/

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
};
